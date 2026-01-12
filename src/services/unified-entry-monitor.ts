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
import type { EntryIntent, EntryOutcomeReason } from '../types/entry';
import type { EntryQualificationInput } from './entry-qualification-engine';
import { entryMonitoringNotifications } from './entry-monitoring-notifications';
import { calculateEQSGrade, didGradeImprove } from '../utils/eqsHelpers';
import { calculateEMA, calculateRSI } from '../utils/technicalIndicators';
import { getEntryIntentById, markIntentExpired, type AbandonReason } from './entry-intent-monitor-mode';
import { EntryPlannerService } from './entry-planner';
import { EntryExecutionCoordinator } from './entry-execution-coordinator';
import { ALPHA_IDENTITY, EQS_COMPONENT_MAXIMUMS } from '../config/alpha-identity';
import { EntryUrgencyCalculator } from './entry-urgency-calculator';
import { entryThesisMemoryService } from './entry-thesis-memory-service';
import { ADAPTIVE_ZONE_CONFIG, type ExecutedZoneType } from '../config/adaptive-zone-config';
import { ZoneMetaLearningService } from './zone-meta-learning-service';
import { globalToastManager } from './global-toast-manager';

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
  private warningCache: Map<string, number> = new Map(); // Throttle warnings
  private readonly WARNING_THROTTLE_MS = 60000; // Only warn once per 60 seconds
  private consecutiveOutsideZone: Map<string, number> = new Map(); // Setup validity tracking
  private executedZoneTypes: Map<string, ExecutedZoneType> = new Map(); // Track which zone triggered execution
  private zoneHitTimestamps: Map<string, number> = new Map(); // Track when zone was first reached

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

  /**
   * Check if price is in any zone (primary or secondary) with optional tolerance
   * Returns zone type and distance
   *
   * @param price - Current market price
   * @param intent - Entry intent with zone data
   * @param tolerancePips - Zone tolerance in pips (for progressive relaxation)
   */
  private checkZoneEntry(price: number, intent: any, tolerancePips: number = 0): {
    inZone: boolean;
    zoneType: ExecutedZoneType;
    distanceToNearestZone: number;
    positionSizeMultiplier: number;
    usedTolerance: boolean;
  } {
    // Check if adaptive zones are available
    const hasPrimaryZone = intent.primary_zone_min !== null && intent.primary_zone_max !== null;
    const hasSecondaryZone = intent.secondary_zone_min !== null && intent.secondary_zone_max !== null;

    // If no adaptive zones, fall back to legacy zone
    if (!hasPrimaryZone && !hasSecondaryZone) {
      const exactInZone = price >= intent.entry_zone_min && price <= intent.entry_zone_max;
      const distanceToZone = exactInZone
        ? 0
        : price < intent.entry_zone_min
        ? intent.entry_zone_min - price
        : price - intent.entry_zone_max;

      // Apply tolerance if not exactly in zone
      const relaxedInZone = exactInZone || Math.abs(distanceToZone) <= tolerancePips;

      return {
        inZone: relaxedInZone,
        zoneType: 'none',
        distanceToNearestZone: distanceToZone,
        positionSizeMultiplier: ADAPTIVE_ZONE_CONFIG.positionSizing.primary_zone_multiplier,
        usedTolerance: relaxedInZone && !exactInZone
      };
    }

    // Check PRIMARY zone first (highest priority)
    const exactInPrimaryZone = hasPrimaryZone &&
      price >= intent.primary_zone_min &&
      price <= intent.primary_zone_max;

    if (exactInPrimaryZone) {
      logger.debug(`[UnifiedMonitor] Price ${price} in PRIMARY zone (exact)`);
      return {
        inZone: true,
        zoneType: 'primary',
        distanceToNearestZone: 0,
        positionSizeMultiplier: ADAPTIVE_ZONE_CONFIG.positionSizing.primary_zone_multiplier,
        usedTolerance: false
      };
    }

    // Check PRIMARY zone with tolerance
    if (hasPrimaryZone && tolerancePips > 0) {
      const distanceToPrimary = price < intent.primary_zone_min
        ? intent.primary_zone_min - price
        : price > intent.primary_zone_max
        ? price - intent.primary_zone_max
        : 0;

      if (distanceToPrimary <= tolerancePips && distanceToPrimary > 0) {
        logger.debug(`[UnifiedMonitor] Price ${price} within PRIMARY zone tolerance (${distanceToPrimary.toFixed(1)} pips from edge)`);
        return {
          inZone: true,
          zoneType: 'primary',
          distanceToNearestZone: distanceToPrimary,
          positionSizeMultiplier: ADAPTIVE_ZONE_CONFIG.positionSizing.primary_zone_multiplier,
          usedTolerance: true
        };
      }
    }

    // Check SECONDARY zone
    const exactInSecondaryZone = hasSecondaryZone &&
      price >= intent.secondary_zone_min &&
      price <= intent.secondary_zone_max;

    if (exactInSecondaryZone) {
      logger.debug(`[UnifiedMonitor] Price ${price} in SECONDARY zone (exact)`);
      return {
        inZone: true,
        zoneType: 'secondary',
        distanceToNearestZone: 0,
        positionSizeMultiplier: ADAPTIVE_ZONE_CONFIG.positionSizing.secondary_zone_multiplier,
        usedTolerance: false
      };
    }

    // Check SECONDARY zone with tolerance
    if (hasSecondaryZone && tolerancePips > 0) {
      const distanceToSecondary = price < intent.secondary_zone_min
        ? intent.secondary_zone_min - price
        : price > intent.secondary_zone_max
        ? price - intent.secondary_zone_max
        : 0;

      if (distanceToSecondary <= tolerancePips && distanceToSecondary > 0) {
        logger.debug(`[UnifiedMonitor] Price ${price} within SECONDARY zone tolerance (${distanceToSecondary.toFixed(1)} pips from edge)`);
        return {
          inZone: true,
          zoneType: 'secondary',
          distanceToNearestZone: distanceToSecondary,
          positionSizeMultiplier: ADAPTIVE_ZONE_CONFIG.positionSizing.secondary_zone_multiplier,
          usedTolerance: true
        };
      }
    }

    // Not in any zone - calculate distance to nearest zone
    let distanceToPrimary = Infinity;
    let distanceToSecondary = Infinity;

    if (hasPrimaryZone) {
      distanceToPrimary = price < intent.primary_zone_min
        ? intent.primary_zone_min - price
        : price - intent.primary_zone_max;
    }

    if (hasSecondaryZone) {
      distanceToSecondary = price < intent.secondary_zone_min
        ? intent.secondary_zone_min - price
        : price - intent.secondary_zone_max;
    }

    const nearestDistance = Math.min(distanceToPrimary, distanceToSecondary);

    return {
      inZone: false,
      zoneType: 'none',
      distanceToNearestZone: nearestDistance,
      positionSizeMultiplier: 0,
      usedTolerance: false
    };
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

  /**
   * Immediately stop the monitoring interval (synchronous)
   * Prevents race condition where interval fires during async cleanup
   */
  private immediatelyStopInterval(intentId: string): void {
    const interval = this.monitoringIntervals.get(intentId);
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(intentId);
      console.log(`[UnifiedMonitor] ⚡ Interval cleared immediately (runaway loop prevention)`, {
        intentId: intentId.substring(0, 8)
      });
    }
  }

  async stopMonitoring(intentId: string, reason?: AbandonReason): Promise<void> {
    // CRITICAL: Clear interval FIRST (synchronously) before any async operations
    // This prevents race condition where interval fires again during cleanup
    const hadInterval = this.monitoringIntervals.has(intentId);
    this.immediatelyStopInterval(intentId);

    if (hadInterval) {
      // Get session ID for state cleanup BEFORE any other operations
      let sessionId: string | null = null;
      try {
        const intent = await this.getIntent(intentId);
        sessionId = intent?.session_id || null;
      } catch (error) {
        logger.warn(`[UnifiedMonitor] Could not fetch intent for state cleanup`, {
          intentId: intentId.substring(0, 8),
          error
        });
      }

      // If a reason is provided, invoke onAbandon callback before cleanup
      if (reason) {
        // Map AbandonReason to EntryOutcomeReason for taxonomy
        const outcomeReason = this.mapAbandonReasonToOutcome(reason);

        // Mark intent as expired in database if timeout occurred
        if (reason === 'INTENT_EXPIRED') {
          await markIntentExpired(intentId, 'Entry monitoring window closed - time limit exceeded');
          logger.info(`[UnifiedMonitor] Marked intent as expired in database`, {
            intentId: intentId.substring(0, 8),
          });
        }

        // Mark thesis as expired if applicable (SSOT: load intent data first)
        if (outcomeReason && ['RUNAWAY_DETECTED', 'TIMEOUT'].includes(outcomeReason)) {
          try {
            const intent = await this.getIntent(intentId);
            if (intent) {
              // Pass full intent data to service (SSOT compliance)
              await entryThesisMemoryService.markThesisExpired(
                {
                  id: intent.id,
                  user_id: intent.user_id,
                  session_id: intent.session_id,
                  symbol: intent.symbol,
                  direction: intent.direction,
                  entry_zone_min: intent.entry_zone_min,
                  entry_zone_max: intent.entry_zone_max,
                  style: undefined, // Will use default M15 timeframe
                },
                outcomeReason
              );
              logger.info(`[UnifiedMonitor] Marked thesis as expired`, {
                intentId: intentId.substring(0, 8),
                reason: outcomeReason,
              });
            }
          } catch (error) {
            logger.error(`[UnifiedMonitor] Failed to mark thesis expired`, {
              error,
              intentId: intentId.substring(0, 8),
            });
          }
        }

        const callbacks = this.callbacks.get(intentId);
        if (callbacks?.onAbandon) {
          console.log(`[UnifiedMonitor] 🛑 Invoking onAbandon callback`, {
            intentId: intentId.substring(0, 8),
            reason,
            outcomeReason,
          });
          try {
            await callbacks.onAbandon(intentId, reason);
          } catch (error) {
            console.error(`[UnifiedMonitor] ❌ Error invoking onAbandon callback:`, error);
          }
        }
      }

      // CRITICAL: Reset monitor state to DISCOVERY_SCANNING to prevent orphaned state
      if (sessionId) {
        try {
          await supabase.rpc('transition_entry_monitor_state', {
            p_session_id: sessionId,
            p_new_state: 'DISCOVERY_SCANNING',
            p_locked_symbol: null,
            p_locked_direction: null
          });
          console.log(`[UnifiedMonitor] ✅ Reset monitor state to DISCOVERY_SCANNING`, {
            sessionId: sessionId.substring(0, 8),
            intentId: intentId.substring(0, 8)
          });
        } catch (stateError) {
          logger.error(`[UnifiedMonitor] Failed to reset monitor state`, {
            sessionId: sessionId.substring(0, 8),
            error: stateError
          });
        }
      }

      // Now cleanup remaining resources (interval already cleared in immediatelyStopInterval)
      this.lastNotificationTime.delete(intentId);
      this.lastEQSScores.delete(intentId);
      this.callbacks.delete(intentId);
      this.lastCheckTimestamp.delete(intentId);
      this.consecutiveOutsideZone.delete(intentId);
      this.executedZoneTypes.delete(intentId);
      this.zoneHitTimestamps.delete(intentId);
      console.log(`[UnifiedMonitor] Stopped monitoring ${intentId}`, reason ? `(reason: ${reason})` : '');
    }
  }

  /**
   * Map AbandonReason to EntryOutcomeReason for taxonomy
   */
  private mapAbandonReasonToOutcome(reason: AbandonReason): EntryOutcomeReason | null {
    const mapping: Record<AbandonReason, EntryOutcomeReason> = {
      RUNAWAY_DETECTED: 'RUNAWAY_DETECTED',
      HARD_INVALIDATION_CROSSED: 'STRUCTURE_INVALIDATED',
      INTENT_EXPIRED: 'TIMEOUT',
      INTENT_INVALID: 'STRUCTURE_INVALIDATED',
      SESSION_INACTIVE: 'USER_CANCELLED',
      SESSION_MISSING: 'USER_CANCELLED',
      MONITORING_STALLED: 'STRUCTURE_INVALIDATED',
    };

    return mapping[reason] || null;
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
    this.consecutiveOutsideZone.clear();
    this.executedZoneTypes.clear();
    this.zoneHitTimestamps.clear();
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
    const isDev = import.meta.env.DEV;

    if (isDev) {
      console.log('%c[UnifiedMonitor] 🔄 checkIntent running', 'color: #00bcd4; font-weight: bold', {
        intentId: intentId.substring(0, 8) + '...',
        style,
        timestamp: new Date().toLocaleTimeString()
      });
    }

    // Update health monitoring timestamp at the start
    this.lastCheckTimestamp.set(intentId, checkStartTime);

    try {
      // Step 1: Fetch intent with timeout protection
      if (isDev) console.log('[UnifiedMonitor] Step 1/8: Fetching intent...');
      let intent: EntryIntent | null = null;
      try {
        intent = await withTimeout(
          this.getIntent(intentId),
          5000,
          'Fetch intent from database'
        );
        if (isDev) console.log('[UnifiedMonitor] ✓ Intent fetched');
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

        // stopMonitoring now clears interval immediately (synchronously) to prevent runaway loop
        await this.stopMonitoring(intentId, 'INTENT_INVALID');
        return;
      }

      // Step 2: Check setup validity (replaces time-based abandonment)
      // Abandon if:
      // 1. Price crossed stop loss (hard invalidation)
      // 2. Price too far from zone (>3x ATR) for 5+ consecutive checks
      // 3. Session no longer active
      if (isDev) console.log('[UnifiedMonitor] Step 2/8: Checking setup validity...');

      // We'll do the full setup validity check after getting market conditions
      // This is just a placeholder step for now
      if (isDev) console.log('[UnifiedMonitor] ✓ Setup validity check will be performed after market data fetch');

      // Step 3: Verify session validity
      if (isDev) console.log('[UnifiedMonitor] Step 3/8: Validating session...');
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
        if (isDev) console.log('[UnifiedMonitor] ✓ Session validated');
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
      if (isDev) console.log('[UnifiedMonitor] Step 4/8: Fetching current price...');
      let priceData: any = null;
      try {
        priceData = await withTimeout(
          marketDataService.getCurrentPrice(intent.symbol),
          5000,
          'Fetch current price'
        );
        if (isDev) console.log('[UnifiedMonitor] ✓ Price fetched:', priceData?.price);
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
      if (isDev) console.log('[UnifiedMonitor] Step 5/8: Fetching candles and market conditions...');
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
        if (isDev) console.log('[UnifiedMonitor] ✓ Candles fetched:', candles.length);
        if (isDev) console.log('[UnifiedMonitor] ✓ Market conditions fetched');
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

      // Step 5.5: Setup Validity Check (replaces time-based timeout)
      if (isDev) console.log('[UnifiedMonitor] Step 5.5/8: Checking setup validity...');

      // Calculate time-based urgency to get zone tolerance
      const urgencyForZoneCheck = EntryUrgencyCalculator.calculateUrgency(
        new Date(intent.created_at),
        style as any,
        intent.alpha_confidence || 60
      );

      // Calculate distance to entry zone with progressive tolerance
      const zoneCheck = this.checkZoneEntry(priceData.price, intent, urgencyForZoneCheck.zoneTolerancePips);
      const inEntryZone = zoneCheck.inZone;
      const distanceToZone = zoneCheck.distanceToNearestZone;
      const executedZoneType = zoneCheck.zoneType;
      const usedZoneTolerance = zoneCheck.usedTolerance;

      if (usedZoneTolerance) {
        logger.info(`[UnifiedMonitor] Entry via RELAXED zone (Phase ${urgencyForZoneCheck.phase}, tolerance: ${urgencyForZoneCheck.zoneTolerancePips} pips)`);
      }

      // Track zone hit timestamp for meta-learning (time to reach zone)
      if (inEntryZone && !this.zoneHitTimestamps.has(intentId)) {
        const createdAt = new Date(intent.created_at).getTime();
        const hitTime = Date.now();
        const timeToReachSeconds = Math.floor((hitTime - createdAt) / 1000);

        this.zoneHitTimestamps.set(intentId, hitTime);

        // Log zone reached for meta-learning
        if (executedZoneType !== 'none') {
          ZoneMetaLearningService.logZoneReached(intentId, executedZoneType, timeToReachSeconds);
          logger.info(`[UnifiedMonitor] ${executedZoneType.toUpperCase()} zone reached in ${timeToReachSeconds}s`);
        }
      }

      // Store executed zone type for later use
      if (inEntryZone && executedZoneType !== 'none') {
        this.executedZoneTypes.set(intentId, executedZoneType);
      }

      // Track consecutive checks outside zone
      const currentOutsideCount = this.consecutiveOutsideZone.get(intentId) || 0;

      // Check if price is too far from entry zone (>3x ATR)
      const distanceInATR = distanceToZone / marketConditions.atr;
      const tooFarFromZone = distanceInATR > 3.0;

      if (tooFarFromZone) {
        this.consecutiveOutsideZone.set(intentId, currentOutsideCount + 1);

        if (currentOutsideCount + 1 >= 5) {
          console.log('%c[UnifiedMonitor] 🚫 ABANDONING - Price too far from zone', 'color: #f44336; font-weight: bold', {
            intentId: intentId.substring(0, 8),
            distanceInATR: distanceInATR.toFixed(2),
            consecutiveChecks: currentOutsideCount + 1
          });

          await this.stopMonitoring(intentId, 'RUNAWAY_DETECTED');
          return;
        }
      } else {
        // Reset counter when price returns to reasonable distance
        this.consecutiveOutsideZone.set(intentId, 0);
      }

      // Check hard invalidation (stop loss crossed)
      if (intent.invalidation_price) {
        const invalidationCrossed = intent.direction === 'long'
          ? priceData.price <= intent.invalidation_price
          : priceData.price >= intent.invalidation_price;

        if (invalidationCrossed) {
          console.log('%c[UnifiedMonitor] 🛑 ABANDONING - Invalidation price crossed', 'color: #f44336; font-weight: bold', {
            intentId: intentId.substring(0, 8),
            currentPrice: priceData.price,
            invalidationPrice: intent.invalidation_price,
            direction: intent.direction
          });
          await this.stopMonitoring(intentId, 'HARD_INVALIDATION_CROSSED');
          return;
        }
      }

      if (isDev) {
        console.log('[UnifiedMonitor] ✓ Setup validity check passed', {
          inEntryZone,
          distanceInATR: distanceInATR.toFixed(2),
          consecutiveOutsideCount: this.consecutiveOutsideZone.get(intentId) || 0
        });
      }

      // Step 6: Calculate technical indicators
      if (isDev) console.log('[UnifiedMonitor] Step 6/8: Calculating indicators...');
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

        if (isDev) {
          console.log('[UnifiedMonitor] ✓ Indicators calculated:', {
            ema20: ema20Value.toFixed(5),
            rsi: rsiValue.toFixed(1)
          });
        }
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
      if (isDev) console.log('[UnifiedMonitor] Step 7/8: Calculating Entry Quality Score...');
      const marketContext = intent.market_context as any;
      const confidence = marketContext?.confidence || 60;
      const stopLoss = marketContext?.stop_loss || 0;
      const takeProfit = marketContext?.take_profit || 0;

      let eqsResult: any = null;
      let currentEQS = 0;

      try {
        const last10Candles = candlesForIndicators.slice(-10);

        // DEBUG: Comprehensive candle order verification (dev only)
        if (isDev) {
          console.log('[UnifiedMonitor] 🔍 CANDLE ORDER VERIFICATION:', {
            totalCandlesAvailable: candlesForIndicators.length,
            using: 'LAST 10 candles (most recent)',
            candleCount: last10Candles.length,
            orderCheck: {
              firstCandle: last10Candles[0]?.time,
              lastCandle: last10Candles[last10Candles.length - 1]?.time,
              isChronological: last10Candles[0]?.time < last10Candles[last10Candles.length - 1]?.time ? '✅ CORRECT (oldest→newest)' : '❌ WRONG (reversed)'
            },
            last3Candles: last10Candles.slice(-3).map((c, idx) => ({
              position: `${last10Candles.length - 3 + idx} (${idx === 2 ? 'NEWEST' : 'older'})`,
              time: c.time,
              open: c.open.toFixed(2),
              close: c.close.toFixed(2),
              movement: c.close > c.open ? '🟢 BULLISH' : '🔴 BEARISH'
            })),
            indicatorInputs: {
              ema20: ema20Value.toFixed(5),
              rsi: rsiValue.toFixed(1),
              currentPrice: priceData.price.toFixed(5),
              priceVsEMA: priceData.price > ema20Value ? '📈 ABOVE (bullish)' : '📉 BELOW (bearish)',
              direction: intent.direction === 'long' ? 'BUY' : 'SELL'
            }
          });
        }

        const qualificationInput: EntryQualificationInput = {
          symbol: intent.symbol,
          direction: intent.direction === 'long' ? 'BUY' : 'SELL',
          entryPrice: priceData.price,
          stopLoss,
          takeProfit,
          confidence,
          m5Candles: last10Candles, // Use LAST 10 candles for pattern analysis
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
        if (isDev) console.log('[UnifiedMonitor] ✓ EQS calculated:', currentEQS);
      } catch (error) {
        logger.error(`[UnifiedMonitor] EQS calculation error:`, error);
        console.error('[UnifiedMonitor] ❌ EQS calculation failed, skipping this check');
        return;
      }

      const styleConfig = tradeStyleRegistry.getConfig(style);

      // Note: inEntryZone and distanceToZone already calculated in Step 5.5 for setup validity check

      if (isDev) {
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
      }

      logger.info(
        `[UnifiedMonitor] ${intent.symbol} EQS: ${currentEQS}/${EQS_COMPONENT_MAXIMUMS.TOTAL} ` +
        `(threshold: ${styleConfig.eqsThreshold}), Grade: ${eqsResult.eqsGrade}, ` +
        `In Zone: ${inEntryZone}, Status: ${eqsResult.status}`
      );

      // Log detailed breakdown for debugging (dev only)
      if (isDev) {
        console.log('%c[UnifiedMonitor] 📈 EQS Breakdown:', 'color: #9c27b0; font-weight: bold', {
          pullback: `${eqsResult.eqsBreakdown.pullbackQuality}/${EQS_COMPONENT_MAXIMUMS.PULLBACK_QUALITY}`,
          vwap: `${eqsResult.eqsBreakdown.vwapInteraction}/${EQS_COMPONENT_MAXIMUMS.VWAP_INTERACTION}`,
          ema: `${eqsResult.eqsBreakdown.emaAlignment}/${EQS_COMPONENT_MAXIMUMS.EMA_ALIGNMENT}`,
          liquidity: `${eqsResult.eqsBreakdown.liquidityReaction}/${EQS_COMPONENT_MAXIMUMS.LIQUIDITY_REACTION}`,
          compression: `${eqsResult.eqsBreakdown.compressionExpansion}/${EQS_COMPONENT_MAXIMUMS.COMPRESSION_EXPANSION}`,
          total: `${currentEQS}/${EQS_COMPONENT_MAXIMUMS.TOTAL}`
        });
      }

      // Step 7.5: Update database heartbeat and store EQS
      if (isDev) console.log('[UnifiedMonitor] Step 7.5/8: Updating database heartbeat...');
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
        if (isDev) console.log('[UnifiedMonitor] ✓ Database heartbeat updated');
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

        // Calculate time-based urgency for notification
        const alphaConfidence = intent.alpha_confidence || 60;
        const createdAt = new Date(intent.created_at);
        // Use the style parameter passed to the function

        const urgencyResult = EntryUrgencyCalculator.calculateUrgency(
          createdAt,
          style as any,
          alphaConfidence
        );

        const requiredGrade = calculateEQSGrade(urgencyResult.timeAdjustedThreshold);
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
            requiredEQS: urgencyResult.timeAdjustedThreshold,
            requiredGrade,
            currentPrice: priceData.price,
            inEntryZone
          });
        }
      }

      this.lastEQSScores.set(intentId, currentEQS);

      // Step 8: Make execution decision with time-based urgency + confidence
      if (isDev) console.log('[UnifiedMonitor] Step 8/8: Making execution decision...');

      // SSOT: Calculate time-based urgency (Phase 1/2/3)
      const alphaConfidence = intent.alpha_confidence || 60;
      const createdAt = new Date(intent.created_at);
      // Use the style parameter passed to the function

      const urgencyResult = EntryUrgencyCalculator.calculateUrgency(
        createdAt,
        style as any,
        alphaConfidence
      );

      // Check if intent expired
      if (urgencyResult.isExpired) {
        console.log('%c[UnifiedMonitor] ⏰ INTENT EXPIRED', 'color: #f44336; font-weight: bold', {
          minutesElapsed: urgencyResult.minutesElapsed.toFixed(1),
          style,
          intentId: intentId.substring(0, 8)
        });
        await this.stopMonitoring(intentId, 'INTENT_EXPIRED');
        return;
      }

      // Use time-adjusted threshold (decays over time)
      const adjustedEQSThreshold = urgencyResult.timeAdjustedThreshold;

      // Update database with urgency phase and zone tolerance
      try {
        await supabase
          .from('entry_intents')
          .update({
            urgency_phase: urgencyResult.phase,
            zone_tolerance_pips: urgencyResult.zoneTolerancePips,
            phase_entered_at: urgencyResult.phase !== (intent.urgency_phase || 1)
              ? new Date().toISOString()
              : undefined,
            time_adjusted_threshold: adjustedEQSThreshold,
            alpha_confidence: alphaConfidence
          })
          .eq('id', intentId);
      } catch (error) {
        logger.error('[UnifiedMonitor] Failed to update urgency phase', error);
      }

      const eqsMeetsThreshold = currentEQS >= adjustedEQSThreshold;
      const statusReady = eqsResult.status === 'EXECUTE_NOW';

      // Always log time-urgency threshold (important for monitoring)
      logger.info(`[UnifiedMonitor] Time-Urgency: Phase ${urgencyResult.phase} (${EntryUrgencyCalculator.getPhaseDescription(urgencyResult.phase)}) → Threshold ${adjustedEQSThreshold} (Alpha confidence: ${alphaConfidence}%, elapsed: ${urgencyResult.minutesElapsed.toFixed(1)}m)`);

      // Calculate zone width and near-zone distance
      const zoneWidth = intent.entry_zone_max - intent.entry_zone_min;
      const nearZoneThreshold = Math.min(0.25 * marketConditions.atr, 0.4 * zoneWidth);
      const isNearZone = !inEntryZone && distanceToZone <= nearZoneThreshold;

      // Check for exceptional override eligibility
      // SIMPLIFIED: Removed candle acceptance check, now use VWAP interaction (price location is key)
      const hasExceptionalQuality = currentEQS >= ALPHA_IDENTITY.EQS_EXCEPTIONAL_OVERRIDE_THRESHOLD;
      const hasStrongLocation = eqsResult.eqsBreakdown.vwapInteraction >= 16; // 80% of 20pts - price near VWAP
      const canOverrideZone = isNearZone && hasExceptionalQuality && hasStrongLocation;

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
        executionReason = `❌ EQS ${currentEQS} BELOW THRESHOLD ${adjustedEQSThreshold} (confidence ${alphaConfidence}%)`;
      } else if (!statusReady) {
        executionReason = `❌ STATUS NOT READY - ${eqsResult.status}`;
      } else {
        executionReason = `❌ NEAR ZONE but quality insufficient - EQS ${currentEQS} (need ${ALPHA_IDENTITY.EQS_EXCEPTIONAL_OVERRIDE_THRESHOLD}+)`;
      }

      // Always log execution decisions (critical for monitoring)
      logger.info(`[UnifiedMonitor] EXECUTION DECISION: ${shouldExecute ? '✅ EXECUTE' : '⏳ WAIT'} - ${executionReason} (EQS: ${currentEQS}/${adjustedEQSThreshold})`);

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
    const isDev = import.meta.env.DEV;
    if (isDev) {
      console.log('[UnifiedMonitor] 💾 Storing EQS update to database...', {
        intentId: intent.id.substring(0, 8),
        symbol: intent.symbol,
        eqsScore: currentEQS,
        threshold
      });
    }

    try {
      const breakdown = eqsResult.eqsBreakdown;
      const grade = calculateEQSGrade(currentEQS);

      // Get current price for the required field
      const priceData = await marketDataService.getCurrentPrice(intent.symbol);
      if (!priceData) {
        logger.warn('[UnifiedMonitor] Cannot store EQS update without current price');
        if (isDev) console.error('[UnifiedMonitor] ❌ No price data available, cannot store EQS');
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

      const logEntry = {
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
        message: `EQS: ${currentEQS}/${EQS_COMPONENT_MAXIMUMS.TOTAL} (${grade}) - ${eqsResult.status}`
      };

      if (isDev) {
        console.log('[UnifiedMonitor] 📤 Inserting EQS log entry:', {
          intentId: intent.id.substring(0, 8),
          userId: intent.user_id?.substring(0, 8),
          symbol: intent.symbol,
          eqsScore: currentEQS,
          grade,
          hasBreakdown: !!logEntry.breakdown
        });
      }

      // Store as entry monitoring log with all required fields
      const { data, error } = await supabase
        .from('entry_monitoring_logs')
        .insert(logEntry)
        .select()
        .single();

      if (error) {
        logger.error('[UnifiedMonitor] Database error storing EQS update:', error);
        if (isDev) {
          console.error('[UnifiedMonitor] ❌ DATABASE ERROR storing EQS:', {
            error: error.message,
            code: error.code,
            details: error.details
          });
        }
      } else if (isDev) {
        console.log('[UnifiedMonitor] ✅ EQS update stored successfully', {
          id: data?.id,
          eqsScore: currentEQS,
          grade
        });
      }
    } catch (error) {
      logger.error('[UnifiedMonitor] Failed to store EQS update:', error);
      if (isDev) console.error('[UnifiedMonitor] ❌ EXCEPTION storing EQS:', error);
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

    // Log zone execution for meta-learning
    const executedFromZone = this.executedZoneTypes.get(intent.id) || 'none';
    if (executedFromZone !== 'none') {
      ZoneMetaLearningService.logZoneExecution(intent.id, executedFromZone);
      logger.info(`[UnifiedMonitor] Execution triggered from ${executedFromZone.toUpperCase()} zone`);
    }

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
          // CRITICAL FIX: Create trade FIRST, mark intent executed ONLY if trade creation succeeds
          // This prevents orphaned 'executed' intents with no corresponding trade

          // Step 1: Create trade in database
          console.log('[UnifiedMonitor] Step 1: Creating trade in database...');
          const result = await EntryExecutionCoordinator.executeFromIntent(intent.id, entryPrice);

          if (!result.success) {
            // Trade creation FAILED - DO NOT mark intent as executed, keep monitoring
            const errorMsg = `Trade execution failed for ${intent.symbol} - monitoring will continue`;
            console.error('%c[UnifiedMonitor] ❌ TRADE EXECUTION FAILED - INTENT REMAINS IN MONITORING', 'color: #f44336; font-weight: bold; font-size: 16px');
            logger.error('[UnifiedMonitor] Trade creation failed, intent will continue monitoring', {
              intentId: intent.id,
              symbol: intent.symbol,
              entryPrice
            });

            // Show user notification about the failure
            globalToastManager.show(
              `⚠️ Trade execution failed for ${intent.symbol}. Please report this error. Monitoring continues.`,
              'error'
            );

            // Do NOT stop monitoring - let it retry on next qualifying conditions
            return;
          }

          // Step 2: Trade created successfully, NOW mark intent as executed
          console.log('[UnifiedMonitor] Step 2: Marking intent as executed...');
          await EntryPlannerService.updateIntentStatus(intent.id, 'executed', undefined, entryPrice);
          console.log('[UnifiedMonitor] ✅ Intent status updated');

          // Step 3: Transition monitor state to allow new scans
          if (intent.session_id) {
            try {
              await supabase.rpc('transition_entry_monitor_state', {
                p_session_id: intent.session_id,
                p_new_state: 'DISCOVERY_SCANNING',
                p_locked_symbol: null,
                p_locked_direction: null
              });
              console.log('[UnifiedMonitor] ✅ Monitor state reset to DISCOVERY_SCANNING');
            } catch (stateError) {
              logger.error('[UnifiedMonitor] Failed to transition monitor state after execution', stateError);
            }
          }

          console.log('%c[UnifiedMonitor] ✅ TRADE EXECUTED SUCCESSFULLY!', 'color: #4caf50; font-weight: bold; font-size: 18px', {
            tradeId: result.tradeId,
            symbol: intent.symbol,
            direction: intent.direction,
            entryPrice,
            eqsScore
          });
          logger.info(`[UnifiedMonitor] Trade created successfully: ${result.tradeId}`);

        } catch (executionError) {
          // Unexpected error during execution - log details and notify user
          console.error('%c[UnifiedMonitor] ❌ EXECUTION ERROR', 'color: #f44336; font-weight: bold; font-size: 16px', executionError);
          logger.error('[UnifiedMonitor] Critical execution error:', {
            error: executionError,
            stack: executionError instanceof Error ? executionError.stack : undefined,
            intentId: intent.id,
            symbol: intent.symbol,
            sessionId: intent.session_id,
            entryPrice,
            eqsScore
          });

          // Notify user of the error
          globalToastManager.show(
            `⚠️ Critical error executing trade for ${intent.symbol}. Please report this error.`,
            'error'
          );
        }
      }
    } catch (error) {
      console.error('%c[UnifiedMonitor] ❌ ERROR DURING EXECUTION:', 'color: #f44336; font-weight: bold; font-size: 16px', error);
      logger.error('[UnifiedMonitor] Outer execution error:', {
        error,
        stack: error instanceof Error ? error.stack : undefined,
        intentId: intent.id
      });
    }
  }
}

export const unifiedEntryMonitor = UnifiedEntryMonitor.getInstance();
