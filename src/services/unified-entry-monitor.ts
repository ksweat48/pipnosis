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
import { calculateEMA, calculateRSI } from '../utils/technicalIndicators';

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

      const candles = await marketDataService.getCandles(intent.symbol, '5m', 50); // Get more candles for indicators
      const marketConditions = await marketDataService.getMarketConditions(intent.symbol);

      if (!marketConditions) {
        logger.warn(`[UnifiedMonitor] No market conditions for ${intent.symbol}`);
        return;
      }

      // Calculate real EMA20 and RSI from candle data
      const candlesForIndicators = candles.slice(0, 50).map(c => ({
        time: c.open_time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      }));

      let ema20Value = priceData.price; // Fallback to current price
      let rsiValue = 50; // Fallback to neutral

      if (candlesForIndicators.length >= 20) {
        const ema20Results = calculateEMA(candlesForIndicators, 20);
        if (ema20Results.length > 0) {
          ema20Value = ema20Results[ema20Results.length - 1].value;
        }
      }

      if (candlesForIndicators.length >= 15) {
        const rsiResults = calculateRSI(candlesForIndicators, 14);
        if (rsiResults.length > 0) {
          rsiValue = rsiResults[rsiResults.length - 1].value;
        }
      }

      logger.info(
        `[UnifiedMonitor] Indicators for ${intent.symbol}: ` +
        `EMA20=${ema20Value.toFixed(5)}, RSI=${rsiValue.toFixed(1)}, ` +
        `Price=${priceData.price.toFixed(5)}, Candles=${candlesForIndicators.length}`
      );

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
        m5Candles: candlesForIndicators.slice(0, 10), // Use last 10 for pattern analysis
        m5VWAP: marketConditions.vwap,
        m5EMA20: ema20Value,
        m5RSI: rsiValue,
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

      // Store EQS update in database for UI display
      await this.storeEQSUpdate(intent, eqsResult, currentEQS, styleConfig.eqsThreshold);

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

  private async storeEQSUpdate(
    intent: EntryIntent,
    eqsResult: any,
    currentEQS: number,
    threshold: number
  ): Promise<void> {
    try {
      const breakdown = eqsResult.eqsBreakdown;
      const grade = calculateEQSGrade(currentEQS);

      // Store as entry monitoring log
      await supabase.from('entry_monitoring_logs').insert({
        intent_id: intent.id,
        user_id: intent.user_id,
        symbol: intent.symbol,
        eqs_score: currentEQS,
        eqs_grade: grade,
        eqs_threshold: threshold,
        breakdown: {
          candleAcceptance: breakdown.candleAcceptance,
          pullbackQuality: breakdown.pullbackQuality,
          vwapInteraction: breakdown.vwapInteraction,
          emaAlignment: breakdown.emaAlignment,
          liquidityReaction: breakdown.liquidityReaction,
          compressionExpansion: breakdown.compressionExpansion,
          failedMoveConfirmation: breakdown.failedMoveConfirmation,
          timeframeAlignment: breakdown.timeframeAlignment
        },
        status: eqsResult.status
      });
    } catch (error) {
      logger.error('[UnifiedMonitor] Failed to store EQS update:', error);
    }
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
