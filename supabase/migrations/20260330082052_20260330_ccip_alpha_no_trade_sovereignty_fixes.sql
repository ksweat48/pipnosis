/*
  # CCIP-2026-0330: Alpha NO_TRADE Sovereignty — Governance Fixes

  ## Summary
  Addresses the 24-hour NO_TRADE failure mode where Alpha was outputting confidence=45
  across all symbols simultaneously, never executing trades.

  ## Root Causes Fixed (Code-side)
  1. Invalid WAIT instruction removed from pipnosis-core-rules.ts (caused NO_TRADE fallback)
  2. pattern-confidence-adjuster.ts converted to labels-only — all arithmetic boosts/penalties removed
  3. Q_EDGE binary forcing path softened — NO_TRADE only after genuine structural search
  4. NO_TRADE thesis cache guard added — NEUTRAL theses no longer cached and replayed
  5. no_trade_statement mandatory field added to NO_TRADE schema

  ## Database Changes
  1. Adds `no_trade_statement` column to `alpha_decisions` table for governance audit
  2. Registers `NO_TRADE_STATEMENT_MISSING_OR_GENERIC` as a recognised violation type
     in governance tracking (no constraint change needed — ssot_violations is open-type)
  3. Adds `pattern_sovereignty_mode` column to alpha_decisions to track that pattern
     confidence adjuster is operating in labels-only mode (audit trail)

  ## Security
  - No RLS changes (alpha_decisions inherits existing policies)
  - All changes are additive (no data loss risk)
  - All new columns are nullable with no defaults — backward compatible

  ## Impact
  - Alpha will now receive pattern observations as labeled context, not arithmetic deductions
  - NO_TRADE decisions require a substantive no_trade_statement or a governance violation is logged
  - Only BUY/SELL theses are cached — NO_TRADE decisions do not seed the cache
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'no_trade_statement'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN no_trade_statement text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'pattern_sovereignty_mode'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN pattern_sovereignty_mode text DEFAULT 'labels_only';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'no_trade_statement_quality'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN no_trade_statement_quality text
      CHECK (no_trade_statement_quality IS NULL OR no_trade_statement_quality IN ('substantive', 'generic', 'missing'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_alpha_decisions_no_trade_quality
  ON alpha_decisions (no_trade_statement_quality)
  WHERE no_trade_statement_quality IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alpha_decisions_action_created
  ON alpha_decisions (action, created_at DESC);
