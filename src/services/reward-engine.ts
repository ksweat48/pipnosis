/**
 * Reward Engine - Platform Score & Per-User History Tracking
 *
 * CCIP-2026-0309: Platform-wide trade score refactor.
 *
 * RESPONSIBILITIES:
 * 1. loadPlatformScore() — reads alpha_platform_score (single global row)
 * 2. recordTradeOutcome() — updates alpha_platform_score on every trade close
 *    - Updates consecutive streak counters
 *    - Recalculates confidence_modifier (-5 to +5 via streak scaling)
 * 3. loadTraderScore(userId) — still available for per-user history / admin dashboards
 *    - The ai_trader_score table is NOT removed, NOT changed
 *    - It is just no longer used to inject personality states into Alpha's prompts
 * 4. Goal achievement rewards still update per-user ai_trader_score for history
 *
 * WHAT IS REMOVED:
 * - getPersonalityState() calls — personality labels are gone
 * - confidence_level / trading_style / risk_appetite writes from win/loss events
 * - Per-user score updates on trade win/loss (platform score is now the only live signal)
 *
 * SSOT:
 * - Global platform streak: alpha_platform_score (single row)
 * - Confidence modifier computation: getPlatformStreakModifier() in ai-identity.ts
 * - Confidence modifier application: confidence-calculation-engine.ts
 */

import { supabase } from '../lib/supabase';
import { getPlatformStreakModifier, type PlatformScore, type TraderScore } from './ai-identity';
import SystemTableRPCWrapper from './system-table-rpc-wrapper';

export interface TradeContext {
  symbol: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  exit_price: number;
  pnl: number;
  risk_amount: number;
  duration_minutes: number;
  max_drawdown?: number;
  atr?: number;
  outcome: 'win' | 'loss' | 'breakeven';
}

export interface RewardResult {
  scoreChange: number;
  factors: string[];
  newScore: number;
  oldScore: number;
  personalityChange: boolean;
}

export interface GoalAchievementContext {
  goalAmount: number;
  accountBalance: number;
  timeToAchieveHours: number;
  timeLimitHours: number;
  userChoice?: 'close_now' | 'continue_breakeven' | 'continue_safety';
  finalOutcome?: 'hit_tp' | 'hit_sl_breakeven' | 'hit_sl_safety' | 'closed_at_goal' | 'manual_close';
  finalPnL?: number;
}

class RewardEngine {
  /**
   * Load the PLATFORM score (single global row, no user_id).
   * Used at execution time to read the current streak modifier.
   */
  async loadPlatformScore(supabaseClient?: any): Promise<PlatformScore> {
    const client = supabaseClient || supabase;
    const { data, error } = await client
      .from('alpha_platform_score')
      .select('*')
      .eq('id', 'singleton')
      .maybeSingle();

    if (error) {
      console.error('[RewardEngine] Failed to load platform score:', error);
      return this.defaultPlatformScore();
    }

    if (!data) {
      console.warn('[RewardEngine] Platform score singleton row missing — returning default');
      return this.defaultPlatformScore();
    }

    return data as PlatformScore;
  }

  private defaultPlatformScore(): PlatformScore {
    return {
      consecutive_wins: 0,
      consecutive_losses: 0,
      total_trades: 0,
      total_wins: 0,
      total_losses: 0,
      confidence_modifier: 0,
      last_outcome: null,
      last_updated: new Date().toISOString()
    };
  }

  /**
   * Record a trade outcome to the PLATFORM score table.
   *
   * Called on every trade close. Updates:
   * - consecutive_wins / consecutive_losses (streak counters)
   * - confidence_modifier (-5 to +5) derived from current streak
   * - total_trades / total_wins / total_losses
   */
  async recordTradeOutcome(outcome: 'win' | 'loss' | 'breakeven'): Promise<PlatformScore> {
    const current = await this.loadPlatformScore();

    let consecutive_wins = current.consecutive_wins;
    let consecutive_losses = current.consecutive_losses;
    let total_wins = current.total_wins;
    let total_losses = current.total_losses;

    if (outcome === 'win') {
      consecutive_wins += 1;
      consecutive_losses = 0;
      total_wins += 1;
    } else if (outcome === 'loss') {
      consecutive_losses += 1;
      consecutive_wins = 0;
      total_losses += 1;
    } else {
      consecutive_wins = 0;
      consecutive_losses = 0;
    }

    const total_trades = current.total_trades + 1;

    const updatedScore: PlatformScore = {
      consecutive_wins,
      consecutive_losses,
      total_trades,
      total_wins,
      total_losses,
      confidence_modifier: getPlatformStreakModifier({
        consecutive_wins,
        consecutive_losses,
        total_trades,
        total_wins,
        total_losses,
        confidence_modifier: 0,
        last_outcome: outcome,
        last_updated: new Date().toISOString()
      }),
      last_outcome: outcome,
      last_updated: new Date().toISOString()
    };

    const { error } = await supabase
      .from('alpha_platform_score')
      .update(updatedScore)
      .eq('id', 'singleton');

    if (error) {
      console.error('[RewardEngine] Failed to update platform score:', error);
    } else {
      const streakInfo = consecutive_wins > 0
        ? `${consecutive_wins} consecutive wins (+${updatedScore.confidence_modifier}%)`
        : consecutive_losses > 0
          ? `${consecutive_losses} consecutive losses (${updatedScore.confidence_modifier}%)`
          : 'no streak (0%)';
      console.log(`[RewardEngine] Platform score updated: ${outcome} | ${streakInfo}`);
    }

    return updatedScore;
  }

  /**
   * Load per-user trader score (for admin dashboards, history, analytics).
   * NOT used for Alpha personality injection or confidence modifiers.
   */
  async loadTraderScore(userId: string, supabaseClient?: any): Promise<TraderScore> {
    const client = supabaseClient || supabase;
    const { data, error } = await client
      .from('ai_trader_score')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      const result = await SystemTableRPCWrapper.createAITraderScore(
        userId,
        0,
        50,
        0,
        50
      );

      if (result.error && result.error.includes('duplicate key')) {
        const { data: retryData, error: retryError } = await client
          .from('ai_trader_score')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();

        if (retryError) throw retryError;
        if (retryData) return retryData as TraderScore;
      }

      if (result.error) throw new Error(result.error);

      return {
        current_score: 50,
        lifetime_profit: 0,
        lifetime_loss: 0,
        streak_wins: 0,
        streak_losses: 0,
        confidence_level: 'balanced',
        risk_appetite: 3.0,
        trading_style: 'steady',
        total_trades: 0,
        win_rate: 0.5
      } as TraderScore;
    }

    return data as TraderScore;
  }

  /**
   * Apply win reward — updates PLATFORM score only.
   * Per-user ai_trader_score is updated for history tracking.
   */
  async applyWinReward(
    userId: string,
    trade: TradeContext,
    traderScore: TraderScore
  ): Promise<RewardResult> {
    const platformScore = await this.recordTradeOutcome('win');

    const oldScore = traderScore.current_score;
    const newScore = Math.min(100, oldScore + 3);

    const { error } = await supabase
      .from('ai_trader_score')
      .update({
        current_score: newScore,
        streak_wins: traderScore.streak_wins + 1,
        streak_losses: 0,
        best_win_streak: Math.max(traderScore.best_win_streak || 0, traderScore.streak_wins + 1),
        lifetime_profit: (traderScore.lifetime_profit || 0) + trade.pnl,
        total_wins: (traderScore.total_wins || 0) + 1,
        total_trades: (traderScore.total_trades || 0) + 1,
        win_rate: ((traderScore.total_wins || 0) + 1) / ((traderScore.total_trades || 0) + 1),
        last_update_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (error) {
      console.error('[RewardEngine] Failed to update per-user score on win:', error);
    }

    const modifier = platformScore.confidence_modifier;
    const streakInfo = platformScore.consecutive_wins > 0
      ? `${platformScore.consecutive_wins} win streak, modifier: +${modifier}%`
      : `modifier: ${modifier}%`;

    console.log(`[RewardEngine] Win recorded. Platform: ${streakInfo}`);

    return {
      scoreChange: 3,
      factors: [`+3 profitable`, streakInfo],
      newScore,
      oldScore,
      personalityChange: false
    };
  }

  /**
   * Apply loss penalty — updates PLATFORM score only.
   * Per-user ai_trader_score is updated for history tracking.
   */
  async applyLossPenalty(
    userId: string,
    trade: TradeContext,
    traderScore: TraderScore
  ): Promise<RewardResult> {
    const platformScore = await this.recordTradeOutcome('loss');

    const oldScore = traderScore.current_score;
    const newScore = Math.max(0, oldScore - 2);

    const { error } = await supabase
      .from('ai_trader_score')
      .update({
        current_score: newScore,
        streak_wins: 0,
        streak_losses: traderScore.streak_losses + 1,
        worst_loss_streak: Math.max(traderScore.worst_loss_streak || 0, traderScore.streak_losses + 1),
        lifetime_loss: (traderScore.lifetime_loss || 0) + Math.abs(trade.pnl),
        total_losses: (traderScore.total_losses || 0) + 1,
        total_trades: (traderScore.total_trades || 0) + 1,
        win_rate: (traderScore.total_wins || 0) / ((traderScore.total_trades || 0) + 1),
        last_update_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (error) {
      console.error('[RewardEngine] Failed to update per-user score on loss:', error);
    }

    const modifier = platformScore.confidence_modifier;
    const streakInfo = platformScore.consecutive_losses > 0
      ? `${platformScore.consecutive_losses} loss streak, modifier: ${modifier}%`
      : `modifier: ${modifier}%`;

    console.log(`[RewardEngine] Loss recorded. Platform: ${streakInfo}`);

    return {
      scoreChange: -2,
      factors: [`-2 loss`, streakInfo],
      newScore,
      oldScore,
      personalityChange: false
    };
  }

  /**
   * Apply breakeven — updates PLATFORM score (resets streak).
   */
  async applyBreakevenResult(
    userId: string,
    trade: TradeContext,
    traderScore: TraderScore
  ): Promise<RewardResult> {
    await this.recordTradeOutcome('breakeven');

    await supabase
      .from('ai_trader_score')
      .update({
        streak_wins: 0,
        streak_losses: 0,
        total_trades: (traderScore.total_trades || 0) + 1,
        win_rate: (traderScore.total_wins || 0) / ((traderScore.total_trades || 0) + 1),
        last_update_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    return {
      scoreChange: 0,
      factors: ['breakeven'],
      newScore: traderScore.current_score,
      oldScore: traderScore.current_score,
      personalityChange: false
    };
  }

  /**
   * Analyze score impact (utility for performance analyzer).
   */
  async analyzeScoreImpact(
    userId: string,
    trade: TradeContext
  ): Promise<RewardResult> {
    const traderScore = await this.loadTraderScore(userId);
    const platformScore = await this.loadPlatformScore();

    const modifier = platformScore.confidence_modifier;
    const streakInfo = platformScore.consecutive_wins > 0
      ? `${platformScore.consecutive_wins} win streak (+${modifier}%)`
      : platformScore.consecutive_losses > 0
        ? `${platformScore.consecutive_losses} loss streak (${modifier}%)`
        : 'no streak (0%)';

    return {
      scoreChange: 0,
      factors: [streakInfo],
      newScore: traderScore.current_score,
      oldScore: traderScore.current_score,
      personalityChange: false
    };
  }

  /**
   * Apply goal achievement reward — per-user history only.
   * Platform score is not affected by goals (only by trade outcomes).
   */
  async applyGoalReward(
    userId: string,
    goalAchievementId: string,
    context: GoalAchievementContext,
    traderScore: TraderScore
  ): Promise<RewardResult> {
    const accountPercent = (context.goalAmount / context.accountBalance) * 100;
    let baseBonus = 0;
    let goalTier = 'small';
    const factors: string[] = [];

    if (context.goalAmount >= 500 || accountPercent >= 50) {
      baseBonus = 75; goalTier = 'massive'; factors.push('+75 legendary goal');
    } else if (context.goalAmount >= 200 || accountPercent >= 20) {
      baseBonus = 50; goalTier = 'large'; factors.push('+50 major achievement');
    } else if (context.goalAmount >= 50 || accountPercent >= 5) {
      baseBonus = 35; goalTier = 'medium'; factors.push('+35 significant milestone');
    } else {
      baseBonus = 25; factors.push('+25 goal achieved');
    }

    const oldScore = traderScore.current_score;
    const newScore = Math.min(100, oldScore + baseBonus);

    const currentGoalStreak = (traderScore as any).goal_streak || 0;
    const newGoalStreak = currentGoalStreak + 1;

    await supabase
      .from('ai_trader_score')
      .update({
        current_score: newScore,
        total_goals_achieved: ((traderScore as any).total_goals_achieved || 0) + 1,
        goal_streak: newGoalStreak,
        best_goal_streak: Math.max(newGoalStreak, (traderScore as any).best_goal_streak || 0),
        goals_this_month: ((traderScore as any).goals_this_month || 0) + 1,
        largest_goal_achieved: Math.max(context.goalAmount, (traderScore as any).largest_goal_achieved || 0),
        last_goal_date: new Date().toISOString()
      })
      .eq('user_id', userId);

    await supabase
      .from('goal_reward_history')
      .insert({
        user_id: userId,
        goal_achievement_id: goalAchievementId,
        reward_type: 'goal_achieved',
        score_change: baseBonus,
        old_score: oldScore,
        new_score: newScore,
        goal_size_tier: goalTier,
        goal_amount: context.goalAmount,
        time_to_achieve_hours: context.timeToAchieveHours,
        streak_multiplier: 1.0,
        reward_factors: factors,
        old_personality: 'N/A',
        new_personality: 'N/A',
        personality_changed: false
      }).then(({ error }) => {
        if (error) console.error('[RewardEngine] Failed to log goal reward history:', error);
      });

    console.log(`[RewardEngine] Goal achievement reward: +${baseBonus} points (${goalTier})`);

    return {
      scoreChange: baseBonus,
      factors,
      newScore,
      oldScore,
      personalityChange: false
    };
  }

  async resetGoalStreak(userId: string): Promise<void> {
    try {
      await supabase
        .from('ai_trader_score')
        .update({ goal_streak: 0 })
        .eq('user_id', userId);
    } catch (error) {
      console.error('[RewardEngine] Error resetting goal streak:', error);
    }
  }
}

export const rewardEngine = new RewardEngine();
