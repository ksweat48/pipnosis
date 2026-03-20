/*
  # CCIP: Entry Price Deviation Governance System
  
  ## Summary
  
  Addresses a confirmed trade loss (XAUUSD SELL, Mar 19 2026, -$1007.40) caused by the executor
  proceeding with a trade when the live fill price had drifted 35 pips away from Alpha's planned
  entry. The SL/TP geometry was shifted proportionally, but this placed the SL at a non-structural
  level — causing the stop to be hit in 118 seconds on normal market noise.
  
  ## Root Cause
  
  The `executeImmediate()` path in `alpha-trade-executor.ts` always shifts SL/TP by the
  fill-vs-planned deviation. This is correct for small slippage (1-3 pips), but for large deviations
  (>= 10 pips on metals/indices, >= 5 pips on forex) it produces structurally invalid geometry
  because Alpha's SL/TP were anchored to specific structural levels that no longer apply at the
  new fill price.
  
  ## New Tables
  
  ### entry_price_deviation_events
  - Records every occurrence where live fill price deviated from Alpha's planned entry
  - Captures: symbol, style, planned_entry, actual_entry, deviation_pips, action_taken
  - action_taken: 'SHIFTED' (within tolerance) | 'BLOCKED' (exceeded max deviation) | 'CANCELLED'
  - Used by governance audit, Alpha learning, and forensic analysis
  
  ## Security
  - RLS enabled
  - Authenticated users can insert their own records
  - Authenticated users can read their own records
  - Service role has full access for server-side functions
*/

CREATE TABLE IF NOT EXISTS entry_price_deviation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid,
  trade_id uuid,
  symbol text NOT NULL,
  alpha_style text NOT NULL DEFAULT '',
  direction text NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  planned_entry numeric(20,5) NOT NULL,
  actual_entry numeric(20,5) NOT NULL,
  deviation_pips numeric(10,2) NOT NULL,
  max_allowed_pips numeric(10,2) NOT NULL,
  action_taken text NOT NULL CHECK (action_taken IN ('SHIFTED', 'BLOCKED', 'RESCAN_TRIGGERED')),
  block_reason text,
  planned_sl numeric(20,5),
  planned_tp numeric(20,5),
  execution_sl numeric(20,5),
  execution_tp numeric(20,5),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE entry_price_deviation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own deviation events"
  ON entry_price_deviation_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own deviation events"
  ON entry_price_deviation_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access to deviation events"
  ON entry_price_deviation_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_deviation_events_user_created
  ON entry_price_deviation_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deviation_events_symbol
  ON entry_price_deviation_events (symbol, created_at DESC);

/*
  Also add entry_spec tracking columns to alpha_decisions so forensic audits
  can see what entry_mode and style Alpha committed to at decision time.
  These columns were missing from the alpha_decisions log, preventing post-trade
  audits from determining whether a wait intent was present.
*/
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'alpha_entry_mode'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN alpha_entry_mode text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'alpha_wait_condition'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN alpha_wait_condition jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'trade_style'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN trade_style text;
  END IF;
END $$;
