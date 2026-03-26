/*
  # CCIP-2026-0326A: Conviction-First Confidence Scoring Governance

  ## Summary
  Records the governance change that eliminates the prompt-induced formula causing
  Alpha to output mechanically uniform 45% confidence scores in dead zone +
  neutral_ranging conditions.

  ## Root Cause
  CCIP-2026-0325C's PRACTICAL APPLICATION section instructed Alpha to "start at
  the low end of the phase band (55%)" combined with a "10 point advisory ceiling"
  written numerically into the coordinator-alpha.ts prompt. This created a
  deterministic formula: 55% (ACCUMULATION baseline) - 10 (advisory ceiling) = 45%
  — mechanically, every time, across all symbols in those conditions.
  Alpha was executing a scoring rubric, not exercising genuine judgment.

  ## Changes Applied
  1. CCIP-2026-0325C PRACTICAL APPLICATION rewritten in alpha-identity.ts:
     - Phase bands now define minimum evidence requirements ONLY
     - Hardcoded starting numbers (55%, 65%, 58%) removed
     - Alpha's confidence now derives from honest conviction, not a formula
  2. Advisory ceiling number removed from coordinator-alpha.ts LLM prompt:
     - The "Combined effect ceiling: 10 points" instruction removed
     - Replaced with reasoning-based guidance: advisory signals are context, not arithmetic
  3. Phase band confidence ranges removed from phase descriptions:
     - "= 55-70% confidence", "= 65-75% confidence", "= 62-72% confidence" etc. removed
     - These were functioning as expected outputs Alpha anchored to

  ## Governance Principle
  Alpha's confidence must reflect his honest conviction that the trade wins — derived
  from the quality of structure, clarity of trigger, clean air to target, and his
  genuine read of the opportunity.

  ## SSOT Compliance
  - alpha-identity.ts: sole authority for Alpha's prompt and confidence framework
  - coordinator-alpha.ts: sole authority for per-scan prompt context
  - No code-layer confidence arithmetic is applied after Alpha's LLM output
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  requester_id
)
VALUES (
  'alpha_prompt_config',
  gen_random_uuid(),
  'configuration_change',
  '{"ccip": "2026-0325C", "phase_bands": "ACCUMULATION starts at 55%, RETRACEMENT starts at 65%, advisory ceiling 10 points written in prompt"}',
  '{"ccip": "2026-0326A", "phase_bands": "minimum evidence requirements only", "advisory_guidance": "context-based reasoning, no arithmetic ceiling in prompt"}',
  'CCIP-2026-0326A: Eliminated prompt-induced formula causing uniform 45% confidence scores. Alpha confidence now reflects honest conviction, not phase band formula minus advisory ceiling.',
  NULL
);
