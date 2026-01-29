/*
  # Real-Time Intelligence System - CCIP Compliant

  ## Overview
  Transforms Session Intelligence from hardcoded session forecasts to real-time
  indicator-based probability calculations.

  ## Changes
  1. Add index for faster queries on created_at
  2. Update cleanup function to handle 3-minute expiration (was 2 hours)

  ## SSOT Compliance
  - Single calculator service owns all probability calculations
  - No business logic in database
  - Read-only display data for UI
  - Replaces hardcoded probabilities with calculated ones

  ## Backward Compatibility
  - Existing best_pairs structure preserved
  - New fields are additive (won't break existing queries)
  - UI will gracefully handle missing indicator_breakdown
  - Table schema unchanged (only JSONB structure enhanced)
*/

-- Add index for faster queries on created_at (if not exists from previous migration)
CREATE INDEX IF NOT EXISTS idx_session_intelligence_created_at
  ON session_intelligence_data(created_at DESC);

-- Update cleanup function to handle 3-minute expiration
CREATE OR REPLACE FUNCTION cleanup_expired_session_intelligence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM session_intelligence_data
  WHERE expires_at < now() - interval '5 minutes';

  RAISE NOTICE 'Cleaned up expired session intelligence data';
END;
$$;
