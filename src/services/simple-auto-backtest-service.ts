/**
 * Simple Auto-Backtest Service with Daily Learning Cycles
 *
 * NEW ARCHITECTURE (Daily Learning System):
 * - Each day is a complete learning cycle (30 cycles per month, not 3)
 * - Daily flow: Pair Selection → Backtest → LLM Analysis → Memory Update
 * - LLM selects ONE optimal pair before each session
 * - Post-session analysis runs IMMEDIATELY after every day
 * - All learnings are instant and cumulative
 * - After 30 days complete, wait random delay (30-90s) then start new month
 *
 * Daily Flow (Repeated 30 times per month):
 * 1. PHASE 1: Pre-Session Pair Selection (LLM analyzes all pairs, picks best)
 * 2. PHASE 2: Run 1-Day Backtest (only for selected pair)
 * 3. PHASE 3: Post-Session LLM Analysis (immediate learning extraction)
 * 4. PHASE 4: Update Memory Systems (insights, patterns, calibration)
 * 5. PHASE 5: Update KPIs Daily
 * 6. Move to next day immediately
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
    symbol: string;
    pairConfidence: number;
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
  lastErrorMessage?: string | null;
  lastErrorAt?: Date | null;
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
  private readonly DAYS_PER_MONTH = 30; // Fixed 30 days per monthly session
  // LEARNING_CYCLE_INTERVAL removed - learning happens DAILY now
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
        // Stale session = will do fresh start, so clear the old month's results
        if (existingState.current_month_number) {
          console.log('[Auto-Backtest] Clearing stale session data...');
          await this.clearDailyResultsForMonth(userId, existingState.current_month_number);
        }
      } else {
        console.log('[Auto-Backtest] Found active session - resuming with existing progress');
        console.log('[Auto-Backtest] Started from:', existingState.started_from_device);
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
   * Automatically stops any existing sessions before starting
   */
  async start(userId: string): Promise<{ success: boolean; message: string }> {
    console.log('[Auto-Backtest] Starting auto-backtest...');

    try {
      // Always force stop any existing sessions first (local and database)
      await this.forceStopInDatabase(userId);

      // Reset local state completely
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

      // Small delay to ensure cleanup completes
      await new Promise(resolve => setTimeout(resolve, 500));

      // Initialize fresh state
      await this.initialize(userId);

      // Determine if this is a fresh start (new month) or recovery
      // Get current state to see what month we're on
      const { data: existingState } = await supabase
        .from('auto_backtest_global_state')
        .select('current_month_number, current_day_in_month')
        .eq('user_id', userId)
        .single();

      // Calculate next month number
      const nextMonthNumber = (existingState?.current_month_number || 0) + 1;

      // Clear day boxes for the new month (fresh start)
      console.log(`[Auto-Backtest] Starting fresh Month ${nextMonthNumber} - clearing calendar`);
      await this.clearDailyResultsForMonth(userId, nextMonthNumber);

      console.log('[Auto-Backtest] 🚀 Starting 30-day progressive learning system');
      this.userId = userId;
      this.isRunning = true;
      this.sessionId = this.generateSessionId();
      this.abortController = new AbortController();

      const deviceInfo = this.getDeviceInfo();

      // Sync state to database with error handling
      console.log('[Auto-Backtest] Syncing state to database...');
      await this.syncStateToDatabase({
        is_running: true,
        started_at: new Date().toISOString(),
        session_id: this.sessionId,
        started_from_device: deviceInfo,
        last_heartbeat: new Date().toISOString(),
        last_error_message: null,
        last_error_at: null
      });

      // Verify database state was updated (read-back confirmation)
      console.log('[Auto-Backtest] Verifying database state...');
      const { data: verifyState, error: verifyError } = await supabase
        .from('auto_backtest_global_state')
        .select('is_running')
        .eq('user_id', userId)
        .single();

      if (verifyError) {
        console.error('[Auto-Backtest] Database verification error:', verifyError);
        this.isRunning = false;
        return { success: false, message: `Database error: ${verifyError.message}` };
      }

      if (!verifyState?.is_running) {
        console.error('[Auto-Backtest] Failed to verify running state in database');
        this.isRunning = false;
        return { success: false, message: 'Failed to start auto-backtest - database sync error' };
      }

      console.log('[Auto-Backtest] ✅ Database state confirmed - auto-backtest is running');

      this.startHeartbeat();

      // Start the loop but catch errors
      this.runLoop().catch(async (error) => {
        console.error('[Auto-Backtest] Fatal error in run loop:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.syncStateToDatabase({
          is_running: false,
          stopped_at: new Date().toISOString(),
          last_error_message: `Fatal error: ${errorMessage}`,
          last_error_at: new Date().toISOString()
        });
        this.isRunning = false;
      });

      return { success: true, message: 'Auto-backtest started successfully' };
    } catch (error) {
      console.error('[Auto-Backtest] Error in start():', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.isRunning = false;

      // Try to save error to database
      try {
        await this.syncStateToDatabase({
          is_running: false,
          last_error_message: `Start failed: ${errorMessage}`,
          last_error_at: new Date().toISOString()
        });
      } catch (dbError) {
        console.error('[Auto-Backtest] Could not save error to database:', dbError);
      }

      return { success: false, message: `Failed to start: ${errorMessage}` };
    }
  }

  /**
   * Stop auto-backtest loop
   * Ensures complete cleanup of all state
   */
  async stop(): Promise<void> {
    console.log('[Auto-Backtest] 🛑 Stopping auto-backtest system');

    // Set flag first to stop the loop
    this.isRunning = false;

    // Clean up all timers and controllers
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

    // Always stop in database, even if not running locally
    // This handles cross-device/cross-tab scenarios
    if (this.userId) {
      await this.forceStopInDatabase(this.userId);
    }

    // Verify database state was updated
    if (this.userId) {
      const { data: verifyState } = await supabase
        .from('auto_backtest_global_state')
        .select('is_running')
        .eq('user_id', this.userId)
        .single();

      if (verifyState?.is_running) {
        console.warn('[Auto-Backtest] Warning: Database still shows running after stop');
      } else {
        console.log('[Auto-Backtest] ✅ Database state confirmed - auto-backtest is stopped');
      }
    }

    // Reset session tracking
    this.sessionId = '';
    this.monthlyParentSessionId = null;

    console.log('[Auto-Backtest] Stopped and cleaned up');
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
          monthlyParentSessionId: dbState.monthly_parent_session_id,
          lastErrorMessage: dbState.last_error_message || null,
          lastErrorAt: dbState.last_error_at ? new Date(dbState.last_error_at) : null
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
      monthlyParentSessionId: this.monthlyParentSessionId,
      lastErrorMessage: null,
      lastErrorAt: null
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

        // Clear day boxes for this new month
        await this.clearDailyResultsForMonth(this.userId!, this.currentMonthNumber);

        await this.syncStateToDatabase({});

        // Run 30 daily sessions with DAILY LEARNING (30 cycles, not 3)
        for (let day = 1; day <= this.DAYS_PER_MONTH; day++) {
          if (!this.isRunning) break;

          this.currentDayInMonth = day;

          console.log(`\n[Auto-Backtest] ========== DAY ${day}/30 (Daily Learning Cycle) ==========`);

          // PHASE 1: Pre-Session Pair Selection
          console.log(`[Auto-Backtest] 🎯 PHASE 1: LLM Pair Selection...`);
          const { llmPairSelector } = await import('./llm-pair-selector');
          const selectedPair = await llmPairSelector.selectPairForDay(this.userId!);

          console.log(`[Auto-Backtest] ✅ Selected Pair: ${selectedPair.symbol}`);
          console.log(`[Auto-Backtest]   Confidence: ${selectedPair.confidence}%`);
          console.log(`[Auto-Backtest]   Reasoning: ${selectedPair.reasoning}`);

          // PHASE 2: Run Daily Session (ONE pair only)
          console.log(`[Auto-Backtest] 📊 PHASE 2: Running backtest for ${selectedPair.symbol}...`);
          await this.runDailySession(day, selectedPair);

          // PHASE 3: Post-Session LLM Analysis (IMMEDIATE)
          console.log(`[Auto-Backtest] 🧠 PHASE 3: Post-session LLM analysis...`);
          await this.triggerDailyLearningCycle(day, selectedPair);

          // PHASE 4: Update Memory Systems
          console.log(`[Auto-Backtest] 💾 PHASE 4: Updating memory systems...`);
          await this.updateMemorySystems(day);

          // PHASE 5: Update KPIs Daily
          console.log(`[Auto-Backtest] 📊 PHASE 5: Updating daily KPIs...`);
          const { kpiAggregator } = await import('./kpi-aggregator');
          await kpiAggregator.updateAllKPIs(this.userId!);

          // PHASE 6: Update Performance Metrics (DAILY)
          console.log(`[Auto-Backtest] 📈 PHASE 6: Updating performance metrics...`);
          const { aiSkillTracker } = await import('./ai-skill-tracker');
          const { plateauDetector } = await import('./plateau-detector');

          // Update skill progression after each day
          await aiSkillTracker.recalculateSkillProgression(this.userId!);
          console.log(`[Auto-Backtest]   ✓ Skill progression updated`);

          // Detect plateau after each day
          await plateauDetector.detectPlateau(this.userId!);
          console.log(`[Auto-Backtest]   ✓ Plateau analysis complete`);

          console.log(`[Auto-Backtest] ✅ Day ${day} complete with full learning cycle`);

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
   * Trigger DAILY learning analysis (runs after EVERY session)
   */
  private async triggerDailyLearningCycle(
    dayNumber: number,
    selectedPair: { symbol: string; confidence: number }
  ): Promise<void> {
    if (!this.userId) return;

    try {
      console.log(`[Auto-Backtest] 🧠 Running DAILY learning analysis for Day ${dayNumber}...`);

      // Get today's session
      const { data: todaySession } = await supabase
        .from('daily_session_results')
        .select('*')
        .eq('user_id', this.userId)
        .eq('month_number', this.currentMonthNumber)
        .eq('day_number', dayNumber)
        .single();

      if (!todaySession) {
        console.error('[Auto-Backtest] No session found for daily learning');
        return;
      }

      // Import learning services
      const { progressiveDailyLearning } = await import('./progressive-daily-learning');
      const { llmPostSessionAnalyzer } = await import('./llm-post-session-analyzer');

      // Run progressive daily learning (already exists!)
      console.log('[Auto-Backtest] 📚 Processing daily progressive learning...');
      await progressiveDailyLearning.processDailySession(this.userId, todaySession);

      // Run LLM post-session analysis
      console.log('[Auto-Backtest] 🤖 Running LLM post-session analysis...');
      console.log(`[Auto-Backtest] Fetching trades for session: ${todaySession.session_name}`);
      const trades = await this.fetchSessionTrades(todaySession.session_name);
      console.log(`[Auto-Backtest] Found ${trades.length} trades for learning analysis`);

      if (trades.length === 0) {
        console.warn('[Auto-Backtest] ⚠️ NO TRADES FOUND - AI learning skipped!');
        console.warn('[Auto-Backtest] Session name:', todaySession.session_name);
        console.warn('[Auto-Backtest] Check if trades were saved to trade_history table');
        console.warn('[Auto-Backtest] This explains why AI Learning Center shows no data');
        return;
      }

      console.log(`[Auto-Backtest] Running LLM analysis on ${trades.length} trades...`);
      await llmPostSessionAnalyzer.analyzeSession(
        this.userId,
        todaySession.session_name,
        trades,
        'synthetic'
      );
      console.log('[Auto-Backtest] ✅ LLM analysis complete - data should appear in AI Learning Center');

      // Calculate pair selection accuracy
      await this.calculatePairSelectionAccuracy(selectedPair, todaySession);

      console.log(`[Auto-Backtest] ✅ Daily learning complete for Day ${dayNumber}`);

    } catch (error) {
      console.error('[Auto-Backtest] Error in daily learning cycle:', error);
    }
  }

  /**
   * Run consistency validation at 10-session intervals
   */
  private async runConsistencyValidation(sessionCount: number): Promise<void> {
    if (!this.userId) return;

    try {
      console.log('[Auto-Backtest] 🎯 Running consistency validation...');

      const { aiSessionConsistencyTracker } = await import('./ai-session-consistency-tracker');
      const validation = await aiSessionConsistencyTracker.validateConsistency(this.userId);

      if (validation) {
        console.log(`[Auto-Backtest] Consistency Validation Results:`);
        console.log(`  - Passed: ${validation.isPassing ? '✅ YES' : '❌ NO'}`);
        console.log(`  - WR Spread: ${validation.winRateSpread?.toFixed(2)}% (Max: ${validation.allowedWinRateSpread?.toFixed(2)}%)`);
        console.log(`  - PF Average: ${validation.profitFactorAverage?.toFixed(2)} (Min: ${validation.minimumProfitFactor?.toFixed(2)})`);

        if (!validation.isPassing && validation.failureReason) {
          console.warn(`[Auto-Backtest] ⚠️  Consistency Issue: ${validation.failureReason}`);
        }
      }
    } catch (error) {
      console.error('[Auto-Backtest] Error in consistency validation:', error);
    }
  }

  /**
   * Run a single daily session (1 day of trading) with LLM-selected pair
   */
  private async runDailySession(
    dayNumber: number,
    selectedPair: { symbol: string; confidence: number; reasoning: string; expectedEV: number; riskLevel: string }
  ): Promise<void> {
    if (!this.userId) {
      throw new Error('No user ID available for daily session');
    }

    try {
      const sessionName = this.generateDailySessionName(dayNumber);
      const riskLevel = this.randomRiskLevel();

      // USE ONLY THE SELECTED PAIR (not all 5)
      const symbols = [selectedPair.symbol];

      // Each day is exactly 1 day of data
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 1 * 24 * 60 * 60 * 1000); // 1 day

      console.log(`[Auto-Backtest] Session: ${sessionName}`);
      console.log(`[Auto-Backtest] Duration: 1 day`);
      console.log(`[Auto-Backtest] Pair: ${selectedPair.symbol} (LLM Confidence: ${selectedPair.confidence}%)`);
      console.log(`[Auto-Backtest] Risk Level: ${riskLevel}`);

      const config: SyntheticBacktestConfig = {
        sessionName,
        description: `Month ${this.currentMonthNumber} - Day ${dayNumber} - ${selectedPair.symbol} - ${riskLevel} risk`,
        symbols,
        selectedPair, // NEW: Store selected pair info
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
        marketScenario: 'mixed',
        executionMode: 'AUTO'
      };

      console.log('[Auto-Backtest] Starting synthetic backtest engine...');
      // Execute daily backtest (includes AI learning automatically)
      const result = await syntheticBacktestingEngine.runSyntheticBacktest(
        this.userId,
        config,
        (progress) => {
          console.log(`[Auto-Backtest] Day ${dayNumber} Progress: ${progress.message} (${progress.percentComplete.toFixed(1)}%)`);
        }
      );

      // Update day result with selected pair info
      this.lastDayResult = {
        dayNumber,
        sessionName,
        symbol: selectedPair.symbol, // NEW
        pairConfidence: selectedPair.confidence, // NEW
        winRate: result.winRate,
        totalTrades: result.totalTrades,
        pnl: result.totalPnL,
        completedAt: new Date()
      };

      console.log(`[Auto-Backtest] Day ${dayNumber} ✅ Win rate: ${result.winRate.toFixed(1)}%, P&L: $${result.totalPnL.toFixed(2)}, Trades: ${result.totalTrades}`);

      // Save daily result to database for calendar persistence
      await this.saveDailyResult(dayNumber, sessionName, result, selectedPair);

      // Process confidence tracking for completed trades
      try {
        const { aiConfidenceTracker } = await import('./ai-confidence-tracker');
        await aiConfidenceTracker.processSyntheticBacktestTrades(this.userId, result.sessionId);
      } catch (confError) {
        console.error('[Auto-Backtest] Error processing confidence tracking:', confError);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Auto-Backtest] ERROR in runDailySession (Day ${dayNumber}):`, errorMessage);
      console.error('[Auto-Backtest] Error details:', error);

      // Save error to database
      await this.syncStateToDatabase({
        last_error_message: `Day ${dayNumber} failed: ${errorMessage}`,
        last_error_at: new Date().toISOString()
      });

      throw error; // Re-throw to be caught by the main loop
    }
  }

  /**
   * Save daily result to database for calendar persistence
   */
  private async saveDailyResult(
    dayNumber: number,
    sessionName: string,
    result: any,
    selectedPair: { symbol: string; confidence: number }
  ): Promise<void> {
    if (!this.userId) return;

    try {
      console.log(`[Auto-Backtest] 💾 Saving day ${dayNumber} result to database...`);

      const { error } = await supabase
        .from('daily_session_results')
        .upsert({
          user_id: this.userId,
          month_number: this.currentMonthNumber,
          day_number: dayNumber,
          session_date: new Date().toISOString(),
          session_name: sessionName,
          monthly_parent_session_id: this.monthlyParentSessionId,
          selected_pair: selectedPair.symbol, // NEW
          pair_confidence: selectedPair.confidence, // NEW
          win_rate: result.winRate || 0,
          total_trades: result.totalTrades || 0,
          pnl: result.totalPnL || 0,
          is_profitable: (result.totalPnL || 0) > 0,
          session_css: result.css || 0,
          session_ev: result.ev || 0,
          profit_factor: result.profitFactor || 0,
          key_learnings: result.keyLearnings || []
        }, {
          onConflict: 'user_id,month_number,day_number'
        });

      if (error) {
        console.error('[Auto-Backtest] Error saving daily result:', error);
        throw error;
      }

      console.log(`[Auto-Backtest] ✅ Day ${dayNumber} result saved - ${(result.totalPnL || 0) > 0 ? '✓ Profitable' : '✗ Loss'}`);
    } catch (error) {
      console.error('[Auto-Backtest] Failed to save daily result:', error);
    }
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
   * Clear daily session results for a specific month
   * Called when starting a fresh month to reset the calendar
   */
  private async clearDailyResultsForMonth(userId: string, monthNumber: number): Promise<void> {
    try {
      console.log(`[Auto-Backtest] 🧹 Clearing daily results for Month ${monthNumber}...`);

      const { error } = await supabase
        .from('daily_session_results')
        .delete()
        .eq('user_id', userId)
        .eq('month_number', monthNumber);

      if (error) {
        console.error('[Auto-Backtest] Error clearing daily results:', error);
        throw error;
      }

      console.log(`[Auto-Backtest] ✅ Daily results cleared for Month ${monthNumber} - calendar boxes reset`);
    } catch (error) {
      console.error('[Auto-Backtest] Failed to clear daily results:', error);
      // Don't fail the start, just log the error
    }
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
   * Calculate pair selection accuracy (expected vs actual)
   */
  private async calculatePairSelectionAccuracy(
    selectedPair: { symbol: string; confidence: number },
    sessionResult: any
  ): Promise<void> {
    if (!this.userId) return;

    try {
      const actualPerformance = sessionResult.win_rate;
      const expectedPerformance = selectedPair.confidence;
      const accuracy = 100 - Math.abs(actualPerformance - expectedPerformance);

      console.log(`[Auto-Backtest] Pair Selection Accuracy: ${accuracy.toFixed(1)}%`);
      console.log(`[Auto-Backtest]   Expected: ${expectedPerformance}%, Actual: ${actualPerformance.toFixed(1)}%`);

      await supabase
        .from('pair_selection_history')
        .update({
          actual_win_rate: actualPerformance,
          accuracy
        })
        .eq('user_id', this.userId)
        .eq('symbol', selectedPair.symbol)
        .order('session_date', { ascending: false })
        .limit(1);
    } catch (error) {
      console.error('[Auto-Backtest] Error calculating pair selection accuracy:', error);
    }
  }

  /**
   * Fetch trades from a session for analysis
   */
  private async fetchSessionTrades(sessionName: string): Promise<any[]> {
    try {
      const { data: trades } = await supabase
        .from('synthetic_backtest_trades')
        .select('*')
        .ilike('session_name', `%${sessionName}%`)
        .order('entry_time', { ascending: true });

      return trades || [];
    } catch (error) {
      console.error('[Auto-Backtest] Error fetching session trades:', error);
      return [];
    }
  }

  /**
   * Update memory systems after daily learning
   */
  private async updateMemorySystems(dayNumber: number): Promise<void> {
    if (!this.userId) return;

    try {
      console.log('[Auto-Backtest] Updating AI memory systems...');

      const { aiSkillTracker } = await import('./ai-skill-tracker');
      await aiSkillTracker.recalculateProgression(this.userId);

      console.log('[Auto-Backtest] ✅ Memory systems updated');
    } catch (error) {
      console.error('[Auto-Backtest] Error updating memory systems:', error);
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
