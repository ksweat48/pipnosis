/*
  # CCIP Governance Record: Adversarial Detector — Inform Only, No Penalties

  ## Short Title
  Remove all adversarial confidence penalties and symbol blocks. Adversarial data
  is background intelligence for Alpha only — never a confidence reducer or hard block.

  ## Plain English Summary
  The adversarial detector previously applied confidence penalties (5-15%) and
  could hard-block symbols from selection (Gate 4: severe adversarial rejection).
  This migration documents the governance decision to eliminate both mechanisms.

  Adversarial data (stop runs, manipulation spikes, fake breakouts) now flows
  exclusively as background context into Alpha's Omega council prompts. Alpha
  reads this information and reasons about it freely. No code-imposed penalty
  is applied, no symbol is rejected on adversarial grounds alone.

  ## Changes Made (Code Layer)

  ### best-symbol-selector.ts — Gate 4 Removed
  Gate 4 previously rejected symbols where adversarial.level === 'severe'.
  Now a pass-through: symbol remains eligible regardless of adversarial level.

  ### alpha-omega-orchestrator.ts — Three Penalty Sites Removed
  1. collectConfidencePenalties(): Full tiered penalty system removed.
  2. collectConfidenceModifiers(): Adversarial penalty push removed.
  3. computeAdversarialPenaltyFromRaw(): Private method removed entirely.

  ### alpha-identity.ts — ADVERSARIAL_DETECTOR config updated
  maxConfidencePenalty changed from 15 to 0. Adversarial detector is INFORM_ONLY.

  ## SSOT/CCIP Compliance
  Alpha is FINAL AUTHORITY on trade decisions. Code-imposed penalties contradict
  this governance principle. Adversarial data flows via Omega council prompts.
  CCIP Contract (adversarial-detector.ts 2026-02-21): RAW OBSERVATIONS ONLY.
  Removing penalties fulfils that existing contract.

  ## CCIP Reference
  CCIP-2026-0222: Adversarial Inform-Only Architecture — No Penalties, No Blocks
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
)
VALUES (
  'alpha_coordinator',
  gen_random_uuid(),
  'configuration_change',
  '{"maxConfidencePenalty": 15, "canBlock": true, "hardBlockOnSevere": true, "component": "AdversarialDetector"}',
  '{"maxConfidencePenalty": 0, "canBlock": false, "mode": "INFORM_ONLY", "component": "AdversarialDetector"}',
  'CCIP-2026-0222: Adversarial detector demoted to inform-only. All confidence penalties and symbol hard-blocks removed. Adversarial data flows as background intelligence to Alpha via Omega council prompts only. Alpha is final authority on trade decisions.',
  '{"ccip_ref": "CCIP-2026-0222", "files_affected": ["src/services/best-symbol-selector.ts", "src/services/alpha-omega-orchestrator.ts", "src/config/alpha-identity.ts"], "impact_level": "MEDIUM", "rationale": "Alpha is final authority. Code-imposed adversarial penalties contradict SSOT governance."}'
);
