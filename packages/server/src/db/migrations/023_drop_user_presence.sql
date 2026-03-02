-- Presence is now fully server-side (in-memory via WebSocket).
-- The user_presence table was only populated by the Jetstream presence handler,
-- which has been removed. Users re-send status on reconnect, so DB persistence
-- adds no value.

DROP TABLE IF EXISTS user_presence;
