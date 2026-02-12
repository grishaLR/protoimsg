-- Composite index for ban lookups: isUserBanned checks (room_id, subject_did, action)
CREATE INDEX IF NOT EXISTS idx_mod_actions_room_subject_action
  ON mod_actions (room_id, subject_did, action);
