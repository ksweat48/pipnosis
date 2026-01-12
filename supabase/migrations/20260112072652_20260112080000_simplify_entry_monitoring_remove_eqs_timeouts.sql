/*
  # Simplify Entry Monitoring System - Remove EQS and Timeouts

  ## Changes
  1. Add manual entry tracking columns to entry_intents table
  2. Make timeout-related columns nullable (no longer enforced)
  3. Add no_expiration flag (defaults to true - intents stay active until user action)
  4. Preserve EQS columns for historical data but don't require them

  ## Migration Notes
  - EQS columns preserved (eqs_score, eqs_breakdown) but not populated by monitoring
  - Timeout columns remain but are no longer enforced
  - All active intents converted to no_expiration = true
  - Manual entry tracking added for user-initiated execution
*/

-- Add manual entry tracking columns
ALTER TABLE entry_intents
ADD COLUMN IF NOT EXISTS manual_entry_requested BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS manual_entry_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS no_expiration BOOLEAN DEFAULT TRUE;

-- Make timeout-related columns nullable (backwards compatible)
ALTER TABLE entry_intents
ALTER COLUMN timeout_minutes DROP NOT NULL,
ALTER COLUMN timeout_at DROP NOT NULL;

-- Update existing active intents to no_expiration mode
UPDATE entry_intents
SET no_expiration = TRUE
WHERE status = 'monitoring' AND no_expiration IS NULL;

-- Add comment explaining the new flow
COMMENT ON COLUMN entry_intents.no_expiration IS 'When true, intent stays active until user manually enters or cancels (no timeout)';
COMMENT ON COLUMN entry_intents.manual_entry_requested IS 'True when user clicked manual entry button';
COMMENT ON COLUMN entry_intents.manual_entry_at IS 'Timestamp when user manually requested entry execution';
COMMENT ON COLUMN entry_intents.eqs_score IS 'DEPRECATED: Entry Quality Score - preserved for historical data but not actively used';
COMMENT ON COLUMN entry_intents.eqs_breakdown IS 'DEPRECATED: EQS breakdown - preserved for historical data but not actively used';

-- Update entry_monitoring_logs to clarify EQS is optional
COMMENT ON TABLE entry_monitoring_logs IS 'Entry monitoring event log - EQS fields are optional and no longer calculated during monitoring';