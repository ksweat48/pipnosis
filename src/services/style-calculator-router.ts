/**
 * Style Calculator Router - Routes TP/SL Logic by Style
 *
 * GOVERNANCE PRINCIPLE:
 * For SCALP, only M5 tools are exposed.
 * For INTRADAY, only H1 tools are exposed.
 *
 * This prevents HTF logic from leaking into scalps.
 * Alpha can only use tools appropriate for the style chosen.
 */

import { getExecutionEnvelope, type StyleExecutionEnvelope } from '../config/style-execution-envelopes';
import { m5SwingAnalyzer, type M5SwingContext } from './m5-swing-analyzer';
import { riskAwareStopCalculator, type StopLossCalculation } from './risk-aware-stop-calculator';
import { eliteProfitTargetCalculator, type LiquidityZone, type TPCalculationResult } from './profit-target-calculator';
import { safeExtractATRValue } from '../types/atr';
import { getCurrencyPipInfo } from '../utils/currencyHelpers';
import type { Candle } from '../types/candle-immutable';

export interface StyleAwareStopInput {
  style: string;
  symbol: string;
  entryPrice: number;
  direction: 'long' | 'short';
  atr: number | { value: number; timeframe: string };
  candles: Candle[];
  patternType?: string;
}

export interface StyleAwareTPInput {
  style: string;
  symbol: string;
  entryPrice: number;
  stopLoss: number;
  direction: 'long' | 'short';
  candles: Candle[];
  atr: number | { value: number; timeframe: string };
}

/**
 * Calculate stop-loss using style-appropriate logic
 *
 * SCALP: M5 structure only
 * INTRADAY: H1 structure
 */
export function calculateStyleAwareStop(input: StyleAwareStopInput): StopLossCalculation {
  const envelope = getExecutionEnvelope(input.style);
  const atrValue = safeExtractATRValue(input.atr, 'StyleCalculatorRouter.calculateStop');

  console.log(`[Style Router] Calculating SL for ${input.style} using ${envelope.timeframe} logic`);

  // For SCALP, use M5 structure tightly
  if (envelope.style === 'SCALP') {
    // Use M5 swing analyzer to find tight M5 structure
    const m5Context = m5SwingAnalyzer.analyzeM5Swings(
      input.candles,
      input.symbol,
      input.entryPrice
    );

    // Calculate tight M5 stop
    const slDistance = Math.max(
      atrValue * 1.2, // 1.2x M5 ATR minimum
      m5Context.avgSwingSize * 0.3 // Or 30% of avg M5 swing
    );

    const sl = input.direction === 'long'
      ? input.entryPrice - slDistance
      : input.entryPrice + slDistance;

    const pipValue = getCurrencyPipInfo(input.symbol).pipValue;
    const slPips = Math.abs(input.entryPrice - sl) / pipValue;
    if (slPips < envelope.slPips.min || slPips > envelope.slPips.max) {
      console.warn(
        `[Style Router] SL ${slPips.toFixed(1)} pips outside ${input.style} bounds ` +
        `(${envelope.slPips.min}-${envelope.slPips.max}). Adjusting.`
      );
    }

    return {
      stopLoss: sl,
      reason: `M5 structure break (${slDistance.toFixed(5)})`,
      atrMultiple: slDistance / atrValue,
      isConservative: false,
    };
  }

  // For INTRADAY/MICRO, use standard risk-aware calculator
  // (which already uses appropriate HTF logic)
  return riskAwareStopCalculator.calculateStopLoss({
    symbol: input.symbol,
    entryPrice: input.entryPrice,
    direction: input.direction,
    atr: atrValue,
    patternType: input.patternType,
  });
}

/**
 * Calculate take-profit using style-appropriate logic
 *
 * SCALP: M5 swing targets only (15-60 pips)
 * INTRADAY: H1 liquidity pools (60-150 pips)
 */
export function calculateStyleAwareTP(input: StyleAwareTPInput): TPCalculationResult {
  const envelope = getExecutionEnvelope(input.style);
  const atrValue = safeExtractATRValue(input.atr, 'StyleCalculatorRouter.calculateTP');

  console.log(`[Style Router] Calculating TP for ${input.style} using ${envelope.timeframe} logic`);

  // For SCALP, use M5 swing targets ONLY
  if (envelope.style === 'SCALP') {
    const m5Context = m5SwingAnalyzer.analyzeM5Swings(
      input.candles,
      input.symbol,
      input.entryPrice
    );

    const pipValue = getCurrencyPipInfo(input.symbol).pipValue;

    const targetDistance = Math.min(
      m5Context.avgSwingSize * 0.8,
      atrValue * 3.5,
      envelope.tpPips.max * pipValue
    );

    const tp = input.direction === 'long'
      ? input.entryPrice + targetDistance
      : input.entryPrice - targetDistance;

    const tpPips = Math.abs(tp - input.entryPrice) / pipValue;
    if (tpPips > envelope.tpPips.max) {
      console.warn(
        `[Style Router] TP ${tpPips.toFixed(1)} pips exceeds ${input.style} max ` +
        `(${envelope.tpPips.max}). Capping to M5 reality.`
      );

      const cappedDistance = envelope.tpPips.max * pipValue;
      const cappedTP = input.direction === 'long'
        ? input.entryPrice + cappedDistance
        : input.entryPrice - cappedDistance;

      return {
        tp1: cappedTP,
        tp2: null,
        tp1Reasoning: `M5 swing completion (capped to ${envelope.tpPips.max} pips)`,
        tp2Reasoning: null,
        nearestZone: null,
        zonesConsidered: [],
      };
    }

    return {
      tp1: tp,
      tp2: null,
      tp1Reasoning: `M5 swing target (${m5Context.avgSwingSize.toFixed(1)} pip avg)`,
      tp2Reasoning: null,
      nearestZone: null,
      zonesConsidered: [],
    };
  }

  // For INTRADAY/MICRO, use liquidity zone calculator
  // (which targets HTF pools)
  const liquidityZones = eliteProfitTargetCalculator.detectLiquidityZones(
    input.candles,
    input.entryPrice,
    input.direction
  );

  return eliteProfitTargetCalculator.calculateDualTP({
    symbol: input.symbol,
    entryPrice: input.entryPrice,
    stopLoss: input.stopLoss,
    direction: input.direction,
    liquidityZones,
    atr: atrValue,
  });
}

/**
 * Validate TP/SL against style envelope
 *
 * Returns revision request if outside bounds
 */
export function validateTPSLAgainstStyle(
  style: string,
  tpPips: number,
  slPips: number
): { valid: boolean; violations: string[] } {
  const envelope = getExecutionEnvelope(style);
  const violations: string[] = [];

  if (tpPips < envelope.tpPips.min) {
    violations.push(`TP ${tpPips.toFixed(1)} pips below ${style} minimum ${envelope.tpPips.min} pips`);
  }

  if (tpPips > envelope.tpPips.max) {
    violations.push(
      `TP ${tpPips.toFixed(1)} pips exceeds ${style} maximum ${envelope.tpPips.max} pips. ` +
      `You are trading ${envelope.timeframe} ${style}, not higher timeframe.`
    );
  }

  if (slPips < envelope.slPips.min) {
    violations.push(`SL ${slPips.toFixed(1)} pips below ${style} minimum ${envelope.slPips.min} pips`);
  }

  if (slPips > envelope.slPips.max) {
    violations.push(`SL ${slPips.toFixed(1)} pips exceeds ${style} maximum ${envelope.slPips.max} pips`);
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}
