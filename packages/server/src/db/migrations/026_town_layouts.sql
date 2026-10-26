-- proto town layouts: indexed from app.protoimsg.town.layout records (rkey = space).
-- The record in the owner's repo is authoritative; this is a cache for fast scene loads.
CREATE TABLE IF NOT EXISTS town_layouts (
  did         TEXT NOT NULL,
  space       TEXT NOT NULL CHECK (space IN ('home', 'yard')),
  placements  JSONB NOT NULL DEFAULT '[]',
  cid         TEXT,
  -- The record's own updatedAt (clamped): newer writes win, whatever order they arrive in.
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  indexed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (did, space)
);

ALTER TABLE town_layouts ENABLE ROW LEVEL SECURITY;
