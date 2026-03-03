-- Push notification device tokens
CREATE TABLE IF NOT EXISTS device_tokens (
  id            BIGSERIAL PRIMARY KEY,
  did           TEXT NOT NULL,
  token         TEXT NOT NULL,
  platform      TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_device_token UNIQUE (token)
);

CREATE INDEX idx_device_tokens_did ON device_tokens (did);
