import { supabase } from '../lib/supabase';
import { EntryPlannerService } from './entry-planner';
import type { EntryIntent, EntryMonitoringLog, TimeoutAction } from '../types/entry';
import { logger } from '../lib/logger';
import { globalToastManager } from './global-toast-manager';
import { normalizeTimeframeToDb } from '../utils/timeframe-utils';
import { calculatePipDistance } from '../utils/currencyHelpers';
import { entryQualificationEngine } from './entry-qualification-engine';
import type { EntryQualificationInput } from './entry-qualification-engine';

export class ActiveEntryMonitor {
  private static instance: ActiveEntryMonitor;
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  private lastNotificationTime: Map<string, number> = new Map();
  private readonly POLL_INTERVAL = 5000;
  private readonly NOTIFICATION_INTERVAL = 120000;
  private resumeInProgress = false;

  private constructor() {}

  static getInstance(): ActiveEntryMonitor {
    if (!ActiveEntryMonitor.instance) {
      ActiveEntryMonitor.instance = new ActiveEntryMonitor();
    }
    return ActiveEntryMonitor.instance;
  }

  async startMonitoring(intentId: string, userId: string): Promise<void> {
    if (this.monitoringIntervals.has(intentId)) {
      logger.info(`Already monitoring intent ${intentId}`);
      return;
    }

    logger.info(`Starting monitoring for intent ${intentId}`);

    const interval = setInterval(async () => {
      await this.checkIntent(intentId, userId);
    }, this.POLL_INTERVAL);

    this.monitoringIntervals.set(intentId, interval);

    await this.checkIntent(intentId, userId);
  }

  async stopMonitoring(intentId: string): Promise<void> {
    const interval = this.monitoringIntervals.get(intentId);
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(intentId);
      this.lastNotificationTime.delete(intentId);
      logger.info(`Stopped monitoring intent ${intentId}`);
    }
  }

  stopAllMonitoring(): void {
    for (const [intentId, interval] of this.monitoringIntervals) {
      clearInterval(interval);
    }
    this.monitoringIntervals.clear();
    this.lastNotificationTime.clear();
    logger.info('Stopped all entry monitoring');
  }

  private async checkIntent(intentId: string, userId: string): Promise<void> {
    try {
      const { data: intent, error } = await supabase
        .from('entry_intents')
        .select('*')
        .eq('id', intentId)
        .maybeSingle();

      if (error || !intent) {
        logger.warn(`Intent ${intentId} no longer exists or was deleted - stopping monitoring`);
        await this.stopMonitoring(intentId);
        return;
      }

      if (intent.status !== 'monitoring') {
        await this.stopMonitoring(intentId);
        return;
      }

      const maxWaitSeconds = (intent as any).max_wait_seconds || intent.timeout_minutes * 60;
      const elapsedSeconds = Math.floor((Date.now() - new Date(intent.created_at).getTime()) / 1000);
      const isTimedOut = elapsedSeconds >= maxWaitSeconds;

      if (isTimedOut) {
        const timeoutAction: TimeoutAction = (intent as any).timeout_action || 'CANCEL';
        const currentPrice = await this.getCurrentPrice(intent.symbol);

        logger.info(
          `Intent ${intentId} deadline reached after ${elapsedSeconds}s | ` +
          `Action: ${timeoutAction} | Current price: ${currentPrice?.toFixed(5) || 'N/A'}`
        );

        if (timeoutAction === 'EXECUTE_AT_MARKET' && currentPrice) {
          const isStillValid = this.validateSetupStillValid(intent, currentPrice);

          if (isStillValid) {
            logger.info(`Deadline reached - executing at market (setup still valid)`);
            await this.handleExecution(intent, currentPrice, 'Deadline reached - executing at market');
          } else {
            logger.warn(`Deadline reached but setup invalidated - canceling`);
            await this.handleCancel(intent, 'Setup invalidated before deadline execution');
          }
        } else {
          await this.handleTimeout(intent);
        }

        await this.stopMonitoring(intentId);
        return;
      }

      const currentPrice = await this.getCurrentPrice(intent.symbol);
      if (!currentPrice) {
        logger.warn(`Failed to get current price for ${intent.symbol}`);
        return;
      }

      const candleData = await this.getCandleData(intent.symbol);
      const marketConditions = await this.getMarketConditions(intent.symbol);

      const validation = await EntryPlannerService.validateEntryConditions(
        intent,
        currentPrice,
        candleData,
        marketConditions
      );

      const distanceToPips = this.calculateDistanceToZone(currentPrice, intent);

      // Enhanced logging for debugging
      const monitoringSeconds = Math.floor((Date.now() - new Date(intent.created_at).getTime()) / 1000);
      logger.debug(`Intent ${intentId} check: ${monitoringSeconds}s elapsed, should_execute=${validation.should_execute}, should_wait=${validation.should_wait}, should_cancel=${validation.should_cancel}`);

      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // ENTRY QUALITY SCORE (EQS) SYSTEM
      // No rejections - only EXECUTE_NOW or WAIT_FOR_BETTER_ENTRY decisions
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

      // Run Entry Quality Score evaluation on every check
      let eqsResult: any = null;
      if (candleData.candles && candleData.candles.length >= 5) {
        try {
          const marketContext = intent.market_context as any;
          const confidence = marketContext?.confidence || 60;
          const stopLoss = marketContext?.stop_loss || 0;
          const takeProfit = marketContext?.take_profit || 0;

          // Prepare input for Entry Qualification Engine
          const qualificationInput: EntryQualificationInput = {
            symbol: intent.symbol,
            direction: intent.direction === 'long' ? 'BUY' : 'SELL',
            entryPrice: currentPrice,
            stopLoss,
            takeProfit,
            confidence,
            m5Candles: candleData.candles.slice(0, 10).map((c: any) => ({
              time: c.open_time,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume
            })),
            m5VWAP: marketConditions.vwap || currentPrice,
            m5EMA20: currentPrice,
            m5RSI: 50,
            m5VolumeAvg20: marketConditions.avgVolume || 0,
            m15Trend: 'sideways',
            m15SupportResistance: {},
            currentSpreadPips: 0.5,
            averageSpreadPips: 0.5,
            atr: marketConditions.atr || 0.001
          };

          eqsResult = entryQualificationEngine.evaluate(qualificationInput);

          // Get entry mode from intent or fallback based on confidence
          const entryMode = (intent as any).entry_mode ||
            (confidence >= 75 ? 'immediate' : confidence >= 65 ? 'wait_pullback' : 'wait_confirmation');

          // Get minimum EQS threshold from entry_spec or use mode-based defaults
          const minEQS = entryMode === 'immediate' ? 70 :
                        entryMode === 'wait_pullback' ? 75 : 80;

          logger.info(
            `[EQS] ${intent.symbol} Evaluation:\n` +
            `  EQS Score: ${eqsResult.eqsBreakdown.totalScore}/100 (Grade: ${this.getEQSGrade(eqsResult.eqsBreakdown.totalScore)})\n` +
            `  Status: ${eqsResult.status} | Action Tier: ${eqsResult.actionTier}\n` +
            `  Entry Mode: ${entryMode} (requires EQS ${minEQS}+)\n` +
            `  Location: ${eqsResult.eqsBreakdown.locationScore}/30 | Confirmation: ${eqsResult.eqsBreakdown.confirmationScore}/30\n` +
            `  Timing: ${eqsResult.eqsBreakdown.timingScore}/25 | Friction: ${eqsResult.eqsBreakdown.frictionPenalty}\n` +
            `  ${eqsResult.eqsBreakdown.aplusPatternBonus ? `A+ Bonus: +${eqsResult.eqsBreakdown.aplusPatternBonus} (${eqsResult.eqsBreakdown.aplusPatternType})` : ''}`
          );

          // Update entry intent with EQS data
          await supabase
            .from('entry_intents')
            .update({
              eqs_score: Math.round(eqsResult.eqsBreakdown.totalScore),
              eqs_breakdown: eqsResult.eqsBreakdown,
              entry_mode: entryMode
            })
            .eq('id', intentId);

          // Apply EQS-based decision logic
          if (eqsResult.status === 'EXECUTE_NOW' && eqsResult.eqsBreakdown.totalScore >= minEQS) {
            logger.info(
              `[EQS] EXECUTE_NOW: Entry quality meets threshold (${eqsResult.eqsBreakdown.totalScore} >= ${minEQS})`
            );
            validation.should_execute = true;
            validation.should_wait = false;
            validation.message = `High quality entry (EQS ${Math.round(eqsResult.eqsBreakdown.totalScore)}/100, Grade ${this.getEQSGrade(eqsResult.eqsBreakdown.totalScore)})`;
          } else {
            // WAIT_FOR_BETTER_ENTRY
            logger.info(
              `[EQS] WAIT: Entry quality below threshold or needs improvement\n` +
              `  Current EQS: ${eqsResult.eqsBreakdown.totalScore} | Required: ${minEQS}\n` +
              `  Recommendation: ${eqsResult.waitRecommendation?.userMessage || 'Monitor for better entry'}`
            );
            validation.should_execute = false;
            validation.should_wait = true;
            validation.message = eqsResult.waitRecommendation?.userMessage ||
              `Waiting for better entry quality (current EQS: ${Math.round(eqsResult.eqsBreakdown.totalScore)}/100)`;
          }
        } catch (error) {
          logger.error('Error running EQS evaluation:', error);
          // Don't block execution if EQS fails - fall back to basic validation
        }
      }

      await this.logMonitoring(
        intentId,
        currentPrice,
        distanceToPips,
        {
          ...validation.conditions_met,
          eqs_evaluation: eqsResult ? {
            eqs_score: Math.round(eqsResult.eqsBreakdown.totalScore),
            eqs_grade: this.getEQSGrade(eqsResult.eqsBreakdown.totalScore),
            action_tier: eqsResult.actionTier,
            location_score: eqsResult.eqsBreakdown.locationScore,
            confirmation_score: eqsResult.eqsBreakdown.confirmationScore,
            timing_score: eqsResult.eqsBreakdown.timingScore,
            friction_penalty: eqsResult.eqsBreakdown.frictionPenalty,
            aplus_bonus: eqsResult.eqsBreakdown.aplusPatternBonus || 0
          } : null
        },
        validation.message
      );

      if (validation.should_execute) {
        logger.info(`Executing intent ${intentId} after ${monitoringSeconds}s: ${validation.message}`);
        await this.handleExecution(intent, currentPrice, validation.message);
        await this.stopMonitoring(intentId);
      } else if (validation.should_cancel) {
        logger.warn(`Canceling intent ${intentId} after ${monitoringSeconds}s: ${validation.cancel_reason}`);
        await this.handleCancel(intent, validation.cancel_reason || 'Conditions changed');
        await this.stopMonitoring(intentId);
      } else if (validation.should_wait) {
        logger.debug(`Intent ${intentId} waiting: ${validation.message}`);
        await this.notifyUserIfNeeded(intentId, userId, validation.message, currentPrice, distanceToPips);
      }
    } catch (error) {
      logger.error(`Error checking intent ${intentId}:`, error);
    }
  }

  private async handleExecution(intent: EntryIntent, entryPrice: number, message: string): Promise<void> {
    const marketContext = intent.market_context as any;
    const confidence = marketContext?.confidence || 60;

    logger.info(
      `Executing entry for intent ${intent.id} at ${entryPrice} ` +
      `(${confidence}% confidence, ${intent.intent_type})`
    );

    await EntryPlannerService.updateIntentStatus(intent.id, 'executed', undefined, entryPrice);

    const { EntryExecutionCoordinator } = await import('./entry-execution-coordinator');
    const result = await EntryExecutionCoordinator.executeFromIntent(intent.id, entryPrice);

    if (result.success) {
      logger.info(`Trade created from intent: ${result.tradeId}`);
    } else {
      logger.error('Failed to create trade from intent');
    }

    const { data: session } = await supabase
      .from('goal_sessions')
      .select('user_id')
      .eq('id', intent.session_id)
      .single();

    if (session) {
      // Confidence-aware execution messages
      let executionMessage: string;
      if (confidence >= 70) {
        executionMessage = `${intent.symbol} ${intent.direction} executed at ${entryPrice.toFixed(5)} (${confidence}% conviction - optimal entry secured)`;
      } else if (confidence >= 60) {
        executionMessage = `${intent.symbol} ${intent.direction} executed at ${entryPrice.toFixed(5)} (${confidence}% confidence)`;
      } else {
        executionMessage = `${intent.symbol} ${intent.direction} executed at ${entryPrice.toFixed(5)} (${confidence}% marginal setup with confirmation)`;
      }

      await supabase.from('notifications').insert({
        user_id: session.user_id,
        type: 'entry_executed',
        title: 'Entry Executed',
        message: executionMessage,
        metadata: {
          intent_id: intent.id,
          session_id: intent.session_id,
          symbol: intent.symbol,
          entry_price: entryPrice,
          intent_type: intent.intent_type,
          trade_id: result.tradeId,
          confidence
        }
      });
    }
  }

  private async handleTimeout(intent: EntryIntent): Promise<void> {
    const marketContext = intent.market_context as any;
    const confidence = marketContext?.confidence || 60;

    logger.info(
      `Intent ${intent.id} timed out after ${intent.timeout_minutes} minutes ` +
      `(${confidence}% confidence, ${intent.intent_type})`
    );

    await EntryPlannerService.updateIntentStatus(
      intent.id,
      'timeout',
      `Entry conditions not met within ${intent.timeout_minutes} minute(s)`
    );

    const { data: session } = await supabase
      .from('goal_sessions')
      .select('user_id')
      .eq('id', intent.session_id)
      .single();

    if (session) {
      // Confidence-aware timeout messages
      let timeoutMessage: string;
      if (confidence >= 70) {
        timeoutMessage = `${intent.symbol} precision entry window closed (${confidence}% confidence setup didn't develop)`;
      } else if (confidence >= 60) {
        timeoutMessage = `${intent.symbol} entry conditions not confirmed within ${intent.timeout_minutes}min`;
      } else {
        timeoutMessage = `${intent.symbol} marginal setup didn't meet strict confirmation requirements`;
      }

      await supabase.from('notifications').insert({
        user_id: session.user_id,
        type: 'entry_timeout',
        title: 'Entry Window Expired',
        message: timeoutMessage,
        metadata: {
          intent_id: intent.id,
          session_id: intent.session_id,
          symbol: intent.symbol,
          intent_type: intent.intent_type,
          urgency: intent.urgency,
          timeout_minutes: intent.timeout_minutes,
          confidence
        }
      });
    }
  }

  private async handleCancel(intent: EntryIntent, reason: string): Promise<void> {
    logger.info(`Canceling intent ${intent.id}: ${reason}`);

    await EntryPlannerService.updateIntentStatus(intent.id, 'conditions_changed', reason);

    const { data: session } = await supabase
      .from('goal_sessions')
      .select('user_id')
      .eq('id', intent.session_id)
      .single();

    if (session) {
      await supabase.from('notifications').insert({
        user_id: session.user_id,
        type: 'entry_canceled',
        title: 'Entry Canceled',
        message: `${intent.symbol} entry canceled: ${reason}`,
        metadata: {
          intent_id: intent.id,
          session_id: intent.session_id,
          symbol: intent.symbol,
          reason
        }
      });
    }
  }

  private async notifyUserIfNeeded(
    intentId: string,
    userId: string,
    message: string,
    currentPrice: number,
    distanceToPips: number
  ): Promise<void> {
    // Messages already shown in FloatingMessageCenter - no need for duplicate toasts
  }

  private async getCurrentPrice(symbol: string): Promise<number | null> {
    try {
      const { data, error } = await supabase
        .from('realtime_prices')
        .select('bid, ask, created_at')
        .eq('symbol', symbol)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      // CRITICAL: Validate price freshness to avoid executing on stale data
      const priceAge = Date.now() - new Date(data.created_at).getTime();
      const maxAgeMs = 30000; // 30 seconds max

      if (priceAge > maxAgeMs) {
        logger.warn(
          `Price data is stale for ${symbol}: ${(priceAge / 1000).toFixed(0)}s old ` +
          `(max ${maxAgeMs / 1000}s). Skipping validation check.`
        );
        return null;
      }

      if (priceAge > 10000) {
        logger.debug(`Price data age: ${(priceAge / 1000).toFixed(0)}s for ${symbol}`);
      }

      return (data.bid + data.ask) / 2;
    } catch (error) {
      logger.error('Error fetching current price:', error);
      return null;
    }
  }

  private async getCandleData(symbol: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', normalizeTimeframeToDb('5m'))
        .order('open_time', { ascending: false })
        .limit(10);

      if (error || !data) {
        return { candles: [] };
      }

      return {
        candles: data,
        currentCandle: data[0]
      };
    } catch (error) {
      logger.error('Error fetching candle data:', error);
      return { candles: [] };
    }
  }

  private async getMarketConditions(symbol: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', normalizeTimeframeToDb('15m'))
        .order('open_time', { ascending: false })
        .limit(20);

      if (error || !data || data.length === 0) {
        return {};
      }

      const closes = data.map(c => c.close);
      const volumes = data.map(c => c.volume);
      const vwap = this.calculateVWAP(data);

      return {
        vwap,
        atr: this.calculateATR(data),
        avgVolume: volumes.reduce((a, b) => a + b, 0) / volumes.length
      };
    } catch (error) {
      logger.error('Error fetching market conditions:', error);
      return {};
    }
  }

  private calculateVWAP(candles: any[]): number {
    let sumPV = 0;
    let sumV = 0;

    for (const candle of candles) {
      const typical = (candle.high + candle.low + candle.close) / 3;
      sumPV += typical * candle.volume;
      sumV += candle.volume;
    }

    return sumV > 0 ? sumPV / sumV : 0;
  }

  private calculateATR(candles: any[]): number {
    if (candles.length < 2) return 0;

    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trs.push(tr);
    }

    return trs.reduce((a, b) => a + b, 0) / trs.length;
  }

  private calculateDistanceToZone(price: number, intent: EntryIntent): number {
    if (price >= intent.entry_zone_min && price <= intent.entry_zone_max) {
      return 0;
    }

    const closestEdge = price < intent.entry_zone_min ? intent.entry_zone_min : intent.entry_zone_max;
    return calculatePipDistance(intent.symbol, price, closestEdge);
  }

  private validateSetupStillValid(intent: EntryIntent, currentPrice: number): boolean {
    const invalidationPrice = (intent as any).invalidation_price;
    const marketContext = intent.market_context as any;
    const stopLoss = invalidationPrice || marketContext?.stop_loss;

    if (!stopLoss) {
      return true;
    }

    if (intent.direction === 'long') {
      if (currentPrice <= stopLoss) {
        logger.warn(`Setup invalidated: Long entry but price ${currentPrice.toFixed(5)} <= SL ${stopLoss.toFixed(5)}`);
        return false;
      }
    } else {
      if (currentPrice >= stopLoss) {
        logger.warn(`Setup invalidated: Short entry but price ${currentPrice.toFixed(5)} >= SL ${stopLoss.toFixed(5)}`);
        return false;
      }
    }

    const distanceToZonePips = this.calculateDistanceToZone(currentPrice, intent);
    const MAX_CHASE_PIPS = 15;

    if (Math.abs(distanceToZonePips) > MAX_CHASE_PIPS) {
      logger.warn(`Setup invalidated: Price ${distanceToZonePips.toFixed(1)} pips from zone (max chase: ${MAX_CHASE_PIPS})`);
      return false;
    }

    return true;
  }

  private async logMonitoring(
    intentId: string,
    currentPrice: number,
    distanceToPips: number,
    conditionsMet: any,
    message: string
  ): Promise<void> {
    try {
      const { data: intentExists } = await supabase
        .from('entry_intents')
        .select('id')
        .eq('id', intentId)
        .maybeSingle();

      if (!intentExists) {
        logger.warn(`Skipping log for non-existent intent ${intentId}`);
        return;
      }

      const payload = {
        intent_id: intentId,
        current_price: currentPrice,
        distance_to_zone_pips: distanceToPips,
        conditions_met: conditionsMet || {},
        message: message || 'Monitoring...'
      };

      const { error } = await supabase.from('entry_monitoring_logs').insert(payload);

      if (error) {
        logger.error('Supabase error logging monitoring update:', {
          error,
          payload,
          errorDetails: JSON.stringify(error)
        });
      }
    } catch (error) {
      logger.error('Exception logging monitoring update:', error);
    }
  }

  async resumeAllActiveIntents(userId: string): Promise<void> {
    if (this.resumeInProgress) {
      logger.debug('Resume already in progress, skipping duplicate call');
      return;
    }

    this.resumeInProgress = true;

    try {
      const intents = await EntryPlannerService.getActiveIntents(userId);

      if (intents.length === 0) {
        logger.debug('No active intents to resume');
        return;
      }

      const validIntents = intents.filter(intent => intent.status === 'monitoring');

      for (const intent of validIntents) {
        if (!this.monitoringIntervals.has(intent.id)) {
          await this.startMonitoring(intent.id, userId);
        } else {
          logger.debug(`Already monitoring intent ${intent.id}`);
        }
      }

      logger.info(`Resumed monitoring for ${validIntents.length} active intents`);
    } catch (error) {
      logger.error('Error resuming active intents:', error);
    } finally {
      this.resumeInProgress = false;
    }
  }

  /**
   * Convert EQS score to letter grade
   */
  private getEQSGrade(score: number): string {
    if (score >= 80) return 'A+';
    if (score >= 72) return 'A';
    if (score >= 65) return 'B';
    if (score >= 50) return 'C';
    return 'D';
  }
}

export const activeEntryMonitor = ActiveEntryMonitor.getInstance();
