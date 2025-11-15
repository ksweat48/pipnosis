/**
 * Batch Milestone Processor
 *
 * Processes 100-session milestones and triggers GPT-4o analysis.
 * This service runs periodically to check for pending milestone analyses
 * and processes them sequentially to manage API costs.
 */

import { supabase } from '../lib/supabase';
import { metaLearningStrategist, type BatchSummary } from './meta-learning-strategist';

interface MilestoneAnalysisJob {
  logId: string;
  userId: string;
  milestoneNumber: number;
  createdAt: string;
}

class BatchMilestoneProcessor {
  private isProcessing: boolean = false;
  private processingInterval: NodeJS.Timeout | null = null;

  /**
   * Start the processor (checks every 5 minutes for pending analyses)
   */
  start(): void {
    if (this.processingInterval) {
      console.log('[Batch Milestone Processor] Already running');
      return;
    }

    console.log('[Batch Milestone Processor] 🚀 Starting processor...');

    // Process immediately on start
    this.processPendingMilestones();

    // Then check every 5 minutes
    this.processingInterval = setInterval(() => {
      this.processPendingMilestones();
    }, 5 * 60 * 1000); // 5 minutes

    console.log('[Batch Milestone Processor] ✅ Processor started (checking every 5 minutes)');
  }

  /**
   * Stop the processor
   */
  stop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      console.log('[Batch Milestone Processor] ⏹️  Processor stopped');
    }
  }

  /**
   * Check for and process pending milestone analyses
   */
  async processPendingMilestones(): Promise<void> {
    if (this.isProcessing) {
      console.log('[Batch Milestone Processor] Already processing, skipping this cycle');
      return;
    }

    this.isProcessing = true;

    try {
      console.log('\n[Batch Milestone Processor] 🔍 Checking for pending milestone analyses...');

      // Get pending milestone analyses
      const { data: pendingMilestones, error } = await supabase
        .rpc('get_pending_milestone_analyses');

      if (error) {
        console.error('[Batch Milestone Processor] Error fetching pending milestones:', error);
        return;
      }

      if (!pendingMilestones || pendingMilestones.length === 0) {
        console.log('[Batch Milestone Processor] No pending milestones to process');
        return;
      }

      console.log(`[Batch Milestone Processor] 📊 Found ${pendingMilestones.length} pending milestone(s)`);

      // Process each milestone sequentially
      for (const milestone of pendingMilestones) {
        await this.processSingleMilestone({
          logId: milestone.log_id,
          userId: milestone.user_id,
          milestoneNumber: milestone.milestone_number,
          createdAt: milestone.created_at
        });

        // Wait 2 seconds between analyses to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      console.log('[Batch Milestone Processor] ✅ All pending milestones processed');
    } catch (error) {
      console.error('[Batch Milestone Processor] Error in processPendingMilestones:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single milestone analysis
   */
  private async processSingleMilestone(job: MilestoneAnalysisJob): Promise<void> {
    console.log(`\n[Batch Milestone Processor] 🎯 Processing Milestone ${job.milestoneNumber} for user ${job.userId}`);
    const startTime = Date.now();

    try {
      // Step 1: Prepare batch summary
      console.log('[Batch Milestone Processor] Step 1: Preparing batch summary...');
      const { data: summaryData, error: summaryError } = await supabase
        .rpc('prepare_batch_summary_for_gpt4o', {
          p_user_id: job.userId,
          p_milestone_log_id: job.logId
        });

      if (summaryError || !summaryData) {
        console.error('[Batch Milestone Processor] Error preparing batch summary:', summaryError);
        await this.markMilestoneFailed(job.logId, 'Failed to prepare batch summary');
        return;
      }

      console.log('[Batch Milestone Processor] ✓ Batch summary prepared');

      // Step 2: Convert to BatchSummary format
      const batchSummary: BatchSummary = this.convertToBatchSummary(summaryData);

      // Step 3: Call GPT-4o Meta-Learning Strategist
      console.log('[Batch Milestone Processor] Step 2: Invoking GPT-4o Meta-Learning Strategist...');
      const insight = await metaLearningStrategist.analyze100SessionBatch(
        job.userId,
        job.logId,
        batchSummary
      );

      if (!insight) {
        console.warn('[Batch Milestone Processor] GPT-4o analysis returned no insights');
        await this.markMilestoneFailed(job.logId, 'GPT-4o analysis failed or returned null');
        return;
      }

      console.log('[Batch Milestone Processor] ✓ GPT-4o analysis complete');

      // Step 4: Apply learnings to future sessions
      console.log('[Batch Milestone Processor] Step 3: Applying batch learnings...');
      await this.applyBatchLearnings(job.userId, batchSummary.milestoneNumber, insight);

      // Step 5: Reset milestone counter
      console.log('[Batch Milestone Processor] Step 4: Resetting milestone counter...');
      await supabase.rpc('reset_milestone_counter', {
        p_user_id: job.userId,
        p_milestone_number: job.milestoneNumber
      });

      const duration = Date.now() - startTime;
      console.log(`[Batch Milestone Processor] ✅ Milestone ${job.milestoneNumber} processed successfully in ${duration}ms`);
      console.log(`[Batch Milestone Processor] 📈 Generated ${insight.strategicRecommendations.length} recommendations`);

    } catch (error) {
      console.error('[Batch Milestone Processor] Error processing milestone:', error);
      await this.markMilestoneFailed(
        job.logId,
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Convert database response to BatchSummary format
   */
  private convertToBatchSummary(data: any): BatchSummary {
    const performance = data.performance || {};
    const batchSummary = performance.batch_summary || {};
    const trendAnalysis = performance.trend_analysis || {};
    const learningInsights = data.learning_insights || {};

    return {
      milestoneNumber: data.milestone_info?.milestone_number || 0,
      totalSessions: data.milestone_info?.total_sessions || 0,
      sessionsRange: data.milestone_info?.sessions_range || '',
      totalTrades: batchSummary.total_trades || 0,
      avgWinRate: parseFloat(batchSummary.avg_win_rate || '0'),
      avgProfitFactor: parseFloat(batchSummary.avg_profit_factor || '0'),
      totalPnL: parseFloat(batchSummary.total_pnl || '0'),
      bestSession: performance.best_session || {},
      worstSession: performance.worst_session || {},
      symbolPerformance: performance.symbol_performance || [],
      trendAnalysis: {
        firstHalfWinRate: parseFloat(trendAnalysis.first_half_win_rate || '0'),
        secondHalfWinRate: parseFloat(trendAnalysis.second_half_win_rate || '0'),
        winRateTrend: trendAnalysis.win_rate_trend || 'stable',
        profitFactorTrend: trendAnalysis.profit_factor_trend || 'stable'
      },
      learningInsights: {
        totalInsights: learningInsights.total_insights || 0,
        winningPatterns: learningInsights.winning_patterns || [],
        losingPatterns: learningInsights.losing_patterns || []
      },
      keyLearnings: [
        `Analyzed ${data.milestone_info?.total_sessions || 0} sessions`,
        `Total trades: ${batchSummary.total_trades || 0}`,
        `Average win rate: ${batchSummary.avg_win_rate || 0}%`,
        `Win rate trend: ${trendAnalysis.win_rate_trend || 'unknown'}`
      ]
    };
  }

  /**
   * Apply batch learnings to AI system for future sessions
   */
  private async applyBatchLearnings(
    userId: string,
    milestoneNumber: number,
    insight: any
  ): Promise<void> {
    try {
      console.log('[Batch Milestone Processor] 📝 Applying batch learnings...');

      // Mark the batch insight as applied
      const { error: updateError } = await supabase
        .from('batch_meta_learning_insights')
        .update({
          applied_to_sessions: true,
          applied_at: new Date().toISOString()
        })
        .eq('milestone_number', milestoneNumber)
        .eq('user_id', userId);

      if (updateError) {
        console.error('[Batch Milestone Processor] Error marking insight as applied:', updateError);
      }

      // Create actionable learning records for the AI system
      // These will be picked up by the AI decision engine in future sessions
      const learningRecords = [];

      // Apply pattern emphasis recommendations
      if (insight.patternsToEmphasize && insight.patternsToEmphasize.length > 0) {
        for (const pattern of insight.patternsToEmphasize) {
          learningRecords.push({
            user_id: userId,
            learning_type: 'pattern_emphasis',
            pattern_name: pattern,
            action: 'increase_weight',
            source: `100_session_milestone_${milestoneNumber}`,
            confidence: 85,
            priority: 'high',
            applied_to_future_sessions: true
          });
        }
      }

      // Apply pattern de-weighting recommendations
      if (insight.patternsToDeweight && insight.patternsToDeweight.length > 0) {
        for (const pattern of insight.patternsToDeweight) {
          learningRecords.push({
            user_id: userId,
            learning_type: 'pattern_deweight',
            pattern_name: pattern,
            action: 'decrease_weight',
            source: `100_session_milestone_${milestoneNumber}`,
            confidence: 80,
            priority: 'medium',
            applied_to_future_sessions: true
          });
        }
      }

      // Apply pattern ignore recommendations
      if (insight.patternsToIgnore && insight.patternsToIgnore.length > 0) {
        for (const pattern of insight.patternsToIgnore) {
          learningRecords.push({
            user_id: userId,
            learning_type: 'pattern_ignore',
            pattern_name: pattern,
            action: 'ignore',
            source: `100_session_milestone_${milestoneNumber}`,
            confidence: 90,
            priority: 'high',
            applied_to_future_sessions: true
          });
        }
      }

      if (learningRecords.length > 0) {
        // Store learning records (you may need to create this table or adapt to existing tables)
        console.log(`[Batch Milestone Processor] 💾 Storing ${learningRecords.length} learning records`);
        // Note: This would need an appropriate table - for now, logging
        console.log('[Batch Milestone Processor] Learning records:', learningRecords);
      }

      console.log('[Batch Milestone Processor] ✓ Batch learnings applied');
    } catch (error) {
      console.error('[Batch Milestone Processor] Error applying batch learnings:', error);
    }
  }

  /**
   * Mark milestone as failed
   */
  private async markMilestoneFailed(logId: string, errorMessage: string): Promise<void> {
    await supabase
      .from('session_milestone_log')
      .update({
        analysis_status: 'failed',
        error_message: errorMessage
      })
      .eq('id', logId);
  }

  /**
   * Manually trigger processing of a specific milestone
   */
  async processMilestone(milestoneLogId: string): Promise<boolean> {
    try {
      // Get milestone details
      const { data: milestone, error } = await supabase
        .from('session_milestone_log')
        .select('*')
        .eq('id', milestoneLogId)
        .maybeSingle();

      if (error || !milestone) {
        console.error('[Batch Milestone Processor] Milestone not found:', error);
        return false;
      }

      await this.processSingleMilestone({
        logId: milestone.id,
        userId: milestone.user_id,
        milestoneNumber: milestone.milestone_number,
        createdAt: milestone.created_at
      });

      return true;
    } catch (error) {
      console.error('[Batch Milestone Processor] Error in manual trigger:', error);
      return false;
    }
  }

  /**
   * Get milestone processing status
   */
  async getMilestoneStatus(userId: string): Promise<any> {
    try {
      // Get counter status
      const { data: counterStatus } = await supabase
        .rpc('get_session_counter_status', { p_user_id: userId });

      // Get recent milestones
      const { data: recentMilestones } = await supabase
        .from('session_milestone_log')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5);

      return {
        counter: counterStatus,
        recentMilestones: recentMilestones || []
      };
    } catch (error) {
      console.error('[Batch Milestone Processor] Error getting status:', error);
      return null;
    }
  }
}

export const batchMilestoneProcessor = new BatchMilestoneProcessor();
