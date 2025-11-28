/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🚨 CRITICAL INFRASTRUCTURE - DO NOT MODIFY WITHOUT EXPLICIT APPROVAL
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Global Polling Coordinator
 *
 * Manages real-time price polling for all trading pairs. Coordinates timing,
 * priority, and health monitoring across the entire system.
 *
 * CRITICAL CONFIGURATION:
 * - MARKET_CHECK_INTERVAL: 60000ms (1 minute)
 * - HEARTBEAT_INTERVAL_MS: 5000ms (5 seconds)
 * - MAX_MISSED_HEARTBEATS: 3
 *
 * DO NOT CHANGE:
 * - Market hours detection logic
 * - Heartbeat monitoring system
 * - Priority-based polling intervals
 * - Visibility-based pause/resume
 *
 * See: docs/CRITICAL_SYSTEMS.md for details
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { supabase } from '@/lib/supabase';
import { getForexMarketStatus } from '@/utils/marketHours';
import { areFunctionsAvailable, logEnvironmentInfo } from '@/lib/environment';
import { pollingConfigService, SymbolPriority } from './polling-config-service';
// polling-health-monitor removed - health tracking simplified
import { logger, LogCategory } from '@/lib/logger';

interface PollStatus {
  symbol: string;
  lastPoll: Date;
  lastPrice: { bid: number; ask: number } | null;
  successCount: number;
  isPolling: boolean;
  lastSuccessfulPoll: Date | null;
  priority: SymbolPriority;
  currentInterval: number;
  isViewed: boolean;
}

export interface CoordinatorStatus {
  isRunning: boolean;
  isPaused: boolean;
  pauseReason: 'market_closed' | 'manual' | null;
  marketOpen: boolean;
  lastSuccessfulPoll: Date | null;
  activePairs: number;
  totalPairs: number;
  totalSuccesses: number;
  pairStatuses: Array<{
    symbol: string;
    status: 'active' | 'stale' | 'error' | 'starting';
    lastPrice: { bid: number; ask: number } | null;
    successCount: number;
    lastSuccessfulPoll: Date | null;
  }>;
}

class GlobalPollingCoordinator {
  private initialized = false;
  private pollIntervals: Map<string, NodeJS.Timeout> = new Map();
  private pollStatus: Map<string, PollStatus> = new Map();
  private realtimeSubscriptions: Map<string, any> = new Map();
  private marketCheckInterval: NodeJS.Timeout | null = null;
  private isPaused = false;
  private pauseReason: 'market_closed' | 'manual' | null = null;
  private listeners: Set<(status: CoordinatorStatus) => void> = new Set();
  private isTabVisible = true;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastHeartbeat: Date = new Date();
  private missedHeartbeats = 0;
  private readonly HEARTBEAT_INTERVAL_MS = 5000; // 🚨 CRITICAL: 5 seconds - DO NOT CHANGE
  private readonly MAX_MISSED_HEARTBEATS = 3; // 🚨 CRITICAL: Recovery threshold - DO NOT CHANGE
  private readonly SYMBOL_RECOVERY_THRESHOLD = 999999; // Effectively unlimited recovery attempts

  private readonly FOREX_PAIRS = [
    'XAUUSD', 'US30', 'EURUSD', 'USDJPY', 'GBPUSD'
  ];

  private readonly MARKET_CHECK_INTERVAL = 60000; // 🚨 CRITICAL: 60 seconds - DO NOT CHANGE
  private viewedSymbols: Set<string> = new Set();
  private symbolsWithPositions: Set<string> = new Set();

  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('⚠️ Global polling coordinator already initialized');
      return;
    }

    logger.debug(LogCategory.POLLING_COORDINATOR, '🚀 Initializing read-only global polling coordinator...');
    logger.debug(LogCategory.POLLING_COORDINATOR, '📊 Reading price data from database (server-side polling handles data collection)');
    logEnvironmentInfo();

    this.setupVisibilityHandling();
    this.startHeartbeatMonitoring();

    if (!areFunctionsAvailable()) {
      console.warn('⚠️ Running in development mode');
      console.log('ℹ️ Price updates will be read from cached database data');
      this.initialized = true;
      this.isPaused = true;
      this.pauseReason = 'manual';
      return;
    }

    const marketStatus = getForexMarketStatus();
    logger.debug(LogCategory.POLLING_COORDINATOR, `📊 Current Market Status: ${marketStatus.status}`);

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await pollingConfigService.loadUserConfig(user.id);
    }

    for (const symbol of this.FOREX_PAIRS) {
      this.pollStatus.set(symbol, {
        symbol,
        lastPoll: new Date(),
        lastPrice: null,
        successCount: 0,
        isPolling: false,
        lastSuccessfulPoll: null,
        priority: 'normal',
        currentInterval: 2000,
        isViewed: false
      });

      // Health recovery callback removed
    }

    if (marketStatus.isOpen) {
      logger.debug(LogCategory.POLLING_COORDINATOR, '✅ Market is open, starting read-only database monitoring...');
      this.isPaused = false;
      this.pauseReason = null;
      this.startAllPolling();
    } else {
      console.log('⏸️ Market is closed, monitoring will start when market opens');
      this.isPaused = true;
      this.pauseReason = 'market_closed';
      // Do not start polling when market is closed
    }

    this.startMarketStatusMonitoring();

    this.initialized = true;
    logger.debug(LogCategory.POLLING_COORDINATOR, `✅ Read-only polling coordinator initialized for ${this.FOREX_PAIRS.length} pairs`);
    logger.debug(LogCategory.POLLING_COORDINATOR, '📡 All price data is fetched by server-side cron job');
    logger.debug(LogCategory.POLLING_COORDINATOR, '🖥️ Browser only reads from database for UI updates');
    this.notifyListeners();
  }

  private setupVisibilityHandling(): void {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      const wasVisible = this.isTabVisible;
      this.isTabVisible = !document.hidden;

      if (!wasVisible && this.isTabVisible) {
        console.log('👁️ Tab became visible - verifying polling status...');
        this.verifyPollingHealth();
      } else if (wasVisible && !this.isTabVisible) {
        console.log('🙈 Tab hidden - polling continues in background');
        console.log('ℹ️ Note: Browser may throttle timers, heartbeat will detect issues');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', () => {
      logger.debug(LogCategory.POLLING_COORDINATOR, '🔍 Window focused - checking polling health...');
      this.verifyPollingHealth();
    });

    logger.debug(LogCategory.POLLING_COORDINATOR, '✅ Visibility change handlers installed');
  }

  private startHeartbeatMonitoring(): void {
    logger.debug(LogCategory.POLLING_COORDINATOR, `💓 Starting heartbeat monitoring (every ${this.HEARTBEAT_INTERVAL_MS}ms)...`);

    const heartbeat = () => {
      const now = new Date();
      const timeSinceLastHeartbeat = now.getTime() - this.lastHeartbeat.getTime();
      const expectedInterval = this.HEARTBEAT_INTERVAL_MS;
      const drift = timeSinceLastHeartbeat - expectedInterval;

      if (drift > expectedInterval * 2) {
        this.missedHeartbeats++;
        console.warn(
          `⚠️ Heartbeat drift detected: ${Math.round(drift)}ms ` +
          `(expected ${expectedInterval}ms). Missed: ${this.missedHeartbeats}/${this.MAX_MISSED_HEARTBEATS}`
        );

        if (this.missedHeartbeats >= this.MAX_MISSED_HEARTBEATS) {
          console.error('❌ Multiple missed heartbeats detected - polling may be throttled!');
          logger.debug(LogCategory.POLLING_COORDINATOR, '🔄 Attempting to recover polling...');
          this.recoverFromThrottling();
          this.missedHeartbeats = 0;
        }
      } else {
        if (this.missedHeartbeats > 0) {
          logger.debug(LogCategory.POLLING_COORDINATOR, '✅ Heartbeat recovered');
        }
        this.missedHeartbeats = 0;
      }

      this.lastHeartbeat = now;
    };

    heartbeat();
    this.heartbeatInterval = setInterval(heartbeat, this.HEARTBEAT_INTERVAL_MS);
  }

  private async recoverSymbol(symbol: string): Promise<void> {
    logger.debug(LogCategory.POLLING_COORDINATOR, `🔄 [GlobalCoordinator] Attempting recovery for ${symbol}`);

    const status = this.pollStatus.get(symbol);
    if (!status) return;

    // Check if we should give up on this symbol
    const health: any = { status: 'active' }; // Simplified health
    if (health && health.recoveryAttempts >= this.SYMBOL_RECOVERY_THRESHOLD) {
      console.error(`[GlobalCoordinator] ${symbol} exceeded max recovery attempts, stopping`);
      this.stopPollingForSymbol(symbol);
      return;
    }

    // Stop and restart polling with a clean slate
    this.stopPollingForSymbol(symbol);
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second cooldown
    this.startPollingForSymbol(symbol);

    logger.debug(LogCategory.POLLING_COORDINATOR, `✅ [GlobalCoordinator] Recovery initiated for ${symbol}`);
  }

  private recoverFromThrottling(): void {
    console.log('🔧 Recovering from timer throttling...');

    this.pollStatus.forEach((status, symbol) => {
      const timeSinceLastSuccess = status.lastSuccessfulPoll
        ? Date.now() - status.lastSuccessfulPoll.getTime()
        : Infinity;

      if (timeSinceLastSuccess > status.currentInterval * 5) {
        console.log(
          `⚠️ [${symbol}] Stale (${Math.round(timeSinceLastSuccess / 1000)}s), restarting...`
        );
        this.stopPollingForSymbol(symbol);
        setTimeout(() => this.startPollingForSymbol(symbol), 100);
      }
    });
  }

  private verifyPollingHealth(): void {
    logger.debug(LogCategory.POLLING_COORDINATOR, '🔍 Verifying polling health across all pairs...');

    let staleCount = 0;
    let activeCount = 0;
    const now = Date.now();

    this.pollStatus.forEach((status, symbol) => {
      const timeSinceLastSuccess = status.lastSuccessfulPoll
        ? now - status.lastSuccessfulPoll.getTime()
        : Infinity;

      if (status.successCount === 0) {
        console.log(`  [${symbol}] Starting up...`);
      } else if (timeSinceLastSuccess < 15000) {
        activeCount++;
      } else if (timeSinceLastSuccess < 60000) {
        console.warn(`  [${symbol}] ⚠️ Stale (${Math.round(timeSinceLastSuccess / 1000)}s)`);
        staleCount++;
      } else {
        console.error(`  [${symbol}] ❌ Dead (${Math.round(timeSinceLastSuccess / 1000)}s)`);
        staleCount++;
        this.stopPollingForSymbol(symbol);
        setTimeout(() => this.startPollingForSymbol(symbol), 500);
      }
    });

    logger.debug(
      LogCategory.POLLING_COORDINATOR,
      `📊 Health check complete: ${activeCount} active, ${staleCount} stale/dead of ${this.FOREX_PAIRS.length} pairs`
    );

    if (staleCount > this.FOREX_PAIRS.length / 2) {
      console.error('❌ Majority of pairs are stale - initiating full restart');
      this.restartPolling();
    }
  }

  private startAllPolling(): void {
    logger.debug(LogCategory.POLLING_COORDINATOR, `🔄 Starting read-only polling for all ${this.FOREX_PAIRS.length} forex pairs...`);
    for (const symbol of this.FOREX_PAIRS) {
      this.startPollingForSymbol(symbol);
    }
    this.isPaused = false;
    this.pauseReason = null;
    this.notifyListeners();
  }

  private stopAllPolling(): void {
    console.log('⏸️ Stopping all polling...');
    for (const symbol of this.FOREX_PAIRS) {
      this.stopPollingForSymbol(symbol);
    }
    this.notifyListeners();
  }

  setSymbolViewed(symbol: string, isViewed: boolean): void {
    if (isViewed) {
      this.viewedSymbols.add(symbol);
    } else {
      this.viewedSymbols.delete(symbol);
    }
    this.updateSymbolPriority(symbol);
  }

  setSymbolHasPosition(symbol: string, hasPosition: boolean): void {
    if (hasPosition) {
      this.symbolsWithPositions.add(symbol);
    } else {
      this.symbolsWithPositions.delete(symbol);
    }
    this.updateSymbolPriority(symbol);
  }

  private updateSymbolPriority(symbol: string): void {
    const status = this.pollStatus.get(symbol);
    if (!status) return;

    let newPriority: SymbolPriority = 'normal';
    let newInterval = pollingConfigService.getIntervalForPriority('normal');

    if (this.symbolsWithPositions.has(symbol)) {
      newPriority = 'critical';
      newInterval = pollingConfigService.getIntervalForPriority('critical');
    } else if (this.viewedSymbols.has(symbol)) {
      newPriority = 'high';
      newInterval = pollingConfigService.getIntervalForPriority('high');
    } else {
      newPriority = 'low';
      newInterval = pollingConfigService.getIntervalForPriority('low');
    }

    if (status.priority !== newPriority || status.currentInterval !== newInterval) {
      console.log(`[Coordinator] Updating ${symbol}: ${status.priority}->${newPriority}, ${status.currentInterval}ms->${newInterval}ms`);
      status.priority = newPriority;
      status.currentInterval = newInterval;
      status.isViewed = this.viewedSymbols.has(symbol);

      // CRITICAL FIX: Stop and restart polling with new interval
      if (this.pollIntervals.has(symbol)) {
        this.stopPollingForSymbol(symbol);
      }
      // Always start regardless - stopPollingForSymbol ensures clean state
      this.startPollingForSymbol(symbol);
    }
  }

  private startPollingForSymbol(symbol: string): void {
    console.log(`[Coordinator] 🚀 Attempting to start polling for ${symbol}...`);

    if (this.pollIntervals.has(symbol)) {
      console.warn(`⚠️ Polling already active for ${symbol}`);
      return;
    }

    const status = this.pollStatus.get(symbol);
    if (!status) {
      console.error(`❌ [Coordinator] No status entry for ${symbol}! pollStatus has:`,
        Array.from(this.pollStatus.keys()));
      return;
    }

    const pollFunction = async () => {
      // Always check market status before polling
      const marketStatus = getForexMarketStatus();
      if (!marketStatus.isOpen) {
        console.log(`⏸️ [${symbol}] Market closed - skipping poll`);
        return;
      }

      if (this.isPaused) {
        return;
      }

      const status = this.pollStatus.get(symbol);
      if (!status) return;

      if (status.isPolling) {
        return;
      }

      status.isPolling = true;

      try {
        // Read from database instead of fetching from API
        const { data, error } = await supabase
          .from('realtime_prices')
          .select('bid, ask, broker_time, created_at')
          .eq('symbol', symbol)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error(`❌ [${symbol}] DB Read Error:`, error);
          // Error recording removed
        } else if (data) {
          const bid = parseFloat(data.bid);
          const ask = parseFloat(data.ask);

          logger.debug(LogCategory.POLLING_COORDINATOR, `✅ [${symbol}] Price read from DB: ${bid}/${ask} (${status.priority}, ${status.currentInterval}ms)`);
          status.lastPrice = { bid, ask };
          status.lastPoll = new Date();
          status.lastSuccessfulPoll = new Date();
          status.successCount++;
          // Success recording removed
          this.notifyListeners();
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`❌ [${symbol}] Poll failed:`, errorMsg);
        // Error recording removed
        this.notifyListeners();
      } finally {
        status.isPolling = false;
      }
    };

    pollFunction();
    const interval = setInterval(pollFunction, status.currentInterval);
    this.pollIntervals.set(symbol, interval);

    console.log(`✅ [Coordinator] Started read-only polling for ${symbol} (${status.priority} priority, every ${status.currentInterval}ms)`);
    logger.debug(LogCategory.POLLING_COORDINATOR, `✅ Started read-only polling for ${symbol} (${status.priority} priority, every ${status.currentInterval}ms)`);
  }

  private stopPollingForSymbol(symbol: string): void {
    const interval = this.pollIntervals.get(symbol);
    if (interval) {
      clearInterval(interval);
      this.pollIntervals.delete(symbol);
      console.log(`🛑 Stopped polling for ${symbol}`);
    }

    const status = this.pollStatus.get(symbol);
    if (status) {
      status.isPolling = false;
    }
  }

  private startMarketStatusMonitoring(): void {
    if (this.marketCheckInterval) {
      clearInterval(this.marketCheckInterval);
    }

    // Check market status every minute
    this.marketCheckInterval = setInterval(() => {
      const marketStatus = getForexMarketStatus();

      // Market just opened - resume polling
      if (marketStatus.isOpen && this.isPaused && this.pauseReason === 'market_closed') {
        console.log('🟢 Market opened! Resuming polling...');
        this.isPaused = false;
        this.pauseReason = null;
        this.startAllPolling();
        this.notifyListeners();
      }
      // Market just closed - stop polling immediately
      else if (!marketStatus.isOpen && (!this.isPaused || this.pauseReason !== 'market_closed')) {
        console.log('🔴 Market closed! Stopping all polling immediately...');
        this.isPaused = true;
        this.pauseReason = 'market_closed';
        this.stopAllPolling();
        this.notifyListeners();
      }
    }, this.MARKET_CHECK_INTERVAL);

    logger.debug(LogCategory.POLLING_COORDINATOR, `✅ Market status monitoring started (checking every ${this.MARKET_CHECK_INTERVAL / 1000}s)`);
  }

  async shutdown(): Promise<void> {
    console.log('🛑 Shutting down global polling coordinator...');

    for (const symbol of this.FOREX_PAIRS) {
      this.stopPollingForSymbol(symbol);
    }

    if (this.marketCheckInterval) {
      clearInterval(this.marketCheckInterval);
      this.marketCheckInterval = null;
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.pollStatus.clear();
    this.viewedSymbols.clear();
    this.symbolsWithPositions.clear();
    this.initialized = false;

    logger.debug(LogCategory.POLLING_COORDINATOR, '✅ Global polling coordinator shutdown complete');
  }

  getStatus(): Map<string, PollStatus> {
    return new Map(this.pollStatus);
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getCoordinatorStatus(): CoordinatorStatus {
    const marketStatus = getForexMarketStatus();
    let lastSuccessfulPoll: Date | null = null;
    let activePairs = 0;
    let totalSuccesses = 0;
    const pairStatuses: CoordinatorStatus['pairStatuses'] = [];

    this.pollStatus.forEach(status => {
      totalSuccesses += status.successCount;

      let pairStatus: 'active' | 'stale' | 'error' | 'starting' = 'starting';

      if (status.successCount > 0) {
        const timeSinceLastSuccess = status.lastSuccessfulPoll
          ? Date.now() - status.lastSuccessfulPoll.getTime()
          : Infinity;

        if (timeSinceLastSuccess < 15000) {
          pairStatus = 'active';
          activePairs++;
        } else if (timeSinceLastSuccess < 60000) {
          pairStatus = 'stale';
        } else {
          pairStatus = 'error';
        }
      }

      if (status.lastSuccessfulPoll) {
        if (!lastSuccessfulPoll || status.lastSuccessfulPoll > lastSuccessfulPoll) {
          lastSuccessfulPoll = status.lastSuccessfulPoll;
        }
      }

      pairStatuses.push({
        symbol: status.symbol,
        status: pairStatus,
        lastPrice: status.lastPrice,
        successCount: status.successCount,
        lastSuccessfulPoll: status.lastSuccessfulPoll
      });
    });

    return {
      isRunning: this.initialized,
      isPaused: this.isPaused,
      pauseReason: this.pauseReason,
      marketOpen: marketStatus.isOpen,
      lastSuccessfulPoll,
      activePairs,
      totalPairs: this.FOREX_PAIRS.length,
      totalSuccesses,
      pairStatuses
    };
  }

  onStatusChange(callback: (status: CoordinatorStatus) => void): () => void {
    this.listeners.add(callback);
    callback(this.getCoordinatorStatus());
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notifyListeners(): void {
    const status = this.getCoordinatorStatus();
    this.listeners.forEach(listener => listener(status));
  }

  pausePolling(): void {
    if (!this.isPaused) {
      console.log('⏸️ Manually pausing polling...');
      this.isPaused = true;
      this.pauseReason = 'manual';
      this.stopAllPolling();
    }
  }

  resumePolling(): void {
    if (this.isPaused && this.pauseReason === 'manual') {
      console.log('▶️ Manually resuming polling...');
      const marketStatus = getForexMarketStatus();
      if (marketStatus.isOpen) {
        this.isPaused = false;
        this.pauseReason = null;
        this.startAllPolling();
      } else {
        console.warn('⚠️ Cannot resume polling: Market is currently closed');
        alert('Cannot resume polling while market is closed. Polling will automatically resume when the market opens (Sunday 5:00 PM EST).');
      }
    }
  }

  restartPolling(): void {
    logger.debug(LogCategory.POLLING_COORDINATOR, '🔄 Restarting all polling...');
    this.stopAllPolling();

    setTimeout(() => {
      const marketStatus = getForexMarketStatus();
      if (marketStatus.isOpen) {
        this.isPaused = false;
        this.pauseReason = null;
        this.startAllPolling();
      } else {
        console.warn('⚠️ Market is currently closed - polling will not restart');
        this.isPaused = true;
        this.pauseReason = 'market_closed';
        this.notifyListeners();
      }
    }, 1000);
  }
}

export const globalPollingCoordinator = new GlobalPollingCoordinator();
