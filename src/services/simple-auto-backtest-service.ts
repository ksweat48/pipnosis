/**
 * Simple Auto-Backtest Service with Persistent State
 *
 * Syncs state with Supabase database for cross-browser/device persistence.
 * State is maintained globally per user and survives browser restarts.
 *
 * Flow:
 * 1. Check database for existing running state
 * 2. Run complete backtest (synthetic data + trade simulation)
 * 3. Store results in database
 * 4. Trigger AI learning from results
 * 5. Update AI skill progression
 * 6. Send heartbeat to database every 10 seconds
 * 7. Wait random delay (2-10 seconds)
 * 8. Repeat until manually stopped
 */

import { syntheticBacktestingEngine, SyntheticBacktestConfig } from './synthetic-backtesting-engine';
import { plateauDetector } from './plateau-detector';
import { breakthroughEngine } from './breakthrough-engine';
import { supabase } from '../lib/supabase';

export interface SimpleAutoBacktestState {
  isRunning: boolean;
  totalBacktestsCompleted: number;
  currentBacktestNumber: number;
  lastBacktestResult: {
    sessionName: string;
    winRate: number;
    totalTrades: number;
    pnl: number;
    completedAt: Date;
  } | null;
  nextRunIn: number;
  plateauDetected: boolean;
  breakthroughMode: boolean;
  plateauDuration: number;
  startedFromDevice?: string;
  sessionId?: string;
  usageWarningLevel?: string;
  usageWarningMessage?: string;
}

class SimpleAutoBacktestService {
  private isRunning = false;
  private userId: string | null = null;
  private totalBacktestsCompleted = 0;
  private currentBacktestNumber = 0;
  private abortController: AbortController | null = null;
  private nextRunTimer: NodeJS.Timeout | null = null;
  private lastBacktestResult: any = null;
  private plateauDetected = false;
  private breakthroughMode = false;
  private plateauDuration = 0;
  private sessionId: string = '';
  private heartbeatInterval: NodeJS.Timeout | null = null;

  // Configuration
  private readonly MIN_DELAY_SECONDS = 2;
  private readonly MAX_DELAY_SECONDS = 10;
  private readonly MIN_DURATION_DAYS = 1;
  private readonly MAX_DURATION_DAYS = 3;
  private readonly PLATEAU_CHECK_INTERVAL = 5;
  private readonly HEARTBEAT_INTERVAL_MS = 10000; // 10 seconds

  /**
   * Initialize state from database
   */
  async initialize(userId: string): Promise<void> {
    this.userId = userId;

    // Check if auto-backtest is already running in database
    const { data: existingState } = await supabase
      .from('auto_backtest_global_state')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (existingState && existingState.is_running) {
      // Check if state is stale (no heartbeat in 5+ minutes)
      const lastHeartbeat = new Date(existingState.last_heartbeat);
      const minutesSinceHeartbeat = (Date.now() - lastHeartbeat.getTime()) / 1000 / 60;

      if (minutesSinceHeartbeat > 5) {
        console.log('[Auto-Backtest] Found stale session, cleaning up...');
        await this.forceStopInDatabase(userId);
      } else {
        // Valid running session exists
        console.log('[Auto-Backtest] Found active session started from:', existingState.started_from_device);
        this.isRunning = true;
        this.totalBacktestsCompleted = existingState.total_backtests_completed || 0;
        this.currentBacktestNumber = existingState.current_backtest_number || 0;
        this.plateauDetected = existingState.plateau_detected || false;
        this.breakthroughMode = existingState.breakthrough_mode || false;
        this.plateauDuration = existingState.plateau_duration || 0;
        this.sessionId = existingState.session_id || '';

        if (existingState.last_backtest_session_name) {
          this.lastBacktestResult = {
            sessionName: existingState.last_backtest_session_name,
            winRate: parseFloat(existingState.last_backtest_win_rate || '0'),
            totalTrades: existingState.last_backtest_total_trades || 0,
            pnl: parseFloat(existingState.last_backtest_pnl || '0'),
            completedAt: new Date(existingState.last_backtest_completed_at)
          };
        }
      }
    }
  }

  /**
   * Start auto-backtest loop
   */
  async start(userId: string): Promise<{ success: boolean; message: string }> {
    // Initialize and check database state
    await this.initialize(userId);

    // Check if already running (in this browser or another)
    const { data: dbState } = await supabase
      .from('auto_backtest_global_state')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (dbState && dbState.is_running) {
      const lastHeartbeat = new Date(dbState.last_heartbeat);
      const minutesSinceHeartbeat = (Date.now() - lastHeartbeat.getTime()) / 1000 / 60;

      if (minutesSinceHeartbeat <= 5) {
        return {
          success: false,
          message: `Auto-backtest is already running from: ${dbState.started_from_device || 'another device'}`
        };
      }
    }

    if (this.isRunning) {
      return { success: false, message: 'Already running in this session' };
    }

    console.log('[Auto-Backtest] 🚀 Starting auto-backtest system');
    this.userId = userId;
    this.isRunning = true;
    this.sessionId = this.generateSessionId();
    this.abortController = new AbortController();

    // Detect device/browser info
    const deviceInfo = this.getDeviceInfo();

    // Save running state to database
    await this.syncStateToDatabase({
      is_running: true,
      started_at: new Date().toISOString(),
      session_id: this.sessionId,
      started_from_device: deviceInfo,
      last_heartbeat: new Date().toISOString()
    });

    // Start heartbeat to keep state fresh
    this.startHeartbeat();

    // Start the loop immediately
    this.runLoop();

    return { success: true, message: 'Auto-backtest started successfully' };
  }

  /**
   * Stop auto-backtest loop
   */
  async stop(): Promise<void> {
    console.log('[Auto-Backtest] 🛑 Stopping auto-backtest system');
    this.isRunning = false;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.nextRunTimer) {
      clearTimeout(this.nextRunTimer);
      this.nextRunTimer = null;
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Update database state
    if (this.userId) {
      await this.syncStateToDatabase({
        is_running: false,
        stopped_at: new Date().toISOString()
      });
    }

    console.log('[Auto-Backtest] Stopped');
  }

  /**
   * Force stop from database (cleanup stale sessions)
   */
  async forceStopInDatabase(userId: string): Promise<void> {
    await supabase
      .from('auto_backtest_global_state')
      .update({
        is_running: false,
        stopped_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);
  }

  /**
   * Get current state (from memory + database)
   */
  async getState(): Promise<SimpleAutoBacktestState> {
    // Fetch latest from database if userId is set
    if (this.userId) {
      const { data: dbState } = await supabase
        .from('auto_backtest_global_state')
        .select('*')
        .eq('user_id', this.userId)
        .single();

      if (dbState) {
        return {
          isRunning: dbState.is_running || false,
          totalBacktestsCompleted: dbState.total_backtests_completed || 0,
          currentBacktestNumber: dbState.current_backtest_number || 0,
          lastBacktestResult: dbState.last_backtest_session_name ? {
            sessionName: dbState.last_backtest_session_name,
            winRate: parseFloat(dbState.last_backtest_win_rate || '0'),
            totalTrades: dbState.last_backtest_total_trades || 0,
            pnl: parseFloat(dbState.last_backtest_pnl || '0'),
            completedAt: new Date(dbState.last_backtest_completed_at)
          } : null,
          nextRunIn: 0,
          plateauDetected: dbState.plateau_detected || false,
          breakthroughMode: dbState.breakthrough_mode || false,
          plateauDuration: dbState.plateau_duration || 0,
          startedFromDevice: dbState.started_from_device,
          sessionId: dbState.session_id,
          usageWarningLevel: dbState.usage_warning_level,
          usageWarningMessage: dbState.usage_warning_message
        };
      }
    }

    // Fallback to local state
    return {
      isRunning: this.isRunning,
      totalBacktestsCompleted: this.totalBacktestsCompleted,
      currentBacktestNumber: this.currentBacktestNumber,
      lastBacktestResult: this.lastBacktestResult,
      nextRunIn: 0,
      plateauDetected: this.plateauDetected,
      breakthroughMode: this.breakthroughMode,
      plateauDuration: this.plateauDuration
    };
  }

  /**
   * Sync state to Supabase database
   */
  private async syncStateToDatabase(updates: any): Promise<void> {
    if (!this.userId) return;

    try {
      const { error } = await supabase
        .from('auto_backtest_global_state')
        .upsert({
          user_id: this.userId,
          total_backtests_completed: this.totalBacktestsCompleted,
          current_backtest_number: this.currentBacktestNumber,
          last_backtest_session_name: this.lastBacktestResult?.sessionName,
          last_backtest_win_rate: this.lastBacktestResult?.winRate,
          last_backtest_total_trades: this.lastBacktestResult?.totalTrades,
          last_backtest_pnl: this.lastBacktestResult?.pnl,
          last_backtest_completed_at: this.lastBacktestResult?.completedAt,
          plateau_detected: this.plateauDetected,
          breakthrough_mode: this.breakthroughMode,
          plateau_duration: this.plateauDuration,
          ...updates
        }, {
          onConflict: 'user_id'
        });

      if (error) {
        console.error('[Auto-Backtest] Error syncing state to database:', error);
      }
    } catch (error) {
      console.error('[Auto-Backtest] Exception syncing state:', error);
    }
  }

  /**
   * Start heartbeat to keep database state fresh
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(async () => {
      if (this.isRunning && this.userId) {
        await supabase
          .from('auto_backtest_global_state')
          .update({
            last_heartbeat: new Date().toISOString()
          })
          .eq('user_id', this.userId);
      }
    }, this.HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Main loop - runs one backtest, learns, waits, repeats
   */
  private async runLoop(): Promise<void> {
    while (this.isRunning && this.userId) {
      try {
        console.log('\n[Auto-Backtest] ========== STARTING NEW BACKTEST ==========');

        // Generate random parameters
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

        // Configure backtest
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

        this.currentBacktestNumber++;

        // Sync current backtest number to database
        await this.syncStateToDatabase({
          current_backtest_number: this.currentBacktestNumber
        });

        // Execute backtest (this includes AI learning automatically)
        const result = await syntheticBacktestingEngine.runSyntheticBacktest(
          this.userId,
          config,
          (progress) => {
            console.log(`[Auto-Backtest] Progress: ${progress.message} (${progress.percentComplete.toFixed(1)}%)`);
          }
        );

        // Update completion stats
        this.totalBacktestsCompleted++;
        this.lastBacktestResult = {
          sessionName,
          winRate: result.winRate,
          totalTrades: result.totalTrades,
          pnl: result.totalPnL,
          completedAt: new Date()
        };

        // Sync completed backtest to database
        await this.syncStateToDatabase({});

        console.log(`[Auto-Backtest] ✅ Completed! Win rate: ${result.winRate.toFixed(1)}%, P&L: $${result.totalPnL.toFixed(2)}`);
        console.log('[Auto-Backtest] ===============================================\n');

        if (this.totalBacktestsCompleted % this.PLATEAU_CHECK_INTERVAL === 0) {
          await this.checkForPlateau();
        }

        if (this.plateauDetected && !this.breakthroughMode && this.plateauDuration >= 15) {
          await this.triggerBreakthroughMode();
        }

        // Check usage levels and warn if critical
        await this.checkUsageLevels();

        if (this.isRunning) {
          const delaySeconds = this.randomDelay();
          console.log(`[Auto-Backtest] Waiting ${delaySeconds}s before next backtest...`);

          await this.sleep(delaySeconds * 1000);
        }

      } catch (error) {
        console.error('[Auto-Backtest] Error in backtest loop:', error);
        // Wait before retrying on error
        await this.sleep(10000);
      }
    }

    console.log('[Auto-Backtest] Loop terminated');
  }

  /**
   * Check system resource usage levels
   */
  private async checkUsageLevels(): Promise<void> {
    if (!this.userId) return;

    try {
      // Check Supabase connection count and response time
      const startTime = Date.now();
      const { error } = await supabase
        .from('auto_backtest_global_state')
        .select('id')
        .eq('user_id', this.userId)
        .single();

      const responseTime = Date.now() - startTime;

      let warningLevel = 'normal';
      let warningMessage = '';

      if (responseTime > 5000) {
        warningLevel = 'critical';
        warningMessage = `Database response time is very slow (${responseTime}ms). Consider pausing auto-backtest.`;
      } else if (responseTime > 2000) {
        warningLevel = 'elevated';
        warningMessage = `Database response time is elevated (${responseTime}ms). Monitoring usage.`;
      }

      if (warningLevel !== 'normal') {
        console.warn(`[Auto-Backtest] ⚠️ ${warningLevel.toUpperCase()}: ${warningMessage}`);

        await supabase
          .from('auto_backtest_global_state')
          .update({
            usage_warning_level: warningLevel,
            usage_warning_message: warningMessage,
            last_usage_check_at: new Date().toISOString()
          })
          .eq('user_id', this.userId);
      }

    } catch (error) {
      console.error('[Auto-Backtest] Error checking usage levels:', error);
    }
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique session name
   */
  private generateSessionName(): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `Auto-BT-${timestamp}`;
  }

  /**
   * Get device/browser information
   */
  private getDeviceInfo(): string {
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    let os = 'Unknown';

    // Detect browser
    if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
    else if (ua.includes('Edg')) browser = 'Edge';

    // Detect OS
    if (ua.includes('Win')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'MacOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iOS')) os = 'iOS';

    return `${browser} on ${os}`;
  }

  /**
   * Random duration between min and max days
   */
  private randomDuration(): number {
    return Math.floor(Math.random() * (this.MAX_DURATION_DAYS - this.MIN_DURATION_DAYS + 1)) + this.MIN_DURATION_DAYS;
  }

  /**
   * Random risk level
   */
  private randomRiskLevel(): 'low' | 'medium' | 'high' {
    const levels: ('low' | 'medium' | 'high')[] = ['low', 'medium', 'high'];
    return levels[Math.floor(Math.random() * levels.length)];
  }

  /**
   * Get confidence threshold for risk level
   */
  private getRiskThreshold(riskLevel: 'low' | 'medium' | 'high'): number {
    const thresholds = { low: 85, medium: 75, high: 70 };
    return thresholds[riskLevel];
  }

  /**
   * Random delay between runs
   */
  private randomDelay(): number {
    return Math.floor(Math.random() * (this.MAX_DELAY_SECONDS - this.MIN_DELAY_SECONDS + 1)) + this.MIN_DELAY_SECONDS;
  }

  /**
   * Check for performance plateau
   */
  private async checkForPlateau(): Promise<void> {
    if (!this.userId) return;

    console.log('\n[Auto-Backtest] 🔍 Checking for plateau...');

    try {
      const plateau = await plateauDetector.detectPlateau(this.userId);

      if (plateau) {
        this.plateauDetected = plateau.isPlateaued;
        this.plateauDuration = plateau.plateauDuration;

        // Sync plateau state to database
        await this.syncStateToDatabase({});

        if (plateau.isPlateaued) {
          console.log(`[Auto-Backtest] ⚠️  PLATEAU DETECTED!`);
          console.log(`[Auto-Backtest]   Duration: ${plateau.plateauDuration} sessions`);
          console.log(`[Auto-Backtest]   Win Rate Range: ${plateau.winRateRange.min.toFixed(1)}% - ${plateau.winRateRange.max.toFixed(1)}%`);
          console.log(`[Auto-Backtest]   ${plateau.recommendation}`);
        } else {
          console.log(`[Auto-Backtest] ✅ No plateau - performance is progressing`);
        }
      }
    } catch (error) {
      console.error('[Auto-Backtest] Error checking plateau:', error);
    }
  }

  /**
   * Trigger breakthrough mode to escape plateau
   */
  private async triggerBreakthroughMode(): Promise<void> {
    if (!this.userId || this.breakthroughMode) return;

    console.log('\n[Auto-Backtest] 🚀 TRIGGERING BREAKTHROUGH MODE');
    this.breakthroughMode = true;

    // Sync breakthrough mode to database
    await this.syncStateToDatabase({});

    try {
      const result = await breakthroughEngine.runFullBreakthroughCycle(this.userId);

      if (result.success && result.bestStrategy) {
        console.log(`\n[Auto-Backtest] 🎉 BREAKTHROUGH COMPLETE!`);
        console.log(`[Auto-Backtest] Best Strategy: ${result.bestStrategy.strategyName}`);
        console.log(`[Auto-Backtest] Improvement: +${result.bestStrategy.improvement.toFixed(1)}%`);
        console.log(`[Auto-Backtest] New Win Rate: ${result.bestStrategy.winRate.toFixed(1)}%`);
        console.log(`[Auto-Backtest] ${result.recommendation}`);

        if (result.bestStrategy.shouldAdopt) {
          this.plateauDetected = false;
          this.plateauDuration = 0;
        }
      }
    } catch (error) {
      console.error('[Auto-Backtest] Error in breakthrough mode:', error);
    } finally {
      this.breakthroughMode = false;
      await this.syncStateToDatabase({});
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      if (this.abortController?.signal.aborted) {
        resolve();
      } else {
        this.nextRunTimer = setTimeout(resolve, ms);
      }
    });
  }
}

export const simpleAutoBacktestService = new SimpleAutoBacktestService();
