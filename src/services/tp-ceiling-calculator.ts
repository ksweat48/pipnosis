/**
 * TP Ceiling Calculator - Physics-Based Constraints
 *
 * Enforces market physics for take profit targets.
 * Does NOT control strategy - only ensures targets are physically feasible.
 *
 * Think of this as gravity for price targets:
 * - Alpha decides WHERE to throw the ball (strategy, autonomy)
 * - This enforces HOW FAR it can travel (physics, reality)
 */

import { logger } from '../lib/logger';

export interface TPCeilingInput {
  symbol: string;
  entry: number;
  direction: 'BUY' | 'SELL';
  atr: number;
  currentSession: 'london' | 'ny' | 'asian' | 'sydney' | 'overlap' | 'closed';
  sessionTimeRemainingMinutes?: number;
  volatilityRegime?: 'low' | 'medium' | 'high';
}

export interface TPCeilingResult {
  maxFeasibleTP: number;
  ceilingPrice: number;
  limitingFactor: 'ATR' | 'SESSION_TIME' | 'DAILY_RANGE';
  maxATRMultiple: number;
  maxDistancePips: number;
  reasoning: string;
  confidence: number;
}

export class TPCeilingCalculator {
  private readonly MAX_ATR_MULTIPLE = 10.0;

  private readonly SESSION_VELOCITY: Record<string, number> = {
    london: 1.2,
    ny: 1.1,
    overlap: 1.5,
    asian: 0.6,
    sydney: 0.4,
    closed: 0.1
  };

  calculateMaximumFeasibleTP(input: TPCeilingInput): TPCeilingResult {
    const {
      symbol,
      entry,
      direction,
      atr,
      currentSession,
      sessionTimeRemainingMinutes,
      volatilityRegime
    } = input;

    const pipValue = this.getPipValue(symbol);
    const atrInPips = atr / pipValue;

    const atrCeiling = this.calculateATRCeiling(atrInPips, volatilityRegime);

    let sessionCeiling: number | null = null;
    if (sessionTimeRemainingMinutes && sessionTimeRemainingMinutes > 0) {
      sessionCeiling = this.calculateSessionCeiling(
        atrInPips,
        currentSession,
        sessionTimeRemainingMinutes,
        symbol
      );
    }

    const dailyRangeCeiling = this.calculateDailyRangeCeiling(atrInPips);

    let maxDistancePips = atrCeiling;
    let limitingFactor: 'ATR' | 'SESSION_TIME' | 'DAILY_RANGE' = 'ATR';
    let reasoning = `ATR ceiling: ${atrCeiling.toFixed(1)} pips (${(atrCeiling / atrInPips).toFixed(1)}x ATR)`;

    if (sessionCeiling !== null && sessionCeiling < maxDistancePips) {
      maxDistancePips = sessionCeiling;
      limitingFactor = 'SESSION_TIME';
      reasoning = `Session time ceiling: ${sessionCeiling.toFixed(1)} pips (${sessionTimeRemainingMinutes}min remaining in ${currentSession})`;
    }

    if (dailyRangeCeiling < maxDistancePips) {
      maxDistancePips = dailyRangeCeiling;
      limitingFactor = 'DAILY_RANGE';
      reasoning = `Daily range ceiling: ${dailyRangeCeiling.toFixed(1)} pips (1.1x typical daily range)`;
    }

    const maxDistancePrice = maxDistancePips * pipValue;
    const ceilingPrice = direction === 'BUY'
      ? entry + maxDistancePrice
      : entry - maxDistancePrice;

    const maxATRMultiple = maxDistancePips / atrInPips;

    let confidence = 85;
    if (limitingFactor === 'SESSION_TIME') {
      confidence = 70;
    } else if (limitingFactor === 'DAILY_RANGE') {
      confidence = 75;
    }

    if (currentSession === 'asian' || currentSession === 'sydney') {
      confidence *= 0.9;
    }

    logger.info('[TP Ceiling] Calculated maximum feasible TP', {
      symbol,
      direction,
      entry,
      maxDistancePips: maxDistancePips.toFixed(1),
      ceilingPrice: ceilingPrice.toFixed(5),
      limitingFactor,
      maxATRMultiple: maxATRMultiple.toFixed(2),
      confidence: Math.round(confidence)
    });

    return {
      maxFeasibleTP: maxDistancePips,
      ceilingPrice,
      limitingFactor,
      maxATRMultiple,
      maxDistancePips,
      reasoning,
      confidence: Math.round(confidence)
    };
  }

  private calculateATRCeiling(atrPips: number, volatilityRegime?: string): number {
    let multiplier = this.MAX_ATR_MULTIPLE;

    if (volatilityRegime === 'high') {
      multiplier = 8.0;
    } else if (volatilityRegime === 'low') {
      multiplier = 12.0;
    }

    return atrPips * multiplier;
  }

  private calculateSessionCeiling(
    atrPips: number,
    session: string,
    timeRemainingMinutes: number,
    symbol: string
  ): number {
    const sessionVelocity = this.SESSION_VELOCITY[session] || 0.5;
    const symbolVelocity = this.getSymbolVelocity(symbol);

    const pipsPerHour = atrPips * sessionVelocity * symbolVelocity;

    const pipsInTimeRemaining = (pipsPerHour / 60) * timeRemainingMinutes;

    const safetyBuffer = 1.25;
    return pipsInTimeRemaining * safetyBuffer;
  }

  private calculateDailyRangeCeiling(atrPips: number): number {
    const avgDailyRange = atrPips * 3.5;

    return avgDailyRange * 1.1;
  }

  private getSymbolVelocity(symbol: string): number {
    const upperSymbol = symbol.toUpperCase();

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

  private getPipValue(symbol: string): number {
    const upper = symbol.toUpperCase();
    if (upper.includes('JPY')) return 0.01;
    if (upper.includes('XAU') || upper.includes('GOLD')) return 0.1;
    if (upper.includes('US30') || upper.includes('DOW') || upper.includes('DJ')) return 1.0;
    if (upper.includes('NAS') || upper.includes('NDX') || upper.includes('US100')) return 0.1;
    if (upper.includes('SPX') || upper.includes('US500')) return 0.1;
    if (upper.includes('BTC')) return 1.0;
    return 0.0001;
  }

  isTPWithinCeiling(
    proposedTP: number,
    entry: number,
    direction: 'BUY' | 'SELL',
    ceiling: TPCeilingResult
  ): {
    isValid: boolean;
    exceededBy: number;
    exceededByPips: number;
    shouldAutoCorrect: boolean;
  } {
    const actualDistance = Math.abs(proposedTP - entry);
    const ceilingDistance = Math.abs(ceiling.ceilingPrice - entry);

    const isValid = direction === 'BUY'
      ? proposedTP <= ceiling.ceilingPrice
      : proposedTP >= ceiling.ceilingPrice;

    const exceededBy = actualDistance - ceilingDistance;
    const pipValue = this.getPipValue(ceiling.ceilingPrice.toString());
    const exceededByPips = exceededBy / pipValue;

    const shouldAutoCorrect = !isValid && exceededByPips > 5;

    return {
      isValid,
      exceededBy,
      exceededByPips,
      shouldAutoCorrect
    };
  }
}

export const tpCeilingCalculator = new TPCeilingCalculator();
