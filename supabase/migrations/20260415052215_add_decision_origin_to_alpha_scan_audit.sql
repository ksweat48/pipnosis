/*
  # Alpha Scan Audit Table — Decision Origin Classification System

  ## Purpose
  Creates a forensic per-symbol scan telemetry table. Every Alpha scan attempt is recorded
  with its outcome and the root cause of any NO_TRADE. This makes every NO_TRADE
  self-documenting — distinguishing genuine Alpha judgment from system failures.

  ## New Table: alpha_scan_audit
  - `id` — primary key
  - `user_id` — FK to auth.users
  - `session_id` — FK to goal_sessions (nullable)
  - `symbol` — traded pair
  - `scan_batch_id` — groups all symbols scanned in a single coordinate() call
  - `action` — Alpha's raw output: BUY / SELL / NO_TRADE
  - `decision_origin` — 13-value classification of WHY the outcome occurred
  - `alpha_original_action` — preserved original BUY/SELL if system blocked it
  - `alpha_original_confidence` — preserved confidence if blocked
  - `confidence` — final confidence value
  - `execution_status` — EXECUTED / NO_TRADE_GENUINE / NO_TRADE_LEAN / NO_TRADE_SYSTEM_BLOCK
  - `block_reason` — human-readable block detail
  - `response_fingerprint` — djb2 hash for GPT-4o cache contamination detection
  - `completion_tokens` — LLM token usage for degenerate detection
  - `created_at` — timestamp

  ## Security
  - RLS enabled
  - Users can only read/insert their own rows
  - Service role has full access for server-side monitoring
*/

CREATE TABLE IF NOT EXISTS alpha_scan_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid,
  symbol text NOT NULL,
  scan_batch_id text,
  action text NOT NULL DEFAULT 'NO_TRADE',
  decision_origin text,
  alpha_original_action text,
  alpha_original_confidence numeric,
  confidence numeric DEFAULT 0,
  execution_status text,
  block_reason text,
  response_fingerprint text,
  completion_tokens integer,
  trade_style text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE alpha_scan_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own alpha scan audit rows"
  ON alpha_scan_audit FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can select own alpha scan audit rows"
  ON alpha_scan_audit FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to alpha scan audit"
  ON alpha_scan_audit FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_alpha_scan_audit_user_id ON alpha_scan_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_alpha_scan_audit_session_id ON alpha_scan_audit(session_id);
CREATE INDEX IF NOT EXISTS idx_alpha_scan_audit_symbol ON alpha_scan_audit(symbol);
CREATE INDEX IF NOT EXISTS idx_alpha_scan_audit_decision_origin ON alpha_scan_audit(decision_origin);
CREATE INDEX IF NOT EXISTS idx_alpha_scan_audit_created_at ON alpha_scan_audit(created_at DESC);
