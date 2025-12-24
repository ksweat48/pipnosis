import { supabase } from '../lib/supabase';
import { EntryPlannerService } from './entry-planner';
import type { EntryIntent, EntryMonitoringLog } from '../types/entry';
import { logger } from '../lib/logger';
import { globalToastManager } from './global-toast-manager';

export class ActiveEntryMonitor {
  private static instance: ActiveEntryMonitor;
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  private lastNotificationTime: Map<string, number> = new Map();
  private readonly POLL_INTERVAL = 5000;
  private readonly NOTIFICATION_INTERVAL = 120000;

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
        .single();

      if (error || !intent) {
        logger.error(`Failed to fetch intent ${intentId}:`, error);
        await this.stopMonitoring(intentId);
        return;
      }

      if (intent.status !== 'monitoring') {
        await this.stopMonitoring(intentId);
        return;
      }

      if (new Date(intent.timeout_at) < new Date()) {
        await this.handleTimeout(intent);
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

      await this.logMonitoring(intentId, currentPrice, distanceToPips, validation.conditions_met, validation.message);

      if (validation.should_execute) {
        await this.handleExecution(intent, currentPrice, validation.message);
        await this.stopMonitoring(intentId);
      } else if (validation.should_cancel) {
        await this.handleCancel(intent, validation.cancel_reason || 'Conditions changed');
        await this.stopMonitoring(intentId);
      } else if (validation.should_wait) {
        await this.notifyUserIfNeeded(intentId, userId, validation.message, currentPrice, distanceToPips);
      }
    } catch (error) {
      logger.error(`Error checking intent ${intentId}:`, error);
    }
  }

  private async handleExecution(intent: EntryIntent, entryPrice: number, message: string): Promise<void> {
    logger.info(`Executing entry for intent ${intent.id} at ${entryPrice}`);

    await EntryPlannerService.updateIntentStatus(intent.id, 'executed', undefined, entryPrice);

    globalToastManager.success(message);

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
      await supabase.from('notifications').insert({
        user_id: session.user_id,
        type: 'entry_executed',
        title: 'Entry Executed',
        message: `${intent.symbol} ${intent.direction} entry executed at ${entryPrice.toFixed(5)}`,
        metadata: {
          intent_id: intent.id,
          session_id: intent.session_id,
          symbol: intent.symbol,
          entry_price: entryPrice,
          intent_type: intent.intent_type,
          trade_id: result.tradeId
        }
      });
    }
  }

  private async handleTimeout(intent: EntryIntent): Promise<void> {
    logger.info(`Intent ${intent.id} timed out`);

    await EntryPlannerService.updateIntentStatus(
      intent.id,
      'timeout',
      'Entry conditions not met within timeout window'
    );

    globalToastManager.info(`Entry window expired for ${intent.symbol}. Continuing scan.`);

    const { data: session } = await supabase
      .from('goal_sessions')
      .select('user_id')
      .eq('id', intent.session_id)
      .single();

    if (session) {
      await supabase.from('notifications').insert({
        user_id: session.user_id,
        type: 'entry_timeout',
        title: 'Entry Window Expired',
        message: `${intent.symbol} entry conditions not met within ${intent.timeout_minutes} minutes`,
        metadata: {
          intent_id: intent.id,
          session_id: intent.session_id,
          symbol: intent.symbol,
          intent_type: intent.intent_type
        }
      });
    }
  }

  private async handleCancel(intent: EntryIntent, reason: string): Promise<void> {
    logger.info(`Canceling intent ${intent.id}: ${reason}`);

    await EntryPlannerService.updateIntentStatus(intent.id, 'conditions_changed', reason);

    globalToastManager.warning(`Entry canceled for ${intent.symbol}: ${reason}`);

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
    const lastNotification = this.lastNotificationTime.get(intentId) || 0;
    const now = Date.now();

    if (now - lastNotification >= this.NOTIFICATION_INTERVAL) {
      globalToastManager.info(message);
      this.lastNotificationTime.set(intentId, now);
    }
  }

  private async getCurrentPrice(symbol: string): Promise<number | null> {
    try {
      const { data, error } = await supabase
        .from('realtime_prices')
        .select('bid, ask')
        .eq('symbol', symbol)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return (data.bid + data.ask) / 2;
    } catch (error) {
      logger.error('Error fetching current price:', error);
      return null;
    }
  }

  private async getCandleData(symbol: string): Promise<any> {
    try {
      // CRITICAL FIX: Use forex_candles table, not candle_cache (which doesn't exist)
      const { data, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', '5m')
        .order('timestamp', { ascending: false })
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
      // CRITICAL FIX: Use forex_candles table, not candle_cache (which doesn't exist)
      const { data, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', '15m')
        .order('timestamp', { ascending: false })
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

    const distanceToMin = (price - intent.entry_zone_min) * 10000;
    const distanceToMax = (price - intent.entry_zone_max) * 10000;

    return Math.abs(distanceToMin) < Math.abs(distanceToMax) ? distanceToMin : distanceToMax;
  }

  private async logMonitoring(
    intentId: string,
    currentPrice: number,
    distanceToPips: number,
    conditionsMet: any,
    message: string
  ): Promise<void> {
    try {
      await supabase.from('entry_monitoring_logs').insert({
        intent_id: intentId,
        current_price: currentPrice,
        distance_to_zone_pips: distanceToPips,
        conditions_met: conditionsMet,
        message
      });
    } catch (error) {
      logger.error('Error logging monitoring update:', error);
    }
  }

  async resumeAllActiveIntents(userId: string): Promise<void> {
    const intents = await EntryPlannerService.getActiveIntents(userId);

    for (const intent of intents) {
      await this.startMonitoring(intent.id, userId);
    }

    if (intents.length > 0) {
      logger.info(`Resumed monitoring for ${intents.length} active intents`);
    }
  }
}

export const activeEntryMonitor = ActiveEntryMonitor.getInstance();
