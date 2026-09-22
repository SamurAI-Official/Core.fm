// Use relative URLs so Vite proxy handles them (enables LAN access)
const API_BASE = '';

// Resolve audio URL based on storage type
export function getAudioUrl(audioUrl: string | undefined | null, songId?: string): string | undefined {
  if (!audioUrl) return undefined;

  // Local storage: already relative, works with proxy
  if (audioUrl.startsWith('/audio/')) {
    return audioUrl;
  }

  // Already a full URL
  return audioUrl;
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
}

async function api<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    const errorMessage = error.error || error.message || 'Request failed';
    // Include status code in error for proper handling
    throw new Error(`${response.status}: ${errorMessage}`);
  }

  return response.json();
}

// Auth API (simplified - username only)
export interface User {
  id: string;
  username: string;
  isAdmin?: boolean;
  bio?: string;
  avatar_url?: string;
  banner_url?: string;
  createdAt?: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export const authApi = {
  // Auto-login: Get existing user from database (for local single-user app)
  auto: (): Promise<AuthResponse> =>
    api('/api/auth/auto'),

  setup: (username: string): Promise<AuthResponse> =>
    api('/api/auth/setup', { method: 'POST', body: { username } }),

  me: (token: string): Promise<{ user: User }> =>
    api('/api/auth/me', { token }),

  logout: (): Promise<{ success: boolean }> =>
    api('/api/auth/logout', { method: 'POST' }),

  refresh: (token: string): Promise<AuthResponse> =>
    api('/api/auth/refresh', { method: 'POST', token }),

  updateUsername: (username: string, token: string): Promise<AuthResponse> =>
    api('/api/auth/username', { method: 'PATCH', body: { username }, token }),
};

// Songs API
export interface Song {
  id: string;
  title: string;
  lyrics: string;
  style: string;
  caption?: string;
  cover_url?: string;
  audio_url?: string;
  audioUrl?: string;
  duration?: number;
  bpm?: number;
  key_scale?: string;
  time_signature?: string;
  tags: string[];
  is_public: boolean;
  like_count?: number;
  view_count?: number;
  user_id?: string;
  created_at: string;
  creator?: string;
  creator_avatar?: string;
  ditModel?: string;
  generation_params?: any;
}

// Transform songs to have proper audio URLs
function transformSongs(songs: Song[]): Song[] {
  return songs.map(song => {
    const rawUrl = song.audio_url || song.audioUrl;
    const resolvedUrl = getAudioUrl(rawUrl, song.id);
    return {
      ...song,
      audio_url: resolvedUrl,
      audioUrl: resolvedUrl,
    };
  });
}

/**
 * What a retry changed, and why.
 *
 * `changes` is the same information as `note`, as fields, so a UI can say it in its own language while
 * the note keeps the loop's own wording (which is what someone reading the song's params needs).
 */
export interface RetryResult {
  jobId?: string;
  dryRun?: boolean;
  promptId: string | null;
  root: string | null;
  attempt: number;
  reasons: string[];
  excludedSeeds: number[];
  seed: number;
  changes: {
    bpm: number | null;
    keyScale: string | null;
    style: string | null;
    lyricAgent: string | null;
  };
  note: string[];
  unactionable: string[];
  machineDesigned?: boolean;
  learnerReachable: boolean;
}

/** What this listener wants more and less of, as the loop has learned it. */
export interface TasteProfile {
  rater: string;
  verdicts: number;
  prefers: Array<{ key: string; value: number }>;
  avoids: Array<{ key: string; value: number }>;
  updatedAt: string | null;
}

export const songsApi = {
  getMySongs: async (token: string): Promise<{ songs: Song[] }> => {
    const result = await api('/api/songs', { token }) as { songs: Song[] };
    return { songs: transformSongs(result.songs) };
  },

  getPublicSongs: async (limit = 20, offset = 0): Promise<{ songs: Song[] }> => {
    const result = await api(`/api/songs/public?limit=${limit}&offset=${offset}`) as { songs: Song[] };
    return { songs: transformSongs(result.songs) };
  },

  getFeaturedSongs: async (): Promise<{ songs: Song[] }> => {
    const result = await api('/api/songs/public/featured') as { songs: Song[] };
    return { songs: transformSongs(result.songs) };
  },

  getSong: async (id: string, token?: string | null): Promise<{ song: Song }> => {
    const result = await api(`/api/songs/${id}`, { token: token || undefined }) as { song: Song };
    const rawUrl = result.song.audio_url || result.song.audioUrl;
    const resolvedUrl = getAudioUrl(rawUrl, result.song.id);
    return { song: { ...result.song, audio_url: resolvedUrl, audioUrl: resolvedUrl } };
  },

  getFullSong: async (id: string, token?: string | null): Promise<{ song: Song, comments: any[] }> => {
    const result = await api(`/api/songs/${id}/full`, { token: token || undefined }) as { song: Song, comments: any[] };
    const rawUrl = result.song.audio_url || result.song.audioUrl;
    const resolvedUrl = getAudioUrl(rawUrl, result.song.id);
    return { ...result, song: { ...result.song, audio_url: resolvedUrl, audioUrl: resolvedUrl } };
  },

  createSong: (song: Partial<Song>, token: string): Promise<{ song: Song }> =>
    api('/api/songs', { method: 'POST', body: song, token }),

  updateSong: async (id: string, updates: Partial<Song>, token: string): Promise<{ song: any }> => {
    const result = await api(`/api/songs/${id}`, { method: 'PATCH', body: updates, token }) as { song: any };
    const s = result.song;
    const rawUrl = s.audio_url || s.audioUrl;
    const resolvedUrl = getAudioUrl(rawUrl, s.id);

    return {
      song: {
        id: s.id,
        title: s.title,
        lyrics: s.lyrics,
        style: s.style,
        caption: s.caption,
        cover_url: s.cover_url,
        coverUrl: s.cover_url || s.coverUrl || `https://picsum.photos/seed/${s.id}/400/400`,
        duration: s.duration && s.duration > 0 ? `${Math.floor(s.duration / 60)}:${String(Math.floor(s.duration % 60)).padStart(2, '0')}` : '0:00',
        createdAt: new Date(s.created_at || s.createdAt),
        created_at: s.created_at,
        tags: s.tags || [],
        audioUrl: resolvedUrl,
        audio_url: resolvedUrl,
        isPublic: s.is_public ?? s.isPublic,
        is_public: s.is_public ?? s.isPublic,
        likeCount: s.like_count || s.likeCount || 0,
        like_count: s.like_count || s.likeCount || 0,
        viewCount: s.view_count || s.viewCount || 0,
        view_count: s.view_count || s.viewCount || 0,
        userId: s.user_id || s.userId,
        user_id: s.user_id || s.userId,
        creator: s.creator,
        creator_avatar: s.creator_avatar,
        ditModel: s.dit_model || s.ditModel,
        isGenerating: s.isGenerating,
        queuePosition: s.queuePosition,
        bpm: s.bpm,
        key_scale: s.key_scale,
        time_signature: s.time_signature,
      }
    };
  },

  deleteSong: (id: string, token: string): Promise<{ success: boolean }> =>
    api(`/api/songs/${id}`, { method: 'DELETE', token }),

  toggleLike: (id: string, token: string): Promise<{ liked: boolean }> =>
    api(`/api/songs/${id}/like`, { method: 'POST', token }),

  /**
   * A verdict on one response to one prompt: 'dislike' is the hard no, 'like' is its opposite, and
   * 'none' clears whatever is set (a second click on the same button). The server reconciles the two
   * projections, so a song can never end up both liked and disliked.
   *
   * `reasons` is the listener's account of what was wrong - off-prompt, bad-lyrics, muddy,
   * wrong-genre, not-my-kind - and it is optional: a hard no with no reason is still a hard no, it
   * just blames everything the response carried rather than a part of it.
   */
  setFeedback: (
    id: string,
    verdict: 'like' | 'dislike' | 'none',
    reasons: string[] = [],
    token?: string,
  ): Promise<{
    verdict: string;
    liked: boolean;
    disliked: boolean;
    likeCount: number;
    market?: string | null;
    promptId?: string | null;
    /**
     * What the loop did with the verdict. Only the fields a surface acts on are declared here: a verdict
     * that could not be delivered (`ok: false`) still stands locally, and one that arrived after the
     * listener's daily cap is `rateLimited` - recorded, not yet learned from - which the UI says out
     * loud rather than leaving the button looking like it did something it did not.
     */
    learning?: {
      ok: boolean;
      error?: string;
      applied?: string[];
      profile?: string[];
      pending?: Array<{ key: string; raters: number; needed: number }>;
      rateLimited?: boolean;
      rateLimit?: { limit: number; used: number; windowHours: number; resetsAt: string | null } | null;
    } | null;
  }> =>
    api(`/api/songs/${id}/feedback`, { method: 'POST', body: { verdict, reasons }, token }),

  getFeedback: (
    id: string,
    token: string,
  ): Promise<{ verdict: 'like' | 'dislike' | null; reasons: string[]; promptId: string | null }> =>
    api(`/api/songs/${id}/feedback`, { token }),

  /** Every verdict this user has given, with any reasons, so the buttons survive a reload. */
  getMyFeedback: (
    token: string,
  ): Promise<{ verdicts: Record<string, { verdict: 'like' | 'dislike'; reasons: string[] }> }> =>
    api('/api/songs/feedback/mine', { token }),

  /**
   * Another take on the same prompt, for a response that was refused.
   *
   * The server decides what to change (it owns the listener's profile and the loop's vocabularies) and
   * never rewrites a prompt the listener wrote themselves. `note` explains every change in the loop's
   * own words; `changes` carries the same thing as fields, which is what the UI turns into translated
   * text.
   */
  retry: (
    id: string,
    token: string,
    options: { reasons?: string[]; dryRun?: boolean } = {},
  ): Promise<RetryResult> =>
    api(`/api/songs/${id}/retry`, { method: 'POST', body: options, token }),

  /**
   * What this listener wants more and less of.
   *
   * `confident` is the server's own reading of how much is behind it: one click is a hint, not a taste,
   * and a surface that ignores that would be treating an accident as a preference.
   */
  getProfile: (
    token: string,
    market?: string,
  ): Promise<{ ok: boolean; error: string | null; profile: TasteProfile | null; confident: boolean }> =>
    api(`/api/songs/profile/me${market ? `?market=${market}` : ''}`, { token }),

  getLikedSongs: async (token: string): Promise<{ songs: Song[] }> => {
    const result = await api('/api/songs/liked/list', { token }) as { songs: Song[] };
    return { songs: transformSongs(result.songs) };
  },

  togglePrivacy: (id: string, token: string): Promise<{ isPublic: boolean }> =>
    api(`/api/songs/${id}/privacy`, { method: 'PATCH', token }),

  trackPlay: (id: string, token?: string | null): Promise<{ viewCount: number }> =>
    api(`/api/songs/${id}/play`, { method: 'POST', token: token || undefined }),

  getComments: (id: string, token?: string | null): Promise<{ comments: Comment[] }> =>
    api(`/api/songs/${id}/comments`, { token: token || undefined }),

  addComment: (id: string, content: string, token: string): Promise<{ comment: Comment }> =>
    api(`/api/songs/${id}/comments`, { method: 'POST', body: { content }, token }),

  deleteComment: (commentId: string, token: string): Promise<{ success: boolean }> =>
    api(`/api/songs/comments/${commentId}`, { method: 'DELETE', token }),
};

interface Comment {
  id: string;
  song_id: string;
  user_id: string;
  username: string;
  content: string;
  created_at: string;
}

// Generation API
export interface GenerationParams {
  // Mode
  customMode: boolean;
  songDescription?: string;

  // Custom Mode
  prompt?: string;
  lyrics: string;
  style: string;
  title: string;

  // Model Selection
  ditModel?: string;

  // Common
  instrumental: boolean;
  vocalLanguage?: string;

  // Music Parameters
  duration?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;

  // Generation Settings
  inferenceSteps?: number;
  guidanceScale?: number;
  batchSize?: number;
  randomSeed?: boolean;
  seed?: number;
  thinking?: boolean;
  audioFormat?: 'mp3' | 'flac';
  inferMethod?: 'ode' | 'sde';
  shift?: number;

  // LM Parameters
  lmTemperature?: number;
  lmCfgScale?: number;
  lmTopK?: number;
  lmTopP?: number;
  lmNegativePrompt?: string;
  lmBackend?: 'pt' | 'vllm';
  lmModel?: string;

  // Expert Parameters
  referenceAudioUrl?: string;
  sourceAudioUrl?: string;
  referenceAudioTitle?: string;
  sourceAudioTitle?: string;
  audioCodes?: string;
  repaintingStart?: number;
  repaintingEnd?: number;
  instruction?: string;
  audioCoverStrength?: number;
  taskType?: string;
  useAdg?: boolean;
  cfgIntervalStart?: number;
  cfgIntervalEnd?: number;
  customTimesteps?: string;
  useCotMetas?: boolean;
  useCotCaption?: boolean;
  useCotLanguage?: boolean;
  autogen?: boolean;
  constrainedDecodingDebug?: boolean;
  allowLmBatch?: boolean;
  getScores?: boolean;
  getLrc?: boolean;
  scoreScale?: number;
  lmBatchChunkSize?: number;
  trackName?: string;
  completeTrackClasses?: string[];
  isFormatCaption?: boolean;
  loraLoaded?: boolean;
}

export interface GenerationJob {
  jobId: string;
  id?: string;
  status: 'pending' | 'queued' | 'running' | 'succeeded' | 'failed';
  queuePosition?: number;
  etaSeconds?: number;
  progress?: number;
  stage?: string;
  params?: any;
  created_at?: string;
  result?: {
    audioUrls: string[];
    bpm?: number;
    duration?: number;
    keyScale?: string;
    timeSignature?: string;
  };
  error?: string;
}

export const generateApi = {
  startGeneration: (params: GenerationParams, token: string): Promise<GenerationJob> =>
    api('/api/generate', { method: 'POST', body: params, token }),

  getStatus: (jobId: string, token: string): Promise<GenerationJob> =>
    api(`/api/generate/status/${jobId}`, { token }),

  getHistory: (token: string): Promise<{ jobs: GenerationJob[] }> =>
    api('/api/generate/history', { token }),

  uploadAudio: async (file: File, token: string): Promise<{ url: string; key: string }> => {
    const formData = new FormData();
    formData.append('audio', file);
    const response = await fetch(`${API_BASE}/api/generate/upload-audio`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.details || error.error || 'Upload failed');
    }
    return response.json();
  },

  formatInput: (params: {
    caption: string;
    lyrics?: string;
    bpm?: number;
    duration?: number;
    keyScale?: string;
    timeSignature?: string;
    temperature?: number;
    topK?: number;
    topP?: number;
    lmModel?: string;
    lmBackend?: string;
  }, token: string): Promise<{
    caption?: string;
    lyrics?: string;
    bpm?: number;
    duration?: number;
    key_scale?: string;
    vocal_language?: string;
    time_signature?: string;
    status_message?: string;
    error?: string;
  }> => api('/api/generate/format', { method: 'POST', body: params, token }),

  // Random description from Gradio's example library
  getRandomDescription: (token: string): Promise<{
    description: string;
    instrumental: boolean;
    vocalLanguage: string;
  }> => api('/api/generate/random-description', { token }),

  // LoRA Inference (requires ACE-Step training fork)
  loadLora: (params: {
    lora_path: string;
  }, token: string): Promise<{
    message: string;
    lora_path: string;
  }> => api('/api/lora/load', { method: 'POST', body: params, token }),

  unloadLora: (token: string): Promise<{
    message: string;
  }> => api('/api/lora/unload', { method: 'POST', token }),

  setLoraScale: (params: {
    scale: number;
  }, token: string): Promise<{
    message: string;
    scale: number;
  }> => api('/api/lora/scale', { method: 'POST', body: params, token }),

  toggleLora: (params: {
    enabled: boolean;
  }, token: string): Promise<{
    message: string;
    active: boolean;
  }> => api('/api/lora/toggle', { method: 'POST', body: params, token }),

  getLoraStatus: (token: string): Promise<{
    loaded: boolean;
    active: boolean;
    scale: number;
    path: string;
  }> => api('/api/lora/status', { token }),

  // Adapters imported into the engine's loras/ directory. `confirmed` means the weights matched the
  // running checkpoint at import time AND the engine has loaded the adapter since.
  listLoras: (token: string): Promise<{
    adapters: Array<{
      name: string;
      path: string;
      configSource: string;
      rank: number | null;
      alpha: number | null;
      repo: string | null;
      verified: boolean | null;
      confirmed: boolean;
      lastLoadAt: string | null;
      lastLoadError: string | null;
    }>;
    lorasDir: string;
    active: { loaded: boolean; active: boolean; scale: number; path: string };
    activeAdapterName: string | null;
    engine: Record<string, unknown> | null;
  }> => api('/api/lora/list', { token }),

  // Pull a Hugging Face LoRA repo in and normalise it for the engine
  importLora: (params: {
    repoId: string;
    name?: string;
    alpha?: number;
  }, token: string): Promise<{
    imported: boolean;
    name: string;
    dest?: string;
    profile?: { rank: number | null; layers: number; target_modules: string[] };
    config?: { source: string; r: number; lora_alpha: number };
    verification?: { ok: boolean; problems: string[] };
  }> => api('/api/lora/import', { method: 'POST', body: params, token }),
};

// Users API
export interface UserProfile extends User {
  bio?: string;
  avatar_url?: string;
  banner_url?: string;
  created_at: string;
}

export const usersApi = {
  getProfile: (username: string, token?: string | null): Promise<{ user: UserProfile }> =>
    api(`/api/users/${username}`, { token: token || undefined }),

  getPublicSongs: (username: string): Promise<{ songs: Song[] }> =>
    api(`/api/users/${username}/songs`),

  getPublicPlaylists: (username: string): Promise<{ playlists: any[] }> =>
    api(`/api/users/${username}/playlists`),

  getFeaturedCreators: (): Promise<{ creators: Array<UserProfile & { follower_count?: number }> }> =>
    api('/api/users/public/featured'),

  updateProfile: (updates: Partial<User>, token: string): Promise<{ user: User }> =>
    api('/api/users/me', { method: 'PATCH', body: updates, token }),

  uploadAvatar: async (file: File, token: string): Promise<{ user: UserProfile; url: string }> => {
    const formData = new FormData();
    formData.append('avatar', file);
    const response = await fetch(`${API_BASE}/api/users/me/avatar`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.details || error.error || 'Upload failed');
    }
    return response.json();
  },

  uploadBanner: async (file: File, token: string): Promise<{ user: UserProfile; url: string }> => {
    const formData = new FormData();
    formData.append('banner', file);
    const response = await fetch(`${API_BASE}/api/users/me/banner`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }
    return response.json();
  },

  toggleFollow: (username: string, token: string): Promise<{ following: boolean, followerCount: number }> =>
    api(`/api/users/${username}/follow`, { method: 'POST', token }),

  getFollowers: (username: string): Promise<{ followers: User[] }> =>
    api(`/api/users/${username}/followers`),

  getFollowing: (username: string): Promise<{ following: User[] }> =>
    api(`/api/users/${username}/following`),

  getStats: (username: string, token?: string | null): Promise<{ followerCount: number, followingCount: number, isFollowing: boolean }> =>
    api(`/api/users/${username}/stats`, { token: token || undefined }),
};

// Playlists API
export interface Playlist {
  id: string;
  name: string;
  description?: string;
  cover_url?: string;
  is_public?: boolean;
  user_id?: string;
  created_at?: string;
  song_count?: number;
}

export const playlistsApi = {
  create: (name: string, description: string, isPublic: boolean, token: string): Promise<{ playlist: Playlist }> =>
    api('/api/playlists', { method: 'POST', body: { name, description, isPublic }, token }),

  getMyPlaylists: (token: string): Promise<{ playlists: Playlist[] }> =>
    api('/api/playlists', { token }),

  getPlaylist: (id: string, token?: string | null): Promise<{ playlist: Playlist, songs: any[] }> =>
    api(`/api/playlists/${id}`, { token: token || undefined }),

  getFeaturedPlaylists: (): Promise<{ playlists: Array<Playlist & { creator?: string; creator_avatar?: string }> }> =>
    api('/api/playlists/public/featured'),

  addSong: (playlistId: string, songId: string, token: string): Promise<{ success: boolean }> =>
    api(`/api/playlists/${playlistId}/songs`, { method: 'POST', body: { songId }, token }),

  removeSong: (playlistId: string, songId: string, token: string): Promise<{ success: boolean }> =>
    api(`/api/playlists/${playlistId}/songs/${songId}`, { method: 'DELETE', token }),

  update: (id: string, updates: Partial<Playlist>, token: string): Promise<{ playlist: Playlist }> =>
    api(`/api/playlists/${id}`, { method: 'PATCH', body: updates, token }),

  delete: (id: string, token: string): Promise<{ success: boolean }> =>
    api(`/api/playlists/${id}`, { method: 'DELETE', token }),
};

// Search API
export interface SearchResult {
  songs: Song[];
  creators: Array<UserProfile & { follower_count?: number }>;
  playlists: Array<Playlist & { creator?: string; creator_avatar?: string }>;
}

export const searchApi = {
  search: async (query: string, type?: 'songs' | 'creators' | 'playlists' | 'all'): Promise<SearchResult> => {
    const params = new URLSearchParams({ q: query });
    if (type && type !== 'all') params.append('type', type);
    const result = await api(`/api/search?${params}`) as SearchResult;
    return {
      ...result,
      songs: transformSongs(result.songs || []),
    };
  },
};

// Contact Form API
export interface ContactFormData {
  name: string;
  email: string;
  subject: string;
  message: string;
  category: 'general' | 'support' | 'business' | 'press' | 'legal';
}

export const contactApi = {
  submit: (data: ContactFormData): Promise<{ success: boolean; message: string; id: string }> =>
    api('/api/contact', { method: 'POST', body: data }),
};

// Training API (LoRA fine-tuning via Gradio)
export interface TrainingSample {
  audio: unknown;
  filename: string;
  caption: string;
  genre: string;
  promptOverride: string;
  lyrics: string;
  bpm: number;
  key: string;
  timeSignature: string;
  duration: number;
  language: string;
  instrumental: boolean;
  rawLyrics?: string;
}

export interface DatasetSettings {
  datasetName: string;
  customTag: string;
  tagPosition: 'prepend' | 'append' | 'replace';
  allInstrumental: boolean;
  genreRatio: number;
}

export interface TrainingParams {
  tensorDir?: string;
  rank?: number;
  alpha?: number;
  dropout?: number;
  learningRate?: number;
  epochs?: number;
  batchSize?: number;
  gradientAccumulation?: number;
  saveEvery?: number;
  shift?: number;
  seed?: number;
  outputDir?: string;
  resumeCheckpoint?: string | null;
}

// Helper: build proxy URL for training audio files
export function getTrainingAudioUrl(audioPath: unknown, token?: string): string | undefined {
  if (!audioPath) return undefined;

  // Handle Gradio FileData objects
  if (typeof audioPath === 'object' && audioPath !== null) {
    const fd = audioPath as Record<string, unknown>;
    if (fd.url && typeof fd.url === 'string') return fd.url;
    if (fd.path && typeof fd.path === 'string') {
      return `${API_BASE}/api/training/audio?path=${encodeURIComponent(fd.path)}`;
    }
    return undefined;
  }

  // Handle absolute path string
  if (typeof audioPath === 'string') {
    if (audioPath.startsWith('http://') || audioPath.startsWith('https://') || audioPath.startsWith('/audio/')) {
      return audioPath;
    }
    return `${API_BASE}/api/training/audio?path=${encodeURIComponent(audioPath)}`;
  }

  return undefined;
}

export const trainingApi = {
  // Upload audio files for a dataset
  uploadAudio: async (files: File[], datasetName: string, token: string): Promise<{
    files: Array<{ filename: string; originalName: string; size: number; path: string }>;
    uploadDir: string;
    count: number;
  }> => {
    const formData = new FormData();
    formData.append('datasetName', datasetName);
    for (const file of files) {
      formData.append('audio', file);
    }
    const response = await fetch(`${API_BASE}/api/training/upload-audio`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || 'Upload failed');
    }
    return response.json();
  },

  // Build dataset JSON from uploaded audio files
  buildDataset: (params: {
    datasetName: string;
    customTag?: string;
    tagPosition?: string;
    allInstrumental?: boolean;
  }, token: string): Promise<{
    status: string;
    dataframe: unknown;
    sampleCount: number;
    sample: TrainingSample;
    settings: DatasetSettings;
    datasetPath: string;
  }> => api('/api/training/build-dataset', { method: 'POST', body: params, token }),

  // Scan directory for audio files (Node.js implementation)
  scanDirectory: (params: {
    audioDir: string;
    datasetName?: string;
    customTag?: string;
    tagPosition?: string;
    allInstrumental?: boolean;
  }, token: string): Promise<{
    status: string;
    dataframe: unknown;
    sampleCount: number;
    audioDir: string;
  }> => api('/api/training/scan-directory', { method: 'POST', body: params, token }),

  // Auto-label dataset samples (requires model loaded in Gradio)
  autoLabel: (params: {
    skipMetas?: boolean;
    formatLyrics?: boolean;
    transcribeLyrics?: boolean;
    onlyUnlabeled?: boolean;
  }, token: string): Promise<{
    dataframe?: unknown;
    status: string;
    error?: string;
    hint?: string;
  }> => api('/api/training/auto-label', { method: 'POST', body: params, token }),

  // Initialize model for training (requires Gradio)
  initModel: (params: {
    checkpoint?: string;
    configPath?: string;
    device?: string;
    initLlm?: boolean;
    lmModelPath?: string;
    backend?: string;
    useFlashAttention?: boolean;
    offloadToCpu?: boolean;
    offloadDitToCpu?: boolean;
    compileModel?: boolean;
    quantization?: boolean;
  }, token: string): Promise<{
    status: string;
    modelReady?: boolean;
    error?: string;
    hint?: string;
  }> => api('/api/training/init-model', { method: 'POST', body: params, token }),

  // List available checkpoints
  getCheckpoints: (token: string): Promise<{
    checkpoints: string[];
    configs: string[];
  }> => api('/api/training/checkpoints', { token }),

  // List LoRA training checkpoints
  getLoraCheckpoints: (dir: string, token: string): Promise<{
    checkpoints: string[];
    outputDir: string;
  }> => api(`/api/training/lora-checkpoints?dir=${encodeURIComponent(dir)}`, { token }),

  // Preprocess dataset to tensors
  preprocess: (params: {
    datasetPath: string;
    outputDir?: string;
  }, token: string): Promise<{
    status: string;
    message?: string;
    output_files?: number;
  }> => api('/api/training/preprocess', { method: 'POST', body: params, token }),

  loadDataset: (datasetPath: string, token: string): Promise<{
    status: string;
    dataframe: unknown;
    sampleCount: number;
    sample: TrainingSample;
    settings: DatasetSettings;
  }> => api('/api/training/load-dataset', { method: 'POST', body: { datasetPath }, token }),

  getSamplePreview: (idx: number, token: string): Promise<TrainingSample> =>
    api(`/api/training/sample-preview?idx=${idx}`, { token }),

  saveSample: (params: {
    sampleIdx: number;
    caption: string;
    genre: string;
    promptOverride: string;
    lyrics: string;
    bpm: number;
    key: string;
    timeSignature: string;
    language: string;
    instrumental: boolean;
  }, token: string): Promise<{ dataframe: unknown; status: string }> =>
    api('/api/training/save-sample', { method: 'POST', body: params, token }),

  updateSettings: (params: {
    customTag: string;
    tagPosition: string;
    allInstrumental: boolean;
    genreRatio: number;
  }, token: string): Promise<{ success: boolean }> =>
    api('/api/training/update-settings', { method: 'POST', body: params, token }),

  saveDataset: (params: {
    savePath?: string;
    datasetName?: string;
    customTag?: string;
    tagPosition?: string;
    allInstrumental?: boolean;
    genreRatio?: number;
  }, token: string): Promise<{ status: string; path: string }> =>
    api('/api/training/save-dataset', { method: 'POST', body: params, token }),

  loadTensors: (tensorDir: string, token: string): Promise<{ status: string }> =>
    api('/api/training/load-tensors', { method: 'POST', body: { tensorDir }, token }),

  startTraining: (params: TrainingParams, token: string): Promise<{
    progress: string;
    log: string;
    metrics: unknown;
  }> => api('/api/training/start', { method: 'POST', body: params, token }),

  stopTraining: (token: string): Promise<{ status: string }> =>
    api('/api/training/stop', { method: 'POST', token }),

  exportLora: (params: {
    exportPath?: string;
    loraOutputDir?: string;
  }, token: string): Promise<{ status: string }> =>
    api('/api/training/export', { method: 'POST', body: params, token }),

  importDataset: (datasetType: string, token: string): Promise<{ status: string }> =>
    api('/api/training/import-dataset', { method: 'POST', body: { datasetType }, token }),
};
