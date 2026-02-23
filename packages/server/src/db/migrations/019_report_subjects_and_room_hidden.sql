-- Allow content reports that don't target a specific user (rooms, messages)
ALTER TABLE mod_actions ALTER COLUMN subject_did DROP NOT NULL;

-- URI of the reported room or message (AT-URI)
ALTER TABLE mod_actions ADD COLUMN IF NOT EXISTS subject_uri TEXT;

-- Admin toggle to hide a room from the directory
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;
