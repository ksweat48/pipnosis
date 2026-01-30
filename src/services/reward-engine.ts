/**
 * Reward Engine - Score-Based Performance Tracking
 *
 * Calculates rewards for winning trades and penalties for losses
 * Updates trader score and manages personality state transitions
 */

import { supabase } from '../lib/supabase';
import { getPersonalityState, type TraderScore } from './ai-identity';
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
   * Load trader score for user
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
      // Initialize new trader score via RPC
      // SSOT: Use null instead of empty string for optional UUID parameters
      const result = await SystemTableRPCWrapper.createAITraderScore(
        userId,
        null as any, // session_id - null for initial score (no session yet)
        0, // trade_count
        50, // win_rate (initial)
        0, // avg_rr
        50 // consistency_score (initial)
      );

      if (result.error) throw new Error(result.error);

      // Return default trader score structure
      return {
        id: result.id,
        user_id: userId,
        current_score: 50,
        session_id: null,
        trade_count: 0,
        win_rate: 50,
        avg_rr: 0,
        consistency_score: 50,
        created_at: new Date().toISOString(),
      } as TraderScore;
    }

    return data as TraderScore;
  }

  /**
   * Calculate win reward
   */
  calculateWinReward(trade: TradeContext, traderScore: TraderScore): RewardResult {
    let scoreIncrease = 0;
    const factors: string[] = [];

    // Base reward for any profitable trade
    scoreIncrease += 3;
    factors.push('+3 profitable');

    // R:R bonus
    const riskReward = Math.abs(trade.pnl) / Math.abs(trade.risk_amount);
    if (riskReward >= 3.0) {
      scoreIncrease += 7;
      factors.push('+7 excellent R:R');
    } else if (riskReward >= 2.0) {
      scoreIncrease += 5;
      factors.push('+5 good R:R');
    }

    // Streak bonus
    if (traderScore.streak_wins >= 3) {
      scoreIncrease += 10;
      factors.push('+10 hot streak');
    } else if (traderScore.streak_wins >= 1) {
      scoreIncrease += 7;
      factors.push('+7 win streak');
    }

    // Perfect execution (minimal drawdown)
    if (trade.max_drawdown && trade.atr) {
      if (trade.max_drawdown < trade.atr * 0.5) {
        scoreIncrease += 10;
        factors.push('+10 perfect entry');
      }
    }

    // Quick win bonus
    if (trade.duration_minutes < 30) {
      scoreIncrease += 3;
      factors.push('+3 quick win');
    }

    // Large win bonus
    if (riskReward >= 4.0) {
      scoreIncrease += 5;
      factors.push('+5 exceptional trade');
    }

    const oldScore = traderScore.current_score;
    const newScore = Math.min(100, oldScore + scoreIncrease);
    const oldPersonality = getPersonalityState(oldScore);
    const newPersonality = getPersonalityState(newScore);

    return {
      scoreChange: scoreIncrease,
      factors,
      newScore,
      oldScore,
      personalityChange: oldPersonality.confidence_level !== newPersonality.confidence_level
    };
  }

  /**
   * Calculate loss penalty
   */
  calculateLossPenalty(trade: TradeContext, traderScore: TraderScore): RewardResult {
    let scoreDecrease = 0;
    const factors: string[] = [];

    // Base penalty
    scoreDecrease += 2;
    factors.push('-2 loss');

    // Quick loss penalty (poor entry)
    if (trade.duration_minutes < 5) {
      scoreDecrease += 4;
      factors.push('-4 poor entry');
    }

    // Streak penalty
    if (traderScore.streak_losses >= 3) {
      scoreDecrease += 10;
      factors.push('-10 critical streak');
    } else if (traderScore.streak_losses >= 1) {
      scoreDecrease += 7;
      factors.push('-7 loss streak');
    }

    // High drawdown penalty
    if (trade.max_drawdown && trade.atr) {
      if (trade.max_drawdown > trade.atr * 2.0) {
        scoreDecrease += 10;
        factors.push('-10 high drawdown');
      }
    }

    // Large loss penalty (exceeded risk)
    const lossPercent = Math.abs(trade.pnl) / Math.abs(trade.risk_amount);
    if (lossPercent > 1.5) {
      scoreDecrease += 5;
      factors.push('-5 exceeded risk');
    }

    const oldScore = traderScore.current_score;
    const newScore = Math.max(0, oldScore - scoreDecrease);
    const oldPersonality = getPersonalityState(oldScore);
    const newPersonality = getPersonalityState(newScore);

    return {
      scoreChange: -scoreDecrease,
      factors,
      newScore,
      oldScore,
      personalityChange: oldPersonality.confidence_level !== newPersonality.confidence_level
    };
  }

  /**
   * Apply win reward to database
   */
  async applyWinReward(
    userId: string,
    trade: TradeContext,
    traderScore: TraderScore
  ): Promise<RewardResult> {
    const reward = this.calculateWinReward(trade, traderScore);

    const newPersonality = getPersonalityState(reward.newScore);

    // Update trader score
    const { error } = await supabase
      .from('ai_trader_score')
      .update({
        current_score: reward.newScore,
        streak_wins: traderScore.streak_wins + 1,
        streak_losses: 0,
        best_win_streak: Math.max(traderScore.best_win_streak, traderScore.streak_wins + 1),
        lifetime_profit: traderScore.lifetime_profit + trade.pnl,
        total_wins: traderScore.total_wins + 1,
        total_trades: traderScore.total_trades + 1,
        win_rate: (traderScore.total_wins + 1) / (traderScore.total_trades + 1),
        confidence_level: newPersonality.confidence_level,
        risk_appetite: newPersonality.risk_appetite,
        trading_style: newPersonality.trading_style,
        last_update_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (error) throw error;

    console.log(`[Reward Engine] ✅ Win: ${reward.factors.join(', ')}`);
    console.log(`[Reward Engine] Score: ${reward.oldScore} → ${reward.newScore} (+${reward.scoreChange})`);
    if (reward.personalityChange) {
      console.log(`[Reward Engine] 🎭 Personality: ${getPersonalityState(reward.oldScore).confidence_level} → ${newPersonality.confidence_level}`);
    }

    return reward;
  }

  /**
   * Apply loss penalty to database
   */
  async applyLossPenalty(
    userId: string,
    trade: TradeContext,
    traderScore: TraderScore
  ): Promise<RewardResult> {
    const penalty = this.calculateLossPenalty(trade, traderScore);

    const newPersonality = getPersonalityState(penalty.newScore);

    // Update trader score
    const { error } = await supabase
      .from('ai_trader_score')
      .update({
        current_score: penalty.newScore,
        streak_wins: 0,
        streak_losses: traderScore.streak_losses + 1,
        worst_loss_streak: Math.max(traderScore.worst_loss_streak, traderScore.streak_losses + 1),
        lifetime_loss: traderScore.lifetime_loss + Math.abs(trade.pnl),
        total_losses: traderScore.total_losses + 1,
        total_trades: traderScore.total_trades + 1,
        win_rate: traderScore.total_wins / (traderScore.total_trades + 1),
        confidence_level: newPersonality.confidence_level,
        risk_appetite: newPersonality.risk_appetite,
        trading_style: newPersonality.trading_style,
        last_update_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (error) throw error;

    console.log(`[Reward Engine] ❌ Loss: ${penalty.factors.join(', ')}`);
    console.log(`[Reward Engine] Score: ${penalty.oldScore} → ${penalty.newScore} (${penalty.scoreChange})`);
    if (penalty.personalityChange) {
      console.log(`[Reward Engine] 🎭 Personality: ${getPersonalityState(penalty.oldScore).confidence_level} → ${newPersonality.confidence_level}`);
    }

    return penalty;
  }

  /**
   * Update score for breakeven trade
   */
  async applyBreakevenResult(
    userId: string,
    trade: TradeContext,
    traderScore: TraderScore
  ): Promise<RewardResult> {
    // Breakeven = neutral, just reset streaks
    const { error } = await supabase
      .from('ai_trader_score')
      .update({
        streak_wins: 0,
        streak_losses: 0,
        total_trades: traderScore.total_trades + 1,
        win_rate: traderScore.total_wins / (traderScore.total_trades + 1),
        last_update_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (error) throw error;

    console.log(`[Reward Engine] ⚖️ Breakeven: No score change`);

    return {
      scoreChange: 0,
      factors: ['breakeven'],
      newScore: traderScore.current_score,
      oldScore: traderScore.current_score,
      personalityChange: false
    };
  }

  /**
   * Analyze score impact for a trade
   */
  async analyzeScoreImpact(
    userId: string,
    trade: TradeContext
  ): Promise<RewardResult> {
    const traderScore = await this.loadTraderScore(userId);

    if (trade.outcome === 'win') {
      return this.calculateWinReward(trade, traderScore);
    } else if (trade.outcome === 'loss') {
      return this.calculateLossPenalty(trade, traderScore);
    } else {
      return {
        scoreChange: 0,
        factors: ['breakeven'],
        newScore: traderScore.current_score,
        oldScore: traderScore.current_score,
        personalityChange: false
      };
    }
  }

  /**
   * Calculate goal achievement reward
   */
  calculateGoalAchievementReward(
    context: GoalAchievementContext,
    traderScore: TraderScore
  ): RewardResult {
    let scoreIncrease = 0;
    const factors: string[] = [];

    // 1. Base bonus from goal difficulty
    const accountPercent = (context.goalAmount / context.accountBalance) * 100;
    let baseBonus = 0;
    let goalTier = '';

    if (context.goalAmount >= 500 || accountPercent >= 50) {
      baseBonus = 75;
      goalTier = 'massive';
      factors.push('+75 legendary goal');
    } else if (context.goalAmount >= 200 || accountPercent >= 20) {
      baseBonus = 50;
      goalTier = 'large';
      factors.push('+50 major achievement');
    } else if (context.goalAmount >= 50 || accountPercent >= 5) {
      baseBonus = 35;
      goalTier = 'medium';
      factors.push('+35 significant milestone');
    } else {
      baseBonus = 25;
      goalTier = 'small';
      factors.push('+25 goal achieved');
    }

    scoreIncrease += baseBonus;

    // 2. Speed bonus
    const timePercent = (context.timeToAchieveHours / context.timeLimitHours) * 100;
    if (timePercent <= 25) {
      scoreIncrease += 15;
      factors.push('+15 lightning speed');
    } else if (timePercent <= 50) {
      scoreIncrease += 10;
      factors.push('+10 efficient execution');
    }

    // 3. User choice bonus (if applicable)
    if (context.userChoice === 'close_now') {
      scoreIncrease += 5;
      factors.push('+5 disciplined exit');
    } else if (context.userChoice === 'continue_breakeven') {
      scoreIncrease += 10;
      factors.push('+10 strategic risk-free play');
    } else if (context.userChoice === 'continue_safety') {
      scoreIncrease += 8;
      factors.push('+8 balanced risk management');
    }

    // 4. Final outcome bonus (if trade completed)
    if (context.finalOutcome) {
      if (context.finalOutcome === 'hit_tp') {
        if (context.userChoice === 'continue_breakeven') {
          scoreIncrease += 15;
          factors.push('+15 maximized opportunity');
        } else if (context.userChoice === 'continue_safety') {
          scoreIncrease += 12;
          factors.push('+12 smart partial protection');
        }
      } else if (context.finalOutcome === 'hit_sl_breakeven') {
        scoreIncrease += 5;
        factors.push('+5 protected profits');
      } else if (context.finalOutcome === 'hit_sl_safety') {
        scoreIncrease += 7;
        factors.push('+7 minimized losses');
      }
    }

    // 5. Apply streak multiplier
    let streakMultiplier = 1.0;
    const goalStreak = (traderScore as any).goal_streak || 0;

    if (goalStreak >= 5) {
      streakMultiplier = 2.0;
      factors.push('x2.0 goal master streak');
    } else if (goalStreak >= 3) {
      streakMultiplier = 1.5;
      factors.push('x1.5 hot goal streak');
    } else if (goalStreak >= 2) {
      streakMultiplier = 1.2;
      factors.push('x1.2 goal momentum');
    }

    // Apply multiplier to total
    scoreIncrease = Math.round(scoreIncrease * streakMultiplier);

    const oldScore = traderScore.current_score;
    const newScore = Math.min(100, oldScore + scoreIncrease);
    const oldPersonality = getPersonalityState(oldScore);
    const newPersonality = getPersonalityState(newScore);

    return {
      scoreChange: scoreIncrease,
      factors,
      newScore,
      oldScore,
      personalityChange: oldPersonality.confidence_level !== newPersonality.confidence_level
    };
  }

  /**
   * Apply goal achievement reward to database
   */
  async applyGoalReward(
    userId: string,
    goalAchievementId: string,
    context: GoalAchievementContext,
    traderScore: TraderScore
  ): Promise<RewardResult> {
    const reward = this.calculateGoalAchievementReward(context, traderScore);
    const oldPersonality = getPersonalityState(reward.oldScore);
    const newPersonality = getPersonalityState(reward.newScore);

    // Calculate goal tier for history
    const accountPercent = (context.goalAmount / context.accountBalance) * 100;
    let goalTier = 'small';
    if (context.goalAmount >= 500 || accountPercent >= 50) {
      goalTier = 'massive';
    } else if (context.goalAmount >= 200 || accountPercent >= 20) {
      goalTier = 'large';
    } else if (context.goalAmount >= 50 || accountPercent >= 5) {
      goalTier = 'medium';
    }

    // Update trader score with goal statistics
    const currentGoalStreak = (traderScore as any).goal_streak || 0;
    const newGoalStreak = currentGoalStreak + 1;
    const bestGoalStreak = Math.max(
      newGoalStreak,
      (traderScore as any).best_goal_streak || 0
    );
    const largestGoal = Math.max(
      context.goalAmount,
      (traderScore as any).largest_goal_achieved || 0
    );

    const { error: updateError } = await supabase
      .from('ai_trader_score')
      .update({
        current_score: reward.newScore,
        total_goals_achieved: ((traderScore as any).total_goals_achieved || 0) + 1,
        goal_streak: newGoalStreak,
        best_goal_streak: bestGoalStreak,
        goals_this_month: ((traderScore as any).goals_this_month || 0) + 1,
        largest_goal_achieved: largestGoal,
        last_goal_date: new Date().toISOString(),
        confidence_level: newPersonality.confidence_level,
        trading_style: newPersonality.trading_style
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error('[Reward Engine] Failed to update trader score:', updateError);
      throw updateError;
    }

    // Calculate streak multiplier for history
    let streakMultiplier = 1.0;
    if (currentGoalStreak >= 5) streakMultiplier = 2.0;
    else if (currentGoalStreak >= 3) streakMultiplier = 1.5;
    else if (currentGoalStreak >= 2) streakMultiplier = 1.2;

    // Log reward in history
    const { error: historyError } = await supabase
      .from('goal_reward_history')
      .insert({
        user_id: userId,
        goal_achievement_id: goalAchievementId,
        reward_type: 'goal_achieved',
        score_change: reward.scoreChange,
        old_score: reward.oldScore,
        new_score: reward.newScore,
        goal_size_tier: goalTier,
        goal_amount: context.goalAmount,
        time_to_achieve_hours: context.timeToAchieveHours,
        streak_multiplier: streakMultiplier,
        reward_factors: reward.factors,
        old_personality: oldPersonality.confidence_level,
        new_personality: newPersonality.confidence_level,
        personality_changed: reward.personalityChange
      });

    if (historyError) {
      console.error('[Reward Engine] Failed to log goal reward history:', historyError);
    }

    console.log(`[Reward Engine] 🎯 Goal achievement reward: +${reward.scoreChange} points`);
    console.log(`[Reward Engine] Score: ${reward.oldScore} → ${reward.newScore}`);
    console.log(`[Reward Engine] Factors: ${reward.factors.join(', ')}`);

    if (reward.personalityChange) {
      console.log(`[Reward Engine] 🎭 Personality upgraded: ${oldPersonality.confidence_level} → ${newPersonality.confidence_level}`);
    }

    return reward;
  }

  /**
   * Apply bonus for user choice after goal achievement
   */
  async applyGoalChoiceBonus(
    userId: string,
    goalAchievementId: string,
    userChoice: 'close_now' | 'continue_breakeven' | 'continue_safety'
  ): Promise<void> {
    // This is already included in the main goal reward calculation
    // But we log it separately for analytics
    console.log(`[Reward Engine] User choice logged: ${userChoice}`);
  }

  /**
   * Apply bonus for final outcome after goal achievement
   */
  async applyGoalFinalOutcome(
    userId: string,
    goalAchievementId: string,
    finalOutcome: string,
    finalPnL: number
  ): Promise<void> {
    try {
      const traderScore = await this.loadTraderScore(userId);

      // Get the original goal achievement context
      const { data: achievement } = await supabase
        .from('goal_achievements')
        .select('*, goal_sessions!inner(*)')
        .eq('id', goalAchievementId)
        .single();

      if (!achievement) {
        console.warn('[Reward Engine] Goal achievement not found');
        return;
      }

      // Calculate additional bonus based on outcome
      let bonusPoints = 0;
      const factors: string[] = [];

      if (finalOutcome === 'hit_tp') {
        if (achievement.user_choice === 'continue_breakeven') {
          bonusPoints = 15;
          factors.push('+15 maximized opportunity');
        } else if (achievement.user_choice === 'continue_safety') {
          bonusPoints = 12;
          factors.push('+12 smart partial protection');
        }
      } else if (finalOutcome === 'hit_sl_breakeven') {
        bonusPoints = 5;
        factors.push('+5 protected profits');
      } else if (finalOutcome === 'hit_sl_safety') {
        bonusPoints = 7;
        factors.push('+7 minimized losses');
      }

      if (bonusPoints > 0) {
        const oldScore = traderScore.current_score;
        const newScore = Math.min(100, oldScore + bonusPoints);
        const oldPersonality = getPersonalityState(oldScore);
        const newPersonality = getPersonalityState(newScore);

        // Update score
        await supabase
          .from('ai_trader_score')
          .update({
            current_score: newScore,
            confidence_level: newPersonality.confidence_level,
            trading_style: newPersonality.trading_style
          })
          .eq('user_id', userId);

        // Log in history
        await supabase
          .from('goal_reward_history')
          .insert({
            user_id: userId,
            goal_achievement_id: goalAchievementId,
            reward_type: 'final_outcome',
            score_change: bonusPoints,
            old_score: oldScore,
            new_score: newScore,
            outcome_bonus: bonusPoints,
            final_outcome: finalOutcome,
            reward_factors: factors,
            old_personality: oldPersonality.confidence_level,
            new_personality: newPersonality.confidence_level,
            personality_changed: oldPersonality.confidence_level !== newPersonality.confidence_level
          });

        console.log(`[Reward Engine] 🎁 Final outcome bonus: +${bonusPoints} points`);
        console.log(`[Reward Engine] Outcome: ${finalOutcome}, Final P&L: $${finalPnL.toFixed(2)}`);
      }
    } catch (error) {
      console.error('[Reward Engine] Error applying final outcome bonus:', error);
    }
  }

  /**
   * Reset goal streak (called when user fails to achieve a goal)
   */
  async resetGoalStreak(userId: string): Promise<void> {
    try {
      await supabase
        .from('ai_trader_score')
        .update({
          goal_streak: 0
        })
        .eq('user_id', userId);

      console.log('[Reward Engine] ⚠️  Goal streak reset');
    } catch (error) {
      console.error('[Reward Engine] Error resetting goal streak:', error);
    }
  }
}

export const rewardEngine = new RewardEngine();
