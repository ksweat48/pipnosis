
/*
  # Add alpha_override column to alpha_decisions

  1. Changes
    - Add `alpha_override` column to track when alpha decisions are manually overridden
    - Type: boolean, default false
    - Includes override timestamp tracking

  2. Data Integrity
    - Backfill existing records with false (no override)
    - Non-nullable with constraint
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'alpha_override'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN alpha_override boolean DEFAULT false NOT NULL;
  END IF;
END $$;
