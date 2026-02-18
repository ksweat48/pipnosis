/*
  # Mid-Trade Deterministic Plan Engine — CCIP Governance Migration

  ## Purpose
  Links Alpha's decision record to each executed trade so the mid-trade monitor
  can access the full trade plan (reasoning, regime, invalidation price, pattern
  signals) deterministically — without LLM calls during the trade lifecycle.

  ## Changes

  ### 1. goal_session_trades — new columns
  - `alpha_decision_id` (uuid, nullable FK → alpha_decisions.id)
    SSOT link between a trade and the Alpha decision that produced it.
    Populated at trade insertion by alpha-trade-executor.

  - `invalidation_price` (numeric, nullable)
    The price at which Alpha's thesis breaks. Copied from
    alpha_decisions.pattern_invalidation_price at trade entry.
    Used by mid-trade monitor for deterministic "thesis intact" checks.

  - `alpha_reasoning_snapshot` (text, nullable)
    Alpha's full reasoning text at the moment of entry (immutable snapshot).
    Copied from alpha_decisions.reasoning. Never mutated post-entry.

  - `market_regime_at_entry` (text, nullable)
    Market regime string at entry (e.g. "trend_strong_bearish").
    Copied from alpha_decisions.market_regime.

  - `mid_trade_plan` (jsonb, nullable, default '{}')
    Structured snapshot of the trade plan for mid-trade evaluation:
    {
      setup_summary: string,          -- 1-line setup description
      invalidation_price: number,     -- price that breaks the thesis
      key_levels: [{price, type, label}],  -- important price levels
      expected_direction: string,     -- "down" | "up"
      trailing_method: string,        -- "atr" | "swing" | "breakeven"
      regime_at_entry: string,        -- regime bucket
      patterns: { htf, mtf, ltf },   -- multi-timeframe patterns
      omega_consensus: string,        -- vote summary
    }
    Written once at trade entry. Read-only thereafter (immutability enforced
    by mid_trade_plan_immutability_guard trigger below).

  ### 2. alpha_decisions — backfill trade_id
  Add index to speed up FK lookups.

  ### Security
  - No new RLS policies needed: goal_session_trades RLS already covers these columns
  - Service role retains full access for alpha-trade-executor writes

  ### SSOT Compliance
  - mid_trade_plan is the SINGLE SOURCE OF TRUTH for Alpha's trade plan
  - Mid-trade monitor reads ONLY from this column, never re-derives from alpha_decisions
  - This eliminates all LLM calls for the 13 trigger evaluations
*/

-- 1. Add new columns to goal_session_trades
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'alpha_decision_id'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN alpha_decision_id uuid REFERENCES alpha_decisions(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'invalidation_price'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN invalidation_price numeric;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'alpha_reasoning_snapshot'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN alpha_reasoning_snapshot text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'market_regime_at_entry'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN market_regime_at_entry text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'mid_trade_plan'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN mid_trade_plan jsonb DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- 2. Index for FK lookups from mid-trade monitor
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_alpha_decision_id
  ON goal_session_trades(alpha_decision_id)
  WHERE alpha_decision_id IS NOT NULL;

-- 3. Index for mid_trade_plan queries (GIN for jsonb)
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_mid_trade_plan
  ON goal_session_trades USING GIN(mid_trade_plan)
  WHERE mid_trade_plan IS NOT NULL AND mid_trade_plan != '{}'::jsonb;

-- 4. Immutability guard: mid_trade_plan must not be overwritten once set
--    (allows initial write from NULL → value, blocks subsequent overwrites)
CREATE OR REPLACE FUNCTION enforce_mid_trade_plan_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Allow write if previously NULL or empty
  IF OLD.mid_trade_plan IS NULL OR OLD.mid_trade_plan = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  -- Block overwrite of existing plan (immutability principle)
  IF NEW.mid_trade_plan IS DISTINCT FROM OLD.mid_trade_plan THEN
    NEW.mid_trade_plan := OLD.mid_trade_plan;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mid_trade_plan_immutability ON goal_session_trades;
CREATE TRIGGER trg_mid_trade_plan_immutability
  BEFORE UPDATE ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION enforce_mid_trade_plan_immutability();

-- 5. Also update alpha_decisions.trade_id index for reverse-lookup performance
CREATE INDEX IF NOT EXISTS idx_alpha_decisions_trade_id
  ON alpha_decisions(trade_id)
  WHERE trade_id IS NOT NULL;
