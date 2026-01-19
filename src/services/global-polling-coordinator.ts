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
import { getForexMarketStatus, isSymbolMarketOpen, is24HourSymbol } from '@/utils/marketHours';
import { areFunctionsAvailable, logEnvironmentInfo } from '@/lib/environment';
import { pollingConfigService, SymbolPriority } from './polling-config-service';
import { globalToastManager } from './global-toast-manager';
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
    'XAUUSD', 'US30', 'EURUSD', 'USDJPY', 'GBPUSD', 'NAS100', 'SPX500'
  ];

  private readonly CRYPTO_PAIRS = [
    'BTCUSD', 'ETHUSD'
  ];

  private readonly ALL_TRADING_PAIRS = [
    ...this.FOREX_PAIRS,
    ...this.CRYPTO_PAIRS
  ];

  private readonly MARKET_CHECK_INTERVAL = 60000; // 🚨 CRITICAL: 60 seconds - DO NOT CHANGE
  private viewedSymbols: Set<string> = new Set();
  private symbolsWithPositions: Set<string> = new Set();
  private protectedSymbols: Map<string, Set<string>> = new Map(); // symbol -> Set of session IDs
  private hasActiveSessions = false;
  private activeSessionHeartbeatThreshold = 10; // Increase tolerance when sessions active

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
    logger.debug(LogCategory.POLLING_COORDINATOR, `Forex Market Status: ${marketStatus.status}`);
    logger.debug(LogCategory.POLLING_COORDINATOR, `Crypto markets: Always Open (24/7)`);

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await pollingConfigService.loadUserConfig(user.id);
    }

    for (const symbol of this.ALL_TRADING_PAIRS) {
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
    }

    logger.debug(LogCategory.POLLING_COORDINATOR, `Starting polling for all ${this.ALL_TRADING_PAIRS.length} pairs...`);
    logger.debug(LogCategory.POLLING_COORDINATOR, `  Forex/Indices: ${this.FOREX_PAIRS.length} pairs (market-hours aware)`);
    logger.debug(LogCategory.POLLING_COORDINATOR, `  Crypto: ${this.CRYPTO_PAIRS.length} pairs (24/7)`);

    this.isPaused = false;
    this.pauseReason = null;
    this.startAllPolling();

    this.startMarketStatusMonitoring();

    this.initialized = true;
    logger.debug(LogCategory.POLLING_COORDINATOR, `Read-only polling coordinator initialized for ${this.ALL_TRADING_PAIRS.length} pairs`);
    logger.debug(LogCategory.POLLING_COORDINATOR, 'All price data is fetched by server-side cron job');
    logger.debug(LogCategory.POLLING_COORDINATOR, 'Browser only reads from database for UI updates');
    this.notifyListeners();
  }

  private setupVisibilityHandling(): void {
    if (typeof document === 'undefined') return;

    let visibilityTimeout: NodeJS.Timeout | null = null;
    let focusTimeout: NodeJS.Timeout | null = null;

    const handleVisibilityChange = () => {
      const wasVisible = this.isTabVisible;
      this.isTabVisible = !document.hidden;

      if (!wasVisible && this.isTabVisible) {
        // Debounce visibility checks to prevent conflicts with IDE
        if (visibilityTimeout) {
          clearTimeout(visibilityTimeout);
        }

        visibilityTimeout = setTimeout(() => {
          console.log('👁️ Tab became visible - verifying polling status (debounced)...');
          this.verifyPollingHealth();
          visibilityTimeout = null;
        }, 2000); // 2 second debounce
      } else if (wasVisible && !this.isTabVisible) {
        // Clear pending checks when hidden
        if (visibilityTimeout) {
          clearTimeout(visibilityTimeout);
          visibilityTimeout = null;
        }

        if (this.hasActiveSessions) {
          console.log('🙈 Tab hidden but 🛡️ ACTIVE GOAL SESSIONS detected');
          console.log('✅ Maintaining full polling despite tab visibility');
          console.log('ℹ️ Protected symbols will continue at normal rate');
        } else {
          console.log('🙈 Tab hidden - browser-side polling will be throttled (expected)');
          console.log('✅ Server-side polling continues normally, reading from database');
          console.log('ℹ️ System will NOT panic or failover due to throttling');
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Debounce focus events as well
    window.addEventListener('focus', () => {
      if (focusTimeout) {
        clearTimeout(focusTimeout);
      }

      focusTimeout = setTimeout(() => {
        logger.debug(LogCategory.POLLING_COORDINATOR, '🔍 Window focused - checking polling health (debounced)...');
        this.verifyPollingHealth();
        focusTimeout = null;
      }, 2000); // 2 second debounce
    });

    logger.debug(LogCategory.POLLING_COORDINATOR, '✅ Visibility change handlers installed (with debouncing)');
  }

  private startHeartbeatMonitoring(): void {
    logger.debug(LogCategory.POLLING_COORDINATOR, `💓 Starting heartbeat monitoring (every ${this.HEARTBEAT_INTERVAL_MS}ms)...`);

    const heartbeat = () => {
      const now = new Date();
      const timeSinceLastHeartbeat = now.getTime() - this.lastHeartbeat.getTime();
      const expectedInterval = this.HEARTBEAT_INTERVAL_MS;
      const drift = timeSinceLastHeartbeat - expectedInterval;

      if (drift > expectedInterval * 2) {
        // 🚨 CRITICAL FIX: Don't panic if tab is hidden - browser throttling is EXPECTED
        if (!this.isTabVisible) {
          console.log(`ℹ️ Timer throttled (tab hidden) - this is expected behavior (${Math.round(drift)}ms drift)`);
          this.missedHeartbeats = 0; // Reset counter - tab visibility throttling is normal
          this.lastHeartbeat = now;
          return;
        }

        this.missedHeartbeats++;

        // Use higher threshold when active sessions exist
        const effectiveThreshold = this.hasActiveSessions
          ? this.activeSessionHeartbeatThreshold
          : this.MAX_MISSED_HEARTBEATS;

        console.warn(
          `⚠️ Heartbeat drift detected: ${Math.round(drift)}ms ` +
          `(expected ${expectedInterval}ms). Missed: ${this.missedHeartbeats}/${effectiveThreshold}` +
          (this.hasActiveSessions ? ' (active sessions mode)' : '')
        );

        if (this.missedHeartbeats >= effectiveThreshold) {
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
    // 🚨 CRITICAL FIX: Don't recover if tab is hidden - throttling is EXPECTED behavior
    if (!this.isTabVisible) {
      console.log('ℹ️ Tab hidden - accepting browser throttling (server-side polling continues)');
      return;
    }

    console.log('🔧 Recovering from timer throttling...');

    this.pollStatus.forEach((status, symbol) => {
      // 🛡️ CRITICAL: Skip protected symbols
      if (this.isSymbolProtected(symbol)) {
        console.log(`🛡️ [${symbol}] Protected by active session - skipping recovery`);
        return;
      }

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
    let protectedCount = 0;
    const now = Date.now();

    this.pollStatus.forEach((status, symbol) => {
      // 🛡️ CRITICAL: Protected symbols always count as healthy
      if (this.isSymbolProtected(symbol)) {
        protectedCount++;
        activeCount++;
        console.log(`  [${symbol}] 🛡️ Protected by active session - always healthy`);
        return;
      }

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
      `Health check complete: ${activeCount} active (${protectedCount} protected), ${staleCount} stale/dead of ${this.ALL_TRADING_PAIRS.length} pairs`
    );

    if (staleCount > this.ALL_TRADING_PAIRS.length / 2 && !this.hasActiveSessions) {
      console.error('❌ Majority of pairs are stale - initiating full restart');
      this.restartPolling();
    } else if (this.hasActiveSessions) {
      console.log('🛡️ Active sessions present - skipping full restart despite stale pairs');
    }
  }

  private startAllPolling(): void {
    logger.debug(LogCategory.POLLING_COORDINATOR, `Starting read-only polling for all ${this.ALL_TRADING_PAIRS.length} trading pairs...`);
    for (const symbol of this.ALL_TRADING_PAIRS) {
      this.startPollingForSymbol(symbol);
    }
    this.isPaused = false;
    this.pauseReason = null;
    this.notifyListeners();
  }

  private stopAllPolling(): void {
    console.log('Stopping all polling...');
    for (const symbol of this.ALL_TRADING_PAIRS) {
      this.stopPollingForSymbol(symbol);
    }
    this.notifyListeners();
  }

  private stopForexPolling(): void {
    console.log('Stopping forex/indices polling (market closed)...');
    for (const symbol of this.FOREX_PAIRS) {
      this.stopPollingForSymbol(symbol);
    }
    console.log('Crypto polling continues (24/7)');
    this.notifyListeners();
  }

  private startForexPolling(): void {
    console.log('Starting forex/indices polling (market open)...');
    for (const symbol of this.FOREX_PAIRS) {
      this.startPollingForSymbol(symbol);
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

  protectSymbol(symbol: string, sessionId: string): void {
    if (!this.protectedSymbols.has(symbol)) {
      this.protectedSymbols.set(symbol, new Set());
    }
    this.protectedSymbols.get(symbol)!.add(sessionId);
    console.log(`[GlobalCoordinator] 🛡️ Protected ${symbol} for session ${sessionId}`);

    // Upgrade to ultra-critical priority (250ms polling for active goal sessions)
    const status = this.pollStatus.get(symbol);
    if (status) {
      status.priority = 'ultra-critical';
      status.currentInterval = pollingConfigService.getIntervalForPriority('ultra-critical');
      console.log(`[GlobalCoordinator] ⚡ Upgraded ${symbol} to ULTRA-CRITICAL (${status.currentInterval}ms polling)`);

      // Restart polling with new interval
      if (this.pollIntervals.has(symbol)) {
        this.stopPollingForSymbol(symbol);
      }
      this.startPollingForSymbol(symbol);
    }
  }

  unprotectSymbol(symbol: string, sessionId: string): void {
    const sessions = this.protectedSymbols.get(symbol);
    if (sessions) {
      sessions.delete(sessionId);
      if (sessions.size === 0) {
        this.protectedSymbols.delete(symbol);
        console.log(`[GlobalCoordinator] ✅ Unprotected ${symbol} - no active sessions`);

        // Downgrade to normal priority
        const status = this.pollStatus.get(symbol);
        if (status) {
          this.updateSymbolPriority(symbol);
          console.log(`[GlobalCoordinator] ⬇️ Downgraded ${symbol} to ${status.priority} (${status.currentInterval}ms polling)`);
        }
      } else {
        console.log(`[GlobalCoordinator] 🛡️ ${symbol} still protected by ${sessions.size} session(s)`);
      }
    }
  }

  isSymbolProtected(symbol: string): boolean {
    const sessions = this.protectedSymbols.get(symbol);
    return sessions ? sessions.size > 0 : false;
  }

  notifyActiveSessions(hasActiveSessions: boolean): void {
    this.hasActiveSessions = hasActiveSessions;
    if (hasActiveSessions) {
      console.log('[GlobalCoordinator] 🛡️ Active sessions detected - increasing heartbeat tolerance');
    } else {
      console.log('[GlobalCoordinator] ✅ No active sessions - normal heartbeat tolerance');
    }
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
      const is24Hour = is24HourSymbol(symbol);

      if (!is24Hour) {
        const marketStatus = getForexMarketStatus();
        if (!marketStatus.isOpen) {
          return;
        }
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
        // Read from database with timeout protection
        // AbortController prevents hanging queries when tab loses focus
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 5000); // 5 second timeout

        const { data, error } = await supabase
          .from('realtime_prices')
          .select('bid, ask, broker_time, created_at')
          .eq('symbol', symbol)
          .order('created_at', { ascending: false })
          .limit(1)
          .abortSignal(abortController.signal)
          .maybeSingle();

        clearTimeout(timeoutId);

        if (error) {
          // Check if this is an AbortError (tab throttling) - this is EXPECTED behavior
          if (error.message?.includes('AbortError') || error.message?.includes('signal is aborted')) {
            logger.debug(LogCategory.POLLING_COORDINATOR, `ℹ️ [${symbol}] Query cancelled (tab throttling or timeout) - this is normal`);
          } else {
            // Real error - log as error
            console.error(`❌ [${symbol}] DB Read Error:`, error);
          }
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
        // Catch-all for unexpected errors
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Check if this is an AbortError - downgrade to debug
        if (errorMsg.includes('AbortError') || errorMsg.includes('signal is aborted') || errorMsg.includes('aborted')) {
          logger.debug(LogCategory.POLLING_COORDINATOR, `ℹ️ [${symbol}] Query aborted (browser throttling) - expected when tab hidden`);
        } else {
          // Real error - log as error
          console.error(`❌ [${symbol}] Poll failed:`, errorMsg);
        }

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

      // CRYPTO FIX: Market just opened - resume forex polling (crypto never stopped)
      if (marketStatus.isOpen && this.isPaused && this.pauseReason === 'market_closed') {
        console.log('🟢 Forex market opened! Resuming forex polling...');
        this.isPaused = false;
        this.pauseReason = null;
        this.startForexPolling();
        this.notifyListeners();
      }
      // CRYPTO FIX: Market just closed - stop only forex polling (keep crypto active 24/7)
      else if (!marketStatus.isOpen && (!this.isPaused || this.pauseReason !== 'market_closed')) {
        console.log('🔴 Forex market closed! Stopping forex polling (crypto continues 24/7)...');
        this.isPaused = true;
        this.pauseReason = 'market_closed';
        this.stopForexPolling();
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
      totalPairs: this.ALL_TRADING_PAIRS.length,
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
      console.log('Manually resuming polling...');
      this.isPaused = false;
      this.pauseReason = null;
      this.startAllPolling();
    }
  }

  restartPolling(): void {
    logger.debug(LogCategory.POLLING_COORDINATOR, 'Restarting all polling...');
    this.stopAllPolling();

    setTimeout(() => {
      this.isPaused = false;
      this.pauseReason = null;
      this.startAllPolling();
    }, 1000);
  }
}

export const globalPollingCoordinator = new GlobalPollingCoordinator();
