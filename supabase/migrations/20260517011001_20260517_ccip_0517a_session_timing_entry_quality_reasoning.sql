/*
  # CCIP-2026-0517A: Session-Timing & Entry-Quality Reasoning

  1. Summary
    - Adds two reasoning steps to Alpha's 9-step scan process (was 7, now 9)
    - Step 3: Session timing reconciliation
    - Step 6: Entry location quality assessment
    - New answer_sheet fields: session_timing_reconciliation, entry_location_quality, entry_mode_rationale
    - New DIRECTIONAL INTEGRITY check: CHASING/EXTENDED + execute_now is contradictory

  2. Governance
    - Deactivates prior active doctrine (0513N) and inserts new active doctrine
    - Amends CCIP-2026-0516A (FREE-FORM REASONING ARCHITECTURE)
    - Fully compliant with 0511ZZ, 0512A, 0513J sealed-prompt doctrines
*/

-- Deactivate the current active doctrine to make room for the new one
UPDATE alpha_engineering_doctrine
SET active = false
WHERE active = true AND kind = 'doctrine';

-- Insert the new CCIP-2026-0517A doctrine as the active record
INSERT INTO alpha_engineering_doctrine (
  ccip_reference,
  doctrine_text,
  ratified_at,
  active,
  kind,
  supersedes
) VALUES (
  'CCIP-2026-0517A',
  'Session-Timing & Entry-Quality Reasoning — Adds two reasoning steps to Alpha scan process: (1) Step 3: session timing reconciliation — thesis must be reconciled against remaining session energy before dual hypothesis work, informing confidence_tier and entry_mode but never direction; (2) Step 6: entry location quality — current price must be assessed as FAVORABLE/CHASING/EXTENDED before geometry placement, routing through wait_pullback or push_confirmation when chasing. Three new answer_sheet fields: session_timing_reconciliation, entry_location_quality, entry_mode_rationale. New DIRECTIONAL INTEGRITY check: CHASING/EXTENDED + execute_now is contradictory. Process expanded from 7 steps to 9 steps. Amends CCIP-2026-0516A.',
  now(),
  true,
  'doctrine',
  (SELECT id FROM alpha_engineering_doctrine WHERE ccip_reference = 'CCIP-2026-0513N-RISK-STYLE-Q8D-SEALING' LIMIT 1)
);
