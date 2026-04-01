/*
  # CCIP-2026-0401-PAIR-PERSONALITY-V2
  # Pair Personality Identity Upgrade — All Instruments

  ## Summary
  Elevates all pair personality context injections to the same depth and
  quality standard exposed by the Gold XAUUSD trade audit of March 31, 2026.

  ## What Changed
  Each personality now contains three layers of awareness that were previously
  absent or underdeveloped:

  1. SESSION-NOISE RELATIONSHIP — instrument noise floor changes with session
     participation. Alpha self-derives appropriate stop breathing room.

  2. LIQUIDITY SWEEP vs DIRECTIONAL SIGNAL DISTINCTION — sweep without BOS
     is a liquidity event, not a continuation signal. Now explicit per instrument.

  3. OPENING WINDOW AWARENESS — high-wick opening windows described so Alpha
     understands candle behavior during those periods without being given rules.

  ## Instruments Updated
  XAUUSD, EURUSD, GBPUSD, USDJPY, GBPJPY, EURJPY, AUDJPY,
  US30, NAS100, SPX500, UK100, GER40, BTCUSD, ETHUSD,
  AUDUSD, NZDUSD, USDCAD, USDCHF, EURCHF,
  EURGBP, EURAUD, EURNZD, EURCAD + all category fallbacks

  ## SSOT Compliance
  pair-personalities.ts is the ONLY authority for pair personality context.
  No numeric values added. Public interface unchanged.
*/

INSERT INTO ccip_alpha_prompt_deployments (
  deployed_at,
  change_type,
  affected_file,
  affected_function,
  change_description,
  governance_notes,
  fix_count
)
VALUES (
  now(),
  'IDENTITY_UPGRADE',
  'src/config/pair-personalities.ts',
  'getPairPersonalityContext / getPairCharacterContext',
  'Elevated all pair personality context injections to Gold-standard depth. Added session-noise relationship, sweep vs directional signal distinction, and opening window awareness to all instruments. No rules or numeric values added — pure behavioral context upgrade. CCIP tag: CCIP-2026-0401-PAIR-PERSONALITY-V2.',
  'Triggered by XAUUSD SELL audit March 31 2026 — 8-pip stop on dead session at 1.25x ATR, 2 pips beyond named swing high, sweep-without-BOS misread as continuation. Root cause: pair personality gave awareness but not the behavioral depth for Alpha to self-correct. Fix: all pairs upgraded to same standard.',
  24
);
