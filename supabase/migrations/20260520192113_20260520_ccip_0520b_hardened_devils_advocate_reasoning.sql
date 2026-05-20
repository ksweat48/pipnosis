/*
  # CCIP-2026-0520B: Hardened Devil's Advocate Reasoning

  ## Summary
  Alpha was naming contradicting evidence correctly but then dismissing it with circular
  survival arguments. This allowed conviction_after_challenge=true + execute_now
  even when the data was genuinely mixed.

  ## Changes
  1. Step 6 in alpha-identity.ts defines GENUINE vs CIRCULAR survival argument
  2. Circularity test: removing directional word makes sentence meaningless = unresolved
  3. Each circular survival increments contradictions_unresolved_count
  4. Existing rule already blocks execute_now when contradictions_unresolved_count > 0
  5. New directional integrity rule: no concrete structural references = circular

  ## Evidence
  - 13 consecutive XAUUSD SELL decisions (May 18-20), all hit stop loss
  - All had conviction_after_challenge=true with circular survival arguments

  ## Doctrine Compliance
  - Improves reasoning quality only (0511ZZ compliant)
  - No interpretation injected (0512A compliant)
  - No new execution gates, confidence floors, or phase-locks
*/

INSERT INTO alpha_engineering_doctrine (ccip_reference, doctrine_text, active, ratified_at, created_at)
VALUES (
  'CCIP-2026-0520B',
  'Hardened Devil''s Advocate — Anti-Circularity Reasoning Standard. Alpha''s thesis_survival_argument must defeat each named contradiction with a SPECIFIC structural fact from the data (price level, candle close, BOS event, failed wick). Circular reasoning — where removing the directional word makes the survival sentence meaningless — counts as an UNRESOLVED contradiction. Existing rule: contradictions_unresolved_count > 0 blocks execute_now. This amendment defines the quality standard for what constitutes resolved. A thesis that survives genuine structural attack executes immediately. A thesis that survives only via circular dismissal routes through wait_pullback.',
  true,
  now(),
  now()
)
ON CONFLICT DO NOTHING;