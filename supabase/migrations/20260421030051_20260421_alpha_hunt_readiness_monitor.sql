/*
  # Alpha Hunt Readiness Monitor

  ## Purpose
  Replaces market_behavior_signals with a hunter-context-aware readiness table.
  Instead of detecting generic candle patterns, this table answers ONE question:
  "Does Alpha have the raw structural material to execute a trade here right now?"

  ## New Table: alpha_hunt_readiness
  Stores per-symbol per-style hunt readiness assessments computed by the
  alpha-hunt-readiness-scanner Netlify function (runs every 3 minutes).

  ### Columns
  - symbol: trading instrument
  - style: SCALP | MICRO_INTRADAY | INTRADAY
  - session: current trading session (asian, london, ny, overlap, dead)
  - hunt_state: 'live' (trigger fired, all 4 preconditions met) |
                'ready' (3 preconditions met, trigger developing) |
                'not_ready' (insufficient material — scan will likely NO_TRADE)
  - phase_detected: ACCUMULATION | EXPANSION | DISTRIBUTION | RETRACEMENT | REVERSAL | UNCLEAR
  - phase_evidence: 1-sentence candle evidence that defined the phase
  - preconditions_met: array of passed precondition keys
  - structural_room_pips: measured clear distance from current price to nearest wall
  - structural_room_direction: BUY | SELL | NEUTRAL (which direction has more room)
  - trigger_state: 'fired' | 'developing' | 'none'
  - trigger_evidence: what trigger evidence exists (sweep, BOS, compression break, etc.)
  - direction_lean: BUY | SELL | NEUTRAL (structural bias)
  - hunt_summary: plain-English single sentence explaining why this pair is surfaced
  - last_scanned_at: timestamp of last scanner run
  - expires_at: when this row should be considered stale

  ## Security
  - RLS enabled: authenticated users can SELECT all rows (global readiness data, not user-scoped)
  - Service role can INSERT/UPDATE/DELETE (scanner runs as service role)

  ## Migration Notes
  - market_behavior_signals table is preserved but no longer the primary monitor source
  - The UI will read from alpha_hunt_readiness going forward
  - Old table kept for audit/reference until confirmed safe to drop
*/

CREATE TABLE IF NOT EXISTS alpha_hunt_readiness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  style text NOT NULL CHECK (style IN ('SCALP', 'MICRO_INTRADAY', 'INTRADAY')),
  session text NOT NULL DEFAULT 'unknown',
  hunt_state text NOT NULL CHECK (hunt_state IN ('live', 'ready', 'not_ready')) DEFAULT 'not_ready',
  phase_detected text NOT NULL DEFAULT 'UNCLEAR',
  phase_evidence text NOT NULL DEFAULT '',
  preconditions_met text[] NOT NULL DEFAULT '{}',
  structural_room_pips numeric(10,2) NOT NULL DEFAULT 0,
  structural_room_direction text NOT NULL DEFAULT 'NEUTRAL' CHECK (structural_room_direction IN ('BUY', 'SELL', 'NEUTRAL')),
  trigger_state text NOT NULL DEFAULT 'none' CHECK (trigger_state IN ('fired', 'developing', 'none')),
  trigger_evidence text NOT NULL DEFAULT '',
  direction_lean text NOT NULL DEFAULT 'NEUTRAL' CHECK (direction_lean IN ('BUY', 'SELL', 'NEUTRAL')),
  hunt_summary text NOT NULL DEFAULT '',
  last_scanned_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (symbol, style)
);

ALTER TABLE alpha_hunt_readiness ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all readiness rows (global, not user-scoped)
CREATE POLICY "Authenticated users can read hunt readiness"
  ON alpha_hunt_readiness FOR SELECT
  TO authenticated
  USING (true);

-- Service role manages all writes (scanner function runs as service role)
CREATE POLICY "Service role can insert hunt readiness"
  ON alpha_hunt_readiness FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update hunt readiness"
  ON alpha_hunt_readiness FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can delete hunt readiness"
  ON alpha_hunt_readiness FOR DELETE
  TO service_role
  USING (true);

-- Index for fast UI queries (ordered by hunt_state, symbol)
CREATE INDEX IF NOT EXISTS idx_alpha_hunt_readiness_state
  ON alpha_hunt_readiness (hunt_state, symbol, style);

CREATE INDEX IF NOT EXISTS idx_alpha_hunt_readiness_expires
  ON alpha_hunt_readiness (expires_at);

-- Enable realtime so UI updates live when scanner writes
ALTER PUBLICATION supabase_realtime ADD TABLE alpha_hunt_readiness;
