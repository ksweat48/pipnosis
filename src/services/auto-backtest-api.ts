/**
 * Auto-Backtest API - Type Definitions
 *
 * This file provides type definitions for auto-backtest functionality.
 * The actual implementation is handled by database tables and Supabase functions.
 *
 * Tables: auto_backtest_config, auto_backtest_queue, backtest_sessions, backtest_trades
 */

export interface BacktestProgress {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress_percentage: number;
  trades_executed: number;
  current_balance: number;
  created_at: string;
  updated_at: string;
}

export interface ExecutionLog {
  id: string;
  backtest_session_id: string;
  timestamp: string;
  event_type: string;
  message: string;
  metadata?: Record<string, any>;
}

// Stub functions - actual implementation would query Supabase tables
export const autoBacktestApi = {
  getProgress: async (sessionId: string): Promise<BacktestProgress | null> => {
    console.warn('[auto-backtest-api] getProgress called but not implemented');
    return null;
  },

  getLogs: async (sessionId: string): Promise<ExecutionLog[]> => {
    console.warn('[auto-backtest-api] getLogs called but not implemented');
    return [];
  }
};
