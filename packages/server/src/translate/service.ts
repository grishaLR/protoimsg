import { createHash } from 'crypto';
import { createLogger } from '../logger.js';
import { getCachedTranslations, insertTranslations } from './queries.js';
import {
  detectLanguage,
  floresToIso,
  isoToFlores,
  NLLB_ONLY_CODES,
  LIBRE_CODES,
} from './lang-codes.js';
import type { Sql } from '../db/client.js';
import { incTranslateRequest, observeTranslateDuration } from '../metrics.js';

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

interface NllbTranslateResponse {
  translation: string[];
}

interface TranslateServiceConfig {
  sql: Sql;
  libreTranslateUrl?: string;
  nllbUrl?: string;
  nllbApiKey?: string;
}

/**
 * Returns the list of supported ISO language codes based on which backends are configured.
 * - LibreTranslate configured → LIBRE_CODES
 * - NLLB configured → NLLB_ONLY_CODES (and LIBRE_CODES too if no LibreTranslate)
 * - Both → union of both sets
 */
export function getSupportedLanguages(libreUrl?: string, nllbUrl?: string): string[] {
  const codes = new Set<string>();

  if (libreUrl) {
    for (const c of LIBRE_CODES) codes.add(c);
  }

  if (nllbUrl) {
    for (const c of NLLB_ONLY_CODES) codes.add(c);
    // If no LibreTranslate, NLLB handles everything it knows
    if (!libreUrl) {
      for (const c of LIBRE_CODES) codes.add(c);
    }
  }

  return [...codes];
}

export function createTranslateService(config: TranslateServiceConfig): TranslateService {
  const { sql, libreTranslateUrl: libreUrl, nllbUrl, nllbApiKey } = config;

  /**
   * Batch LibreTranslate — sends all texts in one request using array `q`.
   * Falls back to per-text requests if the batch response format is unexpected.
   */
  async function translateViaLibre(
    uncached: UncachedItem[],
    targetLang: string,
  ): Promise<{
    results: Map<string, TranslationResult>;
    toInsert: Array<{
      textHash: string;
      targetLang: string;
      sourceLang: string;
      translated: string;
    }>;
  }> {
    const results = new Map<string, TranslationResult>();
    const toInsert: Array<{
      textHash: string;
      targetLang: string;
      sourceLang: string;
      translated: string;
    }> = [];

    try {
      const start = performance.now();
      const res = await fetch(`${libreUrl}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: uncached.map((i) => i.text),
          source: 'auto',
          target: targetLang,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      observeTranslateDuration('libre', (performance.now() - start) / 1000);

      if (!res.ok) {
        incTranslateRequest('libre', 'error');
        log.warn({ status: res.status }, 'LibreTranslate batch error, returning originals');
        for (const item of uncached) {
          results.set(item.hash, { text: item.text, translated: item.text, sourceLang: 'unknown' });
        }
        return { results, toInsert };
      }

      const data = (await res.json()) as {
        translatedText: string | string[];
        detectedLanguage?: { language: string } | Array<{ language: string }>;
      };

      const translations = Array.isArray(data.translatedText)
        ? data.translatedText
        : [data.translatedText];
      const detections = Array.isArray(data.detectedLanguage)
        ? data.detectedLanguage
        : data.detectedLanguage
          ? [data.detectedLanguage]
          : [];

      incTranslateRequest('libre', 'success');
      for (let i = 0; i < uncached.length; i++) {
        const item = uncached[i];
        if (!item) continue;
        const translated = translations[i] ?? item.text;
        const sourceLang = detections[i]?.language ?? detectLanguage(item.text);

        results.set(item.hash, { text: item.text, translated, sourceLang });

        if (sourceLang !== 'unknown') {
          toInsert.push({ textHash: item.hash, targetLang, sourceLang, translated });
        }
      }
    } catch (err) {
      incTranslateRequest('libre', 'error');
      log.warn({ err, count: uncached.length }, 'LibreTranslate batch request failed');
      for (const item of uncached) {
        results.set(item.hash, { text: item.text, translated: item.text, sourceLang: 'unknown' });
      }
    }

    return { results, toInsert };
  }

  /**
   * Batch NLLB translation — groups texts by detected source language, sends
   * one request per group. The NLLB server handles arrays natively, so
   * 30 texts in the same language = 1 HTTP request instead of 30.
   */
  async function translateViaNllb(
    uncached: UncachedItem[],
    targetLang: string,
  ): Promise<{
    results: Map<string, TranslationResult>;
    toInsert: Array<{
      textHash: string;
      targetLang: string;
      sourceLang: string;
      translated: string;
    }>;
  }> {
    const results = new Map<string, TranslationResult>();
    const toInsert: Array<{
      textHash: string;
      targetLang: string;
      sourceLang: string;
      translated: string;
    }> = [];

    const targetFlores = isoToFlores(targetLang);
    if (!targetFlores) {
      log.warn({ targetLang }, 'Unsupported target language for NLLB');
      for (const item of uncached) {
        results.set(item.hash, { text: item.text, translated: item.text, sourceLang: 'unknown' });
      }
      return { results, toInsert };
    }

    // Group texts by detected source language
    const groups = new Map<string, UncachedItem[]>();
    for (const item of uncached) {
      const sourceLang = detectLanguage(item.text);

      // Skip items already in the target language
      if (sourceLang === targetLang) {
        results.set(item.hash, { text: item.text, translated: item.text, sourceLang });
        continue;
      }

      const group = groups.get(sourceLang) ?? [];
      group.push(item);
      groups.set(sourceLang, group);
    }

    // One request per source language group
    const nllbHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (nllbApiKey) nllbHeaders['Authorization'] = `Bearer ${nllbApiKey}`;

    // Process groups sequentially — NLLB is single-threaded, so concurrent
    // requests just queue up and risk timeouts. Sequential ensures order and
    // prevents overloading the server.
    for (const [sourceLang, items] of groups) {
      const srcFlores = isoToFlores(sourceLang) ?? (isoToFlores('en') as string);
      const srcIso = floresToIso(srcFlores) ?? 'unknown';

      try {
        const start = performance.now();
        const res = await fetch(`${nllbUrl}/translate`, {
          method: 'POST',
          headers: nllbHeaders,
          body: JSON.stringify({
            source: items.map((i) => i.text),
            src_lang: srcFlores,
            tgt_lang: targetFlores,
          }),
          signal: AbortSignal.timeout(30_000),
        });
        observeTranslateDuration('nllb', (performance.now() - start) / 1000);

        if (!res.ok) {
          incTranslateRequest('nllb', 'error');
          log.warn({ status: res.status, sourceLang, count: items.length }, 'NLLB batch error');
          for (const item of items) {
            results.set(item.hash, {
              text: item.text,
              translated: item.text,
              sourceLang: 'unknown',
            });
          }
          continue;
        }

        const data = (await res.json()) as NllbTranslateResponse;
        incTranslateRequest('nllb', 'success');
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (!item) continue;
          const translated = data.translation[i] ?? item.text;
          results.set(item.hash, { text: item.text, translated, sourceLang: srcIso });
          toInsert.push({ textHash: item.hash, targetLang, sourceLang: srcIso, translated });
        }
      } catch (err) {
        incTranslateRequest('nllb', 'error');
        log.warn({ err, sourceLang, count: items.length }, 'NLLB batch request failed');
        for (const item of items) {
          results.set(item.hash, { text: item.text, translated: item.text, sourceLang: 'unknown' });
        }
      }
    }

    return { results, toInsert };
  }

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
      // Route to the correct backend
      const useNllb = NLLB_ONLY_CODES.has(targetLang) || (!libreUrl && nllbUrl);
      const useLibre = !NLLB_ONLY_CODES.has(targetLang) && libreUrl;

      let translated: {
        results: Map<string, TranslationResult>;
        toInsert: Array<{
          textHash: string;
          targetLang: string;
          sourceLang: string;
          translated: string;
        }>;
      };

      if (useNllb && nllbUrl) {
        translated = await translateViaNllb(uncached, targetLang);
      } else if (useLibre) {
        translated = await translateViaLibre(uncached, targetLang);
      } else {
        // No backend available for this language — return originals
        const results = new Map<string, TranslationResult>();
        for (const item of uncached) {
          results.set(item.hash, {
            text: item.text,
            translated: item.text,
            sourceLang: 'unknown',
          });
        }
        return results;
      }

      // Batch-insert new translations into shared cache
      if (translated.toInsert.length > 0) {
        try {
          await insertTranslations(sql, translated.toInsert);
        } catch (err) {
          log.error({ err }, 'Failed to insert translations into cache');
        }
      }

      return translated.results;
    },

    async isAvailable(): Promise<boolean> {
      const checks: Promise<boolean>[] = [];

      if (libreUrl) {
        checks.push(
          fetch(`${libreUrl}/languages`, { signal: AbortSignal.timeout(3000) })
            .then((r) => r.ok)
            .catch(() => false),
        );
      }

      if (nllbUrl) {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (nllbApiKey) headers['Authorization'] = `Bearer ${nllbApiKey}`;
        checks.push(
          fetch(`${nllbUrl}/health`, {
            headers,
            signal: AbortSignal.timeout(5000),
          })
            .then((r) => r.ok)
            .catch(() => false),
        );
      }

      if (checks.length === 0) return false;
      const results = await Promise.all(checks);
      return results.some(Boolean);
    },
  };
}
