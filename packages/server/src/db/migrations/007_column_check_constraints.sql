-- Migration 007: Column CHECK constraints
-- Adds database-level guards that complement app-level Zod validation.

-- rooms.visibility: must be one of the allowed values
DO $$ BEGIN
  ALTER TABLE rooms ADD CONSTRAINT chk_rooms_visibility
    CHECK (visibility IN ('public', 'unlisted', 'private'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- rooms.purpose: must be one of the allowed values
DO $$ BEGIN
  ALTER TABLE rooms ADD CONSTRAINT chk_rooms_purpose
    CHECK (purpose IN ('discussion', 'event', 'community', 'support'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- rooms.name: non-empty, max 100 chars
DO $$ BEGIN
  ALTER TABLE rooms ADD CONSTRAINT chk_rooms_name_length
    CHECK (char_length(name) BETWEEN 1 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- rooms.description: max 500 chars (nullable, so only check when present)
DO $$ BEGIN
  ALTER TABLE rooms ADD CONSTRAINT chk_rooms_description_length
    CHECK (description IS NULL OR char_length(description) <= 500);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- rooms.topic: max 200 chars
DO $$ BEGIN
  ALTER TABLE rooms ADD CONSTRAINT chk_rooms_topic_length
    CHECK (topic IS NULL OR char_length(topic) <= 200);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- messages.text: non-empty, max 3000 chars
DO $$ BEGIN
  ALTER TABLE messages ADD CONSTRAINT chk_messages_text_length
    CHECK (char_length(text) BETWEEN 1 AND 3000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- mod_actions.action: must be one of the allowed values
DO $$ BEGIN
  ALTER TABLE mod_actions ADD CONSTRAINT chk_mod_actions_action
    CHECK (action IN ('ban', 'report', 'mute'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- dm_messages.text: non-empty, max 3000 chars
DO $$ BEGIN
  ALTER TABLE dm_messages ADD CONSTRAINT chk_dm_messages_text_length
    CHECK (char_length(text) BETWEEN 1 AND 3000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- rooms.min_account_age_days: non-negative
DO $$ BEGIN
  ALTER TABLE rooms ADD CONSTRAINT chk_rooms_min_account_age
    CHECK (min_account_age_days >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- rooms.slow_mode_seconds: non-negative
DO $$ BEGIN
  ALTER TABLE rooms ADD CONSTRAINT chk_rooms_slow_mode
    CHECK (slow_mode_seconds >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
