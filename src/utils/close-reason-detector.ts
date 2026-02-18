/**
 * Smart Close Reason Detector
 *
 * This utility analyzes trade data and determines the TRUE close reason,
 * regardless of what's stored in the database. It detects when:
 * - Exit price matches SL (within tolerance) -> "Stop Loss Hit"
 * - Exit price matches TP (within tolerance) -> "Take Profit Hit"
 * - Neither match -> Use database close_reason
 *
 * This prevents misleading displays when race conditions or bugs cause
 * the wrong close_reason to be recorded.
 */

import { CloseReason } from '../types/position';
import {
  mapDatabaseToCloseReason,
  getCloseReasonText,
  getCloseReasonColor,
  getCloseReasonBadgeColor
} from './close-reason-mapper';
import { getCurrencyPipInfo } from './currencyHelpers';

export interface TradeCloseData {
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  symbol: string;
  databaseCloseReason: string;
}

export interface SmartCloseReasonResult {
  displayReason: CloseReason;
  isOverride: boolean;
  confidence: 'high' | 'medium' | 'low';
  details: string;
}

/**
 * Check if two prices are within tolerance
 * Tolerance is 0.5 pips to account for slippage and broker spread
 */
function pricesMatch(
  price1: number,
  price2: number,
  symbol: string,
  tolerancePips: number = 0.5
): boolean {
  const pipInfo = getCurrencyPipInfo(symbol);
  const priceDistance = Math.abs(price1 - price2);
  const pipDistance = priceDistance / pipInfo.pipValue;

  return pipDistance <= tolerancePips;
}

/**
 * Determine the TRUE close reason based on actual prices
 *
 * Logic:
 * 1. If exit price matches SL (within 0.5 pips) -> Stop Loss Hit
 * 2. If exit price matches TP (within 0.5 pips) -> Take Profit Hit
 * 3. If exit price very close to SL/TP (0.5-2 pips) -> Use database reason but mark as "likely"
 * 4. Otherwise -> Trust database reason
 *
 * @param tradeData Trade close data
 * @returns Smart detection result with display reason and confidence
 */
export function detectTrueCloseReason(tradeData: TradeCloseData): SmartCloseReasonResult {
  const { exitPrice, stopLoss, takeProfit, symbol, databaseCloseReason } = tradeData;

  if (!exitPrice || !isFinite(exitPrice) || exitPrice === 0) {
    const mappedReason = mapDatabaseToCloseReason(databaseCloseReason);
    return {
      displayReason: mappedReason,
      isOverride: false,
      confidence: 'low',
      details: 'Exit price missing or invalid - using database close reason'
    };
  }

  const pipInfo = getCurrencyPipInfo(symbol);
  const exitToSL = Math.abs(exitPrice - stopLoss) / pipInfo.pipValue;
  const exitToTP = Math.abs(exitPrice - takeProfit) / pipInfo.pipValue;

  if (pricesMatch(exitPrice, stopLoss, symbol, 0.5)) {
    return {
      displayReason: 'stop_loss',
      isOverride: databaseCloseReason !== 'stop_loss',
      confidence: 'high',
      details: `Exit at ${exitPrice.toFixed(pipInfo.decimalPlaces)} matches SL ${stopLoss.toFixed(pipInfo.decimalPlaces)} (${exitToSL.toFixed(2)} pips)`
    };
  }

  if (pricesMatch(exitPrice, takeProfit, symbol, 0.5)) {
    const normalizedDbReason = mapDatabaseToCloseReason(databaseCloseReason);
    const isTpFamilyDbReason = normalizedDbReason === 'take_profit_1' || normalizedDbReason === 'take_profit_2';
    return {
      displayReason: isTpFamilyDbReason ? normalizedDbReason : 'take_profit',
      isOverride: !isTpFamilyDbReason && databaseCloseReason !== 'take_profit',
      confidence: 'high',
      details: `Exit at ${exitPrice.toFixed(pipInfo.decimalPlaces)} matches TP ${takeProfit.toFixed(pipInfo.decimalPlaces)} (${exitToTP.toFixed(2)} pips)`
    };
  }

  if (exitToSL <= 2.0 && exitToSL > 0.5) {
    return {
      displayReason: 'stop_loss',
      isOverride: databaseCloseReason !== 'stop_loss',
      confidence: 'medium',
      details: `Exit ${exitToSL.toFixed(2)} pips from SL - likely slippage on stop loss`
    };
  }

  if (exitToTP <= 2.0 && exitToTP > 0.5) {
    const normalizedDbReason = mapDatabaseToCloseReason(databaseCloseReason);
    const isTpFamilyDbReason = normalizedDbReason === 'take_profit_1' || normalizedDbReason === 'take_profit_2';
    return {
      displayReason: isTpFamilyDbReason ? normalizedDbReason : 'take_profit',
      isOverride: !isTpFamilyDbReason && databaseCloseReason !== 'take_profit',
      confidence: 'medium',
      details: `Exit ${exitToTP.toFixed(2)} pips from TP - likely slippage on take profit`
    };
  }

  // ✅ SSOT: Use centralized mapper for database reason normalization
  const normalizedReason = mapDatabaseToCloseReason(databaseCloseReason);

  return {
    displayReason: normalizedReason,
    isOverride: false,
    confidence: 'low',
    details: `Database reason (exit ${exitToSL.toFixed(1)} pips from SL, ${exitToTP.toFixed(1)} pips from TP)`
  };
}

/**
 * Re-export centralized display functions
 * ✅ SSOT: All display logic is now in close-reason-mapper.ts
 */
export { getCloseReasonText, getCloseReasonColor, getCloseReasonBadgeColor };

/**
 * Analyze a batch of trades and report any mismatches
 * Useful for debugging and data quality checks
 */
export function analyzeTradeBatch(trades: TradeCloseData[]): {
  total: number;
  overrides: number;
  highConfidenceOverrides: number;
  mediumConfidenceOverrides: number;
  mismatches: Array<{ trade: TradeCloseData; result: SmartCloseReasonResult }>;
} {
  const mismatches: Array<{ trade: TradeCloseData; result: SmartCloseReasonResult }> = [];
  let overrides = 0;
  let highConfidenceOverrides = 0;
  let mediumConfidenceOverrides = 0;

  for (const trade of trades) {
    const result = detectTrueCloseReason(trade);

    if (result.isOverride) {
      overrides++;
      mismatches.push({ trade, result });

      if (result.confidence === 'high') {
        highConfidenceOverrides++;
      } else if (result.confidence === 'medium') {
        mediumConfidenceOverrides++;
      }
    }
  }

  return {
    total: trades.length,
    overrides,
    highConfidenceOverrides,
    mediumConfidenceOverrides,
    mismatches
  };
}
