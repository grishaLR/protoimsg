-- Allow mod_actions without a room (global reports / feedback)
ALTER TABLE mod_actions ALTER COLUMN room_id DROP NOT NULL;

-- Re-add FK so non-null room_ids must still reference valid rooms
ALTER TABLE mod_actions DROP CONSTRAINT IF EXISTS mod_actions_room_id_fkey;
ALTER TABLE mod_actions ADD CONSTRAINT mod_actions_room_id_fkey
  FOREIGN KEY (room_id) REFERENCES rooms(id);

-- Index for efficient lookups of reports/feedback by actor
CREATE INDEX IF NOT EXISTS idx_mod_actions_reports
  ON mod_actions (actor_did, action)
  WHERE action IN ('report', 'feedback');
