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
    console.log('[Auto-Backtest API] Starting controller via Edge Function...');
    return await this.callEdgeFunction('auto-backtest-control', { action: 'start' });
  }

  async stop(): Promise<ControllerResponse> {
    console.log('[Auto-Backtest API] Stopping controller via Edge Function...');
    return await this.callEdgeFunction('auto-backtest-control', { action: 'stop' });
  }

  async getStatus(): Promise<ControllerResponse> {
    return await this.callEdgeFunction('auto-backtest-control', { action: 'status' });
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
}

export const autoBacktestAPI = new AutoBacktestAPI();
