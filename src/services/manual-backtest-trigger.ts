/**
 * Manual Auto-Backtest Trigger
 *
 * This service provides manual controls to trigger auto-backtest jobs
 * when the automated cron system isn't working properly.
 */

import { supabase } from '../lib/supabase';

class ManualBacktestTrigger {
  private readonly RUNNER_URL: string;
  private readonly EXECUTOR_URL: string;

  constructor() {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    this.RUNNER_URL = `${supabaseUrl}/functions/v1/auto-backtest-runner`;
    this.EXECUTOR_URL = `${supabaseUrl}/functions/v1/auto-backtest-executor`;
  }

  /**
   * Manually trigger the runner to create jobs
   */
  async triggerRunner(): Promise<{success: boolean; message: string; data?: any}> {
    try {
      console.log('[Manual Trigger] 🚀 Triggering runner to create jobs...');

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        return { success: false, message: 'No active session' };
      }

      const response = await fetch(this.RUNNER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Manual Trigger] Runner error:', errorText);
        return {
          success: false,
          message: `Runner failed: ${response.status} ${errorText}`
        };
      }

      const result = await response.json();
      console.log('[Manual Trigger] ✅ Runner result:', result);

      return {
        success: true,
        message: `Runner executed successfully. Processed: ${result.processed || 0} controller(s)`,
        data: result
      };
    } catch (error: any) {
      console.error('[Manual Trigger] Runner exception:', error);
      return {
        success: false,
        message: `Runner exception: ${error.message}`
      };
    }
  }

  /**
   * Manually trigger the executor to process pending jobs
   */
  async triggerExecutor(): Promise<{success: boolean; message: string; data?: any}> {
    try {
      console.log('[Manual Trigger] ⚡ Triggering executor to process jobs...');

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        return { success: false, message: 'No active session' };
      }

      const response = await fetch(this.EXECUTOR_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Manual Trigger] Executor error:', errorText);
        return {
          success: false,
          message: `Executor failed: ${response.status} ${errorText}`
        };
      }

      const result = await response.json();
      console.log('[Manual Trigger] ✅ Executor result:', result);

      return {
        success: true,
        message: `Executor completed. Processed: ${result.processed || 0} job(s)`,
        data: result
      };
    } catch (error: any) {
      console.error('[Manual Trigger] Executor exception:', error);
      return {
        success: false,
        message: `Executor exception: ${error.message}`
      };
    }
  }

  /**
   * Run complete cycle: Runner then Executor
   */
  async runCompleteCycle(): Promise<{success: boolean; message: string; runnerData?: any; executorData?: any}> {
    console.log('[Manual Trigger] 🔄 Running complete cycle (Runner → Executor)...');

    // Step 1: Run runner to create jobs
    const runnerResult = await this.triggerRunner();
    if (!runnerResult.success) {
      return {
        success: false,
        message: `Runner failed: ${runnerResult.message}`,
        runnerData: runnerResult.data
      };
    }

    // Wait a moment for jobs to be queued
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Run executor to process jobs
    const executorResult = await this.triggerExecutor();

    return {
      success: executorResult.success,
      message: executorResult.success
        ? `Complete cycle finished. ${runnerResult.message} | ${executorResult.message}`
        : `Executor failed: ${executorResult.message}`,
      runnerData: runnerResult.data,
      executorData: executorResult.data
    };
  }

  /**
   * Check queue status
   */
  async checkQueueStatus(userId: string): Promise<any> {
    const { data, error } = await supabase
      .from('auto_backtest_queue')
      .select('status')
      .eq('user_id', userId);

    if (error) {
      console.error('[Manual Trigger] Error checking queue:', error);
      return null;
    }

    return {
      pending: data?.filter(j => j.status === 'pending').length || 0,
      processing: data?.filter(j => j.status === 'processing').length || 0,
      completed: data?.filter(j => j.status === 'completed').length || 0,
      failed: data?.filter(j => j.status === 'failed').length || 0
    };
  }
}

export const manualBacktestTrigger = new ManualBacktestTrigger();
