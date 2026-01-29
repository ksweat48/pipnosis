/*
  # CCIP Compliance: Normalize Existing Timeframes Before Adding Constraint

  1. Problem
    - Existing goal_sessions may have invalid timeframes like '1 day', '1h', etc.
    - Cannot add CHECK constraint until all rows are valid

  2. Solution
    - Normalize all existing timeframes to canonical format (M1, M5, M15, M30, H1, H4, D1)
    - Uses same normalization logic as generateTimeframe() authority
    - Map legacy formats to their canonical equivalents

  3. Normalization Rules
    - '1m', 'm1', '1M', 'M1' → 'M1'
    - '5m', 'm5', '5M', 'M5' → 'M5'
    - '15m', 'm15', '15M', 'M15' → 'M15'
    - '30m', 'm30', '30M', 'M30' → 'M30'
    - '1h', 'h1', '1H', 'H1' → 'H1'
    - '1 hour' → 'H1'
    - '4h', 'h4', '4H', 'H4' → 'H4'
    - '1d', 'd1', '1D', 'D1' → 'D1'
    - '1 day', '1day' → 'D1'
    - NULL/empty → 'M15' (default)
    - Anything else → 'M15' (safe default)
*/

DO $$
DECLARE
  v_invalid_count INTEGER := 0;
  v_normalized_count INTEGER := 0;
  v_valid_timeframes TEXT[] := ARRAY['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
BEGIN
  -- Step 1: Count invalid timeframes
  SELECT COUNT(*) INTO v_invalid_count
  FROM goal_sessions
  WHERE timeframe IS NULL
    OR timeframe = ''
    OR NOT (timeframe = ANY(v_valid_timeframes));

  IF v_invalid_count > 0 THEN
    RAISE NOTICE 'Found % invalid or NULL timeframes in goal_sessions', v_invalid_count;

    -- Step 2: Normalize invalid timeframes using CCIP mapping logic
    UPDATE goal_sessions SET timeframe = CASE
      -- Already valid, keep as-is
      WHEN timeframe = ANY(v_valid_timeframes) THEN timeframe

      -- Lowercase short formats
      WHEN LOWER(timeframe) IN ('1m', 'm1') THEN 'M1'
      WHEN LOWER(timeframe) IN ('5m', 'm5') THEN 'M5'
      WHEN LOWER(timeframe) IN ('15m', 'm15') THEN 'M15'
      WHEN LOWER(timeframe) IN ('30m', 'm30') THEN 'M30'
      WHEN LOWER(timeframe) IN ('1h', 'h1') THEN 'H1'
      WHEN LOWER(timeframe) IN ('4h', 'h4') THEN 'H4'
      WHEN LOWER(timeframe) IN ('1d', 'd1') THEN 'D1'

      -- Natural language formats
      WHEN LOWER(timeframe) IN ('1 hour', '1hour', '1 h') THEN 'H1'
      WHEN LOWER(timeframe) IN ('1 day', '1day', '1 d') THEN 'D1'
      WHEN LOWER(timeframe) IN ('1 week', '1week', '1 w') THEN 'D1'
      WHEN LOWER(timeframe) IN ('1 month', '1month') THEN 'D1'

      -- Mixed case formats (case-insensitive)
      WHEN LOWER(timeframe) IN ('m1', '1m') THEN 'M1'
      WHEN LOWER(timeframe) IN ('h1', '1h') THEN 'H1'
      WHEN LOWER(timeframe) IN ('d1', '1d') THEN 'D1'

      -- NULL or empty strings → safe default
      WHEN timeframe IS NULL OR timeframe = '' THEN 'M15'

      -- Anything else unrecognized → safe default
      ELSE 'M15'
    END
    WHERE timeframe IS NULL
      OR timeframe = ''
      OR NOT (timeframe = ANY(v_valid_timeframes));

    GET DIAGNOSTICS v_normalized_count = ROW_COUNT;
    RAISE NOTICE 'Normalized % timeframe values to CCIP canonical format', v_normalized_count;
  ELSE
    RAISE NOTICE 'All existing timeframes are already valid (no normalization needed)';
  END IF;

  -- Step 3: Verify all timeframes are now valid
  SELECT COUNT(*) INTO v_invalid_count
  FROM goal_sessions
  WHERE NOT (timeframe = ANY(v_valid_timeframes));

  IF v_invalid_count = 0 THEN
    RAISE NOTICE 'CCIP validation complete: All timeframes are now canonical';
  ELSE
    RAISE WARNING 'CCIP validation failed: % invalid timeframes remain', v_invalid_count;
  END IF;
END $$;
