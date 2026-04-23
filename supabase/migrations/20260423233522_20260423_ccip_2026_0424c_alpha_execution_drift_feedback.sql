/*
  # CCIP-2026-0424C — Alpha Execution Drift Feedback Loop

  1. Purpose
     Persist every execution-time drift observation (planned entry vs actual fill)
     so Alpha can learn per-symbol / per-style drift behavior and size stops
     accordingly. This turns the silent geometry guard into an active feedback
     channel that Alpha consumes via prompt injection.

  2. New Table
     - `alpha_execution_drift_events`
       - `id` (uuid, primary key)
       - `user_id` (uuid, FK to auth.users)
       - `session_id` (uuid, nullable — nullable for backfills / manual ops)
       - `decision_id` (uuid, nullable — links to alpha_decisions when available)
       - `symbol` (text)
       - `alpha_style` (text — scalp / micro_intraday / intraday)
       - `direction` (text — BUY / SELL)
       - `planned_entry` (numeric)
       - `actual_fill` (numeric)
       - `planned_stop` (numeric)
       - `planned_take_profit` (numeric, nullable)
       - `planned_stop_pips` (numeric)
       - `drift_pips` (numeric — absolute pip drift between decision and fill)
       - `drift_ratio` (numeric — drift / planned_stop_distance)
       - `tier` (text — A, B, or C)
       - `outcome` (text — executed, requoted, blocked)
       - `retry_count` (integer, default 0)
       - `decision_timestamp` (timestamptz)
       - `fill_timestamp` (timestamptz)
       - `metadata` (jsonb, default '{}')
       - `created_at` (timestamptz, default now())

  3. Security
     - Enable RLS
     - Users can view their own drift events
     - Authenticated inserts constrained to own user_id
     - Service role full access

  4. Indexes
     - (symbol, alpha_style, created_at DESC) for fast recent-lookup
     - (user_id, created_at DESC) for per-user auditing

  5. RPC
     - `get_recent_drift_stats(p_symbol, p_style, p_lookback)` returns:
       avg_drift_pips, max_drift_pips, median_drift_pips,
       tier_a_count, tier_b_count, tier_c_count, sample_size
*/

CREATE TABLE IF NOT EXISTS alpha_execution_drift_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid,
  decision_id uuid,
  symbol text NOT NULL,
  alpha_style text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  planned_entry numeric NOT NULL,
  actual_fill numeric NOT NULL,
  planned_stop numeric NOT NULL,
  planned_take_profit numeric,
  planned_stop_pips numeric NOT NULL DEFAULT 0,
  drift_pips numeric NOT NULL DEFAULT 0,
  drift_ratio numeric NOT NULL DEFAULT 0,
  tier text NOT NULL CHECK (tier IN ('A', 'B', 'C')),
  outcome text NOT NULL CHECK (outcome IN ('executed', 'requoted', 'blocked')),
  retry_count integer NOT NULL DEFAULT 0,
  decision_timestamp timestamptz NOT NULL,
  fill_timestamp timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drift_events_symbol_style_created
  ON alpha_execution_drift_events (symbol, alpha_style, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_drift_events_user_created
  ON alpha_execution_drift_events (user_id, created_at DESC);

ALTER TABLE alpha_execution_drift_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own drift events" ON alpha_execution_drift_events;
CREATE POLICY "Users view own drift events"
  ON alpha_execution_drift_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own drift events" ON alpha_execution_drift_events;
CREATE POLICY "Users insert own drift events"
  ON alpha_execution_drift_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access drift events" ON alpha_execution_drift_events;
CREATE POLICY "Service role full access drift events"
  ON alpha_execution_drift_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION get_recent_drift_stats(
  p_symbol text,
  p_style text,
  p_lookback integer DEFAULT 10
)
RETURNS TABLE (
  sample_size integer,
  avg_drift_pips numeric,
  max_drift_pips numeric,
  median_drift_pips numeric,
  tier_a_count integer,
  tier_b_count integer,
  tier_c_count integer,
  executed_count integer,
  requoted_count integer,
  blocked_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH recent AS (
    SELECT *
    FROM alpha_execution_drift_events
    WHERE symbol = p_symbol
      AND alpha_style = p_style
    ORDER BY created_at DESC
    LIMIT GREATEST(p_lookback, 1)
  )
  SELECT
    COUNT(*)::integer AS sample_size,
    COALESCE(ROUND(AVG(drift_pips)::numeric, 2), 0) AS avg_drift_pips,
    COALESCE(MAX(drift_pips), 0) AS max_drift_pips,
    COALESCE(
      ROUND(
        (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY drift_pips))::numeric,
        2
      ),
      0
    ) AS median_drift_pips,
    COUNT(*) FILTER (WHERE tier = 'A')::integer AS tier_a_count,
    COUNT(*) FILTER (WHERE tier = 'B')::integer AS tier_b_count,
    COUNT(*) FILTER (WHERE tier = 'C')::integer AS tier_c_count,
    COUNT(*) FILTER (WHERE outcome = 'executed')::integer AS executed_count,
    COUNT(*) FILTER (WHERE outcome = 'requoted')::integer AS requoted_count,
    COUNT(*) FILTER (WHERE outcome = 'blocked')::integer AS blocked_count
  FROM recent;
END;
$$;

GRANT EXECUTE ON FUNCTION get_recent_drift_stats(text, text, integer) TO authenticated, service_role;
