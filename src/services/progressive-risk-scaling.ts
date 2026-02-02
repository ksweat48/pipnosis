import { supabase } from '../lib/supabase';

export interface RiskScalingInputs {
  userId: string;
  baseRiskPercent: number;
  goalSessionId?: string;
  lookbackTrades?: number; // How many recent trades to analyze (default 10)
}

export interface RiskScalingResult {
  adjustedRiskPercent: number;
  scalingMultiplier: number; // 0.5 - 1.5x
  performanceStreak: 'winning' | 'losing' | 'neutral';
  streakLength: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  reasoning: string;
  recommendations: string[];
}

class ProgressiveRiskScaling {
  private readonly MAX_SCALE_UP = 1.5; // Maximum 50% increase
  private readonly MAX_SCALE_DOWN = 0.5; // Minimum 50% decrease
  private readonly WINNING_THRESHOLD = 3; // 3+ wins to scale up
  private readonly LOSING_THRESHOLD = 2; // 2+ losses to scale down

  async calculateRiskScaling(inputs: RiskScalingInputs): Promise<RiskScalingResult> {
    const { userId, baseRiskPercent, goalSessionId, lookbackTrades = 10 } = inputs;

    // Get recent trade performance
    const recentTrades = await this.getRecentTrades(userId, goalSessionId, lookbackTrades);

    if (recentTrades.length === 0) {
      // No trading history, use base risk
      return {
        adjustedRiskPercent: baseRiskPercent,
        scalingMultiplier: 1.0,
        performanceStreak: 'neutral',
        streakLength: 0,
        confidenceLevel: 'medium',
        reasoning: 'No trading history - using base risk',
        recommendations: ['Start with conservative position sizing', 'Build track record before scaling']
      };
    }

    // Analyze streak
    const streakAnalysis = this.analyzeStreak(recentTrades);

    // Calculate win rate from recent trades
    const wins = recentTrades.filter(t => t.result === 'win').length;
    const winRate = wins / recentTrades.length;

    // Calculate average PnL
    const avgPnL = recentTrades.reduce((sum, t) => sum + t.pnl, 0) / recentTrades.length;

    // Determine confidence level
    let confidenceLevel: 'high' | 'medium' | 'low';
    if (winRate >= 0.60 && avgPnL > 0) {
      confidenceLevel = 'high';
    } else if (winRate >= 0.45 && avgPnL >= 0) {
      confidenceLevel = 'medium';
    } else {
      confidenceLevel = 'low';
    }

    // Calculate scaling multiplier
    let scalingMultiplier = 1.0;

    if (streakAnalysis.type === 'winning' && streakAnalysis.length >= this.WINNING_THRESHOLD) {
      // Progressive scale up for winning streak
      const scaleUpAmount = Math.min(
        streakAnalysis.length * 0.1, // 10% per win, capped
        this.MAX_SCALE_UP - 1.0
      );
      scalingMultiplier = 1.0 + scaleUpAmount;
    } else if (streakAnalysis.type === 'losing' && streakAnalysis.length >= this.LOSING_THRESHOLD) {
      // Progressive scale down for losing streak
      const scaleDownAmount = Math.min(
        streakAnalysis.length * 0.15, // 15% per loss (more aggressive reduction)
        1.0 - this.MAX_SCALE_DOWN
      );
      scalingMultiplier = 1.0 - scaleDownAmount;
    }

    // Apply confidence level modifier
    if (confidenceLevel === 'low') {
      scalingMultiplier *= 0.8; // Further reduce when confidence is low
    } else if (confidenceLevel === 'high') {
      scalingMultiplier *= 1.1; // Small boost when confidence is high
    }

    // Clamp to limits
    scalingMultiplier = Math.max(this.MAX_SCALE_DOWN, Math.min(this.MAX_SCALE_UP, scalingMultiplier));

    const adjustedRiskPercent = baseRiskPercent * scalingMultiplier;

    // Generate recommendations
    const recommendations: string[] = [];

    if (streakAnalysis.type === 'winning') {
      if (streakAnalysis.length >= 5) {
        recommendations.push(`🔥 ${streakAnalysis.length}-trade winning streak!`);
        recommendations.push('Scaling up risk - but stay disciplined');
        recommendations.push('Don\'t get overconfident - follow your rules');
      } else {
        recommendations.push(`✅ ${streakAnalysis.length}-trade winning streak`);
        recommendations.push('Good momentum - maintain consistency');
      }
    } else if (streakAnalysis.type === 'losing') {
      if (streakAnalysis.length >= 3) {
        recommendations.push(`⚠️ ${streakAnalysis.length}-trade losing streak`);
        recommendations.push('Scaling down risk for capital preservation');
        recommendations.push('Consider taking a break to reset');
        recommendations.push('Review recent trades for pattern issues');
      } else {
        recommendations.push(`⚠️ ${streakAnalysis.length} consecutive losses`);
        recommendations.push('Reducing risk temporarily');
        recommendations.push('Stay patient and stick to plan');
      }
    } else {
      recommendations.push('Mixed results - maintaining base risk');
      recommendations.push('Focus on consistency');
    }

    // Additional recommendations based on confidence
    if (confidenceLevel === 'high') {
      recommendations.push(`Confidence level: HIGH (${(winRate * 100).toFixed(0)}% WR)`);
      recommendations.push('Continue current approach');
    } else if (confidenceLevel === 'low') {
      recommendations.push(`Confidence level: LOW (${(winRate * 100).toFixed(0)}% WR)`);
      recommendations.push('Consider reviewing strategy');
    }

    // Generate reasoning (GOVERNANCE: Defensive null checks)
    const winRatePct = (winRate !== undefined && !isNaN(winRate)) ? (winRate * 100).toFixed(0) : '0';
    const scalingPct = (scalingMultiplier !== undefined && !isNaN(scalingMultiplier)) ? (scalingMultiplier * 100).toFixed(0) : '100';
    const baseRiskStr = (baseRiskPercent !== undefined && !isNaN(baseRiskPercent)) ? baseRiskPercent.toFixed(2) : '0.00';
    const adjRiskStr = (adjustedRiskPercent !== undefined && !isNaN(adjustedRiskPercent)) ? adjustedRiskPercent.toFixed(2) : '0.00';

    let reasoning = `Recent performance: ${wins}/${recentTrades.length} wins (${winRatePct}%). `;
    reasoning += `${streakAnalysis.type === 'winning' ? 'Winning' : streakAnalysis.type === 'losing' ? 'Losing' : 'Mixed'} streak of ${streakAnalysis.length}. `;
    reasoning += `Risk scaled ${scalingMultiplier > 1.0 ? 'UP' : scalingMultiplier < 1.0 ? 'DOWN' : 'MAINTAINED'} `;
    reasoning += `to ${scalingPct}% (${baseRiskStr}% → ${adjRiskStr}%). `;
    reasoning += `Confidence: ${confidenceLevel.toUpperCase()}.`;

    return {
      adjustedRiskPercent,
      scalingMultiplier,
      performanceStreak: streakAnalysis.type,
      streakLength: streakAnalysis.length,
      confidenceLevel,
      reasoning,
      recommendations
    };
  }

  private analyzeStreak(trades: Array<{ result: 'win' | 'loss' }>): {
    type: 'winning' | 'losing' | 'neutral';
    length: number;
  } {
    if (trades.length === 0) {
      return { type: 'neutral', length: 0 };
    }

    // Count consecutive wins/losses from most recent
    let streakLength = 1;
    const mostRecentResult = trades[0].result;

    for (let i = 1; i < trades.length; i++) {
      if (trades[i].result === mostRecentResult) {
        streakLength++;
      } else {
        break;
      }
    }

    return {
      type: mostRecentResult === 'win' ? 'winning' : 'losing',
      length: streakLength
    };
  }

  private async getRecentTrades(
    userId: string,
    goalSessionId: string | undefined,
    limit: number
  ): Promise<Array<{ result: 'win' | 'loss'; pnl: number }>> {
    try {
      let query = supabase
        .from('goal_session_trades')
        .select('status, close_reason, profit_loss')
        .eq('user_id', userId)
        .eq('status', 'closed')
        .not('profit_loss', 'is', null)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (goalSessionId) {
        query = query.eq('goal_session_id', goalSessionId);
      }

      const { data: trades, error } = await query;

      if (error || !trades) {
        return [];
      }

      return trades.map(t => ({
        result: (t.profit_loss || 0) > 0 ? 'win' : 'loss',
        pnl: t.profit_loss || 0
      }));
    } catch (error) {
      console.error('Error fetching recent trades:', error);
      return [];
    }
  }

  async logRiskScaling(
    userId: string,
    inputs: RiskScalingInputs,
    result: RiskScalingResult
  ): Promise<void> {
    try {
      await supabase.from('risk_scaling_log').insert({
        user_id: userId,
        goal_session_id: inputs.goalSessionId,
        base_risk_percent: inputs.baseRiskPercent,
        adjusted_risk_percent: result.adjustedRiskPercent,
        scaling_multiplier: result.scalingMultiplier,
        performance_streak: result.performanceStreak,
        streak_length: result.streakLength,
        confidence_level: result.confidenceLevel,
        reasoning: result.reasoning
      });
    } catch (error) {
      console.error('Error logging risk scaling:', error);
    }
  }

  getRecommendedLookback(totalTrades: number): number {
    // Adapt lookback period based on total trading history
    if (totalTrades < 20) return 5;
    if (totalTrades < 50) return 10;
    if (totalTrades < 100) return 15;
    return 20;
  }
}

export const progressiveRiskScaling = new ProgressiveRiskScaling();
