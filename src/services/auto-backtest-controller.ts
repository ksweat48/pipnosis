import { supabase } from '../lib/supabase';
import { syntheticBacktestingEngine, SyntheticBacktestConfig } from './synthetic-backtesting-engine';

export interface AutoBacktestState {
  id: string;
  status: 'running' | 'stopped' | 'paused_for_live_trade' | 'cooldown';
  isActive: boolean;
  totalBacktestsCompleted: number;
  consecutiveRuns: number;
  currentCycleCount: number;
  cooldownActive: boolean;
  cooldownEndsAt?: Date;
  cooldownReason?: string;
  systemStressScore: number;
  pausedForLiveTrade: boolean;
}

export interface AutoBacktestConfig {
  maxConsecutiveRuns: number;
  standardCooldownMinutes: number;
  maxStressScore: number;
  maxDbResponseMs: number;
  maxErrorRatePercent: number;
  maxConsecutiveErrors: number;
  minDurationDays: number;
  maxDurationDays: number;
  delayBetweenRunsMinSeconds: number;
  delayBetweenRunsMaxSeconds: number;
}

export interface HealthMetrics {
  stressScore: number;
  databaseResponseMs: number;
  errorRatePercent: number;
  memoryUsageMb?: number;
  activeBacktests: number;
}

class AutoBacktestController {
  private controllerId: string | null = null;
  private userId: string | null = null;
  private isRunning: boolean = false;
  private config: AutoBacktestConfig | null = null;
  private abortController: AbortController | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private liveTradeMonitorInterval: NodeJS.Timeout | null = null;

  async start(userId: string): Promise<void> {
    if (this.isRunning) {
      console.log('[Auto-Backtest] Already running');
      return;
    }

    console.log('[Auto-Backtest] Starting auto-backtest system...');
    this.userId = userId;
    this.isRunning = true;
    this.abortController = new AbortController();

    await this.loadOrCreateConfig(userId);
    await this.initializeController(userId);

    this.startHealthMonitoring();
    this.startLiveTradeMonitoring();

    this.runBacktestLoop();
  }

  async stop(userId: string): Promise<void> {
    console.log('[Auto-Backtest] Stopping auto-backtest system...');
    this.isRunning = false;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.stopHealthMonitoring();
    this.stopLiveTradeMonitoring();

    if (this.controllerId) {
      await supabase
        .from('auto_backtest_controller')
        .update({
          status: 'stopped',
          is_active: false,
          stopped_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', this.controllerId);
    }

    console.log('[Auto-Backtest] Stopped');
  }

  async getState(userId: string): Promise<AutoBacktestState | null> {
    const { data } = await supabase
      .from('auto_backtest_controller')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return null;

    return {
      id: data.id,
      status: data.status,
      isActive: data.is_active,
      totalBacktestsCompleted: data.total_backtests_completed,
      consecutiveRuns: data.consecutive_runs,
      currentCycleCount: data.current_cycle_count,
      cooldownActive: data.cooldown_active,
      cooldownEndsAt: data.cooldown_ends_at ? new Date(data.cooldown_ends_at) : undefined,
      cooldownReason: data.cooldown_reason,
      systemStressScore: data.system_stress_score,
      pausedForLiveTrade: data.paused_for_live_trade
    };
  }

  private async loadOrCreateConfig(userId: string): Promise<void> {
    let { data: config } = await supabase
      .from('auto_backtest_config')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!config) {
      const { data: newConfig } = await supabase
        .from('auto_backtest_config')
        .insert({ user_id: userId })
        .select()
        .single();
      config = newConfig;
    }

    if (config) {
      this.config = {
        maxConsecutiveRuns: config.max_consecutive_runs,
        standardCooldownMinutes: config.standard_cooldown_minutes,
        maxStressScore: config.max_stress_score,
        maxDbResponseMs: config.max_db_response_ms,
        maxErrorRatePercent: config.max_error_rate_percent,
        maxConsecutiveErrors: config.max_consecutive_errors,
        minDurationDays: config.min_duration_days,
        maxDurationDays: config.max_duration_days,
        delayBetweenRunsMinSeconds: config.delay_between_runs_min_seconds,
        delayBetweenRunsMaxSeconds: config.delay_between_runs_max_seconds
      };
    }

    console.log('[Auto-Backtest] Config loaded:', this.config);
  }

  private async initializeController(userId: string): Promise<void> {
    const { data: existing } = await supabase
      .from('auto_backtest_controller')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing && existing.is_active) {
      this.controllerId = existing.id;
      await supabase
        .from('auto_backtest_controller')
        .update({
          status: 'running',
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', this.controllerId);
    } else {
      const { data: newController } = await supabase
        .from('auto_backtest_controller')
        .insert({
          user_id: userId,
          status: 'running',
          is_active: true,
          started_at: new Date().toISOString()
        })
        .select()
        .single();

      this.controllerId = newController.id;
    }

    console.log('[Auto-Backtest] Controller initialized:', this.controllerId);
  }

  private async runBacktestLoop(): Promise<void> {
    while (this.isRunning && this.userId && this.controllerId) {
      try {
        const state = await this.getState(this.userId);
        if (!state) break;

        if (state.pausedForLiveTrade) {
          console.log('[Auto-Backtest] Paused for live trade, waiting...');
          await this.sleep(5000);
          continue;
        }

        if (state.cooldownActive && state.cooldownEndsAt) {
          const now = new Date();
          if (now < state.cooldownEndsAt) {
            const remainingMs = state.cooldownEndsAt.getTime() - now.getTime();
            const remainingMinutes = Math.ceil(remainingMs / 60000);
            console.log(`[Auto-Backtest] In cooldown, ${remainingMinutes} minutes remaining...`);
            await this.sleep(30000);
            continue;
          } else {
            await this.endCooldown();
          }
        }

        const shouldCooldown = await this.checkHealthAndDecideCooldown();
        if (shouldCooldown) {
          continue;
        }

        if (state.currentCycleCount >= (this.config?.maxConsecutiveRuns || 100)) {
          await this.startCooldown('cycle_complete', this.config?.standardCooldownMinutes || 15);
          continue;
        }

        await this.runSingleBacktest();

        const delaySeconds = this.randomDelay();
        console.log(`[Auto-Backtest] Waiting ${delaySeconds}s before next backtest...`);
        await this.sleep(delaySeconds * 1000);

      } catch (error) {
        console.error('[Auto-Backtest] Error in backtest loop:', error);
        await this.recordError();
        await this.sleep(10000);
      }
    }

    console.log('[Auto-Backtest] Loop terminated');
  }

  private async runSingleBacktest(): Promise<void> {
    if (!this.userId) return;

    console.log('\n[Auto-Backtest] ========== STARTING NEW BACKTEST ==========');

    const sessionName = this.generateSessionName();
    const durationDays = this.randomDuration();
    const riskLevel = this.randomRiskLevel();
    const symbols = ['EURUSD', 'XAUUSD', 'GBPUSD', 'USDJPY', 'US30'];

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - durationDays * 24 * 60 * 60 * 1000);

    console.log(`[Auto-Backtest] Session: ${sessionName}`);
    console.log(`[Auto-Backtest] Duration: ${durationDays} days`);
    console.log(`[Auto-Backtest] Risk Level: ${riskLevel}`);
    console.log(`[Auto-Backtest] Pairs: ${symbols.join(', ')}`);

    await this.updateControllerStatus('running', {
      last_backtest_started_at: new Date().toISOString()
    });

    const config: SyntheticBacktestConfig = {
      sessionName,
      description: `Auto-backtest - ${riskLevel} risk, ${durationDays}d duration`,
      symbols,
      startDate,
      endDate,
      timeframes: ['H1', 'M5', 'M1'],
      useGPT4Reasoning: false,
      confidenceThreshold: this.getRiskThreshold(riskLevel),
      riskMode: riskLevel,
      maxConcurrentTrades: 2,
      initialBalance: 10000,
      positionSizePercent: 2,
      commissionPerTrade: 0,
      slippagePips: 1,
      marketScenario: 'mixed'
    };

    try {
      const dbStartTime = Date.now();
      const result = await syntheticBacktestingEngine.runSyntheticBacktest(
        this.userId,
        config,
        (progress) => {
          console.log(`[Auto-Backtest] Progress: ${progress.message} (${progress.percentComplete.toFixed(1)}%)`);
        }
      );
      const dbDuration = Date.now() - dbStartTime;

      await this.recordSuccessfulBacktest(dbDuration);

      console.log(`[Auto-Backtest] ✅ Completed! Win rate: ${result.winRate.toFixed(1)}%, P&L: $${result.totalPnL.toFixed(2)}`);
      console.log('[Auto-Backtest] ===============================================\n');

    } catch (error) {
      console.error('[Auto-Backtest] Backtest failed:', error);
      await this.recordError();
      throw error;
    }
  }

  private async checkHealthAndDecideCooldown(): Promise<boolean> {
    const metrics = await this.collectHealthMetrics();
    await this.logHealthMetrics(metrics);

    const config = this.config;
    if (!config) return false;

    if (metrics.stressScore >= config.maxStressScore) {
      console.log(`[Auto-Backtest] ⚠️  High stress score: ${metrics.stressScore}%, triggering cooldown`);
      await this.startCooldown('high_stress', 15);
      return true;
    }

    if (metrics.databaseResponseMs >= config.maxDbResponseMs) {
      console.log(`[Auto-Backtest] ⚠️  Slow database: ${metrics.databaseResponseMs}ms, triggering cooldown`);
      await this.startCooldown('slow_database', 10);
      return true;
    }

    if (metrics.errorRatePercent >= config.maxErrorRatePercent) {
      console.log(`[Auto-Backtest] ⚠️  High error rate: ${metrics.errorRatePercent}%, triggering cooldown`);
      await this.startCooldown('high_error_rate', 10);
      return true;
    }

    const state = await this.getState(this.userId!);
    if (state && state.consecutiveRuns >= config.maxConsecutiveErrors) {
      console.log(`[Auto-Backtest] ⚠️  Too many consecutive errors, triggering cooldown`);
      await this.startCooldown('consecutive_errors', 20);
      return true;
    }

    return false;
  }

  private async collectHealthMetrics(): Promise<HealthMetrics> {
    const dbStartTime = Date.now();

    await supabase.from('auto_backtest_controller').select('id').limit(1);
    const dbResponseMs = Date.now() - dbStartTime;

    const state = await this.getState(this.userId!);
    const errorCount = state?.consecutiveRuns || 0;

    let stressScore = 0;
    if (dbResponseMs > 1000) stressScore += 30;
    if (dbResponseMs > 3000) stressScore += 30;
    if (errorCount > 0) stressScore += errorCount * 10;

    stressScore = Math.min(100, stressScore);

    const errorRatePercent = errorCount > 0 ? Math.min(100, errorCount * 5) : 0;

    return {
      stressScore,
      databaseResponseMs: dbResponseMs,
      errorRatePercent,
      activeBacktests: 1
    };
  }

  private async logHealthMetrics(metrics: HealthMetrics): Promise<void> {
    if (!this.controllerId || !this.userId) return;

    await supabase
      .from('auto_backtest_health_log')
      .insert({
        user_id: this.userId,
        controller_id: this.controllerId,
        stress_score: metrics.stressScore,
        database_response_ms: metrics.databaseResponseMs,
        error_rate_percent: metrics.errorRatePercent,
        memory_usage_mb: metrics.memoryUsageMb,
        active_backtests: metrics.activeBacktests,
        action_taken: 'continue'
      });

    await supabase
      .from('auto_backtest_controller')
      .update({
        system_stress_score: metrics.stressScore,
        last_database_response_ms: metrics.databaseResponseMs,
        last_health_check_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', this.controllerId);
  }

  private async startCooldown(reason: string, durationMinutes: number): Promise<void> {
    if (!this.controllerId) return;

    const now = new Date();
    const endsAt = new Date(now.getTime() + durationMinutes * 60000);

    console.log(`[Auto-Backtest] 🛑 Starting ${durationMinutes}-minute cooldown (${reason})`);

    await supabase
      .from('auto_backtest_controller')
      .update({
        status: 'cooldown',
        cooldown_active: true,
        cooldown_started_at: now.toISOString(),
        cooldown_ends_at: endsAt.toISOString(),
        cooldown_reason: reason,
        cooldown_duration_minutes: durationMinutes,
        current_cycle_count: 0,
        consecutive_errors: 0,
        updated_at: new Date().toISOString()
      })
      .eq('id', this.controllerId);
  }

  private async endCooldown(): Promise<void> {
    if (!this.controllerId) return;

    console.log('[Auto-Backtest] ✅ Cooldown ended, resuming...');

    await supabase
      .from('auto_backtest_controller')
      .update({
        status: 'running',
        cooldown_active: false,
        cooldown_started_at: null,
        cooldown_ends_at: null,
        cooldown_reason: null,
        current_cycle_count: 0,
        updated_at: new Date().toISOString()
      })
      .eq('id', this.controllerId);
  }

  private async recordSuccessfulBacktest(dbDuration: number): Promise<void> {
    if (!this.controllerId) return;

    const state = await this.getState(this.userId!);
    if (!state) return;

    await supabase
      .from('auto_backtest_controller')
      .update({
        total_backtests_completed: state.totalBacktestsCompleted + 1,
        current_cycle_count: state.currentCycleCount + 1,
        consecutive_errors: 0,
        last_backtest_completed_at: new Date().toISOString(),
        last_database_response_ms: dbDuration,
        updated_at: new Date().toISOString()
      })
      .eq('id', this.controllerId);
  }

  private async recordError(): Promise<void> {
    if (!this.controllerId) return;

    const state = await this.getState(this.userId!);
    if (!state) return;

    await supabase
      .from('auto_backtest_controller')
      .update({
        consecutive_errors: state.consecutiveRuns + 1,
        error_count_last_hour: (state as any).error_count_last_hour + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', this.controllerId);
  }

  private async updateControllerStatus(status: string, updates: any = {}): Promise<void> {
    if (!this.controllerId) return;

    await supabase
      .from('auto_backtest_controller')
      .update({
        status,
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', this.controllerId);
  }

  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      if (!this.isRunning) return;
      const metrics = await this.collectHealthMetrics();
      console.log(`[Auto-Backtest] Health: Stress ${metrics.stressScore}%, DB ${metrics.databaseResponseMs}ms`);
    }, 60000);
  }

  private stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private startLiveTradeMonitoring(): void {
    this.liveTradeMonitorInterval = setInterval(async () => {
      if (!this.isRunning || !this.userId) return;
      await this.checkForLiveTrades();
    }, 3000);
  }

  private stopLiveTradeMonitoring(): void {
    if (this.liveTradeMonitorInterval) {
      clearInterval(this.liveTradeMonitorInterval);
      this.liveTradeMonitorInterval = null;
    }
  }

  private async checkForLiveTrades(): Promise<void> {
    if (!this.controllerId || !this.userId) return;

    const { data: openPositions } = await supabase
      .from('simulated_positions')
      .select('id')
      .eq('user_id', this.userId)
      .eq('status', 'open')
      .limit(1);

    const hasLiveTrade = openPositions && openPositions.length > 0;
    const state = await this.getState(this.userId);

    if (hasLiveTrade && !state?.pausedForLiveTrade) {
      console.log('[Auto-Backtest] 🔴 Live trade detected, pausing auto-backtest');
      await this.pauseForLiveTrade();
    } else if (!hasLiveTrade && state?.pausedForLiveTrade) {
      console.log('[Auto-Backtest] 🟢 Live trade completed, resuming auto-backtest');
      await this.resumeAfterLiveTrade();
    }
  }

  private async pauseForLiveTrade(): Promise<void> {
    if (!this.controllerId) return;

    await supabase
      .from('auto_backtest_controller')
      .update({
        status: 'paused_for_live_trade',
        paused_for_live_trade: true,
        live_trade_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', this.controllerId);
  }

  private async resumeAfterLiveTrade(): Promise<void> {
    if (!this.controllerId) return;

    await supabase
      .from('auto_backtest_controller')
      .update({
        status: 'running',
        paused_for_live_trade: false,
        live_trade_started_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', this.controllerId);
  }

  private generateSessionName(): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `Auto-BT-${timestamp}`;
  }

  private randomDuration(): number {
    const min = this.config?.minDurationDays || 1;
    const max = this.config?.maxDurationDays || 3;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private randomRiskLevel(): 'low' | 'medium' | 'high' {
    const levels: ('low' | 'medium' | 'high')[] = ['low', 'medium', 'high'];
    return levels[Math.floor(Math.random() * levels.length)];
  }

  private getRiskThreshold(riskLevel: 'low' | 'medium' | 'high'): number {
    const thresholds = { low: 85, medium: 75, high: 70 };
    return thresholds[riskLevel];
  }

  private randomDelay(): number {
    const min = this.config?.delayBetweenRunsMinSeconds || 1;
    const max = this.config?.delayBetweenRunsMaxSeconds || 20;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const autoBacktestController = new AutoBacktestController();
