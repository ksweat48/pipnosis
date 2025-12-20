import { supabase } from '../lib/supabase';

export interface WinRateRRInputs {
  currentWinRate: number; // 0-1
  currentAvgWin: number; // in pips
  currentAvgLoss: number; // in pips
  userId: string;
}

export interface WinRateRRResult {
  currentRR: number;
  requiredRR: number; // To break even at current win rate
  optimalRR: number; // For maximum profit
  optimalWinRate: number; // For current RR
  profitabilityScore: number; // 0-100
  recommendations: string[];
  reasoning: string;
  improvementSuggestions: {
    improveWinRate: { target: number; impact: string };
    improveRR: { target: number; impact: string };
    balanced: { winRate: number; rr: number; impact: string };
  };
}

class WinRateRROptimizer {
  private readonly MIN_PROFITABLE_RR = 1.5;
  private readonly OPTIMAL_WIN_RATE = 0.55; // 55% is realistic and profitable
  private readonly OPTIMAL_RR = 2.0; // 2:1 is the sweet spot

  optimizeWinRateRR(inputs: WinRateRRInputs): WinRateRRResult {
    const { currentWinRate, currentAvgWin, currentAvgLoss } = inputs;

    // Calculate current RR
    const currentRR = currentAvgWin / currentAvgLoss;

    // Calculate required RR to break even at current win rate
    // Breakeven: WinRate × AvgWin = LossRate × AvgLoss
    // RR = LossRate / WinRate
    const requiredRR = (1 - currentWinRate) / currentWinRate;

    // Calculate optimal RR for maximum profit
    // Using Kelly Criterion optimal: f* = (bp - q) / b
    // Solving for b (RR) that maximizes f*
    const optimalRR = this.OPTIMAL_RR;

    // Calculate optimal win rate for current RR
    // Solving: RR = (1 - WR) / WR for WR
    const optimalWinRate = 1 / (1 + currentRR);

    // Calculate profitability score (0-100)
    const expectedValue = (currentWinRate * currentAvgWin) - ((1 - currentWinRate) * currentAvgLoss);
    const maxPossibleEV = (this.OPTIMAL_WIN_RATE * currentAvgWin * this.OPTIMAL_RR) - ((1 - this.OPTIMAL_WIN_RATE) * currentAvgLoss);
    const profitabilityScore = Math.max(0, Math.min(100, (expectedValue / Math.max(0.01, maxPossibleEV)) * 100));

    // Generate improvement suggestions
    const improvementSuggestions = this.generateImprovementSuggestions(inputs, currentRR);

    // Generate recommendations
    const recommendations: string[] = [];

    if (currentRR < requiredRR) {
      recommendations.push('🛑 CRITICAL: Your RR is below breakeven level!');
      recommendations.push(`Increase RR to at least ${requiredRR.toFixed(2)}:1 or improve win rate to ${(1 / (1 + currentRR) * 100).toFixed(0)}%`);
      recommendations.push('You are losing money with current metrics');
    } else if (currentRR < this.MIN_PROFITABLE_RR) {
      recommendations.push('⚠️ WARNING: RR is below minimum profitable level');
      recommendations.push(`Target RR of at least ${this.MIN_PROFITABLE_RR}:1`);
    }

    if (currentWinRate < 0.40) {
      recommendations.push('⚠️ Win rate is very low');
      recommendations.push('Focus on trade quality over quantity');
      recommendations.push('Review entry criteria - may be entering too early');
    } else if (currentWinRate > 0.70) {
      recommendations.push('⚠️ Win rate seems unusually high');
      recommendations.push('You may be cutting winners too early');
      recommendations.push('Consider letting winners run more to improve RR');
    }

    // Optimal strategy recommendations
    if (profitabilityScore >= 80) {
      recommendations.push('✅ Excellent metrics - maintain current strategy');
    } else if (profitabilityScore >= 60) {
      recommendations.push('Good metrics - focus on consistency');
    } else if (profitabilityScore >= 40) {
      recommendations.push('Metrics need improvement - see suggestions below');
    } else {
      recommendations.push('🛑 Metrics are not profitable - immediate changes needed');
    }

    // Generate reasoning
    let reasoning = `Current: ${(currentWinRate * 100).toFixed(1)}% WR @ ${currentRR.toFixed(2)}:1 RR. `;
    reasoning += `Required RR for breakeven: ${requiredRR.toFixed(2)}:1. `;
    reasoning += `Profitability score: ${profitabilityScore.toFixed(0)}/100. `;

    if (currentRR >= requiredRR) {
      reasoning += `✅ Positive edge confirmed. `;
    } else {
      reasoning += `❌ Below breakeven - not profitable. `;
    }

    return {
      currentRR,
      requiredRR,
      optimalRR,
      optimalWinRate,
      profitabilityScore,
      recommendations,
      reasoning,
      improvementSuggestions
    };
  }

  private generateImprovementSuggestions(
    inputs: WinRateRRInputs,
    currentRR: number
  ): WinRateRRResult['improvementSuggestions'] {
    const { currentWinRate, currentAvgWin, currentAvgLoss } = inputs;

    // Option 1: Improve win rate to optimal, keep RR same
    const targetWinRate = this.OPTIMAL_WIN_RATE;
    const wrImprovement = ((targetWinRate - currentWinRate) / currentWinRate) * 100;
    const newEV1 = (targetWinRate * currentAvgWin) - ((1 - targetWinRate) * currentAvgLoss);

    // Option 2: Improve RR to optimal, keep win rate same
    const targetRR = this.OPTIMAL_RR;
    const newAvgWin = currentAvgLoss * targetRR;
    const rrImprovement = ((targetRR - currentRR) / currentRR) * 100;
    const newEV2 = (currentWinRate * newAvgWin) - ((1 - currentWinRate) * currentAvgLoss);

    // Option 3: Balanced approach
    const balancedWR = (currentWinRate + targetWinRate) / 2;
    const balancedRR = (currentRR + targetRR) / 2;
    const balancedAvgWin = currentAvgLoss * balancedRR;
    const newEV3 = (balancedWR * balancedAvgWin) - ((1 - balancedWR) * currentAvgLoss);

    return {
      improveWinRate: {
        target: targetWinRate,
        impact: `Improve WR by ${wrImprovement.toFixed(1)}% → EV = ${newEV1.toFixed(1)} pips/trade`
      },
      improveRR: {
        target: targetRR,
        impact: `Improve RR by ${rrImprovement.toFixed(1)}% → EV = ${newEV2.toFixed(1)} pips/trade`
      },
      balanced: {
        winRate: balancedWR,
        rr: balancedRR,
        impact: `Balanced improvement → EV = ${newEV3.toFixed(1)} pips/trade (Recommended)`
      }
    };
  }

  async logOptimization(
    userId: string,
    inputs: WinRateRRInputs,
    result: WinRateRRResult,
    goalSessionId?: string
  ): Promise<void> {
    try {
      await supabase.from('winrate_rr_optimization_log').insert({
        user_id: userId,
        goal_session_id: goalSessionId,
        current_win_rate: inputs.currentWinRate,
        current_avg_win: inputs.currentAvgWin,
        current_avg_loss: inputs.currentAvgLoss,
        current_rr: result.currentRR,
        required_rr: result.requiredRR,
        optimal_rr: result.optimalRR,
        profitability_score: result.profitabilityScore,
        reasoning: result.reasoning
      });
    } catch (error) {
      console.error('Error logging optimization:', error);
    }
  }

  calculateBreakevenWinRate(rr: number): number {
    // At breakeven: WR × RR = (1 - WR)
    // Solving for WR: WR = 1 / (1 + RR)
    return 1 / (1 + rr);
  }

  calculateBreakevenRR(winRate: number): number {
    // At breakeven: WR × RR = (1 - WR)
    // Solving for RR: RR = (1 - WR) / WR
    return (1 - winRate) / winRate;
  }

  getTradeQualityRating(winRate: number, rr: number): string {
    const ev = (winRate * rr) - (1 - winRate);

    if (ev < 0) return 'Losing';
    if (ev < 0.1) return 'Marginal';
    if (ev < 0.3) return 'Fair';
    if (ev < 0.5) return 'Good';
    if (ev < 0.8) return 'Very Good';
    return 'Excellent';
  }
}

export const winRateRROptimizer = new WinRateRROptimizer();
