export interface StorageProvider {
  /**
   * Absolute path to a stored object on *this* machine, when the provider keeps files locally.
   *
   * Needed by anything that hands a path to another process - the engine reads files, and a relative path
   * that is valid from this server's working directory is silently meaningless from the engine's. The
   * provider is asked rather than configuration being read, because the provider is what actually decides
   * where objects live: `AUDIO_DIR=./public/audio` in `.env` and this class's own `__dirname`-based root
   * agree only while the server happens to be started from its own directory.
   *
   * Returns null for a provider that is not local (S3 and friends), which is the caller's signal to fetch
   * over the network instead.
   */
  localPath?(key: string): string | null;
  upload(key: string, data: Buffer, contentType: string): Promise<string>;
  getUrl(key: string, expiresIn?: number): Promise<string>;
  getPublicUrl(key: string): string;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  copy(sourceKey: string, destKey: string): Promise<void>;
}

export type { StorageProvider as default };
