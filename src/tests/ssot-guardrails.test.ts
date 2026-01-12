/**
 * SSOT Guardrails Test Suite
 *
 * Tests the complete SSOT enforcement system including:
 * - Branded unit types prevent mixing
 * - TradeContext factory and validation
 * - Pre-flight guardrail blocks invalid contexts
 * - Execution guardrail validates lots and SL/TP
 */

import { describe, it, expect } from '@jest/globals';
import {
  dollars,
  pips,
  lots,
  price,
  unwrapDollars,
  unwrapPips,
  unwrapLots,
  DollarsOps,
  PipsOps,
} from '../types/trading-units';
import { createTradeContext, validateTradeContext, refreshTradeContext } from '../utils/tradeMath';
import { validatePreFlight, createBlockedDecision } from '../services/ssot-preflight-guard';
import { createProfileHash, isContextStale } from '../types/trade-context';
import { getSymbolConfig } from '../config/symbol-registry';

describe('SSOT Guardrails - Branded Unit Types', () => {
  it('should create valid branded types', () => {
    const d = dollars(100);
    const p = pips(50);
    const l = lots(0.1);
    const pr = price(1.1000);

    expect(unwrapDollars(d)).toBe(100);
    expect(unwrapPips(p)).toBe(50);
    expect(unwrapLots(l)).toBe(0.1);
    expect(unwrapLots(l)).toBe(0.1);
  });

  it('should reject invalid dollar amounts', () => {
    expect(() => dollars(NaN)).toThrow('Invalid dollar amount');
    expect(() => dollars(Infinity)).toThrow('Invalid dollar amount');
    expect(() => dollars(2000000)).toThrow('Dollar amount out of range');
  });

  it('should reject invalid lot sizes', () => {
    expect(() => lots(-1)).toThrow('Lot size must be positive');
    expect(() => lots(0)).toThrow('Lot size must be positive');
    expect(() => lots(0.00001)).toThrow('Lot size too small');
    expect(() => lots(200)).toThrow('Lot size out of range');
  });

  it('should reject invalid prices', () => {
    expect(() => price(0)).toThrow('Price must be positive');
    expect(() => price(-100)).toThrow('Price must be positive');
    expect(() => price(NaN)).toThrow('Invalid price');
  });

  it('should support arithmetic operations with type preservation', () => {
    const d1 = dollars(100);
    const d2 = dollars(50);
    const sum = DollarsOps.add(d1, d2);

    expect(unwrapDollars(sum)).toBe(150);

    const p1 = pips(100);
    const p2 = pips(50);
    const pipSum = PipsOps.add(p1, p2);

    expect(unwrapPips(pipSum)).toBe(150);
  });
});

describe('SSOT Guardrails - TradeContext Factory', () => {
  it('should create valid TradeContext for known symbols', () => {
    const result = createTradeContext('EURUSD');

    expect(result.success).toBe(true);
    expect(result.context).toBeDefined();
    expect(result.context?.symbol).toBe('EURUSD');
    expect(result.context?.pipValue).toBe(0.0001);
    expect(result.context?.decimalPlaces).toBe(5);
    expect(result.context?.profileHash).toBeDefined();
  });

  it('should reject unknown symbols', () => {
    const result = createTradeContext('FAKESYM');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('SYMBOL_NOT_FOUND');
    expect(result.error).toContain('not found in registry');
  });

  it('should reject invalid symbol inputs', () => {
    const result1 = createTradeContext('');
    expect(result1.success).toBe(false);
    expect(result1.errorCode).toBe('INVALID_SYMBOL');

    const result2 = createTradeContext(null as any);
    expect(result2.success).toBe(false);
    expect(result2.errorCode).toBe('INVALID_SYMBOL');
  });

  it('should create context with valid converters', () => {
    const result = createTradeContext('EURUSD');
    const ctx = result.context!;

    // Test pip to price conversion
    const pipDistance = pips(100);
    const priceDistance = ctx.convertPipsToPrice(pipDistance);
    expect(priceDistance).toBe(0.0100); // 100 pips = 100 * 0.0001

    // Test price to pip conversion
    const convertedPips = ctx.convertPriceToPips(0.0100);
    expect(unwrapPips(convertedPips)).toBe(100);

    // Test dollars per pip calculation
    const lotSize = lots(0.1);
    const dollarsPerPip = ctx.calculateDollarsPerPip(lotSize);
    expect(unwrapDollars(dollarsPerPip)).toBe(1.0); // 0.1 lot * $10/pip/lot
  });

  it('should validate lot sizes against broker constraints', () => {
    const result = createTradeContext('EURUSD');
    const ctx = result.context!;

    // Valid lot size
    const validLot = lots(0.1);
    const validCheck = ctx.validateLotSize(validLot);
    expect(validCheck.valid).toBe(true);

    // Too small
    const tooSmall = lots(0.001);
    const tooSmallCheck = ctx.validateLotSize(tooSmall);
    expect(tooSmallCheck.valid).toBe(false);
    expect(tooSmallCheck.error).toContain('below minimum');

    // Too large
    const tooLarge = lots(10);
    const tooLargeCheck = ctx.validateLotSize(tooLarge);
    expect(tooLargeCheck.valid).toBe(false);
    expect(tooLargeCheck.error).toContain('above maximum');
  });

  it('should validate SL/TP for long trades', () => {
    const result = createTradeContext('EURUSD');
    const ctx = result.context!;

    const entryPrice = price(1.1000);
    const stopLoss = price(1.0980); // 20 pips below entry
    const takeProfit = price(1.1040); // 40 pips above entry

    const validation = ctx.validateSLTP(entryPrice, stopLoss, takeProfit, 'long');
    expect(validation.valid).toBe(true);
  });

  it('should reject invalid SL/TP for long trades', () => {
    const result = createTradeContext('EURUSD');
    const ctx = result.context!;

    const entryPrice = price(1.1000);
    const stopLoss = price(1.1020); // WRONG: SL above entry for long
    const takeProfit = price(1.1040);

    const validation = ctx.validateSLTP(entryPrice, stopLoss, takeProfit, 'long');
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain('must be below entry');
  });

  it('should validate SL/TP for short trades', () => {
    const result = createTradeContext('EURUSD');
    const ctx = result.context!;

    const entryPrice = price(1.1000);
    const stopLoss = price(1.1020); // 20 pips above entry
    const takeProfit = price(1.0960); // 40 pips below entry

    const validation = ctx.validateSLTP(entryPrice, stopLoss, takeProfit, 'short');
    expect(validation.valid).toBe(true);
  });

  it('should create consistent profile hashes', () => {
    const config = getSymbolConfig('EURUSD');
    const hash1 = createProfileHash(config!);
    const hash2 = createProfileHash(config!);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^profile_/);
  });

  it('should detect different configs via hash', () => {
    const eurusdConfig = getSymbolConfig('EURUSD');
    const xauusdConfig = getSymbolConfig('XAUUSD');

    const hash1 = createProfileHash(eurusdConfig!);
    const hash2 = createProfileHash(xauusdConfig!);

    expect(hash1).not.toBe(hash2);
  });
});

describe('SSOT Guardrails - Context Validation', () => {
  it('should validate fresh context', () => {
    const result = createTradeContext('EURUSD');
    const ctx = result.context!;

    const validation = validateTradeContext(ctx);
    expect(validation.valid).toBe(true);
  });

  it('should detect missing context', () => {
    const validation = validateTradeContext(undefined);
    expect(validation.valid).toBe(false);
    expect(validation.violationType).toBe('MISSING_CONTEXT');
  });

  it('should detect stale context', () => {
    const result = createTradeContext('EURUSD');
    const ctx = result.context!;

    // Simulate old context (created 10 minutes ago)
    const oldCtx = {
      ...ctx,
      createdTimestamp: Date.now() - (10 * 60 * 1000),
    };

    const validation = validateTradeContext(oldCtx, 5 * 60 * 1000); // Max 5 minutes
    expect(validation.valid).toBe(false);
    expect(validation.violationType).toBe('STALE_CONTEXT');
  });

  it('should refresh stale context', () => {
    const result1 = createTradeContext('EURUSD');
    const oldCtx = result1.context!;

    // Simulate staleness
    const staleCtx = {
      ...oldCtx,
      createdTimestamp: Date.now() - (10 * 60 * 1000),
    };

    // Refresh
    const result2 = refreshTradeContext(staleCtx);
    expect(result2.success).toBe(true);
    expect(result2.context?.createdTimestamp).toBeGreaterThan(staleCtx.createdTimestamp);
  });
});

describe('SSOT Guardrails - Pre-Flight Validation', () => {
  it('should pass pre-flight with valid context', async () => {
    const result = createTradeContext('EURUSD');
    const ctx = result.context!;

    const validation = await validatePreFlight(ctx, 'EURUSD', 'test');
    expect(validation.passed).toBe(true);
  });

  it('should fail pre-flight with missing context', async () => {
    const validation = await validatePreFlight(undefined, 'EURUSD', 'test');
    expect(validation.passed).toBe(false);
    expect(validation.errorCode).toBe('MATH_NOT_SSOT');
    expect(validation.violationType).toBe('MISSING_CONTEXT');
  });

  it('should create blocked decision from failed validation', async () => {
    const validation = await validatePreFlight(undefined, 'EURUSD', 'test');
    const decision = createBlockedDecision(validation, 'EURUSD');

    expect(decision.action).toBe('NO_TRADE');
    expect(decision.confidence).toBe(0);
    expect(decision.errorCode).toBe('MATH_NOT_SSOT');
    expect(decision.symbol).toBe('EURUSD');
  });
});

describe('SSOT Guardrails - Symbol-Specific Behavior', () => {
  it('should handle XAUUSD (Gold) correctly', () => {
    const result = createTradeContext('XAUUSD');
    const ctx = result.context!;

    expect(ctx.pipValue).toBe(0.01);
    expect(ctx.decimalPlaces).toBe(2);
    expect(ctx.dollarPerPipPerLot).toBe(1.0);

    // Test pip conversion
    const pipDistance = pips(100);
    const priceDistance = ctx.convertPipsToPrice(pipDistance);
    expect(priceDistance).toBe(1.0); // 100 pips = 100 * 0.01
  });

  it('should handle USDJPY correctly', () => {
    const result = createTradeContext('USDJPY');
    const ctx = result.context!;

    expect(ctx.pipValue).toBe(0.01);
    expect(ctx.pipMultiplier).toBe(100);
    expect(ctx.decimalPlaces).toBe(2);
  });

  it('should handle BTCUSD (Crypto) correctly', () => {
    const result = createTradeContext('BTCUSD');
    const ctx = result.context!;

    expect(ctx.category).toBe('crypto');
    expect(ctx.pipValue).toBe(1.0);
    expect(ctx.decimalPlaces).toBe(2);
  });

  it('should enforce crypto-specific lot size limits', () => {
    const result = createTradeContext('BTCUSD');
    const ctx = result.context!;

    // BTC has min lot of 0.001
    const validLot = lots(0.01);
    const validCheck = ctx.validateLotSize(validLot);
    expect(validCheck.valid).toBe(true);

    // Too small for BTC
    const tooSmall = lots(0.0001);
    const tooSmallCheck = ctx.validateLotSize(tooSmall);
    expect(tooSmallCheck.valid).toBe(false);
  });
});

describe('SSOT Guardrails - Context Staleness Detection', () => {
  it('should correctly identify stale contexts', () => {
    const result = createTradeContext('EURUSD');
    const ctx = result.context!;

    // Fresh context should not be stale
    expect(isContextStale(ctx, 5 * 60 * 1000)).toBe(false);

    // Old context should be stale
    const oldCtx = {
      ...ctx,
      createdTimestamp: Date.now() - (10 * 60 * 1000),
    };
    expect(isContextStale(oldCtx, 5 * 60 * 1000)).toBe(true);
  });

  it('should allow custom staleness thresholds', () => {
    const result = createTradeContext('EURUSD');
    const ctx = result.context!;

    const threeMinutesAgo = {
      ...ctx,
      createdTimestamp: Date.now() - (3 * 60 * 1000),
    };

    // Not stale with 5-minute threshold
    expect(isContextStale(threeMinutesAgo, 5 * 60 * 1000)).toBe(false);

    // Stale with 2-minute threshold
    expect(isContextStale(threeMinutesAgo, 2 * 60 * 1000)).toBe(true);
  });
});
