/**
 * Omega-9: Catastrophic Error Defense
 *
 * DUAL-ARENA ARCHITECTURE (v3.0):
 * Alpha receives both arenas (long/short walls) and makes decisions within them.
 * Omega-9's ONLY role is catching mathematical impossibilities that would
 * corrupt the trade execution pipeline.
 *
 * SCOPE (exhaustive):
 * - SL on wrong side of entry
 * - TP on wrong side of entry
 * - Zero distance (SL or TP at entry)
 * - Stop inside spread (impossible to survive)
 * - R:R below catastrophic threshold
 *
 * WHAT OMEGA-9 DOES NOT DO:
 * - No confidence adjustments
 * - No SL/TP corrections or repairs
 * - No LLM validation calls
 * - No directional consensus checking
 * - No advisory warnings that modify the decision
 *
 * Binary outcome: PASS or HARD BLOCK.
 */

import type { Omega9ValidationResult, OmegaVote } from '../types/omega';
import type { AlphaDecision } from './coordinator-alpha';
import { calculatePipDistance } from '../utils/currencyHelpers';
import { type ATRValue } from '../types/atr';
import { TRADING_CONSTANTS, getEstimatedSpreadPips } from '../config/trading-constants';

export interface Omega9Input {
  alphaDecision: AlphaDecision;
  omegaVotes: {
    trend: OmegaVote | null;
    scalper: OmegaVote | null;
    reversal: OmegaVote | null;
    volatility: OmegaVote | null;
    risk: OmegaVote | null;
    omega8?: any;
  };
  marketContext: {
    price: number;
    atr: number | ATRValue;
    symbol: string;
  };
  safetyRules: {
    maxRiskPct: number;
    minRR: number;
    maxExposure: number;
  };
}

class Omega9HallucinationBrain {
  async validate(input: Omega9Input): Promise<Omega9ValidationResult> {
    return this.performLocalValidation(input);
  }

  private performLocalValidation(input: Omega9Input): Omega9ValidationResult {
    const flags: string[] = [];
    const { alphaDecision, marketContext } = input;
    const NO_CORRECTIONS = { sl: null, tp: null, risk_pct: null };

    if (alphaDecision.action === 'NO_TRADE') {
      return {
        pass: true,
        flags: [],
        confidence_adjustment: 0,
        corrections: NO_CORRECTIONS,
        reasoning: 'NO_TRADE requires no validation'
      };
    }

    const isBuy = alphaDecision.action === 'BUY';
    const entry = alphaDecision.entry;
    const sl = alphaDecision.stopLoss;
    const tp = alphaDecision.takeProfit;

    if (isBuy && sl >= entry) flags.push('SL_POSITION_ERROR_BUY');
    if (!isBuy && sl <= entry) flags.push('SL_POSITION_ERROR_SELL');
    if (isBuy && tp <= entry) flags.push('TP_POSITION_ERROR_BUY');
    if (!isBuy && tp >= entry) flags.push('TP_POSITION_ERROR_SELL');
    if (sl === entry || tp === entry) flags.push('ZERO_DISTANCE_ERROR');

    const hasGeometryError = flags.length > 0;
    if (hasGeometryError) {
      console.error(`[Omega-9] CATASTROPHIC GEOMETRY: ${flags.join(', ')}`);
      return {
        pass: false,
        flags,
        confidence_adjustment: 0,
        corrections: NO_CORRECTIONS,
        reasoning: `HARD BLOCK: Geometry error - ${flags.join(', ')}`
      };
    }

    const slDistance = Math.abs(entry - sl);
    const tpDistance = Math.abs(tp - entry);
    const rr = slDistance > 0 ? tpDistance / slDistance : 0;
    const slDistancePips = calculatePipDistance(marketContext.symbol, entry, sl);
    const tpDistancePips = calculatePipDistance(marketContext.symbol, entry, tp);
    const spreadPips = getEstimatedSpreadPips(marketContext.symbol);

    if (slDistancePips < spreadPips * 1.5) {
      console.error(`[Omega-9] HARD BLOCK: Stop inside spread (${slDistancePips.toFixed(1)} < ${(spreadPips * 1.5).toFixed(1)})`);
      return {
        pass: false,
        flags: ['HARD_BLOCK_STOP_INSIDE_SPREAD'],
        confidence_adjustment: 0,
        corrections: NO_CORRECTIONS,
        reasoning: `HARD BLOCK: Stop inside spread (${slDistancePips.toFixed(1)} pips < ${(spreadPips * 1.5).toFixed(1)} pips minimum)`
      };
    }

    const CATASTROPHIC_RR = TRADING_CONSTANTS.RISK_REWARD_RATIOS.CATASTROPHIC_THRESHOLD;
    if (rr < CATASTROPHIC_RR) {
      console.error(`[Omega-9] HARD BLOCK: R:R catastrophic (${rr.toFixed(2)} < ${CATASTROPHIC_RR})`);
      return {
        pass: false,
        flags: ['HARD_BLOCK_RR_CATASTROPHIC'],
        confidence_adjustment: 0,
        corrections: NO_CORRECTIONS,
        reasoning: `HARD BLOCK: R:R catastrophic (${rr.toFixed(2)}:1 < ${CATASTROPHIC_RR}:1 minimum)`
      };
    }

    console.log(`[Omega-9] All catastrophic checks passed | R:R: ${rr.toFixed(3)} | SL: ${slDistancePips.toFixed(1)} pips | TP: ${tpDistancePips.toFixed(1)} pips`);

    return {
      pass: true,
      flags: [],
      confidence_adjustment: 0,
      corrections: NO_CORRECTIONS,
      reasoning: 'All catastrophic validations passed'
    };
  }
}

export const omega9Hallucination = new Omega9HallucinationBrain();
