import type { AlphaDecision, MarketContext, OmegaCouncilVotes } from '../brains/coordinator-alpha';
import type { EntryIntentType, EntryUrgencyLevel, TimeoutAction } from '../types/entry';
import { logger } from '../lib/logger';
import { calculatePipDistance } from '../utils/currencyHelpers';

export interface ClassifiedEntryIntent {
  intent_type: EntryIntentType;
  urgency: EntryUrgencyLevel;
  entry_zone_min: number;
  entry_zone_max: number;
  timeout_minutes: number;
  max_wait_seconds: number;
  timeout_action: TimeoutAction;
  invalidation_price: number;
  should_execute_immediately: boolean;
}

export class EntryIntentClassifier {
  private static readonly IMMEDIATE_ZONE_PIPS = 3;
  private static readonly CLOSE_ENOUGH_PIPS = 8;

  static classifyEntryIntent(
    decision: AlphaDecision,
    marketContext: MarketContext,
    votes: OmegaCouncilVotes,
    vwap?: number
  ): ClassifiedEntryIntent | null {
    if (decision.action === 'NO_TRADE') {
      return null;
    }

    const entryZone = this.calculateEntryZone(decision, 'immediate_momentum', marketContext, decision.confidence);
    const distanceToZonePips = this.calculateDistanceToZone(
      marketContext.price,
      entryZone.min,
      entryZone.max,
      marketContext.symbol
    );

    const intentType = this.determineIntentTypeByPosition(
      distanceToZonePips,
      decision,
      marketContext,
      votes,
      vwap
    );

    const finalEntryZone = this.calculateEntryZone(decision, intentType, marketContext, decision.confidence);

    const urgency = this.determineUrgency(decision, marketContext, votes, intentType, distanceToZonePips);
    const maxWaitSeconds = this.calculateMaxWaitSeconds(urgency, intentType, marketContext);
    const timeoutMinutes = Math.ceil(maxWaitSeconds / 60);
    const timeoutAction = this.determineTimeoutAction(intentType, urgency);
    const invalidationPrice = this.calculateInvalidationPrice(decision, marketContext);

    const shouldExecuteImmediately = Math.abs(distanceToZonePips) <= this.IMMEDIATE_ZONE_PIPS;

    logger.info(
      `Entry intent classified (${decision.confidence}% conf): ${intentType} (${urgency}) - ` +
      `Entry zone: ${finalEntryZone.min.toFixed(5)}-${finalEntryZone.max.toFixed(5)} | ` +
      `Distance: ${distanceToZonePips.toFixed(1)} pips | ` +
      `Max wait: ${maxWaitSeconds}s | Timeout action: ${timeoutAction} | ` +
      `Execute immediately: ${shouldExecuteImmediately}`
    );

    return {
      intent_type: intentType,
      urgency,
      entry_zone_min: finalEntryZone.min,
      entry_zone_max: finalEntryZone.max,
      timeout_minutes: timeoutMinutes,
      max_wait_seconds: maxWaitSeconds,
      timeout_action: timeoutAction,
      invalidation_price: invalidationPrice,
      should_execute_immediately: shouldExecuteImmediately
    };
  }

  private static calculateDistanceToZone(
    currentPrice: number,
    zoneMin: number,
    zoneMax: number,
    symbol: string
  ): number {
    if (currentPrice >= zoneMin && currentPrice <= zoneMax) {
      return 0;
    }

    const closestEdge = currentPrice < zoneMin ? zoneMin : zoneMax;
    return calculatePipDistance(symbol, currentPrice, closestEdge);
  }

  private static determineIntentTypeByPosition(
    distanceToZonePips: number,
    decision: AlphaDecision,
    marketContext: MarketContext,
    votes: OmegaCouncilVotes,
    vwap?: number
  ): EntryIntentType {
    const absDistance = Math.abs(distanceToZonePips);

    if (absDistance <= this.IMMEDIATE_ZONE_PIPS) {
      return 'immediate_momentum';
    }

    if (absDistance <= this.CLOSE_ENOUGH_PIPS) {
      return 'immediate_momentum';
    }

    const reasoning = decision.reasoning.toLowerCase();

    if (reasoning.includes('breakout') && (reasoning.includes('retest') || reasoning.includes('pullback'))) {
      return 'break_and_retest';
    }

    if (vwap && Math.abs(marketContext.price - vwap) / vwap < 0.002) {
      if (reasoning.includes('vwap') || reasoning.includes('mean')) {
        return 'pullback_to_vwap';
      }
    }

    if (marketContext.regime === 'side' || reasoning.includes('range')) {
      return 'range_extreme';
    }

    if (reasoning.includes('retest') || reasoning.includes('structure')) {
      return 'retest_structure';
    }

    return 'pullback_to_support';
  }

  private static calculateInvalidationPrice(
    decision: AlphaDecision,
    marketContext: MarketContext
  ): number {
    if (decision.stopLoss) {
      return decision.stopLoss;
    }

    const atr = marketContext.atr;
    const entry = decision.entry;

    if (decision.action === 'BUY') {
      return entry - (atr * 1.5);
    } else {
      return entry + (atr * 1.5);
    }
  }

  private static determineTimeoutAction(
    intentType: EntryIntentType,
    urgency: EntryUrgencyLevel
  ): TimeoutAction {
    if (intentType === 'immediate_momentum') {
      return 'EXECUTE_AT_MARKET';
    }

    if (urgency === 'HIGH') {
      return 'EXECUTE_AT_MARKET';
    }

    if (intentType === 'break_and_retest' || intentType === 'retest_structure') {
      return 'EXECUTE_AT_MARKET';
    }

    return 'CANCEL';
  }

  private static calculateMaxWaitSeconds(
    urgency: EntryUrgencyLevel,
    intentType: EntryIntentType,
    marketContext: MarketContext
  ): number {
    const isHighVolatility = marketContext.volatility === 'high';
    const volatilityMultiplier = isHighVolatility ? 0.6 : 1.0;

    let baseSeconds: number;

    switch (intentType) {
      case 'immediate_momentum':
        baseSeconds = urgency === 'HIGH' ? 30 : urgency === 'MEDIUM' ? 45 : 60;
        break;
      case 'pullback_to_vwap':
        baseSeconds = urgency === 'HIGH' ? 90 : urgency === 'MEDIUM' ? 180 : 300;
        break;
      case 'break_and_retest':
        baseSeconds = urgency === 'HIGH' ? 120 : urgency === 'MEDIUM' ? 240 : 360;
        break;
      case 'pullback_to_support':
        baseSeconds = urgency === 'HIGH' ? 180 : urgency === 'MEDIUM' ? 420 : 600;
        break;
      case 'range_extreme':
        baseSeconds = urgency === 'HIGH' ? 120 : urgency === 'MEDIUM' ? 300 : 600;
        break;
      case 'retest_structure':
        baseSeconds = urgency === 'HIGH' ? 120 : urgency === 'MEDIUM' ? 240 : 420;
        break;
      default:
        baseSeconds = 120;
    }

    return Math.round(baseSeconds * volatilityMultiplier);
  }

  private static determineUrgency(
    decision: AlphaDecision,
    marketContext: MarketContext,
    votes: OmegaCouncilVotes,
    intentType: EntryIntentType,
    distanceToZonePips: number
  ): EntryUrgencyLevel {
    const confidence = decision.confidence;
    const absDistance = Math.abs(distanceToZonePips);

    if (intentType === 'immediate_momentum') {
      if (absDistance <= 2) {
        return 'HIGH';
      }
      if (confidence >= 75) {
        return 'HIGH';
      }
      return 'MEDIUM';
    }

    if (marketContext.volatility === 'high') {
      if (confidence >= 70) {
        return 'HIGH';
      }
      return 'MEDIUM';
    }

    const trendVote = votes.trend;
    if (trendVote && trendVote.action !== 'NO_TRADE' && trendVote.confidence >= 75) {
      return 'HIGH';
    }

    if (confidence >= 80) {
      return 'HIGH';
    } else if (confidence >= 65) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  private static calculateEntryZone(
    decision: AlphaDecision,
    intentType: EntryIntentType,
    marketContext: MarketContext,
    confidence: number
  ): { min: number; max: number } {
    const pipValue = marketContext.symbol.includes('JPY') ? 0.01 : 0.0001;
    const atr = marketContext.atr;
    const idealEntry = decision.entry;
    const direction = decision.action === 'BUY' ? 1 : -1;

    // ADAPTIVE: Widen zones during high volatility, use tighter caps in normal conditions
    const isHighVolatility = marketContext.volatility === 'high';
    const volatilityMultiplier = isHighVolatility ? 1.5 : 1.0;

    // CONFIDENCE-AWARE ZONES: Higher confidence = tighter zones (demand precision)
    // High confidence (70%+): 0.8x multiplier (tighter zones, better entries)
    // Medium confidence (60-69%): 1.0x multiplier (standard zones)
    // Low confidence (50-59%): 1.2x multiplier (wider zones, more flexibility)
    const confidenceMultiplier = confidence >= 70 ? 0.8 : confidence >= 60 ? 1.0 : 1.2;

    switch (intentType) {
      case 'immediate_momentum': {
        // High volatility: Allow up to ATR * 0.45 (no hard cap)
        // Normal: Cap at 5 pips
        const baseWidth = atr * 0.3 * volatilityMultiplier * confidenceMultiplier;
        const zoneWidth = isHighVolatility
          ? baseWidth
          : Math.min(baseWidth, 5 * pipValue * confidenceMultiplier);

        logger.debug(
          `Entry zone width: ${(zoneWidth * 10000).toFixed(1)} pips ` +
          `(volatility: ${marketContext.volatility}, confidence: ${confidence}%)`
        );

        return {
          min: idealEntry - zoneWidth,
          max: idealEntry + zoneWidth
        };
      }

      case 'pullback_to_vwap': {
        const baseWidth = 2 * pipValue * confidenceMultiplier;
        const zoneWidth = isHighVolatility ? baseWidth * 1.5 : baseWidth;
        return {
          min: idealEntry - zoneWidth,
          max: idealEntry + zoneWidth
        };
      }

      case 'pullback_to_support': {
        const baseWidth = atr * 0.4 * volatilityMultiplier * confidenceMultiplier;
        const zoneWidth = isHighVolatility
          ? baseWidth
          : Math.min(baseWidth, 10 * pipValue * confidenceMultiplier);

        if (direction > 0) {
          return {
            min: idealEntry - zoneWidth,
            max: idealEntry + zoneWidth * 0.3
          };
        } else {
          return {
            min: idealEntry - zoneWidth * 0.3,
            max: idealEntry + zoneWidth
          };
        }
      }

      case 'break_and_retest': {
        const baseWidth = atr * 0.5 * volatilityMultiplier * confidenceMultiplier;
        const zoneWidth = isHighVolatility
          ? baseWidth
          : Math.min(baseWidth, 8 * pipValue * confidenceMultiplier);

        return {
          min: idealEntry - zoneWidth * 0.5,
          max: idealEntry + zoneWidth * 0.5
        };
      }

      case 'range_extreme': {
        const baseWidth = atr * 0.3 * volatilityMultiplier * confidenceMultiplier;
        const zoneWidth = isHighVolatility
          ? baseWidth
          : Math.min(baseWidth, 5 * pipValue * confidenceMultiplier);

        return {
          min: idealEntry - zoneWidth * 0.4,
          max: idealEntry + zoneWidth * 0.4
        };
      }

      case 'retest_structure': {
        const baseWidth = atr * 0.35 * volatilityMultiplier * confidenceMultiplier;
        const zoneWidth = isHighVolatility
          ? baseWidth
          : Math.min(baseWidth, 7 * pipValue * confidenceMultiplier);

        return {
          min: idealEntry - zoneWidth * 0.5,
          max: idealEntry + zoneWidth * 0.5
        };
      }

      default: {
        const zoneWidth = 3 * pipValue * volatilityMultiplier * confidenceMultiplier;
        return {
          min: idealEntry - zoneWidth,
          max: idealEntry + zoneWidth
        };
      }
    }
  }

  private static calculateTimeout(
    urgency: EntryUrgencyLevel,
    intentType: EntryIntentType
  ): number {
    switch (urgency) {
      case 'HIGH':
        return intentType === 'immediate_momentum' ? 15 : 30;

      case 'MEDIUM':
        if (intentType === 'pullback_to_vwap' || intentType === 'break_and_retest') {
          return 60;
        }
        return 90;

      case 'LOW':
        if (intentType === 'range_extreme') {
          return 120;
        }
        return 90;

      default:
        return 60;
    }
  }
}
