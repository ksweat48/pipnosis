/**
 * Omega-9 Hallucination Defense - DETERMINISTIC Mathematical Safety Validator
 *
 * Final safety validator that prevents CATASTROPHIC mathematical mistakes.
 *
 * Validates:
 * - Mathematical correctness (SL/TP on correct side of entry)
 * - Direction logic consistency
 * - Impossible scenarios (< 5 pips stops, zero distance)
 * - R:R ratio sanity checks
 *
 * FULLY DETERMINISTIC - NO LLM CALLS
 * Alpha has final authority on strategic decisions.
 * Omega-9 only blocks mathematically impossible trades.
 */

import { calculatePipDistance } from '../../utils/currencyHelpers';
import { HALLUCINATION_THRESHOLDS, RISK_GATE_THRESHOLDS } from '../../config/omega-thresholds';
import type { ATRValue } from '../../types/atr';
import { safeExtractATRValue } from '../../types/atr';

export interface HallucinationInput {
  action: 'BUY' | 'SELL' | 'NO_TRADE';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  symbol: string;
  atr: number | ATRValue;
  confidence?: number;
}

export interface HallucinationResult {
  pass: boolean;
  flags: string[];
  confidenceAdjustment: number;
  corrections: HallucinationCorrections | null;
  reasoning: string;
  safetyZone: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';
}

export interface HallucinationCorrections {
  sl?: number;
  tp?: number;
  reason: string;
}

class OmegaHallucinationBrain {
  validate(input: HallucinationInput): HallucinationResult {
    if (input.action === 'NO_TRADE') {
      return {
        pass: true,
        flags: [],
        confidenceAdjustment: 0,
        corrections: null,
        reasoning: '[DET] NO_TRADE requires no validation',
        safetyZone: 'GREEN'
      };
    }

    const flags: string[] = [];
    const isBuy = input.action === 'BUY';
    const atrValue = safeExtractATRValue(input.atr, 'OmegaHallucination.validate');

    if (isBuy && input.stopLoss >= input.entry) {
      flags.push('SL_WRONG_SIDE_BUY');
    }
    if (!isBuy && input.stopLoss <= input.entry) {
      flags.push('SL_WRONG_SIDE_SELL');
    }

    if (isBuy && input.takeProfit <= input.entry) {
      flags.push('TP_WRONG_SIDE_BUY');
    }
    if (!isBuy && input.takeProfit >= input.entry) {
      flags.push('TP_WRONG_SIDE_SELL');
    }

    if (input.stopLoss === input.entry) {
      flags.push('ZERO_SL_DISTANCE');
    }
    if (input.takeProfit === input.entry) {
      flags.push('ZERO_TP_DISTANCE');
    }

    const slDistancePips = calculatePipDistance(input.symbol, input.entry, input.stopLoss);
    const tpDistancePips = calculatePipDistance(input.symbol, input.entry, input.takeProfit);

    if (slDistancePips < HALLUCINATION_THRESHOLDS.MIN_SL_DISTANCE_PIPS) {
      flags.push(`SL_TOO_TIGHT(${slDistancePips.toFixed(1)}pips)`);
    }

    if (tpDistancePips < HALLUCINATION_THRESHOLDS.MIN_TP_DISTANCE_PIPS) {
      flags.push(`TP_TOO_TIGHT(${tpDistancePips.toFixed(1)}pips)`);
    }

    const slDistance = Math.abs(input.entry - input.stopLoss);
    const tpDistance = Math.abs(input.takeProfit - input.entry);
    const rrRatio = slDistance > 0 ? tpDistance / slDistance : 0;

    if (rrRatio < HALLUCINATION_THRESHOLDS.MIN_RR_RATIO) {
      flags.push(`RR_TOO_LOW(${rrRatio.toFixed(2)})`);
    }

    if (rrRatio > HALLUCINATION_THRESHOLDS.MAX_RR_RATIO) {
      flags.push(`RR_UNREALISTIC(${rrRatio.toFixed(2)})`);
    }

    const hasCriticalError = flags.some(f =>
      f.includes('WRONG_SIDE') ||
      f.includes('ZERO_')
    );

    const hasBlockingError = flags.some(f =>
      f.includes('RR_TOO_LOW') ||
      f.includes('TOO_TIGHT')
    );

    let safetyZone: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' = 'GREEN';
    let confidenceAdjustment = 0;

    if (hasCriticalError) {
      safetyZone = 'RED';
      confidenceAdjustment = -100;
    } else if (hasBlockingError) {
      safetyZone = 'ORANGE';
      confidenceAdjustment = -30;
    } else if (flags.length > 0) {
      safetyZone = 'YELLOW';
      confidenceAdjustment = -10;
    }

    let corrections: HallucinationCorrections | null = null;

    if (hasCriticalError && !flags.some(f => f.includes('ZERO_'))) {
      corrections = this.attemptRepair(input, flags, atrValue);
    }

    const pass = safetyZone !== 'RED' || (corrections !== null);
    const reasoning = this.buildReasoning(pass, flags, safetyZone, rrRatio);

    console.log(`[Omega-9 Hallucination] [DET] ${pass ? 'PASS' : 'FAIL'} | Zone: ${safetyZone} | Flags: ${flags.length > 0 ? flags.join(', ') : 'none'}`);

    return {
      pass,
      flags,
      confidenceAdjustment,
      corrections,
      reasoning,
      safetyZone
    };
  }

  private attemptRepair(
    input: HallucinationInput,
    flags: string[],
    atr: number
  ): HallucinationCorrections | null {
    const isBuy = input.action === 'BUY';
    const corrections: HallucinationCorrections = { reason: '' };
    const reasons: string[] = [];

    if (flags.some(f => f.includes('SL_WRONG_SIDE_BUY')) && isBuy) {
      corrections.sl = input.entry - atr * 1.5;
      reasons.push('Corrected BUY SL below entry');
    } else if (flags.some(f => f.includes('SL_WRONG_SIDE_SELL')) && !isBuy) {
      corrections.sl = input.entry + atr * 1.5;
      reasons.push('Corrected SELL SL above entry');
    }

    if (flags.some(f => f.includes('TP_WRONG_SIDE_BUY')) && isBuy) {
      corrections.tp = input.entry + atr * 2.5;
      reasons.push('Corrected BUY TP above entry');
    } else if (flags.some(f => f.includes('TP_WRONG_SIDE_SELL')) && !isBuy) {
      corrections.tp = input.entry - atr * 2.5;
      reasons.push('Corrected SELL TP below entry');
    }

    if (reasons.length === 0) {
      return null;
    }

    corrections.reason = reasons.join('; ');
    return corrections;
  }

  private buildReasoning(
    pass: boolean,
    flags: string[],
    safetyZone: string,
    rrRatio: number
  ): string {
    if (pass && flags.length === 0) {
      return `[DET] PASS | Zone: GREEN | R:R: ${rrRatio.toFixed(2)} | All validations passed`;
    }

    if (pass) {
      return `[DET] PASS | Zone: ${safetyZone} | R:R: ${rrRatio.toFixed(2)} | Advisory: ${flags.slice(0, 2).join(', ')}`;
    }

    return `[DET] FAIL | Zone: RED | R:R: ${rrRatio.toFixed(2)} | Critical: ${flags.slice(0, 3).join(', ')}`;
  }

  validateQuick(
    action: 'BUY' | 'SELL',
    entry: number,
    stopLoss: number,
    takeProfit: number
  ): { valid: boolean; error?: string } {
    const isBuy = action === 'BUY';

    if (isBuy && stopLoss >= entry) {
      return { valid: false, error: 'BUY SL must be below entry' };
    }
    if (!isBuy && stopLoss <= entry) {
      return { valid: false, error: 'SELL SL must be above entry' };
    }
    if (isBuy && takeProfit <= entry) {
      return { valid: false, error: 'BUY TP must be above entry' };
    }
    if (!isBuy && takeProfit >= entry) {
      return { valid: false, error: 'SELL TP must be below entry' };
    }

    if (stopLoss === entry || takeProfit === entry) {
      return { valid: false, error: 'Zero distance detected' };
    }

    return { valid: true };
  }
}

export const omegaHallucination = new OmegaHallucinationBrain();
