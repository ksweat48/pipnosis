/*
  # CCIP-2026-0401-CROSS-SESSION-TRADE-HISTORY-BLEED

  ## Summary
  Governance record for the coordinator-alpha.ts fix that eliminates cross-session
  trade history contamination — the root cause of ALL pairs returning NO_TRADE at
  exactly confidence=45 after every executed trade.

  ## Root Cause
  The ai_trade_analysis query in coordinator-alpha.ts fetched trade history for a
  symbol with no time boundary (all-time, no session filter). When a user started a
  new session after a prior session with losses, those losses appeared in the prompt
  as "KNOWN FAILURE PATTERNS — LEARNING OBLIGATION: You MUST address the above history."
  GPT-4o read this as a mandatory instruction to treat prior losses as current
  decision-blocking evidence, causing Alpha to return NO_TRADE with confidence just
  below 50 (the exact 45 value) across all 7 scanned pairs simultaneously.

  ## Changes Applied (coordinator-alpha.ts)
  1. Added 14-day recency filter to ai_trade_analysis query — prevents sessions from
     seeing losses from months-ago sessions. New sessions with no recent trades produce
     zero recentTradesContext, giving Alpha a clean slate per-session.
  2. Removed "LEARNING OBLIGATION: You MUST address" instruction — this imperative
     language was treating historical calibration data as mandatory blocking evidence.
     Replaced with calibration framing: "This is calibration data only. Each session
     starts fresh. Prior losses do not reduce my conviction on a current structural setup."
  3. Reduced recent losses shown from 5 to 3 — minimizes the weight of loss history
     in the context window.
  4. Removed what_failed detail from loss entries — reduces the negative framing.

  ## SSOT
  All changes are in coordinator-alpha.ts only. No schema changes, no new tables,
  no threshold changes. The ai_trade_analysis table schema is unchanged.

  ## Affected File
  src/brains/coordinator-alpha.ts — trade history query (line ~784) and
  recentTradesContext construction (line ~953-999).
*/

INSERT INTO ccip_alpha_prompt_deployments (
  change_type,
  affected_file,
  affected_function,
  change_description,
  governance_notes,
  fix_count
) VALUES (
  'BUG_FIX',
  'src/brains/coordinator-alpha.ts',
  'coordinate() — ai_trade_analysis query + recentTradesContext builder',
  'Added 14-day recency filter to ai_trade_analysis query; removed LEARNING OBLIGATION imperative; replaced with calibration-only framing to prevent cross-session loss history from blocking new session scans',
  'Root cause of NO_TRADE confidence=45 on all pairs after executed trade. The ai_trade_analysis query had no time boundary, pulling all-time losses into the prompt as mandatory blocking evidence. GPT-4o interpreted LEARNING OBLIGATION as a hard gate rather than informational context. Fix: 14-day window + calibration framing.',
  4
);