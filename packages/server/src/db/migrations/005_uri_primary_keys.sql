-- Migration 005: URI primary keys + generic records table
-- ATProto convention: records are uniquely identified by AT-URI.
-- Switches rooms, messages, and room_allowlist PKs from rkey to URI.
-- Foreign keys must be dropped and recreated since they depend on the PK index.

-- Generic records table: universal audit trail for all ATProto records
CREATE TABLE IF NOT EXISTS records (
  uri         TEXT PRIMARY KEY,
  cid         TEXT,
  did         TEXT NOT NULL,
  collection  TEXT NOT NULL,
  json        JSONB NOT NULL,
  indexed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_records_did ON records(did);
CREATE INDEX IF NOT EXISTS idx_records_collection ON records(collection);

-- Rooms: PK id → uri
-- Step 1: Add UNIQUE on id so FKs can be re-pointed after PK swap
DO $$ BEGIN
  ALTER TABLE rooms ADD CONSTRAINT rooms_id_unique UNIQUE (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 2: Drop all FKs that depend on rooms_pkey
DO $$ BEGIN
  ALTER TABLE messages DROP CONSTRAINT messages_room_id_fkey;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE mod_actions DROP CONSTRAINT mod_actions_room_id_fkey;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE room_roles DROP CONSTRAINT room_roles_room_id_fkey;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE room_allowlist DROP CONSTRAINT room_allowlist_room_id_fkey;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Step 3: Swap PK from id to uri
DO $$ BEGIN
  ALTER TABLE rooms DROP CONSTRAINT rooms_pkey;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE rooms DROP CONSTRAINT rooms_uri_key;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE rooms ADD PRIMARY KEY (uri);
EXCEPTION WHEN duplicate_object OR invalid_table_definition THEN NULL;
END $$;

-- Step 4: Re-create FKs referencing rooms(id) via UNIQUE constraint
DO $$ BEGIN
  ALTER TABLE messages ADD CONSTRAINT messages_room_id_fkey
    FOREIGN KEY (room_id) REFERENCES rooms(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE mod_actions ADD CONSTRAINT mod_actions_room_id_fkey
    FOREIGN KEY (room_id) REFERENCES rooms(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE room_roles ADD CONSTRAINT room_roles_room_id_fkey
    FOREIGN KEY (room_id) REFERENCES rooms(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE room_allowlist ADD CONSTRAINT room_allowlist_room_id_fkey
    FOREIGN KEY (room_id) REFERENCES rooms(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Messages: PK id → uri
DO $$ BEGIN
  ALTER TABLE messages ADD CONSTRAINT messages_id_unique UNIQUE (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE messages DROP CONSTRAINT messages_pkey;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE messages DROP CONSTRAINT messages_uri_key;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE messages ADD PRIMARY KEY (uri);
EXCEPTION WHEN duplicate_object OR invalid_table_definition THEN NULL;
END $$;

-- Room allowlist: PK id → uri
DO $$ BEGIN
  ALTER TABLE room_allowlist ADD CONSTRAINT room_allowlist_id_unique UNIQUE (id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE room_allowlist DROP CONSTRAINT room_allowlist_pkey;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE room_allowlist DROP CONSTRAINT room_allowlist_uri_key;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE room_allowlist ADD PRIMARY KEY (uri);
EXCEPTION WHEN duplicate_object OR invalid_table_definition THEN NULL;
END $$;
