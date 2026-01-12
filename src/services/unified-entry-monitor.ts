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
   * Check if server monitoring is active and healthy
   * Server is considered active if:
   * - execution_mode is 'server'
   * - server_heartbeat exists and is < 90 seconds old
   */
  private async checkServerMonitoringActive(intent: any): Promise<boolean> {
    // If execution_mode is explicitly browser, server is not active
    if (intent.execution_mode === 'browser') {
      return false;
    }

    // If no server heartbeat, server is not active
    if (!intent.server_heartbeat) {
      return false;
    }

    // Check if server heartbeat is fresh (< 90 seconds old)
    const heartbeatAge = Date.now() - new Date(intent.server_heartbeat).getTime();
    const isHeartbeatFresh = heartbeatAge < 90000; // 90 seconds

    if (!isHeartbeatFresh) {
      logger.warn(`[UnifiedMonitor] Server heartbeat stale (${Math.round(heartbeatAge / 1000)}s old), falling back to browser`);

      // Update intent to browser mode since server is stale
      await supabase
        .from('entry_intents')
        .update({
          execution_mode: 'browser',
          server_error: `Server heartbeat stale (${Math.round(heartbeatAge / 1000)}s old)`
        })
        .eq('id', intent.id);

      return false;
    }

    return true;
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
   * Health monitoring - detects silent failures and auto-recovers
   * Also checks if server monitoring has become active
   * Runs every 10 seconds to check monitoring health
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      const now = Date.now();

      for (const [intentId, lastCheck] of this.lastCheckTimestamp.entries()) {
        const secondsSinceLastCheck = (now - lastCheck) / 1000;

        // Check if server monitoring has become active - if so, stop browser monitoring
        try {
          const { data: intent } = await supabase
            .from('entry_intents')
            .select('execution_mode, server_heartbeat')
            .eq('id', intentId)
            .maybeSingle();

          if (intent && intent.execution_mode === 'server' && intent.server_heartbeat) {
            const heartbeatAge = Date.now() - new Date(intent.server_heartbeat).getTime();
            if (heartbeatAge < 90000) {
              console.log(
                '%c[UnifiedMonitor] 🖥️ Server monitoring now active - stopping browser monitoring',
                'color: #4caf50; font-weight: bold',
                { intentId: intentId.substring(0, 8) + '...' }
              );
              this.stopMonitoring(intentId, 'SERVER_MONITORING_ACTIVE');
              continue;
            }
          }
        } catch (error) {
          // Ignore errors in health check
        }

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
          // Debounce: Only try to stop once per intent per health check cycle
          if (this.healthStopAttempts.has(intentId)) {
            // Already tried to stop this intent, skip to prevent spam
            continue;
          }

          console.error(
            '%c[UnifiedMonitor] 🚨 HEALTH CRITICAL',
            'color: #f44336; font-weight: bold',
            {
              intentId: intentId.substring(0, 8) + '...',
              secondsSinceLastCheck: Math.floor(secondsSinceLastCheck),
              message: 'No check in 30+ seconds - monitoring has failed'
            }
          );

          // Mark as attempted to prevent repeated stop calls
          this.healthStopAttempts.add(intentId);

          // Auto-recovery: Stop this monitoring to prevent deadlock
          logger.error(`[UnifiedMonitor] Auto-stopping deadlocked monitor ${intentId}`);
          this.stopMonitoring(intentId, 'MONITORING_STALLED');
        }
      }

      // Clear health stop attempts every 60 seconds to allow re-detection if needed
      // This is safe because stopMonitoring removes from lastCheckTimestamp
      if (this.healthStopAttempts.size > 0 && now % 60000 < 10000) {
        this.healthStopAttempts.clear();
      }
    }, 10000); // Check every 10 seconds
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

      // Step 4: SIMPLIFIED ZONE CHECK - No EQS, No Timeout, Just Zone Entry
      if (isDev) console.log('[UnifiedMonitor] Step 4/4: Checking if price is in entry zone...');

      // Calculate distance to entry zone with NO tolerance (strict zone only)
      const zoneCheck = this.checkZoneEntry(priceData.price, intent, 0);
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

      // SIMPLIFIED EXECUTION DECISION: Just check if in zone
      const shouldExecute = inEntryZone;
      const executionReason = inEntryZone
        ? '✅ PRICE IN ENTRY ZONE - AUTO EXECUTING'
        : `⏳ Waiting for entry zone (${distanceToZone.toFixed(5)} pips away)`;

      // Always log execution decisions (critical for monitoring)
      logger.info(`[UnifiedMonitor] EXECUTION DECISION: ${shouldExecute ? '✅ EXECUTE' : '⏳ WAIT'} - ${executionReason}`);

      if (isDev) {
        console.log('%c[UnifiedMonitor] 📊 Zone Check:', 'color: #2196f3; font-weight: bold; font-size: 14px', {
          symbol: intent.symbol,
          currentPrice: priceData.price.toFixed(5),
          entryZone: `${intent.entry_zone_min.toFixed(5)} - ${intent.entry_zone_max.toFixed(5)}`,
          inZone: inEntryZone,
          distanceToZone: distanceToZone.toFixed(5),
          willExecute: shouldExecute
        });
      }

      if (shouldExecute) {
        console.log('%c[UnifiedMonitor] 🚀 EXECUTING TRADE NOW!', 'color: #4caf50; font-weight: bold; font-size: 18px', {
          symbol: intent.symbol,
          direction: intent.direction,
          entryPrice: priceData.price,
          reason: executionReason
        });
        await this.handleExecution(intent, priceData.price, 0); // No EQS score
        await this.stopMonitoring(intentId);
      } else {
        console.log('%c[UnifiedMonitor] ⏳ Waiting for entry zone...', 'color: #ff9800; font-weight: bold', {
          distanceToZone: `${distanceToZone.toFixed(5)} pips`,
          currentPrice: priceData.price.toFixed(5),
          targetZone: `${intent.entry_zone_min.toFixed(5)} - ${intent.entry_zone_max.toFixed(5)}`
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
