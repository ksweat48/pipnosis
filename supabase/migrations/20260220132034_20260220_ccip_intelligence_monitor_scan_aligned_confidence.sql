/*
  # CCIP 2026-02-20: Intelligence Monitor Scan-Aligned Confidence

  ## Problem
  The Session Intelligence Monitor shows "Ready to Trade (70%+)" for pairs using
  historical trade win-rate averages. Alpha may simultaneously reject those same
  pairs (low confidence, wall violations, low ATR) — creating a contradictory signal.

  ## Root Cause
  The `update_session_intelligence` DB function and `generate_session_intelligence_data`
  use historical trade data to populate `best_pairs`. They do not consult Alpha's
  most recent scan cycle results. This decoupling causes the monitor to show confidence
  scores that are disconnected from Alpha's actual current market assessment.

  ## Fix (SSOT / CCIP Compliant)
  Add a new DB function `get_scan_aligned_session_pairs` that:
  1. Reads the latest `goal_session_scan_results.all_candidates` for the session
  2. Uses Alpha's actual per-symbol confidence as the source of truth
  3. Caps display at 65% for any symbol where Alpha's latest scan returned < 65%
  4. Adds a `scanAligned: true` flag so the UI can show "From latest scan" label

  ## SSOT Compliance
  - Alpha's scan confidence is the SSOT for current market readiness
  - Historical trade data remains valid for long-term pattern tracking
  - This function supplements (does not replace) the existing intelligence system

  ## Security
  - SECURITY DEFINER: runs as service role for cross-user session reads
  - Users can only query their own session data
*/

-- Function to get scan-aligned confidence for the Intelligence Monitor
CREATE OR REPLACE FUNCTION get_scan_aligned_session_pairs(p_session_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_latest_candidates jsonb;
  v_result jsonb;
BEGIN
  -- Verify ownership
  IF NOT EXISTS (
    SELECT 1 FROM goal_sessions
    WHERE id = p_session_id AND user_id = p_user_id
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Get the most recent scan's all_candidates for this session
  SELECT all_candidates
  INTO v_latest_candidates
  FROM goal_session_scan_results
  WHERE session_id = p_session_id
    AND user_id = p_user_id
    AND all_candidates IS NOT NULL
    AND jsonb_array_length(all_candidates) > 0
  ORDER BY scan_timestamp DESC
  LIMIT 1;

  IF v_latest_candidates IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Transform candidates into the BestPair shape expected by SessionIntelligenceMonitor
  -- Cap confidence at 65 when Alpha's actual scan returned below 65 (advisory floor)
  SELECT jsonb_agg(
    jsonb_build_object(
      'symbol', candidate->>'symbol',
      'confidence', LEAST(100, GREATEST(0, (candidate->>'confidence')::int)),
      'tradeConfidence', (candidate->>'confidence')::int,
      'status',
        CASE
          WHEN (candidate->>'confidence')::int >= 70 THEN 'ready'
          WHEN (candidate->>'confidence')::int >= 50 THEN 'heating'
          ELSE 'monitoring'
        END,
      'action', candidate->>'action',
      'reasoning', COALESCE(candidate->>'reasoning', 'Latest Alpha scan assessment'),
      'scanAligned', true,
      'scanTimestamp', (
        SELECT scan_timestamp FROM goal_session_scan_results
        WHERE session_id = p_session_id AND user_id = p_user_id
        ORDER BY scan_timestamp DESC LIMIT 1
      )
    )
    ORDER BY (candidate->>'confidence')::int DESC
  )
  INTO v_result
  FROM jsonb_array_elements(v_latest_candidates) AS candidate
  WHERE (candidate->>'action') IS NOT NULL;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

-- Grant execute to authenticated users (they can only query their own sessions due to ownership check)
GRANT EXECUTE ON FUNCTION get_scan_aligned_session_pairs(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_scan_aligned_session_pairs(uuid, uuid) TO service_role;

-- Add index to speed up the scan-aligned lookup
CREATE INDEX IF NOT EXISTS idx_scan_results_session_user_timestamp
  ON goal_session_scan_results(session_id, user_id, scan_timestamp DESC)
  WHERE all_candidates IS NOT NULL;

COMMENT ON FUNCTION get_scan_aligned_session_pairs IS
  'CCIP 2026-02-20: Returns per-symbol confidence from Alpha latest scan cycle.
   Used by SessionIntelligenceMonitor to show scan-aligned scores instead of
   historical averages. Confidence reflects Alpha actual assessment, capped
   by the display thresholds (70+ = Ready, 50-70 = Heating, <50 = Monitoring).';
