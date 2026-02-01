/**
 * Polling Orchestrator - Master Coordinator
 *
 * Manages both GlobalPollingCoordinator and BrowserPoller with intelligent failover.
 * Ensures exactly one system is actively polling at any time to avoid conflicts.
 * Automatically switches between systems based on health and availability.
 */

import { globalPollingCoordinator } from './global-polling-coordinator';
import { browserPricePoller } from './browser-price-poller';
// polling-health-monitor removed - using minimal fallback
import { circuitBreakerService } from './circuit-breaker-service';
import { supabase } from '@/lib/supabase';
import { logger, LogCategory } from '@/lib/logger';
import { shouldDisableMetaAPI, areFunctionsAvailable } from '@/lib/environment';

type ActivePoller = 'global' | 'browser' | 'none';

interface OrchestratorStatus {
  activePoller: ActivePoller;
  globalCoordinatorStatus: any;
  browserPollerStatus: any;
  circuitBreakerStatus: any;
  healthSummary: {
    totalSymbols: number;
    activeSymbols: number;
    degradedSymbols: number;
    criticalSymbols: number;
    stoppedSymbols: number;
  };
}

const FOREX_PAIRS = ['EURUSD', 'XAUUSD', 'US30', 'GBPUSD', 'USDJPY'];

class PollingOrchestrator {
  private activePoller: ActivePoller = 'none';
  private monitorInterval: NodeJS.Timeout | null = null;
  private isInitialized = false;
  private failoverInProgress = false;
  private readonly MONITOR_INTERVAL_MS = 30000; // Check every 30 seconds
  private readonly FAILOVER_COOLDOWN_MS = 10000; // Wait 10 seconds between failovers
  private sessionSubscription: any = null;
  private activeGoalSessions = new Set<string>();

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug(LogCategory.POLLING_COORDINATOR, 'Already initialized');
      return;
    }

    // CRITICAL: Disable polling orchestrator in development/WebContainer environments
    // Netlify Functions don't exist, causing circuit breaker spam and chart loading failures
    if (shouldDisableMetaAPI() || !areFunctionsAvailable()) {
      logger.info(LogCategory.POLLING_COORDINATOR, '🔴 Polling Orchestrator disabled in development/WebContainer environment');
      logger.info(LogCategory.POLLING_COORDINATOR, '   Application will operate in database-only mode');
      this.isInitialized = true;
      this.activePoller = 'none';
      return;
    }

    logger.info(LogCategory.POLLING_COORDINATOR, 'Initializing master polling coordinator...');

    // Initialize health monitoring first
    // Health monitor removed for simplicity

    // Initialize circuit breaker
    await circuitBreakerService.initialize();

    // Try to start GlobalPollingCoordinator (primary)
    try {
      await globalPollingCoordinator.initialize();

      if (globalPollingCoordinator.isInitialized()) {
        this.activePoller = 'global';
        logger.debug(LogCategory.POLLING_COORDINATOR, '✅ GlobalPollingCoordinator is primary');
      } else {
        console.warn('[PollingOrchestrator] GlobalPollingCoordinator not ready, trying BrowserPoller');
        await this.startBrowserPoller();
      }
    } catch (error) {
      console.error('[PollingOrchestrator] GlobalPollingCoordinator failed to initialize:', error);
      await this.startBrowserPoller();
    }

    // Start health monitoring
    this.startHealthMonitoring();

    // Subscribe to goal session changes
    this.subscribeToGoalSessions();

    // Load existing active sessions
    await this.loadActiveSessions();

    this.isInitialized = true;
    logger.info(LogCategory.POLLING_COORDINATOR, `✅ Initialized with ${this.activePoller} as active poller`);
  }

  private async loadActiveSessions(): Promise<void> {
    try {
      const { data: sessions, error } = await supabase
        .from('goal_sessions')
        .select('id, watchlist')
        .in('status', ['scanning', 'initializing', 'trade_pending', 'in_trade', 'active']);

      if (error) {
        console.error('[PollingOrchestrator] Failed to load active sessions:', error);
        return;
      }

      if (sessions && sessions.length > 0) {
        sessions.forEach(session => {
          this.activeGoalSessions.add(session.id);
          if (session.watchlist && Array.isArray(session.watchlist)) {
            session.watchlist.forEach((symbol: string) => {
              globalPollingCoordinator.protectSymbol(symbol, session.id);
            });
          }
        });
        console.log(`[PollingOrchestrator] 🛡️ Loaded ${sessions.length} active goal sessions - polling protected`);
      }
    } catch (error) {
      console.error('[PollingOrchestrator] Error loading active sessions:', error);
    }
  }

  private subscribeToGoalSessions(): void {
    try {
      this.sessionSubscription = supabase
        .channel('goal_sessions_orchestrator')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'goal_sessions'
          },
          (payload: any) => {
            this.handleSessionChange(payload);
          }
        )
        .subscribe();

      logger.debug(LogCategory.POLLING_COORDINATOR, '✅ Subscribed to goal_sessions changes');
    } catch (error) {
      console.error('[PollingOrchestrator] Failed to subscribe to goal_sessions:', error);
    }
  }

  private handleSessionChange(payload: any): void {
    const { eventType, new: newRecord, old: oldRecord } = payload;

    if (eventType === 'INSERT' || eventType === 'UPDATE') {
      const session = newRecord;
      const activeStatuses = ['scanning', 'initializing', 'trade_pending', 'in_trade', 'active'];

      if (activeStatuses.includes(session.status)) {
        if (!this.activeGoalSessions.has(session.id)) {
          this.activeGoalSessions.add(session.id);
          if (session.watchlist && Array.isArray(session.watchlist)) {
            session.watchlist.forEach((symbol: string) => {
              globalPollingCoordinator.protectSymbol(symbol, session.id);
            });
          }
          console.log(`[PollingOrchestrator] 🛡️ Goal session ${session.id} started - protecting ${session.watchlist?.join(', ') || 'unknown'}`);
        }
      } else {
        if (this.activeGoalSessions.has(session.id)) {
          this.activeGoalSessions.delete(session.id);
          if (session.watchlist && Array.isArray(session.watchlist)) {
            session.watchlist.forEach((symbol: string) => {
              globalPollingCoordinator.unprotectSymbol(symbol, session.id);
            });
          }
          console.log(`[PollingOrchestrator] ✅ Goal session ${session.id} ended - unprotecting ${session.watchlist?.join(', ') || 'unknown'}`);
        }
      }
    } else if (eventType === 'DELETE') {
      const session = oldRecord;
      if (this.activeGoalSessions.has(session.id)) {
        this.activeGoalSessions.delete(session.id);
        if (session.watchlist && Array.isArray(session.watchlist)) {
          session.watchlist.forEach((symbol: string) => {
            globalPollingCoordinator.unprotectSymbol(symbol, session.id);
          });
        }
        console.log(`[PollingOrchestrator] ✅ Goal session ${session.id} deleted - unprotecting ${session.watchlist?.join(', ') || 'unknown'}`);
      }
    }
  }

  private async checkForActiveSessions(): Promise<boolean> {
    try {
      const { data: sessions, error } = await supabase
        .from('goal_sessions')
        .select('id')
        .in('status', ['scanning', 'initializing', 'trade_pending', 'in_trade', 'active'])
        .limit(1);

      if (error) {
        console.error('[PollingOrchestrator] Failed to check active sessions:', error);
        return false;
      }

      const hasActiveSessions = sessions && sessions.length > 0;

      // DEFENSIVE FIX: Clear our local Set if database says no active sessions
      // This prevents stale session IDs from staying in memory due to race conditions
      if (!hasActiveSessions && this.activeGoalSessions.size > 0) {
        console.warn(`[PollingOrchestrator] 🧹 Database has no active sessions but Set has ${this.activeGoalSessions.size} - clearing stale data`);
        const staleSessionIds = Array.from(this.activeGoalSessions);
        console.warn(`[PollingOrchestrator] Stale session IDs: ${staleSessionIds.join(', ')}`);
        this.activeGoalSessions.clear();
      }

      return hasActiveSessions;
    } catch (error) {
      console.error('[PollingOrchestrator] Error checking active sessions:', error);
      return false;
    }
  }

  private async startBrowserPoller(): Promise<void> {
    try {
      await browserPricePoller.start();
      this.activePoller = 'browser';
      logger.debug(LogCategory.POLLING_COORDINATOR, '✅ BrowserPoller started as fallback');
    } catch (error) {
      console.error('[PollingOrchestrator] Failed to start BrowserPoller:', error);
      this.activePoller = 'none';
    }
  }

  private startHealthMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }

    this.monitorInterval = setInterval(() => {
      this.checkSystemHealth();
    }, this.MONITOR_INTERVAL_MS);

    logger.debug(LogCategory.POLLING_COORDINATOR, 'Health monitoring started');
  }

  private async checkSystemHealth(): Promise<void> {
    if (this.failoverInProgress) {
      logger.debug(LogCategory.POLLING_COORDINATOR, 'Failover in progress, skipping health check');
      return;
    }

    // 🚨 CRITICAL FIX: Don't failover if tab is hidden - browser throttling is EXPECTED
    if (typeof document !== 'undefined' && document.hidden) {
      logger.debug(LogCategory.POLLING_COORDINATOR, '🙈 Tab hidden - skipping health check (throttling is expected)');
      return;
    }

    // Health tracking simplified - no health monitor
    const browserStatus = browserPricePoller.getStatus();
    const globalStatus = globalPollingCoordinator.getCoordinatorStatus();
    const circuitStatus = circuitBreakerService.getStatus();

    // Count symbol statuses (health monitor removed)
    let activeCount = 0;
    let degradedCount = 0;
    let criticalCount = 0;
    let stoppedCount = 0;

    console.log(
      `[PollingOrchestrator] Health Summary: ` +
      `active=${activeCount}, degraded=${degradedCount}, ` +
      `critical=${criticalCount}, stopped=${stoppedCount}, ` +
      `circuit=${circuitStatus.state}`
    );

    // Check if we need to failover
    if (this.activePoller === 'global') {
      // Check if GlobalPollingCoordinator is healthy
      if (globalStatus.activePairs < FOREX_PAIRS.length / 2) {
        console.warn('[PollingOrchestrator] GlobalPollingCoordinator unhealthy, considering failover to Browser');

        // 🛡️ CRITICAL: Check for active goal sessions before allowing failover
        const hasActiveSessions = await this.checkForActiveSessions();
        if (hasActiveSessions) {
          console.warn('[PollingOrchestrator] ⚠️ Active goal sessions detected - MAINTAINING polling despite health issues');
          console.warn(`[PollingOrchestrator] Protected sessions: ${this.activeGoalSessions.size}`);
          // Notify global coordinator to increase tolerance
          globalPollingCoordinator.notifyActiveSessions(true);
          return; // Skip failover
        }

        // Only failover if circuit breaker isn't the issue
        if (circuitStatus.state !== 'open') {
          await this.failoverToBrowserPoller();
        }
      }
    } else if (this.activePoller === 'browser') {
      // Check if BrowserPoller is healthy
      if (!browserStatus.isActive || browserStatus.mode === 'stopped') {
        console.error('[PollingOrchestrator] BrowserPoller stopped, attempting failover to Global');
        await this.failoverToGlobalCoordinator();
      } else if (browserStatus.mode === 'critical' && globalStatus.activePairs > 0) {
        console.warn('[PollingOrchestrator] BrowserPoller in critical mode, trying Global');
        await this.failoverToGlobalCoordinator();
      }
    } else if (this.activePoller === 'none') {
      console.error('[PollingOrchestrator] No active poller, attempting recovery');
      await this.attemptRecovery();
    }

    // Persist orchestrator state
    await this.persistState();
  }

  private async failoverToBrowserPoller(): Promise<void> {
    if (this.failoverInProgress) return;

    this.failoverInProgress = true;
    logger.warn(LogCategory.POLLING_COORDINATOR, '⚠️ Failover: Global -> Browser');

    try {
      // Stop global coordinator
      await globalPollingCoordinator.shutdown();

      // Wait for cooldown
      await new Promise(resolve => setTimeout(resolve, this.FAILOVER_COOLDOWN_MS));

      // Start browser poller with error handling
      try {
        await browserPricePoller.start();
        this.activePoller = 'browser';

        logger.info(LogCategory.POLLING_COORDINATOR, '✅ Failover complete: Browser is now active');
        await this.logPollingError('failover', 'failover_success', 'Global -> Browser successful', null);
        await this.logFailover('global_to_browser', true);
      } catch (browserError) {
        // Browser initialization failed - log specific error
        const errorMsg = browserError instanceof Error ? browserError.message : String(browserError);
        logger.error(LogCategory.POLLING_COORDINATOR, `Browser poller start failed during failover: ${errorMsg}`);

        // Log to polling errors table for diagnostics
        await this.logPollingError('failover', 'browser_init_failed', `Browser init failed: ${errorMsg}`, browserError instanceof Error ? browserError.stack : undefined);

        // Failover failed - no active poller
        this.activePoller = 'none';
        throw new Error(`Browser poller initialization failed: ${errorMsg}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[PollingOrchestrator] Failover failed:', error);
      await this.logFailover('global_to_browser', false, errorMsg);
      await this.logPollingError('failover', 'failover_failed', errorMsg, error instanceof Error ? error.stack : undefined);
      this.activePoller = 'none';
    } finally {
      this.failoverInProgress = false;
    }
  }

  private async failoverToGlobalCoordinator(): Promise<void> {
    if (this.failoverInProgress) return;

    this.failoverInProgress = true;
    logger.warn(LogCategory.POLLING_COORDINATOR, '⚠️ Failover: Browser -> Global');

    try {
      // Stop browser poller
      browserPricePoller.stop();

      // Wait for cooldown
      await new Promise(resolve => setTimeout(resolve, this.FAILOVER_COOLDOWN_MS));

      // Start global coordinator
      await globalPollingCoordinator.initialize();

      if (globalPollingCoordinator.isInitialized()) {
        this.activePoller = 'global';
        logger.info(LogCategory.POLLING_COORDINATOR, '✅ Failover complete: Global is now active');
        await this.logFailover('browser_to_global', true);
      } else {
        throw new Error('GlobalPollingCoordinator failed to initialize');
      }
    } catch (error) {
      console.error('[PollingOrchestrator] Failover failed, staying with Browser:', error);
      await this.logFailover('browser_to_global', false, error instanceof Error ? error.message : String(error));

      // Restart browser poller if it's not running
      if (!browserPricePoller.isRunning()) {
        await browserPricePoller.start();
        this.activePoller = 'browser';
      }
    } finally {
      this.failoverInProgress = false;
    }
  }

  private async attemptRecovery(): Promise<void> {
    logger.info(LogCategory.POLLING_COORDINATOR, '🔄 Attempting full system recovery');

    // Try global first
    try {
      await globalPollingCoordinator.initialize();
      if (globalPollingCoordinator.isInitialized()) {
        this.activePoller = 'global';
        logger.info(LogCategory.POLLING_COORDINATOR, '✅ Recovery successful with Global');
        await this.logPollingError('recovery', 'recovery_success', 'Recovered with Global', null);
        return;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[PollingOrchestrator] Global recovery failed:', error);
      await this.logPollingError('recovery', 'global_recovery_failed', errorMsg, error instanceof Error ? error.stack : undefined);
    }

    // Try browser as fallback
    try {
      await browserPricePoller.start();
      if (browserPricePoller.isRunning()) {
        this.activePoller = 'browser';
        logger.info(LogCategory.POLLING_COORDINATOR, '✅ Recovery successful with Browser');
        await this.logPollingError('recovery', 'recovery_success', 'Recovered with Browser', null);
        return;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[PollingOrchestrator] Browser recovery failed:', error);
      await this.logPollingError('recovery', 'browser_recovery_failed', errorMsg, error instanceof Error ? error.stack : undefined);
    }

    console.error('[PollingOrchestrator] ❌ Full recovery failed, no active poller');
    this.activePoller = 'none';
    await this.logPollingError('recovery', 'complete_failure', 'Full recovery failed - no active poller', null);
  }

  private async logPollingError(
    errorType: 'failover' | 'recovery' | 'health_check',
    errorSubtype: string,
    errorMessage: string,
    stackTrace: string | null
  ): Promise<void> {
    try {
      await supabase.from('polling_orchestrator_errors').insert({
        error_type: errorType === 'health_check' ? 'recovery' : errorType,
        error_message: errorMessage,
        stack_trace: stackTrace,
        recovery_action: `${errorType}:${errorSubtype}`,
        resolved_at: null
      });
    } catch (error) {
      console.error('[PollingOrchestrator] Failed to log polling error:', error);
    }
  }

  private async logFailover(action: string, success: boolean, errorMessage?: string): Promise<void> {
    try {
      await supabase.from('polling_recovery_log').insert({
        symbol: 'ORCHESTRATOR',
        trigger_reason: 'health_check_failover',
        recovery_action: action,
        success,
        error_message: errorMessage,
        metrics: {
          active_poller: this.activePoller,
          failover_in_progress: this.failoverInProgress
        }
      });
    } catch (error) {
      console.error('[PollingOrchestrator] Failed to log failover:', error);
    }
  }

  private async persistState(): Promise<void> {
    try {
      // Health tracking simplified - no health monitor
      let activeCount = 0;
      let degradedCount = 0;
      let criticalCount = 0;
      let stoppedCount = 0;

      await supabase
        .from('polling_health')
        .upsert({
          symbol: 'ORCHESTRATOR',
          status: this.activePoller === 'none' ? 'stopped' : activeCount > FOREX_PAIRS.length / 2 ? 'active' : 'degraded',
          consecutive_errors: stoppedCount,
          success_count: activeCount,
          updated_at: new Date().toISOString(),
          last_error_message: `Active: ${this.activePoller}, Health: ${activeCount}/${FOREX_PAIRS.length}`
        }, {
          onConflict: 'symbol'
        });
    } catch (error) {
      console.error('[PollingOrchestrator] Failed to persist state:', error);
    }
  }

  getStatus(): OrchestratorStatus {
    // Health tracking simplified - no health monitor
    let activeCount = 0;
    let degradedCount = 0;
    let criticalCount = 0;
    let stoppedCount = 0;

    return {
      activePoller: this.activePoller,
      globalCoordinatorStatus: globalPollingCoordinator.getCoordinatorStatus(),
      browserPollerStatus: browserPricePoller.getStatus(),
      circuitBreakerStatus: circuitBreakerService.getStatus(),
      healthSummary: {
        totalSymbols: FOREX_PAIRS.length,
        activeSymbols: activeCount,
        degradedSymbols: degradedCount,
        criticalSymbols: criticalCount,
        stoppedSymbols: stoppedCount
      }
    };
  }

  async manualFailover(target: 'global' | 'browser'): Promise<void> {
    logger.info(LogCategory.POLLING_COORDINATOR, `Manual failover requested to ${target}`);

    if (target === 'browser') {
      await this.failoverToBrowserPoller();
    } else {
      await this.failoverToGlobalCoordinator();
    }
  }

  async shutdown(): Promise<void> {
    // 🛡️ CRITICAL: Check for active sessions before shutdown
    const hasActiveSessions = await this.checkForActiveSessions();
    if (hasActiveSessions) {
      console.warn('[PollingOrchestrator] ⚠️ Cannot shutdown - active goal sessions detected!');
      console.warn(`[PollingOrchestrator] Protected sessions: ${this.activeGoalSessions.size}`);
      return;
    }

    logger.info(LogCategory.POLLING_COORDINATOR, 'Shutting down...');

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    // Cleanup session subscription
    if (this.sessionSubscription) {
      await this.sessionSubscription.unsubscribe();
      this.sessionSubscription = null;
    }

    browserPricePoller.stop();
    await globalPollingCoordinator.shutdown();
    // Health monitor cleanup removed

    this.activePoller = 'none';
    this.isInitialized = false;

    logger.info(LogCategory.POLLING_COORDINATOR, '✅ Shutdown complete');
  }
}

export const pollingOrchestrator = new PollingOrchestrator();
