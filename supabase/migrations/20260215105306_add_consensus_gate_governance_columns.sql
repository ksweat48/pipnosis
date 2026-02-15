/*
  # CCIP-2026-02-15: Add Consensus Gate Governance Columns

  ## Summary
  Adds consensus gate audit trail columns to the `alpha_decisions` table.
  These columns track when the NO_TRADE quorum enforcement or minimum
  directional vote requirement blocked a trade.

  ## Background
  Previously, the weighted consensus algorithm allowed a minority of
  high-confidence directional votes to override a majority of NO_TRADE votes.
  The new consensus gate enforces:
  - 60% NO_TRADE quorum: if >= 60% of voting Omegas say NO_TRADE, consensus = NO_TRADE
  - Minimum 3 directional votes: at least 3 Omegas must agree on BUY/SELL

  ## New Columns on `alpha_decisions`
  - `consensus_gate_blocked` (boolean, default false) - Whether the consensus gate blocked a directional trade
  - `consensus_gate_reason` (text, nullable) - Human-readable reason for the block
  - `no_trade_quorum_percent` (numeric, nullable) - Percentage of Omegas that voted NO_TRADE (0.0-1.0)

  ## Security
  - No RLS changes needed (existing policies on alpha_decisions cover these columns)
  - No new tables created
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'consensus_gate_blocked'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN consensus_gate_blocked boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'consensus_gate_reason'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN consensus_gate_reason text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'no_trade_quorum_percent'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN no_trade_quorum_percent numeric;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_alpha_decisions_consensus_gate_blocked
  ON alpha_decisions (consensus_gate_blocked)
  WHERE consensus_gate_blocked = true;

COMMENT ON COLUMN alpha_decisions.consensus_gate_blocked IS 'CCIP-2026-02-15: True when NO_TRADE quorum or minimum vote requirement blocked a directional trade';
COMMENT ON COLUMN alpha_decisions.consensus_gate_reason IS 'CCIP-2026-02-15: Human-readable reason for consensus gate block';
COMMENT ON COLUMN alpha_decisions.no_trade_quorum_percent IS 'CCIP-2026-02-15: Fraction of Omegas that voted NO_TRADE (0.0-1.0), 0.60+ triggers quorum block';
