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
 *
 * CCIP 2026-02-18: Progressive journal milestone tracking added.
 * When goal is hit the triggering trade is immediately upserted into
 * ai_trade_journal with journal_stage = 'goal_achieved' and
 * goal_pnl_at_achievement stamped.
 *
 * On "close_now" the open trade is closed via the close_goal_session_trade
 * RPC so the standard TradeClosureEventProcessor pipeline fires and updates
 * the journal with full closure data.
 *
 * On "continue_to_tp" / timeout the journal already carries the goal-hit
 * snapshot; post-trade-analyzer updates it with TP1 / TP2 milestone data
 * when the trade closes naturally.
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

      // CCIP GOVERNANCE (2026-02-27): Goal countdown modal removed.
      // Users no longer set profit goals — they set dollar risk per trade.
      // The trade runs to its natural TP without user intervention.
      // When the trade closes (TP or SL) the standard TradeClosedActionDialog fires
      // via the trade_closure_events pipeline (SSOT: tradeClosureCoordinator).
      //
      // We still stamp the journal so the goal-reached milestone is recorded,
      // and we mark goal_countdown_started_at to prevent reprocessing.
      if (sessionData.goal_countdown_started_at) {
        console.log(`[GoalAchievementCoordinator] Goal achievement already recorded for session ${context.sessionId}`);
        return null;
      }

      // Mark achievement as recorded (reusing goal_countdown_started_at as a guard flag)
      await supabase
        .from('goal_sessions')
        .update({
          goal_countdown_started_at: new Date().toISOString(),
        })
        .eq('id', context.sessionId);

      this.recentAchievements.set(context.sessionId, Date.now());

      // CCIP 2026-02-18: Stamp the triggering trade's journal entry so the
      // goal-hit moment is always recorded for analytics.
      await this.stampGoalAchievementOnJournal(context.sessionId, finalPnL);

      console.log(`[GoalAchievementCoordinator] ✅ Goal achievement recorded for session ${context.sessionId} — trade continues to natural TP`);

      // Return null — trade continues; TradeClosedActionDialog fires when it actually closes.
      return null;
    } finally {
      this.processingLocks.delete(lockKey);
    }
  }

  /**
   * Stamp the open trade's journal entry with goal-achievement milestone data.
   *
   * SSOT: Uses upsert on trade_id so the pre-existing journal row (created at
   * trade open) is updated — not duplicated.  If no journal row exists yet
   * (race condition), a minimal retroactive entry is created so the goal-hit
   * moment is never lost.
   *
   * journal_stage is set to 'goal_achieved' and goal_pnl_at_achievement is
   * recorded. The entry remains 'open' outcome until the trade actually closes.
   */
  private async stampGoalAchievementOnJournal(sessionId: string, goalPnL: number): Promise<void> {
    try {
      const goalAchievedAt = new Date().toISOString();

      // Find the currently open trade for this session
      const { data: openTrade } = await supabase
        .from('goal_session_trades')
        .select('id, symbol, direction, entry_price, stop_loss, take_profit, created_at, user_id, trade_style, timeframe')
        .eq('goal_session_id', sessionId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!openTrade) {
        console.log(`[GoalAchievementCoordinator] No open trade found for session ${sessionId} - skipping journal stamp`);
        return;
      }

      // Check if a journal entry already exists for this trade
      const { data: existingEntry } = await supabase
        .from('ai_trade_journal')
        .select('id, journal_stage')
        .eq('trade_id', openTrade.id)
        .maybeSingle();

      if (existingEntry) {
        // Update the existing entry with goal milestone data
        const { error } = await supabase
          .from('ai_trade_journal')
          .update({
            journal_stage: 'goal_achieved',
            goal_pnl_at_achievement: goalPnL,
            goal_achieved_at: goalAchievedAt,
            updated_at: goalAchievedAt,
          })
          .eq('id', existingEntry.id);

        if (error) {
          console.error(`[GoalAchievementCoordinator] Failed to stamp goal achievement on journal entry:`, error);
        } else {
          console.log(`[GoalAchievementCoordinator] ✅ Journal entry ${existingEntry.id} stamped with goal_achieved stage (P&L: $${goalPnL.toFixed(2)})`);
        }
      } else {
        // No pre-existing journal entry (trade opened before journaling was wired).
        // Create an enriched retroactive entry so the goal-hit moment is never lost.
        //
        // CCIP 2026-03-01: Enrich narrative with alpha scan context and session data.
        // SSOT: goal_session_scan_results owns alpha reasoning; goal_sessions owns style.
        const narratives = await this.buildRetroactiveNarratives(sessionId, openTrade, goalPnL, goalAchievedAt);

        const { error } = await supabase
          .from('ai_trade_journal')
          .insert({
            user_id: openTrade.user_id,
            trade_id: openTrade.id,
            session_id: sessionId,
            symbol: openTrade.symbol,
            direction: openTrade.direction || 'buy',
            entry_time: openTrade.created_at || goalAchievedAt,
            entry_price: openTrade.entry_price || 0,
            stop_loss: openTrade.stop_loss,
            take_profit: openTrade.take_profit,
            llm_reasoning: narratives.llmReasoning,
            market_read: narratives.marketRead,
            expected_outcome: narratives.expectedOutcome,
            pattern_identified: narratives.patternIdentified,
            conviction_level: narratives.convictionLevel,
            rank_at_time: 'Autonomous AI',
            outcome: 'open',
            journal_entry_type: 'trade',
            journal_stage: 'goal_achieved',
            goal_pnl_at_achievement: goalPnL,
            goal_achieved_at: goalAchievedAt,
            pnl: goalPnL,
          });

        if (error) {
          console.error(`[GoalAchievementCoordinator] Failed to create retroactive journal entry for goal achievement:`, error);
        } else {
          console.log(`[GoalAchievementCoordinator] ✅ Retroactive journal entry created for trade ${openTrade.id} with goal_achieved stage`);
        }
      }
    } catch (error) {
      console.error(`[GoalAchievementCoordinator] Exception stamping journal:`, error);
    }
  }

  /**
   * Build enriched narrative fields for a retroactive journal entry.
   *
   * CCIP 2026-03-01: Queries goal_session_scan_results and goal_sessions to
   * produce alpha-context-aware narratives rather than bare templates.
   * Falls back gracefully to deterministic templates if scan data is absent.
   *
   * SSOT:
   *  - goal_session_scan_results is the authority for alpha scan reasoning
   *  - goal_sessions is the authority for trade_style and dollar_risk
   *  - This is a read-only enrichment — no writes to either table
   */
  private async buildRetroactiveNarratives(
    sessionId: string,
    openTrade: any,
    goalPnL: number,
    goalAchievedAt: string
  ): Promise<{
    llmReasoning: string;
    marketRead: string;
    expectedOutcome: string;
    patternIdentified: string;
    convictionLevel: number;
  }> {
    const direction = (openTrade.direction || 'buy').toUpperCase();
    const symbol = openTrade.symbol || 'Unknown';
    const entryPrice = openTrade.entry_price ?? 0;
    const stopLoss = openTrade.stop_loss ?? 0;
    const takeProfit = openTrade.take_profit ?? 0;

    const entryHour = new Date(openTrade.created_at || goalAchievedAt).getUTCHours();
    const marketSession = entryHour < 8 ? 'Tokyo' : entryHour < 16 ? 'London' : 'New York';

    const isJpy = symbol.includes('JPY');
    const pipValue = isJpy ? 0.01 : 0.0001;
    const slPips = stopLoss > 0 ? Math.round(Math.abs(entryPrice - stopLoss) / pipValue) : 0;
    const tpPips = takeProfit > 0 ? Math.round(Math.abs(takeProfit - entryPrice) / pipValue) : 0;
    const rrRatio = slPips > 0 ? (tpPips / slPips).toFixed(1) : 'N/A';

    const [sessionRow, latestScan] = await Promise.all([
      supabase
        .from('goal_sessions')
        .select('trade_style, dollar_risk')
        .eq('id', sessionId)
        .maybeSingle()
        .then(r => r.data),
      supabase
        .from('goal_session_scan_results')
        .select('top_candidate_symbol, top_candidate_action, top_candidate_confidence, all_candidates')
        .eq('session_id', sessionId)
        .order('scan_timestamp', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(r => r.data),
    ]);

    const rawStyle: string = openTrade.trade_style || sessionRow?.trade_style || '';
    const styleMap: Record<string, string> = {
      scalper: 'Scalp', scalp: 'Scalp',
      micro: 'Micro', micro_intraday: 'Micro',
      intraday: 'Intraday', day: 'Intraday',
    };
    const styleLabel = styleMap[rawStyle.toLowerCase()] ?? 'Intraday';

    let alphaReasoning: string | null = null;
    let alphaConfidence: number | null = null;
    let alphaPattern: string | null = null;

    if (latestScan) {
      alphaConfidence = latestScan.top_candidate_confidence ?? null;
      if (latestScan.all_candidates && Array.isArray(latestScan.all_candidates)) {
        const match = latestScan.all_candidates.find(
          (c: any) => c.symbol === symbol || c.pair === symbol
        );
        if (match) {
          alphaReasoning = match.reasoning ?? match.alpha_reasoning ?? null;
          alphaPattern = match.pattern ?? match.pattern_identified ?? null;
          alphaConfidence = match.confidence ?? alphaConfidence;
        }
      }
      if (!alphaReasoning) {
        alphaReasoning = null;
      }
    }

    const convictionLevel = alphaConfidence ?? 70;
    const patternIdentified = alphaPattern ?? `${styleLabel} Setup`;

    const llmReasoning = alphaReasoning
      ? `Alpha identified a ${direction} opportunity on ${symbol} during the ${marketSession} session using a ${styleLabel} strategy. ${alphaReasoning}`
      : `Alpha executed a ${styleLabel} ${direction} on ${symbol} during the ${marketSession} session${alphaConfidence ? ` with ${alphaConfidence}% conviction` : ''}. The trade crossed the session goal threshold at $${goalPnL.toFixed(2)}.`;

    const marketRead = [
      `${symbol} entered at ${entryPrice.toFixed(isJpy ? 3 : 5)} during the ${marketSession} session.`,
      slPips > 0 ? `Stop loss placed ${slPips} pips below entry at ${stopLoss.toFixed(isJpy ? 3 : 5)}.` : null,
      tpPips > 0 ? `Target set ${tpPips} pips away at ${takeProfit.toFixed(isJpy ? 3 : 5)}.` : null,
      rrRatio !== 'N/A' ? `Reward-to-risk: ${rrRatio}:1.` : null,
      alphaConfidence ? `Alpha confidence: ${alphaConfidence}%.` : null,
    ].filter(Boolean).join(' ');

    const expectedOutcome = [
      `Alpha targeted a ${rrRatio !== 'N/A' ? `${rrRatio}:1 reward-to-risk` : 'directional'} ${styleLabel} setup on ${symbol}.`,
      slPips > 0 && tpPips > 0 ? `Entry at ${entryPrice.toFixed(isJpy ? 3 : 5)}: ${slPips}-pip stop, ${tpPips}-pip target.` : null,
      `Trade crossed the session goal threshold at $${goalPnL.toFixed(2)}.`,
    ].filter(Boolean).join(' ');

    return { llmReasoning, marketRead, expectedOutcome, patternIdentified, convictionLevel };
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
   * @deprecated CCIP GOVERNANCE (2026-02-27): Goal countdown modal removed.
   * Users no longer set profit targets — they set dollar risk per trade.
   * Trades run to their natural TP/SL. This method is kept for backward
   * compatibility with any remaining database records but should never be
   * called from new code paths.
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
        // User chose to continue - trade continues unchanged to TP.
        // The journal entry was already stamped with goal_achieved stage in
        // processAchievement(). post-trade-analyzer will update it with the
        // TP1/TP2 milestone when the trade closes naturally.
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
        // User chose to close immediately at goal P&L.
        console.log(`[GoalAchievementCoordinator] User chose to close trade and session ${sessionId}`);

        const finalPnL = sessionData.current_progress || 0;
        const goalAmount = sessionData.target_value;

        // Find and close the open trade via RPC so TradeClosureEventProcessor
        // fires and updates the journal with full closure data (exit price, pnl,
        // actual_outcome narrative, lesson_learned etc.)
        const { data: openTrade } = await supabase
          .from('goal_session_trades')
          .select('id')
          .eq('goal_session_id', sessionId)
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (openTrade) {
          const { error: closeError } = await supabase.rpc('close_goal_session_trade', {
            p_trade_id: openTrade.id,
            p_close_reason: 'goal_achieved',
            p_exit_price: null,
          });

          if (closeError) {
            console.error(`[GoalAchievementCoordinator] Failed to close trade via RPC:`, closeError);
            // Non-fatal: session transition still proceeds below
          } else {
            console.log(`[GoalAchievementCoordinator] ✅ Trade ${openTrade.id} closed via RPC with reason goal_achieved`);
          }
        }

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
   * @deprecated CCIP GOVERNANCE (2026-02-27): Goal countdown modal removed.
   * Kept for backward compatibility — should never be called from new code.
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
