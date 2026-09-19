import { Client } from "@gradio/client";
import { config } from '../config/index.js';

let clientInstance: Client | null = null;
let connectionPromise: Promise<Client> | null = null;

/**
 * Get a lazy-initialized Gradio client connected to the ACE-Step Gradio app.
 * Caches the connection for reuse across requests.
 */
export async function getGradioClient(): Promise<Client> {
  if (clientInstance) return clientInstance;
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      const client = await Client.connect(config.acestep.apiUrl, {
        events: ["data", "status"],
      });
      clientInstance = client;
      console.log(`[Gradio] Connected to ${config.acestep.apiUrl}`);
      return client;
    } catch (error) {
      console.error(`[Gradio] Failed to connect to ${config.acestep.apiUrl}:`, error);
      throw error;
    } finally {
      connectionPromise = null;
    }
  })();

  return connectionPromise;
}

/**
 * Reset the cached Gradio client, forcing a new connection on next use.
 */
export function resetGradioClient(): void {
  clientInstance = null;
  connectionPromise = null;
  endpointNames = null;
}

/**
 * Names of the endpoints the connected Gradio app actually exposes.
 *
 * Needed because `@gradio/client` rejects an internally-created promise when an
 * endpoint name is unknown (dist/index.js:952 wraps `submit` in `new Promise` and
 * never returns that chain's rejection), so a missing name escapes every surrounding
 * try/catch and reaches Node as an unhandled rejection. Probing first is the only
 * way to turn that into a normal HTTP error.
 */
let endpointNames: Set<string> | null = null;

export async function gradioEndpoints(): Promise<Set<string>> {
  if (endpointNames) return endpointNames;

  const baseUrl = config.acestep.apiUrl;
  for (const url of [`${baseUrl}/gradio_api/info`, `${baseUrl}/info`]) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) continue;

      const info = (await response.json()) as { named_endpoints?: Record<string, unknown> };
      endpointNames = new Set(Object.keys(info.named_endpoints ?? {}));
      return endpointNames;
    } catch {
      // Try the next candidate.
    }
  }

  // Unknown rather than empty: callers should treat this as "cannot verify".
  endpointNames = new Set();
  return endpointNames;
}

/** True when the connected Gradio app exposes `name` (with or without a leading '/'). */
export async function hasGradioEndpoint(name: string): Promise<boolean> {
  const endpoints = await gradioEndpoints();
  if (endpoints.size === 0) return false;
  const normalized = name.startsWith('/') ? name : `/${name}`;
  return endpoints.has(normalized);
}

/**
 * Check if the Gradio app is reachable.
 * Tries multiple well-known endpoints to handle version differences.
 */
export async function isGradioAvailable(): Promise<boolean> {
  const baseUrl = config.acestep.apiUrl;
  const candidates = [
    `${baseUrl}/gradio_api/info`, // Gradio 5+
    `${baseUrl}/info`,            // Gradio 4.x fallback
    `${baseUrl}/`,                // Any HTTP response means server is up
  ];

  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (response.ok || response.status < 500) return true;
    } catch {
      // Try next candidate
    }
  }
  return false;
}
