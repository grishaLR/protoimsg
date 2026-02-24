ALTER TABLE rooms ADD COLUMN IF NOT EXISTS category TEXT;
CREATE INDEX IF NOT EXISTS idx_rooms_category ON rooms (category) WHERE category IS NOT NULL;
