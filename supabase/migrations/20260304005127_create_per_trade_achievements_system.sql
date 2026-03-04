/*
  # Per-Trade Achievements System

  ## Summary
  Replaces the old session-goal achievement system with a new per-trade achievement
  model. Every time a user closes a profitable trade (via TP hit or manual close with
  positive P&L), a trade_achievement record is automatically created.

  ## What Is Being Removed
  - Old `get_user_achievements` RPC (session-goal based)
  - Old `get_achievement_summary` RPC (session-goal based)

  ## New Tables
  - `trade_achievements`
    - `id` (uuid, pk)
    - `user_id` (uuid, fk auth.users)
    - `trade_id` (uuid, fk goal_session_trades)
    - `symbol` (text)
    - `direction` (text: BUY/SELL)
    - `pnl` (numeric)
    - `close_reason` (text)
    - `pip_gain` (numeric)
    - `lot_size` (numeric)
    - `trade_style` (text)
    - `achieved_at` (timestamptz)
    - `medal_rank` (text)
    - `trade_number` (integer — cumulative win number for this user)

  ## New RPCs
  - `get_user_trade_achievements(p_user_id)` — returns all wins newest first
  - `get_trade_achievement_summary(p_user_id)` — aggregate stats
  - `record_trade_achievement(...)` — called by trade closure flow

  ## Security
  - RLS enabled, users read own rows only
  - Service role can insert
*/

-- Drop old session-based achievement RPCs
DROP FUNCTION IF EXISTS get_user_achievements(uuid);
DROP FUNCTION IF EXISTS get_achievement_summary(uuid);

-- Create trade_achievements table
CREATE TABLE IF NOT EXISTS trade_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id uuid,
  symbol text NOT NULL DEFAULT '',
  direction text NOT NULL DEFAULT 'BUY',
  pnl numeric NOT NULL DEFAULT 0,
  close_reason text NOT NULL DEFAULT 'manual',
  pip_gain numeric NOT NULL DEFAULT 0,
  lot_size numeric NOT NULL DEFAULT 0,
  trade_style text NOT NULL DEFAULT '',
  achieved_at timestamptz NOT NULL DEFAULT now(),
  medal_rank text NOT NULL DEFAULT 'Bronze',
  trade_number integer NOT NULL DEFAULT 1
);

ALTER TABLE trade_achievements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own trade achievements"
  ON trade_achievements FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert trade achievements"
  ON trade_achievements FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can select trade achievements"
  ON trade_achievements FOR SELECT
  TO service_role
  USING (true);

CREATE INDEX IF NOT EXISTS idx_trade_achievements_user_id ON trade_achievements(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_achievements_achieved_at ON trade_achievements(achieved_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_achievements_trade_id ON trade_achievements(trade_id);

-- RPC: get_user_trade_achievements
CREATE OR REPLACE FUNCTION get_user_trade_achievements(p_user_id uuid)
RETURNS TABLE (
  achievement_id uuid,
  trade_id uuid,
  trade_number integer,
  symbol text,
  direction text,
  pnl numeric,
  close_reason text,
  pip_gain numeric,
  lot_size numeric,
  trade_style text,
  achieved_at timestamptz,
  medal_rank text,
  medal_color text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ta.id AS achievement_id,
    ta.trade_id,
    ta.trade_number,
    ta.symbol,
    ta.direction,
    ta.pnl,
    ta.close_reason,
    ta.pip_gain,
    ta.lot_size,
    ta.trade_style,
    ta.achieved_at,
    ta.medal_rank,
    CASE ta.medal_rank
      WHEN 'Platinum' THEN '#E5E4E2'
      WHEN 'Diamond'  THEN '#B9F2FF'
      WHEN 'Gold'     THEN '#FFD700'
      WHEN 'Silver'   THEN '#C0C0C0'
      ELSE                 '#CD7F32'
    END AS medal_color
  FROM trade_achievements ta
  WHERE ta.user_id = p_user_id
  ORDER BY ta.achieved_at DESC;
END;
$$;

-- RPC: get_trade_achievement_summary
CREATE OR REPLACE FUNCTION get_trade_achievement_summary(p_user_id uuid)
RETURNS TABLE (
  total_wins integer,
  total_pnl numeric,
  best_trade_pnl numeric,
  best_symbol text,
  avg_pnl numeric,
  current_rank text,
  current_rank_color text,
  wins_to_next_rank integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_wins integer;
  v_rank text;
  v_rank_color text;
  v_next_threshold integer;
BEGIN
  SELECT COUNT(*)::integer INTO v_total_wins
  FROM trade_achievements
  WHERE user_id = p_user_id;

  IF v_total_wins >= 500 THEN
    v_rank := 'Platinum'; v_rank_color := '#E5E4E2'; v_next_threshold := 500;
  ELSIF v_total_wins >= 100 THEN
    v_rank := 'Diamond';  v_rank_color := '#B9F2FF'; v_next_threshold := 500;
  ELSIF v_total_wins >= 25 THEN
    v_rank := 'Gold';     v_rank_color := '#FFD700'; v_next_threshold := 100;
  ELSIF v_total_wins >= 10 THEN
    v_rank := 'Silver';   v_rank_color := '#C0C0C0'; v_next_threshold := 25;
  ELSE
    v_rank := 'Bronze';   v_rank_color := '#CD7F32'; v_next_threshold := 10;
  END IF;

  RETURN QUERY
  SELECT
    v_total_wins,
    COALESCE(SUM(ta.pnl), 0)                   AS total_pnl,
    COALESCE(MAX(ta.pnl), 0)                   AS best_trade_pnl,
    COALESCE((
      SELECT symbol FROM trade_achievements
      WHERE user_id = p_user_id ORDER BY pnl DESC LIMIT 1
    ), '')                                      AS best_symbol,
    CASE WHEN v_total_wins > 0
      THEN COALESCE(SUM(ta.pnl) / v_total_wins, 0)
      ELSE 0
    END                                         AS avg_pnl,
    v_rank,
    v_rank_color,
    GREATEST(v_next_threshold - v_total_wins, 0) AS wins_to_next_rank
  FROM trade_achievements ta
  WHERE ta.user_id = p_user_id;
END;
$$;

-- RPC: record_trade_achievement
CREATE OR REPLACE FUNCTION record_trade_achievement(
  p_user_id uuid,
  p_trade_id uuid,
  p_symbol text,
  p_direction text,
  p_pnl numeric,
  p_close_reason text,
  p_pip_gain numeric DEFAULT 0,
  p_lot_size numeric DEFAULT 0,
  p_trade_style text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_trade_number integer;
  v_medal_rank text;
  v_id uuid;
BEGIN
  IF p_pnl <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(*) + 1 INTO v_trade_number
  FROM trade_achievements
  WHERE user_id = p_user_id;

  IF v_trade_number >= 500 THEN
    v_medal_rank := 'Platinum';
  ELSIF v_trade_number >= 100 THEN
    v_medal_rank := 'Diamond';
  ELSIF v_trade_number >= 25 THEN
    v_medal_rank := 'Gold';
  ELSIF v_trade_number >= 10 THEN
    v_medal_rank := 'Silver';
  ELSE
    v_medal_rank := 'Bronze';
  END IF;

  INSERT INTO trade_achievements (
    user_id, trade_id, symbol, direction, pnl, close_reason,
    pip_gain, lot_size, trade_style, medal_rank, trade_number
  ) VALUES (
    p_user_id, p_trade_id, p_symbol, p_direction, p_pnl, p_close_reason,
    p_pip_gain, p_lot_size, p_trade_style, v_medal_rank, v_trade_number
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Backfill existing closed profitable trades using correct column names
INSERT INTO trade_achievements (
  user_id, trade_id, symbol, direction, pnl, close_reason,
  pip_gain, lot_size, trade_style, achieved_at, medal_rank, trade_number
)
SELECT
  t.user_id,
  t.id AS trade_id,
  t.symbol,
  COALESCE(t.direction, 'BUY'),
  COALESCE(t.profit_loss, 0),
  COALESCE(t.close_reason, 'manual'),
  COALESCE(t.total_pips, 0),
  COALESCE(t.lot_size, 0),
  COALESCE(t.alpha_style, ''),
  COALESCE(t.closed_at, t.created_at),
  'Bronze',
  ROW_NUMBER() OVER (PARTITION BY t.user_id ORDER BY COALESCE(t.closed_at, t.created_at) ASC)::integer
FROM goal_session_trades t
WHERE t.status = 'closed'
  AND COALESCE(t.profit_loss, 0) > 0
ON CONFLICT DO NOTHING;

-- Re-apply medal ranks based on sequential trade_number
UPDATE trade_achievements
SET medal_rank = CASE
  WHEN trade_number >= 500 THEN 'Platinum'
  WHEN trade_number >= 100 THEN 'Diamond'
  WHEN trade_number >= 25  THEN 'Gold'
  WHEN trade_number >= 10  THEN 'Silver'
  ELSE 'Bronze'
END;
