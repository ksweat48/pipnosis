/*
  # CCIP-2026-0427F-ALWAYS-EXECUTE: Eliminate NO_TRADE, always execute

  ## Summary
  Hard-removes the NO_TRADE option entirely. Alpha must always produce a directional
  trade (BUY or SELL). The Entry Monitor toggle becomes the sole authority over
  whether wait-intent fallback is allowed when execute_now confidence is below 60%.

  ## Changes
  1. Hard-delete all NO_TRADE rows from alpha_decisions (cascades to
     alpha_decision_outcomes and alpha_no_trade_counterfactuals; sets
     goal_session_trades.alpha_decision_id to NULL).
  2. Drop alpha_no_trade_counterfactuals table (no longer needed).
  3. Drop legacy CHECK constraints on action and confidence_tier columns.
  4. Remap legacy confidence tier values:
       low, cautious, no_read -> low_quality
       moderate              -> confident
       high, very_high       -> very_confident
       extreme               -> extremely_confident
  5. Add new CHECK constraints:
       action IN ('BUY','SELL')
       confidence_tier IN ('low_quality','confident','very_confident','extremely_confident')
  6. Add SSOT columns to alpha_decisions:
       - execution_policy text (EXECUTE_NOW_ONLY | EXECUTE_NOW_OR_WAIT_FALLBACK)
       - entry_mode_fallback_used boolean
       - tp2_omitted boolean
       - tp2_omission_reason text
  7. Create get_user_execution_policy(uuid) RPC as SSOT for the entry-monitor toggle.

  ## Security
  - All operations preserve existing RLS policies.
  - RPC uses SECURITY DEFINER and a fixed search_path.
*/

-- 1. Hard-delete NO_TRADE rows (cascades through FKs)
DELETE FROM alpha_decisions WHERE action = 'NO_TRADE';

-- 2. Drop the counterfactuals table entirely
DROP TABLE IF EXISTS alpha_no_trade_counterfactuals CASCADE;

-- 3. Drop legacy CHECK constraints FIRST (before any UPDATEs)
ALTER TABLE alpha_decisions DROP CONSTRAINT IF EXISTS alpha_decisions_action_check;
ALTER TABLE alpha_decisions DROP CONSTRAINT IF EXISTS alpha_decisions_confidence_tier_check;
ALTER TABLE goal_session_trades DROP CONSTRAINT IF EXISTS goal_session_trades_confidence_tier_check;

-- 4. Remap legacy tier values (constraints are gone; safe to update)
UPDATE alpha_decisions
SET confidence_tier = CASE confidence_tier
  WHEN 'low'       THEN 'low_quality'
  WHEN 'cautious'  THEN 'low_quality'
  WHEN 'no_read'   THEN 'low_quality'
  WHEN 'moderate'  THEN 'confident'
  WHEN 'high'      THEN 'very_confident'
  WHEN 'very_high' THEN 'very_confident'
  WHEN 'extreme'   THEN 'extremely_confident'
  ELSE confidence_tier
END
WHERE confidence_tier IN ('low','cautious','no_read','moderate','high','very_high','extreme');

UPDATE goal_session_trades
SET confidence_tier = CASE confidence_tier
  WHEN 'low'       THEN 'low_quality'
  WHEN 'cautious'  THEN 'low_quality'
  WHEN 'no_read'   THEN 'low_quality'
  WHEN 'moderate'  THEN 'confident'
  WHEN 'high'      THEN 'very_confident'
  WHEN 'very_high' THEN 'very_confident'
  WHEN 'extreme'   THEN 'extremely_confident'
  ELSE confidence_tier
END
WHERE confidence_tier IN ('low','cautious','no_read','moderate','high','very_high','extreme');

-- 5. Re-add CHECK constraints with the new SSOT vocabulary
ALTER TABLE alpha_decisions
  ADD CONSTRAINT alpha_decisions_action_check
  CHECK (action IN ('BUY','SELL'));

ALTER TABLE alpha_decisions
  ADD CONSTRAINT alpha_decisions_confidence_tier_check
  CHECK (confidence_tier IS NULL OR confidence_tier IN ('low_quality','confident','very_confident','extremely_confident'));

ALTER TABLE goal_session_trades
  ADD CONSTRAINT goal_session_trades_confidence_tier_check
  CHECK (confidence_tier IS NULL OR confidence_tier IN ('low_quality','confident','very_confident','extremely_confident'));

-- 6. Add new SSOT columns to alpha_decisions
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='alpha_decisions' AND column_name='execution_policy') THEN
    ALTER TABLE alpha_decisions ADD COLUMN execution_policy text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='alpha_decisions' AND column_name='entry_mode_fallback_used') THEN
    ALTER TABLE alpha_decisions ADD COLUMN entry_mode_fallback_used boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='alpha_decisions' AND column_name='tp2_omitted') THEN
    ALTER TABLE alpha_decisions ADD COLUMN tp2_omitted boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='alpha_decisions' AND column_name='tp2_omission_reason') THEN
    ALTER TABLE alpha_decisions ADD COLUMN tp2_omission_reason text;
  END IF;
END $$;

ALTER TABLE alpha_decisions DROP CONSTRAINT IF EXISTS alpha_decisions_execution_policy_check;
ALTER TABLE alpha_decisions
  ADD CONSTRAINT alpha_decisions_execution_policy_check
  CHECK (execution_policy IS NULL OR execution_policy IN ('EXECUTE_NOW_ONLY','EXECUTE_NOW_OR_WAIT_FALLBACK'));

-- 7. SSOT RPC: derives execution policy from the entry-monitor toggle
CREATE OR REPLACE FUNCTION get_user_execution_policy(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_monitor_enabled boolean;
BEGIN
  SELECT entry_price_monitor_enabled
  INTO v_monitor_enabled
  FROM user_monitor_preferences
  WHERE user_id = p_user_id;

  -- Default (no preference row): treat as monitor on -> wait fallback allowed
  IF v_monitor_enabled IS NULL THEN
    RETURN 'EXECUTE_NOW_OR_WAIT_FALLBACK';
  END IF;

  IF v_monitor_enabled = true THEN
    RETURN 'EXECUTE_NOW_OR_WAIT_FALLBACK';
  ELSE
    RETURN 'EXECUTE_NOW_ONLY';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_execution_policy(uuid) TO authenticated, service_role;
