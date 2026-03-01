import { Router } from 'express';
import { z } from 'zod';
import { ERROR_CODES, USER_AGENT } from '@protoimsg/shared';
import type { RateLimiterStore } from '../moderation/rate-limiter-store.js';

const searchSchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const klipySearchSchema = z.object({
  q: z.string().min(1).max(200),
  per_page: z.coerce.number().int().min(1).max(50).default(24),
  page: z.coerce.number().int().min(1).default(1),
});

interface NormalizedGif {
  id: string;
  title: string;
  previewUrl: string;
  fullUrl: string;
  previewWidth?: string;
  previewHeight?: string;
  source: 'giphy' | 'klipy';
}

// -- Giphy types --

interface GiphyApiGif {
  id: string;
  title: string;
  url: string;
  images: {
    fixed_height: {
      url: string;
      width: string;
      height: string;
    };
    original: {
      url: string;
    };
  };
}

interface GiphyApiResponse {
  data: GiphyApiGif[];
}

// -- Klipy types --

interface KlipyGifFile {
  url: string;
  width: number;
  height: number;
}

interface KlipyGif {
  id: number;
  title: string;
  slug: string;
  file: {
    sm?: { gif?: KlipyGifFile };
    hd?: { gif?: KlipyGifFile };
    md?: { gif?: KlipyGifFile };
    xs?: { gif?: KlipyGifFile };
  };
}

interface KlipyApiResponse {
  result: boolean;
  data: {
    data: KlipyGif[];
    current_page: number;
    per_page: number;
    has_next: boolean;
  };
}

export function gifRouter(
  giphyApiKey: string | null,
  klipyApiKey: string | null,
  rateLimiter: RateLimiterStore,
): Router {
  const router = Router();

  // GET /search — proxy Giphy search
  if (giphyApiKey) {
    const apiKey = giphyApiKey;
    router.get('/search', async (req, res, next) => {
      try {
        const parsed = searchSchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({
            error: 'Invalid request',
            errorCode: ERROR_CODES.INVALID_INPUT,
            details: parsed.error.issues,
          });
          return;
        }

        const did = req.did ?? '';
        const allowed = await rateLimiter.check(did);
        if (!allowed) {
          res.status(429).json({
            error: 'Too many requests',
            errorCode: ERROR_CODES.RATE_LIMITED,
          });
          return;
        }

        const { q, limit, offset } = parsed.data;
        const params = new URLSearchParams({
          api_key: apiKey,
          q,
          limit: String(limit),
          offset: String(offset),
          rating: 'pg-13',
        });

        const response = await fetch(`https://api.giphy.com/v1/gifs/search?${params.toString()}`, {
          headers: { 'User-Agent': USER_AGENT },
        });
        if (!response.ok) {
          res.status(502).json({ error: 'Giphy API error' });
          return;
        }

        const body = (await response.json()) as GiphyApiResponse;

        const gifs: NormalizedGif[] = body.data.map((gif) => ({
          id: gif.id,
          title: gif.title,
          previewUrl: gif.images.fixed_height.url,
          fullUrl: gif.images.original.url || gif.images.fixed_height.url,
          previewWidth: gif.images.fixed_height.width,
          previewHeight: gif.images.fixed_height.height,
          source: 'giphy' as const,
        }));

        res.json({ gifs });
      } catch (err) {
        next(err);
      }
    });
  }

  // GET /klipy-search — proxy Klipy search
  if (klipyApiKey) {
    const apiKey = klipyApiKey;
    router.get('/klipy-search', async (req, res, next) => {
      try {
        const parsed = klipySearchSchema.safeParse(req.query);
        if (!parsed.success) {
          res.status(400).json({
            error: 'Invalid request',
            errorCode: ERROR_CODES.INVALID_INPUT,
            details: parsed.error.issues,
          });
          return;
        }

        const did = req.did ?? '';
        const allowed = await rateLimiter.check(did);
        if (!allowed) {
          res.status(429).json({
            error: 'Too many requests',
            errorCode: ERROR_CODES.RATE_LIMITED,
          });
          return;
        }

        const { q, per_page, page } = parsed.data;
        const params = new URLSearchParams({
          q,
          per_page: String(per_page),
          page: String(page),
          content_filter: 'medium',
          customer_id: did,
        });

        const response = await fetch(
          `https://api.klipy.com/api/v1/${apiKey}/gifs/search?${params.toString()}`,
          { headers: { 'User-Agent': USER_AGENT } },
        );
        if (!response.ok) {
          res.status(502).json({ error: 'Klipy API error' });
          return;
        }

        const body = (await response.json()) as KlipyApiResponse;

        const gifs: NormalizedGif[] = body.data.data.map((gif) => ({
          id: String(gif.id),
          title: gif.title,
          previewUrl: gif.file.sm?.gif?.url || gif.file.md?.gif?.url || '',
          fullUrl: gif.file.hd?.gif?.url || gif.file.md?.gif?.url || gif.file.sm?.gif?.url || '',
          previewWidth: String(gif.file.sm?.gif?.width ?? ''),
          previewHeight: String(gif.file.sm?.gif?.height ?? ''),
          source: 'klipy' as const,
        }));

        res.json({ gifs });
      } catch (err) {
        next(err);
      }
    });
  }

  return router;
}
