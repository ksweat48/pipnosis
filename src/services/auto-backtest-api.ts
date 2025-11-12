import { supabase } from '../lib/supabase';

export interface AutoBacktestState {
  id: string;
  status: 'running' | 'stopped' | 'paused_for_live_trade' | 'cooldown';
  isActive: boolean;
  totalBacktestsCompleted: number;
  consecutiveRuns: number;
  currentCycleCount: number;
  cooldownActive: boolean;
  cooldownEndsAt?: string;
  cooldownReason?: string;
  systemStressScore: number;
  pausedForLiveTrade: boolean;
  startedAt?: string;
  stoppedAt?: string;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface ControllerResponse {
  success: boolean;
  controller: AutoBacktestState | null;
  queueStats?: QueueStats;
  message?: string;
  controllerId?: string;
  error?: string;
}

export interface BacktestProgress {
  id: string;
  backtestId: string;
  currentStep: string;
  progressPercentage: number;
  phase: string;
  currentCandle: number;
  totalCandles: number;
  candlesPerSecond: number;
  tradesExecuted: number;
  winningTrades: number;
  losingTrades: number;
  currentWinRate: number;
  currentProfitLoss: number;
  memoryUsageMb: number;
  cpuUsagePercent: number;
  estimatedCompletionTime?: string;
  startedAt: string;
  lastUpdatedAt: string;
  status: string;
  timeElapsedSeconds: number;
}

export interface ExecutionLog {
  id: string;
  backtestId: string;
  stepName: string;
  stepType: string;
  status: string;
  message?: string;
  timestamp: string;
  durationMs?: number;
  memorySnapshotMb?: number;
  cpuSnapshotPercent?: number;
}

export interface SystemPerformanceMetrics {
  totalActiveBacktests: number;
  avgMemoryUsageMb: number;
  avgCpuUsagePercent: number;
  totalCandlesProcessed: number;
  avgProcessingSpeed: number;
  successRate: number;
}

class AutoBacktestAPI {
  private getEdgeFunctionUrl(functionName: string): string {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    return `${supabaseUrl}/functions/v1/${functionName}`;
  }

  private async callEdgeFunction(functionName: string, body: any): Promise<ControllerResponse> {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      throw new Error('No active session');
    }

    const url = this.getEdgeFunctionUrl(functionName);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return await response.json();
  }

  async start(): Promise<ControllerResponse> {
    console.log('[Auto-Backtest API] 🚀 Starting controller via Edge Function...');
    const result = await this.callEdgeFunction('auto-backtest-control', { action: 'start' });
    console.log('[Auto-Backtest API] Start result:', result);
    return result;
  }

  async stop(): Promise<ControllerResponse> {
    console.log('[Auto-Backtest API] 🛑 Stopping controller via Edge Function...');
    const result = await this.callEdgeFunction('auto-backtest-control', { action: 'stop' });
    console.log('[Auto-Backtest API] Stop result:', result);
    return result;
  }

  async getStatus(): Promise<ControllerResponse> {
    console.log('[Auto-Backtest API] 📊 Fetching controller status...');
    const result = await this.callEdgeFunction('auto-backtest-control', { action: 'status' });
    console.log('[Auto-Backtest API] Status result:', result);
    return result;
  }

  async getRecentJobs(userId: string, limit: number = 10): Promise<any[]> {
    const { data, error } = await supabase
      .from('auto_backtest_queue')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[Auto-Backtest API] Error fetching recent jobs:', error);
      return [];
    }

    return data || [];
  }

  async getHealthLogs(userId: string, limit: number = 20): Promise<any[]> {
    const { data, error } = await supabase
      .from('auto_backtest_health_log')
      .select('*')
      .eq('user_id', userId)
      .order('logged_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[Auto-Backtest API] Error fetching health logs:', error);
      return [];
    }

    return data || [];
  }

  async getConfig(userId: string): Promise<any> {
    const { data, error } = await supabase
      .from('auto_backtest_config')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('[Auto-Backtest API] Error fetching config:', error);
      return null;
    }

    return data;
  }

  async updateConfig(userId: string, config: any): Promise<boolean> {
    const { error } = await supabase
      .from('auto_backtest_config')
      .update(config)
      .eq('user_id', userId);

    if (error) {
      console.error('[Auto-Backtest API] Error updating config:', error);
      return false;
    }

    return true;
  }

  // Progress Tracking Methods

  async getActiveBacktestsProgress(userId: string): Promise<BacktestProgress[]> {
    try {
      console.log('[Auto-Backtest API] Fetching active backtests for user:', userId);
      const { data, error } = await supabase
        .rpc('get_active_backtests', { p_user_id: userId });

      if (error) {
        console.error('[Auto-Backtest API] Error fetching active backtests:', error);
        return [];
      }

      console.log(`[Auto-Backtest API] Found ${data?.length || 0} active backtest(s)`);

      return (data || []).map((row: any) => ({
        id: row.id || row.backtest_id,
        backtestId: row.backtest_id,
        currentStep: row.current_step,
        progressPercentage: row.progress_percentage || 0,
        phase: row.phase,
        currentCandle: row.candles_processed || 0,
        totalCandles: row.total_candles || 0,
        candlesPerSecond: parseFloat(row.candles_per_second) || 0,
        tradesExecuted: row.trades_executed || 0,
        winningTrades: 0,
        losingTrades: 0,
        currentWinRate: parseFloat(row.current_win_rate) || 0,
        currentProfitLoss: 0,
        memoryUsageMb: row.memory_usage_mb || 0,
        cpuUsagePercent: parseFloat(row.cpu_usage_percent) || 0,
        estimatedCompletionTime: row.estimated_completion_time,
        startedAt: row.started_at,
        lastUpdatedAt: row.last_updated_at,
        status: row.status,
        timeElapsedSeconds: row.time_elapsed_seconds || 0
      }));
    } catch (err) {
      console.error('[Auto-Backtest API] Exception fetching active backtests:', err);
      return [];
    }
  }

  async getBacktestProgress(backtestId: string): Promise<BacktestProgress | null> {
    try {
      const { data, error } = await supabase
        .from('backtest_progress_tracking')
        .select('*')
        .eq('backtest_id', backtestId)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return {
        id: data.id,
        backtestId: data.backtest_id,
        currentStep: data.current_step,
        progressPercentage: data.progress_percentage || 0,
        phase: data.phase,
        currentCandle: data.current_candle || 0,
        totalCandles: data.total_candles || 0,
        candlesPerSecond: parseFloat(data.candles_per_second) || 0,
        tradesExecuted: data.trades_executed || 0,
        winningTrades: data.winning_trades || 0,
        losingTrades: data.losing_trades || 0,
        currentWinRate: parseFloat(data.current_win_rate) || 0,
        currentProfitLoss: parseFloat(data.current_profit_loss) || 0,
        memoryUsageMb: data.memory_usage_mb || 0,
        cpuUsagePercent: parseFloat(data.cpu_usage_percent) || 0,
        estimatedCompletionTime: data.estimated_completion_time,
        startedAt: data.started_at,
        lastUpdatedAt: data.last_updated_at,
        status: data.status,
        timeElapsedSeconds: Math.floor((new Date().getTime() - new Date(data.started_at).getTime()) / 1000)
      };
    } catch (err) {
      console.error('[Auto-Backtest API] Exception fetching backtest progress:', err);
      return null;
    }
  }

  async getExecutionLogs(backtestId: string, limit: number = 50): Promise<ExecutionLog[]> {
    try {
      const { data, error } = await supabase
        .from('backtest_execution_logs')
        .select('*')
        .eq('backtest_id', backtestId)
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[Auto-Backtest API] Error fetching execution logs:', error);
        return [];
      }

      return (data || []).map((row: any) => ({
        id: row.id,
        backtestId: row.backtest_id,
        stepName: row.step_name,
        stepType: row.step_type,
        status: row.status,
        message: row.message,
        timestamp: row.timestamp,
        durationMs: row.duration_ms,
        memorySnapshotMb: row.memory_snapshot_mb,
        cpuSnapshotPercent: parseFloat(row.cpu_snapshot_percent)
      }));
    } catch (err) {
      console.error('[Auto-Backtest API] Exception fetching execution logs:', err);
      return [];
    }
  }

  async getRecentCompletedBacktests(userId: string, limit: number = 10): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('backtest_progress_tracking')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['completed', 'failed'])
        .order('completed_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[Auto-Backtest API] Error fetching recent completed backtests:', error);
        return [];
      }

      return data || [];
    } catch (err) {
      console.error('[Auto-Backtest API] Exception fetching recent completed backtests:', err);
      return [];
    }
  }

  async getSystemPerformanceMetrics(userId: string): Promise<SystemPerformanceMetrics> {
    try {
      const { data, error } = await supabase
        .from('backtest_progress_tracking')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'running');

      if (error || !data) {
        return {
          totalActiveBacktests: 0,
          avgMemoryUsageMb: 0,
          avgCpuUsagePercent: 0,
          totalCandlesProcessed: 0,
          avgProcessingSpeed: 0,
          successRate: 0
        };
      }

      const totalActive = data.length;
      const avgMemory = totalActive > 0 ? data.reduce((sum, b) => sum + (b.memory_usage_mb || 0), 0) / totalActive : 0;
      const avgCpu = totalActive > 0 ? data.reduce((sum, b) => sum + (parseFloat(b.cpu_usage_percent) || 0), 0) / totalActive : 0;
      const totalCandles = data.reduce((sum, b) => sum + (b.current_candle || 0), 0);
      const avgSpeed = totalActive > 0 ? data.reduce((sum, b) => sum + (parseFloat(b.candles_per_second) || 0), 0) / totalActive : 0;

      return {
        totalActiveBacktests: totalActive,
        avgMemoryUsageMb: Math.round(avgMemory),
        avgCpuUsagePercent: Math.round(avgCpu * 10) / 10,
        totalCandlesProcessed: totalCandles,
        avgProcessingSpeed: Math.round(avgSpeed * 10) / 10,
        successRate: 0 // Will calculate from historical data if needed
      };
    } catch (err) {
      console.error('[Auto-Backtest API] Exception fetching system performance metrics:', err);
      return {
        totalActiveBacktests: 0,
        avgMemoryUsageMb: 0,
        avgCpuUsagePercent: 0,
        totalCandlesProcessed: 0,
        avgProcessingSpeed: 0,
        successRate: 0
      };
    }
  }

  async detectStuckBacktests(): Promise<void> {
    try {
      const { error } = await supabase.rpc('detect_stuck_backtests');
      if (error) {
        console.error('[Auto-Backtest API] Error detecting stuck backtests:', error);
      }
    } catch (err) {
      console.error('[Auto-Backtest API] Exception detecting stuck backtests:', err);
    }
  }
}

export const autoBacktestAPI = new AutoBacktestAPI();
