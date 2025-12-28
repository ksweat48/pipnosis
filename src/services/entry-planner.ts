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

export class EntryPlannerService {
  private static readonly VWAP_TOLERANCE_PIPS = 2;
  private static readonly SUPPORT_RESISTANCE_TOLERANCE_PIPS = 3;
  private static readonly MOMENTUM_CANDLE_COUNT = 2;
  private static readonly CHASE_THRESHOLD_PIPS = 30;

  static async createEntryIntent(
    userId: string,
    request: EntryIntentRequest
  ): Promise<EntryIntent | null> {
    try {
      const timeoutAt = new Date();
      timeoutAt.setMinutes(timeoutAt.getMinutes() + request.timeout_minutes);

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
          timeout_minutes: request.timeout_minutes,
          timeout_at: timeoutAt.toISOString(),
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

      logger.info(`Entry intent created: ${data.id} (${request.intent_type}, ${request.urgency})`);
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

    switch (intentType) {
      case 'immediate_momentum':
        return this.validateImmediateMomentum(intent, currentPrice, candleData, conditions);

      case 'pullback_to_vwap':
        return this.validatePullbackToVWAP(intent, currentPrice, candleData, marketConditions, conditions);

      case 'pullback_to_support':
        return this.validatePullbackToSupport(intent, currentPrice, candleData, conditions);

      case 'break_and_retest':
        return this.validateBreakAndRetest(intent, currentPrice, candleData, conditions);

      case 'range_extreme':
        return this.validateRangeExtreme(intent, currentPrice, candleData, conditions);

      case 'retest_structure':
        return this.validateRetestStructure(intent, currentPrice, candleData, conditions);

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

  private static validateImmediateMomentum(
    intent: EntryIntent,
    currentPrice: number,
    candleData: any,
    conditions: EntryConditions
  ): EntryValidationResult {
    const distanceToPips = this.calculateDistanceToZone(currentPrice, intent);

    if (Math.abs(distanceToPips) > this.CHASE_THRESHOLD_PIPS) {
      return {
        is_valid: false,
        conditions_met: conditions,
        should_execute: false,
        should_wait: false,
        should_cancel: true,
        cancel_reason: 'Move extended beyond chase threshold',
        message: `Price moved ${Math.abs(distanceToPips).toFixed(1)} pips away. No chase.`
      };
    }

    // Check how long we've been monitoring
    const monitoringDuration = Date.now() - new Date(intent.created_at).getTime();
    const monitoringSeconds = monitoringDuration / 1000;

    conditions.momentum_sustained = this.checkMomentumSustained(candleData, intent.direction);
    conditions.volume_confirmation = this.checkVolumeConfirmation(candleData);

    // IMMEDIATE MOMENTUM LOGIC: Be aggressive about execution
    // If perfect conditions: execute immediately
    if (conditions.momentum_sustained && conditions.volume_confirmation) {
      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: true,
        should_wait: false,
        should_cancel: false,
        message: 'Momentum confirmed. Executing entry.'
      };
    }

    // If monitored for 15+ seconds: execute with partial confirmation
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
      message: `Momentum setup active. Current price: ${currentPrice.toFixed(5)}. Waiting for confirmation.`
    };
  }

  private static validatePullbackToVWAP(
    intent: EntryIntent,
    currentPrice: number,
    candleData: any,
    marketConditions: any,
    conditions: EntryConditions
  ): EntryValidationResult {
    const vwap = marketConditions?.vwap || 0;
    const distanceToVWAP = Math.abs(currentPrice - vwap) * 10000;

    conditions.vwap_touch = distanceToVWAP <= this.VWAP_TOLERANCE_PIPS;

    if (!conditions.vwap_touch) {
      const distanceToPips = this.calculateDistanceToZone(currentPrice, intent);
      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: false,
        should_wait: true,
        should_cancel: false,
        message: `Waiting for pullback to VWAP at ${vwap.toFixed(5)}. Current distance: ${Math.abs(distanceToPips).toFixed(1)} pips.`
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

    return {
      is_valid: true,
      conditions_met: conditions,
      should_execute: false,
      should_wait: true,
      should_cancel: false,
      message: `Price at VWAP. Waiting for rejection confirmation.`
    };
  }

  private static validatePullbackToSupport(
    intent: EntryIntent,
    currentPrice: number,
    candleData: any,
    conditions: EntryConditions
  ): EntryValidationResult {
    const inZone = this.isPriceInZone(currentPrice, intent);
    conditions.support_resistance_hold = inZone;

    if (!inZone) {
      const distanceToPips = this.calculateDistanceToZone(currentPrice, intent);

      if (distanceToPips > this.CHASE_THRESHOLD_PIPS) {
        return {
          is_valid: false,
          conditions_met: conditions,
          should_execute: false,
          should_wait: false,
          should_cancel: true,
          cancel_reason: 'Price moved too far from support zone',
          message: `Price ${distanceToPips.toFixed(1)} pips away from zone. No chase.`
        };
      }

      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: false,
        should_wait: true,
        should_cancel: false,
        message: `Waiting for pullback to support zone ${intent.entry_zone_min.toFixed(5)}-${intent.entry_zone_max.toFixed(5)}. Distance: ${Math.abs(distanceToPips).toFixed(1)} pips.`
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

    return {
      is_valid: true,
      conditions_met: conditions,
      should_execute: false,
      should_wait: true,
      should_cancel: false,
      message: `Price in support zone. Waiting for bullish confirmation.`
    };
  }

  private static validateBreakAndRetest(
    intent: EntryIntent,
    currentPrice: number,
    candleData: any,
    conditions: EntryConditions
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
        message: `Waiting for break above ${breakoutLevel.toFixed(5)}.`
      };
    }

    const inRetestZone = this.isPriceInZone(currentPrice, intent);
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
    }

    return {
      is_valid: true,
      conditions_met: conditions,
      should_execute: false,
      should_wait: true,
      should_cancel: false,
      message: `Breakout occurred. Waiting for retest of ${breakoutLevel.toFixed(5)}.`
    };
  }

  private static validateRangeExtreme(
    intent: EntryIntent,
    currentPrice: number,
    candleData: any,
    conditions: EntryConditions
  ): EntryValidationResult {
    const inZone = this.isPriceInZone(currentPrice, intent);
    conditions.range_boundary_reached = inZone;

    if (!inZone) {
      const distanceToPips = this.calculateDistanceToZone(currentPrice, intent);
      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: false,
        should_wait: true,
        should_cancel: false,
        message: `Waiting for price at range extreme. Distance: ${Math.abs(distanceToPips).toFixed(1)} pips.`
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

    return {
      is_valid: true,
      conditions_met: conditions,
      should_execute: false,
      should_wait: true,
      should_cancel: false,
      message: `Price at range boundary. Waiting for reversal confirmation.`
    };
  }

  private static validateRetestStructure(
    intent: EntryIntent,
    currentPrice: number,
    candleData: any,
    conditions: EntryConditions
  ): EntryValidationResult {
    const inZone = this.isPriceInZone(currentPrice, intent);
    conditions.retest_hold = inZone;

    if (!inZone) {
      const distanceToPips = this.calculateDistanceToZone(currentPrice, intent);
      return {
        is_valid: true,
        conditions_met: conditions,
        should_execute: false,
        should_wait: true,
        should_cancel: false,
        message: `Waiting for retest of structure at ${intent.entry_zone_min.toFixed(5)}-${intent.entry_zone_max.toFixed(5)}. Distance: ${Math.abs(distanceToPips).toFixed(1)} pips.`
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

    return {
      is_valid: true,
      conditions_met: conditions,
      should_execute: false,
      should_wait: true,
      should_cancel: false,
      message: `Price at structure level. Waiting for hold confirmation.`
    };
  }

  private static isPriceInZone(price: number, intent: EntryIntent): boolean {
    return price >= intent.entry_zone_min && price <= intent.entry_zone_max;
  }

  private static calculateDistanceToZone(price: number, intent: EntryIntent): number {
    if (this.isPriceInZone(price, intent)) {
      return 0;
    }

    const distanceToMin = (price - intent.entry_zone_min) * 10000;
    const distanceToMax = (price - intent.entry_zone_max) * 10000;

    return Math.abs(distanceToMin) < Math.abs(distanceToMax) ? distanceToMin : distanceToMax;
  }

  private static checkMomentumSustained(candleData: any, direction: string): boolean {
    if (!candleData || !candleData.candles || candleData.candles.length < this.MOMENTUM_CANDLE_COUNT) {
      return false;
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

    if (direction === 'long') {
      return lowerWick > bodySize * 2 && candle.close > candle.open;
    } else {
      return upperWick > bodySize * 2 && candle.close < candle.open;
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
