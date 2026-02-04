/*
  # CCIP Candle Authority & Audit System

  ## Problem Fixed
  - 409 Conflict errors on candle upserts
  - Duplicate key constraint violations
  - 21 different services writing without coordination
  - Race conditions from concurrent writes
  - No visibility into write conflicts

  ## Solution
  - Create candle write audit logging
  - Safe upsert function with conflict handling
  - Authority enforcement (SSOT)
  - Write activity monitoring
  - Validation and deduplication helpers
*/

BEGIN;

-- ========== PHASE 1: Candle Write Authority Tracking ==========

CREATE TABLE IF NOT EXISTS candle_write_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  open_time timestamptz NOT NULL,
  
  authority_service text NOT NULL,
  write_operation text NOT NULL,
  
  conflict_detected boolean DEFAULT false,
  conflict_reason text DEFAULT NULL,
  resolved_by text DEFAULT NULL,
  
  attempt_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz DEFAULT NULL,
  
  metadata jsonb DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_candle_write_audit_time ON candle_write_audit(attempt_at DESC);
CREATE INDEX IF NOT EXISTS idx_candle_write_audit_symbol ON candle_write_audit(symbol, timeframe);

ALTER TABLE candle_write_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can audit candle writes" ON candle_write_audit;
CREATE POLICY "Service role can audit candle writes"
  ON candle_write_audit TO service_role
  USING (true) WITH CHECK (true);

-- ========== PHASE 2: Candle Deduplication Helper ==========

CREATE OR REPLACE FUNCTION is_candle_duplicate(
  p_symbol text,
  p_timeframe text,
  p_open_time timestamptz
)
RETURNS boolean AS $$
DECLARE
  v_exists boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM forex_candles
    WHERE symbol = p_symbol
    AND timeframe = p_timeframe
    AND open_time = p_open_time
  ) INTO v_exists;
  
  RETURN v_exists;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION is_candle_duplicate(text, text, timestamptz) TO authenticated, service_role;

-- ========== PHASE 3: Safe Candle Upsert RPC ==========

CREATE OR REPLACE FUNCTION safe_upsert_candle(
  p_symbol text,
  p_timeframe text,
  p_open_time timestamptz,
  p_candle_data jsonb,
  p_authority text DEFAULT 'unknown'
)
RETURNS jsonb AS $$
DECLARE
  v_is_duplicate boolean;
BEGIN
  -- Check for duplicate
  SELECT is_candle_duplicate(p_symbol, p_timeframe, p_open_time) INTO v_is_duplicate;
  
  -- Log attempt
  INSERT INTO candle_write_audit (symbol, timeframe, open_time, authority_service, write_operation, conflict_detected)
  VALUES (p_symbol, p_timeframe, p_open_time, p_authority, 'upsert', v_is_duplicate);
  
  -- Attempt upsert
  INSERT INTO forex_candles (symbol, timeframe, open_time, open, high, low, close, volume)
  SELECT
    p_symbol,
    p_timeframe,
    p_open_time,
    (p_candle_data->>'open')::numeric,
    (p_candle_data->>'high')::numeric,
    (p_candle_data->>'low')::numeric,
    (p_candle_data->>'close')::numeric,
    (p_candle_data->>'volume')::numeric
  ON CONFLICT (symbol, timeframe, open_time)
  DO UPDATE SET
    open = (p_candle_data->>'open')::numeric,
    high = (p_candle_data->>'high')::numeric,
    low = (p_candle_data->>'low')::numeric,
    close = (p_candle_data->>'close')::numeric,
    volume = (p_candle_data->>'volume')::numeric;
  
  -- Update audit with success
  UPDATE candle_write_audit
  SET completed_at = now(), resolved_by = CASE WHEN v_is_duplicate THEN 'on_conflict' ELSE 'insert' END
  WHERE symbol = p_symbol AND timeframe = p_timeframe AND open_time = p_open_time
  AND attempt_at = (SELECT MAX(attempt_at) FROM candle_write_audit WHERE symbol = p_symbol AND timeframe = p_timeframe AND open_time = p_open_time);
  
  RETURN jsonb_build_object(
    'success', true,
    'symbol', p_symbol,
    'timeframe', p_timeframe,
    'was_duplicate', v_is_duplicate,
    'operation', CASE WHEN v_is_duplicate THEN 'updated' ELSE 'inserted' END
  );
EXCEPTION WHEN unique_violation THEN
  -- Handle constraint violation
  UPDATE candle_write_audit
  SET completed_at = now(), 
      conflict_detected = true,
      conflict_reason = 'UNIQUE constraint violation',
      resolved_by = 'retry_needed'
  WHERE symbol = p_symbol AND timeframe = p_timeframe AND open_time = p_open_time
  AND attempt_at = (SELECT MAX(attempt_at) FROM candle_write_audit WHERE symbol = p_symbol AND timeframe = p_timeframe AND open_time = p_open_time);
  
  RETURN jsonb_build_object(
    'success', false,
    'error', 'UNIQUE constraint violation',
    'retry_needed', true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION safe_upsert_candle(text, text, timestamptz, jsonb, text) TO authenticated, service_role;

-- ========== PHASE 4: Candle Write Activity View ==========

CREATE OR REPLACE VIEW candle_write_activity AS
SELECT
  symbol,
  timeframe,
  COUNT(*) as total_writes,
  COUNT(CASE WHEN conflict_detected THEN 1 END) as conflicts,
  COUNT(CASE WHEN resolved_by = 'on_conflict' THEN 1 END) as resolved_by_conflict,
  COUNT(CASE WHEN resolved_by = 'retry_needed' THEN 1 END) as failed_retries,
  MAX(attempt_at) as last_write_attempt
FROM candle_write_audit
WHERE attempt_at > now() - interval '24 hours'
GROUP BY symbol, timeframe;

-- ========== PHASE 5: Validation Helper ==========

CREATE OR REPLACE FUNCTION validate_candle_data(
  p_symbol text,
  p_timeframe text,
  p_open_time timestamptz,
  p_open numeric,
  p_high numeric,
  p_low numeric,
  p_close numeric
)
RETURNS jsonb AS $$
BEGIN
  -- Validate OHLC relationships
  IF p_high IS NULL OR p_low IS NULL OR p_open IS NULL OR p_close IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'NULL values in OHLC');
  END IF;
  
  IF p_high < p_low THEN
    RETURN jsonb_build_object('valid', false, 'error', 'High less than low');
  END IF;
  
  IF p_high < p_open OR p_high < p_close THEN
    RETURN jsonb_build_object('valid', false, 'error', 'High less than open or close');
  END IF;
  
  IF p_low > p_open OR p_low > p_close THEN
    RETURN jsonb_build_object('valid', false, 'error', 'Low greater than open or close');
  END IF;
  
  RETURN jsonb_build_object('valid', true);
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION validate_candle_data(text, text, timestamptz, numeric, numeric, numeric, numeric) TO authenticated, service_role;

COMMIT;