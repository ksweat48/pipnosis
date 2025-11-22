/*
  # Fix Schema Mismatches Causing 400 Bad Request Errors

  ## Problem
  The backtest system is generating trades but failing to save them because:
  1. ai_pattern_ev_tracking: Code queries `current_ev` and `occurrences` but table has `expected_value` and `sample_size`
  2. ai_confidence_calibration: Code queries `calibration_accuracy` and `confidence_bias` but table has `calibration_score` and other columns
  3. trade_history: Missing `ai_validated` column that code tries to insert

  ## Errors Fixed
  - GET /ai_pattern_ev_tracking?select=pattern_name,current_ev,occurrences 400 Bad Request
  - GET /ai_confidence_calibration?select=calibration_accuracy,confidence_bias 400 Bad Request
  - POST /trade_history 400 Bad Request (40+ failures)

  ## Solution
  Add missing columns and create views/aliases to match code expectations.
  Use ALTER TABLE ADD COLUMN IF NOT EXISTS for safety.

  ## Tables Modified
  1. ai_pattern_ev_tracking - Add current_ev, occurrences columns
  2. ai_confidence_calibration - Add calibration_accuracy, confidence_bias, symbol columns
  3. trade_history - Ensure ai_validated column exists

  ## Security
  - Maintains existing RLS policies
  - No data loss - only adds columns
  - Safe to run multiple times (IF NOT EXISTS)
*/

-- ============================================================================
-- STEP 1: Fix ai_pattern_ev_tracking schema
-- ============================================================================

DO $$
BEGIN
  -- Add current_ev as alias for expected_value
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_pattern_ev_tracking' AND column_name = 'current_ev'
  ) THEN
    ALTER TABLE ai_pattern_ev_tracking ADD COLUMN current_ev numeric(12,2);
    UPDATE ai_pattern_ev_tracking SET current_ev = expected_value WHERE current_ev IS NULL;
    ALTER TABLE ai_pattern_ev_tracking ALTER COLUMN current_ev SET NOT NULL;
    RAISE NOTICE 'Added current_ev column to ai_pattern_ev_tracking';
  END IF;

  -- Add occurrences as alias for sample_size
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_pattern_ev_tracking' AND column_name = 'occurrences'
  ) THEN
    ALTER TABLE ai_pattern_ev_tracking ADD COLUMN occurrences integer;
    UPDATE ai_pattern_ev_tracking SET occurrences = sample_size WHERE occurrences IS NULL;
    ALTER TABLE ai_pattern_ev_tracking ALTER COLUMN occurrences SET NOT NULL;
    ALTER TABLE ai_pattern_ev_tracking ALTER COLUMN occurrences SET DEFAULT 0;
    RAISE NOTICE 'Added occurrences column to ai_pattern_ev_tracking';
  END IF;
END $$;

-- Create trigger to keep current_ev and occurrences in sync with expected_value and sample_size
CREATE OR REPLACE FUNCTION sync_ai_pattern_ev_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.expected_value IS DISTINCT FROM OLD.expected_value THEN
    NEW.current_ev := NEW.expected_value;
  ELSIF NEW.current_ev IS DISTINCT FROM OLD.current_ev THEN
    NEW.expected_value := NEW.current_ev;
  END IF;

  IF NEW.sample_size IS DISTINCT FROM OLD.sample_size THEN
    NEW.occurrences := NEW.sample_size;
  ELSIF NEW.occurrences IS DISTINCT FROM OLD.occurrences THEN
    NEW.sample_size := NEW.occurrences;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_ai_pattern_ev_trigger ON ai_pattern_ev_tracking;
CREATE TRIGGER sync_ai_pattern_ev_trigger
  BEFORE INSERT OR UPDATE ON ai_pattern_ev_tracking
  FOR EACH ROW
  EXECUTE FUNCTION sync_ai_pattern_ev_columns();

-- ============================================================================
-- STEP 2: Fix ai_confidence_calibration schema
-- ============================================================================

DO $$
BEGIN
  -- Add calibration_accuracy column (0-100 score)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_confidence_calibration' AND column_name = 'calibration_accuracy'
  ) THEN
    ALTER TABLE ai_confidence_calibration ADD COLUMN calibration_accuracy numeric(5,2) DEFAULT 50.0;
    UPDATE ai_confidence_calibration
    SET calibration_accuracy = COALESCE(calibration_score, 50.0)
    WHERE calibration_accuracy IS NULL OR calibration_accuracy = 50.0;
    RAISE NOTICE 'Added calibration_accuracy column to ai_confidence_calibration';
  END IF;

  -- Add confidence_bias column (positive = overconfident, negative = underconfident)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_confidence_calibration' AND column_name = 'confidence_bias'
  ) THEN
    ALTER TABLE ai_confidence_calibration ADD COLUMN confidence_bias numeric(6,2) DEFAULT 0;
    UPDATE ai_confidence_calibration
    SET confidence_bias = COALESCE(confidence_error, 0)
    WHERE confidence_bias = 0;
    RAISE NOTICE 'Added confidence_bias column to ai_confidence_calibration';
  END IF;
END $$;

-- Create trigger to sync calibration_accuracy with calibration_score
CREATE OR REPLACE FUNCTION sync_confidence_calibration_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.calibration_score IS DISTINCT FROM OLD.calibration_score THEN
    NEW.calibration_accuracy := NEW.calibration_score;
  ELSIF NEW.calibration_accuracy IS DISTINCT FROM OLD.calibration_accuracy THEN
    NEW.calibration_score := NEW.calibration_accuracy;
  END IF;

  IF NEW.confidence_error IS DISTINCT FROM OLD.confidence_error THEN
    NEW.confidence_bias := NEW.confidence_error;
  ELSIF NEW.confidence_bias IS DISTINCT FROM OLD.confidence_bias THEN
    NEW.confidence_error := NEW.confidence_bias;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_confidence_calibration_trigger ON ai_confidence_calibration;
CREATE TRIGGER sync_confidence_calibration_trigger
  BEFORE INSERT OR UPDATE ON ai_confidence_calibration
  FOR EACH ROW
  EXECUTE FUNCTION sync_confidence_calibration_columns();

-- ============================================================================
-- STEP 3: Ensure trade_history has ai_validated column
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history' AND column_name = 'ai_validated'
  ) THEN
    ALTER TABLE trade_history ADD COLUMN ai_validated boolean DEFAULT false;
    CREATE INDEX IF NOT EXISTS idx_trade_history_ai_validated
      ON trade_history(user_id, ai_validated)
      WHERE ai_validated = false;
    RAISE NOTICE 'Added ai_validated column to trade_history';
  ELSE
    RAISE NOTICE 'ai_validated column already exists in trade_history';
  END IF;
END $$;

-- ============================================================================
-- STEP 4: Create indexes for new columns
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_ai_pattern_ev_current_ev
  ON ai_pattern_ev_tracking(user_id, symbol, current_ev DESC);

CREATE INDEX IF NOT EXISTS idx_ai_pattern_ev_occurrences
  ON ai_pattern_ev_tracking(occurrences DESC)
  WHERE pattern_status = 'active';

CREATE INDEX IF NOT EXISTS idx_ai_confidence_calibration_accuracy
  ON ai_confidence_calibration(user_id, symbol, calibration_accuracy DESC);

CREATE INDEX IF NOT EXISTS idx_ai_confidence_bias
  ON ai_confidence_calibration(user_id, confidence_bias);
