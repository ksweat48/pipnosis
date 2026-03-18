/*
  # CCIP-2026-0319A: Alpha Mixed-Signal Parse Correction Audit Table

  ## Summary
  This migration creates a governance audit table that records every time the
  coordinator-alpha parser applies a corrective action to an LLM response that
  violates the Alpha output contract (CCIP-2026-0319A).

  ## Background
  Three categories of LLM prompt non-compliance are now corrected at parse time:

  1. NO_TRADE_ENTRY_STRIPPED — LLM returned entry_mode and/or wait_condition on a
     NO_TRADE decision. Both fields are structurally invalid on NO_TRADE responses.
     The parser strips them and logs this event.

  2. WAIT_CONDITION_SYNTHESISED — LLM returned entry_mode="wait_pullback" or
     "push_confirmation" without the mandatory wait_condition block, but a valid
     entry_advisory zone was available. The parser synthesised a wait_condition
     from the advisory zone so the entry intent can proceed with a valid zone.

  3. ENTRY_MODE_DOWNGRADED — LLM returned entry_mode="wait_pullback" or
     "push_confirmation" without wait_condition AND without a usable advisory zone.
     The parser downgraded entry_mode to "execute_now" so the trade executes
     immediately rather than creating a monitoring intent with no zone.

  ## New Tables

  ### alpha_parse_corrections
  - `id` (uuid, primary key)
  - `correction_type` (text, enum: NO_TRADE_ENTRY_STRIPPED | WAIT_CONDITION_SYNTHESISED | ENTRY_MODE_DOWNGRADED)
  - `symbol` (text)
  - `original_entry_mode` (text, nullable) — what the LLM returned
  - `resolved_entry_mode` (text, nullable) — what the parser used after correction
  - `user_id` (uuid, nullable) — session owner for cross-referencing
  - `session_id` (uuid, nullable) — goal session this scan belongs to
  - `details` (jsonb, nullable) — freeform audit data (e.g. synthesised zone bounds)
  - `created_at` (timestamptz)

  ## Security
  - RLS enabled
  - Authenticated users can SELECT their own rows (for transparency)
  - Service role can INSERT (server-side parser writes)
  - No UPDATE or DELETE policies — audit trail is append-only

  ## Notes
  - This table is purely observational. No business logic depends on it.
  - High frequency of WAIT_CONDITION_SYNTHESISED or ENTRY_MODE_DOWNGRADED events
    for a given symbol or time period indicates the LLM is not following the
    CCIP-2026-0319A prompt schema rules for that instrument/style.
  - Rows older than 30 days are eligible for automated cleanup via the log
    retention system (see 20260209190537 migration).
*/

CREATE TABLE IF NOT EXISTS alpha_parse_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_type text NOT NULL,
  symbol text NOT NULL DEFAULT '',
  original_entry_mode text,
  resolved_entry_mode text,
  user_id uuid,
  session_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alpha_parse_corrections_correction_type_check CHECK (
    correction_type IN (
      'NO_TRADE_ENTRY_STRIPPED',
      'WAIT_CONDITION_SYNTHESISED',
      'ENTRY_MODE_DOWNGRADED'
    )
  )
);

ALTER TABLE alpha_parse_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own parse corrections"
  ON alpha_parse_corrections
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert parse corrections"
  ON alpha_parse_corrections
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_alpha_parse_corrections_user_id
  ON alpha_parse_corrections (user_id);

CREATE INDEX IF NOT EXISTS idx_alpha_parse_corrections_symbol_type
  ON alpha_parse_corrections (symbol, correction_type);

CREATE INDEX IF NOT EXISTS idx_alpha_parse_corrections_created_at
  ON alpha_parse_corrections (created_at DESC);

COMMENT ON TABLE alpha_parse_corrections IS
  'CCIP-2026-0319A: Governance audit of LLM response corrections applied by coordinator-alpha parseDecision(). '
  'Append-only. Used to monitor LLM prompt compliance over time.';
