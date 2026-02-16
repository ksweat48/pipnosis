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
 * - RED zone safety violations
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
import { alphaSafetyZoneEvaluator, type TradeStyle } from '../config/alpha-safety-zones';
import { calculatePipDistance } from '../utils/currencyHelpers';
import { safeExtractATRValue, type ATRValue } from '../types/atr';
import { TRADING_CONSTANTS } from '../config/trading-constants';
import { getAssetClassEnvelopeBounds, type EnvelopeAssetClass } from '../config/style-execution-envelopes';
import { assetClassifier } from '../services/asset-classifier';

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

  private estimateSpread(symbol: string): number {
    if (symbol.startsWith('EUR') || symbol.startsWith('GBP')) return 1.5;
    if (symbol.startsWith('USD')) return 2.0;
    if (symbol === 'XAUUSD') return 3.0;
    if (symbol.includes('JPY')) return 2.0;
    if (symbol === 'NAS100' || symbol === 'US100') return 2.0;
    if (symbol === 'SPX500' || symbol === 'US500') return 1.0;
    if (symbol === 'BTCUSD' || symbol === 'ETHUSD') return 5.0;
    return 3.0;
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
        reasoning: 'NO_TRADE requires no validation',
        safety_zone: 'GREEN' as const,
        safety_evaluation: undefined
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
        reasoning: `HARD BLOCK: Geometry error - ${flags.join(', ')}`,
        safety_zone: 'RED' as const,
        safety_evaluation: undefined
      };
    }

    const slDistance = Math.abs(entry - sl);
    const tpDistance = Math.abs(tp - entry);
    const rr = slDistance > 0 ? tpDistance / slDistance : 0;
    const slDistancePips = calculatePipDistance(marketContext.symbol, entry, sl);
    const tpDistancePips = calculatePipDistance(marketContext.symbol, entry, tp);
    const spreadPips = this.estimateSpread(marketContext.symbol);

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

    const atrValue = safeExtractATRValue(marketContext.atr, 'Omega9.performLocalValidation');
    const rawStyle = alphaDecision.resolvedStyle;
    const safetyTradeStyle: TradeStyle = rawStyle === 'SCALP' ? 'SCALP'
      : rawStyle === 'MICRO_INTRADAY' ? 'MICRO_INTRADAY'
      : rawStyle === 'INTRADAY' ? 'INTRADAY'
      : 'INTRADAY';

    let envelopeMaxTP: number | undefined;
    try {
      const category = assetClassifier.getAssetCategory(marketContext.symbol);
      const assetClass = category.toUpperCase() as EnvelopeAssetClass;
      const bounds = getAssetClassEnvelopeBounds(safetyTradeStyle, assetClass, marketContext.symbol, marketContext.price);
      envelopeMaxTP = bounds.tpPips.max;
    } catch {
      envelopeMaxTP = undefined;
    }

    const safetyEval = alphaSafetyZoneEvaluator.evaluateTrade({
      rrRatio: rr,
      tpDistancePips,
      slDistancePips,
      atr: atrValue,
      symbol: marketContext.symbol,
      estimatedDurationSeconds: 0,
      tradeStyle: safetyTradeStyle,
      envelopeMaxTPPips: envelopeMaxTP,
    });

    console.log(`[Omega-9] Safety Zone: ${safetyEval.zone} | Score: ${safetyEval.safety_score}/100 | R:R: ${rr.toFixed(3)}`);

    if (safetyEval.zone === 'RED' && !safetyEval.can_proceed) {
      safetyEval.violations.forEach(v => {
        flags.push(`RED_ZONE_${v.violation_type.toUpperCase()}`);
      });

      return {
        pass: false,
        flags: ['SAFETY_RED_ZONE_HARD_BLOCK', ...flags],
        confidence_adjustment: 0,
        corrections: NO_CORRECTIONS,
        reasoning: `RED ZONE HARD BLOCK: ${safetyEval.violations.map(v => v.message).join('; ')}`,
        safety_zone: safetyEval.zone,
        safety_evaluation: safetyEval
      };
    }

    return {
      pass: true,
      flags: [],
      confidence_adjustment: 0,
      corrections: NO_CORRECTIONS,
      reasoning: safetyEval.zone === 'GREEN' ? 'All validations passed' : `${safetyEval.zone} zone (advisory only)`,
      safety_zone: safetyEval.zone,
      safety_evaluation: safetyEval
    };
  }
}

export const omega9Hallucination = new Omega9HallucinationBrain();
