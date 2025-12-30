import type { AlphaDecision, MarketContext, OmegaCouncilVotes } from '../brains/coordinator-alpha';
import type { EntryIntentType, EntryUrgencyLevel } from '../types/entry';
import { logger } from '../lib/logger';

export class EntryIntentClassifier {
  static classifyEntryIntent(
    decision: AlphaDecision,
    marketContext: MarketContext,
    votes: OmegaCouncilVotes,
    vwap?: number
  ): {
    intent_type: EntryIntentType;
    urgency: EntryUrgencyLevel;
    entry_zone_min: number;
    entry_zone_max: number;
    timeout_minutes: number;
  } | null {
    if (decision.action === 'NO_TRADE') {
      return null;
    }

    const urgency = this.determineUrgency(decision, marketContext, votes);
    const intentType = this.determineIntentType(decision, marketContext, votes, vwap);
    const entryZone = this.calculateEntryZone(decision, intentType, marketContext, decision.confidence);
    const timeoutMinutes = this.calculateTimeout(urgency, intentType);

    logger.info(
      `Entry intent classified (${decision.confidence}% conf): ${intentType} (${urgency}) - ` +
      `Entry zone: ${entryZone.min.toFixed(5)}-${entryZone.max.toFixed(5)} ` +
      `(${((entryZone.max - entryZone.min) * 10000).toFixed(1)} pips)`
    );

    return {
      intent_type: intentType,
      urgency,
      entry_zone_min: entryZone.min,
      entry_zone_max: entryZone.max,
      timeout_minutes: timeoutMinutes
    };
  }

  private static determineUrgency(
    decision: AlphaDecision,
    marketContext: MarketContext,
    votes: OmegaCouncilVotes
  ): EntryUrgencyLevel {
    const confidence = decision.confidence;
    const reasoning = decision.reasoning.toLowerCase();

    if (reasoning.includes('momentum') || reasoning.includes('breakout')) {
      if (confidence >= 75) {
        return 'HIGH';
      }
      return 'MEDIUM';
    }

    if (reasoning.includes('reversal') || reasoning.includes('extreme')) {
      return 'MEDIUM';
    }

    if (reasoning.includes('pullback') || reasoning.includes('retest') || reasoning.includes('range')) {
      if (marketContext.volatility === 'high' && confidence >= 70) {
        return 'MEDIUM';
      }
      return 'LOW';
    }

    const trendVote = votes.trend;
    if (trendVote && trendVote.action !== 'NO_TRADE') {
      if (trendVote.confidence >= 75) {
        return 'HIGH';
      }
      return 'MEDIUM';
    }

    if (confidence >= 80) {
      return 'HIGH';
    } else if (confidence >= 60) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  private static determineIntentType(
    decision: AlphaDecision,
    marketContext: MarketContext,
    votes: OmegaCouncilVotes,
    vwap?: number
  ): EntryIntentType {
    const reasoning = decision.reasoning.toLowerCase();
    const currentPrice = marketContext.price;

    if (reasoning.includes('momentum') && (reasoning.includes('continuation') || reasoning.includes('strong'))) {
      return 'immediate_momentum';
    }

    if (reasoning.includes('breakout')) {
      if (reasoning.includes('retest') || reasoning.includes('pullback')) {
        return 'break_and_retest';
      }
      return 'immediate_momentum';
    }

    if (vwap && Math.abs(currentPrice - vwap) / vwap < 0.002) {
      if (reasoning.includes('vwap') || reasoning.includes('mean')) {
        return 'pullback_to_vwap';
      }
    }

    if (reasoning.includes('support') || reasoning.includes('resistance')) {
      return 'pullback_to_support';
    }

    if (reasoning.includes('retest') || reasoning.includes('structure')) {
      return 'retest_structure';
    }

    if (reasoning.includes('range') || (marketContext.regime === 'side' && reasoning.includes('extreme'))) {
      return 'range_extreme';
    }

    if (marketContext.regime === 'bull' || marketContext.regime === 'bear') {
      const distanceFromEntry = Math.abs(currentPrice - decision.entry) / currentPrice;

      if (distanceFromEntry < 0.0005) {
        return 'immediate_momentum';
      } else {
        return 'pullback_to_support';
      }
    }

    const confirmationVote = votes.confirmation;
    if (confirmationVote && confirmationVote.action !== 'NO_TRADE') {
      return 'pullback_to_support';
    }

    return 'immediate_momentum';
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
