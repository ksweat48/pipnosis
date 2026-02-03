/*
  # Session Intelligence Update Triggers

  ## Overview
  Adds automatic triggers to regenerate session intelligence when
  trade data changes, keeping the Real-Time Intelligence monitor fresh.

  ## Changes
  1. Trigger on trade insertions to update intelligence
  2. Rate-limited to avoid excessive updates
  3. Graceful error handling

  ## SSOT Compliance
  - Single authoritative update function
  - Respects existing data freshness rules
  - No duplicate logic

  ## Production Safety
  - Rate limited (max once per 2 minutes)
  - Non-blocking (wrapped in try-catch equivalent)
  - No cascade failures
*/

-- Trigger function to update session intelligence when new trades arrive
CREATE OR REPLACE FUNCTION trigger_update_session_intelligence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only update if last data is older than 2 minutes
  -- This prevents excessive updates while keeping data fresh
  IF NOT EXISTS (
    SELECT 1 FROM session_intelligence_data
    WHERE created_at > now() - interval '2 minutes'
  ) THEN
    BEGIN
      PERFORM update_session_intelligence();
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to update session intelligence: %', SQLERRM;
      -- Don't fail the trade insertion
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger on goal_session_trades insert
DROP TRIGGER IF EXISTS trg_update_session_intelligence_on_trade ON goal_session_trades;

CREATE TRIGGER trg_update_session_intelligence_on_trade
AFTER INSERT ON goal_session_trades
FOR EACH ROW
WHEN (NEW.status = 'open')
EXECUTE FUNCTION trigger_update_session_intelligence();

-- Grant execute on all related functions
GRANT EXECUTE ON FUNCTION trigger_update_session_intelligence() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_session_intelligence() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION generate_session_intelligence_data() TO authenticated, service_role;
