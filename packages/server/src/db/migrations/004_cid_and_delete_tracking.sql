-- Migration 004: CID storage + delete tracking
-- Adds CID columns for ATProto record versioning.
-- Adds URI to mod_actions so ban deletions can be traced.

-- CID columns (idempotent)
DO $$ BEGIN
  ALTER TABLE rooms ADD COLUMN cid TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE messages ADD COLUMN cid TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE room_roles ADD COLUMN cid TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE room_allowlist ADD COLUMN cid TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- mod_actions: add URI for delete tracking (nullable for existing rows)
DO $$ BEGIN
  ALTER TABLE mod_actions ADD COLUMN uri TEXT UNIQUE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
