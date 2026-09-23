import { Router, Response } from 'express';
import { Readable } from 'node:stream';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/pool.js';
import { authMiddleware, optionalAuthMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { getStorageProvider } from '../services/storage/factory.js';
import {
  fetchProfile,
  planNextTake,
  reportPreference,
  rerollConceptLyrics,
} from '../services/aggregator.js';
import { createGenerationJob } from '../services/generation.js';
// Only for the type of the stored request a retry replays; the engine call itself is inside the service.
import type { GenerationParams } from '../services/acestep.js';

const router = Router();

// Helper: resolve audio URL (generates signed URL for S3)
async function resolveAudioUrl(audioUrl: string | null): Promise<string | null> {
  if (!audioUrl) return null;

  if (audioUrl.startsWith('s3://')) {
    const storageKey = audioUrl.replace('s3://', '');
    const storage = getStorageProvider();
    return storage.getUrl(storageKey, 3600); // 1 hour expiry
  }

  return audioUrl;
}

// Helper: resolve audio URL for direct playback
async function resolveAccessibleAudioUrl(audioUrl: string | null, isPublic: boolean): Promise<string | null> {
  if (!audioUrl) return null;
  if (audioUrl.startsWith('s3://')) {
    const storageKey = audioUrl.replace('s3://', '');
    const storage = getStorageProvider();
    return isPublic ? storage.getPublicUrl(storageKey) : storage.getUrl(storageKey, 3600);
  }
  return audioUrl;
}

// Get audio - proxies from S3 to avoid CORS issues
router.get('/:id/audio', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT s.audio_url, s.is_public, s.user_id FROM songs s WHERE s.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Song not found' });
      return;
    }

    const song = result.rows[0];

    if (!song.is_public && (!req.user || req.user.id !== song.user_id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const audioUrl = await resolveAudioUrl(song.audio_url);
    if (!audioUrl) {
      res.status(404).json({ error: 'Audio not available' });
      return;
    }

    // Local files - redirect
    if (audioUrl.startsWith('/')) {
      res.redirect(audioUrl);
      return;
    }

    // S3/remote - proxy to avoid CORS
    const range = req.headers.range;
    const audioRes = await fetch(audioUrl, {
      headers: range ? { Range: range } : undefined,
    });
    if (!audioRes.ok && audioRes.status !== 206) {
      res.status(502).json({ error: 'Failed to fetch audio' });
      return;
    }

    const contentType = audioRes.headers.get('content-type') || 'audio/mpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');

    const contentLength = audioRes.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    const contentRange = audioRes.headers.get('content-range');
    if (contentRange) {
      res.status(206);
      res.setHeader('Content-Range', contentRange);
    }

    if (audioRes.body) {
      Readable.fromWeb(audioRes.body as any).pipe(res);
      return;
    }

    const arrayBuffer = await audioRes.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error('Get audio error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's songs
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.title, s.lyrics, s.style, s.caption, s.cover_url, s.audio_url,
              s.duration, s.bpm, s.key_scale, s.time_signature, s.tags, s.is_public, 
              s.like_count, s.view_count, s.user_id, s.created_at, s.generation_params,
              COALESCE(u.username, 'Anonymous') as creator
       FROM songs s
       LEFT JOIN users u ON s.user_id = u.id
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC`,
      [req.user!.id]
    );

    const songs = await Promise.all(
      result.rows.map(async (row) => ({
        ...row,
        audio_url: await resolveAccessibleAudioUrl(row.audio_url, row.is_public),
      }))
    );

    res.json({ songs });
  } catch (error) {
    console.error('Get songs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get featured songs (random songs for discover page)
router.get('/public/featured', optionalAuthMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    // Return random songs - for local app, show all songs randomly
    const result = await pool.query(
      `SELECT s.id, s.title, s.lyrics, s.style, s.caption, s.cover_url, s.audio_url,
              s.duration, s.bpm, s.key_scale, s.time_signature, s.tags, s.like_count, s.view_count, s.created_at, s.user_id,
              COALESCE(u.username, 'Anonymous') as creator, u.avatar_url as creator_avatar, s.generation_params
       FROM songs s
       LEFT JOIN users u ON s.user_id = u.id
       ORDER BY RANDOM()
       LIMIT 20`
    );

    const songs = await Promise.all(
      result.rows.map(async (row) => ({
        id: row.id,
        title: row.title,
        lyrics: row.lyrics,
        style: row.style,
        caption: row.caption,
        cover_url: row.cover_url,
        audio_url: await resolveAccessibleAudioUrl(row.audio_url, true),
        duration: row.duration,
        bpm: row.bpm,
        key_scale: row.key_scale,
        time_signature: row.time_signature,
        tags: row.tags || [],
        like_count: row.like_count || 0,
        view_count: row.view_count || 0,
        created_at: row.created_at,
        creator: row.creator,
        creator_avatar: row.creator_avatar,
        user_id: row.user_id,
        is_public: true
      }))
    );

    res.json({ songs });
  } catch (error) {
    console.error('Get featured/random songs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get public songs (for explore/home)
router.get('/public', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await pool.query(
      `SELECT s.id, s.title, s.lyrics, s.style, s.caption, s.cover_url, s.audio_url,
              s.duration, s.bpm, s.key_scale, s.time_signature, s.tags, s.like_count, s.created_at,
              COALESCE(u.username, 'Anonymous') as creator, s.generation_params
       FROM songs s
       LEFT JOIN users u ON s.user_id = u.id
       WHERE s.is_public = true
       ORDER BY s.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const songs = await Promise.all(
      result.rows.map(async (row) => ({
        ...row,
        audio_url: await resolveAccessibleAudioUrl(row.audio_url, true),
      }))
    );

    res.json({ songs });
  } catch (error) {
    console.error('Get public songs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single song
router.get('/:id', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.user_id, s.title, s.lyrics, s.style, s.caption, s.cover_url, s.audio_url,
              s.duration, s.bpm, s.key_scale, s.time_signature, s.tags, s.is_public, s.like_count, s.view_count, s.created_at,
              COALESCE(u.username, 'Anonymous') as creator, u.avatar_url as creator_avatar, s.generation_params
       FROM songs s
       LEFT JOIN users u ON s.user_id = u.id
       WHERE s.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Song not found' });
      return;
    }

    const song = result.rows[0];

    // Check access
    if (!song.is_public && (!req.user || req.user.id !== song.user_id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const resolvedSong = {
      ...song,
      audio_url: await resolveAccessibleAudioUrl(song.audio_url, song.is_public),
    };

    res.json({ song: resolvedSong });
  } catch (error) {
    console.error('Get song error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get full song details (including comments)
router.get('/:id/full', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [songResult, commentsResult] = await Promise.all([
      pool.query(
        `SELECT s.id, s.user_id, s.title, s.lyrics, s.style, s.caption, s.cover_url, s.audio_url,
                s.duration, s.bpm, s.key_scale, s.time_signature, s.tags, s.is_public,
                s.like_count, s.view_count, s.created_at, s.generation_params,
                COALESCE(u.username, 'Anonymous') as creator, u.avatar_url as creator_avatar
         FROM songs s
         LEFT JOIN users u ON s.user_id = u.id
         WHERE s.id = $1`,
        [req.params.id]
      ),
      pool.query(
        `SELECT c.id, c.content, c.created_at, c.updated_at,
                u.id as user_id, u.username, u.avatar_url
         FROM comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.song_id = $1
         ORDER BY c.created_at DESC`,
        [req.params.id]
      )
    ]);

    if (songResult.rows.length === 0) {
      res.status(404).json({ error: 'Song not found' });
      return;
    }

    const song = songResult.rows[0];

    // Check access
    if (!song.is_public && (!req.user || req.user.id !== song.user_id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Increment view count
    await pool.query('UPDATE songs SET view_count = view_count + 1 WHERE id = $1', [req.params.id]);

    const resolvedSong = {
      ...song,
      audio_url: await resolveAccessibleAudioUrl(song.audio_url, song.is_public),
    };

    res.json({
      song: resolvedSong,
      comments: commentsResult.rows
    });
  } catch (error) {
    console.error('Get full song error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create song (manual, not from generation)
router.post('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      title,
      lyrics,
      style,
      caption,
      coverUrl,
      audioUrl,
      duration,
      bpm,
      keyScale,
      timeSignature,
      tags,
      isPublic,
    } = req.body;

    const result = await pool.query(
      `INSERT INTO songs (user_id, title, lyrics, style, caption, cover_url, audio_url,
                          duration, bpm, key_scale, time_signature, tags, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        req.user!.id,
        title,
        lyrics,
        style,
        caption,
        coverUrl,
        audioUrl,
        duration,
        bpm,
        keyScale,
        timeSignature,
        tags || [],
        isPublic || false,
      ]
    );

    res.status(201).json({ song: result.rows[0] });
  } catch (error) {
    console.error('Create song error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update song
router.patch('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Verify ownership
    const check = await pool.query('SELECT user_id FROM songs WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) {
      res.status(404).json({ error: 'Song not found' });
      return;
    }
    if (check.rows[0].user_id !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    const allowedFields = ['title', 'lyrics', 'style', 'caption', 'cover_url', 'is_public', 'tags'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${paramCount}`);
        values.push(req.body[field]);
        paramCount++;
      }
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(req.params.id);

    const result = await pool.query(
      `UPDATE songs SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
      values
    );

    res.json({ song: result.rows[0] });
  } catch (error) {
    console.error('Update song error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete song
router.delete('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const check = await pool.query('SELECT user_id, audio_url, cover_url FROM songs WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) {
      res.status(404).json({ error: 'Song not found' });
      return;
    }
    if (check.rows[0].user_id !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const song = check.rows[0];
    const storage = getStorageProvider();

    // Delete audio file from storage
    if (song.audio_url) {
      try {
        // Handle local storage paths (/audio/filename.mp3 -> filename.mp3)
        const storageKey = song.audio_url.startsWith('/audio/')
          ? song.audio_url.replace('/audio/', '')
          : song.audio_url.replace('s3://', '');
        await storage.delete(storageKey);
      } catch (err) {
        console.error(`Failed to delete audio file ${song.audio_url}:`, err);
      }
    }

    // Delete cover image if it's stored locally
    if (song.cover_url && song.cover_url.startsWith('/audio/')) {
      try {
        const coverKey = song.cover_url.replace('/audio/', '');
        await storage.delete(coverKey);
      } catch (err) {
        console.error(`Failed to delete cover ${song.cover_url}:`, err);
      }
    }

    await pool.query('DELETE FROM songs WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete song error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Like/unlike song
router.post('/:id/like', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if already liked
    const existing = await client.query(
      'SELECT 1 FROM liked_songs WHERE user_id = $1 AND song_id = $2',
      [req.user!.id, req.params.id]
    );

    if (existing.rows.length > 0) {
      // Unlike
      await client.query('DELETE FROM liked_songs WHERE user_id = $1 AND song_id = $2', [
        req.user!.id,
        req.params.id,
      ]);
      // Decrement like_count
      await client.query(
        'UPDATE songs SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1',
        [req.params.id]
      );
      await client.query('COMMIT');
      res.json({ liked: false });
    } else {
      // Like
      await client.query('INSERT INTO liked_songs (user_id, song_id) VALUES ($1, $2)', [
        req.user!.id,
        req.params.id,
      ]);
      // Increment like_count
      await client.query(
        'UPDATE songs SET like_count = like_count + 1 WHERE id = $1',
        [req.params.id]
      );
      // Reconcile the other direction too: this route is the older of the two, and a like arriving
      // here must clear a hard no for the same reason it does on /feedback - otherwise a song can end
      // up both liked and rejected, and the learner would read two opposite verdicts as equivalent.
      await client.query(
        "DELETE FROM song_feedback WHERE user_id = $1 AND song_id = $2 AND verdict = 'dislike'",
        [req.user!.id, req.params.id]
      );
      await client.query('COMMIT');
      res.json({ liked: true });
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Like song error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * The hard no: a verdict on one response to one prompt.
 *
 * `POST /:id/like` stays the like toggle the player already had. This is the general verdict, and the
 * two are reconciled here - a dislike clears the like and a like clears the dislike - so a song can
 * never be both. `verdict: 'none'` clears whatever is there, which is what a second click on the same
 * button means.
 *
 * Dislikes are why this exists. Without them a listener can only say "less of this" through a rating
 * on a designed run they may never have made, and cannot say "not this response to my prompt" at all.
 * The reasons travel with the verdict because they decide what the judgement is *about* - the prompt
 * mapping, the words, or the mix; a verdict with no reason is still valid and simply blames everything
 * the response carried.
 */
router.post('/:id/feedback', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const verdict = String((req.body as { verdict?: unknown })?.verdict ?? '');
    if (!['like', 'dislike', 'none'].includes(verdict)) {
      res.status(400).json({ error: "verdict must be 'like', 'dislike' or 'none'" });
      return;
    }
    const rawReasons = (req.body as { reasons?: unknown })?.reasons;
    const reasons = Array.isArray(rawReasons)
      ? rawReasons.filter((reason): reason is string => typeof reason === 'string').slice(0, 6)
      : [];

    const song = await client.query('SELECT id, generation_params, prompt_id FROM songs WHERE id = $1', [
      req.params.id,
    ]);
    if (song.rows.length === 0) {
      res.status(404).json({ error: 'song not found' });
      return;
    }

    await client.query('BEGIN');
    const liked = await client.query(
      'SELECT 1 FROM liked_songs WHERE user_id = $1 AND song_id = $2',
      [req.user!.id, req.params.id],
    );
    const wasLiked = liked.rows.length > 0;

    // A like clears the disagreement before it is recorded, so the projections (liked_songs,
    // like_count) and the verdict table can never tell different stories.
    if (verdict === 'like' && !wasLiked) {
      await client.query('INSERT INTO liked_songs (user_id, song_id) VALUES ($1, $2)', [
        req.user!.id,
        req.params.id,
      ]);
      await client.query('UPDATE songs SET like_count = like_count + 1 WHERE id = $1', [req.params.id]);
    } else if (verdict !== 'like' && wasLiked) {
      await client.query('DELETE FROM liked_songs WHERE user_id = $1 AND song_id = $2', [
        req.user!.id,
        req.params.id,
      ]);
      await client.query(
        'UPDATE songs SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1',
        [req.params.id],
      );
    }

    if (verdict === 'none') {
      await client.query('DELETE FROM song_feedback WHERE user_id = $1 AND song_id = $2', [
        req.user!.id,
        req.params.id,
      ]);
    } else {
      await client.query(
        `INSERT INTO song_feedback (user_id, song_id, verdict, reasons)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT(user_id, song_id)
         DO UPDATE SET verdict = excluded.verdict, reasons = excluded.reasons, updated_at = datetime('now')`,
        [req.user!.id, req.params.id, verdict, JSON.stringify(reasons)],
      );
    }
    await client.query('COMMIT');

    const counts = await pool.query('SELECT like_count FROM songs WHERE id = $1', [req.params.id]);

    // Reporting to the aggregator happens after the local verdict is committed, and its failure is
    // reported rather than raised: the verdict is already the listener's, and a local app must not
    // refuse a thumbs-down because a second service is not running. What the aggregator did (which may
    // be nothing yet - a vote is held until enough distinct listeners agree) comes back as `learning`.
    const params = (() => {
      const raw = song.rows[0]?.generation_params;
      if (typeof raw !== 'string' || raw.length === 0) return {} as Record<string, unknown>;
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return {} as Record<string, unknown>;
      }
    })();
    const market = typeof params.market === 'string' && params.market ? params.market : null;
    const themes = Array.isArray(params.lyricThemes)
      ? params.lyricThemes.filter((theme): theme is string => typeof theme === 'string')
      : undefined;
    const learning = await reportPreference({
      market: market ?? '',
      verdict: verdict as 'like' | 'dislike' | 'none',
      rater: `app:${req.user!.id}`,
      // The song id identifies the response; `prompt_id` identifies the prompt it answered. Retraction
      // needs the response, because that is what the verdict is about.
      sourceId: String(req.params.id),
      reasons,
      // `learn` is left to the aggregator: a verdict always teaches the *listener's own* profile (there
      // is nothing to wait for - it is their taste), while reaching a market's weights needs a market
      // and agreement. A Create-tab song has no market, so its verdict simply stops at the profile.
      //
      // `edition` and `promptId` are the soft-tuning loop's provenance: a verdict is trainable evidence
      // for the edition that produced the response, and a held-out set has to be split by prompt.
      edition: typeof params.edition === 'number' || typeof params.edition === 'string' ? String(params.edition) : undefined,
      promptId: song.rows[0]?.prompt_id ? String(song.rows[0].prompt_id) : undefined,
      // A render made for a listening test is evidence about two editions, not material to train on: the
      // harness tags those jobs, and the tag travels with the verdict so the corpus can exclude it.
      role: params.renderRole === 'evaluation' ? 'evaluation' : undefined,
      features: {
        genre: typeof params.primaryGenre === 'string' ? params.primaryGenre : undefined,
        bpm: typeof params.bpm === 'number' ? params.bpm : undefined,
        keyScale: typeof params.keyScale === 'string' ? params.keyScale : undefined,
        style: typeof params.style === 'string' ? params.style : undefined,
        agent: typeof params.lyricAgent === 'string' ? params.lyricAgent : undefined,
        subject: typeof params.lyricSubject === 'string' ? params.lyricSubject : undefined,
        language:
          typeof params.lyricLanguage === 'string'
            ? params.lyricLanguage
            : typeof params.vocalLanguage === 'string'
              ? params.vocalLanguage
              : undefined,
        themes,
      },
    });

    res.json({
      verdict,
      liked: verdict === 'like',
      disliked: verdict === 'dislike',
      likeCount: Number(counts.rows[0]?.like_count ?? 0),
      promptId: song.rows[0]?.prompt_id ?? null,
      market,
      learning,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Song feedback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * Another take: the listener rejected this response to their own prompt and wants a different one.
 *
 * This is what makes a hard no *do* something. The verdict was theirs and the loop remembers it
 * (Layer U's profile); this turns it into a different render, under one rule: only the things the loop
 * chose may change. A tempo band, a key, a production tag, a writing style - those were drawn for the
 * listener. The words of a prompt they typed are not, and are never rewritten here.
 *
 * The chain is recorded (`retryOf`, `retryRoot`, `retryNote`, `retryExcludedSeeds`) so the next retry
 * knows every seed already heard, and so "why is this different from what I asked for?" is answerable
 * from the song itself rather than by comparing two renders by ear.
 *
 * `dryRun` returns the decision without creating a job: that is how the decision is inspected - and
 * tested - without spending a GPU render on it.
 */
router.post('/:id/retry', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = (req.body ?? {}) as { reasons?: unknown; dryRun?: unknown };
    const song = await pool.query('SELECT id, prompt_id, generation_params FROM songs WHERE id = $1', [
      req.params.id,
    ]);
    const row = song.rows[0];
    if (!row) {
      res.status(404).json({ error: 'song not found' });
      return;
    }
    const previous = (() => {
      const raw = row.generation_params;
      if (typeof raw !== 'string' || raw.length === 0) return {} as Record<string, unknown>;
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return {} as Record<string, unknown>;
      }
    })();
    const promptId = row.prompt_id ? String(row.prompt_id) : null;
    const root = typeof previous.retryRoot === 'string' ? previous.retryRoot : promptId;

    // A retry reuses the stored request verbatim, so a song without one (a row from before params were
    // stored, or a song whose generation failed before any were) cannot be retried. Say so rather than
    // queueing a job the engine will reject.
    if (typeof previous.style !== 'string' || previous.style.length === 0) {
      res.status(409).json({
        error: 'this song has no stored request to retry from',
        hint: 'songs created before generation params were recorded cannot be retried',
      });
      return;
    }

    // Everything this listener has already rejected on this prompt and its retries: those seeds must
    // never be served again, because a retry that returns the refused take is not a retry.
    // Placeholders are bound in the order they appear (see db/pool.ts), so user, prompt, root.
    const chain = await pool.query(
      `SELECT s.generation_params, f.reasons
       FROM songs s
       JOIN song_feedback f ON f.song_id = s.id AND f.user_id = $1 AND f.verdict = 'dislike'
       WHERE s.prompt_id = $2 OR json_extract(s.generation_params, '$.retryRoot') = $3`,
      [req.user!.id, root, root],
    );
    const excludeSeeds: number[] = [];
    const reasonsFromVerdicts: string[] = [];
    for (const entry of chain.rows) {
      try {
        const params = JSON.parse(String(entry.generation_params)) as { seed?: number };
        if (typeof params.seed === 'number' && params.seed >= 0) excludeSeeds.push(params.seed);
      } catch {
        // A row whose params cannot be read simply contributes no seed to avoid.
      }
      if (entry.reasons) {
        try {
          const list = JSON.parse(String(entry.reasons)) as unknown;
          if (Array.isArray(list)) reasonsFromVerdicts.push(...list.map(String));
        } catch {
          // Reasons are advisory here: an unreadable list means an unattributed complaint.
        }
      }
    }
    const explicit = Array.isArray(body.reasons)
      ? body.reasons.filter((reason): reason is string => typeof reason === 'string')
      : [];

    // This song's *own* verdict, always, before the chain: a retry is by definition a response to being
    // refused, so the take being retried is excluded even when the chain cannot be traced (songs from
    // before `prompt_id` was recorded have no chain, and their seed would otherwise be served again -
    // which is exactly the thing a retry must never do). Its reasons count for the same reason: a
    // reason list that went missing would turn a specific complaint into a blanket one.
    const own = await pool.query(
      'SELECT verdict, reasons FROM song_feedback WHERE song_id = $1 AND user_id = $2',
      [req.params.id, req.user!.id],
    );
    const ownReasons: string[] = (() => {
      const raw = own.rows[0]?.reasons;
      if (!raw) return [];
      try {
        const list = JSON.parse(String(raw)) as unknown;
        return Array.isArray(list) ? list.map(String) : [];
      } catch {
        return [];
      }
    })();
    const ownSeed = typeof previous.seed === 'number' && previous.seed >= 0 ? previous.seed : null;
    if (ownSeed !== null) excludeSeeds.push(ownSeed);
    const reasons = [...new Set([...explicit, ...ownReasons, ...reasonsFromVerdicts])];

    // A take rendered from a random seed does not record the seed it actually used, so it cannot be
    // avoided by name. The retry still gets a fresh explicit seed; the limit is stated in `note`.
    const seedWasRandom = previous.randomSeed === true || (typeof previous.seed === 'number' && previous.seed < 0);

    const attempt = await pool.query(
      `SELECT COUNT(DISTINCT prompt_id) AS n FROM songs
       WHERE prompt_id = $1 OR json_extract(generation_params, '$.retryRoot') = $2`,
      [root, root],
    );
    const attemptNumber = Math.max(0, Number(attempt.rows[0]?.n ?? 1) - 1);

    const planned = await planNextTake({
      rater: `app:${req.user!.id}`,
      reasons,
      previous,
      excludeSeeds,
      attempt: attemptNumber,
    });
    const plan = planned.plan;
    // Fall back to a fresh seed when the aggregator is not running: a retry must still be a retry.
    const excluded = new Set(excludeSeeds);
    let seed = plan?.seed;
    if (seed === undefined || excluded.has(seed)) {
      seed = Math.floor(Math.random() * 4294967295);
      while (excluded.has(seed)) seed = Math.floor(Math.random() * 4294967295);
    }
    const note = [...(plan?.note ?? ['a new seed'])];
    if (seedWasRandom && ownSeed === null) {
      note.push(
        'this take used a random seed, so its exact seed could not be avoided; the new one is explicit',
      );
    }
    if (promptId === null) {
      note.push('this song predates prompt tracking, so only its own take could be excluded');
    }
    if (!planned.ok) {
      note.push(`the loop could not be asked why (${planned.error}); the seed is the only change`);
    }

    const params: Record<string, unknown> = {
      ...previous,
      seed,
      randomSeed: false,
      retryOf: promptId,
      retryRoot: root,
      retryAttempt: attemptNumber + 1,
      retryReasons: reasons,
      retryExcludedSeeds: [...excluded],
      retryNote: note,
      retryUnactionable: plan?.unactionable ?? [],
    };
    for (const key of ['bpm', 'keyScale', 'style'] as const) {
      const value = plan?.patch?.[key];
      if (value !== undefined) params[key] = value;
    }

    // A different writing style needs different words, or the song claims a style its lyrics do not
    // follow. The loop rewrites them (its own lyric writer). If that is unavailable the original words
    // stay and the retry says so, rather than mislabelling them.
    let lyricsRerolled = false;
    const conceptId = typeof previous.conceptId === 'string' ? previous.conceptId : null;
    if (plan?.patch?.lyricAgent && conceptId) {
      const reroll = await rerollConceptLyrics(conceptId, plan.patch.lyricAgent, seed);
      if (reroll.ok && reroll.lyrics) {
        params.lyrics = reroll.lyrics;
        params.lyricAgent = plan.patch.lyricAgent;
        lyricsRerolled = true;
        note.push(`the words were rewritten by ${plan.patch.lyricAgent}`);
      } else {
        note.push(`the writing style was NOT changed (${reroll.error ?? 'no lyrics returned'})`);
      }
    } else if (plan?.patch?.lyricAgent) {
      note.push('the writing style was not changed: this prompt has no design behind it to rewrite the words');
    }

    const payload = {
      promptId,
      root,
      attempt: attemptNumber + 1,
      reasons,
      excludedSeeds: [...excluded],
      seed,
      changes: {
        bpm: plan?.patch?.bpm ?? null,
        keyScale: plan?.patch?.keyScale ?? null,
        style: plan?.patch?.style ?? null,
        lyricAgent: lyricsRerolled ? plan.patch.lyricAgent : null,
      },
      note,
      unactionable: plan?.unactionable ?? [],
      machineDesigned: plan?.machineDesigned ?? false,
      learnerReachable: planned.ok,
    };

    if (body.dryRun === true) {
      res.json({ dryRun: true, songId: String(req.params.id), ...payload, error: planned.error ?? null });
      return;
    }

    // The stored request *is* a GenerationParams - this app wrote it - but it is persisted as JSON, so
    // the only way to get the type back is through `unknown`. The guard above has already established
    // that the required fields survived.
    const created = await createGenerationJob(req.user!.id, params as unknown as GenerationParams);
    res.json({ jobId: created.jobId, status: 'queued', ...payload });
  } catch (error) {
    console.error('Song retry error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * This listener's own profile: what they want more and less of, and what to do with it.
 *
 * Exposed so the client can use it honestly - the response carries how many verdicts are behind it, so
 * a surface can decide for itself that one click is not yet a taste. A failure to reach the loop is
 * reported rather than raised: a profile is an enhancement, and the app works without one.
 */
router.get('/profile/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const market = req.query.market ? String(req.query.market).toLowerCase() : undefined;
    const result = await fetchProfile(`app:${req.user!.id}`, market);
    res.json({
      ok: result.ok,
      error: result.error ?? null,
      profile: result.profile,
      /** Below this, a surface should treat the profile as a hint rather than a preference. */
      confident: (result.profile?.verdicts ?? 0) >= 2,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** This user's verdict on this response, and the prompt it answered. */
router.get('/:id/feedback', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Placeholders are bound in the order they appear in the SQL, not by their numbers: the pool
    // rewrites every `$n` to `?` (see db/pool.ts), so `$2` before `$1` swaps the two values. Hence
    // the user first (it appears first, in the join) and the song second.
    const result = await pool.query(
      `SELECT f.verdict, f.reasons, f.updated_at, s.prompt_id
       FROM songs s
       LEFT JOIN song_feedback f ON f.song_id = s.id AND f.user_id = $1
       WHERE s.id = $2`,
      [req.user!.id, req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'song not found' });
      return;
    }
    const row = result.rows[0];
    res.json({
      verdict: row.verdict ?? null,
      reasons: row.reasons ? JSON.parse(String(row.reasons)) : [],
      updatedAt: row.updated_at ?? null,
      promptId: row.prompt_id ?? null,
    });
  } catch (error) {
    console.error('Get song feedback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** This user's verdicts (and any reasons), so the buttons render correctly after a reload. */
router.get('/feedback/mine', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT song_id, verdict, reasons FROM song_feedback WHERE user_id = $1',
      [req.user!.id],
    );
    const verdicts: Record<string, { verdict: string; reasons: string[] }> = {};
    for (const row of result.rows) {
      verdicts[String(row.song_id)] = {
        verdict: String(row.verdict),
        reasons: row.reasons ? JSON.parse(String(row.reasons)) : [],
      };
    }
    res.json({ verdicts });
  } catch (error) {
    console.error('List song feedback error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get liked songs
router.get('/liked/list', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.title, s.lyrics, s.style, s.cover_url, s.audio_url,
              s.duration, s.tags, s.like_count, s.created_at, s.is_public,
              COALESCE(u.username, 'Anonymous') as creator, s.generation_params
       FROM liked_songs ls
       JOIN songs s ON ls.song_id = s.id
       LEFT JOIN users u ON s.user_id = u.id
       WHERE ls.user_id = $1
       ORDER BY ls.liked_at DESC`,
      [req.user!.id]
    );

    const songs = await Promise.all(
      result.rows.map(async (row) => ({
        ...row,
        audio_url: await resolveAccessibleAudioUrl(row.audio_url, row.is_public),
      }))
    );

    res.json({ songs });
  } catch (error) {
    console.error('Get liked songs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Toggle song privacy
router.patch('/:id/privacy', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const check = await pool.query('SELECT user_id, is_public FROM songs WHERE id = $1', [req.params.id]);
    if (check.rows.length === 0) {
      res.status(404).json({ error: 'Song not found' });
      return;
    }
    if (check.rows[0].user_id !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const newPublicState = !check.rows[0].is_public;

    await pool.query('UPDATE songs SET is_public = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
      newPublicState,
      req.params.id,
    ]);

    res.json({ isPublic: newPublicState });
  } catch (error) {
    console.error('Toggle privacy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Track song play
router.post('/:id/play', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `UPDATE songs
       SET view_count = COALESCE(view_count, 0) + 1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING view_count`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Song not found' });
      return;
    }

    res.json({ viewCount: result.rows[0].view_count });
  } catch (error) {
    console.error('Track play error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get comments for a song
router.get('/:id/comments', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.content, c.created_at, u.username, u.id as user_id, u.avatar_url
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.song_id = $1
       ORDER BY c.created_at DESC`,
      [req.params.id]
    );

    res.json({ comments: result.rows });
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add comment to a song
router.post('/:id/comments', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      res.status(400).json({ error: 'Comment content is required' });
      return;
    }

    // Check if song exists and is public
    const songCheck = await pool.query('SELECT is_public FROM songs WHERE id = $1', [req.params.id]);
    if (songCheck.rows.length === 0) {
      res.status(404).json({ error: 'Song not found' });
      return;
    }
    if (!songCheck.rows[0].is_public) {
      res.status(403).json({ error: 'Cannot comment on private songs' });
      return;
    }

    const result = await pool.query(
      `INSERT INTO comments (song_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, content, created_at`,
      [req.params.id, req.user!.id, content.trim()]
    );

    const comment = {
      ...result.rows[0],
      username: req.user!.username,
      user_id: req.user!.id,
    };

    res.status(201).json({ comment });
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete comment
router.delete('/comments/:commentId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const check = await pool.query('SELECT user_id FROM comments WHERE id = $1', [req.params.commentId]);
    if (check.rows.length === 0) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }
    if (check.rows[0].user_id !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    await pool.query('DELETE FROM comments WHERE id = $1', [req.params.commentId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
