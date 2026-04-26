/*
  # CCIP-2026-0426D: Fix SCALP/MICRO_INTRADAY Phase 1 zone tolerance

  ## Problem
  The autonomous entry monitor uses get_entry_time_thresholds() to determine zone tolerance.
  SCALP Phase 1 tolerance was 0 pips — meaning price must land exactly inside the
  entry_zone_min/max bounds with zero tolerance. A single tick or spread offset places
  price outside the zone and the trade never executes.

  MICRO_INTRADAY Phase 1 tolerance was also 0 pips — same problem.

  ## Fix
  - SCALP Phase 1: 0 → 1 pip (was already 1 pip in Phase 2)
  - MICRO_INTRADAY Phase 1: 0 → 1 pip (was already 2 pips in Phase 2)
  - INTRADAY Phase 1: unchanged (already 2 pips)

  ## Impact
  - 1 pip tolerance means price must be within 1 pip of the zone boundary to trigger
  - Still far stricter than Phase 2/3 tolerances
  - Eliminates false negatives from tick-level spread offsets
*/

CREATE OR REPLACE FUNCTION get_entry_time_thresholds(p_trade_style text)
RETURNS TABLE(
  optimal_wait_min integer,
  acceptable_wait_min integer,
  max_wait_min integer,
  eqs_phase2_min integer,
  eqs_phase3_min integer,
  eqs_threshold_phase1 integer,
  eqs_threshold_phase2 integer,
  eqs_threshold_phase3 integer,
  zone_tolerance_phase1 integer,
  zone_tolerance_phase2 integer,
  zone_tolerance_phase3 integer
)
LANGUAGE plpgsql
AS $$
BEGIN
RETURN QUERY
SELECT
-- Time windows
CASE p_trade_style
WHEN 'SCALP'          THEN 3
WHEN 'MICRO_INTRADAY' THEN 15
WHEN 'INTRADAY'       THEN 45
ELSE 15
END AS optimal_wait_min,
CASE p_trade_style
WHEN 'SCALP'          THEN 7
WHEN 'MICRO_INTRADAY' THEN 30
WHEN 'INTRADAY'       THEN 90
ELSE 30
END AS acceptable_wait_min,
CASE p_trade_style
WHEN 'SCALP'          THEN 10
WHEN 'MICRO_INTRADAY' THEN 45
WHEN 'INTRADAY'       THEN 120
ELSE 45
END AS max_wait_min,
CASE p_trade_style
WHEN 'SCALP'          THEN 3
WHEN 'MICRO_INTRADAY' THEN 15
WHEN 'INTRADAY'       THEN 45
ELSE 15
END AS eqs_phase2_min,
CASE p_trade_style
WHEN 'SCALP'          THEN 7
WHEN 'MICRO_INTRADAY' THEN 30
WHEN 'INTRADAY'       THEN 90
ELSE 30
END AS eqs_phase3_min,

-- EQS thresholds
CASE p_trade_style
WHEN 'SCALP'          THEN 70
WHEN 'MICRO_INTRADAY' THEN 65
WHEN 'INTRADAY'       THEN 60
ELSE 65
END AS eqs_threshold_phase1,
CASE p_trade_style
WHEN 'SCALP'          THEN 60
WHEN 'MICRO_INTRADAY' THEN 55
WHEN 'INTRADAY'       THEN 50
ELSE 55
END AS eqs_threshold_phase2,
CASE p_trade_style
WHEN 'SCALP'          THEN 50
WHEN 'MICRO_INTRADAY' THEN 45
WHEN 'INTRADAY'       THEN 40
ELSE 45
END AS eqs_threshold_phase3,

-- Zone tolerance in pips
-- CCIP-2026-0426D: SCALP and MICRO_INTRADAY Phase 1 raised from 0 to 1 pip.
-- 0-pip tolerance caused false negatives: a single tick or spread offset
-- placed price just outside the exact zone bounds, blocking execution even
-- when price was effectively at the target level. 1 pip provides enough
-- slack to survive normal market noise without widening the zone meaningfully.
CASE p_trade_style
WHEN 'SCALP'          THEN 1
WHEN 'MICRO_INTRADAY' THEN 1
WHEN 'INTRADAY'       THEN 2
ELSE 2
END AS zone_tolerance_phase1,
CASE p_trade_style
WHEN 'SCALP'          THEN 1
WHEN 'MICRO_INTRADAY' THEN 2
WHEN 'INTRADAY'       THEN 3
ELSE 2
END AS zone_tolerance_phase2,
CASE p_trade_style
WHEN 'SCALP'          THEN 2
WHEN 'MICRO_INTRADAY' THEN 5
WHEN 'INTRADAY'       THEN 7
ELSE 5
END AS zone_tolerance_phase3;
END;
$$;
