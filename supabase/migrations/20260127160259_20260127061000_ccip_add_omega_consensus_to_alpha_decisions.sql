/*
  # CCIP: Add omega_consensus Column to alpha_decisions

  ## Change Intent
  TypeScript code in alpha-learning-tracker.ts writes `omega_consensus` JSONB object,
  but database schema is missing this column. This causes all Alpha decision logging
  to fail with PGRST204 error, breaking the learning system.

  ## SSOT Responsibility
  - **Table**: alpha_decisions (SSOT for all Alpha decision records)
  - **Authority**: Alpha Learning Tracker (writer)
  - **Consumers**: Learning dashboards, AI improvement engine, governance reporting

  ## Schema Changes
  1. Add `omega_consensus` jsonb column to alpha_decisions
     - Structure: { direction, confidence, agreement_count, total_votes }
     - Nullable: YES (backward compatible with existing rows)
     - Default: NULL (no fabricated data)

  2. Add GIN index for efficient JSONB queries on omega_consensus

  ## Impact Assessment
  - **Breaking**: NO (additive column, nullable)
  - **Data Loss**: NONE (existing rows unaffected)
  - **Performance**: GIN index added for query efficiency
  - **Compatibility**: Fully backward compatible

  ## Governance Notes
  - This fixes production blocker preventing all Alpha decisions from being logged
  - Enables proper audit trail of Omega Council consensus vs Alpha overrides
  - Critical for learning system and conflict detection
*/

-- Add omega_consensus column to alpha_decisions
ALTER TABLE alpha_decisions
ADD COLUMN IF NOT EXISTS omega_consensus jsonb DEFAULT NULL;

-- Add GIN index for efficient JSONB queries
CREATE INDEX IF NOT EXISTS idx_alpha_decisions_omega_consensus
ON alpha_decisions USING gin(omega_consensus);

-- Add comment documenting the schema
COMMENT ON COLUMN alpha_decisions.omega_consensus IS
'SSOT: Omega Council consensus summary. Structure: {direction: string, confidence: number, agreement_count: number, total_votes: number}. Used for conflict detection between Omega recommendation and Alpha override.';
