/**
 * Reward Engine - Score-Based Performance Tracking
 *
 * Calculates rewards for winning trades and penalties for losses
 * Updates trader score and manages personality state transitions
 */

import { supabase } from '../lib/supabase';
import { getPersonalityState, type TraderScore } from './ai-identity';

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

class RewardEngine {
  /**
   * Load trader score for user
   */
  async loadTraderScore(userId: string): Promise<TraderScore> {
    const { data, error } = await supabase
      .from('ai_trader_score')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      // Initialize new trader score
      const { data: newScore, error: insertError } = await supabase
        .from('ai_trader_score')
        .insert({
          user_id: userId,
          current_score: 50
        })
        .select()
        .single();

      if (insertError) throw insertError;
      return newScore as TraderScore;
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
}

export const rewardEngine = new RewardEngine();
