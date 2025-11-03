import { supabase } from '@/lib/supabase';
import { getForexMarketStatus } from '@/utils/marketHours';
import { areFunctionsAvailable, isWebContainer, logEnvironmentInfo } from '@/lib/environment';
import { smartRequestQueue } from './smart-request-queue';
import { pollingConfigService, SymbolPriority } from './polling-config-service';

interface PollStatus {
  symbol: string;
  lastPoll: Date;
  lastPrice: { bid: number; ask: number } | null;
  errorCount: number;
  successCount: number;
  isPolling: boolean;
  lastError: string | null;
  lastSuccessfulPoll: Date | null;
  consecutiveErrors: number;
  backoffDelay: number;
  nextRetryTime: Date | null;
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
  totalErrors: number;
  pairStatuses: Array<{
    symbol: string;
    status: 'active' | 'stale' | 'error' | 'starting';
    lastPrice: { bid: number; ask: number } | null;
    lastError: string | null;
    errorCount: number;
    successCount: number;
    lastSuccessfulPoll: Date | null;
  }>;
}

class GlobalPollingCoordinator {
  private initialized = false;
  private pollIntervals: Map<string, NodeJS.Timeout> = new Map();
  private pollStatus: Map<string, PollStatus> = new Map();
  private statusLoggingInterval: NodeJS.Timeout | null = null;
  private marketCheckInterval: NodeJS.Timeout | null = null;
  private isPaused = false;
  private pauseReason: 'market_closed' | 'manual' | null = null;
  private listeners: Set<(status: CoordinatorStatus) => void> = new Set();

  private readonly FOREX_PAIRS = [
    'XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF',
    'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'
  ];

  private readonly MARKET_CHECK_INTERVAL = 60000;
  private readonly MAX_BACKOFF_DELAY = 60000;
  private readonly BASE_BACKOFF_DELAY = 2000;
  private readonly MAX_CONSECUTIVE_ERRORS = 5;
  private viewedSymbols: Set<string> = new Set();
  private symbolsWithPositions: Set<string> = new Set();

  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('⚠️ Global polling coordinator already initialized');
      return;
    }

    console.log('🚀 Initializing global polling coordinator for all forex pairs...');
    logEnvironmentInfo();

    if (!areFunctionsAvailable()) {
      console.warn('⚠️ Netlify Functions not available in this environment');
      console.log('ℹ️ Live polling requires production environment (pipnosis.com or *.netlify.app)');
      console.log('ℹ️ In development, the app will use cached price data from Supabase');
      this.initialized = true;
      this.isPaused = true;
      this.pauseReason = 'manual';
      return;
    }

    const marketStatus = getForexMarketStatus();
    console.log(`📊 Current Market Status: ${marketStatus.status}`);

    console.log('🔍 Verifying MetaAPI connection before starting polling...');
    try {
      const verifyResponse = await fetch('/.netlify/functions/verify-metaapi-connection');

      if (!verifyResponse.ok) {
        console.error(`❌ MetaAPI verification failed: HTTP ${verifyResponse.status}`);
        const errorText = await verifyResponse.text();

        if (errorText.includes('<!doctype') || errorText.includes('<html')) {
          console.error('❌ Received HTML instead of JSON - Function endpoint not found');
          console.error('ℹ️ This usually means Netlify Functions are not deployed or accessible');
          console.error('ℹ️ Check that functions are being built and deployed in your Netlify configuration');
        } else {
          console.error('Error details:', errorText.substring(0, 500));
        }
        console.warn('⚠️ Proceeding with polling initialization despite verification failure...');
      } else {
        const verifyData = await verifyResponse.json();
        console.log('📡 MetaAPI Connection Status:', verifyData);

        if (!verifyData.healthy) {
          console.error('❌ MetaAPI connection is not healthy:', verifyData.diagnostics);
          if (verifyData.diagnostics?.issues) {
            console.error('🔴 Issues detected:');
            verifyData.diagnostics.issues.forEach((issue: string) => {
              console.error(`  - ${issue}`);
            });
          }
          if (verifyData.diagnostics?.recommendations) {
            console.log('💡 Recommendations:');
            verifyData.diagnostics.recommendations.forEach((rec: string) => {
              console.log(`  - ${rec}`);
            });
          }
          console.warn('⚠️ Proceeding with polling initialization despite connection issues...');
        } else {
          console.log('✅ MetaAPI connection verified successfully');
          if (verifyData.diagnostics?.account) {
            console.log(`   Account ID: ${verifyData.diagnostics.account.id || 'N/A'}`);
            console.log(`   Account State: ${verifyData.diagnostics.account.state || 'N/A'}`);
            console.log(`   Connection Status: ${verifyData.diagnostics.account.connectionStatus || 'N/A'}`);
            console.log(`   Account Type: ${verifyData.diagnostics.account.type || 'N/A'}`);
          } else {
            console.warn('⚠️ Account diagnostics not available in response');
          }
        }
      }
    } catch (verifyError) {
      console.error('❌ Failed to verify MetaAPI connection:', verifyError);
      if (verifyError instanceof Error) {
        console.error('Error message:', verifyError.message);

        if (verifyError.message.includes('JSON')) {
          console.error('💡 Tip: The function returned HTML instead of JSON');
          console.error('💡 Make sure Netlify Functions are deployed and accessible');
          console.error('💡 Check the Netlify deploy logs for function build errors');
        }
      }
      console.warn('⚠️ Proceeding with polling initialization anyway...');
    }

    smartRequestQueue.start();

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await pollingConfigService.loadUserConfig(user.id);
    }

    for (const symbol of this.FOREX_PAIRS) {
      this.pollStatus.set(symbol, {
        symbol,
        lastPoll: new Date(),
        lastPrice: null,
        errorCount: 0,
        successCount: 0,
        isPolling: false,
        lastError: null,
        lastSuccessfulPoll: null,
        consecutiveErrors: 0,
        backoffDelay: 0,
        nextRetryTime: null,
        priority: 'normal',
        currentInterval: 2000,
        isViewed: false
      });
    }

    if (marketStatus.isOpen) {
      console.log('✅ Market is open, starting polling...');
      this.startAllPolling();
    } else {
      console.log('⏸️ Market is closed, polling will start when market opens');
      this.isPaused = true;
      this.pauseReason = 'market_closed';
    }

    this.startMarketStatusMonitoring();

    this.initialized = true;
    console.log(`✅ Global polling coordinator initialized for ${this.FOREX_PAIRS.length} pairs`);
    this.notifyListeners();
  }

  private startAllPolling(): void {
    console.log(`🔄 Starting polling for all ${this.FOREX_PAIRS.length} forex pairs...`);
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

      if (this.pollIntervals.has(symbol)) {
        this.stopPollingForSymbol(symbol);
        this.startPollingForSymbol(symbol);
      }
    }
  }

  private startPollingForSymbol(symbol: string): void {
    if (this.pollIntervals.has(symbol)) {
      console.warn(`⚠️ Polling already active for ${symbol}`);
      return;
    }

    const status = this.pollStatus.get(symbol);
    if (!status) return;

    const pollFunction = async () => {
      if (this.isPaused) {
        return;
      }

      const status = this.pollStatus.get(symbol);
      if (!status) return;

      if (status.isPolling) {
        return;
      }

      if (status.nextRetryTime && Date.now() < status.nextRetryTime.getTime()) {
        return;
      }

      status.isPolling = true;

      try {
        const priceData = await smartRequestQueue.requestPrice(symbol, status.priority);

        const { error: insertError } = await supabase
          .from('realtime_prices')
          .insert({
            symbol: symbol,
            bid: priceData.bid,
            ask: priceData.ask,
            mid: priceData.mid,
            spread: priceData.spread,
            broker_time: priceData.timestamp,
            source: priceData.source
          });

        if (insertError) {
          console.error(`❌ [${symbol}] DB Insert Error:`, insertError);
          status.errorCount++;
          status.consecutiveErrors++;
          status.lastError = `DB: ${insertError.message}`;
          this.applyBackoff(status);
        } else {
          console.log(`✅ [${symbol}] Price updated: ${priceData.bid}/${priceData.ask} (${status.priority}, ${status.currentInterval}ms)`);
          status.lastPrice = { bid: priceData.bid, ask: priceData.ask };
          status.lastPoll = new Date();
          status.lastSuccessfulPoll = new Date();
          status.successCount++;
          status.consecutiveErrors = 0;
          status.backoffDelay = 0;
          status.nextRetryTime = null;
          status.lastError = null;
          this.notifyListeners();
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`❌ [${symbol}] Poll failed:`, errorMsg);
        status.lastError = errorMsg;
        status.errorCount++;
        status.consecutiveErrors++;
        this.applyBackoff(status);
        this.notifyListeners();
      } finally {
        status.isPolling = false;
      }
    };

    pollFunction();
    const interval = setInterval(pollFunction, status.currentInterval);
    this.pollIntervals.set(symbol, interval);

    console.log(`✅ Started polling for ${symbol} (${status.priority} priority, every ${status.currentInterval}ms)`);
  }

  private applyBackoff(status: PollStatus): void {
    if (status.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
      status.backoffDelay = Math.min(
        this.BASE_BACKOFF_DELAY * Math.pow(2, status.consecutiveErrors - this.MAX_CONSECUTIVE_ERRORS),
        this.MAX_BACKOFF_DELAY
      );
      status.nextRetryTime = new Date(Date.now() + status.backoffDelay);

      console.warn(
        `⏱️ [${status.symbol}] Applying backoff: ${status.consecutiveErrors} consecutive errors, ` +
        `waiting ${Math.round(status.backoffDelay / 1000)}s before retry`
      );
    }
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

    this.marketCheckInterval = setInterval(() => {
      const marketStatus = getForexMarketStatus();

      if (marketStatus.isOpen && this.isPaused && this.pauseReason === 'market_closed') {
        console.log('🟢 Market opened! Resuming polling...');
        this.isPaused = false;
        this.pauseReason = null;
        this.startAllPolling();
      } else if (!marketStatus.isOpen && !this.isPaused) {
        console.log('🔴 Market closed! Pausing polling...');
        this.isPaused = true;
        this.pauseReason = 'market_closed';
        this.stopAllPolling();
      }
    }, this.MARKET_CHECK_INTERVAL);

    console.log(`✅ Market status monitoring started (checking every ${this.MARKET_CHECK_INTERVAL / 1000}s)`);
  }

  async shutdown(): Promise<void> {
    console.log('🛑 Shutting down global polling coordinator...');

    for (const symbol of this.FOREX_PAIRS) {
      this.stopPollingForSymbol(symbol);
    }

    if (this.statusLoggingInterval) {
      clearInterval(this.statusLoggingInterval);
      this.statusLoggingInterval = null;
    }

    if (this.marketCheckInterval) {
      clearInterval(this.marketCheckInterval);
      this.marketCheckInterval = null;
    }

    smartRequestQueue.stop();
    this.pollStatus.clear();
    this.viewedSymbols.clear();
    this.symbolsWithPositions.clear();
    this.initialized = false;

    console.log('✅ Global polling coordinator shutdown complete');
  }

  startStatusLogging(interval: number): void {
    if (this.statusLoggingInterval) {
      clearInterval(this.statusLoggingInterval);
    }

    this.statusLoggingInterval = setInterval(() => {
      const summary = Array.from(this.pollStatus.entries()).map(([symbol, status]) => {
        const timeSinceLastPoll = Date.now() - status.lastPoll.getTime();
        const isStale = timeSinceLastPoll > status.currentInterval * 3;

        return {
          symbol,
          lastPrice: status.lastPrice,
          timeSinceLastPoll: Math.floor(timeSinceLastPoll / 1000),
          errorCount: status.errorCount,
          status: isStale ? '🔴 STALE' : '🟢 ACTIVE'
        };
      });

      console.log('📊 Global Polling Status:', summary);
    }, interval);
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
    let totalErrors = 0;
    const pairStatuses: CoordinatorStatus['pairStatuses'] = [];

    this.pollStatus.forEach(status => {
      totalSuccesses += status.successCount;
      totalErrors += status.errorCount;

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
      } else if (status.errorCount > 3) {
        pairStatus = 'error';
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
        lastError: status.lastError,
        errorCount: status.errorCount,
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
      totalErrors,
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
        this.startAllPolling();
      } else {
        console.warn('⚠️ Cannot resume polling: Market is currently closed');
      }
    }
  }

  restartPolling(): void {
    console.log('🔄 Restarting all polling...');
    this.stopAllPolling();

    this.pollStatus.forEach(status => {
      status.errorCount = 0;
      status.consecutiveErrors = 0;
      status.backoffDelay = 0;
      status.nextRetryTime = null;
      status.lastError = null;
    });

    setTimeout(() => {
      const marketStatus = getForexMarketStatus();
      if (marketStatus.isOpen) {
        this.startAllPolling();
      } else {
        console.warn('⚠️ Market is currently closed');
        this.isPaused = true;
        this.pauseReason = 'market_closed';
      }
    }, 1000);
  }
}

export const globalPollingCoordinator = new GlobalPollingCoordinator();
