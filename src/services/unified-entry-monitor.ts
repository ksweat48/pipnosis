/**
 * Unified Entry Monitor - SINGLE SOURCE OF TRUTH (SIMPLIFIED)
 *
 * Central authority for entry monitoring.
 *
 * SIMPLIFIED MONITORING (No EQS, No Timeouts):
 * - Monitors price position relative to entry zone
 * - Auto-executes when price enters zone (no quality checks)
 * - No timeout or expiration (stays active until user action)
 * - User can manually execute at any time via button
 *
 * Delegates to:
 * - MarketDataService for current price
 * - TradeStyleRegistry for style configs (polling intervals)
 * - ZoneMetaLearningService for zone hit tracking
 *
 * This is the ONLY entry monitor. All other monitors delegate here.
 */

import { supabase } from '../lib/supabase';
import { marketDataService } from './market-data-service';
import { tradeStyleRegistry } from './trade-style-registry';
import { logger } from '../lib/logger';
import type { EntryIntent, EntryOutcomeReason } from '../types/entry';
import { getEntryIntentById, markIntentExpired, type AbandonReason } from './entry-intent-monitor-mode';
import { EntryPlannerService } from './entry-planner';
import { EntryExecutionCoordinator } from './entry-execution-coordinator';
import { entryThesisMemoryService } from './entry-thesis-memory-service';
import { ADAPTIVE_ZONE_CONFIG, type ExecutedZoneType } from '../config/adaptive-zone-config';
import { ZoneMetaLearningService } from './zone-meta-learning-service';
import { globalToastManager } from './global-toast-manager';
import { getCurrencyPipInfo } from '../utils/currencyHelpers';
import { thesisEntryQualityEngine } from './thesis-entry-quality-engine';
import type { ThesisType } from '../types/thesis';
import { entryTimeDecayCoordinator } from './entry-time-decay-coordinator';

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
  private callbacks: Map<string, MonitoringCallbacks> = new Map();
  private lastCheckTimestamp: Map<string, number> = new Map(); // Health monitoring
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private warningCache: Map<string, number> = new Map(); // Throttle warnings
  private readonly WARNING_THROTTLE_MS = 60000; // Only warn once per 60 seconds
  private consecutiveOutsideZone: Map<string, number> = new Map(); // Setup validity tracking
  private executedZoneTypes: Map<string, ExecutedZoneType> = new Map(); // Track which zone triggered execution
  private zoneHitTimestamps: Map<string, number> = new Map(); // Track when zone was first reached
  private healthStopAttempts: Set<string> = new Set(); // Track intents health monitor already tried to stop

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

    // Check if server monitoring is active
    const isServerMonitoring = await this.checkServerMonitoringActive(intent);

    if (isServerMonitoring) {
      console.log('%c[UnifiedMonitor] 🖥️ Server monitoring ACTIVE - browser monitoring disabled', 'color: #4caf50; font-weight: bold', {
        intentId,
        symbol: intent.symbol,
        serverHeartbeat: intent.server_heartbeat,
        executionMode: intent.execution_mode
      });
      logger.info(`[UnifiedMonitor] Server monitoring active for ${intentId}, browser monitoring not needed`);

      // Store callbacks but don't start polling - server will handle it
      if (callbacks) {
        this.callbacks.set(intentId, callbacks);
      }

      return;
    }

    const styleConfig = tradeStyleRegistry.getConfig(intent.style || 'MICRO_INTRADAY');
    console.log('%c[UnifiedMonitor] 💻 Starting BROWSER monitoring (server inactive)', 'color: #ff9800; font-weight: bold', {
      intentId,
      symbol: intent.symbol,
      direction: intent.direction,
      style: styleConfig.canonical,
      pollIntervalMs: styleConfig.pollIntervalMs,
      eqsThreshold: styleConfig.eqsThreshold,
      hasCallbacks: !!callbacks,
      reason: intent.execution_mode === 'browser' ? 'browser mode' : 'server stale'
    });
    logger.info(`[UnifiedMonitor] Starting BROWSER monitoring for ${intentId} (${styleConfig.canonical}) - server inactive`);

    // Store callbacks for this intent
    if (callbacks) {
      this.callbacks.set(intentId, callbacks);
    }

    const interval = setInterval(async () => {
      await this.checkIntent(intentId, userId, styleConfig.canonical);
    }, styleConfig.pollIntervalMs);

    this.monitoringIntervals.set(intentId, interval);
    console.log('[UnifiedMonitor] ⏰ Browser interval set, running first check immediately...');
    await this.checkIntent(intentId, userId, styleConfig.canonical);
  }

  /**
   * Check if server monitoring is active
   * Server is considered active if execution_mode is 'server'
   *
   * CRITICAL: We TRUST server monitoring - no fallback to browser
   * If server monitoring fails, alerts will be created in database
   */
  private async checkServerMonitoringActive(intent: any): Promise<boolean> {
    // Server is active if execution_mode is 'server'
    // We trust the server monitoring system completely
    return intent.execution_mode === 'server';
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
      this.lastCheckTimestamp.delete(intentId); // Remove from health tracking
      this.healthStopAttempts.delete(intentId); // Reset health stop tracking
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
    this.callbacks.clear();
    this.lastCheckTimestamp.clear();
    this.consecutiveOutsideZone.clear();
    this.executedZoneTypes.clear();
    this.zoneHitTimestamps.clear();
    this.healthStopAttempts.clear();
    logger.info('[UnifiedMonitor] Stopped all monitoring');
  }

  /**
   * Health monitoring - detects silent failures in BROWSER monitoring only
   * SIMPLIFIED: No longer checks for server monitoring takeover
   * Server monitoring is trusted - any failures create database alerts
   * Runs every 30 seconds to check browser monitoring health
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(() => {
      const now = Date.now();

      for (const [intentId, lastCheck] of this.lastCheckTimestamp.entries()) {
        const secondsSinceLastCheck = (now - lastCheck) / 1000;

        if (secondsSinceLastCheck > 30 && secondsSinceLastCheck < 60) {
          console.warn(
            '%c[UnifiedMonitor] ⚠️ BROWSER HEALTH WARNING',
            'color: #ff9800; font-weight: bold',
            {
              intentId: intentId.substring(0, 8) + '...',
              secondsSinceLastCheck: Math.floor(secondsSinceLastCheck),
              message: 'No check in 30+ seconds - browser monitoring may be throttled'
            }
          );
        } else if (secondsSinceLastCheck >= 60) {
          // Debounce: Only try to stop once per intent
          if (this.healthStopAttempts.has(intentId)) {
            continue;
          }

          console.error(
            '%c[UnifiedMonitor] 🚨 BROWSER HEALTH CRITICAL',
            'color: #f44336; font-weight: bold',
            {
              intentId: intentId.substring(0, 8) + '...',
              secondsSinceLastCheck: Math.floor(secondsSinceLastCheck),
              message: 'No check in 60+ seconds - browser monitoring has failed'
            }
          );

          // Mark as attempted to prevent repeated stop calls
          this.healthStopAttempts.add(intentId);

          // Auto-recovery: Stop this monitoring to prevent deadlock
          logger.error(`[UnifiedMonitor] Auto-stopping deadlocked browser monitor ${intentId}`);
          this.stopMonitoring(intentId, 'MONITORING_STALLED');
        }
      }

      // Clear health stop attempts every 60 seconds
      if (this.healthStopAttempts.size > 0 && now % 60000 < 30000) {
        this.healthStopAttempts.clear();
      }
    }, 30000); // Check every 30 seconds
  }

  private async checkIntent(intentId: string, userId: string, style: string): Promise<void> {
    const checkStartTime = Date.now();
    const isDev = import.meta.env.DEV;

    // ZOMBIE CHECK: If this intent is no longer being monitored, exit immediately
    // This prevents orphaned interval callbacks from continuing after stopMonitoring()
    if (!this.monitoringIntervals.has(intentId)) {
      console.log('%c[UnifiedMonitor] 👻 ZOMBIE CHECK - Intent no longer monitored, skipping', 'color: #9e9e9e; font-weight: bold', {
        intentId: intentId.substring(0, 8),
        timestamp: new Date().toLocaleTimeString()
      });
      return;
    }

    if (isDev) {
      console.log('%c[UnifiedMonitor] 🔄 checkIntent running (SIMPLIFIED MODE - zone-only)', 'color: #00bcd4; font-weight: bold', {
        intentId: intentId.substring(0, 8) + '...',
        style,
        timestamp: new Date().toLocaleTimeString()
      });
    }

    // Update health monitoring timestamp at the start
    this.lastCheckTimestamp.set(intentId, checkStartTime);

    try {
      // Step 1: Fetch intent with timeout protection
      if (isDev) console.log('[UnifiedMonitor] Step 1/4: Fetching intent...');
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

      // Step 2: Verify session validity
      if (isDev) console.log('[UnifiedMonitor] Step 2/4: Validating session...');
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

      // Step 3: Fetch current price
      if (isDev) console.log('[UnifiedMonitor] Step 3/4: Fetching current price...');
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

      // Step 4: TIME DECAY CALCULATION - Calculate urgency phase and tolerance
      if (isDev) console.log('[UnifiedMonitor] Step 4/5: Calculating time decay phase...');

      const createdAt = new Date(intent.created_at);
      const elapsedMinutes = (Date.now() - createdAt.getTime()) / (1000 * 60);

      // Quick check if price is currently in zone (for edge loss calculation)
      const quickZoneCheck = this.checkZoneEntry(priceData.price, intent, 0);
      const isPriceInZone = quickZoneCheck.inZone;

      // Get time decay thresholds for this trade style
      const urgencyResult = await entryTimeDecayCoordinator.calculateUrgencyPhase(
        intent.trade_style || 'MICRO_INTRADAY',
        createdAt
      );

      if (isDev) {
        console.log('%c[UnifiedMonitor] ⏱️ TIME DECAY STATUS:', 'color: #ff9800; font-weight: bold', {
          elapsedMinutes: elapsedMinutes.toFixed(1),
          phase: urgencyResult.phase,
          eqsThreshold: urgencyResult.eqsThreshold,
          zoneTolerance: urgencyResult.zoneTolerance,
          timeDescription: urgencyResult.timeDescription,
          minutesUntilNextPhase: urgencyResult.minutesUntilNextPhase
        });
      }

      // Check for EDGE LOSS - if exceeded max wait time, trigger abandonment
      const edgeLossStatus = await entryTimeDecayCoordinator.checkEdgeLoss(
        intent.trade_style || 'MICRO_INTRADAY',
        createdAt,
        isPriceInZone
      );

      if (edgeLossStatus.shouldTriggerModal) {
        console.log('%c[UnifiedMonitor] 🚨 EDGE LOSS DETECTED - Max wait time exceeded', 'color: #f44336; font-weight: bold', {
          intentId: intentId.substring(0, 8),
          elapsedMinutes: elapsedMinutes.toFixed(1),
          minutesOverdue: edgeLossStatus.minutesOverdue,
          edgeDecayPercent: `${edgeLossStatus.edgeDecayPercent}%`
        });

        // Trigger edge loss modal (will be handled by modal system)
        await supabase.from('goal_notifications').insert({
          user_id: userId,
          session_id: intent.session_id,
          type: 'entry_edge_loss',
          title: 'Entry Edge Lost',
          message: `Trade setup has aged ${elapsedMinutes.toFixed(0)} minutes. Edge quality degraded by ${edgeLossStatus.edgeDecayPercent}%. Execute now or abandon?`,
          metadata: {
            intent_id: intentId,
            symbol: intent.symbol,
            elapsed_minutes: Math.floor(elapsedMinutes),
            edge_decay_percent: edgeLossStatus.edgeDecayPercent,
            minutes_overdue: edgeLossStatus.minutesOverdue
          }
        });

        // Stop monitoring - user must decide
        await this.stopMonitoring(intentId, 'EDGE_LOSS_TIMEOUT');
        return;
      }

      // Step 5: ZONE CHECK WITH TIME DECAY TOLERANCE
      if (isDev) console.log('[UnifiedMonitor] Step 5/5: Checking if price is in entry zone with tolerance...');

      // Apply zone tolerance based on urgency phase
      const zoneCheck = this.checkZoneEntry(priceData.price, intent, urgencyResult.zoneTolerance);
      const inEntryZone = zoneCheck.inZone;
      const distanceToZone = zoneCheck.distanceToNearestZone;
      const executedZoneType = zoneCheck.zoneType;

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

      // Update database heartbeat
      try {
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

      // EXECUTION DECISION: Zone-only (simplified) OR Thesis-aware EQS (if enabled)
      const USE_THESIS_EQS = import.meta.env.VITE_THESIS_EQS_ENABLED === 'true';

      let shouldExecute = false;
      let eqsScore = 0;
      let executionReason = '';

      // Convert distance to pips for display (distanceToZone is in price units)
      const pipInfo = getCurrencyPipInfo(intent.symbol);
      const distanceToPips = distanceToZone / pipInfo.pipValue;

      if (USE_THESIS_EQS && intent.thesis) {
        try {
          const eqsInput = this.buildEQSInput(intent, priceData);
          const eqsResult = thesisEntryQualityEngine.calculateEQS(eqsInput);
          eqsScore = eqsResult.score;

          // Use phase-specific threshold (relaxes over time)
          const phaseThreshold = urgencyResult.eqsThreshold;
          const immediateOverride = intent.execution_preference === 'IMMEDIATE' && eqsScore >= 30;
          const highConfidenceOverride = (intent.alpha_confidence || 0) >= 85 && eqsScore >= 30;

          shouldExecute =
            eqsResult.readiness === 'EXECUTE_NOW' ||
            eqsScore >= phaseThreshold ||
            immediateOverride ||
            highConfidenceOverride;

          executionReason = shouldExecute
            ? `✅ THESIS EQS: ${eqsScore}/100 (Phase ${urgencyResult.phase} threshold: ${phaseThreshold}) - ${intent.thesis}`
            : `⏳ EQS ${eqsScore}/100 below Phase ${urgencyResult.phase} threshold ${phaseThreshold} (${distanceToPips.toFixed(2)} pips away)`;

          if (isDev) {
            console.log('%c[UnifiedMonitor] 🎯 Thesis-Aware EQS with Time Decay:', 'color: #9c27b0; font-weight: bold', {
              thesis: intent.thesis,
              eqsScore: eqsScore,
              readiness: eqsResult.readiness,
              urgencyPhase: urgencyResult.phase,
              phaseThreshold: phaseThreshold,
              elapsedMinutes: elapsedMinutes.toFixed(1),
              criticalGaps: eqsResult.critical_gaps,
              willExecute: shouldExecute
            });
          }
        } catch (error) {
          logger.warn('[UnifiedMonitor] Thesis EQS calculation failed, falling back to zone-only', error);
          shouldExecute = inEntryZone;
          executionReason = inEntryZone
            ? '✅ PRICE IN ENTRY ZONE - AUTO EXECUTING (EQS fallback)'
            : `⏳ Waiting for entry zone (${distanceToPips.toFixed(2)} pips away)`;
        }
      } else {
        shouldExecute = inEntryZone;
        executionReason = inEntryZone
          ? `✅ PRICE IN ENTRY ZONE - AUTO EXECUTING (Phase ${urgencyResult.phase}, tolerance: ${urgencyResult.zoneTolerance} pips)`
          : `⏳ Waiting for entry zone (${distanceToPips.toFixed(2)} pips away, Phase ${urgencyResult.phase})`;
      }

      // Always log execution decisions (critical for monitoring)
      logger.info(`[UnifiedMonitor] EXECUTION DECISION: ${shouldExecute ? '✅ EXECUTE' : '⏳ WAIT'} - ${executionReason}`);

      if (isDev) {
        console.log('%c[UnifiedMonitor] 📊 Zone Check:', 'color: #2196f3; font-weight: bold; font-size: 14px', {
          symbol: intent.symbol,
          currentPrice: priceData.price.toFixed(5),
          entryZone: `${intent.entry_zone_min.toFixed(5)} - ${intent.entry_zone_max.toFixed(5)}`,
          inZone: inEntryZone,
          distanceToZone: `${distanceToPips.toFixed(2)} pips`,
          eqsEnabled: USE_THESIS_EQS,
          eqsScore: eqsScore,
          willExecute: shouldExecute
        });
      }

      if (shouldExecute) {
        console.log('%c[UnifiedMonitor] 🚀 EXECUTING TRADE NOW!', 'color: #4caf50; font-weight: bold; font-size: 18px', {
          symbol: intent.symbol,
          direction: intent.direction,
          entryPrice: priceData.price,
          eqsScore: eqsScore,
          reason: executionReason
        });
        await this.handleExecution(intent, priceData.price, eqsScore);
        await this.stopMonitoring(intentId);
      } else {
        console.log('%c[UnifiedMonitor] ⏳ Waiting for entry zone...', 'color: #ff9800; font-weight: bold', {
          distanceToZone: `${distanceToPips.toFixed(2)} pips`,
          currentPrice: priceData.price.toFixed(5),
          targetZone: `${intent.entry_zone_min.toFixed(5)} - ${intent.entry_zone_max.toFixed(5)}`,
          eqsScore: eqsScore
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
        // Fallback: Direct execution with retry logic
        console.log('[UnifiedMonitor] No callback registered, using direct execution path with retry...');

        // Retry configuration
        const MAX_RETRIES = 3;
        const INITIAL_DELAY_MS = 1000;
        let lastError: any = null;

        // Try execution with exponential backoff
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            // CRITICAL FIX: Create trade FIRST, mark intent executed ONLY if trade creation succeeds
            // This prevents orphaned 'executed' intents with no corresponding trade

            console.log(`[UnifiedMonitor] Execution attempt ${attempt}/${MAX_RETRIES}...`);
            const result = await EntryExecutionCoordinator.executeFromIntent(intent.id, entryPrice);

            if (!result.success) {
              lastError = result.error || 'Unknown error';
              console.error(`[UnifiedMonitor] ❌ Attempt ${attempt} failed:`, lastError);

              // Show user notification for each failure attempt (SSOT FIX: was silent)
              if (attempt < MAX_RETRIES) {
                globalToastManager.showToast(
                  'warning',
                  'Execution Retry',
                  `Trade execution attempt ${attempt}/${MAX_RETRIES} failed for ${intent.symbol}. Retrying...`
                );
              }

              // If this is not the last attempt, wait with exponential backoff
              if (attempt < MAX_RETRIES) {
                const delayMs = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
                console.log(`[UnifiedMonitor] Retrying in ${delayMs}ms...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
                continue;
              }

              // All retries exhausted
              console.error('%c[UnifiedMonitor] ❌ ALL RETRIES EXHAUSTED - TRADE EXECUTION FAILED', 'color: #f44336; font-weight: bold; font-size: 16px');
              logger.error('[UnifiedMonitor] Trade creation failed after all retries, intent will continue monitoring', {
                intentId: intent.id,
                symbol: intent.symbol,
                entryPrice,
                attempts: MAX_RETRIES,
                lastError
              });

              // Show user notification about the failure with manual fallback option
              globalToastManager.showToast(
                'error',
                'Trade Execution Failed',
                `Trade execution failed for ${intent.symbol} after ${MAX_RETRIES} attempts. Use manual execution button. Monitoring continues.`
              );

              // Do NOT stop monitoring - user can still manually execute
              return;
            }

            // Success! Continue with post-execution steps
            console.log(`[UnifiedMonitor] ✅ Execution succeeded on attempt ${attempt}`);

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
              symbol: intent.symbol,
              direction: intent.direction,
              entryPrice,
              eqsScore
            });
            logger.info(`[UnifiedMonitor] Trade created successfully`);

            break;
          } catch (error) {
            lastError = error;
            console.error(`[UnifiedMonitor] Exception on attempt ${attempt}:`, error);

            if (attempt < MAX_RETRIES) {
              const delayMs = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
              console.log(`[UnifiedMonitor] Retrying after exception in ${delayMs}ms...`);
              await new Promise(resolve => setTimeout(resolve, delayMs));
            }
          }
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

  /**
   * Build EQS input from entry intent and current price data
   * Helper for thesis-aware entry quality scoring
   */
  private buildEQSInput(intent: any, priceData: any): any {
    return {
      thesis: intent.thesis as ThesisType,
      direction: intent.direction,
      price_data: {
        price: priceData.price,
        momentum: 'moderate',
        candle_body_ratio: 0.6,
        wick_rejection: 0.5
      },
      indicators: {
        ema_slope: 0.01,
        ema_alignment: intent.direction === 'BUY' ? 'bullish' : 'bearish',
        vwap: priceData.vwap || priceData.price,
        atr: intent.atr || 0.001,
        pullback_quality: 50,
        noise_level: 30
      },
      structure: {
        sweep_magnitude: 0.7,
        break_of_structure: true,
        acceptance_candles: true,
        htf_trend_aligned: true,
        pullback_depth_percent: 50,
        ema_support: true,
        range_compression: 0.6,
        break_strength: 0.7,
        retest_quality: 0.6,
        volume_expansion: false,
        distance_from_mean: Math.abs(priceData.price - (priceData.vwap || priceData.price)) / (intent.atr || 0.001),
        exhaustion_candle: false,
        momentum_decay: false,
        failed_break_confirmed: false,
        fast_reclaim: false,
        momentum_flip: false,
        range_validity: false,
        extreme_location: 0.5,
        rejection_candle: false,
        volatility_contraction: false
      },
      execution_preference: intent.execution_preference,
      alpha_confidence: intent.alpha_confidence
    };
  }
}

export const unifiedEntryMonitor = UnifiedEntryMonitor.getInstance();
