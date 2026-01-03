import { supabase } from '../lib/supabase';
import type {
  EntryIntent,
  EntryIntentType,
  EntryUrgencyLevel,
  EntryConditions,
  EntryValidationResult,
  EntryPlannerDecision,
  EntryIntentRequest
} from '../types/entry';
import { logger } from '../lib/logger';
import { getSessionAdjustedTimeout, getCurrentMarketSession } from '../utils/marketHours';
import { calculatePipDistance } from '../utils/currencyHelpers';
import {
  calculateConfidenceAwareChaseThreshold,
  calculateTimeoutProgress,
  calculateDistanceToZone,
  isPriceInZone,
  extractConfidenceFromIntent,
  getMaxWaitSeconds,
  calculateMonitoringDuration,
  getRelaxationThresholds
} from '../utils/entry-validation-helpers';

export class EntryPlannerService {
  private static readonly VWAP_TOLERANCE_PIPS = 2;
  private static readonly SUPPORT_RESISTANCE_TOLERANCE_PIPS = 3;
  private static readonly MOMENTUM_CANDLE_COUNT = 2;
  // REMOVED: CHASE_THRESHOLD_PIPS - now in SSOT entry-validation-helpers.ts

  static async createEntryIntent(
    userId: string,
    request: EntryIntentRequest
  ): Promise<EntryIntent | null> {
    try {
      // Apply session-based timeout adjustment
      const adjustedTimeout = getSessionAdjustedTimeout(request.timeout_minutes, request.symbol);
      const session = getCurrentMarketSession();

      if (adjustedTimeout !== request.timeout_minutes) {
        logger.info(
          `Timeout adjusted for ${session.description}: ` +
          `${request.timeout_minutes}min -> ${adjustedTimeout}min`
        );
      }

      const timeoutAt = new Date();
      timeoutAt.setMinutes(timeoutAt.getMinutes() + adjustedTimeout);

      const maxWaitSeconds = request.max_wait_seconds || adjustedTimeout * 60;

      const { data, error } = await supabase
        .from('entry_intents')
        .insert({
          user_id: userId,
          session_id: request.session_id,
          symbol: request.symbol,
          intent_type: request.intent_type,
          urgency: request.urgency,
          direction: request.direction,
          entry_zone_min: request.entry_zone_min,
          entry_zone_max: request.entry_zone_max,
          timeout_minutes: adjustedTimeout,
          timeout_at: timeoutAt.toISOString(),
          max_wait_seconds: maxWaitSeconds,
          timeout_action: request.timeout_action || 'CANCEL',
          invalidation_price: request.invalidation_price,
          alpha_reasoning: request.alpha_reasoning,
          market_context: request.market_context || {},
          status: 'monitoring'
        })
        .select()
        .single();

      if (error) {
        logger.error('Failed to create entry intent:', error);
        return null;
      }

      logger.info(`Entry intent created: ${data.id} (${request.intent_type}, ${request.urgency}, ${adjustedTimeout}min timeout)`);
      return data;
    } catch (error) {
      logger.error('Error creating entry intent:', error);
      return null;
    }
  }

  static async validateEntryConditions(
    intent: EntryIntent,
    currentPrice: number,
    candleData: any,
    marketConditions: any
  ): Promise<EntryValidationResult> {
    const intentType = intent.intent_type;
    const conditions: EntryConditions = {};

    // SSOT: Use centralized timeout progress calculation
    const maxWaitSeconds = getMaxWaitSeconds(intent);
    const timeoutProgress = calculateTimeoutProgress(intent.created_at, maxWaitSeconds);

    const invalidationCheck = this.checkInvalidationPrice(intent, currentPrice);
    if (invalidationCheck.should_cancel) {
      return invalidationCheck;
    }

    switch (intentType) {
      case 'immediate_momentum':
        return this.validateImmediateMomentum(intent, currentPrice, candleData, conditions, timeoutProgress);

      case 'pullback_to_vwap':
        return this.validatePullbackToVWAP(intent, currentPrice, candleData, marketConditions, conditions, timeoutProgress);

      case 'pullback_to_support':
        return this.validatePullbackToSupport(intent, currentPrice, candleData, conditions, timeoutProgress);

      case 'break_and_retest':
        return this.validateBreakAndRetest(intent, currentPrice, candleData, conditions, timeoutProgress);

      case 'range_extreme':
        return this.validateRangeExtreme(intent, currentPrice, candleData, conditions, timeoutProgress);

      case 'retest_structure':
        return this.validateRetestStructure(intent, currentPrice, candleData, conditions, timeoutProgress);

      default:
        return {
          is_valid: false,
          conditions_met: conditions,
          should_execute: false,
          should_wait: false,
          should_cancel: true,
          cancel_reason: 'Unknown intent type',
          message: 'Invalid entry intent type'
        };
    }
  }

  private static checkInvalidationPrice(intent: EntryIntent, currentPrice: number): EntryValidationResult {
    const invalidationPrice = (intent as any).invalidation_price;
    const marketContext = intent.market_context as any;
    const stopLoss = invalidationPrice || marketContext?.stop_loss;

    if (!stopLoss) {
      return {
        is_valid: true,
        conditions_met: {},
        should_execute: false,
        should_wait: true,
        should_cancel: false,
        message: 'No invalidation check needed'
      };
    }

    const isInvalidated = intent.direction === 'long'
      ? currentPrice <= stopLoss
      : currentPrice >= stopLoss;

    if (isInvalidated) {
      logger.warn(`Setup invalidated: ${intent.direction} but price ${currentPrice.toFixed(5)} crossed SL ${stopLoss.toFixed(5)}`);
      return {
        is_valid: false,
        conditions_met: {},
        should_execute: false,
        should_wait: false,
        should_cancel: true,
        cancel_reason: 'Price reached invalidation level',
        message: `Setup invalidated - price crossed stop loss level`
      };
    }

    return {
      is_valid: true,
      conditions_met: {},
      should_execute: false,
      should_wait: true,
      should_cancel: false,
      message: 'Setup still valid'
    };
  }

  private static validateImmediateMomentum(
    intent: EntryIntent,
    currentPrice: number,
    candleData: any,
    conditions: EntryConditions,
    timeoutProgress: number
  ): EntryValidationResult {
    // SSOT: Use centralized distance and chase threshold calculations
    const distanceToPips = calculateDistanceToZone(
      currentPrice,
      intent.entry_zone_min,
      intent.entry_zone_max,
      intent.symbol
    );

    const confidence = extractConfidenceFromIntent(intent);
    const effectiveThreshold = calculateConfidenceAwareChaseThreshold(confidence, intent.symbol);

    // IMMEDIATE MOMENTUM: Confidence-scaled chase logic
    if (Math.abs(distanceToPips) > effectiveThreshold) {
      logger.warn(`[Entry Monitor] ${intent.symbol} distance check:
  Current: ${currentPrice.toFixed(5)}
  Zone: ${intent.entry_zone_min.toFixed(5)} - ${intent.entry_zone_max.toFixed(5)}
  Distance: ${Math.abs(distanceToPips).toFixed(1)} pips
  Threshold: ${effectiveThreshold} pips
  ❌ Beyond threshold - canceling`);

      return {
        is_valid: false,
        conditions_met: conditions,
        should_execute: false,
        should_wait: false,
        should_cancel: true,
        cancel_reason: 'Move extended beyond chase threshold',
        message: `Price moved ${Math.abs(distanceToPips).toFixed(1)} pips away (threshold: ${effectiveThreshold}). No chase.`
      };
    }

    logger.info(`[Entry Monitor] ${intent.symbol} distance check:
  Current: ${currentPrice.toFixed(5)}
  Zone: ${intent.entry_zone_min.toFixed(5)} - ${intent.entry_zone_max.toFixed(5)}
  Distance: ${Math.abs(distanceToPips).toFixed(1)} pips
  Threshold: ${effectiveThreshold} pips
  ✅ Within threshold`);

    // SSOT: Use centralized monitoring duration calculation
    const monitoringSeconds = calculateMonitoringDuration(intent.created_at);

    conditions.momentum_sustained = this.checkMomentumSustained(candleData, intent.direction);
    conditions.volume_confirmation = this.checkVolumeConfirmation(candleData);

    // SSOT: Use centralized confidence-aware progressive relaxation
    const thresholds = getRelaxationThresholds(confidence);

    // High confidence (70%+): Relax faster (don't miss the trade)
    // Medium confidence (60-69%): Standard relaxation
    // Low confidence (50-59%): Relax slower (require more confirmation)

    if (confidence >= 70) {
      // HIGH CONFIDENCE: Execute with partial confirmation early
      if (timeoutProgress < thresholds.earlyConfirmationThreshold) {
        // First 40%: Require either momentum OR volume
        if (conditions.momentum_sustained || conditions.volume_confirmation) {
          return {
            is_valid: true,
            conditions_met: conditions,
            should_execute: true,
            should_wait: false,
            should_cancel: false,
            message: 'High confidence momentum - executing with confirmation.'
          };
        }
      } else {
        // After 40%: Execute if in zone (trust the conviction)
        const inZone = isPriceInZone(currentPrice, intent.entry_zone_min, intent.entry_zone_max);
        if (inZone) {
          return {
            is_valid: true,
            conditions_met: conditions,
            should_execute: true,
            should_wait: false,
            should_cancel: false,
            message: `High confidence setup - executing (${(timeoutProgress * 100).toFixed(0)}% elapsed).`
          };
        }
      }
    } else if (confidence >= 60) {
      // MEDIUM CONFIDENCE: Standard relaxation
      if (timeoutProgress < thresholds.earlyConfirmationThreshold) {
        // First 25%: Require both conditions
        if (conditions.momentum_sustained && conditions.volume_confirmation) {
          return {
            is_valid: true,
            conditions_met: conditions,
            should_execute: true,
            should_wait: false,
            should_cancel: false,
            message: 'Momentum confirmed (full). Executing entry.'
          };
        }
      } else if (timeoutProgress < thresholds.standardConfirmationThreshold) {
        // 25-60%: Require either condition
        if (conditions.momentum_sustained || conditions.volume_confirmation) {
          return {
            is_valid: true,
            conditions_met: conditions,
            should_execute: true,
            should_wait: false,
            should_cancel: false,
            message: 'Momentum confirmed. Executing entry.'
          };
        }
      } else {
        // After 60%: Execute if in zone
        const inZone = isPriceInZone(currentPrice, intent.entry_zone_min, intent.entry_zone_max);
        if (inZone) {
          return {
            is_valid: true,
            conditions_met: conditions,
            should_execute: true,
            should_wait: false,
            should_cancel: false,
            message: `Entry window closing (${(timeoutProgress * 100).toFixed(0)}% elapsed). Executing.`
          };
        }
      }
    } else {
      // LOW CONFIDENCE: Strict requirements
      if (timeoutProgress < thresholds.urgencyThreshold) {
        // First 70%: Require both conditions
        if (conditions.momentum_sustained && conditions.volume_confirmation) {
          return {
            is_valid: true,
            conditions_met: conditions,
            should_execute: true,
            should_wait: false,
            should_cancel: false,
            message: 'Low confidence setup - full confirmation required. Executing.'
          };
        }
      } else {
        // After 70%: Require at least one condition + in zone
        const inZone = isPriceInZone(currentPrice, intent.entry_zone_min, intent.entry_zone_max);
        if (inZone && (conditions.momentum_sustained || conditions.volume_confirmation)) {
          return {
            is_valid: true,
            conditions_met: conditions,
            should_execute: true,
            should_wait: false,
            should_cancel: false,
            message: 'Marginal setup - executing with partial confirmation.'
          };
        }
      }
    }

    // If monitored for 15+ seconds: execute with partial confirmation (legacy fallback)
    if (monitoringSeconds >= 15) {
      logger.info(`Immediate momentum monitored for ${monitoringSeconds.toFixed(0)}s - executing with partial confirmation`);
      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: true,
        should_wait: false,
        should_cancel: false,
        message: `Executing after ${monitoringSeconds.toFixed(0)}s monitoring. Entry window closing.`
      };
    }

    // Otherwise: wait a bit longer for better confirmation
    return {
      is_valid: true,
      conditions_met: conditions,
      should_execute: false,
      should_wait: true,
      should_cancel: false,
      message: `Momentum setup active (${(timeoutProgress * 100).toFixed(0)}% timeout). Current price: ${currentPrice.toFixed(5)}. Waiting for confirmation.`
    };
  }

  private static validatePullbackToVWAP(
    intent: EntryIntent,
    currentPrice: number,
    candleData: any,
    marketConditions: any,
    conditions: EntryConditions,
    timeoutProgress: number
  ): EntryValidationResult {
    const vwap = marketConditions?.vwap || 0;
    const distanceToVWAP = calculatePipDistance(intent.symbol, currentPrice, vwap);

    conditions.vwap_touch = distanceToVWAP <= this.VWAP_TOLERANCE_PIPS;

    if (!conditions.vwap_touch) {
      // SSOT: Use centralized distance calculation
      const distanceToPips = calculateDistanceToZone(
        currentPrice,
        intent.entry_zone_min,
        intent.entry_zone_max,
        intent.symbol
      );

      if (timeoutProgress >= 0.8) {
        const inZone = isPriceInZone(currentPrice, intent.entry_zone_min, intent.entry_zone_max);
        if (inZone) {
          return {
            is_valid: true,
            conditions_met: conditions,
            should_execute: true,
            should_wait: false,
            should_cancel: false,
            message: `Entry window closing (${(timeoutProgress * 100).toFixed(0)}%). Executing in zone.`
          };
        }
      }

      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: false,
        should_wait: true,
        should_cancel: false,
        message: `Waiting for pullback to VWAP at ${vwap.toFixed(5)}. Distance: ${Math.abs(distanceToPips).toFixed(1)} pips. (${(timeoutProgress * 100).toFixed(0)}% elapsed)`
      };
    }

    conditions.candle_pattern_confirmed = this.checkRejectionWick(candleData, intent.direction);

    if (conditions.vwap_touch && conditions.candle_pattern_confirmed) {
      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: true,
        should_wait: false,
        should_cancel: false,
        message: 'VWAP touch confirmed with rejection wick. Executing entry.'
      };
    }

    if (conditions.vwap_touch && timeoutProgress >= 0.6) {
      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: true,
        should_wait: false,
        should_cancel: false,
        message: `VWAP touched, deadline approaching (${(timeoutProgress * 100).toFixed(0)}%). Executing without pattern confirmation.`
      };
    }

    return {
      is_valid: true,
      conditions_met: conditions,
      should_execute: false,
      should_wait: true,
      should_cancel: false,
      message: `Price at VWAP. Waiting for rejection confirmation. (${(timeoutProgress * 100).toFixed(0)}% elapsed)`
    };
  }

  private static validatePullbackToSupport(
    intent: EntryIntent,
    currentPrice: number,
    candleData: any,
    conditions: EntryConditions,
    timeoutProgress: number
  ): EntryValidationResult {
    // SSOT: Use centralized zone and distance calculations
    const inZone = isPriceInZone(currentPrice, intent.entry_zone_min, intent.entry_zone_max);
    conditions.support_resistance_hold = inZone;

    if (!inZone) {
      const distanceToPips = calculateDistanceToZone(
        currentPrice,
        intent.entry_zone_min,
        intent.entry_zone_max,
        intent.symbol
      );
      const confidence = extractConfidenceFromIntent(intent);
      const effectiveThreshold = calculateConfidenceAwareChaseThreshold(confidence, intent.symbol);

      if (Math.abs(distanceToPips) > effectiveThreshold) {
        logger.warn(`[Entry Monitor] ${intent.symbol} too far from support: ${Math.abs(distanceToPips).toFixed(1)} pips (threshold: ${effectiveThreshold})`);

        return {
          is_valid: false,
          conditions_met: conditions,
          should_execute: false,
          should_wait: false,
          should_cancel: true,
          cancel_reason: 'Price moved too far from support zone',
          message: `Price ${Math.abs(distanceToPips).toFixed(1)} pips away from zone (threshold: ${effectiveThreshold}). No chase.`
        };
      }

      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: false,
        should_wait: true,
        should_cancel: false,
        message: `Waiting for pullback to support zone. Distance: ${Math.abs(distanceToPips).toFixed(1)} pips. (${(timeoutProgress * 100).toFixed(0)}% elapsed)`
      };
    }

    conditions.candle_pattern_confirmed = this.checkBullishBearishPattern(candleData, intent.direction);

    if (conditions.support_resistance_hold && conditions.candle_pattern_confirmed) {
      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: true,
        should_wait: false,
        should_cancel: false,
        message: 'Price in support zone with confirmation. Executing entry.'
      };
    }

    if (inZone && timeoutProgress >= 0.6) {
      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: true,
        should_wait: false,
        should_cancel: false,
        message: `In support zone, deadline approaching (${(timeoutProgress * 100).toFixed(0)}%). Executing without candle confirmation.`
      };
    }

    return {
      is_valid: true,
      conditions_met: conditions,
      should_execute: false,
      should_wait: true,
      should_cancel: false,
      message: `Price in support zone. Waiting for confirmation. (${(timeoutProgress * 100).toFixed(0)}% elapsed)`
    };
  }

  private static validateBreakAndRetest(
    intent: EntryIntent,
    currentPrice: number,
    candleData: any,
    conditions: EntryConditions,
    timeoutProgress: number
  ): EntryValidationResult {
    const breakoutLevel = (intent.entry_zone_min + intent.entry_zone_max) / 2;
    const hasBreakout = intent.direction === 'long'
      ? currentPrice > breakoutLevel
      : currentPrice < breakoutLevel;

    conditions.breakout_confirmed = hasBreakout;

    if (!hasBreakout) {
      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: false,
        should_wait: true,
        should_cancel: false,
        message: `Waiting for break above ${breakoutLevel.toFixed(5)}. (${(timeoutProgress * 100).toFixed(0)}% elapsed)`
      };
    }

    // SSOT: Use centralized zone check
    const inRetestZone = isPriceInZone(currentPrice, intent.entry_zone_min, intent.entry_zone_max);
    conditions.retest_hold = inRetestZone;

    if (hasBreakout && inRetestZone) {
      conditions.candle_pattern_confirmed = this.checkHoldPattern(candleData, intent.direction);

      if (conditions.candle_pattern_confirmed) {
        return {
          is_valid: true,
          conditions_met: conditions,
          should_execute: true,
          should_wait: false,
          should_cancel: false,
          message: 'Break and retest confirmed. Executing entry.'
        };
      }

      if (timeoutProgress >= 0.6) {
        return {
          is_valid: true,
          conditions_met: conditions,
          should_execute: true,
          should_wait: false,
          should_cancel: false,
          message: `Breakout + retest zone, deadline approaching (${(timeoutProgress * 100).toFixed(0)}%). Executing.`
        };
      }
    }

    return {
      is_valid: true,
      conditions_met: conditions,
      should_execute: false,
      should_wait: true,
      should_cancel: false,
      message: `Breakout occurred. Waiting for retest of ${breakoutLevel.toFixed(5)}. (${(timeoutProgress * 100).toFixed(0)}% elapsed)`
    };
  }

  private static validateRangeExtreme(
    intent: EntryIntent,
    currentPrice: number,
    candleData: any,
    conditions: EntryConditions,
    timeoutProgress: number
  ): EntryValidationResult {
    // SSOT: Use centralized zone and distance calculations
    const inZone = isPriceInZone(currentPrice, intent.entry_zone_min, intent.entry_zone_max);
    conditions.range_boundary_reached = inZone;

    if (!inZone) {
      const distanceToPips = calculateDistanceToZone(
        currentPrice,
        intent.entry_zone_min,
        intent.entry_zone_max,
        intent.symbol
      );
      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: false,
        should_wait: true,
        should_cancel: false,
        message: `Waiting for price at range extreme. Distance: ${Math.abs(distanceToPips).toFixed(1)} pips. (${(timeoutProgress * 100).toFixed(0)}% elapsed)`
      };
    }

    conditions.candle_pattern_confirmed = this.checkReversalPattern(candleData, intent.direction);

    if (conditions.range_boundary_reached && conditions.candle_pattern_confirmed) {
      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: true,
        should_wait: false,
        should_cancel: false,
        message: 'Range extreme reached with reversal pattern. Executing entry.'
      };
    }

    if (inZone && timeoutProgress >= 0.6) {
      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: true,
        should_wait: false,
        should_cancel: false,
        message: `At range extreme, deadline approaching (${(timeoutProgress * 100).toFixed(0)}%). Executing.`
      };
    }

    return {
      is_valid: true,
      conditions_met: conditions,
      should_execute: false,
      should_wait: true,
      should_cancel: false,
      message: `Price at range boundary. Waiting for reversal confirmation. (${(timeoutProgress * 100).toFixed(0)}% elapsed)`
    };
  }

  private static validateRetestStructure(
    intent: EntryIntent,
    currentPrice: number,
    candleData: any,
    conditions: EntryConditions,
    timeoutProgress: number
  ): EntryValidationResult {
    // SSOT: Use centralized zone and distance calculations
    const inZone = isPriceInZone(currentPrice, intent.entry_zone_min, intent.entry_zone_max);
    conditions.retest_hold = inZone;

    if (!inZone) {
      const distanceToPips = calculateDistanceToZone(
        currentPrice,
        intent.entry_zone_min,
        intent.entry_zone_max,
        intent.symbol
      );
      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: false,
        should_wait: true,
        should_cancel: false,
        message: `Waiting for retest of structure. Distance: ${Math.abs(distanceToPips).toFixed(1)} pips. (${(timeoutProgress * 100).toFixed(0)}% elapsed)`
      };
    }

    conditions.candle_pattern_confirmed = this.checkHoldPattern(candleData, intent.direction);

    if (conditions.retest_hold && conditions.candle_pattern_confirmed) {
      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: true,
        should_wait: false,
        should_cancel: false,
        message: 'Structure retest confirmed. Executing entry.'
      };
    }

    if (inZone && timeoutProgress >= 0.6) {
      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: true,
        should_wait: false,
        should_cancel: false,
        message: `Structure retest zone, deadline approaching (${(timeoutProgress * 100).toFixed(0)}%). Executing.`
      };
    }

    return {
      is_valid: true,
      conditions_met: conditions,
      should_execute: false,
      should_wait: true,
      should_cancel: false,
      message: `Price at structure level. Waiting for hold confirmation. (${(timeoutProgress * 100).toFixed(0)}% elapsed)`
    };
  }

  // REMOVED: Moved to SSOT entry-validation-helpers.ts
  // - getConfidenceAwareChaseThreshold() -> calculateConfidenceAwareChaseThreshold()
  // - isPriceInZone() -> isPriceInZone()
  // - calculateDistanceToZone() -> calculateDistanceToZone()

  private static checkMomentumSustained(candleData: any, direction: string): boolean {
    if (!candleData || !candleData.candles || candleData.candles.length < this.MOMENTUM_CANDLE_COUNT) {
      // RESILIENT: If no candle data, assume conditions could be met (don't fail validation)
      logger.warn('No candle data available for momentum check - assuming conditions could be valid');
      return true;
    }

    const recentCandles = candleData.candles.slice(-this.MOMENTUM_CANDLE_COUNT);

    if (direction === 'long') {
      return recentCandles.every((c: any) => c.close > c.open);
    } else {
      return recentCandles.every((c: any) => c.close < c.open);
    }
  }

  private static checkVolumeConfirmation(candleData: any): boolean {
    if (!candleData || !candleData.candles || candleData.candles.length < 2) {
      return true;
    }

    const recentCandles = candleData.candles.slice(-2);
    const currentVolume = recentCandles[1]?.volume || 0;
    const previousVolume = recentCandles[0]?.volume || 1;

    return currentVolume > previousVolume;
  }

  private static checkRejectionWick(candleData: any, direction: string): boolean {
    if (!candleData || !candleData.currentCandle) {
      return false;
    }

    const candle = candleData.currentCandle;
    const bodySize = Math.abs(candle.close - candle.open);
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;

    if (direction === 'long') {
      return lowerWick > bodySize * 1.5 && candle.close > candle.open;
    } else {
      return upperWick > bodySize * 1.5 && candle.close < candle.open;
    }
  }

  private static checkBullishBearishPattern(candleData: any, direction: string): boolean {
    if (!candleData || !candleData.currentCandle) {
      return false;
    }

    const candle = candleData.currentCandle;

    if (direction === 'long') {
      return candle.close > candle.open;
    } else {
      return candle.close < candle.open;
    }
  }

  private static checkHoldPattern(candleData: any, direction: string): boolean {
    if (!candleData || !candleData.candles || candleData.candles.length < 2) {
      return false;
    }

    const recentCandles = candleData.candles.slice(-2);

    if (direction === 'long') {
      return recentCandles.every((c: any) => c.low >= c.open * 0.9995);
    } else {
      return recentCandles.every((c: any) => c.high <= c.open * 1.0005);
    }
  }

  private static checkReversalPattern(candleData: any, direction: string): boolean {
    if (!candleData || !candleData.currentCandle) {
      return false;
    }

    const candle = candleData.currentCandle;
    const bodySize = Math.abs(candle.close - candle.open);
    const upperWick = candle.high - Math.max(candle.open, candle.close);
    const lowerWick = Math.min(candle.open, candle.close) - candle.low;

    // RELAXED: Reduced from 2x to 1.5x body for more realistic patterns
    if (direction === 'long') {
      return lowerWick > bodySize * 1.5 && candle.close > candle.open;
    } else {
      return upperWick > bodySize * 1.5 && candle.close < candle.open;
    }
  }

  static async updateIntentStatus(
    intentId: string,
    status: 'executed' | 'timeout' | 'canceled' | 'conditions_changed',
    reason?: string,
    actualEntryPrice?: number
  ): Promise<boolean> {
    try {
      const updates: any = {
        status,
        [`${status}_at`]: new Date().toISOString()
      };

      if (reason) {
        updates.canceled_reason = reason;
      }

      if (actualEntryPrice) {
        updates.actual_entry_price = actualEntryPrice;
        updates.executed_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('entry_intents')
        .update(updates)
        .eq('id', intentId);

      if (error) {
        logger.error('Failed to update intent status:', error);
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Error updating intent status:', error);
      return false;
    }
  }

  static async getActiveIntents(userId: string): Promise<EntryIntent[]> {
    try {
      const { data, error } = await supabase
        .from('entry_intents')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'monitoring')
        .order('urgency', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) {
        logger.error('Failed to get active intents:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('Error getting active intents:', error);
      return [];
    }
  }
}
