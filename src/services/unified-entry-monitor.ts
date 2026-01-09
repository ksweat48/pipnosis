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

export interface MonitoringCallbacks {
  onExecute?: (intentId: string, price: number, eqs: number) => Promise<void>;
  onAbandon?: (intentId: string, reason: string) => Promise<void>;
  onTimeout?: (intentId: string) => Promise<void>;
}

export class UnifiedEntryMonitor {
  private static instance: UnifiedEntryMonitor;
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  private lastNotificationTime: Map<string, number> = new Map();
  private lastEQSScores: Map<string, number> = new Map();
  private callbacks: Map<string, MonitoringCallbacks> = new Map();

  private constructor() {}

  static getInstance(): UnifiedEntryMonitor {
    if (!UnifiedEntryMonitor.instance) {
      UnifiedEntryMonitor.instance = new UnifiedEntryMonitor();
    }
    return UnifiedEntryMonitor.instance;
  }

  async startMonitoring(intentId: string, userId: string, callbacks?: MonitoringCallbacks): Promise<void> {
    console.log('%c[UnifiedMonitor] 🎬 startMonitoring called', 'color: #2196f3; font-weight: bold', {
      intentId,
      userId,
      alreadyMonitoring: this.monitoringIntervals.has(intentId)
    });

    if (this.monitoringIntervals.has(intentId)) {
      logger.info(`[UnifiedMonitor] Already monitoring intent ${intentId}`);
      console.log('[UnifiedMonitor] ⚠️ Already monitoring this intent - skipping');
      return;
    }

    const intent = await this.getIntent(intentId);
    if (!intent) {
      logger.warn(`[UnifiedMonitor] Intent ${intentId} not found`);
      console.error('[UnifiedMonitor] ❌ Intent not found in database');
      return;
    }

    const styleConfig = tradeStyleRegistry.getConfig(intent.style || 'MICRO_INTRADAY');
    console.log('%c[UnifiedMonitor] ✅ Starting monitoring', 'color: #4caf50; font-weight: bold', {
      intentId,
      symbol: intent.symbol,
      direction: intent.direction,
      style: styleConfig.canonical,
      pollIntervalMs: styleConfig.pollIntervalMs,
      eqsThreshold: styleConfig.eqsThreshold,
      hasCallbacks: !!callbacks
    });
    logger.info(`[UnifiedMonitor] Starting monitoring for ${intentId} (${styleConfig.canonical})`);

    // Store callbacks for this intent
    if (callbacks) {
      this.callbacks.set(intentId, callbacks);
    }

    const interval = setInterval(async () => {
      await this.checkIntent(intentId, userId, styleConfig.canonical);
    }, styleConfig.pollIntervalMs);

    this.monitoringIntervals.set(intentId, interval);
    console.log('[UnifiedMonitor] ⏰ Interval set, running first check immediately...');
    await this.checkIntent(intentId, userId, styleConfig.canonical);
  }

  async stopMonitoring(intentId: string): Promise<void> {
    const interval = this.monitoringIntervals.get(intentId);
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(intentId);
      this.lastNotificationTime.delete(intentId);
      this.lastEQSScores.delete(intentId);
      this.callbacks.delete(intentId);
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
    this.callbacks.clear();
    logger.info('[UnifiedMonitor] Stopped all monitoring');
  }

  private async checkIntent(intentId: string, userId: string, style: string): Promise<void> {
    const checkStartTime = Date.now();
    console.log('%c[UnifiedMonitor] 🔄 checkIntent running', 'color: #00bcd4; font-weight: bold', {
      intentId: intentId.substring(0, 8) + '...',
      style,
      timestamp: new Date().toLocaleTimeString()
    });

    try {
      const intent = await this.getIntent(intentId);
      if (!intent || intent.status !== 'monitoring') {
        console.log('[UnifiedMonitor] ⚠️ Intent no longer monitoring, stopping', {
          found: !!intent,
          status: intent?.status
        });
        logger.info(`[UnifiedMonitor] Intent ${intentId} is not in monitoring status, stopping`);
        await this.stopMonitoring(intentId);
        return;
      }

      // Check for timeout expiration
      if (intent.timeout_at) {
        const timeoutAt = new Date(intent.timeout_at);
        const now = new Date();
        if (now >= timeoutAt) {
          console.log('%c[UnifiedMonitor] ⏰ TIMEOUT EXCEEDED', 'color: #ff5722; font-weight: bold', {
            intentId,
            timeoutAt: timeoutAt.toISOString(),
            now: now.toISOString()
          });
          logger.info(`[UnifiedMonitor] Intent ${intentId} has exceeded timeout, abandoning`);

          // Call abandon callback if registered
          const callbacks = this.callbacks.get(intentId);
          if (callbacks?.onAbandon) {
            await callbacks.onAbandon(intentId, 'TIMEOUT_EXCEEDED');
          }

          await this.stopMonitoring(intentId);
          return;
        }
      }

      // Verify intent has a valid session ID
      if (!intent.session_id) {
        logger.warn(`[UnifiedMonitor] Intent ${intentId} has no session_id, stopping monitoring`);
        await this.stopMonitoring(intentId);
        return;
      }

      // Verify session is still active
      const { data: session } = await supabase
        .from('goal_sessions')
        .select('status')
        .eq('id', intent.session_id)
        .maybeSingle();

      if (!session || session.status !== 'active') {
        logger.info(`[UnifiedMonitor] Session ${intent.session_id} is not active, stopping monitoring for intent ${intentId}`);
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
        m5Candles: candlesForIndicators.slice(-10), // Use LAST 10 candles for pattern analysis
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

      // Check if price is in entry zone
      const inEntryZone = priceData.price >= intent.entry_zone_min && priceData.price <= intent.entry_zone_max;
      const distanceToZone = inEntryZone
        ? 0
        : priceData.price < intent.entry_zone_min
        ? intent.entry_zone_min - priceData.price
        : priceData.price - intent.entry_zone_max;

      console.log('%c[UnifiedMonitor] 📊 Entry Quality Check:', 'color: #2196f3; font-weight: bold; font-size: 14px', {
        symbol: intent.symbol,
        currentPrice: priceData.price.toFixed(5),
        entryZone: `${intent.entry_zone_min.toFixed(5)} - ${intent.entry_zone_max.toFixed(5)}`,
        inZone: inEntryZone,
        distanceToZone: distanceToZone.toFixed(5),
        eqsScore: currentEQS,
        eqsThreshold: styleConfig.eqsThreshold,
        eqsGrade: eqsResult.eqsGrade,
        status: eqsResult.status,
        meetsThreshold: currentEQS >= styleConfig.eqsThreshold
      });

      logger.info(
        `[UnifiedMonitor] ${intent.symbol} EQS: ${currentEQS}/100 ` +
        `(threshold: ${styleConfig.eqsThreshold}), Grade: ${eqsResult.eqsGrade}, ` +
        `In Zone: ${inEntryZone}, Status: ${eqsResult.status}`
      );

      // Log detailed breakdown for debugging
      console.log('%c[UnifiedMonitor] 📈 EQS Breakdown:', 'color: #9c27b0; font-weight: bold', {
        candle: `${eqsResult.eqsBreakdown.candleAcceptance}/20`,
        pullback: `${eqsResult.eqsBreakdown.pullbackQuality}/15`,
        vwap: `${eqsResult.eqsBreakdown.vwapInteraction}/15`,
        ema: `${eqsResult.eqsBreakdown.emaAlignment}/10`,
        liquidity: `${eqsResult.eqsBreakdown.liquidityReaction}/15`,
        total: `${currentEQS}/100`
      });

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
          .eq('id', intent.session_id)
          .maybeSingle();

        if (session) {
          await entryMonitoringNotifications.sendEQSProgress({
            userId,
            sessionId: intent.session_id,
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

      // Professional Entry Zone Logic - Enforces Discipline
      const { ALPHA_IDENTITY } = await import('../config/alpha-identity');
      const eqsMeetsThreshold = currentEQS >= styleConfig.eqsThreshold;
      const statusReady = eqsResult.status === 'EXECUTE_NOW';

      // Calculate zone width and near-zone distance
      const zoneWidth = intent.entry_zone_max - intent.entry_zone_min;
      const nearZoneThreshold = Math.min(0.25 * marketConditions.atr, 0.4 * zoneWidth);
      const isNearZone = !inEntryZone && distanceToZone <= nearZoneThreshold;

      // Check for exceptional override eligibility
      const hasExceptionalQuality = currentEQS >= ALPHA_IDENTITY.EQS_EXCEPTIONAL_OVERRIDE_THRESHOLD;
      const hasMarketAcceptance = eqsResult.eqsBreakdown.candleAcceptance >= 16; // 80% of 20pts
      const canOverrideZone = isNearZone && hasExceptionalQuality && hasMarketAcceptance;

      // DEFAULT RULE (90-95% of cases): Must be IN zone
      let shouldExecute = false;
      let executionReason = '';

      if (statusReady && eqsMeetsThreshold && inEntryZone) {
        shouldExecute = true;
        executionReason = '✅ ALL CONDITIONS MET - IN ENTRY ZONE';
      } else if (statusReady && eqsMeetsThreshold && canOverrideZone) {
        shouldExecute = true;
        executionReason = `⚡ EXCEPTIONAL OVERRIDE - Near zone (${distanceToZone.toFixed(5)}) with EQS ${currentEQS}`;
      } else if (!inEntryZone && !isNearZone) {
        executionReason = `❌ OUTSIDE ENTRY ZONE - Distance: ${distanceToZone.toFixed(5)}`;
      } else if (!eqsMeetsThreshold) {
        executionReason = `❌ EQS ${currentEQS} BELOW THRESHOLD ${styleConfig.eqsThreshold}`;
      } else if (!statusReady) {
        executionReason = `❌ STATUS NOT READY - ${eqsResult.status}`;
      } else {
        executionReason = `❌ NEAR ZONE but quality insufficient - EQS ${currentEQS} (need ${ALPHA_IDENTITY.EQS_EXCEPTIONAL_OVERRIDE_THRESHOLD}+)`;
      }

      console.log('%c[UnifiedMonitor] 🎯 EXECUTION DECISION:', 'color: #ff5722; font-weight: bold; font-size: 16px', {
        shouldExecute,
        statusReady,
        eqsMeetsThreshold,
        eqsScore: currentEQS,
        threshold: styleConfig.eqsThreshold,
        inEntryZone,
        isNearZone,
        distanceToZone: distanceToZone.toFixed(5),
        nearZoneThreshold: nearZoneThreshold.toFixed(5),
        hasExceptionalQuality,
        canOverrideZone,
        reason: executionReason
      });

      if (shouldExecute) {
        console.log('%c[UnifiedMonitor] 🚀 EXECUTING TRADE NOW!', 'color: #4caf50; font-weight: bold; font-size: 18px', {
          symbol: intent.symbol,
          direction: intent.direction,
          entryPrice: priceData.price,
          eqsScore: currentEQS,
          reason: executionReason
        });
        await this.handleExecution(intent, priceData.price, currentEQS);
        await this.stopMonitoring(intentId);
      } else {
        console.log('%c[UnifiedMonitor] ⏳ Waiting for better conditions...', 'color: #ff9800; font-weight: bold', {
          reason: executionReason
        });
      }
    } catch (error) {
      logger.error(`[UnifiedMonitor] Error checking intent ${intentId}:`, error);
    }
  }

  /**
   * Get intent by ID - DELEGATES TO SSOT
   * Uses getEntryIntentById from entry-intent-monitor-mode.ts
   */
  private async getIntent(intentId: string): Promise<EntryIntent | null> {
    const { getEntryIntentById } = await import('./entry-intent-monitor-mode');
    return await getEntryIntentById(intentId) as EntryIntent | null;
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

      // Get current price for the required field
      const priceData = await marketDataService.getCurrentPrice(intent.symbol);
      if (!priceData) {
        logger.warn('[UnifiedMonitor] Cannot store EQS update without current price');
        return;
      }

      // Calculate distance to entry zone
      const distanceToZone = intent.entry_zone_min && intent.entry_zone_max
        ? priceData.price < intent.entry_zone_min
          ? intent.entry_zone_min - priceData.price
          : priceData.price > intent.entry_zone_max
          ? priceData.price - intent.entry_zone_max
          : 0
        : null;

      // Store as entry monitoring log with all required fields
      const { error } = await supabase.from('entry_monitoring_logs').insert({
        intent_id: intent.id,
        user_id: intent.user_id,
        symbol: intent.symbol,
        current_price: priceData.price,
        distance_to_zone_pips: distanceToZone,
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
        status: eqsResult.status,
        message: `EQS: ${currentEQS}/100 (${grade}) - ${eqsResult.status}`
      });

      if (error) {
        logger.error('[UnifiedMonitor] Database error storing EQS update:', error);
      }
    } catch (error) {
      logger.error('[UnifiedMonitor] Failed to store EQS update:', error);
    }
  }

  private async handleExecution(intent: EntryIntent, entryPrice: number, eqsScore: number): Promise<void> {
    console.log('%c[UnifiedMonitor] 🚀 STARTING TRADE EXECUTION', 'color: #4caf50; font-weight: bold; font-size: 16px', {
      intentId: intent.id,
      symbol: intent.symbol,
      direction: intent.direction,
      entryPrice,
      eqsScore
    });

    logger.info(`[UnifiedMonitor] Executing ${intent.id} at ${entryPrice} (EQS: ${eqsScore})`);

    try {
      // Check if there's a callback registered for this intent
      const callbacks = this.callbacks.get(intent.id);

      if (callbacks?.onExecute) {
        console.log('[UnifiedMonitor] 📞 Calling registered execution callback...');
        await callbacks.onExecute(intent.id, entryPrice, eqsScore);
        console.log('[UnifiedMonitor] ✅ Callback completed');
      } else {
        // Fallback: Direct execution
        console.log('[UnifiedMonitor] No callback registered, using direct execution path...');

        // Step 1: Update intent status to 'executed'
        console.log('[UnifiedMonitor] Step 1: Updating intent status to executed...');
        const { EntryPlannerService } = await import('./entry-planner');
        await EntryPlannerService.updateIntentStatus(intent.id, 'executed', undefined, entryPrice);
        console.log('[UnifiedMonitor] ✅ Intent status updated');

        // Step 2: Execute trade through coordinator
        console.log('[UnifiedMonitor] Step 2: Creating trade in database...');
        const { EntryExecutionCoordinator } = await import('./entry-execution-coordinator');
        const result = await EntryExecutionCoordinator.executeFromIntent(intent.id, entryPrice);

        if (result.success) {
          console.log('%c[UnifiedMonitor] ✅ TRADE EXECUTED SUCCESSFULLY!', 'color: #4caf50; font-weight: bold; font-size: 18px', {
            tradeId: result.tradeId,
            symbol: intent.symbol,
            direction: intent.direction,
            entryPrice,
            eqsScore
          });
          logger.info(`[UnifiedMonitor] Trade created: ${result.tradeId}`);
        } else {
          console.error('%c[UnifiedMonitor] ❌ TRADE EXECUTION FAILED', 'color: #f44336; font-weight: bold; font-size: 16px');
          logger.error('[UnifiedMonitor] Failed to create trade');
        }
      }
    } catch (error) {
      console.error('%c[UnifiedMonitor] ❌ ERROR DURING EXECUTION:', 'color: #f44336; font-weight: bold; font-size: 16px', error);
      logger.error('[UnifiedMonitor] Execution error:', error);
    }
  }
}

export const unifiedEntryMonitor = UnifiedEntryMonitor.getInstance();
