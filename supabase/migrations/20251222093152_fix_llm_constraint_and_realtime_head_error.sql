/*
  # Fix LLM Token Usage Constraint and Realtime Prices HEAD Error

  ## Problem 1: LLM Token Usage Constraint
  Missing context types being used by Omega brains:
  - omega_sentiment_analysis (used by Omega-7)
  - omega8_hybrid_refinement (used by Omega-8 hybrid LLM calls)

  ## Problem 2: Realtime Prices HEAD 500 Error
  Background aggregator gets 500 error when doing HEAD requests.
  Root cause: price_validation_rejections table may not exist or have issues.

  ## Solution
  1. Add missing context types to llm_token_usage constraint
  2. Ensure price_validation_rejections table exists
  3. Make validation function more defensive

  ## Safety
  - No changes to charts, polling, candles, or ticks
  - Only fixes database constraints and error handling
  - Maintains all existing RLS policies
*/

-- =====================================================
-- FIX 1: Add Missing Context Types to LLM Token Usage
-- =====================================================

ALTER TABLE llm_token_usage
  DROP CONSTRAINT IF EXISTS llm_token_usage_context_type_check;

ALTER TABLE llm_token_usage
  ADD CONSTRAINT llm_token_usage_context_type_check CHECK (context_type IN (
    -- Original types
    'vote',
    'fusion',
    'sentiment',
    'meta_reasoning',
    'mid_trade',
    'strategy_planning',
    'execution',
    'periodic_wellness',
    'drawdown_check',
    'profit_milestone',
    -- Alpha coordination
    'alpha_coordination',
    -- Generic omega types
    'omega_vote',
    'omega9_validation',
    -- Specific omega brain vote types
    'omega_trend_vote',
    'omega_scalper_vote',
    'omega_confirmation_vote',
    'omega_reversal_vote',
    'omega_volatility_vote',
    'omega_risk_vote',
    'omega_orderflow_vote',
    'omega_sentiment_vote',
    -- NEW: Missing types being used
    'omega_sentiment_analysis',
    'omega8_hybrid_refinement',
    -- LLM health check
    'llm_health_check'
  ));

-- =====================================================
-- FIX 2: Ensure Price Validation Rejections Table Exists
-- =====================================================

-- Create table if it doesn't exist (defensive)
CREATE TABLE IF NOT EXISTS price_validation_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  price numeric NOT NULL,
  price_type text NOT NULL,
  rejection_reason text NOT NULL,
  source text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_price_validation_rejections_created_at
  ON price_validation_rejections(created_at);
CREATE INDEX IF NOT EXISTS idx_price_validation_rejections_symbol
  ON price_validation_rejections(symbol);

-- Enable RLS on price_validation_rejections
ALTER TABLE price_validation_rejections ENABLE ROW LEVEL SECURITY;

-- Drop existing policies and recreate (safe way to handle IF NOT EXISTS for policies)
DROP POLICY IF EXISTS "Service role can manage price rejections" ON price_validation_rejections;
DROP POLICY IF EXISTS "Anyone can read price rejections" ON price_validation_rejections;

-- Only service role can write rejections
CREATE POLICY "Service role can manage price rejections"
  ON price_validation_rejections
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Anyone can read rejections (for debugging)
CREATE POLICY "Anyone can read price rejections"
  ON price_validation_rejections
  FOR SELECT
  USING (true);

-- =====================================================
-- FIX 3: Make Validation Function More Defensive
-- =====================================================

-- Update validation function to never throw errors on logging failures
CREATE OR REPLACE FUNCTION validate_realtime_prices() RETURNS trigger AS $$
DECLARE
  v_valid boolean;
BEGIN
  -- Skip if not INSERT/UPDATE (defensive)
  IF TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RETURN NEW;
  END IF;

  -- Skip if NEW is null (defensive)
  IF NEW IS NULL THEN
    RETURN NEW;
  END IF;

  -- Validate bid price
  IF NEW.bid IS NOT NULL THEN
    v_valid := validate_price_range(NEW.symbol, NEW.bid::numeric);
    IF NOT v_valid THEN
      -- Try to log rejection, but don't fail if logging fails
      BEGIN
        INSERT INTO price_validation_rejections (symbol, price, price_type, rejection_reason, source)
        VALUES (NEW.symbol, NEW.bid::numeric, 'bid', 'Price outside valid range', 'realtime_price_insert');
      EXCEPTION
        WHEN OTHERS THEN
          -- Silently continue - logging is optional
          NULL;
      END;
      -- Still reject the invalid price
      RAISE EXCEPTION 'Invalid bid price % for symbol %', NEW.bid, NEW.symbol;
    END IF;
  END IF;

  -- Validate ask price
  IF NEW.ask IS NOT NULL THEN
    v_valid := validate_price_range(NEW.symbol, NEW.ask::numeric);
    IF NOT v_valid THEN
      BEGIN
        INSERT INTO price_validation_rejections (symbol, price, price_type, rejection_reason, source)
        VALUES (NEW.symbol, NEW.ask::numeric, 'ask', 'Price outside valid range', 'realtime_price_insert');
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;
      RAISE EXCEPTION 'Invalid ask price % for symbol %', NEW.ask, NEW.symbol;
    END IF;
  END IF;

  -- Validate bid < ask
  IF NEW.bid IS NOT NULL AND NEW.ask IS NOT NULL THEN
    IF NEW.bid::numeric >= NEW.ask::numeric THEN
      RAISE EXCEPTION 'Invalid price for %: bid % >= ask %', NEW.symbol, NEW.bid, NEW.ask;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION validate_realtime_prices() TO service_role;

-- =====================================================
-- Verification
-- =====================================================

DO $$
BEGIN
  -- Verify llm_token_usage constraint exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'llm_token_usage'
    AND constraint_name = 'llm_token_usage_context_type_check'
  ) THEN
    RAISE EXCEPTION 'LLM token usage constraint not created!';
  END IF;

  -- Verify price_validation_rejections table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name = 'price_validation_rejections'
  ) THEN
    RAISE EXCEPTION 'Price validation rejections table not created!';
  END IF;

  RAISE NOTICE '✅ LLM token usage constraint fixed';
  RAISE NOTICE '✅ Price validation rejections table ensured';
  RAISE NOTICE '✅ Validation function made more defensive';
  RAISE NOTICE '✅ No changes to charts, polling, or candles';
END $$;
