import { supabase } from '@/lib/supabase';

interface PollStatus {
  symbol: string;
  lastPoll: Date;
  lastPrice: { bid: number; ask: number } | null;
  errorCount: number;
  isPolling: boolean;
}

class GlobalPollingCoordinator {
  private initialized = false;
  private pollIntervals: Map<string, NodeJS.Timeout> = new Map();
  private pollStatus: Map<string, PollStatus> = new Map();
  private statusLoggingInterval: NodeJS.Timeout | null = null;

  private readonly FOREX_PAIRS = [
    'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD',
    'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'
  ];

  private readonly POLL_INTERVAL = 5000;

  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('⚠️ Global polling coordinator already initialized');
      return;
    }

    console.log('🚀 Initializing global polling coordinator for all forex pairs...');

    console.log('🔍 Verifying MetaAPI connection before starting polling...');
    try {
      const verifyResponse = await fetch('/.netlify/functions/verify-metaapi-connection');
      const verifyData = await verifyResponse.json();

      console.log('📡 MetaAPI Connection Status:', verifyData);

      if (!verifyData.healthy) {
        console.error('❌ MetaAPI connection is not healthy:', verifyData.diagnostics);
        if (verifyData.diagnostics?.issues) {
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
        console.log(`   Account State: ${verifyData.diagnostics?.account?.state}`);
        console.log(`   Connection Status: ${verifyData.diagnostics?.account?.connectionStatus}`);
      }
    } catch (verifyError) {
      console.error('❌ Failed to verify MetaAPI connection:', verifyError);
      console.warn('⚠️ Proceeding with polling initialization anyway...');
    }

    for (const symbol of this.FOREX_PAIRS) {
      this.pollStatus.set(symbol, {
        symbol,
        lastPoll: new Date(),
        lastPrice: null,
        errorCount: 0,
        isPolling: false
      });

      this.startPollingForSymbol(symbol);
    }

    this.initialized = true;
    console.log(`✅ Global polling coordinator initialized for ${this.FOREX_PAIRS.length} pairs`);
  }

  private startPollingForSymbol(symbol: string): void {
    if (this.pollIntervals.has(symbol)) {
      console.warn(`⚠️ Polling already active for ${symbol}`);
      return;
    }

    const pollFunction = async () => {
      const status = this.pollStatus.get(symbol);
      if (!status) return;

      if (status.isPolling) {
        return;
      }

      status.isPolling = true;

      try {
        const response = await fetch(`/.netlify/functions/get-live-price?symbol=${symbol}`);
        const data = await response.json();

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
            console.error(`❌ Failed to insert price for ${symbol}:`, insertError);
            status.errorCount++;
          } else {
            status.lastPrice = { bid, ask };
            status.lastPoll = new Date();
            status.errorCount = 0;
          }
        } else {
          console.warn(`⚠️ Invalid price data for ${symbol}:`, data);
          status.errorCount++;
        }
      } catch (error) {
        console.error(`❌ Failed to poll ${symbol}:`, error);
        status.errorCount++;
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

  async shutdown(): Promise<void> {
    console.log('🛑 Shutting down global polling coordinator...');

    for (const symbol of this.FOREX_PAIRS) {
      this.stopPollingForSymbol(symbol);
    }

    if (this.statusLoggingInterval) {
      clearInterval(this.statusLoggingInterval);
      this.statusLoggingInterval = null;
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
}

export const globalPollingCoordinator = new GlobalPollingCoordinator();
