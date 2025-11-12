/**
 * Browser-Based Auto-Backtest Executor
 *
 * This service runs automatically when the dashboard is open and calls the
 * database function to execute pending jobs. This bypasses all cron/http limitations.
 *
 * HOW IT WORKS:
 * 1. Polls database every 10 seconds when system is active
 * 2. Calls execute_pending_backtest_jobs() database function directly
 * 3. No Edge Functions needed - everything runs in database
 * 4. 100% reliable as long as dashboard is open
 */

import { supabase } from '../lib/supabase';

class AutoBacktestBrowserExecutor {
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 10000; // 10 seconds
  private userId: string | null = null;
  private consecutiveErrors = 0;
  private readonly MAX_CONSECUTIVE_ERRORS = 3;

  /**
   * Start the automatic execution loop
   */
  async start(userId: string): Promise<void> {
    if (this.isRunning) {
      console.log('[Browser Executor] Already running');
      return;
    }

    console.log('[Browser Executor] 🚀 Starting automatic execution loop...');
    this.userId = userId;
    this.isRunning = true;
    this.consecutiveErrors = 0;

    // Execute immediately
    await this.executeOneCycle();

    // Then execute every 10 seconds
    this.intervalId = setInterval(async () => {
      await this.executeOneCycle();
    }, this.POLL_INTERVAL_MS);

    console.log('[Browser Executor] ✅ Automatic execution started');
  }

  /**
   * Stop the automatic execution loop
   */
  stop(): void {
    console.log('[Browser Executor] 🛑 Stopping automatic execution...');
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log('[Browser Executor] Stopped');
  }

  /**
   * Execute one cycle of job processing
   */
  private async executeOneCycle(): Promise<void> {
    if (!this.isRunning || !this.userId) return;

    try {
      // Check if controller is active
      const { data: controller } = await supabase
        .from('auto_backtest_controller')
        .select('is_active, status')
        .eq('user_id', this.userId)
        .maybeSingle();

      if (!controller || !controller.is_active) {
        // System not active, skip this cycle
        return;
      }

      if (controller.status === 'cooldown') {
        console.log('[Browser Executor] ⏰ System in cooldown, skipping');
        return;
      }

      // Check for pending jobs
      const { data: pendingJobs } = await supabase
        .from('auto_backtest_queue')
        .select('id')
        .eq('user_id', this.userId)
        .eq('status', 'pending')
        .limit(1);

      if (!pendingJobs || pendingJobs.length === 0) {
        // No pending jobs, try to create new one by calling runner
        console.log('[Browser Executor] 📝 No pending jobs, calling runner to create one...');

        // Call the database runner function
        const { data: runnerResult, error: runnerError } = await supabase
          .rpc('auto_backtest_runner_cycle');

        if (runnerError) {
          console.error('[Browser Executor] Runner error:', runnerError);
        } else {
          console.log('[Browser Executor] ✅ Runner executed:', runnerResult);
        }

        return;
      }

      // Execute pending jobs using database function
      console.log('[Browser Executor] ⚡ Executing pending jobs...');

      const { data: result, error } = await supabase
        .rpc('execute_pending_backtest_jobs');

      if (error) {
        console.error('[Browser Executor] ❌ Execution error:', error);
        this.consecutiveErrors++;

        if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
          console.error('[Browser Executor] Too many errors, stopping');
          this.stop();
        }
        return;
      }

      // Reset error counter on success
      this.consecutiveErrors = 0;

      if (result && result.processed > 0) {
        console.log(`[Browser Executor] ✅ Processed ${result.processed} job(s)`);
      }

    } catch (err) {
      console.error('[Browser Executor] Exception:', err);
      this.consecutiveErrors++;

      if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
        console.error('[Browser Executor] Too many errors, stopping');
        this.stop();
      }
    }
  }

  /**
   * Check if executor is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      consecutiveErrors: this.consecutiveErrors,
      userId: this.userId
    };
  }
}

export const autoBacktestBrowserExecutor = new AutoBacktestBrowserExecutor();
