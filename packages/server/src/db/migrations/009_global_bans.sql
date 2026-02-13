-- Global account bans: blocks specific DIDs from using the service entirely.
-- The real enforcement is via an in-memory Set loaded at startup; this table
-- is the durable backing store.

CREATE TABLE IF NOT EXISTS global_bans (
  did        TEXT PRIMARY KEY,
  handle     TEXT,
  reason     TEXT,
  added_by   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
