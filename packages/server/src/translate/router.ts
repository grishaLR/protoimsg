import { Router } from 'express';
import { z } from 'zod';
import { ERROR_CODES } from '@protoimsg/shared';
import type { TranslateService } from './service.js';
import type { RateLimiterStore } from '../moderation/rate-limiter-store.js';

const SUPPORTED_LANGS = [
  'en',
  'es',
  'ru',
  'ar',
  'ga',
  'uk',
  'zh',
  'hi',
  'ja',
  'ko',
  'vi',
  'fr',
  'pt',
  'de',
  'tr',
  'th',
] as const;
const MAX_TEXTS = 30;
const MAX_TEXT_LENGTH = 5000;

const translateSchema = z.object({
  texts: z.array(z.string().max(MAX_TEXT_LENGTH)).min(1).max(MAX_TEXTS),
  targetLang: z.enum(SUPPORTED_LANGS),
});

export function translateRouter(
  translateService: TranslateService,
  translateRateLimiter: RateLimiterStore,
): Router {
  const router = Router();

  // POST / — batch translate
  router.post('/', async (req, res, next) => {
    try {
      const parsed = translateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid request',
          errorCode: ERROR_CODES.INVALID_INPUT,
          details: parsed.error.issues,
        });
        return;
      }

      const { texts, targetLang } = parsed.data;
      const did = req.did ?? '';

      // Filter out empty strings
      const nonEmptyTexts = texts.filter((t) => t.trim().length > 0);
      if (nonEmptyTexts.length === 0) {
        res.json({ translations: [] });
        return;
      }

      // Check cache
      const { cached, uncached, hashMap } = await translateService.checkCache(
        nonEmptyTexts,
        targetLang,
      );

      // Pre-check rate limit — one check per batch request, not per text
      if (uncached.length > 0) {
        const allowed = await translateRateLimiter.check(did);

        if (!allowed) {
          // Return cached results only
          const translations = nonEmptyTexts.map((text) => {
            const hash = hashMap.get(text) ?? '';
            const hit = cached.get(hash);
            if (hit) {
              return { text, translated: hit.translated, sourceLang: hit.sourceLang };
            }
            return { text, translated: text, sourceLang: 'unknown' };
          });

          res.status(429).json({
            translations,
            rateLimited: true,
            errorCode: ERROR_CODES.TRANSLATE_RATE_LIMITED,
          });
          return;
        }
      }

      // Translate uncached items
      const newTranslations =
        uncached.length > 0
          ? await translateService.translateUncached(uncached, targetLang)
          : new Map<string, { text: string; translated: string; sourceLang: string }>();

      // Assemble full response
      const translations = nonEmptyTexts.map((text) => {
        const hash = hashMap.get(text) ?? '';
        const hit = cached.get(hash);
        if (hit) {
          return { text, translated: hit.translated, sourceLang: hit.sourceLang };
        }
        const fresh = newTranslations.get(hash);
        if (fresh) {
          return { text, translated: fresh.translated, sourceLang: fresh.sourceLang };
        }
        return { text, translated: text, sourceLang: 'unknown' };
      });

      res.json({ translations });
    } catch (err) {
      next(err);
    }
  });

  // GET /status — availability check
  router.get('/status', async (_req, res, next) => {
    try {
      const available = await translateService.isAvailable();
      res.json({ available, languages: available ? SUPPORTED_LANGS : [] });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
