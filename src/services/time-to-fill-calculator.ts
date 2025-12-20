/**
 * Time-to-Fill Calculator
 *
 * Estimates how long it will take for a trade's TP to be hit based on:
 * - Distance to TP in pips
 * - Current ATR (volatility)
 * - Trading session
 * - Market conditions
 *
 * CRITICAL FOR INTRADAY FOCUS:
 * - Blocks trades that would take >6 hours
 * - Warns on trades >4 hours
 * - Targets 20min-2hr sweet spot
 */

export interface TimeToFillResult {
  expectedHours: number;
  expectedMinutes: number;
  viability: 'OPTIMAL' | 'ACCEPTABLE' | 'WARNING' | 'TOO_SLOW' | 'UNREALISTIC';
  reasoning: string;
  confidence: number; // 0-100
  recommendedAction: 'TAKE' | 'CAUTION' | 'REJECT';
}

export interface TimeToFillInput {
  tpDistancePips: number;
  atrPips: number;       // 24-hour ATR in pips
  currentSession: 'london' | 'ny' | 'asian' | 'sydney' | 'overlap' | 'closed';
  symbol: string;
  volatilityMultiplier?: number; // Optional: from regime detector
}

class TimeToFillCalculator {
  /**
   * Session velocity multipliers
   * How many ATR-moves per hour during each session
   */
  private readonly SESSION_VELOCITY = {
    london: 1.2,      // Most active, fastest fills
    ny: 1.1,          // Very active
    overlap: 1.5,     // London+NY overlap - highest velocity
    asian: 0.6,       // Slower, range-bound
    sydney: 0.4,      // Slowest
    closed: 0.1       // Weekend/holiday - nearly frozen
  };

  /**
   * Symbol-specific adjustments
   */
  private readonly SYMBOL_VELOCITY = {
    'EURUSD': 1.0,    // Baseline
    'GBPUSD': 1.2,    // More volatile
    'USDJPY': 0.9,    // Steadier
    'XAUUSD': 1.5,    // Gold moves fast
    'US30': 1.3,      // Index volatility
    'BTCUSD': 2.0     // Crypto extreme
  };

  /**
   * Target duration thresholds (hours)
   */
  private readonly OPTIMAL_MAX = 2.0;    // 20min-2hr is optimal
  private readonly ACCEPTABLE_MAX = 4.0; // Up to 4hr is acceptable
  private readonly WARNING_MAX = 6.0;    // 4-6hr gets warning
  private readonly BLOCK_THRESHOLD = 6.0; // >6hr is blocked

  /**
   * Calculate expected time to fill TP
   */
  calculate(input: TimeToFillInput): TimeToFillResult {
    const {
      tpDistancePips,
      atrPips,
      currentSession,
      symbol,
      volatilityMultiplier = 1.0
    } = input;

    // Validate inputs
    if (tpDistancePips <= 0 || atrPips <= 0) {
      return {
        expectedHours: 999,
        expectedMinutes: 59940,
        viability: 'UNREALISTIC',
        reasoning: 'Invalid input: TP distance or ATR is zero/negative',
        confidence: 0,
        recommendedAction: 'REJECT'
      };
    }

    // Get velocity factors
    const sessionVelocity = this.SESSION_VELOCITY[currentSession] || 0.5;
    const symbolVelocity = this.SYMBOL_VELOCITY[symbol] || 1.0;

    // Calculate ATR moves per hour
    const atrMovesPerHour = sessionVelocity * symbolVelocity * volatilityMultiplier;

    // Calculate expected hours to fill
    // If ATR is 20 pips and TP is 40 pips away, that's 2 ATR moves
    // If market moves 1.2 ATR per hour, that's 2 / 1.2 = 1.67 hours
    const atrMoves = tpDistancePips / atrPips;
    const expectedHours = atrMoves / atrMovesPerHour;
    const expectedMinutes = Math.round(expectedHours * 60);

    // Determine viability
    let viability: TimeToFillResult['viability'];
    let recommendedAction: TimeToFillResult['recommendedAction'];
    let reasoning: string;
    let confidence: number;

    if (expectedHours <= this.OPTIMAL_MAX) {
      viability = 'OPTIMAL';
      recommendedAction = 'TAKE';
      reasoning = `Expected fill in ${expectedMinutes}min - perfect for intraday (${currentSession} session)`;
      confidence = 85;
    } else if (expectedHours <= this.ACCEPTABLE_MAX) {
      viability = 'ACCEPTABLE';
      recommendedAction = 'TAKE';
      reasoning = `Expected fill in ${this.formatHours(expectedHours)} - acceptable for intraday`;
      confidence = 70;
    } else if (expectedHours <= this.WARNING_MAX) {
      viability = 'WARNING';
      recommendedAction = 'CAUTION';
      reasoning = `Expected fill in ${this.formatHours(expectedHours)} - approaching swing trade duration. Consider tighter TP or skip.`;
      confidence = 50;
    } else if (expectedHours <= 24) {
      viability = 'TOO_SLOW';
      recommendedAction = 'REJECT';
      reasoning = `Expected fill in ${this.formatHours(expectedHours)} - TOO SLOW for intraday specialist. This is a swing trade. BLOCKED.`;
      confidence = 80;
    } else {
      viability = 'UNREALISTIC';
      recommendedAction = 'REJECT';
      reasoning = `Expected fill >24 hours - unrealistic TP distance (${tpDistancePips} pips with ATR ${atrPips}). BLOCKED.`;
      confidence = 95;
    }

    // Adjust confidence based on session
    if (currentSession === 'asian' || currentSession === 'sydney') {
      confidence *= 0.8; // Less confident in slow sessions
    } else if (currentSession === 'overlap') {
      confidence *= 1.1; // More confident in overlap
    }

    confidence = Math.min(100, Math.max(0, Math.round(confidence)));

    return {
      expectedHours,
      expectedMinutes,
      viability,
      reasoning,
      confidence,
      recommendedAction
    };
  }

  /**
   * Format hours for display
   */
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

  /**
   * Quick check: Will this trade likely complete within target duration?
   */
  isViableForIntraday(input: TimeToFillInput): boolean {
    const result = this.calculate(input);
    return result.recommendedAction === 'TAKE';
  }

  /**
   * Get minimum TP distance for target duration
   */
  getMinTPForDuration(
    targetHours: number,
    atrPips: number,
    session: TimeToFillInput['currentSession'],
    symbol: string
  ): number {
    const sessionVelocity = this.SESSION_VELOCITY[session] || 0.5;
    const symbolVelocity = this.SYMBOL_VELOCITY[symbol] || 1.0;
    const atrMovesPerHour = sessionVelocity * symbolVelocity;

    // Work backwards: if we want 2 hours, and market moves 1.2 ATR/hour
    // We need 2 * 1.2 = 2.4 ATR moves = 2.4 * atrPips distance
    const atrMoves = targetHours * atrMovesPerHour;
    return Math.round(atrMoves * atrPips);
  }
}

export const timeToFillCalculator = new TimeToFillCalculator();
