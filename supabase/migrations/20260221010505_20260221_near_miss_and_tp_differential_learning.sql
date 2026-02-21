/*
  # Near-Miss & TP Differential Learning System

  ## Summary
  This migration introduces first-class near-miss trade tracking and TP1-vs-TP2 differential
  learning so Alpha can distinguish between:
    1. A trade that went strongly in the right direction but TP was set too far (near-miss)
    2. A trade that hit TP1 only vs hitting both TP1 and TP2
    3. A trade that was a flat directional failure

  ## Changes

  ### 1. goal_session_trades — new columns
  - `peak_profit`          (numeric) — highest unrealised profit the trade reached (positive = profitable direction)
  - `peak_hit_ratio`       (numeric) — how far price travelled toward TP at its best point, as % of total TP distance (0-1)
  - `near_miss`            (boolean) — true when peak_hit_ratio >= 0.70 but trade closed in loss
  - `tp1_only`             (boolean) — true when tp1_hit=true but tp2_hit=false at closure

  ### 2. tp_near_miss_log — new table
  Stores every near-miss event for per-symbol/style TP quality learning.
  Alpha will query this to detect "this symbol consistently nearly hits TP but reverses" patterns.

  Columns:
  - id, user_id, trade_id, symbol, direction, style, timeframe
  - entry_price, stop_loss, take_profit, peak_price (best price reached)
  - peak_hit_ratio, tp_distance_pips, final_pnl, close_reason
  - created_at

  ### 3. tp1_only_log — new table
  Stores TP1-hit-but-not-TP2 events for per-symbol learning.
  Alpha will query this to calibrate whether TP2 targets are consistently too far.

  Columns:
  - id, user_id, trade_id, symbol, direction, style
  - tp1_price, tp2_price, tp1_pnl, max_profit_after_tp1
  - price_continued_past_tp1 (boolean — did price actually reach between TP1 and TP2?)
  - reversal_after_tp1_pips (how many pips did price give back after TP1?)
  - created_at

  ### Security
  - RLS enabled on both new tables
  - Authenticated users can only read/insert their own rows
  - Service role bypass for server-side writes

  ### CCIP Compliance
  - No destructive operations
  - All new columns have safe defaults (NULL or false)
  - Existing constraints untouched
  - All new tables follow SSOT naming conventions
*/

-- ─────────────────────────────────────────────
-- 1. Add near-miss & peak tracking to trades
-- ─────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'peak_profit'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN peak_profit numeric DEFAULT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'peak_hit_ratio'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN peak_hit_ratio numeric DEFAULT NULL;
    COMMENT ON COLUMN goal_session_trades.peak_hit_ratio IS
      'How far price travelled toward TP at its peak as a fraction of total TP distance (0.0–1.0). '
      '1.0 = price exactly hit TP. 0.85 = price reached 85% of the way to TP before reversing.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'near_miss'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN near_miss boolean DEFAULT false;
    COMMENT ON COLUMN goal_session_trades.near_miss IS
      'TRUE when peak_hit_ratio >= 0.70 but the trade closed with a loss or breakeven. '
      'Indicates Alpha correctly identified the direction but TP was placed too far.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp1_only'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp1_only boolean DEFAULT false;
    COMMENT ON COLUMN goal_session_trades.tp1_only IS
      'TRUE when tp1_hit=true but tp2_hit=false at time of closure. '
      'Used for TP2 placement quality learning.';
  END IF;
END $$;

-- ─────────────────────────────────────────────
-- 2. Create tp_near_miss_log table
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tp_near_miss_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id uuid NOT NULL,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('buy', 'sell')),
  style text,
  timeframe text,

  entry_price numeric NOT NULL,
  stop_loss numeric NOT NULL,
  take_profit numeric NOT NULL,
  peak_price numeric NOT NULL,

  peak_hit_ratio numeric NOT NULL CHECK (peak_hit_ratio >= 0 AND peak_hit_ratio <= 1),
  tp_distance_pips numeric,
  sl_distance_pips numeric,

  final_pnl numeric NOT NULL,
  close_reason text NOT NULL,

  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE tp_near_miss_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own near miss logs"
  ON tp_near_miss_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own near miss logs"
  ON tp_near_miss_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage near miss logs"
  ON tp_near_miss_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_tp_near_miss_log_user_symbol
  ON tp_near_miss_log (user_id, symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tp_near_miss_log_trade_id
  ON tp_near_miss_log (trade_id);

-- ─────────────────────────────────────────────
-- 3. Create tp1_only_log table
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tp1_only_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id uuid NOT NULL,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('buy', 'sell')),
  style text,
  timeframe text,

  tp1_price numeric NOT NULL,
  tp2_price numeric,
  tp1_pnl numeric NOT NULL,
  max_profit_after_tp1 numeric,

  price_continued_past_tp1 boolean DEFAULT false,
  reversal_after_tp1_pips numeric,
  final_close_reason text NOT NULL,

  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE tp1_only_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own tp1 only logs"
  ON tp1_only_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tp1 only logs"
  ON tp1_only_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage tp1 only logs"
  ON tp1_only_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_tp1_only_log_user_symbol
  ON tp1_only_log (user_id, symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tp1_only_log_trade_id
  ON tp1_only_log (trade_id);

-- ─────────────────────────────────────────────
-- 4. RPC: get_near_miss_stats_for_symbol
-- Returns aggregated near-miss stats per symbol so Alpha can detect
-- "this symbol's TPs are consistently placed too far" patterns.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_near_miss_stats_for_symbol(
  p_user_id uuid,
  p_symbol text,
  p_days int DEFAULT 30
)
RETURNS TABLE (
  symbol text,
  total_near_misses int,
  avg_peak_hit_ratio numeric,
  avg_tp_distance_pips numeric,
  suggested_tp_tightening_pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p_symbol AS symbol,
    COUNT(*)::int AS total_near_misses,
    ROUND(AVG(nm.peak_hit_ratio)::numeric, 3) AS avg_peak_hit_ratio,
    ROUND(AVG(nm.tp_distance_pips)::numeric, 1) AS avg_tp_distance_pips,
    -- If average peak hit ratio is 0.85, suggest tightening TP by (1 - 0.85) * 100 = 15%
    ROUND(((1.0 - AVG(nm.peak_hit_ratio)) * 100)::numeric, 1) AS suggested_tp_tightening_pct
  FROM tp_near_miss_log nm
  WHERE nm.user_id = p_user_id
    AND nm.symbol = p_symbol
    AND nm.created_at >= (now() - (p_days || ' days')::interval)
  GROUP BY p_symbol;
END;
$$;

GRANT EXECUTE ON FUNCTION get_near_miss_stats_for_symbol(uuid, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION get_near_miss_stats_for_symbol(uuid, text, int) TO service_role;

-- ─────────────────────────────────────────────
-- 5. RPC: get_tp1_only_stats_for_symbol
-- Returns TP1-only stats to detect if TP2 targets are consistently too far.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_tp1_only_stats_for_symbol(
  p_user_id uuid,
  p_symbol text,
  p_days int DEFAULT 30
)
RETURNS TABLE (
  symbol text,
  total_tp1_only_trades int,
  pct_price_continued_past_tp1 numeric,
  avg_reversal_pips numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p_symbol AS symbol,
    COUNT(*)::int AS total_tp1_only_trades,
    ROUND(
      (SUM(CASE WHEN tl.price_continued_past_tp1 THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(*), 0)) * 100,
      1
    ) AS pct_price_continued_past_tp1,
    ROUND(AVG(tl.reversal_after_tp1_pips)::numeric, 1) AS avg_reversal_pips
  FROM tp1_only_log tl
  WHERE tl.user_id = p_user_id
    AND tl.symbol = p_symbol
    AND tl.created_at >= (now() - (p_days || ' days')::interval)
  GROUP BY p_symbol;
END;
$$;

GRANT EXECUTE ON FUNCTION get_tp1_only_stats_for_symbol(uuid, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION get_tp1_only_stats_for_symbol(uuid, text, int) TO service_role;
