/**
 * Time-to-Fill Calculator
 *
 * Estimates how long it will take for a trade's TP to be hit based on:
 * - Distance to TP in pips
 * - Current ATR (volatility)
 * - Trading session
 * - Market conditions
 *
 * ARCHITECTURAL PRINCIPLE (v3.0 - ALPHA AUTHORITY):
 * ============================================
 * - TIME IS AN ADVISORY SIGNAL, NOT A CONSTRAINT
 * - NEVER hard-block or reclassify trades due to time-to-fill expectations
 * - Alpha's style decision is IMMUTABLE
 * - Apply confidence penalties for duration deviations (not style changes)
 * - Trades degrade intelligently through scoring, not mutation
 *
 * GOVERNANCE MODEL:
 * - Alpha decides style based on execution mechanics (M5 swing, pip targets, etc.)
 * - Time-to-fill is a LEARNING signal only
 * - Duration deviations penalize confidence, never reclassify
 * - "SCALP" means M5 execution logic, regardless of actual duration
 *
 * STYLE DURATION BANDS (ADVISORY ONLY):
 * - SCALP: 20min - 2hrs (optimal band for reward)
 * - MICRO_INTRADAY: 1hr - 6hrs (optimal band for reward)
 * - INTRADAY: 2hrs - 10hrs (optimal band for reward)
 *
 * BEHAVIOR (ADVISORY ONLY):
 * - Within optimal band → Apply confidence REWARD
 * - Outside optimal band → Apply confidence PENALTY
 * - Style remains UNCHANGED regardless of duration
 *
 * ⚠️ UNIT REQUIREMENTS:
 * - All inputs MUST be in PIPS, not price units
 * - ATR is typically stored in price units (e.g., 0.04370 for USDJPY)
 * - ALWAYS convert ATR to pips before calling: atrPips = atrPrice / pipValue
 * - Use calculateFromPrice() helper to avoid manual conversion errors
 */

import { PIPNOSIS_CORE_RULES } from '../lib/pipnosis-core-rules';

// ❌ REMOVED: StyleUpgradeRecommendation - style is IMMUTABLE after Alpha decides
// Time-to-fill is advisory only, never changes style

export interface TimeToFillResult {
  expectedHours: number;
  expectedMinutes: number;
  viability: 'OPTIMAL' | 'ACCEPTABLE' | 'WARNING' | 'EXTENDED' | 'VERY_EXTENDED';
  reasoning: string;
  confidence: number;
  recommendedAction: 'EXECUTE' | 'EXECUTE_WITH_PENALTY'; // ✅ SIMPLIFIED: No more "EXECUTE_WITH_UPGRADE"
  durationBand: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' | 'EXTENDED';
  shouldApplyReward: boolean;
  shouldApplyPenalty: boolean;
  confidencePenalty: number; // ✅ NEW: Explicit penalty amount (0 = no penalty)
  durationDeviation: 'WITHIN_BAND' | 'SLIGHTLY_OVER' | 'SIGNIFICANTLY_OVER' | 'VERY_EXTENDED';
}

/**
 * Input for time-to-fill calculation
 * ⚠️ ALL VALUES MUST BE IN PIPS
 */
export interface TimeToFillInput {
  tpDistancePips: number;
  atrPips: number; // ⚠️ MUST BE IN PIPS, not price units
  currentSession: 'london' | 'ny' | 'asian' | 'sydney' | 'overlap' | 'closed';
  symbol: string;
  volatilityMultiplier?: number;
}

/**
 * Alternative input accepting ATR in price units
 * This is the RECOMMENDED way to call the calculator to avoid unit conversion errors
 */
export interface TimeToFillPriceInput {
  tpDistancePips: number;
  atrPrice: number; // ATR in price units (e.g., 0.04370 for USDJPY)
  currentSession: 'london' | 'ny' | 'asian' | 'sydney' | 'overlap' | 'closed';
  symbol: string;
  volatilityMultiplier?: number;
}

class TimeToFillCalculator {
  private readonly SESSION_VELOCITY: Record<string, number> = {
    london: 1.2,
    ny: 1.1,
    overlap: 1.5,
    asian: 0.6,
    sydney: 0.4,
    closed: 0.1
  };

  private readonly SYMBOL_VELOCITY: Record<string, number> = {
    'EURUSD': 1.0,
    'GBPUSD': 1.2,
    'USDJPY': 0.9,
    'XAUUSD': 1.5,
    'US30': 1.3,
    'BTCUSD': 2.0
  };

  // Use consolidated style bands from pipnosis-core-rules (SSOT)
  private readonly STYLE_BANDS = {
    ...PIPNOSIS_CORE_RULES.STYLE_DURATION_BANDS,
    EXTENDED: { min: 10.0, max: Infinity }    // >10hrs (penalty zone)
  };

  // Use consolidated upgrade thresholds from pipnosis-core-rules (SSOT)
  private readonly SCALP_MAX = PIPNOSIS_CORE_RULES.STYLE_UPGRADE_THRESHOLDS.SCALP_TO_MICRO_HOURS;
  private readonly MICRO_INTRADAY_MAX = PIPNOSIS_CORE_RULES.STYLE_UPGRADE_THRESHOLDS.MICRO_TO_INTRADAY_HOURS;
  private readonly INTRADAY_MAX = PIPNOSIS_CORE_RULES.STYLE_UPGRADE_THRESHOLDS.PENALTY_THRESHOLD_HOURS;

  /**
   * Calculate time-to-fill from ATR in price units (RECOMMENDED)
   * This method handles the price-to-pip conversion internally to prevent errors
   *
   * @param input - Input with ATR in price units (e.g., 0.04370 for USDJPY)
   * @returns TimeToFillResult with expected duration and viability
   */
  calculateFromPrice(input: TimeToFillPriceInput): TimeToFillResult {
    const { atrPrice, symbol, ...rest } = input;

    // Convert ATR from price units to pips using the symbol's pip value
    const pipValue = TimeToFillCalculator.getPipFactor(symbol);
    const atrPips = atrPrice / pipValue;

    // Validate conversion - detect if wrong units were passed
    if (atrPips > 1000) {
      console.warn(`[TimeToFill] Suspicious ATR: ${atrPips} pips for ${symbol}. Check if price units were passed correctly.`);
    }

    return this.calculate({
      ...rest,
      symbol,
      atrPips
    });
  }

  /**
   * Calculate time-to-fill from ATR already in pips
   * ⚠️ WARNING: Ensure atrPips is actually in pips, not price units
   * Consider using calculateFromPrice() instead to avoid conversion errors
   */
  calculate(input: TimeToFillInput): TimeToFillResult {
    const {
      tpDistancePips,
      atrPips,
      currentSession,
      symbol,
      volatilityMultiplier = 1.0
    } = input;

    const safeTpPips = Math.max(0.01, Math.abs(tpDistancePips));
    const safeAtrPips = Math.max(0.01, Math.abs(atrPips));

    // ✅ UNIT VALIDATION: Detect if price units were passed instead of pips
    // ATR < 0.1 pips is suspicious - likely means price units were passed
    if (safeAtrPips < 0.1) {
      console.warn(`[TimeToFill] ⚠️ UNIT WARNING: ATR=${safeAtrPips} pips is suspiciously small for ${symbol}. Check if price units were passed.`);
      return {
        expectedHours: 999,
        expectedMinutes: 59940,
        viability: 'VERY_EXTENDED',
        reasoning: `Unit validation warning: ATR=${safeAtrPips.toFixed(4)} pips is very small - executing with penalty`,
        confidence: 20,
        recommendedAction: 'EXECUTE_WITH_PENALTY',
        durationBand: 'EXTENDED',
        shouldApplyReward: false,
        shouldApplyPenalty: true,
        confidencePenalty: 80, // ✅ High penalty for unit errors
        durationDeviation: 'VERY_EXTENDED'
      };
    }

    if (safeTpPips < 0.01) {
      return {
        expectedHours: 0.1,
        expectedMinutes: 6,
        viability: 'OPTIMAL',
        reasoning: 'Very tight TP - quick execution expected',
        confidence: 90,
        recommendedAction: 'EXECUTE',
        durationBand: 'SCALP',
        shouldApplyReward: true,
        shouldApplyPenalty: false,
        confidencePenalty: 0,
        durationDeviation: 'WITHIN_BAND'
      };
    }

    const sessionVelocity = this.SESSION_VELOCITY[currentSession] ?? 0.5;
    const symbolVelocity = this.getSymbolVelocity(symbol);

    const safeVolMultiplier = Math.max(0.1, Math.min(3.0, volatilityMultiplier));
    const atrMovesPerHour = Math.max(0.01, sessionVelocity * symbolVelocity * safeVolMultiplier);

    const atrMoves = safeTpPips / safeAtrPips;
    let expectedHours = atrMoves / atrMovesPerHour;

    expectedHours = Math.max(0.01, Math.min(999, expectedHours));
    const expectedMinutes = Math.round(expectedHours * 60);

    // ✅ ALPHA AUTHORITY MODEL: Style is IMMUTABLE, time is ADVISORY only
    let viability: TimeToFillResult['viability'];
    let recommendedAction: TimeToFillResult['recommendedAction'];
    let durationBand: TimeToFillResult['durationBand'];
    let durationDeviation: TimeToFillResult['durationDeviation'];
    let reasoning: string;
    let confidence: number;
    let confidencePenalty: number = 0;
    let shouldApplyReward = false;
    let shouldApplyPenalty = false;

    // Determine duration band and deviation (ADVISORY ONLY - does not change style)
    if (expectedHours <= this.SCALP_MAX) {
      viability = 'OPTIMAL';
      recommendedAction = 'EXECUTE';
      durationBand = 'SCALP';
      durationDeviation = 'WITHIN_BAND';
      reasoning = `Expected fill in ${expectedMinutes}min - optimal duration for fast execution (${currentSession} session)`;
      confidence = 85;
      confidencePenalty = 0;
      shouldApplyReward = true;
    } else if (expectedHours <= this.MICRO_INTRADAY_MAX) {
      viability = 'ACCEPTABLE';
      recommendedAction = 'EXECUTE';
      durationBand = 'MICRO_INTRADAY';
      durationDeviation = 'SLIGHTLY_OVER'; // ✅ Over SCALP band but within MICRO band
      reasoning = `Expected fill in ${this.formatHours(expectedHours)} - longer than SCALP optimal, minor confidence adjustment applied`;
      confidence = 75;
      confidencePenalty = 10; // ✅ Small penalty for exceeding SCALP band
      shouldApplyPenalty = true;
    } else if (expectedHours <= this.INTRADAY_MAX) {
      viability = 'WARNING';
      recommendedAction = 'EXECUTE';
      durationBand = 'INTRADAY';
      durationDeviation = 'SIGNIFICANTLY_OVER'; // ✅ Over both SCALP and MICRO bands
      reasoning = `Expected fill in ${this.formatHours(expectedHours)} - extended duration, moderate confidence penalty applied`;
      confidence = 65;
      confidencePenalty = 20; // ✅ Moderate penalty for extended duration
      shouldApplyPenalty = true;
    } else if (expectedHours <= 24) {
      viability = 'EXTENDED';
      recommendedAction = 'EXECUTE_WITH_PENALTY';
      durationBand = 'EXTENDED';
      durationDeviation = 'VERY_EXTENDED';
      reasoning = `Expected fill in ${this.formatHours(expectedHours)} - very extended duration, significant confidence penalty applied but EXECUTING`;
      confidence = 50;
      confidencePenalty = 35; // ✅ Higher penalty for very extended duration
      shouldApplyPenalty = true;
    } else {
      viability = 'VERY_EXTENDED';
      recommendedAction = 'EXECUTE_WITH_PENALTY';
      durationBand = 'EXTENDED';
      durationDeviation = 'VERY_EXTENDED';
      reasoning = `Expected fill ${this.formatHours(expectedHours)} - extremely extended duration, major confidence penalty applied but STILL EXECUTING`;
      confidence = 35;
      confidencePenalty = 50; // ✅ Maximum penalty for extremely long duration
      shouldApplyPenalty = true;
    }

    if (currentSession === 'asian' || currentSession === 'sydney') {
      confidence *= 0.85;
    } else if (currentSession === 'overlap') {
      confidence *= 1.1;
    }

    confidence = Math.min(100, Math.max(0, Math.round(confidence)));

    return {
      expectedHours,
      expectedMinutes,
      viability,
      reasoning,
      confidence,
      recommendedAction,
      durationBand,
      shouldApplyReward,
      shouldApplyPenalty,
      confidencePenalty, // ✅ Explicit penalty for duration deviation
      durationDeviation // ✅ Classification of how far off expected duration is
    };
  }

  private getSymbolVelocity(symbol: string): number {
    const upperSymbol = symbol.toUpperCase();

    if (this.SYMBOL_VELOCITY[upperSymbol]) {
      return this.SYMBOL_VELOCITY[upperSymbol];
    }

    if (upperSymbol.includes('XAU') || upperSymbol.includes('GOLD')) {
      return 1.5;
    }
    if (upperSymbol.includes('US30') || upperSymbol.includes('DOW') || upperSymbol.includes('DJ')) {
      return 1.3;
    }
    if (upperSymbol.includes('NAS') || upperSymbol.includes('NDX') || upperSymbol.includes('US100')) {
      return 1.4;
    }
    if (upperSymbol.includes('SPX') || upperSymbol.includes('US500') || upperSymbol.includes('SP500')) {
      return 1.2;
    }
    if (upperSymbol.includes('BTC') || upperSymbol.includes('ETH')) {
      return 2.0;
    }
    if (upperSymbol.includes('JPY')) {
      return 0.9;
    }
    if (upperSymbol.includes('GBP')) {
      return 1.2;
    }

    return 1.0;
  }

  private formatHours(hours: number): string {
    if (hours < 1) {
      return `${Math.round(hours * 60)}min`;
    } else if (hours < 2) {
      const mins = Math.round((hours % 1) * 60);
      return `${Math.floor(hours)}h ${mins}min`;
    } else {
      return `${hours.toFixed(1)}h`;
    }
  }

  isViableForIntraday(input: TimeToFillInput): boolean {
    const result = this.calculate(input);
    return result.recommendedAction.startsWith('EXECUTE');
  }

  getMinTPForDuration(
    targetHours: number,
    atrPips: number,
    session: TimeToFillInput['currentSession'],
    symbol: string
  ): number {
    const sessionVelocity = this.SESSION_VELOCITY[session] ?? 0.5;
    const symbolVelocity = this.getSymbolVelocity(symbol);
    const atrMovesPerHour = Math.max(0.01, sessionVelocity * symbolVelocity);

    const atrMoves = targetHours * atrMovesPerHour;
    return Math.round(atrMoves * Math.max(0.1, atrPips));
  }

  // ❌ REMOVED: getPipFactor() - replaced with SSOT getCurrencyPipInfo()
  // Use: import { getCurrencyPipInfo } from '../utils/currencyHelpers';
  //      const pipFactor = getCurrencyPipInfo(symbol).pipValue;
}

export const timeToFillCalculator = new TimeToFillCalculator();
