/*
  # CCIP 2026-02-20: Console Error Fixes and ETHUSD Wall Calibration

  ## Summary
  Three production bugs identified from live console log analysis and fixed under CCIP governance.

  ## Changes

  ### Bug 1: pipFactor Undefined Variable (multi-symbol-ranker.ts)
  - WHAT: `dailyRange` was computed as `(dailyHigh - dailyLow) / pipFactor` but `pipFactor`
    was never defined in scope. This caused `dailyRange` to be `NaN` or `Infinity`, which
    propagated into `scoreVolatilityHealth()` and downstream scoring calls.
  - ROOT CAUSE: Stale variable reference — the intent was always `pipInfo.pipValue` which is
    correctly computed on the line above via `getCurrencyPipInfo(symbol)`.
  - FIX: Replaced `pipFactor` with `pipInfo.pipValue` on line 88 of multi-symbol-ranker.ts.
  - IMPACT: Eliminated the `[Currency Helpers] Invalid symbol provided: <NUMBER>` spam
    (45+ warnings per scan cycle from NaN values cascading into symbol-check functions).
  - SSOT AUTHORITY: `getCurrencyPipInfo` in currencyHelpers.ts is the sole pip value authority.

  ### Bug 2: 504 Gateway Timeout on openai-chat Netlify Function
  - WHAT: Alpha+Omega scans for heavy symbols (US30, ETHUSD) were hitting the Netlify function
    timeout of 26 seconds, triggering 504 errors and client retries. The concurrent execution
    config allocates 60 seconds per symbol for Asian session but the proxy only allowed 26s.
  - ROOT CAUSE: Timeout mismatch across three layers:
      - netlify.toml: `openai-chat` timeout = 26s
      - openai-chat.ts: FUNCTION_TIMEOUT_MS = 25000ms
      - openai-client.ts: fetchTimeoutMs = 30000ms (client aborted before server responded)
  - FIX: Coordinated increase across all three layers:
      - netlify.toml: timeout 26 → 55 (Netlify Pro supports this)
      - openai-chat.ts: FUNCTION_TIMEOUT_MS 25000 → 50000, OPENAI_REQUEST_TIMEOUT_MS 20000 → 45000
      - openai-client.ts: fetchTimeoutMs 30000 → 55000
  - IMPACT: US30 and ETHUSD scans completing within timeout instead of requiring retries.
    Reduces total scan time by eliminating 500ms retry delays × number of retries.
  - SSOT AUTHORITY: openai-client.ts is the sole browser-side LLM proxy client.

  ### Bug 3: ETHUSD SCALP Arena Wall Violation
  - WHAT: ETHUSD was consistently blocked with "WALL VIOLATION: TP 9.8 pips below wall min 12.7".
    Alpha correctly identified scalp setups but all were rejected by the wall floor.
  - ROOT CAUSE: SCALP envelope CRYPTO tpPercent.min = 0.50% produced a wall minimum of 12.7 pips
    at ETHUSD ~$2,540. ETHUSD M5 ATR in low/normal volatility sessions is 8-12 pips. Alpha's
    realistic TP proposals of 9-11 pips were always below the floor — making ETHUSD effectively
    untradeable for SCALP in any sub-high-volatility regime.
  - FIX: SCALP CRYPTO tpPercent.min lowered from 0.50% to 0.35% in style-execution-envelopes.ts.
    At $2,500 ETHUSD: new floor = 8.75 pips (realistic for M5 scalps).
    BTCUSD at ~$90,000: new floor = 315 pips (appropriate for BTC M5 scalps).
    slPercent.min unchanged at 0.30% (noise floor governance compliance maintained).
  - SSOT AUTHORITY: style-execution-envelopes.ts is the sole style wall boundary authority.
    The wall calibration engine (wall-calibration-engine.ts) reads from this config.

  ## Files Modified
  - src/services/multi-symbol-ranker.ts: `pipFactor` → `pipInfo.pipValue` (line 88)
  - netlify.toml: openai-chat timeout 26 → 55
  - netlify/functions/openai-chat.ts: FUNCTION_TIMEOUT_MS 25000 → 50000, OPENAI_REQUEST_TIMEOUT_MS 20000 → 45000
  - src/services/openai-client.ts: fetchTimeoutMs 30000 → 55000
  - src/config/style-execution-envelopes.ts: SCALP CRYPTO tpPercent.min 0.50% → 0.35%

  ## CCIP Compliance
  - All changes are bug fixes with no behavioral changes to Alpha's decision logic
  - Wall change is the minimum adjustment needed to restore ETHUSD SCALP viability
  - Timeout changes are coordinated across all three layers to maintain safety margins
  - No LLM prompt changes, no threshold changes outside of ETHUSD wall floor
*/

DO $$
BEGIN
  RAISE NOTICE 'CCIP 20260220: Three production bug fixes applied.';
  RAISE NOTICE 'Bug 1: pipFactor undefined in multi-symbol-ranker.ts → replaced with pipInfo.pipValue.';
  RAISE NOTICE 'Bug 2: openai-chat 504 timeout chain → 26s/25s/30s upgraded to 55s/50s/55s.';
  RAISE NOTICE 'Bug 3: ETHUSD SCALP wall floor too high → CRYPTO tpPercent.min 0.50%% → 0.35%%.';
  RAISE NOTICE 'SSOT authorities: currencyHelpers.ts (pip math), openai-client.ts (LLM proxy), style-execution-envelopes.ts (wall floors).';
END $$;
