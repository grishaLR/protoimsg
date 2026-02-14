import type { Sql } from '../db/client.js';

export interface CachedTranslation {
  textHash: string;
  targetLang: string;
  sourceLang: string;
  translated: string;
}

export async function getCachedTranslations(
  sql: Sql,
  textHashes: string[],
  targetLang: string,
): Promise<CachedTranslation[]> {
  if (textHashes.length === 0) return [];

  const rows = await sql`
    SELECT text_hash, target_lang, source_lang, translated
    FROM translation_cache
    WHERE text_hash = ANY(${textHashes})
      AND target_lang = ${targetLang}
  `;

  return rows.map((r) => ({
    textHash: r.text_hash as string,
    targetLang: r.target_lang as string,
    sourceLang: r.source_lang as string,
    translated: r.translated as string,
  }));
}

export async function insertTranslations(
  sql: Sql,
  rows: Array<{
    textHash: string;
    targetLang: string;
    sourceLang: string;
    translated: string;
  }>,
): Promise<void> {
  if (rows.length === 0) return;

  await sql`
    INSERT INTO translation_cache ${sql(
      rows.map((r) => ({
        text_hash: r.textHash,
        target_lang: r.targetLang,
        source_lang: r.sourceLang,
        translated: r.translated,
      })),
    )}
    ON CONFLICT (text_hash, target_lang) DO NOTHING
  `;
}
