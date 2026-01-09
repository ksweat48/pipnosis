/**
 * Unified Entry Monitor - SINGLE SOURCE OF TRUTH
 *
 * Central authority for entry monitoring.
 * Delegates to:
 * - MarketDataService for prices/candles
 * - TradeStyleRegistry for style configs
 * - EntryQualificationEngine for EQS scoring
 *
 * This is the ONLY entry monitor. All other monitors delegate here.
 */

import { supabase } from '../lib/supabase';
import { marketDataService } from './market-data-service';
import { tradeStyleRegistry } from './trade-style-registry';
import { entryQualificationEngine } from './entry-qualification-engine';
import { logger } from '../lib/logger';
import type { EntryIntent } from '../types/entry';
import type { EntryQualificationInput } from './entry-qualification-engine';
import { entryMonitoringNotifications } from './entry-monitoring-notifications';
import { calculateEQSGrade, didGradeImprove } from '../utils/eqsHelpers';

export class UnifiedEntryMonitor {
  private static instance: UnifiedEntryMonitor;
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  private lastNotificationTime: Map<string, number> = new Map();
  private lastEQSScores: Map<string, number> = new Map();

  private constructor() {}

  static getInstance(): UnifiedEntryMonitor {
    if (!UnifiedEntryMonitor.instance) {
      UnifiedEntryMonitor.instance = new UnifiedEntryMonitor();
    }
    return UnifiedEntryMonitor.instance;
  }

  async startMonitoring(intentId: string, userId: string): Promise<void> {
    if (this.monitoringIntervals.has(intentId)) {
      logger.info(`[UnifiedMonitor] Already monitoring intent ${intentId}`);
      return;
    }

    const intent = await this.getIntent(intentId);
    if (!intent) {
      logger.warn(`[UnifiedMonitor] Intent ${intentId} not found`);
      return;
    }

    const styleConfig = tradeStyleRegistry.getConfig(intent.style || 'MICRO_INTRADAY');
    logger.info(`[UnifiedMonitor] Starting monitoring for ${intentId} (${styleConfig.canonical})`);

    const interval = setInterval(async () => {
      await this.checkIntent(intentId, userId, styleConfig.canonical);
    }, styleConfig.pollIntervalMs);

    this.monitoringIntervals.set(intentId, interval);
    await this.checkIntent(intentId, userId, styleConfig.canonical);
  }

  async stopMonitoring(intentId: string): Promise<void> {
    const interval = this.monitoringIntervals.get(intentId);
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(intentId);
      this.lastNotificationTime.delete(intentId);
      this.lastEQSScores.delete(intentId);
      logger.info(`[UnifiedMonitor] Stopped monitoring ${intentId}`);
    }
  }

  stopAllMonitoring(): void {
    for (const [intentId, interval] of this.monitoringIntervals) {
      clearInterval(interval);
    }
    this.monitoringIntervals.clear();
    this.lastNotificationTime.clear();
    this.lastEQSScores.clear();
    logger.info('[UnifiedMonitor] Stopped all monitoring');
  }

  private async checkIntent(intentId: string, userId: string, style: string): Promise<void> {
    try {
      const intent = await this.getIntent(intentId);
      if (!intent || intent.status !== 'monitoring') {
        await this.stopMonitoring(intentId);
        return;
      }

      const priceData = await marketDataService.getCurrentPrice(intent.symbol);
      if (!priceData || priceData.freshness === 'invalid') {
        logger.warn(`[UnifiedMonitor] Invalid price data for ${intent.symbol}`);
        return;
      }

      const candles = await marketDataService.getCandles(intent.symbol, '5m', 10);
      const marketConditions = await marketDataService.getMarketConditions(intent.symbol);

      if (!marketConditions) {
        logger.warn(`[UnifiedMonitor] No market conditions for ${intent.symbol}`);
        return;
      }

      const marketContext = intent.market_context as any;
      const confidence = marketContext?.confidence || 60;
      const stopLoss = marketContext?.stop_loss || 0;
      const takeProfit = marketContext?.take_profit || 0;

      const qualificationInput: EntryQualificationInput = {
        symbol: intent.symbol,
        direction: intent.direction === 'long' ? 'BUY' : 'SELL',
        entryPrice: priceData.price,
        stopLoss,
        takeProfit,
        confidence,
        m5Candles: candles.slice(0, 10).map(c => ({
          time: c.open_time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume
        })),
        m5VWAP: marketConditions.vwap,
        m5EMA20: priceData.price,
        m5RSI: 50,
        m5VolumeAvg20: marketConditions.avgVolume,
        m15Trend: 'sideways',
        m15SupportResistance: {},
        currentSpreadPips: 0.5,
        averageSpreadPips: 0.5,
        atr: marketConditions.atr
      };

      const eqsResult = entryQualificationEngine.evaluate(qualificationInput);
      const styleConfig = tradeStyleRegistry.getConfig(style);
      const currentEQS = eqsResult.eqsBreakdown.totalScore;

      logger.info(
        `[UnifiedMonitor] ${intent.symbol} EQS: ${currentEQS}/100 ` +
        `(threshold: ${styleConfig.eqsThreshold})`
      );

      // Track EQS progression and send notification on grade improvement
      const lastEQS = this.lastEQSScores.get(intentId);
      if (lastEQS !== undefined && didGradeImprove(lastEQS, currentEQS)) {
        const oldGrade = calculateEQSGrade(lastEQS);
        const newGrade = calculateEQSGrade(currentEQS);
        const requiredGrade = calculateEQSGrade(styleConfig.eqsThreshold);

        const inEntryZone = priceData.price >= intent.entry_zone_min && priceData.price <= intent.entry_zone_max;

        const { data: session } = await supabase
          .from('goal_sessions')
          .select('id')
          .eq('id', intent.goal_session_id)
          .maybeSingle();

        if (session) {
          await entryMonitoringNotifications.sendEQSProgress({
            userId,
            sessionId: intent.goal_session_id,
            intentId,
            symbol: intent.symbol,
            direction: intent.direction === 'long' ? 'BUY' : 'SELL',
            oldEQS: lastEQS,
            newEQS: currentEQS,
            oldGrade,
            newGrade,
            requiredEQS: styleConfig.eqsThreshold,
            requiredGrade,
            currentPrice: priceData.price,
            inEntryZone
          });
        }
      }

      this.lastEQSScores.set(intentId, currentEQS);

      if (eqsResult.status === 'EXECUTE_NOW' && currentEQS >= styleConfig.eqsThreshold) {
        await this.handleExecution(intent, priceData.price, currentEQS);
        await this.stopMonitoring(intentId);
      }
    } catch (error) {
      logger.error(`[UnifiedMonitor] Error checking intent ${intentId}:`, error);
    }
  }

  private async getIntent(intentId: string): Promise<EntryIntent | null> {
    const { data, error } = await supabase
      .from('entry_intents')
      .select('*')
      .eq('id', intentId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return data as EntryIntent;
  }

  private async handleExecution(intent: EntryIntent, entryPrice: number, eqsScore: number): Promise<void> {
    logger.info(`[UnifiedMonitor] Executing ${intent.id} at ${entryPrice} (EQS: ${eqsScore})`);

    const { EntryPlannerService } = await import('./entry-planner');
    await EntryPlannerService.updateIntentStatus(intent.id, 'executed', undefined, entryPrice);

    const { EntryExecutionCoordinator } = await import('./entry-execution-coordinator');
    const result = await EntryExecutionCoordinator.executeFromIntent(intent.id, entryPrice);

    if (result.success) {
      logger.info(`[UnifiedMonitor] Trade created: ${result.tradeId}`);
    } else {
      logger.error('[UnifiedMonitor] Failed to create trade');
    }
  }
}

export const unifiedEntryMonitor = UnifiedEntryMonitor.getInstance();
