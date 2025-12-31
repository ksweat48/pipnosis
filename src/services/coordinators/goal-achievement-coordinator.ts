/**
 * GOAL ACHIEVEMENT COORDINATOR - Single Source of Truth
 *
 * ALL goal achievement detection and processing MUST go through this coordinator.
 * DO NOT check or process goal achievements directly elsewhere in the codebase.
 *
 * This prevents:
 * - Duplicate achievement records
 * - Race conditions between services
 * - Double reward application
 * - Inconsistent goal status updates
 */

import { supabase } from '../../lib/supabase';
import { goalSessionStateMachine } from './goal-session-state-machine';
import { notificationCoordinator } from './notification-coordinator';
import { calculatePnL } from '../../types/position';

export interface GoalCheckResult {
  achieved: boolean;
  currentProgress: number;
  targetAmount: number;
  progressPercent: number;
  remainingAmount: number;
  achievementId?: string;
}

export interface GoalContext {
  sessionId: string;
  userId: string;
  targetAmount: number;
  currentCumulativePnL: number;
}

interface AchievementRecord {
  id: string;
  session_id: string;
  achieved_at: string;
  final_pnl: number;
}

class GoalAchievementCoordinator {
  private processingLocks = new Map<string, boolean>();
  private recentAchievements = new Map<string, number>();

  async checkAndProcessGoalAchievement(
    context: GoalContext,
    tradeUnrealizedPnL: number = 0
  ): Promise<GoalCheckResult> {
    const totalProgress = context.currentCumulativePnL + tradeUnrealizedPnL;
    const progressPercent = (totalProgress / context.targetAmount) * 100;
    const remainingAmount = context.targetAmount - totalProgress;

    const result: GoalCheckResult = {
      achieved: totalProgress >= context.targetAmount,
      currentProgress: totalProgress,
      targetAmount: context.targetAmount,
      progressPercent,
      remainingAmount: Math.max(0, remainingAmount),
    };

    if (result.achieved) {
      const achievementResult = await this.processAchievement(context, totalProgress);
      if (achievementResult) {
        result.achievementId = achievementResult.id;
      }
    }

    return result;
  }

  async checkGoalProgressOnly(context: GoalContext, unrealizedPnL: number = 0): Promise<GoalCheckResult> {
    const totalProgress = context.currentCumulativePnL + unrealizedPnL;
    const progressPercent = (totalProgress / context.targetAmount) * 100;

    return {
      achieved: totalProgress >= context.targetAmount,
      currentProgress: totalProgress,
      targetAmount: context.targetAmount,
      progressPercent,
      remainingAmount: Math.max(0, context.targetAmount - totalProgress),
    };
  }

  private async processAchievement(
    context: GoalContext,
    finalPnL: number
  ): Promise<AchievementRecord | null> {
    const lockKey = context.sessionId;

    if (this.processingLocks.get(lockKey)) {
      console.log(`[GoalAchievementCoordinator] Achievement already being processed for session ${context.sessionId}`);
      return null;
    }

    const recentTime = this.recentAchievements.get(context.sessionId);
    if (recentTime && Date.now() - recentTime < 60000) {
      console.log(`[GoalAchievementCoordinator] Achievement recently processed for session ${context.sessionId}, skipping`);
      return null;
    }

    this.processingLocks.set(lockKey, true);

    try {
      const { data: existingAchievement } = await supabase
        .from('goal_achievements')
        .select('id')
        .eq('session_id', context.sessionId)
        .maybeSingle();

      if (existingAchievement) {
        console.log(`[GoalAchievementCoordinator] Achievement already exists for session ${context.sessionId}`);
        return existingAchievement as AchievementRecord;
      }

      const { data: sessionData } = await supabase
        .from('goal_sessions')
        .select('goal_amount, risk_mode, status')
        .eq('id', context.sessionId)
        .maybeSingle();

      if (!sessionData || sessionData.status === 'goal_achieved') {
        console.log(`[GoalAchievementCoordinator] Session already achieved or not found`);
        return null;
      }

      const transitionResult = await goalSessionStateMachine.transition(
        context.sessionId,
        'goal_achieved',
        {
          reason: 'Goal target reached',
          pnl: finalPnL,
          triggeredBy: 'GoalAchievementCoordinator',
        }
      );

      if (!transitionResult.success) {
        console.warn(`[GoalAchievementCoordinator] Failed to transition session: ${transitionResult.error}`);
        return null;
      }

      const goalAmount = typeof sessionData.goal_amount === 'object'
        ? (sessionData.goal_amount as Record<string, number>).amount
        : sessionData.goal_amount;

      const achievementData = {
        user_id: context.userId,
        session_id: context.sessionId,
        achieved_at: new Date().toISOString(),
        final_pnl: finalPnL,
        goal_target: goalAmount,
        overshoot_amount: Math.max(0, finalPnL - goalAmount),
        risk_mode: sessionData.risk_mode || 'medium',
      };

      const { data: achievement, error: achievementError } = await supabase
        .from('goal_achievements')
        .insert(achievementData)
        .select()
        .single();

      if (achievementError) {
        console.error(`[GoalAchievementCoordinator] Failed to create achievement:`, achievementError);
        return null;
      }

      this.recentAchievements.set(context.sessionId, Date.now());

      await this.applyRewards(context.userId, finalPnL, goalAmount);

      await notificationCoordinator.send({
        userId: context.userId,
        type: 'goal_achieved',
        title: 'Goal Achieved!',
        message: `Congratulations! You reached your $${goalAmount.toFixed(2)} goal with $${finalPnL.toFixed(2)} profit!`,
        metadata: {
          sessionId: context.sessionId,
          achievementId: achievement.id,
          finalPnL,
          goalTarget: goalAmount,
        },
        priority: 'high',
      });

      console.log(`[GoalAchievementCoordinator] Successfully processed achievement for session ${context.sessionId}`);

      return achievement as AchievementRecord;
    } finally {
      this.processingLocks.delete(lockKey);
    }
  }

  private async applyRewards(userId: string, finalPnL: number, goalTarget: number): Promise<void> {
    try {
      const overshoot = finalPnL - goalTarget;
      const overshootPercent = (overshoot / goalTarget) * 100;

      let bonusCredits = 0;
      if (overshootPercent >= 50) bonusCredits = 50;
      else if (overshootPercent >= 25) bonusCredits = 25;
      else if (overshootPercent >= 10) bonusCredits = 10;

      if (bonusCredits > 0) {
        const { data: currentBalance } = await supabase
          .from('token_balance')
          .select('balance')
          .eq('user_id', userId)
          .maybeSingle();

        if (currentBalance) {
          await supabase
            .from('token_balance')
            .update({
              balance: currentBalance.balance + bonusCredits,
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', userId);

          console.log(`[GoalAchievementCoordinator] Applied ${bonusCredits} bonus credits to user ${userId}`);
        }
      }
    } catch (error) {
      console.error(`[GoalAchievementCoordinator] Failed to apply rewards:`, error);
    }
  }

  async getSessionProgress(sessionId: string): Promise<GoalCheckResult | null> {
    const { data: session, error } = await supabase
      .from('goal_sessions')
      .select('id, user_id, goal_amount, cumulative_profit')
      .eq('id', sessionId)
      .maybeSingle();

    if (error || !session) return null;

    const goalAmount = typeof session.goal_amount === 'object'
      ? (session.goal_amount as Record<string, number>).amount
      : session.goal_amount;

    const progress = session.cumulative_profit || 0;
    const progressPercent = (progress / goalAmount) * 100;

    return {
      achieved: progress >= goalAmount,
      currentProgress: progress,
      targetAmount: goalAmount,
      progressPercent,
      remainingAmount: Math.max(0, goalAmount - progress),
    };
  }

  async calculateUnrealizedPnL(
    symbol: string,
    direction: 'buy' | 'sell',
    entryPrice: number,
    currentPrice: number,
    lotSize: number
  ): Promise<number> {
    return calculatePnL(direction, entryPrice, currentPrice, lotSize, symbol);
  }
}

export const goalAchievementCoordinator = new GoalAchievementCoordinator();
