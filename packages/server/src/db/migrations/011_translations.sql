CREATE TABLE IF NOT EXISTS translation_cache (
  text_hash   TEXT        NOT NULL,
  target_lang TEXT        NOT NULL,
  source_lang TEXT        NOT NULL,
  translated  TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (text_hash, target_lang)
);

CREATE INDEX IF NOT EXISTS idx_translation_cache_created_at
  ON translation_cache (created_at);
