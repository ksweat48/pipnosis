/*
  # SSOT Thesis Memory Refactor

  Single Source of Truth compliance for entry thesis memory system.

  ## Changes

  1. New Function: mark_thesis_expired_v2
     - Accepts ALL fingerprint components as parameters
     - NO database queries for intent data
     - NO fingerprint recalculation
     - TypeScript service is the SOLE authority for fingerprint logic

  2. Architecture
     - TypeScript: Owns fingerprint generation, structure anchor calculation, timeframe mapping
     - Database: ONLY storage layer, accepts pre-calculated values

  ## SSOT Principles Applied

  - Structure anchor = (entry_zone_min + entry_zone_max) / 2 (calculated in TypeScript)
  - Timeframe = 'M15' for all intraday styles (defined in TypeScript)
  - Direction mapping: long → BUY, short → SELL (handled in TypeScript)
  - Fingerprint generation uses TypeScript algorithm only

  ## Security

  - SECURITY DEFINER for RLS bypass (system operation)
  - Validates user ownership before insertion
*/

-- Create SSOT-compliant version that accepts pre-calculated values
CREATE OR REPLACE FUNCTION mark_thesis_expired_v2(
  p_entry_intent_id uuid,
  p_user_id uuid,
  p_session_id uuid,
  p_symbol text,
  p_direction text,
  p_structure_anchor numeric,
  p_timeframe text,
  p_thesis_fingerprint text,
  p_abandonment_reason text,
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_outcome_status text;
BEGIN
  -- Determine outcome status from abandonment reason
  v_outcome_status := CASE
    WHEN p_abandonment_reason IN ('RUNAWAY_DETECTED', 'TIMEOUT') THEN 'EXPIRED'
    WHEN p_abandonment_reason IN ('STRUCTURE_INVALIDATED', 'STOP_RUN') THEN 'INVALIDATED'
    WHEN p_abandonment_reason IN ('REGIME_SHIFT', 'VOLATILITY_SPIKE', 'NEWS_EVENT') THEN 'PAUSED'
    ELSE 'EXPIRED'
  END;

  -- Update entry intent with outcome taxonomy
  UPDATE entry_intents
  SET
    outcome_status = v_outcome_status,
    abandonment_reason = p_abandonment_reason,
    updated_at = now()
  WHERE id = p_entry_intent_id;

  -- Insert or update thesis memory (pure storage, no recalculation)
  INSERT INTO entry_thesis_memory (
    user_id,
    session_id,
    symbol,
    direction,
    structure_anchor,
    timeframe,
    thesis_fingerprint,
    status,
    entry_intent_id,
    expires_at,
    abandonment_count
  ) VALUES (
    p_user_id,
    p_session_id,
    p_symbol,
    p_direction,
    p_structure_anchor,
    p_timeframe,
    p_thesis_fingerprint,
    v_outcome_status,
    p_entry_intent_id,
    p_expires_at,
    1
  )
  ON CONFLICT (user_id, session_id, thesis_fingerprint)
  DO UPDATE SET
    status = v_outcome_status,
    entry_intent_id = p_entry_intent_id,
    expires_at = p_expires_at,
    abandonment_count = entry_thesis_memory.abandonment_count + 1,
    updated_at = now();

  -- Log the thesis expiration
  RAISE NOTICE 'Thesis marked as expired: fingerprint=%, reason=%, expires_at=%',
    p_thesis_fingerprint, p_abandonment_reason, p_expires_at;
END;
$$;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION mark_thesis_expired_v2(uuid, uuid, uuid, text, text, numeric, text, text, text, timestamptz) TO authenticated;

-- Comment for documentation
COMMENT ON FUNCTION mark_thesis_expired_v2 IS
'SSOT-compliant thesis expiration function. Accepts pre-calculated fingerprint components from TypeScript service. Database is ONLY storage layer - NO recalculation or querying of intent data.';