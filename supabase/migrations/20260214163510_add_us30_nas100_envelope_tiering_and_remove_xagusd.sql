/*
  # US30 & NAS100 Per-Symbol Envelope Tiering + XAGUSD Removal

  ## Summary
  Governance documentation for volatile index envelope overrides and XAGUSD cleanup.

  ## Problem Statement
  Two actively traded index instruments have noise floors that exceed or approach
  the generic INDEX asset class SL maximums, causing constraint sandwich rejections:

  1. **US30 (Dow Jones) at ~$42,000**
     - Price-based noise floor: 0.15% x $42,000 = 63 pips
     - Generic INDEX SCALP SL max: 35 pips -- SANDWICHED (63 >> 35, 1.8x over limit)
     - Generic INDEX MICRO SL max: 70 pips -- borderline (63 vs 70, only 10% headroom)
     - In high-volatility regime (1.2x ATR multiplier), MICRO also sandwiches

  2. **NAS100 (Nasdaq 100) at ~$25,500**
     - Price-based noise floor: 0.15% x $25,500 = 38.25 pips
     - Generic INDEX SCALP SL max: 35 pips -- SANDWICHED (38.25 > 35, 9% over limit)
     - The code already documented this exact problem in omega9-constraint-provider.ts

  ## Resolution: Per-Symbol Envelope Overrides

  Following the same BTCUSD pattern (symbolOverrides in StyleExecutionEnvelope),
  US30 and NAS100 now have dedicated bounds across all 4 styles.

  ### US30 Overrides (all 4 styles)
  | Style           | TP Range     | SL Range     | Noise Floor Headroom |
  |-----------------|-------------|-------------|---------------------|
  | SCALP           | 30-200 pips | 20-100 pips | 59% above 63 pip floor |
  | MICRO_INTRADAY  | 60-400 pips | 35-150 pips | 138% above 63 pip floor |
  | INTRADAY        | 120-600 pips | 50-250 pips | 297% above 63 pip floor |
  | SWING           | 250-1200 pips | 100-400 pips | 535% above 63 pip floor |

  US30 SCALP SL max (100) future-proofs to US30 price of ~$66,000
  US30 MICRO SL max (150) handles high-volatility ATR-based floors comfortably

  ### NAS100 Overrides (all 4 styles)
  | Style           | TP Range     | SL Range     | Noise Floor Headroom |
  |-----------------|-------------|-------------|---------------------|
  | SCALP           | 25-150 pips | 15-70 pips  | 83% above 38 pip floor |
  | MICRO_INTRADAY  | 50-300 pips | 25-110 pips | 189% above 38 pip floor |
  | INTRADAY        | 100-500 pips | 40-180 pips | 374% above 38 pip floor |
  | SWING           | 250-1000 pips | 80-350 pips | 821% above 38 pip floor |

  NAS100 SCALP SL max (70) future-proofs to NAS100 price of ~$46,667

  ## XAGUSD Removal
  XAGUSD (Silver) was never part of the active watchlist (DEFAULT_WATCHLIST) but
  had residual configuration in 12 source files. All references removed:
  - src/config/symbol-registry.ts
  - src/config/trading-constants.ts
  - src/config/trade-parameter-constraints.ts
  - src/config/intelligent-indicator-weights.ts
  - src/utils/currencyHelpers.ts
  - src/types/symbol.ts
  - src/services/tick-buffer-service.ts
  - src/services/price-validation-service.ts
  - src/services/session-constraint-coordinator.ts
  - src/services/dynamic-slippage-estimator.ts
  - src/services/entry-structure-analyzer.ts
  - src/tests/symbol-validation.test.ts

  ## SSOT Compliance
  - `getAssetClassEnvelopeBounds()` remains the single authority for all envelope bounds
  - Symbol overrides checked first, then asset class defaults, then base defaults
  - `detectConstraintSandwich()` automatically uses symbol overrides via `getAssetClassEnvelopeBounds()`
  - `getViableStyles()` automatically benefits from the wider bounds
  - No new code paths, functions, or abstractions introduced

  ## CCIP Compliance
  - System Map: Identified noise floor vs envelope cap conflicts for US30 and NAS100
  - Logic Contract: Bounds computed from noise floor analysis with 59-821% headroom
  - Compatibility: Existing callers pass symbol, overrides resolve automatically
  - No business logic changes, only configuration bounds widened

  ## Files Modified
  - `src/config/style-execution-envelopes.ts` - Added US30 and NAS100 symbolOverrides
  - 12 source files - Removed dead XAGUSD references
*/

SELECT 1;
