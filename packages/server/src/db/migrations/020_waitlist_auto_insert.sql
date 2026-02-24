-- Allow waitlist entries without email (auto-inserted from login attempts).
-- Add unique index on DID to prevent duplicate auto-inserts.

ALTER TABLE waitlist ALTER COLUMN email DROP NOT NULL;

-- Unique on DID where DID is present (auto-inserted rows)
CREATE UNIQUE INDEX idx_waitlist_did ON waitlist (did) WHERE did IS NOT NULL;

-- Drop the old unique on email, replace with partial unique (where email is not null)
-- This allows multiple rows with NULL email while keeping email unique when present.
ALTER TABLE waitlist DROP CONSTRAINT IF EXISTS waitlist_email_key;
CREATE UNIQUE INDEX idx_waitlist_email ON waitlist (email) WHERE email IS NOT NULL;
