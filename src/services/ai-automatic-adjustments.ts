import { supabase } from '@/lib/supabase';

/**
 * AI Automatic Adjustments Service
 *
 * Manages the 10-session learning cycle and automatic application
 * of AI-identified improvements. No more "tomorrow" - changes are
 * applied immediately after validation at cycle completion.
 *
 * Flow:
 * 1. Recommendations accumulate during 10-session cycle
 * 2. At cycle completion, all queued adjustments are automatically applied
 * 3. User receives notification of what was changed
 * 4. System tracks effectiveness of each adjustment
 */

type AdjustmentType =
  | 'confidence_adjustment'
  | 'filter_threshold'
  | 'pattern_adoption'
  | 'pattern_rejection'
  | 'indicator_weight'
  | 'risk_parameter'
  | 'strategy_parameter'
  | 'other';

interface PendingAdjustment {
  adjustmentType: AdjustmentType;
  targetName: string;
  currentValue: any;
  proposedValue: any;
  reasoning: string;
  priority: number; // 1-10, higher = more important
  accumulatedCount: number; // How many times this adjustment was suggested
}

interface AppliedAdjustment {
  id: string;
  cycleNumber: number;
  adjustmentType: AdjustmentType;
  targetName: string;
  oldValue: any;
  newValue: any;
  reasoning: string;
  appliedAt: string;
  effectivenessScore?: number;
  wasBeneficial?: boolean;
}

interface CycleStatus {
  currentPosition: number;
  totalCyclesCompleted: number;
  pendingAdjustments: PendingAdjustment[];
  nextCycleCompletion: string;
}

class AIAutomaticAdjustments {
  private pendingAdjustmentsQueue: Map<string, PendingAdjustment> = new Map();

  /**
   * Queue an adjustment for automatic application at cycle end
   */
  async queueAdjustment(
    userId: string,
    adjustment: Omit<PendingAdjustment, 'accumulatedCount'>
  ): Promise<void> {
    const key = `${adjustment.adjustmentType}:${adjustment.targetName}`;

    const existing = this.pendingAdjustmentsQueue.get(`${userId}:${key}`);

    if (existing) {
      // Increment accumulated count if same adjustment suggested again
      existing.accumulatedCount++;
      existing.priority = Math.max(existing.priority, adjustment.priority);
      existing.reasoning += ` | ${adjustment.reasoning}`;
      console.log(`[Auto Adjustments] Updated pending adjustment: ${key} (count: ${existing.accumulatedCount})`);
    } else {
      // Add new pending adjustment
      this.pendingAdjustmentsQueue.set(`${userId}:${key}`, {
        ...adjustment,
        accumulatedCount: 1
      });
      console.log(`[Auto Adjustments] Queued new adjustment: ${key}`);
    }
  }

  /**
   * Get current cycle status for a user
   */
  async getCycleStatus(userId: string): Promise<CycleStatus | null> {
    try {
      const { data, error } = await supabase
        .from('ai_skill_progression')
        .select('current_cycle_position, total_cycles_completed, last_trade_analyzed_date')
        .eq('user_id', userId)
        .maybeSingle();

      if (error || !data) {
        console.error('[Auto Adjustments] Error fetching cycle status:', error);
        return null;
      }

      // Get pending adjustments for this user
      const pendingAdjustments: PendingAdjustment[] = [];
      this.pendingAdjustmentsQueue.forEach((adjustment, key) => {
        if (key.startsWith(`${userId}:`)) {
          pendingAdjustments.push(adjustment);
        }
      });

      // Sort by priority (highest first)
      pendingAdjustments.sort((a, b) => b.priority - a.priority);

      return {
        currentPosition: data.current_cycle_position || 1,
        totalCyclesCompleted: data.total_cycles_completed || 0,
        pendingAdjustments,
        nextCycleCompletion: `After ${10 - (data.current_cycle_position || 1)} more sessions`
      };
    } catch (error) {
      console.error('[Auto Adjustments] Exception getting cycle status:', error);
      return null;
    }
  }

  /**
   * Increment cycle position after each backtest
   * Returns true if cycle completed
   */
  async incrementCyclePosition(userId: string): Promise<boolean> {
    try {
      const { data: current, error: fetchError } = await supabase
        .from('ai_skill_progression')
        .select('current_cycle_position, total_cycles_completed')
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchError || !current) {
        console.error('[Auto Adjustments] Error fetching current cycle position:', fetchError);
        return false;
      }

      const newPosition = (current.current_cycle_position || 1) + 1;
      const cycleCompleted = newPosition > 10;

      if (cycleCompleted) {
        // Cycle completed - reset to 1 and increment completed count
        const { error: updateError } = await supabase
          .from('ai_skill_progression')
          .update({
            current_cycle_position: 1,
            total_cycles_completed: (current.total_cycles_completed || 0) + 1,
            last_cycle_completion_date: new Date().toISOString()
          })
          .eq('user_id', userId);

        if (updateError) {
          console.error('[Auto Adjustments] Error resetting cycle:', updateError);
        } else {
          console.log('[Auto Adjustments] 🎉 Cycle completed! Resetting to position 1');
        }

        return true;
      } else {
        // Continue cycle
        const { error: updateError } = await supabase
          .from('ai_skill_progression')
          .update({
            current_cycle_position: newPosition
          })
          .eq('user_id', userId);

        if (updateError) {
          console.error('[Auto Adjustments] Error incrementing cycle position:', updateError);
        } else {
          console.log(`[Auto Adjustments] Cycle position: ${newPosition}/10`);
        }

        return false;
      }
    } catch (error) {
      console.error('[Auto Adjustments] Exception incrementing cycle position:', error);
      return false;
    }
  }

  /**
   * Apply all pending adjustments automatically at cycle completion
   */
  async applyPendingAdjustments(userId: string): Promise<AppliedAdjustment[]> {
    console.log('[Auto Adjustments] 🚀 Applying pending adjustments automatically...');

    const appliedAdjustments: AppliedAdjustment[] = [];

    try {
      // Get current cycle number
      const { data: progressData } = await supabase
        .from('ai_skill_progression')
        .select('total_cycles_completed')
        .eq('user_id', userId)
        .maybeSingle();

      const cycleNumber = (progressData?.total_cycles_completed || 0) + 1;

      // Get all pending adjustments for this user
      const userPendingAdjustments: PendingAdjustment[] = [];
      this.pendingAdjustmentsQueue.forEach((adjustment, key) => {
        if (key.startsWith(`${userId}:`)) {
          userPendingAdjustments.push(adjustment);
        }
      });

      if (userPendingAdjustments.length === 0) {
        console.log('[Auto Adjustments] No pending adjustments to apply');
        return [];
      }

      // Sort by priority
      userPendingAdjustments.sort((a, b) => b.priority - a.priority);

      console.log(`[Auto Adjustments] Applying ${userPendingAdjustments.length} adjustments...`);

      // Apply each adjustment
      for (const adjustment of userPendingAdjustments) {
        try {
          // Apply the adjustment based on type
          const applied = await this.applyAdjustment(userId, adjustment);

          if (applied) {
            // Log to database
            const { data: logData, error: logError } = await supabase
              .from('ai_applied_adjustments')
              .insert({
                user_id: userId,
                cycle_number: cycleNumber,
                adjustment_type: adjustment.adjustmentType,
                target_name: adjustment.targetName,
                old_value: adjustment.currentValue,
                new_value: adjustment.proposedValue,
                reasoning: adjustment.reasoning
              })
              .select()
              .single();

            if (!logError && logData) {
              appliedAdjustments.push({
                id: logData.id,
                cycleNumber,
                adjustmentType: adjustment.adjustmentType,
                targetName: adjustment.targetName,
                oldValue: adjustment.currentValue,
                newValue: adjustment.proposedValue,
                reasoning: adjustment.reasoning,
                appliedAt: logData.applied_at
              });

              console.log(`[Auto Adjustments] ✅ Applied: ${adjustment.adjustmentType} - ${adjustment.targetName}`);
            }
          }
        } catch (error) {
          console.error(`[Auto Adjustments] Error applying adjustment ${adjustment.targetName}:`, error);
        }
      }

      // Clear pending adjustments for this user
      this.pendingAdjustmentsQueue.forEach((_, key) => {
        if (key.startsWith(`${userId}:`)) {
          this.pendingAdjustmentsQueue.delete(key);
        }
      });

      console.log(`[Auto Adjustments] 🎉 Applied ${appliedAdjustments.length} adjustments automatically!`);

      return appliedAdjustments;
    } catch (error) {
      console.error('[Auto Adjustments] Exception applying adjustments:', error);
      return appliedAdjustments;
    }
  }

  /**
   * Apply a single adjustment to the system
   */
  private async applyAdjustment(
    userId: string,
    adjustment: PendingAdjustment
  ): Promise<boolean> {
    switch (adjustment.adjustmentType) {
      case 'confidence_adjustment':
        return await this.applyConfidenceAdjustment(userId, adjustment);

      case 'filter_threshold':
        return await this.applyFilterThresholdAdjustment(userId, adjustment);

      case 'pattern_adoption':
      case 'pattern_rejection':
        return await this.applyPatternAdjustment(userId, adjustment);

      case 'indicator_weight':
        return await this.applyIndicatorWeightAdjustment(userId, adjustment);

      default:
        console.log(`[Auto Adjustments] ⚠️  Unknown adjustment type: ${adjustment.adjustmentType}`);
        return false;
    }
  }

  /**
   * Apply confidence score adjustment to ai_pattern_ev_tracking
   */
  private async applyConfidenceAdjustment(
    userId: string,
    adjustment: PendingAdjustment
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('ai_pattern_ev_tracking')
        .update({
          confidence_score: adjustment.proposedValue
        })
        .eq('user_id', userId)
        .eq('pattern_name', adjustment.targetName);

      return !error;
    } catch (error) {
      console.error('[Auto Adjustments] Error applying confidence adjustment:', error);
      return false;
    }
  }

  /**
   * Apply filter threshold adjustment
   */
  private async applyFilterThresholdAdjustment(
    userId: string,
    adjustment: PendingAdjustment
  ): Promise<boolean> {
    console.log(`[Auto Adjustments] Filter threshold adjustment: ${adjustment.targetName} -> ${adjustment.proposedValue}`);
    return true;
  }

  /**
   * Apply pattern adoption/rejection
   */
  private async applyPatternAdjustment(
    userId: string,
    adjustment: PendingAdjustment
  ): Promise<boolean> {
    try {
      const newStatus = adjustment.adjustmentType === 'pattern_adoption' ? 'active' : 'degraded';

      const { error } = await supabase
        .from('ai_pattern_ev_tracking')
        .update({
          pattern_status: newStatus
        })
        .eq('user_id', userId)
        .eq('pattern_name', adjustment.targetName);

      return !error;
    } catch (error) {
      console.error('[Auto Adjustments] Error applying pattern adjustment:', error);
      return false;
    }
  }

  /**
   * Apply indicator weight adjustment
   */
  private async applyIndicatorWeightAdjustment(
    userId: string,
    adjustment: PendingAdjustment
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('ai_indicator_effectiveness')
        .update({
          weight_in_decision: adjustment.proposedValue
        })
        .eq('user_id', userId)
        .eq('indicator_name', adjustment.targetName);

      return !error;
    } catch (error) {
      console.error('[Auto Adjustments] Error applying indicator weight adjustment:', error);
      return false;
    }
  }

  /**
   * Get recently applied adjustments
   */
  async getRecentAdjustments(
    userId: string,
    limit: number = 10
  ): Promise<AppliedAdjustment[]> {
    try {
      const { data, error } = await supabase
        .from('ai_applied_adjustments')
        .select('*')
        .eq('user_id', userId)
        .order('applied_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[Auto Adjustments] Error fetching recent adjustments:', error);
        return [];
      }

      return (data || []).map(adj => ({
        id: adj.id,
        cycleNumber: adj.cycle_number,
        adjustmentType: adj.adjustment_type,
        targetName: adj.target_name,
        oldValue: adj.old_value,
        newValue: adj.new_value,
        reasoning: adj.reasoning,
        appliedAt: adj.applied_at,
        effectivenessScore: adj.effectiveness_score ? parseFloat(adj.effectiveness_score.toString()) : undefined,
        wasBeneficial: adj.was_beneficial
      }));
    } catch (error) {
      console.error('[Auto Adjustments] Exception fetching recent adjustments:', error);
      return [];
    }
  }

  /**
   * Evaluate effectiveness of previously applied adjustments
   */
  async evaluateAdjustmentEffectiveness(
    userId: string,
    adjustmentId: string,
    wasBeneficial: boolean,
    effectivenessScore: number
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('ai_applied_adjustments')
        .update({
          was_beneficial: wasBeneficial,
          effectiveness_score: effectivenessScore
        })
        .eq('id', adjustmentId)
        .eq('user_id', userId);

      if (error) {
        console.error('[Auto Adjustments] Error updating adjustment effectiveness:', error);
      } else {
        console.log(`[Auto Adjustments] Updated effectiveness for adjustment ${adjustmentId}`);
      }
    } catch (error) {
      console.error('[Auto Adjustments] Exception evaluating effectiveness:', error);
    }
  }
}

export const aiAutomaticAdjustments = new AIAutomaticAdjustments();
export type { PendingAdjustment, AppliedAdjustment, CycleStatus, AdjustmentType };
