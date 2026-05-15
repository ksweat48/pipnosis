/**
 * Trade Parameter Constraints (SSOT)
 *
 * Defines minimum viable trade parameters by asset class and symbol.
 * These are "physics + broker constraints", not Alpha's decision logic.
 *
 * These constraints answer: "Can this trade physically execute?"
 * NOT: "Should we take this trade?" (that's Alpha's job)
 */

import { ATRValue } from '../types/atr';

export interface MinimumStopLossConstraint {
  minPips: number;
  minAtrMultiple: number;
  minSpreadMultiple: number;
  reason: string;
}

export const MINIMUM_SL_DISTANCE_BY_SYMBOL: Record<string, MinimumStopLossConstraint> = {
  EURUSD: {
    minPips: 3,
    minAtrMultiple: 0.3,
    minSpreadMultiple: 2,
    reason: 'Major pair - tight but viable execution'
  },
  GBPUSD: {
    minPips: 3,
    minAtrMultiple: 0.3,
    minSpreadMultiple: 2,
    reason: 'Major pair - tight but viable execution'
  },
  USDJPY: {
    minPips: 3,
    minAtrMultiple: 0.3,
    minSpreadMultiple: 2,
    reason: 'Major pair - tight but viable execution'
  },
  AUDUSD: {
    minPips: 3,
    minAtrMultiple: 0.3,
    minSpreadMultiple: 2,
    reason: 'Major pair - tight but viable execution'
  },
  USDCAD: {
    minPips: 3,
    minAtrMultiple: 0.3,
    minSpreadMultiple: 2,
    reason: 'Major pair - tight but viable execution'
  },
  NZDUSD: {
    minPips: 3,
    minAtrMultiple: 0.3,
    minSpreadMultiple: 2,
    reason: 'Major pair - tight but viable execution'
  },
  XAUUSD: {
    minPips: 5,
    minAtrMultiple: 0.3,
    minSpreadMultiple: 2,
    reason: 'Gold - higher minimum due to volatility and pip value'
  },
  US30: {
    minPips: 8,
    minAtrMultiple: 0.3,
    minSpreadMultiple: 2,
    reason: 'Dow Jones index - points-based, spread ~3pts, minimum must clear noise floor'
  },
  NAS100: {
    minPips: 8,
    minAtrMultiple: 0.3,
    minSpreadMultiple: 2,
    reason: 'Nasdaq 100 index - points-based, volatile instrument, minimum must clear noise floor'
  },
  US100: {
    minPips: 8,
    minAtrMultiple: 0.3,
    minSpreadMultiple: 2,
    reason: 'Nasdaq 100 alias - same constraints as NAS100'
  },
  BTCUSD: {
    minPips: 50,
    minAtrMultiple: 0.2,
    minSpreadMultiple: 2,
    reason: 'Crypto - much higher pip minimum due to volatility'
  },
  ETHUSD: {
    minPips: 10,
    minAtrMultiple: 0.2,
    minSpreadMultiple: 2,
    reason: 'Crypto - higher pip minimum due to volatility'
  }
};

export const DEFAULT_MIN_SL_CONSTRAINT: MinimumStopLossConstraint = {
  minPips: 5,
  minAtrMultiple: 0.3,
  minSpreadMultiple: 2,
  reason: 'Conservative default for unknown symbols'
};

export function getMinStopLossConstraint(symbol: string): MinimumStopLossConstraint {
  return MINIMUM_SL_DISTANCE_BY_SYMBOL[symbol] || DEFAULT_MIN_SL_CONSTRAINT;
}


export interface StopLossValidationResult {
  valid: boolean;
  actualDistancePips: number;
  violations: string[];
  constraint: MinimumStopLossConstraint;
}

export function validateStopLossDistance(
  symbol: string,
  entryPrice: number,
  stopLossPrice: number,
  direction: 'LONG' | 'SHORT',
  pipValue: number,
  atr?: ATRValue,
  currentSpread?: number
): StopLossValidationResult {
  const constraint = getMinStopLossConstraint(symbol);
  const violations: string[] = [];

  // CRITICAL FIX: Use division by pipValue, not multiplication by pipMultiplier
  // For EURUSD: (1.1 - 1.097) / 0.0001 = 30 pips (CORRECT)
  // Was: (1.1 - 1.097) * 1 = 0.003 pips (WRONG - caused "0.0 pips below minimum" errors)
  const actualDistancePips = Math.abs((entryPrice - stopLossPrice) / pipValue);

  if (actualDistancePips === 0) {
    violations.push('Stop loss equals entry price (zero distance)');
  }

  if (actualDistancePips < 0) {
    violations.push('Stop loss is on wrong side of entry (negative distance)');
  }

  const correctSide = direction === 'LONG' ? stopLossPrice < entryPrice : stopLossPrice > entryPrice;
  if (!correctSide) {
    violations.push(`Stop loss ${stopLossPrice} is on wrong side for ${direction} entry at ${entryPrice}`);
  }

  if (atr && actualDistancePips > 0) {
    // Convert ATR value to pips using same formula as actualDistancePips
    const atrPips = atr.pipValue || (atr.value / pipValue);
    const atrMultiple = actualDistancePips / atrPips;
    if (atrMultiple < constraint.minAtrMultiple) {
      violations.push(
        `Distance is ${atrMultiple.toFixed(2)}x ATR, below minimum ${constraint.minAtrMultiple}x ATR`
      );
    }
  }

  if (currentSpread && actualDistancePips > 0) {
    const spreadMultiple = actualDistancePips / currentSpread;
    if (spreadMultiple < constraint.minSpreadMultiple) {
      violations.push(
        `Distance is ${spreadMultiple.toFixed(2)}x spread, below minimum ${constraint.minSpreadMultiple}x spread`
      );
    }
  }

  return {
    valid: violations.length === 0,
    actualDistancePips,
    violations,
    constraint
  };
}

export function validateTakeProfitDistance(
  symbol: string,
  entryPrice: number,
  takeProfitPrice: number,
  direction: 'LONG' | 'SHORT',
  pipValue: number
): { valid: boolean; reason?: string } {
  // CRITICAL FIX: Use division by pipValue, not multiplication by pipMultiplier
  const actualDistancePips = Math.abs((takeProfitPrice - entryPrice) / pipValue);

  if (actualDistancePips === 0) {
    return { valid: false, reason: 'Take profit equals entry price (zero distance)' };
  }

  if (actualDistancePips < 0) {
    return { valid: false, reason: 'Take profit distance is negative' };
  }

  const correctSide = direction === 'LONG' ? takeProfitPrice > entryPrice : takeProfitPrice < entryPrice;
  if (!correctSide) {
    return {
      valid: false,
      reason: `Take profit ${takeProfitPrice} is on wrong side for ${direction} entry at ${entryPrice}`
    };
  }

  return { valid: true };
}
