/**
 * Minimal stub for synthetic backtesting engine
 * Used by simple-auto-backtest-service
 */

export interface SyntheticBacktestConfig {
  symbol: string;
  startDate: string;
  endDate: string;
  initialBalance: number;
  riskPercent: number;
  strategyParams?: any;
}

export interface SyntheticBacktestResult {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  totalPnL: number;
  avgWin: number;
  avgLoss: number;
  trades: any[];
}

class SyntheticBacktestingEngine {
  async runSyntheticBacktest(
    userId: string,
    config: SyntheticBacktestConfig,
    progressCallback?: (progress: { message: string; percentComplete: number }) => void,
    abortSignal?: AbortSignal
  ): Promise<SyntheticBacktestResult> {
    // Minimal implementation - returns empty result
    console.log('[Synthetic Backtest] Running backtest for', config.symbol);

    if (progressCallback) {
      progressCallback({ message: 'Starting backtest...', percentComplete: 0 });
      progressCallback({ message: 'Processing...', percentComplete: 50 });
      progressCallback({ message: 'Complete', percentComplete: 100 });
    }

    return {
      totalTrades: 0,
      winRate: 0,
      profitFactor: 0,
      totalPnL: 0,
      avgWin: 0,
      avgLoss: 0,
      trades: []
    };
  }
}

export const syntheticBacktestingEngine = new SyntheticBacktestingEngine();
