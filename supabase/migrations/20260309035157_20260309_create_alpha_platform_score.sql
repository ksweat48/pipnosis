/*
  # Alpha Platform Score — Single Row Global Performance Table

  ## Purpose
  Alpha is a single trading intelligence. His streak and confidence
  reflect how Alpha is performing as a SYSTEM across all trades on the
  platform — not how any one user's account is doing.

  This table holds exactly ONE row: Alpha's global consecutive streak
  and confidence modifier. There is no user_id key.

  ## Design Decisions
  - Single-row table (enforced by CHECK constraint on id = 'singleton')
  - No user_id — platform-wide record, not per-user
  - confidence_modifier: integer -5 to +5 (applied at execution time)
  - consecutive_wins / consecutive_losses: current streak counters
  - The existing ai_trader_score table is NOT removed — it continues
    to track per-user performance history. It is just no longer used
    to drive Alpha's behavior (personality injection / confidence).

  ## How the Modifier Works
  - streak of 1 win  → +1 | 2 wins → +2 | ... | 5+ wins → +5 (hard cap)
  - streak of 1 loss → -1 | 2 losses → -2 | ... | 5+ losses → -5 (hard cap)
  - Zero streak → 0 (no adjustment)
  - Modifier is applied AFTER Alpha's raw confidence, BEFORE the 60% gate

  ## Security
  - RLS enabled
  - Authenticated users can SELECT (read modifier at execution time)
  - Only service_role can INSERT / UPDATE (written by reward engine on trade close)
*/

CREATE TABLE IF NOT EXISTS alpha_platform_score (
  id                  text PRIMARY KEY DEFAULT 'singleton',
  consecutive_wins    integer NOT NULL DEFAULT 0,
  consecutive_losses  integer NOT NULL DEFAULT 0,
  total_trades        integer NOT NULL DEFAULT 0,
  total_wins          integer NOT NULL DEFAULT 0,
  total_losses        integer NOT NULL DEFAULT 0,
  confidence_modifier integer NOT NULL DEFAULT 0,
  last_outcome        text,
  last_updated        timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT singleton_row CHECK (id = 'singleton'),
  CONSTRAINT modifier_range CHECK (confidence_modifier BETWEEN -5 AND 5),
  CONSTRAINT no_negative_counts CHECK (
    consecutive_wins >= 0 AND
    consecutive_losses >= 0 AND
    total_trades >= 0 AND
    total_wins >= 0 AND
    total_losses >= 0
  ),
  CONSTRAINT valid_last_outcome CHECK (
    last_outcome IS NULL OR last_outcome IN ('win', 'loss', 'breakeven')
  )
);

ALTER TABLE alpha_platform_score ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read platform score"
  ON alpha_platform_score
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can update platform score"
  ON alpha_platform_score
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can insert platform score"
  ON alpha_platform_score
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Seed the single row
INSERT INTO alpha_platform_score (id)
VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;
