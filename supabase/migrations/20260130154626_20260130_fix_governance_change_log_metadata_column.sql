/*
  # Fix Governance Change Log - Add Missing Metadata Column

  Adds metadata column to governance_change_log table for storing additional context
  about state transitions (e.g., count of items affected, reasons, diagnostic info).
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'governance_change_log' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE governance_change_log ADD COLUMN metadata jsonb;
  END IF;
END $$;
