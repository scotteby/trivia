-- ============================================================
-- Trivia Night — Supabase setup script
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================


-- ─── 1. Create tables ────────────────────────────────────────

-- Solo daily challenge — one row per calendar day.
-- The app uses local date (YYYY-MM-DD) as the unique key so
-- timezone differences don't cause duplicate rows.
CREATE TABLE IF NOT EXISTS highscores (
  date         TEXT    PRIMARY KEY,           -- 'YYYY-MM-DD', local time
  score        INT     NOT NULL DEFAULT 0,    -- best score today
  set_at       TEXT    NOT NULL DEFAULT '',   -- human-readable time string, e.g. '08:32 PM'
  questions    JSONB   NOT NULL DEFAULT '[]', -- AI-generated questions array cached for the day
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Multiplayer game rooms
CREATE TABLE IF NOT EXISTS game_rooms (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code              TEXT        UNIQUE NOT NULL,
  status                 TEXT        NOT NULL DEFAULT 'lobby'
                                     CHECK (status IN ('lobby', 'active', 'finished')),
  current_question_index INT         NOT NULL DEFAULT 0,
  question_start_time    TIMESTAMPTZ,
  config                 JSONB       NOT NULL DEFAULT '{}',
  questions              JSONB       NOT NULL DEFAULT '[]',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Multiplayer players — one row per player per game
CREATE TABLE IF NOT EXISTS players (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id   UUID        NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
  name      TEXT        NOT NULL,
  score     INT         NOT NULL DEFAULT 0,
  answers   JSONB       NOT NULL DEFAULT '[]',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_game_rooms_room_code ON game_rooms (room_code);
CREATE INDEX IF NOT EXISTS idx_players_room_id      ON players    (room_id);


-- ─── 2. Enable Realtime ───────────────────────────────────────
-- REPLICA IDENTITY FULL ensures Realtime broadcasts the complete
-- row on UPDATE/DELETE, not just the primary key.
-- Only game_rooms and players need Realtime — highscores does not.

ALTER TABLE game_rooms REPLICA IDENTITY FULL;
ALTER TABLE players    REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime FOR TABLE game_rooms, players;
  ELSE
    ALTER PUBLICATION supabase_realtime ADD TABLE game_rooms, players;
  END IF;
END $$;


-- ─── 3. Row Level Security ────────────────────────────────────
-- RLS is enabled on all tables (best practice), but policies
-- grant full anon access so the app works without auth (Phase 1).
-- Tighten these in Phase 3 when you add Supabase Auth.

ALTER TABLE highscores ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE players    ENABLE ROW LEVEL SECURITY;

-- highscores: readable by anyone; writable by anyone (solo game
-- upserts today's best score without auth)
CREATE POLICY "anon read highscores"
  ON highscores FOR SELECT TO anon USING (true);

CREATE POLICY "anon insert highscores"
  ON highscores FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon update highscores"
  ON highscores FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- game_rooms: readable by anyone; host inserts and updates game state
CREATE POLICY "anon read game_rooms"
  ON game_rooms FOR SELECT TO anon USING (true);

CREATE POLICY "anon insert game_rooms"
  ON game_rooms FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon update game_rooms"
  ON game_rooms FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- players: full anon access (players join, answer, and can be kicked)
CREATE POLICY "anon read players"
  ON players FOR SELECT TO anon USING (true);

CREATE POLICY "anon insert players"
  ON players FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon update players"
  ON players FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon delete players"
  ON players FOR DELETE TO anon USING (true);


-- ─── 4. Verify ────────────────────────────────────────────────
-- Run this separately after the above to confirm setup is correct.
-- rls_enabled should be 't' for all three tables.
-- replica_identity should be 'f' (FULL) for game_rooms and players,
-- and 'd' (DEFAULT) for highscores — which is fine, no Realtime needed.

SELECT
  t.tablename,
  t.rowsecurity   AS rls_enabled,
  c.relreplident  AS replica_identity
FROM pg_tables t
JOIN pg_class  c ON c.relname = t.tablename
WHERE t.schemaname = 'public'
  AND t.tablename IN ('highscores', 'game_rooms', 'players')
ORDER BY t.tablename;
