/*
  # Force PostgREST Schema Reload for Entry Tables

  1. Purpose
    - Forces PostgREST to recognize newly created entry system tables
    - Adds table comments to trigger schema cache refresh

  2. Changes
    - Add comments to all entry system tables
    - Verify RLS and permissions are properly registered
*/

-- Add comments to force PostgREST schema reload
COMMENT ON TABLE entry_intents IS 'Tracks AI entry intents with urgency classification and monitoring status';
COMMENT ON TABLE entry_monitoring_logs IS 'Real-time logs of entry monitoring progress and price checks';
COMMENT ON TABLE entry_quality_scores IS 'Measures execution quality and slippage for learning feedback';

-- Verify RLS is enabled (should already be, but ensuring it)
ALTER TABLE entry_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_monitoring_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE entry_quality_scores ENABLE ROW LEVEL SECURITY;

-- Ensure service role can access for monitoring
GRANT SELECT, INSERT, UPDATE ON entry_intents TO service_role;
GRANT SELECT, INSERT ON entry_monitoring_logs TO service_role;
GRANT SELECT, INSERT ON entry_quality_scores TO service_role;

-- Force PostgREST to reload schema
NOTIFY pgrst, 'reload schema';