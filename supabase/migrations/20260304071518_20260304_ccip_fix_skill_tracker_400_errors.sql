/*
  # CCIP Fix: Skill Tracker 400 Errors — Add Session Stats Columns to goal_sessions

  ## Problem
  `ai-skill-tracker.ts` queries `goal_sessions` for `win_rate`, `profit_factor`, and
  `total_trades` columns that do not exist, causing HTTP 400 Bad Request errors every
  time a trade closes and the learning engine runs.

  ## Changes

  ### 1. New Columns on goal_sessions
  - `session_win_rate` (numeric, nullable) — percentage of winning trades in session
  - `session_profit_factor` (numeric, nullable) — gross profit / gross loss ratio
  - `session_total_trades` (integer, nullable) — count of closed trades in session

  ### 2. Why These Columns, Not a View
  The skill tracker needs to query the LAST 10 completed sessions sorted by
  completed_at. Computing these on-the-fly via JOIN would require aggregation across
  thousands of trade rows per query call. Storing them at session close is the
  SSOT-compliant approach — they are immutable once set (session is terminal).

  ### 3. SSOT Governance
  The state machine (goal-session-state-machine.ts) is the single authority for
  session terminal transitions. It will be updated to compute and write these values
  when a session enters a terminal state (goal_achieved, stopped, timeout).

  ### 4. No Destructive Operations
  Only ADD COLUMN — no drops, no renames, no data loss.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'session_win_rate'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN session_win_rate numeric;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'session_profit_factor'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN session_profit_factor numeric;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'session_total_trades'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN session_total_trades integer;
  END IF;
END $$;

-- Index to support the skill tracker's 10-session lookup efficiently:
-- SELECT ... WHERE user_id=? AND status IN ('goal_achieved','user_stopped','timeout')
--   AND session_win_rate IS NOT NULL ORDER BY completed_at DESC LIMIT 10
CREATE INDEX IF NOT EXISTS idx_goal_sessions_skill_tracker
  ON goal_sessions (user_id, completed_at DESC)
  WHERE completed_at IS NOT NULL;
