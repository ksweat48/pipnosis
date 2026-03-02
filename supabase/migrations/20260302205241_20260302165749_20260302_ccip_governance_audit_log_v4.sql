/*
  # CCIP Governance Audit — HTF Conflict Gate & Sweep Reclaim Gate (2026-03-02 v4)

  ## Summary
  This migration adds a dedicated audit table for the pre-LLM conflict gate decisions
  introduced by the CCIP 2026-03-02 Alpha directional corruption fix. It also adds a
  SCALP-specific M15 conflict gate tracking column so post-trade analysis can identify
  exactly which gate fired on every NO_TRADE decision.

  ## Changes

  ### New Table: `htf_conflict_gate_log`
  Records every pre-LLM gate evaluation: conflict detected, qualification evidence
  found or absent, and the final gate decision (BLOCKED / QUALIFIED / NO_CONFLICT).

  Columns:
  - `id` — uuid primary key
  - `user_id` — FK to auth.users (the session user)
  - `session_id` — goal session ID (nullable, for context)
  - `symbol` — trading symbol
  - `style` — trade style (SCALP, MICRO_INTRADAY, INTRADAY)
  - `htf_label` — controlling TF label (M15, H1, H4)
  - `htf_trend_dir` — computed HTF trend (BULLISH, BEARISH, NEUTRAL)
  - `htf_consecutive` — number of consecutive same-direction HTF candles
  - `omega8_direction_support` — Omega-8 structural bias (buy, sell)
  - `conflict_type` — CONFLICTING_BUY, CONFLICTING_SELL, or NONE
  - `htf_bos_present` — whether a BOS was found in HTF candles
  - `sweep_wick_present` — whether a sweep wick was found in HTF candles
  - `gate_decision` — BLOCKED (NO_TRADE returned) or QUALIFIED (LLM called) or NO_CONFLICT
  - `created_at` — timestamp

  ### Security
  - RLS enabled
  - Authenticated users can insert their own rows
  - Authenticated users can select their own rows
  - Service role has full access for admin/monitoring

  ## CCIP Compliance
  - SSOT: This table is the single authority for gate decision audit history
  - All gate decisions in coordinator-alpha.ts are logged here
  - No business logic is embedded in this table — it is a pure audit record
*/

CREATE TABLE IF NOT EXISTS htf_conflict_gate_log (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id                uuid,
  symbol                    text        NOT NULL,
  style                     text        NOT NULL,
  htf_label                 text        NOT NULL,
  htf_trend_dir             text        NOT NULL,
  htf_consecutive           integer     NOT NULL DEFAULT 1,
  omega8_direction_support  text,
  conflict_type             text        NOT NULL DEFAULT 'NONE',
  htf_bos_present           boolean     NOT NULL DEFAULT false,
  sweep_wick_present        boolean     NOT NULL DEFAULT false,
  gate_decision             text        NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE htf_conflict_gate_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own gate log rows"
  ON htf_conflict_gate_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can select own gate log rows"
  ON htf_conflict_gate_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to gate log"
  ON htf_conflict_gate_log FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_htf_conflict_gate_log_user_id   ON htf_conflict_gate_log(user_id);
CREATE INDEX IF NOT EXISTS idx_htf_conflict_gate_log_created_at ON htf_conflict_gate_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_htf_conflict_gate_log_gate_decision ON htf_conflict_gate_log(gate_decision);

COMMENT ON TABLE htf_conflict_gate_log IS
  'CCIP 2026-03-02: Audit log for pre-LLM HTF and M15 conflict gate decisions. '
  'Records every gate evaluation (BLOCKED / QUALIFIED / NO_CONFLICT) for post-trade analysis.';
