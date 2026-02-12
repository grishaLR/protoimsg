-- Persisted presence preferences so visibility settings survive server restarts.
-- The in-memory PresenceTracker is the source of truth for ephemeral online/offline
-- status, but this table stores the last-known visibleTo + awayMessage from ATProto
-- presence records indexed via Jetstream.

CREATE TABLE IF NOT EXISTS user_presence (
  did          TEXT PRIMARY KEY,
  status       TEXT NOT NULL DEFAULT 'offline',
  visible_to   TEXT NOT NULL DEFAULT 'no-one',
  away_message TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  indexed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_presence_updated ON user_presence (updated_at);
