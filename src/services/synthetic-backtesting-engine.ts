/**
 * Synthetic Backtesting Engine - Type Definitions
 *
 * This file provides stub implementations for synthetic backtesting.
 * The actual functionality would query synthetic_backtest_sessions and synthetic_backtest_trades tables.
 */

export interface SyntheticBacktestConfig {
  symbol: string;
  strategy: string;
  start_date: string;
  end_date: string;
  initial_balance: number;
  max_risk_per_trade: number;
}

export interface SyntheticBacktestResult {
  session_id: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  profit_factor: number;
  final_balance: number;
  max_drawdown: number;
}

export const syntheticBacktestingEngine = {
  runSyntheticBacktest: async (config: SyntheticBacktestConfig): Promise<SyntheticBacktestResult | null> => {
    console.warn('[synthetic-backtesting-engine] runSyntheticBacktest called but not implemented');
    console.warn('This would need to query synthetic_backtest_sessions and synthetic_backtest_trades tables');
    return null;
  }
};
