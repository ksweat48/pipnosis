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
import { getEntryIntentById, type AbandonReason } from './entry-intent-monitor-mode';
import { EntryPlannerService } from './entry-planner';
import { EntryExecutionCoordinator } from './entry-execution-coordinator';
import { ALPHA_IDENTITY } from '../config/alpha-identity';

/**
 * Timeout wrapper for async operations
 * Prevents indefinite hangs in monitoring hot paths
 */
function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation '${operation}' timed out after ${ms}ms`)), ms)
    )
  ]);
}

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
  private lastCheckTimestamp: Map<string, number> = new Map(); // Health monitoring
  private healthCheckInterval: NodeJS.Timeout | null = null;

  private constructor() {
    // Start interval health monitoring
    this.startHealthMonitoring();
  }

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

  async stopMonitoring(intentId: string, reason?: AbandonReason): Promise<void> {
    const interval = this.monitoringIntervals.get(intentId);
    if (interval) {
      // If a reason is provided, invoke onAbandon callback before cleanup
      if (reason) {
        const callbacks = this.callbacks.get(intentId);
        if (callbacks?.onAbandon) {
          console.log(`[UnifiedMonitor] 🛑 Invoking onAbandon callback`, { intentId: intentId.substring(0, 8), reason });
          try {
            await callbacks.onAbandon(intentId, reason);
          } catch (error) {
            console.error(`[UnifiedMonitor] ❌ Error invoking onAbandon callback:`, error);
          }
        }
      }

      // Now cleanup resources
      clearInterval(interval);
      this.monitoringIntervals.delete(intentId);
      this.lastNotificationTime.delete(intentId);
      this.lastEQSScores.delete(intentId);
      this.callbacks.delete(intentId);
      this.lastCheckTimestamp.delete(intentId);
      console.log(`[UnifiedMonitor] Stopped monitoring ${intentId}`, reason ? `(reason: ${reason})` : '');
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
    this.lastCheckTimestamp.clear();
    logger.info('[UnifiedMonitor] Stopped all monitoring');
  }

  /**
   * Health monitoring - detects silent failures and auto-recovers
   * Runs every 10 seconds to check monitoring health
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      const now = Date.now();

      for (const [intentId, lastCheck] of this.lastCheckTimestamp.entries()) {
        const secondsSinceLastCheck = (now - lastCheck) / 1000;

        if (secondsSinceLastCheck > 15 && secondsSinceLastCheck < 30) {
          console.warn(
            '%c[UnifiedMonitor] ⚠️ HEALTH WARNING',
            'color: #ff9800; font-weight: bold',
            {
              intentId: intentId.substring(0, 8) + '...',
              secondsSinceLastCheck: Math.floor(secondsSinceLastCheck),
              message: 'No check in 15+ seconds - monitoring may be stalled'
            }
          );
        } else if (secondsSinceLastCheck >= 30) {
          console.error(
            '%c[UnifiedMonitor] 🚨 HEALTH CRITICAL',
            'color: #f44336; font-weight: bold',
            {
              intentId: intentId.substring(0, 8) + '...',
              secondsSinceLastCheck: Math.floor(secondsSinceLastCheck),
              message: 'No check in 30+ seconds - monitoring has failed'
            }
          );

          // Auto-recovery: Stop this monitoring to prevent deadlock
          logger.error(`[UnifiedMonitor] Auto-stopping deadlocked monitor ${intentId}`);
          this.stopMonitoring(intentId, 'MONITORING_STALLED');
        }
      }
    }, 10000); // Check every 10 seconds
  }

  private async checkIntent(intentId: string, userId: string, style: string): Promise<void> {
    const checkStartTime = Date.now();
    console.log('%c[UnifiedMonitor] 🔄 checkIntent running', 'color: #00bcd4; font-weight: bold', {
      intentId: intentId.substring(0, 8) + '...',
      style,
      timestamp: new Date().toLocaleTimeString()
    });

    // Update health monitoring timestamp at the start
    this.lastCheckTimestamp.set(intentId, checkStartTime);

    try {
      // Step 1: Fetch intent with timeout protection
      console.log('[UnifiedMonitor] Step 1/8: Fetching intent...');
      let intent: EntryIntent | null = null;
      try {
        intent = await withTimeout(
          this.getIntent(intentId),
          5000,
          'Fetch intent from database'
        );
        console.log('[UnifiedMonitor] ✓ Intent fetched');
      } catch (error) {
        logger.error(`[UnifiedMonitor] Failed to fetch intent ${intentId}:`, error);
        console.error('[UnifiedMonitor] ❌ Intent fetch failed, skipping this check');
        return;
      }

      if (!intent || intent.status !== 'monitoring') {
        console.log('%c[UnifiedMonitor] ⚠️ INTENT INVALID - No longer monitoring', 'color: #ff9800; font-weight: bold', {
          found: !!intent,
          status: intent?.status,
          intentId: intentId.substring(0, 8)
        });
        await this.stopMonitoring(intentId, 'INTENT_INVALID');
        return;
      }

      // Step 2: Check for timeout expiration
      console.log('[UnifiedMonitor] Step 2/8: Checking timeout...');
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

          const callbacks = this.callbacks.get(intentId);
          if (callbacks?.onAbandon) {
            await callbacks.onAbandon(intentId, 'TIMEOUT_EXCEEDED');
          }

          await this.stopMonitoring(intentId);
          return;
        }
      }
      console.log('[UnifiedMonitor] ✓ Timeout check passed');

      // Step 3: Verify session validity
      console.log('[UnifiedMonitor] Step 3/8: Validating session...');
      if (!intent.session_id) {
        console.log('%c[UnifiedMonitor] ⚠️ SESSION MISSING - No session_id on intent', 'color: #ff9800; font-weight: bold', {
          intentId: intentId.substring(0, 8)
        });
        await this.stopMonitoring(intentId, 'SESSION_MISSING');
        return;
      }

      let session: any = null;
      try {
        const { data } = await withTimeout(
          supabase
            .from('goal_sessions')
            .select('status')
            .eq('id', intent.session_id)
            .maybeSingle(),
          5000,
          'Fetch session status'
        );
        session = data;
        console.log('[UnifiedMonitor] ✓ Session validated');
      } catch (error) {
        logger.error(`[UnifiedMonitor] Session validation timeout:`, error);
        console.error('[UnifiedMonitor] ❌ Session fetch failed, skipping this check');
        return;
      }

      // FAILSAFE FIX: Allow both 'active' and 'scanning' status
      // Session may still be transitioning from 'scanning' to 'active'
      // This prevents immediate abandonment during status sync
      if (!session || !['active', 'scanning'].includes(session.status)) {
        console.log('%c[UnifiedMonitor] 🛑 SESSION INACTIVE - Stopping monitoring', 'color: #f44336; font-weight: bold', {
          intentId: intentId.substring(0, 8),
          sessionId: intent.session_id.substring(0, 8),
          sessionFound: !!session,
          sessionStatus: session?.status
        });
        await this.stopMonitoring(intentId, 'SESSION_INACTIVE');
        return;
      }

      // Step 4: Fetch current price
      console.log('[UnifiedMonitor] Step 4/8: Fetching current price...');
      let priceData: any = null;
      try {
        priceData = await withTimeout(
          marketDataService.getCurrentPrice(intent.symbol),
          5000,
          'Fetch current price'
        );
        console.log('[UnifiedMonitor] ✓ Price fetched:', priceData?.price);
      } catch (error) {
        logger.error(`[UnifiedMonitor] Price fetch timeout:`, error);
        console.error('[UnifiedMonitor] ❌ Price fetch failed, skipping this check');
        return;
      }

      if (!priceData || priceData.freshness === 'invalid') {
        logger.warn(`[UnifiedMonitor] Invalid price data for ${intent.symbol}`);
        console.error('[UnifiedMonitor] ❌ Invalid price data, skipping this check');
        return;
      }

      // Step 5: Fetch candles and market conditions
      console.log('[UnifiedMonitor] Step 5/8: Fetching candles and market conditions...');
      let candles: any[] = [];
      let marketConditions: any = null;

      try {
        [candles, marketConditions] = await Promise.all([
          withTimeout(
            marketDataService.getCandles(intent.symbol, '5m', 50),
            5000,
            'Fetch candles'
          ),
          withTimeout(
            marketDataService.getMarketConditions(intent.symbol),
            5000,
            'Fetch market conditions'
          )
        ]);
        console.log('[UnifiedMonitor] ✓ Candles fetched:', candles.length);
        console.log('[UnifiedMonitor] ✓ Market conditions fetched');
      } catch (error) {
        logger.error(`[UnifiedMonitor] Candle/market fetch timeout:`, error);
        console.error('[UnifiedMonitor] ❌ Data fetch failed, skipping this check');
        return;
      }

      if (!marketConditions) {
        logger.warn(`[UnifiedMonitor] No market conditions for ${intent.symbol}`);
        console.error('[UnifiedMonitor] ❌ No market conditions, skipping this check');
        return;
      }

      // Step 6: Calculate technical indicators
      console.log('[UnifiedMonitor] Step 6/8: Calculating indicators...');
      // SSOT FIX: Candles come from DB in descending order (newest first)
      // Reverse them to chronological order (oldest first) for indicator calculations
      // Then use last 10 for EQS (most recent price action)
      const candlesForIndicators = [...candles].reverse().map(c => ({
        time: c.open_time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      }));

      let ema20Value = priceData.price; // Fallback to current price
      let rsiValue = 50; // Fallback to neutral

      try {
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

        console.log('[UnifiedMonitor] ✓ Indicators calculated:', {
          ema20: ema20Value.toFixed(5),
          rsi: rsiValue.toFixed(1)
        });
      } catch (error) {
        logger.error(`[UnifiedMonitor] Indicator calculation error:`, error);
        console.error('[UnifiedMonitor] ⚠️ Using fallback indicator values');
      }

      logger.info(
        `[UnifiedMonitor] Indicators for ${intent.symbol}: ` +
        `EMA20=${ema20Value.toFixed(5)}, RSI=${rsiValue.toFixed(1)}, ` +
        `Price=${priceData.price.toFixed(5)}, Candles=${candlesForIndicators.length}`
      );

      // Step 7: Calculate EQS
      console.log('[UnifiedMonitor] Step 7/8: Calculating Entry Quality Score...');
      const marketContext = intent.market_context as any;
      const confidence = marketContext?.confidence || 60;
      const stopLoss = marketContext?.stop_loss || 0;
      const takeProfit = marketContext?.take_profit || 0;

      let eqsResult: any = null;
      let currentEQS = 0;

      try {
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

        eqsResult = entryQualificationEngine.evaluate(qualificationInput);
        currentEQS = eqsResult.eqsBreakdown.totalScore;
        console.log('[UnifiedMonitor] ✓ EQS calculated:', currentEQS);
      } catch (error) {
        logger.error(`[UnifiedMonitor] EQS calculation error:`, error);
        console.error('[UnifiedMonitor] ❌ EQS calculation failed, skipping this check');
        return;
      }

      const styleConfig = tradeStyleRegistry.getConfig(style);

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

      // Step 7.5: Update database heartbeat and store EQS
      console.log('[UnifiedMonitor] Step 7.5/8: Updating database heartbeat...');
      try {
        // Store EQS update in database for UI display
        await this.storeEQSUpdate(intent, eqsResult, currentEQS, styleConfig.eqsThreshold);

        // Update last_checked_at timestamp as heartbeat
        await withTimeout(
          supabase
            .from('entry_intents')
            .update({ last_checked_at: new Date().toISOString() })
            .eq('id', intentId),
          3000,
          'Update heartbeat timestamp'
        );
        console.log('[UnifiedMonitor] ✓ Database heartbeat updated');
      } catch (error) {
        logger.error(`[UnifiedMonitor] Database update error:`, error);
        console.error('[UnifiedMonitor] ⚠️ Database heartbeat failed (non-critical)');
        // Non-critical, continue monitoring
      }

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

      // Step 8: Make execution decision
      console.log('[UnifiedMonitor] Step 8/8: Making execution decision...');
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

        try {
          // Step 1: Update intent status to 'executed'
          console.log('[UnifiedMonitor] Step 1: Updating intent status to executed...');
          await EntryPlannerService.updateIntentStatus(intent.id, 'executed', undefined, entryPrice);
          console.log('[UnifiedMonitor] ✅ Intent status updated');

          // Step 2: Execute trade through coordinator
          console.log('[UnifiedMonitor] Step 2: Creating trade in database...');
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
        } catch (executionError) {
          console.error('%c[UnifiedMonitor] ❌ EXECUTION ERROR', 'color: #f44336; font-weight: bold; font-size: 16px', executionError);
          logger.error('[UnifiedMonitor] Direct execution error:', executionError);
        }
      }
    } catch (error) {
      console.error('%c[UnifiedMonitor] ❌ ERROR DURING EXECUTION:', 'color: #f44336; font-weight: bold; font-size: 16px', error);
      logger.error('[UnifiedMonitor] Execution error:', error);
    }
  }
}

export const unifiedEntryMonitor = UnifiedEntryMonitor.getInstance();
