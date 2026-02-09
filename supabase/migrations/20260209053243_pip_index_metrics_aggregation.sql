/*
  # PIP Index Metrics Aggregation RPC

  ## Overview
  Creates RPC function to aggregate 30-day metrics for PIP Utility Index calculation:
  - Credits spent (sum of all credit expenditures)
  - PIP burned (sum of all token burns)
  - Staked ratio (total staked / total supply)
  - Active users (distinct users who executed trades)
  - Liquid supply ratio (total liquid / total supply)

  ## Security
  - SECURITY DEFINER for comprehensive data access
  - Deterministic calculation for replayability
  
  ## SSOT Compliance
  - Single source for 30-day metric aggregation
  - Used exclusively by pip-utility-index-engine
*/

-- =====================================================
-- GET PIP INDEX METRICS (30-day window)
-- =====================================================

CREATE OR REPLACE FUNCTION get_pip_index_metrics_30d()
RETURNS TABLE (
  credits_spent_30d BIGINT,
  pip_burned_30d DECIMAL(18,4),
  staked_ratio DECIMAL(8,6),
  active_users_30d INTEGER,
  liquid_supply_ratio DECIMAL(8,6)
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_supply CONSTANT DECIMAL(18,4) := 100000000.0000;
  v_cutoff_date TIMESTAMPTZ;
  v_credits_spent BIGINT;
  v_pip_burned DECIMAL(18,4);
  v_total_staked DECIMAL(18,4);
  v_active_users INTEGER;
  v_total_liquid DECIMAL(18,4);
BEGIN
  -- Calculate 30 days ago
  v_cutoff_date := now() - interval '30 days';

  -- 1. Credits spent in last 30 days
  -- Sum from credit_transaction_log or order_events
  SELECT COALESCE(SUM(credits_deducted), 0)
  INTO v_credits_spent
  FROM credit_transaction_log
  WHERE transaction_type = 'deduction'
    AND created_at >= v_cutoff_date;

  -- 2. PIP burned in last 30 days
  SELECT COALESCE(SUM(amount_pip), 0)
  INTO v_pip_burned
  FROM token_events
  WHERE event_type = 'BURN'
    AND ts >= v_cutoff_date;

  -- 3. Current staked ratio
  SELECT COALESCE(SUM(pip_staked), 0)
  INTO v_total_staked
  FROM token_balances;

  -- 4. Active users in last 30 days (users who executed trades)
  SELECT COUNT(DISTINCT user_id)
  INTO v_active_users
  FROM goal_session_trades
  WHERE status = 'open'
    OR (status = 'closed' AND closed_at >= v_cutoff_date);

  -- 5. Current liquid supply ratio
  SELECT COALESCE(SUM(pip_liquid), 0)
  INTO v_total_liquid
  FROM token_balances;

  -- Return aggregated metrics
  RETURN QUERY SELECT
    v_credits_spent,
    v_pip_burned,
    CASE WHEN v_total_supply > 0 THEN (v_total_staked / v_total_supply)::DECIMAL(8,6) ELSE 0::DECIMAL(8,6) END,
    v_active_users,
    CASE WHEN v_total_supply > 0 THEN (v_total_liquid / v_total_supply)::DECIMAL(8,6) ELSE 0::DECIMAL(8,6) END;
END;
$$;

GRANT EXECUTE ON FUNCTION get_pip_index_metrics_30d TO authenticated;
GRANT EXECUTE ON FUNCTION get_pip_index_metrics_30d TO service_role;

COMMENT ON FUNCTION get_pip_index_metrics_30d IS 'Aggregates 30-day metrics for PIP Utility Index calculation. SSOT for index inputs.';