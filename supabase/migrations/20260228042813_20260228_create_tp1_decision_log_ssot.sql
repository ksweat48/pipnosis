/*
  # Create TP1 Decision Log Table

  ## Purpose
  SSOT-compliant audit trail for user decisions made at TP1 milestone.
  When a trade hits Take Profit 1, the system shows a 30-second countdown
  modal asking the user to either continue to TP2 or close the session now.
  This table records every such decision for governance and learning purposes.

  ## New Tables
  - `tp1_decision_log`
    - `id` (uuid, PK)
    - `user_id` (uuid, FK → auth.users)
    - `trade_id` (uuid, FK → goal_session_trades, nullable - graceful if trade deleted)
    - `session_id` (uuid, reference to goal_sessions)
    - `decision` (text, enum: 'continue_to_tp2' | 'close_session')
    - `auto_decided` (boolean) - true when countdown expired with no user input
    - `decided_at` (timestamptz, default now())

  ## Security
  - RLS enabled with strict per-user policies
  - Users can only INSERT and SELECT their own rows
  - Service role has full access for admin analytics

  ## CCIP Governance Notes
  - This table is INSERT-only from the frontend (no UPDATE/DELETE)
  - It is append-only for full auditability
  - `auto_decided` distinguishes user intent from system defaults
*/

CREATE TABLE IF NOT EXISTS tp1_decision_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id      uuid,
  session_id    uuid NOT NULL,
  decision      text NOT NULL CHECK (decision IN ('continue_to_tp2', 'close_session')),
  auto_decided  boolean NOT NULL DEFAULT false,
  decided_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tp1_decision_log_user_id_idx ON tp1_decision_log(user_id);
CREATE INDEX IF NOT EXISTS tp1_decision_log_session_id_idx ON tp1_decision_log(session_id);
CREATE INDEX IF NOT EXISTS tp1_decision_log_decided_at_idx ON tp1_decision_log(decided_at DESC);

ALTER TABLE tp1_decision_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own tp1 decisions"
  ON tp1_decision_log
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own tp1 decisions"
  ON tp1_decision_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access tp1 decisions"
  ON tp1_decision_log
  FOR SELECT
  TO service_role
  USING (true);
