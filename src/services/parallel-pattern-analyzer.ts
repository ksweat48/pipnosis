import { supabase } from '../lib/supabase';

/**
 * Parallel Pattern Analyzer
 *
 * Offloads heavy pattern analysis to Supabase Edge Functions,
 * preventing UI blocking during intensive computation.
 *
 * Benefits:
 * - Non-blocking user experience
 * - Parallel processing of multiple trades
 * - Faster pattern detection (< 30s)
 * - Scalable background processing
 */

interface AnalysisJob {
  id: string;
  userId: string;
  symbol: string;
  tradeIds: string[];
  analysisType: 'batch' | 'single' | 'cluster';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  result?: any;
}

class ParallelPatternAnalyzer {
  private jobs: Map<string, AnalysisJob> = new Map();

  /**
   * Queue pattern analysis job (runs in background)
   */
  async analyzeTradesAsync(
    userId: string,
    symbol: string,
    tradeIds: string[],
    analysisType: 'batch' | 'single' | 'cluster' = 'batch'
  ): Promise<string> {
    const jobId = this.generateJobId();

    const job: AnalysisJob = {
      id: jobId,
      userId,
      symbol,
      tradeIds,
      analysisType,
      status: 'pending',
      startedAt: new Date()
    };

    this.jobs.set(jobId, job);

    console.log(`[Parallel Analyzer] 🚀 Queued job ${jobId} for ${tradeIds.length} trades`);

    // Execute in background (don't await)
    this.executeAnalysisJob(jobId).catch(error => {
      console.error(`[Parallel Analyzer] Job ${jobId} failed:`, error);
      const failedJob = this.jobs.get(jobId);
      if (failedJob) {
        failedJob.status = 'failed';
        failedJob.completedAt = new Date();
      }
    });

    return jobId;
  }

  /**
   * Execute analysis job via Edge Function
   */
  private async executeAnalysisJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error('Job not found');
    }

    job.status = 'processing';

    try {
      console.log(`[Parallel Analyzer] 📊 Processing job ${jobId}...`);

      // Call Edge Function
      const { data, error } = await supabase.functions.invoke('analyze-pattern-batch', {
        body: {
          userId: job.userId,
          symbol: job.symbol,
          tradeIds: job.tradeIds,
          analysisType: job.analysisType
        }
      });

      if (error) {
        throw error;
      }

      job.status = 'completed';
      job.completedAt = new Date();
      job.result = data;

      const processingTime = job.completedAt.getTime() - job.startedAt.getTime();
      console.log(`[Parallel Analyzer] ✅ Job ${jobId} completed in ${processingTime}ms`);
      console.log(`[Parallel Analyzer] Found ${data.patternsFound} patterns, generated ${data.insightsGenerated} insights`);

    } catch (error) {
      console.error(`[Parallel Analyzer] ❌ Job ${jobId} failed:`, error);
      job.status = 'failed';
      job.completedAt = new Date();
      throw error;
    }
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): AnalysisJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Wait for job completion (with timeout)
   */
  async waitForJob(jobId: string, timeoutMs: number = 30000): Promise<AnalysisJob> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const job = this.jobs.get(jobId);

        if (!job) {
          clearInterval(checkInterval);
          reject(new Error('Job not found'));
          return;
        }

        if (job.status === 'completed') {
          clearInterval(checkInterval);
          resolve(job);
          return;
        }

        if (job.status === 'failed') {
          clearInterval(checkInterval);
          reject(new Error('Job failed'));
          return;
        }

        // Check timeout
        if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          reject(new Error('Job timeout'));
        }
      }, 500); // Check every 500ms
    });
  }

  /**
   * Batch analyze recent trades
   */
  async analyzeBatchRecentTrades(
    userId: string,
    symbol: string,
    limit: number = 50
  ): Promise<string> {
    try {
      // Get recent trades
      const { data: trades, error } = await supabase
        .from('trade_history')
        .select('id')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .not('profit_loss', 'is', null)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error || !trades || trades.length === 0) {
        throw new Error('No trades found for analysis');
      }

      const tradeIds = trades.map(t => t.id);
      console.log(`[Parallel Analyzer] 📦 Batch analyzing ${tradeIds.length} recent trades`);

      return await this.analyzeTradesAsync(userId, symbol, tradeIds, 'batch');
    } catch (error) {
      console.error('[Parallel Analyzer] Error in analyzeBatchRecentTrades:', error);
      throw error;
    }
  }

  /**
   * Analyze trades across entire cluster
   */
  async analyzeClusterTrades(
    userId: string,
    symbols: string[],
    limit: number = 20
  ): Promise<Map<string, string>> {
    const jobIds = new Map<string, string>();

    for (const symbol of symbols) {
      try {
        const { data: trades } = await supabase
          .from('trade_history')
          .select('id')
          .eq('user_id', userId)
          .eq('symbol', symbol)
          .not('profit_loss', 'is', null)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (trades && trades.length > 0) {
          const tradeIds = trades.map(t => t.id);
          const jobId = await this.analyzeTradesAsync(userId, symbol, tradeIds, 'cluster');
          jobIds.set(symbol, jobId);
        }
      } catch (error) {
        console.error(`[Parallel Analyzer] Error analyzing ${symbol}:`, error);
      }
    }

    console.log(`[Parallel Analyzer] 🔄 Started ${jobIds.size} cluster analysis jobs`);
    return jobIds;
  }

  /**
   * Get all pending/processing jobs
   */
  getActiveJobs(): AnalysisJob[] {
    return Array.from(this.jobs.values()).filter(
      job => job.status === 'pending' || job.status === 'processing'
    );
  }

  /**
   * Clear completed jobs older than 1 hour
   */
  cleanupOldJobs(): number {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    let cleaned = 0;

    this.jobs.forEach((job, jobId) => {
      if (
        (job.status === 'completed' || job.status === 'failed') &&
        job.completedAt &&
        job.completedAt < oneHourAgo
      ) {
        this.jobs.delete(jobId);
        cleaned++;
      }
    });

    if (cleaned > 0) {
      console.log(`[Parallel Analyzer] 🧹 Cleaned up ${cleaned} old jobs`);
    }

    return cleaned;
  }

  /**
   * Generate unique job ID
   */
  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get statistics
   */
  getStatistics(): any {
    const jobs = Array.from(this.jobs.values());
    const completed = jobs.filter(j => j.status === 'completed');
    const failed = jobs.filter(j => j.status === 'failed');
    const active = jobs.filter(j => j.status === 'pending' || j.status === 'processing');

    const avgProcessingTime = completed.length > 0
      ? completed.reduce((sum, j) => {
          const time = j.completedAt && j.startedAt
            ? j.completedAt.getTime() - j.startedAt.getTime()
            : 0;
          return sum + time;
        }, 0) / completed.length
      : 0;

    return {
      totalJobs: jobs.length,
      completed: completed.length,
      failed: failed.length,
      active: active.length,
      avgProcessingTimeMs: Math.round(avgProcessingTime),
      successRate: jobs.length > 0
        ? ((completed.length / (completed.length + failed.length)) * 100).toFixed(1)
        : 0
    };
  }
}

export const parallelPatternAnalyzer = new ParallelPatternAnalyzer();
export type { AnalysisJob };
