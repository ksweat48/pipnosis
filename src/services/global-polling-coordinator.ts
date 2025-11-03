import { supabase } from '@/lib/supabase';
import { getForexMarketStatus } from '@/utils/marketHours';

interface PollStatus {
  symbol: string;
  lastPoll: Date;
  lastPrice: { bid: number; ask: number } | null;
  errorCount: number;
  successCount: number;
  isPolling: boolean;
  lastError: string | null;
  lastSuccessfulPoll: Date | null;
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

  private readonly POLL_INTERVAL = 5000;
  private readonly MARKET_CHECK_INTERVAL = 60000;

  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('⚠️ Global polling coordinator already initialized');
      return;
    }

    console.log('🚀 Initializing global polling coordinator for all forex pairs...');

    const marketStatus = getForexMarketStatus();
    console.log(`📊 Current Market Status: ${marketStatus.status}`);

    console.log('🔍 Verifying MetaAPI connection before starting polling...');
    try {
      const verifyResponse = await fetch('/.netlify/functions/verify-metaapi-connection');

      if (!verifyResponse.ok) {
        console.error(`❌ MetaAPI verification failed: HTTP ${verifyResponse.status}`);
        const errorText = await verifyResponse.text();
        console.error('Error details:', errorText);
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
        console.error('Error stack:', verifyError.stack);
      }
      console.warn('⚠️ Proceeding with polling initialization anyway...');
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
        lastSuccessfulPoll: null
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

  private startPollingForSymbol(symbol: string): void {
    if (this.pollIntervals.has(symbol)) {
      console.warn(`⚠️ Polling already active for ${symbol}`);
      return;
    }

    const pollFunction = async () => {
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
        const response = await fetch(`/.netlify/functions/get-live-price?symbol=${symbol}`);

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ [${symbol}] HTTP ${response.status}: ${errorText}`);
          status.errorCount++;
          status.lastError = `HTTP ${response.status}: ${errorText.substring(0, 100)}`;
          status.isPolling = false;
          this.notifyListeners();
          return;
        }

        const data = await response.json();
        console.log(`📊 [${symbol}] Response:`, data);

        if (data.ok && data.bid && data.ask) {
          const bid = parseFloat(data.bid);
          const ask = parseFloat(data.ask);
          const mid = (bid + ask) / 2;
          const spread = ask - bid;

          const { error: insertError } = await supabase
            .from('realtime_prices')
            .insert({
              symbol: symbol,
              bid: bid,
              ask: ask,
              mid: mid,
              spread: spread,
              broker_time: data.timestamp || new Date().toISOString(),
              source: data.source || 'polling'
            });

          if (insertError) {
            console.error(`❌ [${symbol}] DB Insert Error:`, insertError);
            status.errorCount++;
            status.lastError = `DB: ${insertError.message}`;
          } else {
            console.log(`✅ [${symbol}] Price updated: ${bid}/${ask}`);
            status.lastPrice = { bid, ask };
            status.lastPoll = new Date();
            status.lastSuccessfulPoll = new Date();
            status.successCount++;
            status.errorCount = 0;
            status.lastError = null;
            this.notifyListeners();
          }
        } else {
          console.warn(`⚠️ [${symbol}] Invalid data:`, {
            ok: data.ok,
            bid: data.bid,
            ask: data.ask,
            error: data.error,
            message: data.message,
            fullResponse: data
          });
          status.errorCount++;
          status.lastError = data.error || data.message || 'Invalid price data';
          this.notifyListeners();
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`❌ [${symbol}] Poll failed:`, error);
        status.errorCount++;
        status.lastError = errorMsg;
        this.notifyListeners();
      } finally {
        status.isPolling = false;
      }
    };

    pollFunction();
    const interval = setInterval(pollFunction, this.POLL_INTERVAL);
    this.pollIntervals.set(symbol, interval);

    console.log(`✅ Started polling for ${symbol} (every ${this.POLL_INTERVAL}ms)`);
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

    this.pollStatus.clear();
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
        const isStale = timeSinceLastPoll > this.POLL_INTERVAL * 3;

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

    // Reset error counts
    this.pollStatus.forEach(status => {
      status.errorCount = 0;
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
