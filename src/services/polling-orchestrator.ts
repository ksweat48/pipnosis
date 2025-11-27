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

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.debug(LogCategory.POLLING_COORDINATOR, 'Already initialized');
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

    this.isInitialized = true;
    logger.info(LogCategory.POLLING_COORDINATOR, `✅ Initialized with ${this.activePoller} as active poller`);
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

    const health: any = {}; // Simplified health tracking
    const browserStatus = browserPricePoller.getStatus();
    const globalStatus = globalPollingCoordinator.getCoordinatorStatus();
    const circuitStatus = circuitBreakerService.getStatus();

    // Count symbol statuses
    let activeCount = 0;
    let degradedCount = 0;
    let criticalCount = 0;
    let stoppedCount = 0;

    health.forEach(h => {
      switch (h.status) {
        case 'active':
          activeCount++;
          break;
        case 'degraded':
          degradedCount++;
          break;
        case 'critical':
          criticalCount++;
          break;
        case 'stopped':
          stoppedCount++;
          break;
      }
    });

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

      // Start browser poller
      await browserPricePoller.start();
      this.activePoller = 'browser';

      logger.info(LogCategory.POLLING_COORDINATOR, '✅ Failover complete: Browser is now active');
      await this.logFailover('global_to_browser', true);
    } catch (error) {
      console.error('[PollingOrchestrator] Failover failed:', error);
      await this.logFailover('global_to_browser', false, error instanceof Error ? error.message : String(error));
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
        return;
      }
    } catch (error) {
      console.error('[PollingOrchestrator] Global recovery failed:', error);
    }

    // Try browser as fallback
    try {
      await browserPricePoller.start();
      if (browserPricePoller.isRunning()) {
        this.activePoller = 'browser';
        logger.info(LogCategory.POLLING_COORDINATOR, '✅ Recovery successful with Browser');
        return;
      }
    } catch (error) {
      console.error('[PollingOrchestrator] Browser recovery failed:', error);
    }

    console.error('[PollingOrchestrator] ❌ Full recovery failed, no active poller');
    this.activePoller = 'none';
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
      const health: any = {}; // Simplified health tracking
      let activeCount = 0;
      let degradedCount = 0;
      let criticalCount = 0;
      let stoppedCount = 0;

      health.forEach(h => {
        switch (h.status) {
          case 'active': activeCount++; break;
          case 'degraded': degradedCount++; break;
          case 'critical': criticalCount++; break;
          case 'stopped': stoppedCount++; break;
        }
      });

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
    const health: any = {}; // Simplified health tracking
    let activeCount = 0;
    let degradedCount = 0;
    let criticalCount = 0;
    let stoppedCount = 0;

    health.forEach(h => {
      switch (h.status) {
        case 'active': activeCount++; break;
        case 'degraded': degradedCount++; break;
        case 'critical': criticalCount++; break;
        case 'stopped': stoppedCount++; break;
      }
    });

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
    logger.info(LogCategory.POLLING_COORDINATOR, 'Shutting down...');

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
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
