/*
  # CCIP-2026-0403B — Eradicate UI-Layer Numeric Confidence Anchors (Second Wave)

  ## Summary
  CCIP-2026-0403A (first wave) removed all numeric confidence anchors from Alpha's
  prompt context — the strings GPT-4o reads to generate its trade_confidence score.
  This migration governs CCIP-2026-0403B, which targets the UI display layer: the
  strings users read in the "No Trades Found" dialog, AlphaThoughtStream step messages,
  and internal log output. These did not influence Alpha's judgment but undermined
  user trust in the system by making every NO_TRADE look mechanically gated at 50%.

  ## Root Cause
  The first-wave scope was prompt-layer only. Seven display strings in three files
  still contained "(floor: 50%)", "below execution threshold", "below the X% execution
  floor", and "I am only X% confident. Not enough to execute." — all visible to users
  via the scan UI, even though they did not affect Alpha's reasoning.

  ## Files Changed

  ### src/services/goal-session-live-engine.ts — 7 string targets
  1. buildScanCompletionMessage (inline): "below the execution floor" removed
  2. buildScanCompletionMessage (inline): "Average confidence: ${avgConf}%" removed
  3. buildScanCompletionMessage (inline): "below execution threshold" removed
  4. buildNoTradeSummary: bestCandidateSuffix — "(floor: X%)" removed
  5. buildNoTradeSummary: "Alpha found confidence below the execution floor (X%)" removed
  6. buildNoTradeSummary: "Average Alpha confidence this cycle: ${avgConf}%" removed (Asian branch)
  7. buildNoTradeSummary: "below the X% execution floor" removed

  ### src/services/alpha-thought-stream.ts — 3 string targets
  1. emitSymbolReasoning NO_TRADE: "I am only X% confident... Not enough to execute." removed
  2. emitSymbolReasoning BUY/SELL below floor: "Below execution floor." removed
  3. emitFinalDecision: "I am only X% confident... Executing now." replaced with conviction language

  ### src/services/confidence-calculation-engine.ts — 2 string targets
  1. Advisory console.log: "Hard gate is 50" → "Hard gate is MINIMUM_TRADE_CONFIDENCE"
  2. audit_notes DB string: "Hard gate is confidence >= 50" → "MINIMUM_TRADE_CONFIDENCE"

  ### src/brains/coordinator-alpha.ts — 1 comment target
  1. Comment: "An ACCEPTABLE setup (50-69% confidence)" — numeric range removed from comment

  ## Governance
  This is a display-layer governance fix. No architectural constants changed.
  MINIMUM_TRADE_CONFIDENCE = 50 remains the legitimate executor gate in TypeScript code.
  The change is: users see professional judgment language, not mechanical threshold language.

  ## CCIP Compliance
  - CCIP ID: 2026-0403B
  - Governing authority: coordinator-alpha.ts (prompt injection SSOT)
  - Display authority: goal-session-live-engine.ts (No Trade summary SSOT)
  - Thought display authority: alpha-thought-stream.ts (step message SSOT)
  - Stage: Full production deployment
  - Rollback: Revert string changes in 3 files (no schema changes)
*/

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ccip_governance_audit_log') THEN
    INSERT INTO ccip_governance_audit_log (
      ccip_id,
      change_type,
      description,
      files_changed,
      root_cause,
      deployment_stage,
      created_at
    ) VALUES (
      'CCIP-2026-0403B',
      'ui_display_anchor_removal',
      'Second wave: eradicate UI-layer numeric confidence anchors from user-visible display strings. First wave (0403A) fixed prompt layer. This wave fixes display layer: No Trade dialog, AlphaThoughtStream steps, and internal log strings.',
      ARRAY[
        'src/services/goal-session-live-engine.ts',
        'src/services/alpha-thought-stream.ts',
        'src/services/confidence-calculation-engine.ts',
        'src/brains/coordinator-alpha.ts'
      ],
      'CCIP-0403A scope was prompt-layer only. Seven UI display strings still contained numeric threshold comparisons (floor: 50%, below execution threshold, I am only X% confident. Not enough to execute.) that were visible to users and implied mechanical gating.',
      'full_production',
      now()
    );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tier7_ccip_tracking') THEN
    INSERT INTO tier7_ccip_tracking (
      ccip_id,
      deployment_wave,
      status,
      notes,
      created_at
    ) VALUES (
      'CCIP-2026-0403B',
      2,
      'deployed',
      'UI display layer numeric anchor removal. Companion to CCIP-0403A (prompt layer). No schema changes. 13 string targets across 4 files.',
      now()
    );
  END IF;
END $$;
