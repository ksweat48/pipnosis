/*
  # Fix ai_pattern_ev_tracking Schema Conflict
  
  ## Problem
  The table was created with a simplified schema by migration 20251111063000, 
  but the code expects the comprehensive schema from 20251110000000.
  
  ## Issues Fixed
  - Missing user_id column (critical for RLS and user isolation)
  - Wrong column names: win_rate → win_probability, avg_profit/avg_loss → avg_win_amount/avg_loss_amount
  - Missing volatility_regime column with CHECK constraint
  - Missing quality indicators (ev_confidence_level, is_statistically_significant, pattern_status)
  - Missing tracking timestamps (first_seen_at, last_updated_at, last_trade_at)
  - Wrong unique constraint
  - Missing proper indexes
  
  ## Solution
  Drop and recreate with correct schema from balanced profitability model.
*/

-- ============================================================================
-- STEP 1: Backup any existing data (if table exists)
-- ============================================================================
DO $$
BEGIN
  -- Create backup table if ai_pattern_ev_tracking exists and has data
  IF EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'ai_pattern_ev_tracking'
  ) THEN
    -- Check if there's any data
    IF EXISTS (SELECT 1 FROM ai_pattern_ev_tracking LIMIT 1) THEN
      -- Create backup
      CREATE TABLE IF NOT EXISTS ai_pattern_ev_tracking_backup_20251115 AS 
      SELECT * FROM ai_pattern_ev_tracking;
      
      RAISE NOTICE 'Backed up existing data to ai_pattern_ev_tracking_backup_20251115';
    END IF;
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Drop existing table and all dependencies
-- ============================================================================
DROP TABLE IF EXISTS ai_pattern_ev_tracking CASCADE;

-- ============================================================================
-- STEP 3: Create table with correct schema
-- ============================================================================
CREATE TABLE ai_pattern_ev_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,

  -- Pattern identification
  pattern_name text NOT NULL,
  symbol text NOT NULL,
  timeframe text DEFAULT 'H1',
  volatility_regime text CHECK (volatility_regime IN ('low', 'medium', 'high')),

  -- EV tracking (CORRECT column names)
  expected_value numeric(12,2) NOT NULL,
  win_probability numeric(5,2) NOT NULL,
  avg_win_amount numeric(12,2) NOT NULL,
  avg_loss_amount numeric(12,2) NOT NULL,

  -- Performance metrics
  sample_size integer NOT NULL,
  win_count integer DEFAULT 0,
  loss_count integer DEFAULT 0,
  avg_rr numeric(10,2) DEFAULT 0,
  profit_factor numeric(10,2) DEFAULT 0,

  -- Quality indicators
  ev_confidence_level text DEFAULT 'low' CHECK (ev_confidence_level IN ('low', 'medium', 'high')),
  is_statistically_significant boolean DEFAULT false,
  pattern_status text DEFAULT 'active' CHECK (pattern_status IN ('active', 'degraded', 'paused', 'archived')),

  -- Tracking timestamps
  first_seen_at timestamptz DEFAULT now(),
  last_updated_at timestamptz DEFAULT now(),
  last_trade_at timestamptz,

  -- Metadata
  created_at timestamptz DEFAULT now(),

  -- Correct unique constraint for upsert operations
  UNIQUE(user_id, pattern_name, symbol, volatility_regime)
);

-- ============================================================================
-- STEP 4: Create indexes for performance
-- ============================================================================
CREATE INDEX idx_ai_pattern_ev_user_symbol
  ON ai_pattern_ev_tracking(user_id, symbol, expected_value DESC);

CREATE INDEX idx_ai_pattern_ev_status
  ON ai_pattern_ev_tracking(user_id, pattern_status, expected_value DESC);

CREATE INDEX idx_ai_pattern_ev_value
  ON ai_pattern_ev_tracking(expected_value DESC)
  WHERE pattern_status = 'active';

-- Index for fast lookups by pattern name
CREATE INDEX idx_ai_pattern_ev_pattern_name
  ON ai_pattern_ev_tracking(user_id, pattern_name);

-- Index for volatility regime queries
CREATE INDEX idx_ai_pattern_ev_volatility
  ON ai_pattern_ev_tracking(volatility_regime, expected_value DESC)
  WHERE pattern_status = 'active';

-- ============================================================================
-- STEP 5: Enable RLS
-- ============================================================================
ALTER TABLE ai_pattern_ev_tracking ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- STEP 6: Create RLS policies
-- ============================================================================
-- Users can view their own pattern EV data
CREATE POLICY "Users can view own pattern EV"
  ON ai_pattern_ev_tracking FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own pattern EV data
CREATE POLICY "Users can insert own pattern EV"
  ON ai_pattern_ev_tracking FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own pattern EV data
CREATE POLICY "Users can update own pattern EV"
  ON ai_pattern_ev_tracking FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own pattern EV data
CREATE POLICY "Users can delete own pattern EV"
  ON ai_pattern_ev_tracking FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================================
-- STEP 7: Recreate the get_pattern_ev() function
-- ============================================================================
CREATE OR REPLACE FUNCTION get_pattern_ev(
  p_user_id uuid,
  p_pattern_name text,
  p_symbol text,
  p_volatility_regime text DEFAULT NULL
)
RETURNS numeric AS $$
DECLARE
  v_ev numeric;
BEGIN
  SELECT expected_value INTO v_ev
  FROM ai_pattern_ev_tracking
  WHERE user_id = p_user_id
    AND pattern_name = p_pattern_name
    AND symbol = p_symbol
    AND (p_volatility_regime IS NULL OR volatility_regime = p_volatility_regime)
    AND pattern_status = 'active'
  ORDER BY last_updated_at DESC
  LIMIT 1;

  RETURN COALESCE(v_ev, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- STEP 8: Add helpful comments
-- ============================================================================
COMMENT ON TABLE ai_pattern_ev_tracking IS 'Tracks Expected Value for trading patterns over time with user isolation';
COMMENT ON COLUMN ai_pattern_ev_tracking.user_id IS 'User who owns this pattern data (required for RLS)';
COMMENT ON COLUMN ai_pattern_ev_tracking.expected_value IS 'EV = (Win Prob × Avg Win) - ((1 - Win Prob) × Avg Loss)';
COMMENT ON COLUMN ai_pattern_ev_tracking.win_probability IS 'Probability of winning trades (0-100 as decimal)';
COMMENT ON COLUMN ai_pattern_ev_tracking.avg_win_amount IS 'Average dollar amount per winning trade';
COMMENT ON COLUMN ai_pattern_ev_tracking.avg_loss_amount IS 'Average dollar amount per losing trade (absolute value)';
COMMENT ON COLUMN ai_pattern_ev_tracking.volatility_regime IS 'Market volatility context: low, medium, or high';
COMMENT ON COLUMN ai_pattern_ev_tracking.pattern_status IS 'Current status: active (trading), degraded (EV dropped), paused, archived';

COMMENT ON FUNCTION get_pattern_ev IS 'Retrieves Expected Value for a specific pattern, symbol, and optional volatility regime';

-- ============================================================================
-- STEP 9: Verify the schema is correct
-- ============================================================================
DO $$
DECLARE
  v_column_count integer;
  v_has_user_id boolean;
  v_has_avg_loss_amount boolean;
  v_has_win_probability boolean;
  v_has_volatility_regime boolean;
BEGIN
  -- Count columns
  SELECT COUNT(*) INTO v_column_count
  FROM information_schema.columns
  WHERE table_name = 'ai_pattern_ev_tracking';

  -- Check critical columns exist
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_pattern_ev_tracking' AND column_name = 'user_id'
  ) INTO v_has_user_id;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_pattern_ev_tracking' AND column_name = 'avg_loss_amount'
  ) INTO v_has_avg_loss_amount;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_pattern_ev_tracking' AND column_name = 'win_probability'
  ) INTO v_has_win_probability;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_pattern_ev_tracking' AND column_name = 'volatility_regime'
  ) INTO v_has_volatility_regime;

  -- Report results
  RAISE NOTICE '=== Schema Verification ===';
  RAISE NOTICE 'Total columns: %', v_column_count;
  RAISE NOTICE 'Has user_id: %', v_has_user_id;
  RAISE NOTICE 'Has avg_loss_amount: %', v_has_avg_loss_amount;
  RAISE NOTICE 'Has win_probability: %', v_has_win_probability;
  RAISE NOTICE 'Has volatility_regime: %', v_has_volatility_regime;

  -- Verify all critical columns exist
  IF NOT (v_has_user_id AND v_has_avg_loss_amount AND v_has_win_probability AND v_has_volatility_regime) THEN
    RAISE EXCEPTION 'Schema verification failed! Missing critical columns.';
  END IF;

  RAISE NOTICE '✅ Schema verification passed! All critical columns present.';
END $$;
