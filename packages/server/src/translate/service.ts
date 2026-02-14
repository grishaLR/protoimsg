import { createHash } from 'crypto';
import { createLogger } from '../logger.js';
import { getCachedTranslations, insertTranslations } from './queries.js';
import type { Sql } from '../db/client.js';

const log = createLogger('translate');

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

interface TranslationResult {
  text: string;
  translated: string;
  sourceLang: string;
}

interface UncachedItem {
  text: string;
  hash: string;
}

interface CheckCacheResult {
  cached: Map<string, TranslationResult>;
  uncached: UncachedItem[];
  hashMap: Map<string, string>;
}

export interface TranslateService {
  checkCache(texts: string[], targetLang: string): Promise<CheckCacheResult>;
  translateUncached(
    uncached: UncachedItem[],
    targetLang: string,
  ): Promise<Map<string, TranslationResult>>;
  isAvailable(): Promise<boolean>;
}

export function createTranslateService(sql: Sql, libreTranslateUrl: string): TranslateService {
  return {
    async checkCache(texts: string[], targetLang: string): Promise<CheckCacheResult> {
      const hashMap = new Map<string, string>();
      const seen = new Set<string>();
      const uniqueHashes: string[] = [];

      for (const text of texts) {
        const h = hashText(text);
        hashMap.set(text, h);
        if (!seen.has(h)) {
          seen.add(h);
          uniqueHashes.push(h);
        }
      }

      const rows = await getCachedTranslations(sql, uniqueHashes, targetLang);
      const cached = new Map<string, TranslationResult>();
      const cachedHashes = new Set<string>();

      for (const row of rows) {
        cachedHashes.add(row.textHash);
        cached.set(row.textHash, {
          text: '', // original text filled by router
          translated: row.translated,
          sourceLang: row.sourceLang,
        });
      }

      const uncached: UncachedItem[] = [];
      const uncachedSeen = new Set<string>();
      for (const text of texts) {
        const h = hashMap.get(text) ?? hashText(text);
        if (!cachedHashes.has(h) && !uncachedSeen.has(h)) {
          uncachedSeen.add(h);
          uncached.push({ text, hash: h });
        }
      }

      return { cached, uncached, hashMap };
    },

    async translateUncached(
      uncached: UncachedItem[],
      targetLang: string,
    ): Promise<Map<string, TranslationResult>> {
      const results = new Map<string, TranslationResult>();
      const toInsert: Array<{
        textHash: string;
        targetLang: string;
        sourceLang: string;
        translated: string;
      }> = [];

      // Translate sequentially — LibreTranslate is single-threaded
      for (const item of uncached) {
        try {
          const res = await fetch(`${libreTranslateUrl}/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              q: item.text,
              source: 'auto',
              target: targetLang,
            }),
            signal: AbortSignal.timeout(15_000),
          });

          if (!res.ok) {
            log.warn(
              { status: res.status, hash: item.hash },
              'LibreTranslate error, returning original',
            );
            results.set(item.hash, {
              text: item.text,
              translated: item.text,
              sourceLang: 'unknown',
            });
            continue;
          }

          const data = (await res.json()) as {
            translatedText: string;
            detectedLanguage?: { language: string };
          };

          const sourceLang = data.detectedLanguage?.language ?? 'unknown';
          const result: TranslationResult = {
            text: item.text,
            translated: data.translatedText,
            sourceLang,
          };

          results.set(item.hash, result);

          // Only cache when language was properly detected — 'unknown' means
          // LibreTranslate couldn't process it (models not loaded, degraded response, etc.)
          if (sourceLang !== 'unknown') {
            toInsert.push({
              textHash: item.hash,
              targetLang,
              sourceLang,
              translated: data.translatedText,
            });
          }
        } catch (err) {
          log.warn({ err, hash: item.hash }, 'LibreTranslate request failed, returning original');
          results.set(item.hash, {
            text: item.text,
            translated: item.text,
            sourceLang: 'unknown',
          });
        }
      }

      // Batch-insert new translations
      if (toInsert.length > 0) {
        try {
          await insertTranslations(sql, toInsert);
        } catch (err) {
          log.error({ err }, 'Failed to insert translations into cache');
        }
      }

      return results;
    },

    async isAvailable(): Promise<boolean> {
      try {
        const res = await fetch(`${libreTranslateUrl}/languages`, {
          signal: AbortSignal.timeout(3000),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
