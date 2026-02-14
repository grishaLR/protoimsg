-- Lightweight daily counters for key app metrics.
-- Incremented atomically by server code on each event.
-- One row per day — query with simple date range filters.

CREATE TABLE IF NOT EXISTS daily_stats (
  day            DATE PRIMARY KEY DEFAULT CURRENT_DATE,
  unique_logins  INTEGER NOT NULL DEFAULT 0,
  messages_sent  INTEGER NOT NULL DEFAULT 0,
  rooms_created  INTEGER NOT NULL DEFAULT 0,
  dms_sent       INTEGER NOT NULL DEFAULT 0,
  peak_ws_conns  INTEGER NOT NULL DEFAULT 0
);
