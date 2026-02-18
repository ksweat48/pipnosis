/*
  # CCIP: Entry Advisory Timeframe Alignment Governance

  ## Change Intent
  Alpha's entry advisory (GOOD_ENTRY vs PULLBACK_EXPECTED) was being determined
  primarily from M1 micro-candle data, while the trade itself operates on the
  primary timeframe (SCALP=M5, MICRO_INTRADAY=M15, INTRADAY=H1).

  This caused Alpha to call "Good Entry CONFIRMED" based on a single M1 rejection
  wick while the primary timeframe showed an impulsive leg with no pullback —
  resulting in trades entering at poor prices that immediately retrace.

  ## Changes Made (Frontend/Prompt Only — No Schema Changes)

  1. **coordinator-alpha.ts**: Added PRIMARY TIMEFRAME CANDLE OHLC array to Alpha's
     prompt. Alpha now receives the actual candle-by-candle OHLC data for the trade's
     primary timeframe (M5 for SCALP, M15 for MICRO_INTRADAY, H1 for INTRADAY),
     including consecutive same-direction candle count and impulsive leg detection.

  2. **coordinator-alpha.ts**: M1 MICRO context header changed from "SNIPER ENTRY
     INTELLIGENCE" (implying it is the primary signal) to "TIMING REFINEMENT
     (SECONDARY)" with explicit hierarchy reminder that M1 does not override the
     primary timeframe.

  3. **alpha-identity.ts**: PULLBACK REASONING FRAMEWORK restructured from
     timeframe-agnostic (defaulted to M1) to timeframe-aware 5-step process:
     Step 1: Check primary TF candles (dominant signal)
     Step 2: Check structural levels
     Step 3: Check VWAP/EMA
     Step 4: Refine with M1 (secondary/timing only)
     Step 5: Override only with exceptional breakaway evidence

  4. **alpha-identity.ts**: GOOD_ENTRY verdict criteria updated to require primary TF
     evidence. M1-only evidence (e.g., single rejection wick) is explicitly
     insufficient when primary TF shows impulsive movement.

  5. **alpha-identity.ts**: Style-specific entry advisory directives updated for all
     three styles (SCALP, MICRO_INTRADAY, INTRADAY) to prioritize their primary
     timeframe analysis over M1 micro-data.

  ## SSOT Compliance
  - MarketDataService remains the single authority for candle data retrieval
  - Alpha remains the sole authority for entry advisory verdict
  - Entry Monitor remains a pure display layer (no independent analysis added)

  ## Governance
  - Primary timeframe candle data is fetched via the same MarketDataService.getCandles()
    used for M1, maintaining SSOT for candle retrieval
  - 3+ consecutive same-direction candles on the primary TF is a STRONG GUIDELINE
    (not a hard rule) for PULLBACK_EXPECTED — Alpha can override with justification
  - For INTRADAY, the threshold is 2+ consecutive H1 candles (H1 candles are larger)

  ## Affected Components
  - src/brains/coordinator-alpha.ts (prompt composition)
  - src/config/alpha-identity.ts (entry advisory framework and style directives)
  - No database schema changes required
  - No UI changes required (EntryPriceMonitor.tsx is unchanged)
*/

SELECT 1;
