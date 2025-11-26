/**
 * Simple Auto-Backtest Service with Daily Learning Cycles
 *
 * NEW ARCHITECTURE (Daily Learning System):
 * - Each day is a complete learning cycle (30 cycles per month, not 3)
 * - Daily flow: Pair Selection → Backtest → Copy Trades → LLM Analysis → Memory Update
 * - LLM selects ONE optimal pair before each session
 * - Post-session analysis runs IMMEDIATELY after every day
 * - All learnings are instant and cumulative
 * - After 30 days complete, wait random delay (30-90s) then start new month
 *
 * Daily Flow (Repeated 30 times per month):
 * 1. PHASE 1: Pre-Session Pair Selection (LLM analyzes all pairs, picks best)
 * 2. PHASE 2: Run 1-Day Backtest (only for selected pair)
 * 3. PHASE 3: Copy Synthetic Trades to History (enables Progressive Daily Learning)
 * 4. PHASE 4: Post-Session LLM Analysis (immediate learning extraction)
 * 5. PHASE 5: Update Memory Systems (insights, patterns, calibration)
 * 6. PHASE 6: Update KPIs Daily
 * 7. PHASE 7: Update Performance Metrics (skill progression, plateau detection)
 * 8. Move to next day immediately
 */

import { syntheticBacktestingEngine, SyntheticBacktestConfig } from './synthetic-backtesting-engine';
import { plateauDetector } from './plateau-detector';
import { breakthroughEngine } from './breakthrough-engine';
import { supabase } from '../lib/supabase';

export interface SimpleAutoBacktestState {
  isRunning: boolean;
  isPaused: boolean; // NEW: Tracks if paused with saved position
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
  pausedAt?: Date | null; // NEW: When paused
  resumedAt?: Date | null; // NEW: When resumed
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
    console.log('[Auto-Backtest] 🔧 Initializing service for user:', userId);
    this.userId = userId;

    console.log('[Auto-Backtest] 📊 Checking database for existing state...');
    const { data: existingState, error: stateError } = await supabase
      .from('auto_backtest_global_state')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (stateError && stateError.code !== 'PGRST116') {
      console.error('[Auto-Backtest] ❌ Error loading state:', stateError);
      throw new Error(`Failed to load auto-backtest state: ${stateError.message}`);
    }

    if (existingState && existingState.is_running) {
      const lastHeartbeat = new Date(existingState.last_heartbeat);
      const minutesSinceHeartbeat = (Date.now() - lastHeartbeat.getTime()) / 1000 / 60;
      console.log(`[Auto-Backtest] ⏰ Found existing session. Last heartbeat: ${minutesSinceHeartbeat.toFixed(1)} minutes ago`);

      if (minutesSinceHeartbeat > 5) {
        console.log('[Auto-Backtest] 🧹 Found stale session (>5 min), cleaning up...');
        await this.forceStopInDatabase(userId);
        // Stale session = will do fresh start, so clear the old month's results
        if (existingState.current_month_number) {
          console.log('[Auto-Backtest] Clearing stale session data...');
          await this.clearDailyResultsForMonth(userId, existingState.current_month_number);
        }
      } else {
        console.log('[Auto-Backtest] ✅ Found active session - will resume with existing progress');
        console.log('[Auto-Backtest] 📱 Started from:', existingState.started_from_device);
        console.log('[Auto-Backtest] 📅 Progress: Month', existingState.current_month_number, '- Day', existingState.current_day_in_month, '/30');
        console.log('[Auto-Backtest] 📝 Last status:', existingState.last_status_message);
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
    console.log('\n[Auto-Backtest] ========================================');
    console.log('[Auto-Backtest] 🚀 START REQUEST RECEIVED');
    console.log('[Auto-Backtest] User ID:', userId);
    console.log('[Auto-Backtest] ========================================\n');

    try {
      console.log('[Auto-Backtest] Step 1: Force stopping any existing sessions...');
      await this.forceStopInDatabase(userId);
      console.log('[Auto-Backtest] ✓ Existing sessions stopped');

      console.log('[Auto-Backtest] Step 2: Resetting local state...');
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
      console.log('[Auto-Backtest] ✓ Local state reset complete');

      // Small delay to ensure cleanup completes
      console.log('[Auto-Backtest] ⏱️ Waiting 500ms for cleanup...');
      await new Promise(resolve => setTimeout(resolve, 500));
      console.log('[Auto-Backtest] ✓ Cleanup complete');

      // Initialize fresh state
      console.log('[Auto-Backtest] Step 3: Initializing fresh state...');
      await this.initialize(userId);
      console.log('[Auto-Backtest] ✓ Initialization complete');

      // Determine if this is a fresh start (new month) or recovery
      // Get current state to see what month we're on
      console.log('[Auto-Backtest] Step 4: Determining next month number...');
      const { data: existingState, error: stateCheckError } = await supabase
        .from('auto_backtest_global_state')
        .select('current_month_number, current_day_in_month')
        .eq('user_id', userId)
        .single();

      if (stateCheckError && stateCheckError.code !== 'PGRST116') {
        console.error('[Auto-Backtest] ❌ Error checking state:', stateCheckError);
        throw new Error(`Failed to check state: ${stateCheckError.message}`);
      }

      // Calculate next month number
      const nextMonthNumber = (existingState?.current_month_number || 0) + 1;
      console.log(`[Auto-Backtest] 📅 Next month will be: Month ${nextMonthNumber}`);

      // Clear day boxes for the new month (fresh start)
      console.log(`[Auto-Backtest] Step 5: Clearing calendar for Month ${nextMonthNumber}...`);
      await this.clearDailyResultsForMonth(userId, nextMonthNumber);
      console.log('[Auto-Backtest] ✓ Calendar cleared');

      console.log('[Auto-Backtest] Step 6: Setting up new session...');
      console.log('[Auto-Backtest] 🚀 Starting 30-day progressive learning system');
      this.userId = userId;
      this.isRunning = true;
      this.sessionId = this.generateSessionId();
      this.abortController = new AbortController();
      console.log('[Auto-Backtest] 🆔 Session ID:', this.sessionId);

      const deviceInfo = this.getDeviceInfo();
      console.log('[Auto-Backtest] 📱 Device:', deviceInfo);

      // Sync state to database with error handling
      console.log('[Auto-Backtest] Step 7: Syncing state to database...');
      await this.syncStateToDatabase({
        is_running: true,
        started_at: new Date().toISOString(),
        session_id: this.sessionId,
        started_from_device: deviceInfo,
        last_heartbeat: new Date().toISOString(),
        last_error_message: null,
        last_error_at: null
      });
      console.log('[Auto-Backtest] ✓ State synced to database');

      // Verify database state was updated (read-back confirmation)
      console.log('[Auto-Backtest] Step 8: Verifying database state...');
      const { data: verifyState, error: verifyError } = await supabase
        .from('auto_backtest_global_state')
        .select('is_running')
        .eq('user_id', userId)
        .single();

      if (verifyError) {
        console.error('[Auto-Backtest] ❌ Database verification error:', verifyError);
        this.isRunning = false;
        return { success: false, message: `Database error: ${verifyError.message}` };
      }

      if (!verifyState?.is_running) {
        console.error('[Auto-Backtest] ❌ Failed to verify running state in database');
        console.error('[Auto-Backtest] Database returned:', verifyState);
        this.isRunning = false;
        return { success: false, message: 'Failed to start auto-backtest - database sync error' };
      }

      console.log('[Auto-Backtest] ✅ Database state confirmed - auto-backtest is running');
      console.log('[Auto-Backtest] Step 9: Starting heartbeat...');

      this.startHeartbeat();
      console.log('[Auto-Backtest] ✓ Heartbeat started');

      console.log('[Auto-Backtest] Step 10: Starting main loop...');
      console.log('[Auto-Backtest] ========================================');
      console.log('[Auto-Backtest] 🎉 AUTO-BACKTEST STARTED SUCCESSFULLY');
      console.log('[Auto-Backtest] ========================================\n');

      // Start the loop but catch errors
      this.runLoop().catch(async (error) => {
        console.error('\n[Auto-Backtest] ========================================');
        console.error('[Auto-Backtest] ❌ FATAL ERROR IN RUN LOOP');
        console.error('[Auto-Backtest] ========================================');
        console.error('[Auto-Backtest] Error:', error);
        console.error('[Auto-Backtest] Stack:', error instanceof Error ? error.stack : 'No stack trace');
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.syncStateToDatabase({
          is_running: false,
          stopped_at: new Date().toISOString(),
          last_error_message: `Fatal error: ${errorMessage}`,
          last_error_at: new Date().toISOString()
        });
        this.isRunning = false;
        console.error('[Auto-Backtest] ========================================\n');
      });

      return { success: true, message: 'Auto-backtest started successfully' };
    } catch (error) {
      console.error('\n[Auto-Backtest] ========================================');
      console.error('[Auto-Backtest] ❌ ERROR STARTING AUTO-BACKTEST');
      console.error('[Auto-Backtest] ========================================');
      console.error('[Auto-Backtest] Error:', error);
      console.error('[Auto-Backtest] Stack:', error instanceof Error ? error.stack : 'No stack trace');
      console.error('[Auto-Backtest] ========================================\n');
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
  async stop(clearProgress = true): Promise<void> {
    console.log(`[Auto-Backtest] 🛑 ${clearProgress ? 'Stopping and resetting' : 'Pausing'} auto-backtest system`);

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

    if (clearProgress) {
      // FULL STOP: Clear all progress and reset to beginning
      console.log('[Auto-Backtest] Clearing all progress - will start from Month 1 Day 1 next time');
      this.totalMonthsCompleted = 0;
      this.currentMonthNumber = 0;
      this.currentDayInMonth = 0;
      this.monthlyParentSessionId = null;
      this.lastDayResult = null;

      if (this.userId) {
        await supabase
          .from('auto_backtest_global_state')
          .update({
            is_running: false,
            is_paused: false,
            current_month_number: 0,
            current_day_in_month: 0,
            total_months_completed: 0,
            monthly_parent_session_id: null,
            stopped_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('user_id', this.userId);

        console.log('[Auto-Backtest] ✅ Progress cleared - ready for fresh start');
      }
    } else {
      // PAUSE: Keep progress, just mark as not running
      if (this.userId) {
        await this.forceStopInDatabase(this.userId);
      }
    }

    // Verify database state was updated
    if (this.userId) {
      const { data: verifyState } = await supabase
        .from('auto_backtest_global_state')
        .select('is_running, current_month_number, current_day_in_month')
        .eq('user_id', this.userId)
        .single();

      if (verifyState?.is_running) {
        console.warn('[Auto-Backtest] Warning: Database still shows running after stop');
      } else {
        if (clearProgress) {
          console.log('[Auto-Backtest] ✅ Stopped and reset - position cleared');
        } else {
          console.log('[Auto-Backtest] ✅ Paused - position saved at Month', verifyState?.current_month_number, 'Day', verifyState?.current_day_in_month);
        }
      }
    }

    // Reset session tracking
    this.sessionId = '';
    if (clearProgress) {
      this.monthlyParentSessionId = null;
    }

    console.log('[Auto-Backtest] Stopped and cleaned up');
  }

  /**
   * Pause auto-backtest (saves position for resume)
   */
  async pause(): Promise<void> {
    console.log(`[Auto-Backtest] ⏸️ Pausing at Month ${this.currentMonthNumber}, Day ${this.currentDayInMonth}`);

    // Stop processing but keep position
    this.isRunning = false;

    // Clean up timers
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

    // Save state as paused (position preserved)
    if (this.userId) {
      await supabase
        .from('auto_backtest_global_state')
        .update({
          is_running: false,
          is_paused: true,
          paused_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('user_id', this.userId);

      console.log('[Auto-Backtest] ✅ Paused - position saved');
    }
  }

  /**
   * Resume auto-backtest from paused state
   */
  async resume(userId: string): Promise<{ success: boolean; message?: string }> {
    console.log('[Auto-Backtest] ▶️ Resuming from paused state...');

    try {
      // Load saved state from database
      const state = await this.getState();

      if (!state.isPaused) {
        return {
          success: false,
          message: 'Cannot resume - not in paused state'
        };
      }

      if (state.currentMonthNumber === 0 && state.currentDayInMonth === 0) {
        return {
          success: false,
          message: 'No saved position to resume from'
        };
      }

      // Restore position from saved state
      this.userId = userId;
      this.currentMonthNumber = state.currentMonthNumber;
      this.currentDayInMonth = state.currentDayInMonth;
      this.totalMonthsCompleted = state.totalMonthsCompleted;
      this.monthlyParentSessionId = state.monthlyParentSessionId || null;
      this.lastDayResult = state.lastDayResult;
      this.plateauDetected = state.plateauDetected;
      this.breakthroughMode = state.breakthroughMode;
      this.plateauDuration = state.plateauDuration;

      console.log(`[Auto-Backtest] Resuming from Month ${this.currentMonthNumber}, Day ${this.currentDayInMonth}`);

      // Mark as running and clear pause state
      this.isRunning = true;
      await supabase
        .from('auto_backtest_global_state')
        .update({
          is_running: true,
          is_paused: false,
          resumed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      // Start background monitoring
      this.startHeartbeat();

      // Continue from saved day (runDailyBacktest will pick up from currentDayInMonth)
      this.runDailyBacktest();

      return {
        success: true,
        message: `Resumed from Month ${this.currentMonthNumber}, Day ${this.currentDayInMonth}`
      };

    } catch (error) {
      console.error('[Auto-Backtest] Error resuming:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error'
      };
    }
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
          isPaused: dbState.is_paused || false,
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
          lastErrorAt: dbState.last_error_at ? new Date(dbState.last_error_at) : null,
          pausedAt: dbState.paused_at ? new Date(dbState.paused_at) : null,
          resumedAt: dbState.resumed_at ? new Date(dbState.resumed_at) : null
        };
      }
    }

    return {
      isRunning: this.isRunning,
      isPaused: false,
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
      lastErrorAt: null,
      pausedAt: null,
      resumedAt: null
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
          if (!this.isRunning) {
            console.log(`[Auto-Backtest] ⏸️ Stopped by user at Day ${day}`);
            break;
          }

          this.currentDayInMonth = day;

          console.log(`\n[Auto-Backtest] ========== DAY ${day}/30 (Daily Learning Cycle) ==========`);
          console.log(`[Auto-Backtest] Progress: ${((day - 1) / this.DAYS_PER_MONTH * 100).toFixed(1)}% complete`);
          console.log(`[Auto-Backtest] Month: ${this.currentMonthNumber}`);

          try {
            // PHASE 1: Pre-Session Pair Selection
            console.log(`[Auto-Backtest] 🎯 PHASE 1: LLM Pair Selection...`);
            const { llmPairSelector } = await import('./llm-pair-selector');
            const selectedPair = await llmPairSelector.selectPairForDay(this.userId!);

            console.log(`[Auto-Backtest] ✅ Selected Pair: ${selectedPair.symbol}`);
            console.log(`[Auto-Backtest]   Confidence: ${selectedPair.confidence}%`);
            console.log(`[Auto-Backtest]   Reasoning: ${selectedPair.reasoning}`);

            // Update database state before starting backtest
            await this.syncStateToDatabase({
              last_status_message: `Day ${day}: Running backtest for ${selectedPair.symbol}`,
              last_status_updated_at: new Date().toISOString()
            });

            // PHASE 2: Run Daily Session (ONE pair only)
            console.log(`[Auto-Backtest] 📊 PHASE 2: Running backtest for ${selectedPair.symbol}...`);
            await this.runDailySession(day, selectedPair);
            console.log(`[Auto-Backtest] ✓ Backtest complete`);

            // Update database state
            await this.syncStateToDatabase({
              last_status_message: `Day ${day}: Copying trades to history`,
              last_status_updated_at: new Date().toISOString()
            });

            // PHASE 3: Copy Synthetic Trades to History (NEW!)
            console.log(`[Auto-Backtest] 📋 PHASE 3: Copying trades to history...`);
            const { data: todaySessionData } = await supabase
              .from('synthetic_backtest_sessions')
              .select('id')
              .eq('user_id', this.userId!)
              .ilike('session_name', `%Day ${day}%`)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (todaySessionData) {
              const { syntheticTradeCopier } = await import('./synthetic-trade-copier');
              const copiedCount = await syntheticTradeCopier.copySyntheticTradesToHistory(
                todaySessionData.id,
                this.userId!
              );
              console.log(`[Auto-Backtest]   ✓ Copied ${copiedCount} trades to history`);
            } else {
              console.warn(`[Auto-Backtest]   ⚠️ No session data found to copy trades`);
            }

            // Update database state
            await this.syncStateToDatabase({
              last_status_message: `Day ${day}: Running LLM analysis and generating reflection`,
              last_status_updated_at: new Date().toISOString()
            });

            // PHASE 4: Post-Session LLM Analysis + Reflection Generation (IMMEDIATE)
            console.log(`[Auto-Backtest] 🧠 PHASE 4: Post-session LLM analysis + reflection...`);
            await this.triggerDailyLearningCycle(day, selectedPair);
            console.log(`[Auto-Backtest] ✓ Analysis and reflection complete`);

            // PHASE 5: Update Memory Systems
            console.log(`[Auto-Backtest] 💾 PHASE 5: Updating memory systems...`);
            await this.updateMemorySystems(day);
            console.log(`[Auto-Backtest] ✓ Memory systems updated`);

            // PHASE 6: Update KPIs Daily
            console.log(`[Auto-Backtest] 📊 PHASE 6: Updating daily KPIs...`);
            const { kpiAggregator } = await import('./kpi-aggregator');
            await kpiAggregator.updateAllKPIs(this.userId!);
            console.log(`[Auto-Backtest] ✓ KPIs updated`);

            // PHASE 7: Update Performance Metrics (DAILY)
            console.log(`[Auto-Backtest] 📈 PHASE 7: Updating performance metrics...`);
            const { aiSkillTracker } = await import('./ai-skill-tracker');
            const { plateauDetector } = await import('./plateau-detector');

            // Update skill progression after each day
            try {
              // Fetch today's session results to pass to skill tracker (INCLUDING P&L DATA!)
              const { data: todayResults } = await supabase
                .from('daily_session_results')
                .select('total_trades, win_rate, profit_factor, key_learnings, pnl, winning_trades, losing_trades')
                .eq('user_id', this.userId!)
                .eq('month_number', this.currentMonthNumber)
                .eq('day_number', day)
                .single();

              if (todayResults) {
                console.log(`[Auto-Backtest]   📊 Session P&L: $${todayResults.pnl || 0}`);
                const skillResult = await aiSkillTracker.recalculateSkillProgression(
                  this.userId!,
                  todayResults
                );

                if (skillResult.success) {
                  console.log(`[Auto-Backtest]   ✓ Skill progression updated`);
                  if (skillResult.leveledUp) {
                    console.log(`[Auto-Backtest]   🎉 LEVEL UP! New level: ${skillResult.newLevel}`);
                  }
                } else {
                  console.warn(`[Auto-Backtest]   ⚠️ Skill progression update skipped (no trades or error)`);
                }
              } else {
                console.warn(`[Auto-Backtest]   ⚠️ No session results found for Day ${day}`);
              }
            } catch (skillError) {
              console.error(`[Auto-Backtest]   ❌ Error updating skill progression:`, skillError);
              console.error(`[Auto-Backtest]   This is non-critical, continuing...`);
            }

            // Detect plateau after each day
            try {
              await plateauDetector.detectPlateau(this.userId!);
              console.log(`[Auto-Backtest]   ✓ Plateau analysis complete`);
            } catch (plateauError) {
              console.error(`[Auto-Backtest]   ❌ Error in plateau detection:`, plateauError);
              console.error(`[Auto-Backtest]   This is non-critical, continuing...`);
            }

            console.log(`[Auto-Backtest] ========================================`);
            console.log(`[Auto-Backtest] ✅ Day ${day} COMPLETE with full learning cycle`);
            console.log(`[Auto-Backtest] ========================================\n`);

            // Final state update for this day
            await this.syncStateToDatabase({
              last_status_message: `Day ${day} complete - ${((day / this.DAYS_PER_MONTH) * 100).toFixed(1)}% of month done`,
              last_status_updated_at: new Date().toISOString()
            });

            // Small delay between days (increased to reduce database strain)
            if (day < this.DAYS_PER_MONTH && this.isRunning) {
              console.log(`[Auto-Backtest] 💤 Preparing Day ${day + 1}... (10s delay)`);
              await this.sleep(10000); // 10 second delay between days (was 5s)
            }

          } catch (dayError) {
            console.error(`[Auto-Backtest] ❌ ERROR on Day ${day}:`, dayError);
            console.error(`[Auto-Backtest] Error type:`, dayError instanceof Error ? dayError.constructor.name : typeof dayError);
            console.error(`[Auto-Backtest] Error message:`, dayError instanceof Error ? dayError.message : String(dayError));

            // Save error to database
            await this.syncStateToDatabase({
              last_error_message: `Day ${day} failed: ${dayError instanceof Error ? dayError.message : String(dayError)}`,
              last_error_at: new Date().toISOString(),
              last_status_message: `Day ${day} failed - check logs`,
              last_status_updated_at: new Date().toISOString()
            });

            // Continue to next day instead of stopping entire month
            console.warn(`[Auto-Backtest] ⚠️ Skipping Day ${day} and continuing to next day...`);
            await this.sleep(5000); // Short delay before continuing
            continue;
          }
        }

        // Month complete
        if (this.currentDayInMonth === this.DAYS_PER_MONTH) {
          this.totalMonthsCompleted++;
          console.log('\n[Auto-Backtest] ========== 30-DAY MONTH COMPLETE ==========');
          console.log(`[Auto-Backtest] ✅ Month #${this.currentMonthNumber} finished!`);
          console.log(`[Auto-Backtest] Total months completed: ${this.totalMonthsCompleted}`);
          console.log('====================================================\n');

          // Verify AI learning pipeline is working (Issue 8)
          try {
            console.log('[Auto-Backtest] 🔍 Verifying AI learning pipeline...');
            const { aiLearningDiagnostics } = await import('./ai-learning-diagnostics');
            const diagnostics = await aiLearningDiagnostics.verifyLearningPipeline(this.userId!);

            if (!diagnostics.isWorking) {
              console.warn('[Auto-Backtest] ⚠️ AI Learning Pipeline Issues:');
              diagnostics.issues.forEach(issue => console.warn(`  - ${issue}`));
            } else {
              console.log('[Auto-Backtest] ✅ AI learning pipeline verified working');
              console.log(`[Auto-Backtest]   Skill Level: ${diagnostics.checks.skillProgression.currentLevel}`);
              console.log(`[Auto-Backtest]   Total Wins: ${diagnostics.checks.skillProgression.totalWinningTrades}`);
            }
          } catch (diagError) {
            console.error('[Auto-Backtest] Error verifying learning pipeline:', diagError);
          }

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
      console.log(`[Auto-Backtest] ========================================`);

      // Get today's session
      const { data: todaySession } = await supabase
        .from('daily_session_results')
        .select('*')
        .eq('user_id', this.userId)
        .eq('month_number', this.currentMonthNumber)
        .eq('day_number', dayNumber)
        .single();

      if (!todaySession) {
        console.error('[Auto-Backtest] ❌ CRITICAL: No session found for daily learning');
        console.error('[Auto-Backtest] This indicates runDailySession() may have failed');
        throw new Error(`No session data found for Day ${dayNumber}`);
      }

      console.log(`[Auto-Backtest] ✓ Session data loaded: ${todaySession.session_name}`);

      // Import learning services
      const { progressiveDailyLearning } = await import('./progressive-daily-learning');
      const { llmPostSessionAnalyzer } = await import('./llm-post-session-analyzer');
      const { aiThoughtGenerator } = await import('./ai-thought-generator');
      const { aiDataAccessValidator } = await import('./ai-data-access-validator');

      // Run progressive daily learning (already exists!)
      console.log('[Auto-Backtest] 📚 Processing daily progressive learning...');
      await progressiveDailyLearning.processDailySession(this.userId, todaySession);
      console.log('[Auto-Backtest] ✓ Progressive learning complete');

      // Run LLM post-session analysis
      console.log('[Auto-Backtest] 🤖 Running LLM post-session analysis...');
      console.log(`[Auto-Backtest] Fetching trades for session: ${todaySession.session_name}`);
      const trades = await this.fetchSessionTrades(todaySession.session_name);
      console.log(`[Auto-Backtest] Found ${trades.length} trades for learning analysis`);

      // Prepare discoveries and challenges for reflection
      let discoveries: string[] = [];
      let challenges: string[] = [];
      let adjustments: string[] = [];

      if (trades.length === 0) {
        console.warn('[Auto-Backtest] ⚠️ NO TRADES FOUND - Will generate reflection anyway');
        console.warn('[Auto-Backtest] Session name:', todaySession.session_name);
        console.warn('[Auto-Backtest] AI can reflect on why no trades happened');

        // Add challenge about no trades
        challenges.push('No trades were generated today - need to investigate if strategy is too restrictive or market conditions were unsuitable');
        adjustments.push('Review entry criteria and market conditions for next session');
      } else {
        console.log(`[Auto-Backtest] Running LLM analysis on ${trades.length} trades...`);
        const analysisResult = await llmPostSessionAnalyzer.analyzeSession(
          this.userId,
          todaySession.session_name,
          trades,
          'synthetic'
        );
        console.log('[Auto-Backtest] ✓ LLM analysis complete');

        // Extract learnings from analysis (if available)
        discoveries = todaySession.key_learnings || [];
        if (todaySession.win_rate > 60) {
          discoveries.push(`Strong performance with ${todaySession.win_rate.toFixed(1)}% win rate`);
        }
      }

      // Calculate pair selection accuracy
      await this.calculatePairSelectionAccuracy(selectedPair, todaySession);
      console.log('[Auto-Backtest] ✓ Pair selection accuracy calculated');

      // CRITICAL: Generate daily reflection for AI Learning Journey
      console.log('[Auto-Backtest] 📝 Generating daily reflection for Learning Journey...');

      // Validate AI data access
      const validation = await aiDataAccessValidator.quickHealthCheck(this.userId, false);

      await aiThoughtGenerator.generateDailyReflection(
        this.userId,
        todaySession.session_name, // session ID
        {
          sessionDate: new Date(todaySession.session_date),
          sessionNumber: dayNumber,
          winRate: todaySession.win_rate || 0,
          profitFactor: todaySession.profit_factor || 0,
          tradesCount: todaySession.total_trades || 0,
          bestPattern: selectedPair.symbol, // Use selected pair as context
          worstPattern: undefined,
          discoveries,
          challenges,
          adjustments,
          currentGoal: `Complete 30-day learning cycle (Day ${dayNumber}/30)`,
          goalProgress: (dayNumber / 30) * 100
        },
        validation
      );
      console.log('[Auto-Backtest] ✅ Daily reflection saved to Learning Journey!');

      console.log(`[Auto-Backtest] ========================================`);
      console.log(`[Auto-Backtest] ✅ Daily learning complete for Day ${dayNumber}`);

    } catch (error) {
      console.error('[Auto-Backtest] ❌ ERROR in daily learning cycle:', error);
      console.error('[Auto-Backtest] Error details:', error instanceof Error ? error.message : String(error));
      // Don't throw - let the day complete even if learning fails
      console.warn('[Auto-Backtest] Continuing to next day despite learning error...');
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

      // Each day uses 7 days of data to ensure enough candles for signal generation
      // H1 needs 50+ candles, M5 needs 50+, M1 needs 50+
      // 7 days = 168 H1 candles, plenty for analysis
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days for sufficient data

      console.log(`[Auto-Backtest] Session: ${sessionName}`);
      console.log(`[Auto-Backtest] Data Window: 7 days (ensures sufficient candles)`);
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
      // Pass abort signal so backtest can be stopped mid-execution
      const result = await syntheticBacktestingEngine.runSyntheticBacktest(
        this.userId,
        config,
        (progress) => {
          console.log(`[Auto-Backtest] Day ${dayNumber} Progress: ${progress.message} (${progress.percentComplete.toFixed(1)}%)`);
        },
        this.abortController?.signal
      );

      // Warn if 0 trades but don't stop - continue with learning anyway
      if (result.totalTrades === 0) {
        console.warn(`[Auto-Backtest] ⚠️ Day ${dayNumber} generated 0 trades`);
        console.warn(`[Auto-Backtest] ⚠️ Possible reasons:`);
        console.warn(`[Auto-Backtest]   1. No candle data available for ${selectedPair.symbol}`);
        console.warn(`[Auto-Backtest]   2. Signal generation found no valid setups`);
        console.warn(`[Auto-Backtest]   3. All signals below confidence threshold (${this.getRiskThreshold(this.randomRiskLevel())}%)`);
        console.warn(`[Auto-Backtest]   4. Market conditions not suitable for strategy`);
        console.warn(`[Auto-Backtest] ✅ Continuing to next day - AI will reflect on this in learning phase`);
      }

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

      // Validate month_number before saving (must be >= 1)
      if (this.currentMonthNumber < 1) {
        throw new Error(`Invalid month_number: ${this.currentMonthNumber}. Must be >= 1. This indicates runLoop() hasn't started yet.`);
      }

      console.log(`[Auto-Backtest] Saving with month_number=${this.currentMonthNumber}, day_number=${dayNumber}`);

      const { error } = await supabase
        .from('daily_session_results')
        .upsert({
          user_id: this.userId,
          month_number: this.currentMonthNumber,
          day_number: dayNumber,
          session_date: new Date().toISOString(),
          session_name: sessionName,
          monthly_parent_session_id: this.monthlyParentSessionId,
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
    // Lowered thresholds to match Layer 4 calibrated confidence output (typically 70%)
    // This allows trades to execute after passing all 5 LLM validation layers
    const thresholds = { low: 70, medium: 65, high: 60 };
    console.log(`[Auto-Backtest] Risk threshold for ${riskLevel}: ${thresholds[riskLevel]}%`);
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
      console.log(`[Auto-Backtest] Looking for trades with session_name matching: "${sessionName}"`);

      // Try trade_history first (where synthetic backtest trades are saved)
      const { data: trades, error } = await supabase
        .from('trade_history')
        .select('*')
        .eq('is_synthetic', true)
        .eq('session_name', sessionName)
        .order('opened_at', { ascending: true });

      if (error) {
        console.error('[Auto-Backtest] Error fetching from trade_history:', error);
      }

      if (trades && trades.length > 0) {
        console.log(`[Auto-Backtest] ✓ Found ${trades.length} trades in trade_history`);
        return trades;
      }

      // Fallback: Try synthetic_backtest_trades if trade_history is empty
      console.log('[Auto-Backtest] No trades in trade_history, checking synthetic_backtest_trades...');
      const { data: syntheticTrades } = await supabase
        .from('synthetic_backtest_trades')
        .select('*')
        .ilike('session_name', `%${sessionName}%`)
        .order('entry_time', { ascending: true });

      if (syntheticTrades && syntheticTrades.length > 0) {
        console.log(`[Auto-Backtest] ✓ Found ${syntheticTrades.length} trades in synthetic_backtest_trades`);
        return syntheticTrades;
      }

      console.warn('[Auto-Backtest] ⚠️ No trades found in either table');
      return [];
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

      // Note: Skill progression is already updated in Phase 7
      // This phase is for other memory-related updates like pattern calibration

      const { aiSkillTracker } = await import('./ai-skill-tracker');

      // Just fetch current progression to log it (already updated in Phase 7)
      const skillProgression = await aiSkillTracker.getSkillProgression(this.userId);
      if (skillProgression) {
        console.log(`[Auto-Backtest]   Current skill level: ${skillProgression.currentSkillLevel}`);
        console.log(`[Auto-Backtest]   Total trades analyzed: ${skillProgression.totalTradesAnalyzed}`);
        console.log(`[Auto-Backtest]   Current win rate: ${skillProgression.currentWinRate.toFixed(1)}%`);
      }

      // TODO: Add other memory system updates here (pattern calibration, confidence updates, etc.)

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
