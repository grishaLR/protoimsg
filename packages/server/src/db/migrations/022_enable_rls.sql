-- Enable Row Level Security on all public tables.
-- No policies are created — this is a "deny all" default for the anon and
-- authenticated Supabase roles.  The service role (used by our Express server
-- via postgres.js) bypasses RLS automatically, so application queries are
-- unaffected.

ALTER TABLE channels              ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_lists       ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_stats           ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_conversations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE firehose_cursor       ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_allowlist      ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_bans           ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE mod_actions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_votes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE polls                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE records               ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_allowlist        ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_cache     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_presence         ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist              ENABLE ROW LEVEL SECURITY;
