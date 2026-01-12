/**
 * TradeContext - Single Source of Truth Container
 *
 * This object is the ONLY legal way to carry symbol-specific mathematical parameters
 * through the trading pipeline. It ensures all Alpha/Omega/Execution logic uses
 * consistent, validated parameters from the symbol registry.
 *
 * ARCHITECTURE RULES:
 * 1. TradeContext can ONLY be created by the factory function in tradeMath.ts
 * 2. All trade-related functions MUST accept TradeContext, not raw symbol strings
 * 3. Context is immutable - create new context if symbol changes
 * 4. Context includes profileHash for integrity validation
 * 5. Context is timestamp-bound - stale contexts must be rejected
 */

import type { SymbolConfig, SymbolCategory } from '../config/symbol-registry';
import type { Dollars, Pips, Lots, Price } from './trading-units';
import { dollars, pips, lots, price, unwrapPips, unwrapLots, unwrapPrice } from './trading-units';

export interface TradeContext {
  readonly symbol: string;
  readonly category: SymbolCategory;
  readonly displayName: string;

  // Core mathematical parameters from SSOT
  readonly pipValue: number;
  readonly pipMultiplier: number;
  readonly decimalPlaces: number;
  readonly contractSize: number;
  readonly dollarPerPipPerLot: number;

  // Broker constraints
  readonly minLotSize: number;
  readonly maxLotSize: number;
  readonly lotStepSize: number;

  // Volatility characteristics
  readonly typicalDailyRangePoints: number;
  readonly typicalSessionMovePoints: number;
  readonly atrMultiplierForStop: number;

  // Integrity validation
  readonly profileHash: string;
  readonly createdAt: Date;
  readonly createdTimestamp: number;

  // Conversion methods (derived from SSOT parameters)
  readonly convertPipsToPrice: (pipDistance: Pips) => number;
  readonly convertPriceToPips: (priceDistance: number) => Pips;
  readonly calculateDollarsPerPip: (lotSize: Lots) => Dollars;
  readonly roundPrice: (rawPrice: number) => Price;
  readonly roundLots: (rawLots: number) => Lots;
  readonly validateLotSize: (lotSize: Lots) => { valid: boolean; error?: string };
  readonly validateSLTP: (entryPrice: Price, sl: Price, tp: Price, direction: 'long' | 'short') => { valid: boolean; error?: string };
}

/**
 * Result type for context creation - forces error handling
 */
export interface TradeContextResult {
  success: boolean;
  context?: TradeContext;
  error?: string;
  errorCode?: 'SYMBOL_NOT_FOUND' | 'INVALID_SYMBOL' | 'CONTEXT_CREATION_FAILED';
}

/**
 * Validation result for context integrity checks
 */
export interface ContextValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  violationType?: 'MISSING_CONTEXT' | 'HASH_MISMATCH' | 'STALE_CONTEXT' | 'PROFILE_MISMATCH';
}

/**
 * Create a profile hash from symbol config for integrity validation
 * Using simple string hash (not cryptographic - just for integrity check)
 */
export function createProfileHash(config: SymbolConfig): string {
  const hashInput = [
    config.symbol,
    config.pipValue.toString(),
    config.pipMultiplier.toString(),
    config.decimalPlaces.toString(),
    config.contractSize.toString(),
    config.dollarPerPipPerLot.toString(),
    config.minLotSize.toString(),
    config.maxLotSize.toString(),
  ].join('|');

  // Simple hash function (not cryptographic)
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `profile_${Math.abs(hash).toString(16)}`;
}

/**
 * Check if a context is stale (older than threshold)
 */
export function isContextStale(context: TradeContext, maxAgeMs: number = 5 * 60 * 1000): boolean {
  const age = Date.now() - context.createdTimestamp;
  return age > maxAgeMs;
}

/**
 * Create converter functions bound to a specific context
 * These ensure all conversions use the SSOT parameters
 */
export function createConverters(config: SymbolConfig) {
  const convertPipsToPrice = (pipDistance: Pips): number => {
    return unwrapPips(pipDistance) * config.pipValue;
  };

  const convertPriceToPips = (priceDistance: number): Pips => {
    return pips(priceDistance / config.pipValue);
  };

  const calculateDollarsPerPip = (lotSize: Lots): Dollars => {
    return dollars(unwrapLots(lotSize) * config.dollarPerPipPerLot);
  };

  const roundPrice = (rawPrice: number): Price => {
    const factor = Math.pow(10, config.decimalPlaces);
    const rounded = Math.round(rawPrice * factor) / factor;
    return price(rounded);
  };

  const roundLots = (rawLots: number): Lots => {
    // Round to valid lot step (typically 0.01)
    const lotStep = config.minLotSize;
    const rounded = Math.round(rawLots / lotStep) * lotStep;
    return lots(Math.max(rounded, config.minLotSize));
  };

  const validateLotSize = (lotSize: Lots): { valid: boolean; error?: string } => {
    const lotValue = unwrapLots(lotSize);

    if (lotValue < config.minLotSize) {
      return {
        valid: false,
        error: `Lot size ${lotValue} below minimum ${config.minLotSize}`
      };
    }

    if (lotValue > config.maxLotSize) {
      return {
        valid: false,
        error: `Lot size ${lotValue} above maximum ${config.maxLotSize}`
      };
    }

    // Check if lot size is a valid multiple of min lot size
    const remainder = lotValue % config.minLotSize;
    if (remainder > 0.00001) {
      return {
        valid: false,
        error: `Lot size ${lotValue} not a valid multiple of step size ${config.minLotSize}`
      };
    }

    return { valid: true };
  };

  const validateSLTP = (
    entryPrice: Price,
    sl: Price,
    tp: Price,
    direction: 'long' | 'short'
  ): { valid: boolean; error?: string } => {
    const entryValue = unwrapPrice(entryPrice);
    const slValue = unwrapPrice(sl);
    const tpValue = unwrapPrice(tp);

    // Check decimal precision
    const checkPrecision = (val: number): boolean => {
      const str = val.toFixed(config.decimalPlaces + 2);
      const actualDecimals = (str.split('.')[1] || '').replace(/0+$/, '').length;
      return actualDecimals <= config.decimalPlaces;
    };

    if (!checkPrecision(slValue) || !checkPrecision(tpValue)) {
      return {
        valid: false,
        error: `SL/TP precision exceeds ${config.decimalPlaces} decimal places`
      };
    }

    // Check SL/TP are valid multiples of pip value
    const slDistance = Math.abs(entryValue - slValue);
    const tpDistance = Math.abs(tpValue - entryValue);

    const slPips = slDistance / config.pipValue;
    const tpPips = tpDistance / config.pipValue;

    if (slPips < 1) {
      return {
        valid: false,
        error: `Stop loss too tight: ${slPips.toFixed(1)} pips (minimum 1 pip)`
      };
    }

    if (tpPips < 1) {
      return {
        valid: false,
        error: `Take profit too tight: ${tpPips.toFixed(1)} pips (minimum 1 pip)`
      };
    }

    // Check direction logic
    if (direction === 'long') {
      if (slValue >= entryValue) {
        return {
          valid: false,
          error: `Long trade: SL (${slValue}) must be below entry (${entryValue})`
        };
      }
      if (tpValue <= entryValue) {
        return {
          valid: false,
          error: `Long trade: TP (${tpValue}) must be above entry (${entryValue})`
        };
      }
    } else {
      if (slValue <= entryValue) {
        return {
          valid: false,
          error: `Short trade: SL (${slValue}) must be above entry (${entryValue})`
        };
      }
      if (tpValue >= entryValue) {
        return {
          valid: false,
          error: `Short trade: TP (${tpValue}) must be below entry (${entryValue})`
        };
      }
    }

    return { valid: true };
  };

  return {
    convertPipsToPrice,
    convertPriceToPips,
    calculateDollarsPerPip,
    roundPrice,
    roundLots,
    validateLotSize,
    validateSLTP,
  };
}

/**
 * Type guard to check if value is a valid TradeContext
 */
export function isTradeContext(value: unknown): value is TradeContext {
  if (!value || typeof value !== 'object') return false;

  const ctx = value as any;
  return (
    typeof ctx.symbol === 'string' &&
    typeof ctx.profileHash === 'string' &&
    typeof ctx.createdTimestamp === 'number' &&
    typeof ctx.pipValue === 'number' &&
    typeof ctx.convertPipsToPrice === 'function' &&
    typeof ctx.validateLotSize === 'function'
  );
}
