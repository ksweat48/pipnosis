/**
 * Simple Auto-Backtest Service with 30-Day Progressive Learning
 *
 * NEW ARCHITECTURE:
 * - Each auto-backtest session runs for 30 days (1 month)
 * - Each day is a separate trade session with its own results
 * - AI learns progressively after EACH day (Day 2 learns from Day 1, Day 3 from Days 1-2, etc.)
 * - All 30 days are grouped under one parent "monthly session"
 * - After 30 days complete, wait random delay (30-90s) then start new month
 *
 * Flow:
 * 1. Start new monthly session (30 days)
 * 2. Day 1: Run 1 day backtest → Analyze → Learn
 * 3. Day 2: Run 1 day backtest → Analyze → Learn (with Day 1 context)
 * 4. Day 3-30: Continue pattern...
 * 5. Month complete → Wait delay → Start new month
 */

import { syntheticBacktestingEngine, SyntheticBacktestConfig } from './synthetic-backtesting-engine';
import { plateauDetector } from './plateau-detector';
import { breakthroughEngine } from './breakthrough-engine';
import { supabase } from '../lib/supabase';

export interface SimpleAutoBacktestState {
  isRunning: boolean;
  totalMonthsCompleted: number;
  currentMonthNumber: number;
  currentDayInMonth: number; // NEW: 1-30
  totalDaysInMonth: number; // NEW: Always 30
  lastDayResult: {
    dayNumber: number;
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
  monthlyParentSessionId?: string; // NEW: Parent session ID for current month
}

class SimpleAutoBacktestService {
  private isRunning = false;
  private userId: string | null = null;
  private totalMonthsCompleted = 0;
  private currentMonthNumber = 0;
  private currentDayInMonth = 0; // NEW: Track which day we're on (1-30)
  private monthlyParentSessionId: string | null = null; // NEW: Parent session for current month
  private abortController: AbortController | null = null;
  private nextRunTimer: NodeJS.Timeout | null = null;
  private lastDayResult: any = null;
  private plateauDetected = false;
  private breakthroughMode = false;
  private plateauDuration = 0;
  private sessionId: string = '';
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private backtestsToday = 0;
  private lastResetDate = new Date().toDateString();
  private consecutiveBacktests = 0;
  private lastDbLatency = 0;
  private adaptiveDelayMultiplier = 1.0;

  // Configuration
  private readonly MIN_DELAY_SECONDS = 30;
  private readonly MAX_DELAY_SECONDS = 90;
  private readonly DAYS_PER_MONTH = 30; // NEW: Fixed 30 days per monthly session
  private readonly PLATEAU_CHECK_INTERVAL = 5;
  private readonly HEARTBEAT_INTERVAL_MS = 60000;
  private readonly MAX_DAILY_BACKTESTS = 50;
  private readonly ADAPTIVE_DELAY_MULTIPLIER = 2.0;
  private readonly DB_LATENCY_THRESHOLD_MS = 1000;
  private readonly COOLDOWN_AFTER_N_BACKTESTS = 5;
  private readonly COOLDOWN_DURATION_MS = 300000;

  /**
   * Initialize state from database
   */
  async initialize(userId: string): Promise<void> {
    this.userId = userId;

    const { data: existingState } = await supabase
      .from('auto_backtest_global_state')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (existingState && existingState.is_running) {
      const lastHeartbeat = new Date(existingState.last_heartbeat);
      const minutesSinceHeartbeat = (Date.now() - lastHeartbeat.getTime()) / 1000 / 60;

      if (minutesSinceHeartbeat > 5) {
        console.log('[Auto-Backtest] Found stale session, cleaning up...');
        await this.forceStopInDatabase(userId);
      } else {
        console.log('[Auto-Backtest] Found active session started from:', existingState.started_from_device);
        this.isRunning = true;
        this.totalMonthsCompleted = existingState.total_months_completed || 0;
        this.currentMonthNumber = existingState.current_month_number || 0;
        this.currentDayInMonth = existingState.current_day_in_month || 0;
        this.monthlyParentSessionId = existingState.monthly_parent_session_id;
        this.plateauDetected = existingState.plateau_detected || false;
        this.breakthroughMode = existingState.breakthrough_mode || false;
        this.plateauDuration = existingState.plateau_duration || 0;
        this.sessionId = existingState.session_id || '';

        if (existingState.last_day_session_name) {
          this.lastDayResult = {
            dayNumber: existingState.last_day_number || 0,
            sessionName: existingState.last_day_session_name,
            winRate: parseFloat(existingState.last_day_win_rate || '0'),
            totalTrades: existingState.last_day_total_trades || 0,
            pnl: parseFloat(existingState.last_day_pnl || '0'),
            completedAt: new Date(existingState.last_day_completed_at)
          };
        }
      }
    }
  }

  /**
   * Start auto-backtest loop
   */
  async start(userId: string): Promise<{ success: boolean; message: string }> {
    await this.initialize(userId);

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

    console.log('[Auto-Backtest] 🚀 Starting 30-day progressive learning system');
    this.userId = userId;
    this.isRunning = true;
    this.sessionId = this.generateSessionId();
    this.abortController = new AbortController();

    const deviceInfo = this.getDeviceInfo();

    await this.syncStateToDatabase({
      is_running: true,
      started_at: new Date().toISOString(),
      session_id: this.sessionId,
      started_from_device: deviceInfo,
      last_heartbeat: new Date().toISOString()
    });

    this.startHeartbeat();
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
    if (this.userId) {
      const { data: dbState } = await supabase
        .from('auto_backtest_global_state')
        .select('*')
        .eq('user_id', this.userId)
        .single();

      if (dbState) {
        return {
          isRunning: dbState.is_running || false,
          totalMonthsCompleted: dbState.total_months_completed || 0,
          currentMonthNumber: dbState.current_month_number || 0,
          currentDayInMonth: dbState.current_day_in_month || 0,
          totalDaysInMonth: this.DAYS_PER_MONTH,
          lastDayResult: dbState.last_day_session_name ? {
            dayNumber: dbState.last_day_number || 0,
            sessionName: dbState.last_day_session_name,
            winRate: parseFloat(dbState.last_day_win_rate || '0'),
            totalTrades: dbState.last_day_total_trades || 0,
            pnl: parseFloat(dbState.last_day_pnl || '0'),
            completedAt: new Date(dbState.last_day_completed_at)
          } : null,
          nextRunIn: 0,
          plateauDetected: dbState.plateau_detected || false,
          breakthroughMode: dbState.breakthrough_mode || false,
          plateauDuration: dbState.plateau_duration || 0,
          startedFromDevice: dbState.started_from_device,
          sessionId: dbState.session_id,
          usageWarningLevel: dbState.usage_warning_level,
          usageWarningMessage: dbState.usage_warning_message,
          monthlyParentSessionId: dbState.monthly_parent_session_id
        };
      }
    }

    return {
      isRunning: this.isRunning,
      totalMonthsCompleted: this.totalMonthsCompleted,
      currentMonthNumber: this.currentMonthNumber,
      currentDayInMonth: this.currentDayInMonth,
      totalDaysInMonth: this.DAYS_PER_MONTH,
      lastDayResult: this.lastDayResult,
      nextRunIn: 0,
      plateauDetected: this.plateauDetected,
      breakthroughMode: this.breakthroughMode,
      plateauDuration: this.plateauDuration,
      monthlyParentSessionId: this.monthlyParentSessionId
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
          total_months_completed: this.totalMonthsCompleted,
          current_month_number: this.currentMonthNumber,
          current_day_in_month: this.currentDayInMonth,
          monthly_parent_session_id: this.monthlyParentSessionId,
          last_day_number: this.lastDayResult?.dayNumber,
          last_day_session_name: this.lastDayResult?.sessionName,
          last_day_win_rate: this.lastDayResult?.winRate,
          last_day_total_trades: this.lastDayResult?.totalTrades,
          last_day_pnl: this.lastDayResult?.pnl,
          last_day_completed_at: this.lastDayResult?.completedAt,
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
   * Main loop - runs 30-day monthly sessions with daily learning
   */
  private async runLoop(): Promise<void> {
    while (this.isRunning && this.userId) {
      try {
        // Start new monthly session
        this.currentMonthNumber++;
        this.currentDayInMonth = 0;
        this.monthlyParentSessionId = this.generateMonthlySessionId();

        console.log('\n[Auto-Backtest] ========== STARTING NEW 30-DAY MONTHLY SESSION ==========');
        console.log(`[Auto-Backtest] Month #${this.currentMonthNumber}`);
        console.log(`[Auto-Backtest] Parent Session ID: ${this.monthlyParentSessionId}`);
        console.log('========================================================\n');

        await this.syncStateToDatabase({});

        // Run 30 daily sessions
        for (let day = 1; day <= this.DAYS_PER_MONTH; day++) {
          if (!this.isRunning) break;

          this.currentDayInMonth = day;

          console.log(`\n[Auto-Backtest] ========== DAY ${day}/30 ==========`);

          // Run one day of trading
          await this.runDailySession(day);

          // After each day, AI learns progressively
          console.log(`[Auto-Backtest] Day ${day} complete - AI learning from this day's results...`);

          await this.syncStateToDatabase({});

          // Small delay between days
          if (day < this.DAYS_PER_MONTH && this.isRunning) {
            console.log('[Auto-Backtest] Preparing next day...');
            await this.sleep(5000); // 5 second delay between days
          }
        }

        // Month complete
        if (this.currentDayInMonth === this.DAYS_PER_MONTH) {
          this.totalMonthsCompleted++;
          console.log('\n[Auto-Backtest] ========== 30-DAY MONTH COMPLETE ==========');
          console.log(`[Auto-Backtest] ✅ Month #${this.currentMonthNumber} finished!`);
          console.log(`[Auto-Backtest] Total months completed: ${this.totalMonthsCompleted}`);
          console.log('====================================================\n');

          await this.syncStateToDatabase({});

          // Check for plateau every 5 months
          if (this.totalMonthsCompleted % this.PLATEAU_CHECK_INTERVAL === 0) {
            await this.checkForPlateau();
          }

          if (this.plateauDetected && !this.breakthroughMode && this.plateauDuration >= 15) {
            await this.triggerBreakthroughMode();
          }
        }

        // Check usage levels
        await this.checkUsageLevels();

        // Check daily quota
        this.checkAndResetDailyQuota();
        if (this.backtestsToday >= this.MAX_DAILY_BACKTESTS) {
          console.warn(`[Auto-Backtest] ⚠️ Daily quota reached (${this.MAX_DAILY_BACKTESTS} backtests). Pausing until tomorrow.`);
          await this.stop();
          break;
        }

        // Wait before starting next monthly session
        if (this.isRunning) {
          const baseDelaySeconds = this.randomDelay();
          const adaptiveDelaySeconds = Math.floor(baseDelaySeconds * this.adaptiveDelayMultiplier);

          console.log(`[Auto-Backtest] Waiting ${adaptiveDelaySeconds}s before next 30-day month...`);
          if (this.adaptiveDelayMultiplier > 1.0) {
            console.log(`[Auto-Backtest] 📊 Adaptive throttling active (${this.adaptiveDelayMultiplier.toFixed(1)}x) due to DB latency: ${this.lastDbLatency}ms`);
          }

          await this.sleep(adaptiveDelaySeconds * 1000);
        }

      } catch (error) {
        console.error('[Auto-Backtest] Error in backtest loop:', error);
        await this.sleep(10000);
      }
    }

    console.log('[Auto-Backtest] Loop terminated');
  }

  /**
   * Run a single daily session (1 day of trading)
   */
  private async runDailySession(dayNumber: number): Promise<void> {
    if (!this.userId) return;

    const sessionName = this.generateDailySessionName(dayNumber);
    const riskLevel = this.randomRiskLevel();
    const symbols = ['EURUSD', 'XAUUSD', 'GBPUSD', 'USDJPY', 'US30'];

    // Each day is exactly 1 day of data
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day

    console.log(`[Auto-Backtest] Session: ${sessionName}`);
    console.log(`[Auto-Backtest] Duration: 1 day`);
    console.log(`[Auto-Backtest] Risk Level: ${riskLevel}`);
    console.log(`[Auto-Backtest] Pairs: ${symbols.join(', ')}`);

    const config: SyntheticBacktestConfig = {
      sessionName,
      description: `Month ${this.currentMonthNumber} - Day ${dayNumber} - ${riskLevel} risk`,
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

    // Execute daily backtest (includes AI learning automatically)
    const result = await syntheticBacktestingEngine.runSyntheticBacktest(
      this.userId,
      config,
      (progress) => {
        console.log(`[Auto-Backtest] Day ${dayNumber} Progress: ${progress.message} (${progress.percentComplete.toFixed(1)}%)`);
      }
    );

    // Update day result
    this.lastDayResult = {
      dayNumber,
      sessionName,
      winRate: result.winRate,
      totalTrades: result.totalTrades,
      pnl: result.totalPnL,
      completedAt: new Date()
    };

    console.log(`[Auto-Backtest] Day ${dayNumber} ✅ Win rate: ${result.winRate.toFixed(1)}%, P&L: $${result.totalPnL.toFixed(2)}, Trades: ${result.totalTrades}`);
  }

  /**
   * Check system resource usage levels with auto-pause capability
   */
  private async checkUsageLevels(): Promise<void> {
    if (!this.userId) return;

    try {
      const startTime = Date.now();
      const { error } = await supabase
        .from('auto_backtest_global_state')
        .select('id')
        .eq('user_id', this.userId)
        .single();

      const responseTime = Date.now() - startTime;
      this.lastDbLatency = responseTime;

      let warningLevel = 'normal';
      let warningMessage = '';
      let shouldPause = false;

      if (responseTime > 5000) {
        warningLevel = 'critical';
        warningMessage = `Database response time is critical (${responseTime}ms). Auto-pausing backtest.`;
        shouldPause = true;
        this.adaptiveDelayMultiplier = 3.0;
      } else if (responseTime > 2000) {
        warningLevel = 'elevated';
        warningMessage = `Database response time is elevated (${responseTime}ms). Applying adaptive throttling.`;
        this.adaptiveDelayMultiplier = this.ADAPTIVE_DELAY_MULTIPLIER;
      } else if (responseTime > this.DB_LATENCY_THRESHOLD_MS) {
        warningLevel = 'warning';
        warningMessage = `Database response time increased (${responseTime}ms). Monitoring closely.`;
        this.adaptiveDelayMultiplier = 1.5;
      } else {
        this.adaptiveDelayMultiplier = 1.0;
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

      if (shouldPause) {
        console.error('[Auto-Backtest] 🛑 CRITICAL: Auto-pausing due to database overload');
        await this.stop();
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
   * Generate unique monthly session ID
   */
  private generateMonthlySessionId(): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `Month-${this.currentMonthNumber}-${timestamp}`;
  }

  /**
   * Generate unique daily session name
   */
  private generateDailySessionName(dayNumber: number): string {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `Month-${this.currentMonthNumber}-Day-${dayNumber}-${timestamp}`;
  }

  /**
   * Get device/browser information
   */
  private getDeviceInfo(): string {
    const ua = navigator.userAgent;
    let browser = 'Unknown';
    let os = 'Unknown';

    if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
    else if (ua.includes('Edg')) browser = 'Edge';

    if (ua.includes('Win')) os = 'Windows';
    else if (ua.includes('Mac')) os = 'MacOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iOS')) os = 'iOS';

    return `${browser} on ${os}`;
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
   * Check and reset daily quota if new day
   */
  private checkAndResetDailyQuota(): void {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      console.log(`[Auto-Backtest] 🔄 New day detected. Resetting daily quota from ${this.backtestsToday} to 0.`);
      this.backtestsToday = 0;
      this.lastResetDate = today;
      this.consecutiveBacktests = 0;
    }
    this.backtestsToday++;
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
