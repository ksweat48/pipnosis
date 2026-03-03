/*
  # Multi-Trade Top-N Execution Governance

  ## Purpose
  Track and audit multi-trade "top-N" execution cycles where Alpha evaluates all
  symbols and selects the top N pairs simultaneously (rather than one per cycle).

  ## Changes

  ### 1. New Table: multi_trade_execution_audit
  - Captures each multi-trade cycle: how many slots were open, how many pairs were
    selected, which symbols were chosen, and in what rank order.
  - SSOT for auditing whether the top-3 selection is actually working as intended.

  ### 2. New Column: goal_sessions.multi_trade_eval_mode
  - Distinguishes the evaluation strategy: 'sequential_single' (old behaviour) vs
    'parallel_top_n' (new intended behaviour for multi-trade mode).
  - Default 'sequential_single' preserves all existing session behaviour.

  ## Security
  - RLS enabled on multi_trade_execution_audit.
  - Authenticated users can INSERT and SELECT their own rows.
  - Service role has full access for server-side writes.

  ## CCIP Notes
  - This migration is additive-only (no DROP, no breaking changes).
  - The new column default ensures zero-impact on existing sessions.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. New audit table for multi-trade top-N cycle tracking
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS multi_trade_execution_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES goal_sessions(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cycle_at        timestamptz NOT NULL DEFAULT now(),

  -- How many trade slots were available when this cycle ran
  slots_available integer NOT NULL CHECK (slots_available BETWEEN 1 AND 3),

  -- How many symbols were eligible (passed all gates) in this cycle
  eligible_count  integer NOT NULL DEFAULT 0,

  -- Ranked symbols selected for execution (array ordered by confidence desc)
  selected_symbols text[] NOT NULL DEFAULT '{}',

  -- Per-symbol confidence scores (parallel array to selected_symbols)
  selected_confidences numeric[] NOT NULL DEFAULT '{}',

  -- Number of trades actually executed in this cycle
  trades_executed integer NOT NULL DEFAULT 0,

  -- Whether early-exit optimisation was suppressed for this cycle
  early_exit_suppressed boolean NOT NULL DEFAULT false,

  -- Freeform notes (e.g. skipped symbols, rejection reasons summary)
  notes text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE multi_trade_execution_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own multi-trade audit rows"
  ON multi_trade_execution_audit FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can select own multi-trade audit rows"
  ON multi_trade_execution_audit FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access multi-trade audit"
  ON multi_trade_execution_audit FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_multi_trade_audit_session
  ON multi_trade_execution_audit (session_id, cycle_at DESC);

CREATE INDEX IF NOT EXISTS idx_multi_trade_audit_user
  ON multi_trade_execution_audit (user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Add eval_mode column to goal_sessions
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions'
      AND column_name = 'multi_trade_eval_mode'
  ) THEN
    ALTER TABLE goal_sessions
      ADD COLUMN multi_trade_eval_mode text NOT NULL DEFAULT 'sequential_single'
        CHECK (multi_trade_eval_mode IN ('sequential_single', 'parallel_top_n'));

    COMMENT ON COLUMN goal_sessions.multi_trade_eval_mode IS
      'SSOT: evaluation strategy for this session. '
      'sequential_single = find best 1 symbol per cycle (legacy). '
      'parallel_top_n = evaluate all symbols and execute top N simultaneously (multi-trade intent).';
  END IF;
END $$;
