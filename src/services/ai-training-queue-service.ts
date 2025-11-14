import { supabase } from '@/lib/supabase';

interface BacktestJobPayload {
  symbol: string;
  timeframe: string;
  strategy: string;
  start_date: string;
  end_date: string;
  candle_count?: number;
}

interface QueuedJob {
  id: string;
  job_type: string;
  status: string;
  priority: number;
  payload: BacktestJobPayload;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  progress_percentage?: number;
  error_message?: string;
}

export interface TrainingProgress {
  totalJobs: number;
  completedJobs: number;
  runningJobs: number;
  pendingJobs: number;
  failedJobs: number;
  successRate: number;
  avgDurationMs: number;
  estimatedTimeRemaining: string;
}

class AITrainingQueueService {
  private progressListeners: Set<(progress: TrainingProgress) => void> = new Set();
  private subscription: any = null;
  private updateInterval: NodeJS.Timeout | null = null;

  /**
   * Queue a new backtest job for AI training
   */
  async queueBacktestJob(
    symbol: string,
    timeframe: string,
    strategy: string,
    startDate: Date,
    endDate: Date,
    priority: number = 50
  ): Promise<string | null> {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) {
        console.error('[AITrainingQueue] User not authenticated');
        return null;
      }

      const payload: BacktestJobPayload = {
        symbol,
        timeframe,
        strategy,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
      };

      const { data: jobId, error } = await supabase.rpc('queue_job', {
        p_job_type: 'backtest',
        p_payload: payload,
        p_user_id: user.user.id,
        p_priority: priority,
      });

      if (error) {
        console.error('[AITrainingQueue] Error queuing job:', error);
        return null;
      }

      console.log(`[AITrainingQueue] ✓ Queued backtest job: ${jobId}`);
      return jobId;

    } catch (error) {
      console.error('[AITrainingQueue] Error:', error);
      return null;
    }
  }

  /**
   * Queue multiple backtest jobs for comprehensive AI training
   */
  async queueTrainingSession(
    symbols: string[],
    timeframes: string[],
    strategy: string,
    monthsBack: number = 3
  ): Promise<{ queued: number; failed: number }> {
    const results = { queued: 0, failed: 0 };

    const endDate = new Date();
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsBack);

    console.log(`[AITrainingQueue] 🚀 Starting training session for ${symbols.length} symbols × ${timeframes.length} timeframes`);

    for (const symbol of symbols) {
      for (const timeframe of timeframes) {
        // Higher priority for shorter timeframes (more recent data)
        const priority = timeframe === 'M5' ? 70 : timeframe === 'M15' ? 60 : 50;

        const jobId = await this.queueBacktestJob(
          symbol,
          timeframe,
          strategy,
          startDate,
          endDate,
          priority
        );

        if (jobId) {
          results.queued++;
        } else {
          results.failed++;
        }

        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`[AITrainingQueue] ✅ Training session queued: ${results.queued} jobs (${results.failed} failed)`);

    return results;
  }

  /**
   * Get current training progress
   */
  async getTrainingProgress(): Promise<TrainingProgress> {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) {
        return this.getEmptyProgress();
      }

      // Get job statistics
      const { data: jobs, error } = await supabase
        .from('job_queue')
        .select('status, processing_duration_ms, created_at')
        .eq('user_id', user.user.id)
        .eq('job_type', 'backtest')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()); // Last 24 hours

      if (error || !jobs) {
        console.error('[AITrainingQueue] Error getting progress:', error);
        return this.getEmptyProgress();
      }

      const totalJobs = jobs.length;
      const completedJobs = jobs.filter(j => j.status === 'completed').length;
      const runningJobs = jobs.filter(j => j.status === 'running').length;
      const pendingJobs = jobs.filter(j => j.status === 'pending').length;
      const failedJobs = jobs.filter(j => j.status === 'failed').length;

      const successRate = totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 0;

      // Calculate average duration
      const completedJobsWithDuration = jobs.filter(
        j => j.status === 'completed' && j.processing_duration_ms
      );
      const avgDurationMs = completedJobsWithDuration.length > 0
        ? completedJobsWithDuration.reduce((sum, j) => sum + (j.processing_duration_ms || 0), 0) / completedJobsWithDuration.length
        : 0;

      // Estimate time remaining
      const estimatedTimeRemaining = pendingJobs > 0 && avgDurationMs > 0
        ? this.formatDuration(pendingJobs * avgDurationMs)
        : 'N/A';

      return {
        totalJobs,
        completedJobs,
        runningJobs,
        pendingJobs,
        failedJobs,
        successRate: Math.round(successRate * 10) / 10,
        avgDurationMs: Math.round(avgDurationMs),
        estimatedTimeRemaining,
      };

    } catch (error) {
      console.error('[AITrainingQueue] Error getting progress:', error);
      return this.getEmptyProgress();
    }
  }

  /**
   * Get recent job history
   */
  async getRecentJobs(limit: number = 20): Promise<QueuedJob[]> {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return [];

      const { data: jobs, error } = await supabase
        .from('job_queue')
        .select('*')
        .eq('user_id', user.user.id)
        .eq('job_type', 'backtest')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[AITrainingQueue] Error getting recent jobs:', error);
        return [];
      }

      return jobs as QueuedJob[];

    } catch (error) {
      console.error('[AITrainingQueue] Error:', error);
      return [];
    }
  }

  /**
   * Cancel a pending job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('job_queue')
        .update({ status: 'cancelled' })
        .eq('id', jobId)
        .eq('status', 'pending');

      if (error) {
        console.error('[AITrainingQueue] Error cancelling job:', error);
        return false;
      }

      console.log(`[AITrainingQueue] ✓ Cancelled job: ${jobId}`);
      return true;

    } catch (error) {
      console.error('[AITrainingQueue] Error:', error);
      return false;
    }
  }

  /**
   * Start listening for progress updates
   */
  startProgressMonitoring() {
    if (this.updateInterval) {
      return; // Already running
    }

    console.log('[AITrainingQueue] 📊 Starting progress monitoring');

    // Update progress every 10 seconds
    this.updateInterval = setInterval(async () => {
      const progress = await this.getTrainingProgress();
      this.notifyProgressListeners(progress);
    }, 10000);

    // Also subscribe to realtime updates
    this.subscription = supabase
      .channel('job_queue_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'job_queue',
          filter: 'job_type=eq.backtest',
        },
        async () => {
          const progress = await this.getTrainingProgress();
          this.notifyProgressListeners(progress);
        }
      )
      .subscribe();
  }

  /**
   * Stop progress monitoring
   */
  stopProgressMonitoring() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }

    console.log('[AITrainingQueue] ⏸️ Stopped progress monitoring');
  }

  /**
   * Listen for progress updates
   */
  onProgress(callback: (progress: TrainingProgress) => void) {
    this.progressListeners.add(callback);
  }

  /**
   * Stop listening for progress updates
   */
  offProgress(callback: (progress: TrainingProgress) => void) {
    this.progressListeners.delete(callback);
  }

  /**
   * Check if AI has reached target skill level
   */
  async hasReachedTargetSkillLevel(targetLevel: number = 80): Promise<boolean> {
    try {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return false;

      const { data: skills, error } = await supabase
        .from('ai_skill_tracking')
        .select('skill_level')
        .eq('user_id', user.user.id)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (error || !skills || skills.length === 0) {
        return false;
      }

      return skills[0].skill_level >= targetLevel;

    } catch (error) {
      console.error('[AITrainingQueue] Error checking skill level:', error);
      return false;
    }
  }

  // Private helper methods

  private getEmptyProgress(): TrainingProgress {
    return {
      totalJobs: 0,
      completedJobs: 0,
      runningJobs: 0,
      pendingJobs: 0,
      failedJobs: 0,
      successRate: 0,
      avgDurationMs: 0,
      estimatedTimeRemaining: 'N/A',
    };
  }

  private notifyProgressListeners(progress: TrainingProgress) {
    this.progressListeners.forEach(listener => {
      try {
        listener(progress);
      } catch (error) {
        console.error('[AITrainingQueue] Error in progress listener:', error);
      }
    });
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

// Export singleton instance
export const aiTrainingQueueService = new AITrainingQueueService();
