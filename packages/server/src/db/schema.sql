-- Chatmosphere database schema

-- rooms: aggregated from firehose room records
CREATE TABLE IF NOT EXISTS rooms (
  id          TEXT PRIMARY KEY,       -- AT-URI rkey
  uri         TEXT UNIQUE NOT NULL,   -- full AT-URI
  did         TEXT NOT NULL,          -- creator DID
  name        TEXT NOT NULL,
  description TEXT,
  purpose     TEXT NOT NULL DEFAULT 'discussion',
  visibility  TEXT NOT NULL DEFAULT 'public',
  min_account_age_days INTEGER DEFAULT 0,
  slow_mode_seconds    INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL,
  indexed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rooms_visibility ON rooms(visibility);
CREATE INDEX IF NOT EXISTS idx_rooms_did ON rooms(did);

-- messages: aggregated from firehose message records
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,       -- AT-URI rkey
  uri         TEXT UNIQUE NOT NULL,
  did         TEXT NOT NULL,          -- sender DID
  room_id     TEXT NOT NULL REFERENCES rooms(id),
  text        TEXT NOT NULL,
  reply_to    TEXT,                   -- AT-URI of parent message
  created_at  TIMESTAMPTZ NOT NULL,
  indexed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_did ON messages(did);

-- mod_actions: bans, reports, etc.
CREATE TABLE IF NOT EXISTS mod_actions (
  id          SERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id),
  actor_did   TEXT NOT NULL,
  subject_did TEXT NOT NULL,
  action      TEXT NOT NULL,          -- 'ban', 'report', 'mute'
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mod_actions_room ON mod_actions(room_id);
CREATE INDEX IF NOT EXISTS idx_mod_actions_subject ON mod_actions(subject_did);

-- firehose_cursor: resume position
CREATE TABLE IF NOT EXISTS firehose_cursor (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  cursor      BIGINT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
