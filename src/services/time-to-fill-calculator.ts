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
  confidence: number;
  recommendedAction: 'TAKE' | 'CAUTION' | 'REJECT';
}

export interface TimeToFillInput {
  tpDistancePips: number;
  atrPips: number;
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

  private readonly OPTIMAL_MAX = 2.0;
  private readonly ACCEPTABLE_MAX = 4.0;
  private readonly WARNING_MAX = 6.0;

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

    if (safeTpPips < 0.01 || safeAtrPips < 0.01) {
      return {
        expectedHours: 999,
        expectedMinutes: 59940,
        viability: 'UNREALISTIC',
        reasoning: 'Invalid input: TP distance or ATR is too small (<0.01 pips)',
        confidence: 0,
        recommendedAction: 'REJECT'
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
      reasoning = `Expected fill in ${this.formatHours(expectedHours)} - approaching swing trade duration. Consider tighter TP.`;
      confidence = 50;
    } else if (expectedHours <= 24) {
      viability = 'TOO_SLOW';
      recommendedAction = 'REJECT';
      reasoning = `Expected fill in ${this.formatHours(expectedHours)} - TOO SLOW for intraday. BLOCKED.`;
      confidence = 80;
    } else {
      viability = 'UNREALISTIC';
      recommendedAction = 'REJECT';
      reasoning = `Expected fill >24 hours - unrealistic TP (${safeTpPips.toFixed(1)} pips with ATR ${safeAtrPips.toFixed(1)}). BLOCKED.`;
      confidence = 95;
    }

    if (currentSession === 'asian' || currentSession === 'sydney') {
      confidence *= 0.8;
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
      recommendedAction
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
    return result.recommendedAction === 'TAKE';
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

  static getPipFactor(symbol: string): number {
    const upper = symbol.toUpperCase();
    if (upper.includes('JPY')) return 0.01;
    if (upper.includes('XAU') || upper.includes('GOLD')) return 0.1;
    if (upper.includes('US30') || upper.includes('DOW') || upper.includes('DJ')) return 1.0;
    if (upper.includes('NAS') || upper.includes('NDX') || upper.includes('US100')) return 0.1;
    if (upper.includes('SPX') || upper.includes('US500')) return 0.1;
    if (upper.includes('BTC')) return 1.0;
    return 0.0001;
  }
}

export const timeToFillCalculator = new TimeToFillCalculator();
