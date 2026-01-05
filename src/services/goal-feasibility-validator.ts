import { supabase } from '../lib/supabase';

export interface GoalFeasibilityInputs {
  currentBalance: number;
  targetProfit: number;
  timeframeHours: number;
  userId: string;
  riskPerTrade?: number; // Optional, default to 1%
}

export interface FeasibilityResult {
  feasible: boolean;
  difficulty: 'easy' | 'realistic' | 'challenging' | 'very-difficult' | 'unrealistic';
  requiredWinRate: number;
  requiredTrades: number;
  requiredPipsPerDay: number;
  estimatedSuccessRate: number; // Probability of achieving goal (0-1)
  reasoning: string;
  recommendations: string[];
  alternativeGoal?: {
    targetProfit: number;
    timeframeHours: number;
    reasoning: string;
  };
}

class GoalFeasibilityValidator {
  private readonly TRADING_HOURS_PER_DAY = 8; // Realistic active trading hours
  private readonly AVG_TRADES_PER_HOUR = 0.5; // Conservative estimate
  private readonly REALISTIC_WIN_RATE = 0.55; // 55% is achievable
  private readonly MAX_REALISTIC_WIN_RATE = 0.65; // 65% is excellent
  private readonly AVG_RR_RATIO = 2.0; // Average 2:1 RR
  private readonly MIN_RISK_PER_TRADE = 0.005; // 0.5%
  private readonly MAX_RISK_PER_TRADE = 0.02; // 2%

  async validateGoal(inputs: GoalFeasibilityInputs): Promise<FeasibilityResult> {
    const { currentBalance, targetProfit, timeframeHours, userId, riskPerTrade = 0.01 } = inputs;

    // Fetch user's historical performance
    const historicalStats = await this.getUserHistoricalStats(userId);

    // Calculate required return percentage
    const requiredReturnPct = (targetProfit / currentBalance) * 100;

    // Calculate available trading time
    const tradingDays = timeframeHours / 24;
    const availableTradingHours = tradingDays * this.TRADING_HOURS_PER_DAY;

    // Estimate number of trades possible
    const estimatedTradesAvailable = Math.floor(availableTradingHours * this.AVG_TRADES_PER_HOUR);

    // Calculate required win per trade
    const requiredProfitPerTrade = targetProfit / estimatedTradesAvailable;
    const requiredReturnPerTrade = (requiredProfitPerTrade / currentBalance) * 100;

    // Calculate what win rate would be needed with average RR
    // Formula: Required Return = (WinRate × RR × Risk) - (LossRate × Risk)
    // Solving for WinRate: WR = (Required Return + Risk) / (Risk × (RR + 1))
    const avgRisk = riskPerTrade * currentBalance;
    const requiredWinRate = (requiredReturnPerTrade + riskPerTrade * 100) / (riskPerTrade * 100 * (this.AVG_RR_RATIO + 1));

    // Calculate required pips per day (rough estimate)
    const requiredPipsPerDay = (targetProfit / currentBalance) * 100 / tradingDays;

    // Assess difficulty
    let difficulty: 'easy' | 'realistic' | 'challenging' | 'very-difficult' | 'unrealistic';
    let estimatedSuccessRate: number;

    if (requiredReturnPct <= 2 && requiredWinRate <= this.REALISTIC_WIN_RATE) {
      difficulty = 'easy';
      estimatedSuccessRate = 0.85;
    } else if (requiredReturnPct <= 5 && requiredWinRate <= this.MAX_REALISTIC_WIN_RATE) {
      difficulty = 'realistic';
      estimatedSuccessRate = 0.65;
    } else if (requiredReturnPct <= 10 && requiredWinRate <= 0.70) {
      difficulty = 'challenging';
      estimatedSuccessRate = 0.40;
    } else if (requiredReturnPct <= 20 && requiredWinRate <= 0.80) {
      difficulty = 'very-difficult';
      estimatedSuccessRate = 0.15;
    } else {
      difficulty = 'unrealistic';
      estimatedSuccessRate = 0.05;
    }

    // Account for user's historical performance
    if (historicalStats.totalTrades >= 10) {
      if (historicalStats.actualWinRate >= requiredWinRate) {
        estimatedSuccessRate *= 1.3; // Boost if user has proven track record
      } else {
        estimatedSuccessRate *= 0.7; // Reduce if user's performance is below requirement
      }
      estimatedSuccessRate = Math.min(0.95, estimatedSuccessRate); // Cap at 95%
    }

    // Determine if feasible
    const feasible = difficulty !== 'unrealistic' && estimatedSuccessRate >= 0.15;

    // Generate reasoning
    let reasoning = `Goal requires ${requiredReturnPct.toFixed(1)}% return over ${tradingDays.toFixed(1)} days. `;
    reasoning += `You'll need approximately ${estimatedTradesAvailable} trades `;
    reasoning += `with a ${(requiredWinRate * 100).toFixed(1)}% win rate (${(requiredPipsPerDay).toFixed(1)} pips/day). `;

    if (historicalStats.totalTrades >= 10) {
      reasoning += `Your historical win rate is ${(historicalStats.actualWinRate * 100).toFixed(1)}%. `;
    }

    reasoning += `Success probability: ${(estimatedSuccessRate * 100).toFixed(0)}%. `;

    // Generate recommendations
    const recommendations: string[] = [];

    if (!feasible) {
      recommendations.push('⚠️ This goal is unrealistic and likely to lead to over-trading or excessive risk-taking');
      recommendations.push(`Consider reducing target to $${(currentBalance * 0.05).toFixed(2)} (5% return)`);
      recommendations.push(`Or extend timeframe to ${(timeframeHours * 2).toFixed(0)} hours`);
    } else if (difficulty === 'very-difficult') {
      recommendations.push('⚠️ This goal is very difficult - proceed with caution');
      recommendations.push('Stick strictly to your trading plan');
      recommendations.push('Do not force trades to meet the goal');
      recommendations.push('Consider a more conservative target');
    } else if (difficulty === 'challenging') {
      recommendations.push('This goal is challenging but achievable');
      recommendations.push('Maintain disciplined risk management');
      recommendations.push('Focus on quality setups only');
      recommendations.push('Track progress daily');
    } else if (difficulty === 'realistic') {
      recommendations.push('This goal is realistic with good discipline');
      recommendations.push('Maintain your standard trading approach');
      recommendations.push('Stay patient for quality setups');
    } else {
      recommendations.push('This goal is easily achievable');
      recommendations.push('Maintain consistent execution');
      recommendations.push('Do not become complacent');
    }

    // Suggest alternative goal if current is unrealistic
    let alternativeGoal: FeasibilityResult['alternativeGoal'] | undefined;
    if (!feasible) {
      const realisticReturn = 0.05; // 5% is realistic
      const alternativeProfit = currentBalance * realisticReturn;
      alternativeGoal = {
        targetProfit: alternativeProfit,
        timeframeHours: timeframeHours,
        reasoning: `A 5% return over ${tradingDays.toFixed(1)} days is realistic and sustainable. This requires approximately ${(this.REALISTIC_WIN_RATE * 100).toFixed(0)}% win rate with ${estimatedTradesAvailable} trades.`
      };
    }

    return {
      feasible,
      difficulty,
      requiredWinRate,
      requiredTrades: estimatedTradesAvailable,
      requiredPipsPerDay,
      estimatedSuccessRate,
      reasoning,
      recommendations,
      alternativeGoal
    };
  }

  private async getUserHistoricalStats(userId: string): Promise<{
    actualWinRate: number;
    avgReturnPerTrade: number;
    totalTrades: number;
    avgPipsPerDay: number;
  }> {
    try {
      const { data: trades, error } = await supabase
        .from('goal_session_trades')
        .select('status, pnl, created_at')
        .eq('user_id', userId)
        .in('status', ['win', 'loss'])
        .limit(50)
        .order('created_at', { ascending: false });

      if (error || !trades || trades.length === 0) {
        return {
          actualWinRate: 0.50,
          avgReturnPerTrade: 0,
          totalTrades: 0,
          avgPipsPerDay: 0
        };
      }

      const wins = trades.filter(t => t.status === 'win').length;
      const actualWinRate = wins / trades.length;

      const totalPnL = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
      const avgReturnPerTrade = totalPnL / trades.length;

      // Calculate trading days span
      const firstTrade = new Date(trades[trades.length - 1].created_at);
      const lastTrade = new Date(trades[0].created_at);
      const daysDiff = (lastTrade.getTime() - firstTrade.getTime()) / (1000 * 60 * 60 * 24);
      const avgPipsPerDay = daysDiff > 0 ? (trades.length * 20) / daysDiff : 0; // Rough estimate

      return {
        actualWinRate,
        avgReturnPerTrade,
        totalTrades: trades.length,
        avgPipsPerDay
      };
    } catch (error) {
      console.error('Error fetching user historical stats:', error);
      return {
        actualWinRate: 0.50,
        avgReturnPerTrade: 0,
        totalTrades: 0,
        avgPipsPerDay: 0
      };
    }
  }

  async logFeasibilityCheck(
    userId: string,
    inputs: GoalFeasibilityInputs,
    result: FeasibilityResult
  ): Promise<void> {
    try {
      await supabase.from('goal_feasibility_log').insert({
        user_id: userId,
        current_balance: inputs.currentBalance,
        target_profit: inputs.targetProfit,
        timeframe_hours: inputs.timeframeHours,
        risk_per_trade: inputs.riskPerTrade || 0.01,
        feasible: result.feasible,
        difficulty: result.difficulty,
        required_win_rate: result.requiredWinRate,
        required_trades: result.requiredTrades,
        estimated_success_rate: result.estimatedSuccessRate,
        reasoning: result.reasoning
      });
    } catch (error) {
      console.error('Error logging feasibility check:', error);
    }
  }
}

export const goalFeasibilityValidator = new GoalFeasibilityValidator();
