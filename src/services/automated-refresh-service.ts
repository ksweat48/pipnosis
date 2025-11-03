import { supabase } from '@/lib/supabase';
import { historicalDataService } from '@/services/historical-data-service';
import { Timeframe } from '@/services/chart-preferences';
import { getForexMarketStatus } from '@/utils/marketHours';

interface AutoRefreshConfig {
  enabled: boolean;
  symbols: string[];
  timeframes: Timeframe[];
  refreshIntervalMinutes: number;
  checkMarketHours: boolean;
}

interface RefreshTask {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  lastRun: Date | null;
  nextRun: Date | null;
  status: 'idle' | 'running' | 'failed';
}

class AutomatedRefreshService {
  private config: AutoRefreshConfig = {
    enabled: false,
    symbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'],
    timeframes: ['M1', 'M5', 'M15', 'M30', 'H1', 'D1', 'W1'],
    refreshIntervalMinutes: 60,
    checkMarketHours: true,
  };

  private refreshTimer: NodeJS.Timeout | null = null;
  private tasks: Map<string, RefreshTask> = new Map();
  private isRunning: boolean = false;

  constructor() {
    this.loadConfig();
  }

  private loadConfig() {
    const saved = localStorage.getItem('auto-refresh-config');
    if (saved) {
      try {
        this.config = JSON.parse(saved);
      } catch (error) {
        console.error('Failed to load auto-refresh config:', error);
      }
    }
  }

  private saveConfig() {
    localStorage.setItem('auto-refresh-config', JSON.stringify(this.config));
  }

  public getConfig(): AutoRefreshConfig {
    return { ...this.config };
  }

  public updateConfig(updates: Partial<AutoRefreshConfig>) {
    this.config = { ...this.config, ...updates };
    this.saveConfig();

    if (this.config.enabled) {
      this.start();
    } else {
      this.stop();
    }
  }

  public start() {
    if (this.refreshTimer) {
      this.stop();
    }

    console.log('[AutoRefresh] Starting automated refresh service');
    this.config.enabled = true;
    this.saveConfig();

    this.scheduleNextRefresh();

    this.refreshTimer = setInterval(() => {
      this.scheduleNextRefresh();
    }, this.config.refreshIntervalMinutes * 60 * 1000);
  }

  public stop() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    this.config.enabled = false;
    this.saveConfig();
    console.log('[AutoRefresh] Stopped automated refresh service');
  }

  private async scheduleNextRefresh() {
    if (this.isRunning) {
      console.log('[AutoRefresh] Refresh already in progress, skipping');
      return;
    }

    if (this.config.checkMarketHours) {
      const marketStatus = getForexMarketStatus();
      if (!marketStatus.isOpen) {
        console.log('[AutoRefresh] Market is closed, skipping refresh');
        return;
      }
    }

    this.isRunning = true;

    try {
      console.log('[AutoRefresh] Starting scheduled refresh cycle');
      await this.performRefresh();
    } catch (error) {
      console.error('[AutoRefresh] Refresh cycle failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  private async performRefresh() {
    for (const symbol of this.config.symbols) {
      for (const timeframe of this.config.timeframes) {
        const taskId = `${symbol}-${timeframe}`;

        try {
          const task: RefreshTask = {
            id: taskId,
            symbol,
            timeframe,
            lastRun: new Date(),
            nextRun: null,
            status: 'running',
          };

          this.tasks.set(taskId, task);

          await this.logRefreshStart(symbol, timeframe);

          const completeness = await historicalDataService.checkDataCompleteness(symbol, timeframe);

          let daysBack = 1;
          if (!completeness.hasData) {
            daysBack = 7;
          }

          const result = await historicalDataService.fetchAndSaveHistoricalData(
            symbol,
            timeframe,
            daysBack
          );

          if (result.status === 'completed') {
            await this.logRefreshSuccess(symbol, timeframe, result.candlesFetched || 0, result.candlesSaved || 0);
            await this.updateCompletenessStatus(symbol, timeframe);

            task.status = 'idle';
            task.nextRun = new Date(Date.now() + this.config.refreshIntervalMinutes * 60 * 1000);
          } else {
            await this.logRefreshFailure(symbol, timeframe, result.error || 'Unknown error');
            task.status = 'failed';
          }

          this.tasks.set(taskId, task);

          await new Promise(resolve => setTimeout(resolve, 500));

        } catch (error) {
          console.error(`[AutoRefresh] Error refreshing ${symbol} ${timeframe}:`, error);
          const task = this.tasks.get(taskId);
          if (task) {
            task.status = 'failed';
            this.tasks.set(taskId, task);
          }
          await this.logRefreshFailure(
            symbol,
            timeframe,
            error instanceof Error ? error.message : 'Unknown error'
          );
        }
      }
    }
  }

  private async logRefreshStart(symbol: string, timeframe: string) {
    try {
      await supabase.from('data_refresh_log').insert({
        symbol,
        timeframe,
        refresh_type: 'automatic',
        status: 'fetching',
        started_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Failed to log refresh start:', error);
    }
  }

  private async logRefreshSuccess(
    symbol: string,
    timeframe: string,
    candlesFetched: number,
    candlesSaved: number
  ) {
    try {
      const { data } = await supabase
        .from('data_refresh_log')
        .select('id, started_at')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .eq('status', 'fetching')
        .order('started_at', { ascending: false })
        .limit(1)
        .single();

      if (data) {
        const duration = Date.now() - new Date(data.started_at).getTime();

        await supabase
          .from('data_refresh_log')
          .update({
            status: 'completed',
            candles_fetched: candlesFetched,
            candles_saved: candlesSaved,
            completed_at: new Date().toISOString(),
            duration_ms: duration,
          })
          .eq('id', data.id);
      }
    } catch (error) {
      console.error('Failed to log refresh success:', error);
    }
  }

  private async logRefreshFailure(symbol: string, timeframe: string, errorMessage: string) {
    try {
      const { data } = await supabase
        .from('data_refresh_log')
        .select('id, started_at')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .eq('status', 'fetching')
        .order('started_at', { ascending: false })
        .limit(1)
        .single();

      if (data) {
        const duration = Date.now() - new Date(data.started_at).getTime();

        await supabase
          .from('data_refresh_log')
          .update({
            status: 'failed',
            error_message: errorMessage,
            completed_at: new Date().toISOString(),
            duration_ms: duration,
          })
          .eq('id', data.id);
      }
    } catch (error) {
      console.error('Failed to log refresh failure:', error);
    }
  }

  private async updateCompletenessStatus(symbol: string, timeframe: string) {
    try {
      const { data, error } = await supabase.rpc('update_data_completeness_status', {
        p_symbol: symbol,
        p_timeframe: timeframe,
      });

      if (error) {
        console.error('Failed to update completeness status:', error);
      }
    } catch (error) {
      console.error('Error calling update_data_completeness_status:', error);
    }
  }

  public getTasks(): RefreshTask[] {
    return Array.from(this.tasks.values());
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public async checkForStaleData() {
    try {
      await supabase.rpc('mark_stale_data');
      console.log('[AutoRefresh] Checked for stale data');
    } catch (error) {
      console.error('[AutoRefresh] Error checking for stale data:', error);
    }
  }
}

export const automatedRefreshService = new AutomatedRefreshService();

export function initializeAutomatedRefresh() {
  const config = automatedRefreshService.getConfig();
  if (config.enabled) {
    automatedRefreshService.start();
  }

  setInterval(() => {
    automatedRefreshService.checkForStaleData();
  }, 300000);
}
