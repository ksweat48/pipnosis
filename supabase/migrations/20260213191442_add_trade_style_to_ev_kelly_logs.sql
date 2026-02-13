/*
  # Add trade_style column to EV and Kelly sizing logs

  1. Modified Tables
    - `ev_gate_log`
      - Add `trade_style` (text, nullable) - tracks which style (SCALP/MICRO_INTRADAY/INTRADAY) was evaluated
    - `kelly_sizing_log`
      - Add `trade_style` (text, nullable) - tracks which style was used for historical stats lookup

  2. Security
    - No RLS changes (existing policies remain)

  3. Important Notes
    - Nullable because historical rows will not have this data
    - Used for per-style EV tracking and leak detection
    - Columns are advisory metadata - no constraints needed
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ev_gate_log' AND column_name = 'trade_style'
  ) THEN
    ALTER TABLE ev_gate_log ADD COLUMN trade_style text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kelly_sizing_log' AND column_name = 'trade_style'
  ) THEN
    ALTER TABLE kelly_sizing_log ADD COLUMN trade_style text;
  END IF;
END $$;
