/*
  # CCIP-2026-0404C: Final Numeric Confidence Threshold Anchor Eradication

  ## Summary
  This migration is the governance record for the definitive fix to the confidence=45
  degenerate signal pattern (CCIP-2026-0332A). Previous fixes (0326A, 0332A, 0401A, 0403A)
  each removed one layer of numeric anchoring but left the core threshold numbers visible
  in the prompt, allowing GPT-4o to continue anchoring on 45 as the "just below threshold"
  canonical NO_TRADE value.

  ## Root Cause (Confirmed via Audit 2026-04-07)
  The confidence=45 anchor was produced by GPT-4o reading "50" as the execution threshold
  and "50-69" as the ACCEPTABLE execution band in the system prompt. With these numbers
  visible, the model reliably chose 45 as the canonical "I see something but cannot trade"
  value — one point below the stated execution floor.

  The first symbol in each batch (XAUUSD, 0% cache hit) also returned confidence=45,
  which disproves the prompt cache theory. The anchor was embedded in the prompt text
  itself, not served from cache.

  ## Secondary Vector Also Removed
  The session-phase-style performance row format was injecting avg_confidence from the
  alpha_session_phase_performance table as "conf=N" into every scan prompt. If historical
  trades averaged near 45 from a prior anchoring period, this created a feedback loop
  where historical confidence averages reinforced the anchor on every new scan.

  ## Files Changed

  ### src/config/alpha-identity.ts
  1. arenaWalls CONFIDENCE FLOOR line: Removed "below 50", "At 50 or above", "ACCEPTABLE
     setups (50-69)". Replaced with conviction-tier language. No numeric threshold is
     visible to the model.
  2. BUY/SELL auditSchema trade_confidence description: Removed "ACCEPTABLE confidence
     (50-69)" and "below 50". Replaced with conviction-first language only.
  3. NO_TRADE auditSchema trade_confidence description: Removed "If my confidence is 50 or
     above" and "below 50". Retained all anti-anchor language. Added explicit statement
     that NO_TRADE is from absent structural edge, not from a threshold.

  ### src/brains/coordinator-alpha.ts
  4. Session-phase-style performance row format: Removed conf= field entirely.
     The avg_confidence column remains in the database for internal analytics but is never
     injected into the prompt. Format changed from:
       "session|phase|style WR%(W/L) avg_pnl conf=45"
     to:
       "session|phase|style WR%(W/L) avg_pnl"
  5. CCIP-2026-0332A sentinel message updated to correctly identify the root cause as
     numeric threshold anchors, not prompt cache.

  ## Governance Contract
  MINIMUM_TRADE_CONFIDENCE (= 50) remains as an internal TypeScript constant used by
  the executor as a hard execution gate. It is NOT visible in any prompt text.
  avg_confidence column in alpha_session_phase_performance is retained for analytics.
  It MUST NOT be re-introduced into any prompt formatting function.

  ## Prior Related Migrations
  - CCIP-2026-0326A: Removed phase band formulas from BUY/SELL schema
  - CCIP-2026-0332A: Removed "45=close, structure incomplete" example from NO_TRADE schema
  - CCIP-2026-0401A: Nulled expected_confidence_band_min/max from calibration table
  - CCIP-2026-0403A: Removed confidence_cal numeric bucket labels and advisory floor text
  - CCIP-2026-0404C (THIS): Removed remaining threshold anchors and avg_confidence injection
*/

INSERT INTO ccip_governance_audit (
  change_id,
  change_date,
  category,
  title,
  description,
  files_modified,
  ssot_owner,
  created_at
)
SELECT
  'CCIP-2026-0404C',
  now(),
  'ALPHA_CONFIDENCE_ANCHOR_ERADICATION',
  'Final Numeric Confidence Threshold Anchor Eradication',
  'Removed last numeric threshold anchors ("50", "50-69", "below 50") from arenaWalls CONFIDENCE FLOOR, BUY/SELL trade_confidence schema, and NO_TRADE trade_confidence schema. Removed avg_confidence (conf=N) injection from session-phase-style performance rows. Root cause confirmed: GPT-4o anchored on 45 as "just below 50 threshold" canonical NO_TRADE value because the 50 threshold was visible in the prompt text on every scan, including at 0% cache hit.',
  ARRAY[
    'src/config/alpha-identity.ts',
    'src/brains/coordinator-alpha.ts'
  ],
  'alpha-identity.ts::getAlphaSystemPromptForStyle',
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM ccip_governance_audit WHERE change_id = 'CCIP-2026-0404C'
);

COMMENT ON COLUMN alpha_session_phase_performance.avg_confidence IS
  'CCIP-2026-0404C: Retained for internal analytics only. MUST NOT be injected into any prompt formatting function. Prompt injection of historical confidence averages creates a feedback loop that reinforces prior anchoring patterns.';
