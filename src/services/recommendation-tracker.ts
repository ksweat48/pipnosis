import { supabase } from '../lib/supabase';

interface Recommendation {
  id?: string;
  userId: string;
  metaLearningInsightId?: string;
  text: string;
  category: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  expectedImpact?: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'manual_required';
}

interface RecommendationStatus {
  id: string;
  recommendation_text: string;
  status: string;
  priority: string;
  category: string;
  recommended_at: string;
  implementation_started_at?: string;
  implementation_completed_at?: string;
  time_to_implement_seconds?: number;
  implementation_details?: any;
  implementation_history?: Array<{
    action_type: string;
    target_name: string;
    status: string;
    attempted_at: string;
  }>;
}

interface ImplementationLog {
  recommendationId: string;
  userId: string;
  actionType: string;
  targetName: string;
  oldValue?: string;
  newValue?: string;
  status: 'queued' | 'applying' | 'applied' | 'failed' | 'rolled_back';
  errorMessage?: string;
  adjustmentQueueId?: string;
}

class RecommendationTracker {
  /**
   * Track new recommendations from GPT-4o insights
   */
  async trackRecommendationsFromInsight(
    userId: string,
    insightId: string,
    recommendations: Array<{
      category: string;
      recommendation: string;
      priority: 'critical' | 'high' | 'medium' | 'low';
      expectedImpact: string;
    }>
  ): Promise<void> {
    console.log(`[Recommendation Tracker] 📝 Tracking ${recommendations.length} recommendations`);

    try {
      const records = recommendations.map(rec => ({
        user_id: userId,
        meta_learning_insight_id: insightId,
        recommendation_text: rec.recommendation,
        recommendation_category: rec.category,
        priority: rec.priority,
        expected_impact: rec.expectedImpact,
        status: 'pending',
        recommended_at: new Date().toISOString()
      }));

      const { error } = await supabase
        .from('ai_recommendation_tracker')
        .insert(records);

      if (error) {
        console.error('[Recommendation Tracker] Error inserting recommendations:', error);
      } else {
        console.log('[Recommendation Tracker] ✅ Recommendations tracked successfully');

        // Start monitoring for implementation
        this.startImplementationMonitoring(userId, records.map((_, idx) => recommendations[idx]));
      }
    } catch (error) {
      console.error('[Recommendation Tracker] Exception tracking recommendations:', error);
    }
  }

  /**
   * Monitor for automatic implementations
   */
  private async startImplementationMonitoring(
    userId: string,
    recommendations: Array<{ recommendation: string; category: string }>
  ): Promise<void> {
    // Check for matching automatic adjustments
    for (const rec of recommendations) {
      const keywords = this.extractActionKeywords(rec.recommendation);

      // Check if any adjustments match this recommendation
      setTimeout(async () => {
        await this.detectMatchingAdjustments(userId, rec.recommendation, keywords);
      }, 2000); // Give time for adjustments to be queued
    }
  }

  /**
   * Extract action keywords from recommendation text
   */
  private extractActionKeywords(recommendation: string): string[] {
    const keywords: string[] = [];
    const lowerRec = recommendation.toLowerCase();

    // Pattern matching
    if (lowerRec.includes('confidence') || lowerRec.includes('threshold')) {
      keywords.push('confidence_adjustment');
    }
    if (lowerRec.includes('stop') || lowerRec.includes('stop-loss')) {
      keywords.push('risk_parameter');
    }
    if (lowerRec.includes('indicator') || lowerRec.includes('additional')) {
      keywords.push('indicator_addition');
    }
    if (lowerRec.includes('pattern') && lowerRec.includes('avoid')) {
      keywords.push('pattern_rejection');
    }
    if (lowerRec.includes('pattern') && (lowerRec.includes('focus') || lowerRec.includes('emphasize'))) {
      keywords.push('pattern_adoption');
    }
    if (lowerRec.includes('profit factor') || lowerRec.includes('risk') || lowerRec.includes('reward')) {
      keywords.push('risk_parameter');
    }

    return keywords;
  }

  /**
   * Detect matching adjustments in the queue
   */
  private async detectMatchingAdjustments(
    userId: string,
    recommendationText: string,
    keywords: string[]
  ): Promise<void> {
    try {
      // Get pending recommendations
      const { data: pendingRecs, error: recError } = await supabase
        .from('ai_recommendation_tracker')
        .select('id')
        .eq('user_id', userId)
        .eq('recommendation_text', recommendationText)
        .eq('status', 'pending')
        .maybeSingle();

      if (recError || !pendingRecs) return;

      // Check for matching adjustments in the automatic adjustments queue
      const { data: adjustments, error: adjError } = await supabase
        .from('ai_automatic_adjustments_queue')
        .select('*')
        .eq('user_id', userId)
        .in('adjustment_type', keywords)
        .gte('created_at', new Date(Date.now() - 60000).toISOString()) // Last minute
        .order('created_at', { ascending: false });

      if (adjError || !adjustments || adjustments.length === 0) return;

      // Mark recommendation as in progress
      await this.updateRecommendationStatus(
        pendingRecs.id,
        'in_progress',
        {
          adjustment_queue_ids: adjustments.map(a => a.id),
          implementation_type: 'automatic'
        }
      );

      // Log the implementation attempts
      for (const adj of adjustments) {
        await this.logImplementationAttempt({
          recommendationId: pendingRecs.id,
          userId,
          actionType: adj.adjustment_type,
          targetName: adj.target_name,
          oldValue: String(adj.current_value),
          newValue: String(adj.proposed_value),
          status: 'queued',
          adjustmentQueueId: adj.id
        });
      }

      console.log(`[Recommendation Tracker] ✅ Found ${adjustments.length} matching adjustments for recommendation`);
    } catch (error) {
      console.error('[Recommendation Tracker] Error detecting adjustments:', error);
    }
  }

  /**
   * Update recommendation status
   */
  async updateRecommendationStatus(
    recommendationId: string,
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'manual_required',
    details?: {
      adjustment_queue_ids?: string[];
      implementation_type?: string;
      implementation_details?: any;
      success_metrics?: any;
      failure_reason?: string;
    }
  ): Promise<void> {
    try {
      const updates: any = { status };

      if (status === 'in_progress' && !details?.implementation_started_at) {
        updates.implementation_started_at = new Date().toISOString();
      }

      if (status === 'completed') {
        updates.implementation_completed_at = new Date().toISOString();
      }

      if (details) {
        if (details.adjustment_queue_ids) updates.adjustment_queue_ids = details.adjustment_queue_ids;
        if (details.implementation_type) updates.implementation_type = details.implementation_type;
        if (details.implementation_details) updates.implementation_details = details.implementation_details;
        if (details.success_metrics) updates.success_metrics = details.success_metrics;
        if (details.failure_reason) updates.failure_reason = details.failure_reason;
      }

      const { error } = await supabase
        .from('ai_recommendation_tracker')
        .update(updates)
        .eq('id', recommendationId);

      if (error) {
        console.error('[Recommendation Tracker] Error updating status:', error);
      }
    } catch (error) {
      console.error('[Recommendation Tracker] Exception updating status:', error);
    }
  }

  /**
   * Log implementation attempt
   */
  async logImplementationAttempt(log: ImplementationLog): Promise<void> {
    try {
      const { error } = await supabase
        .from('recommendation_implementation_log')
        .insert({
          recommendation_id: log.recommendationId,
          user_id: log.userId,
          action_type: log.actionType,
          target_name: log.targetName,
          old_value: log.oldValue,
          new_value: log.newValue,
          status: log.status,
          error_message: log.errorMessage,
          adjustment_queue_id: log.adjustmentQueueId,
          attempted_at: new Date().toISOString()
        });

      if (error) {
        console.error('[Recommendation Tracker] Error logging attempt:', error);
      }
    } catch (error) {
      console.error('[Recommendation Tracker] Exception logging attempt:', error);
    }
  }

  /**
   * Mark implementation as completed
   */
  async markImplementationComplete(
    recommendationId: string,
    successMetrics?: any
  ): Promise<void> {
    await this.updateRecommendationStatus(recommendationId, 'completed', {
      success_metrics: successMetrics,
      implementation_details: {
        completed_at: new Date().toISOString()
      }
    });

    // Update implementation log
    const { data: logs } = await supabase
      .from('recommendation_implementation_log')
      .select('id')
      .eq('recommendation_id', recommendationId)
      .eq('status', 'queued');

    if (logs && logs.length > 0) {
      await supabase
        .from('recommendation_implementation_log')
        .update({
          status: 'applied',
          completed_at: new Date().toISOString()
        })
        .in('id', logs.map(l => l.id));
    }
  }

  /**
   * Get recommendations with status for dashboard
   */
  async getRecommendationsWithStatus(
    userId: string,
    limit: number = 20
  ): Promise<RecommendationStatus[]> {
    try {
      const { data, error } = await supabase
        .from('ai_recommendations_with_status')
        .select('*')
        .eq('user_id', userId)
        .order('recommended_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[Recommendation Tracker] Error fetching status:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[Recommendation Tracker] Exception fetching status:', error);
      return [];
    }
  }

  /**
   * Get recommendations grouped by status
   */
  async getRecommendationsByStatus(
    userId: string
  ): Promise<{
    completed: RecommendationStatus[];
    inProgress: RecommendationStatus[];
    pending: RecommendationStatus[];
    failed: RecommendationStatus[];
  }> {
    const allRecs = await this.getRecommendationsWithStatus(userId, 50);

    return {
      completed: allRecs.filter(r => r.status === 'completed'),
      inProgress: allRecs.filter(r => r.status === 'in_progress'),
      pending: allRecs.filter(r => r.status === 'pending'),
      failed: allRecs.filter(r => r.status === 'failed')
    };
  }

  /**
   * Get implementation summary statistics
   */
  async getImplementationSummary(
    userId: string,
    days: number = 7
  ): Promise<{
    totalRecommendations: number;
    completedRecommendations: number;
    inProgressRecommendations: number;
    pendingRecommendations: number;
    failedRecommendations: number;
    avgTimeToImplementSeconds: number;
    successRate: number;
  } | null> {
    try {
      const { data, error } = await supabase
        .rpc('get_recommendation_summary', {
          p_user_id: userId,
          p_days: days
        });

      if (error) {
        console.error('[Recommendation Tracker] Error fetching summary:', error);
        return null;
      }

      return data && data.length > 0 ? {
        totalRecommendations: Number(data[0].total_recommendations),
        completedRecommendations: Number(data[0].completed_recommendations),
        inProgressRecommendations: Number(data[0].in_progress_recommendations),
        pendingRecommendations: Number(data[0].pending_recommendations),
        failedRecommendations: Number(data[0].failed_recommendations),
        avgTimeToImplementSeconds: Number(data[0].avg_time_to_implement_seconds) || 0,
        successRate: Number(data[0].success_rate) || 0
      } : null;
    } catch (error) {
      console.error('[Recommendation Tracker] Exception fetching summary:', error);
      return null;
    }
  }

  /**
   * Monitor adjustment queue for completion
   */
  async monitorAdjustmentCompletion(userId: string): Promise<void> {
    try {
      // Get in-progress recommendations with adjustment queue IDs
      const { data: inProgressRecs, error } = await supabase
        .from('ai_recommendation_tracker')
        .select('id, adjustment_queue_ids')
        .eq('user_id', userId)
        .eq('status', 'in_progress')
        .not('adjustment_queue_ids', 'is', null);

      if (error || !inProgressRecs || inProgressRecs.length === 0) return;

      for (const rec of inProgressRecs) {
        if (!rec.adjustment_queue_ids || rec.adjustment_queue_ids.length === 0) continue;

        // Check if all adjustments are applied
        const { data: adjustments, error: adjError } = await supabase
          .from('ai_automatic_adjustments_queue')
          .select('status')
          .in('id', rec.adjustment_queue_ids);

        if (adjError || !adjustments) continue;

        const allApplied = adjustments.every(adj => adj.status === 'applied');
        const anyFailed = adjustments.some(adj => adj.status === 'failed');

        if (allApplied) {
          await this.markImplementationComplete(rec.id, {
            adjustments_applied: adjustments.length,
            completion_time: new Date().toISOString()
          });
          console.log(`[Recommendation Tracker] ✅ Recommendation ${rec.id} completed`);
        } else if (anyFailed) {
          await this.updateRecommendationStatus(rec.id, 'failed', {
            failure_reason: 'One or more automatic adjustments failed'
          });
          console.log(`[Recommendation Tracker] ❌ Recommendation ${rec.id} failed`);
        }
      }
    } catch (error) {
      console.error('[Recommendation Tracker] Error monitoring completion:', error);
    }
  }
}

export const recommendationTracker = new RecommendationTracker();
export type { Recommendation, RecommendationStatus, ImplementationLog };
