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
import { modalQueueManager } from '../modal-queue-manager';

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
        .eq('goal_session_id', context.sessionId)
        .maybeSingle();

      if (existingAchievement) {
        console.log(`[GoalAchievementCoordinator] Achievement already exists for session ${context.sessionId}`);
        return existingAchievement as AchievementRecord;
      }

      const { data: sessionData } = await supabase
        .from('goal_sessions')
        .select('target_value, risk_mode, status, goal_countdown_started_at')
        .eq('id', context.sessionId)
        .maybeSingle();

      if (!sessionData) {
        console.log(`[GoalAchievementCoordinator] Session not found`);
        return null;
      }

      if (sessionData.status === 'goal_achieved') {
        console.log(`[GoalAchievementCoordinator] Session already achieved`);
        return null;
      }

      // Check if countdown already started (prevent duplicate modals)
      if (sessionData.goal_countdown_started_at) {
        console.log(`[GoalAchievementCoordinator] Goal countdown already started for session ${context.sessionId}`);
        return null;
      }

      const goalAmount = sessionData.target_value;

      // Mark countdown as started in database
      await supabase
        .from('goal_sessions')
        .update({
          goal_countdown_started_at: new Date().toISOString(),
        })
        .eq('id', context.sessionId);

      this.recentAchievements.set(context.sessionId, Date.now());

      // Create 1-minute countdown modal
      const modalResult = await modalQueueManager.createPendingModal(
        context.userId,
        context.sessionId,
        'goal_achieved_countdown',
        {
          current_progress: finalPnL,
          target_value: goalAmount,
          trades_in_session: 1,
          session_id: context.sessionId,
          timeout_minutes: 1,
          message: `You've reached your $${goalAmount.toFixed(2)} goal! Choose to continue to Take Profit or close now.`,
        }
      );

      if (!modalResult.success) {
        console.error(`[GoalAchievementCoordinator] Failed to create countdown modal:`, modalResult.error);
        // Rollback countdown flag if modal creation failed
        await supabase
          .from('goal_sessions')
          .update({ goal_countdown_started_at: null })
          .eq('id', context.sessionId);
        return null;
      }

      // Send push notification as fallback
      await notificationCoordinator.send({
        userId: context.userId,
        type: 'goal_achieved',
        title: 'Goal Achieved!',
        message: `Congratulations! You reached your $${goalAmount.toFixed(2)} goal with $${finalPnL.toFixed(2)} profit! Choose your next action within 1 minute.`,
        metadata: {
          sessionId: context.sessionId,
          finalPnL,
          goalTarget: goalAmount,
          modalId: modalResult.modalId,
          countdownSeconds: 60,
        },
        priority: 'critical',
      });

      console.log(`[GoalAchievementCoordinator] ✅ Goal countdown modal created for session ${context.sessionId} - user has 1 minute to respond`);

      // Return null since achievement is not finalized yet (waiting for user response)
      return null;
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
      .select('id, user_id, target_value, current_progress')
      .eq('id', sessionId)
      .maybeSingle();

    if (error || !session) return null;

    const goalAmount = session.target_value;

    const progress = session.current_progress || 0;
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

  /**
   * Handle user action from goal countdown modal
   *
   * SSOT: This is the ONLY place that processes goal countdown responses
   *
   * @param sessionId - Goal session ID
   * @param action - User's choice: 'continue_to_tp' or 'close_now'
   */
  async handleGoalCountdownAction(
    sessionId: string,
    action: 'continue_to_tp' | 'close_now'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[GoalAchievementCoordinator] Processing goal countdown action: ${action} for session ${sessionId}`);

      // Get session data
      const { data: sessionData, error: sessionError } = await supabase
        .from('goal_sessions')
        .select('id, user_id, target_value, current_progress, status')
        .eq('id', sessionId)
        .maybeSingle();

      if (sessionError || !sessionData) {
        console.error(`[GoalAchievementCoordinator] Failed to fetch session:`, sessionError);
        return { success: false, error: 'Session not found' };
      }

      // Record user action in database
      await supabase
        .from('goal_sessions')
        .update({
          goal_countdown_user_action: action,
        })
        .eq('id', sessionId);

      if (action === 'continue_to_tp') {
        // User chose to continue - trade continues unchanged to TP
        console.log(`[GoalAchievementCoordinator] User chose to continue to TP for session ${sessionId}`);

        // Send confirmation notification
        await notificationCoordinator.send({
          userId: sessionData.user_id,
          type: 'goal_progress',
          title: 'Trade Continuing',
          message: 'Your trade will continue to Take Profit unchanged.',
          metadata: {
            sessionId,
            action: 'continue_to_tp',
          },
          priority: 'medium',
        });

        return { success: true };

      } else if (action === 'close_now') {
        // User chose to close - finalize achievement and close trade
        console.log(`[GoalAchievementCoordinator] User chose to close trade and session ${sessionId}`);

        const finalPnL = sessionData.current_progress || 0;
        const goalAmount = sessionData.target_value;

        // Transition session to goal_achieved status
        const transitionResult = await goalSessionStateMachine.transition(
          sessionId,
          'goal_achieved',
          {
            reason: 'User chose to close at goal achievement',
            pnl: finalPnL,
            triggeredBy: 'GoalAchievementCoordinator.handleGoalCountdownAction',
          }
        );

        if (!transitionResult.success) {
          console.error(`[GoalAchievementCoordinator] Failed to transition session:`, transitionResult.error);
          return { success: false, error: 'Failed to transition session' };
        }

        // Create achievement record
        const achievementData = {
          user_id: sessionData.user_id,
          goal_session_id: sessionId,
          achieved_at: new Date().toISOString(),
          achieved_pnl: finalPnL,
          target_amount: goalAmount,
          final_pnl: finalPnL,
        };

        const { data: achievement, error: achievementError } = await supabase
          .from('goal_achievements')
          .insert(achievementData)
          .select()
          .single();

        if (achievementError) {
          console.error(`[GoalAchievementCoordinator] Failed to create achievement:`, achievementError);
          return { success: false, error: 'Failed to create achievement' };
        }

        // Apply rewards
        await this.applyRewards(sessionData.user_id, finalPnL, goalAmount);

        // Send achievement notification
        await notificationCoordinator.send({
          userId: sessionData.user_id,
          type: 'goal_achieved',
          title: 'Goal Achieved!',
          message: `Congratulations! You reached your $${goalAmount.toFixed(2)} goal with $${finalPnL.toFixed(2)} profit!`,
          metadata: {
            sessionId,
            achievementId: achievement.id,
            finalPnL,
            goalTarget: goalAmount,
          },
          priority: 'high',
        });

        console.log(`[GoalAchievementCoordinator] ✅ Achievement finalized for session ${sessionId}`);

        return { success: true };
      }

      return { success: false, error: 'Invalid action' };
    } catch (error) {
      console.error(`[GoalAchievementCoordinator] Error processing countdown action:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Handle goal countdown timeout (no user response after 1 minute)
   *
   * DEFAULT BEHAVIOR: Continue trade to TP unchanged (do NOT modify SL)
   *
   * GOVERNANCE: This is CCIP-compliant - timeout defaults to safe continuation
   *
   * @param sessionId - Goal session ID
   */
  async handleGoalCountdownTimeout(sessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[GoalAchievementCoordinator] Goal countdown timeout for session ${sessionId} - defaulting to continue`);

      // Get session data
      const { data: sessionData, error: sessionError } = await supabase
        .from('goal_sessions')
        .select('id, user_id, goal_countdown_user_action')
        .eq('id', sessionId)
        .maybeSingle();

      if (sessionError || !sessionData) {
        console.error(`[GoalAchievementCoordinator] Failed to fetch session:`, sessionError);
        return { success: false, error: 'Session not found' };
      }

      // Check if user already responded
      if (sessionData.goal_countdown_user_action) {
        console.log(`[GoalAchievementCoordinator] User already responded with action: ${sessionData.goal_countdown_user_action}`);
        return { success: true };
      }

      // Record timeout action as 'continue_to_tp' (default behavior)
      await supabase
        .from('goal_sessions')
        .update({
          goal_countdown_user_action: 'timeout_continue',
        })
        .eq('id', sessionId);

      // Send notification about timeout
      await notificationCoordinator.send({
        userId: sessionData.user_id,
        type: 'goal_progress',
        title: 'Trade Continuing',
        message: 'No response received. Your trade will continue to Take Profit unchanged.',
        metadata: {
          sessionId,
          action: 'timeout_continue',
        },
        priority: 'medium',
      });

      console.log(`[GoalAchievementCoordinator] ✅ Timeout processed - trade continues to TP for session ${sessionId}`);

      return { success: true };
    } catch (error) {
      console.error(`[GoalAchievementCoordinator] Error processing countdown timeout:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

export const goalAchievementCoordinator = new GoalAchievementCoordinator();
