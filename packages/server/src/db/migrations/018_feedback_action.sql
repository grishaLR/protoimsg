-- Add 'feedback' to allowed mod_actions action values
ALTER TABLE mod_actions DROP CONSTRAINT IF EXISTS chk_mod_actions_action;
ALTER TABLE mod_actions ADD CONSTRAINT chk_mod_actions_action
  CHECK (action IN ('ban', 'report', 'mute', 'feedback'));
