/*
  # Progressive Journal Milestone Tracking

  ## Purpose
  Enables the ai_trade_journal to record a trade's full progression:
  Goal Hit → (optional) TP1 → (optional) TP2

  ## New Columns on ai_trade_journal

  1. `journal_stage` (text)
     - Tracks which lifecycle stage this journal entry is currently at
     - Values: 'open' | 'goal_achieved' | 'tp1_hit' | 'tp2_hit' | 'final'
     - Default: 'open' (no change to existing rows)
     - Allows the UI and update logic to know whether to show goal/TP milestone banners

  2. `goal_pnl_at_achievement` (numeric)
     - The P&L value at the exact moment the user's goal was crossed
     - NULL for trades that never hit the goal during the session
     - Populated by goal-achievement-coordinator when goal is first detected

  3. `goal_achieved_at` (timestamptz)
     - Timestamp when the goal was achieved (not when TP fired)
     - Used to build "Goal hit at $X then held to TP1 at $Y" narratives

  4. `tp1_pnl` (numeric)
     - Final P&L if the trade closed at TP1 (close_reason = 'take_profit_1' or tp1_hit=true)
     - NULL if TP1 was not the close point

  5. `tp1_exit_price` (numeric)
     - Price at which TP1 was hit

  6. `tp2_pnl` (numeric)
     - Final P&L if trade closed at TP2

  7. `tp2_exit_price` (numeric)
     - Price at which TP2 was hit

  ## Security
  - No new tables → no new RLS policies required
  - All new columns are nullable with safe defaults
  - Existing rows unaffected (all columns default to NULL / 'open')

  ## Governance
  - CCIP compliant: additive-only migration, no DROP/ALTER TYPE
  - SSOT: ai_trade_journal remains the single authoritative record per trade
  - No triggers added — all logic remains in application layer (coordinator + analyzer)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_journal' AND column_name = 'journal_stage'
  ) THEN
    ALTER TABLE ai_trade_journal ADD COLUMN journal_stage text NOT NULL DEFAULT 'open';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_journal' AND column_name = 'goal_pnl_at_achievement'
  ) THEN
    ALTER TABLE ai_trade_journal ADD COLUMN goal_pnl_at_achievement numeric DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_journal' AND column_name = 'goal_achieved_at'
  ) THEN
    ALTER TABLE ai_trade_journal ADD COLUMN goal_achieved_at timestamptz DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_journal' AND column_name = 'tp1_pnl'
  ) THEN
    ALTER TABLE ai_trade_journal ADD COLUMN tp1_pnl numeric DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_journal' AND column_name = 'tp1_exit_price'
  ) THEN
    ALTER TABLE ai_trade_journal ADD COLUMN tp1_exit_price numeric DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_journal' AND column_name = 'tp2_pnl'
  ) THEN
    ALTER TABLE ai_trade_journal ADD COLUMN tp2_pnl numeric DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_journal' AND column_name = 'tp2_exit_price'
  ) THEN
    ALTER TABLE ai_trade_journal ADD COLUMN tp2_exit_price numeric DEFAULT NULL;
  END IF;
END $$;

ALTER TABLE ai_trade_journal
  ADD CONSTRAINT ai_trade_journal_journal_stage_check
  CHECK (journal_stage IN ('open', 'goal_achieved', 'tp1_hit', 'tp2_hit', 'final'))
  NOT VALID;
