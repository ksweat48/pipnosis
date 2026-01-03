import { supabase } from '../lib/supabase';
import { TRADE_CONSTRAINTS } from '../config/trade-constraints';

export interface EVGateInputs {
  winRate: number; // 0-1
  avgWinPips: number;
  avgLossPips: number;
  proposedLotSize: number;
  symbol: string;
  userId: string;
  marketCondition?: 'trending' | 'ranging' | 'volatile' | 'normal';
  sessionQuality?: 'london' | 'newyork' | 'overlap' | 'asian' | 'off-hours';
}

export interface EVGateResult {
  approved: boolean; // Now ALWAYS true (advisory mode)
  expectedValue: number; // In pips per trade
  expectedValueMoney: number; // In account currency
  confidenceLevel: 'high' | 'medium' | 'low' | 'very-low';
  minimumWinRateNeeded: number; // Given current RR
  reasoning: string;
  recommendations: string[];
}

class EVGatingSystem {
  // Pull constants from centralized config
  private readonly MIN_EV_THRESHOLD = TRADE_CONSTRAINTS.positionSizing.expectedValue.threshold; // 0 = breakeven (advisory)
  private readonly MIN_EV_COMFORTABLE = TRADE_CONSTRAINTS.positionSizing.expectedValue.minComfortable; // 5 pips
  private readonly MIN_EV_EXCELLENT = TRADE_CONSTRAINTS.positionSizing.expectedValue.minExcellent; // 10 pips

  evaluateTrade(inputs: EVGateInputs): EVGateResult {
    const { winRate, avgWinPips, avgLossPips, proposedLotSize, symbol, marketCondition, sessionQuality } = inputs;

    // Calculate base Expected Value (EV)
    // EV = (Win% × Avg Win) - (Loss% × Avg Loss)
    const lossRate = 1 - winRate;
    const baseEV = (winRate * avgWinPips) - (lossRate * avgLossPips);

    // Apply market condition adjustments
    let adjustedEV = baseEV;
    const adjustments: string[] = [];

    if (marketCondition === 'volatile') {
      adjustedEV *= 0.85; // Reduce EV expectation in volatile markets
      adjustments.push('Volatile market (-15% EV)');
    } else if (marketCondition === 'trending') {
      adjustedEV *= 1.10; // Increase EV in trending markets
      adjustments.push('Trending market (+10% EV)');
    } else if (marketCondition === 'ranging') {
      adjustedEV *= 0.90; // Slightly reduce in ranging markets
      adjustments.push('Ranging market (-10% EV)');
    }

    // Apply session quality adjustments
    if (sessionQuality === 'overlap') {
      adjustedEV *= 1.05; // Best liquidity
      adjustments.push('Session overlap (+5% EV)');
    } else if (sessionQuality === 'off-hours') {
      adjustedEV *= 0.80; // Worst liquidity
      adjustments.push('Off-hours trading (-20% EV)');
    } else if (sessionQuality === 'asian') {
      adjustedEV *= 0.85; // Lower volatility
      adjustments.push('Asian session (-15% EV)');
    }

    // Calculate in money terms
    const pipValue = this.getPipValue(symbol);
    const evInMoney = adjustedEV * pipValue * proposedLotSize;

    // Calculate minimum win rate needed for breakeven
    const rewardRiskRatio = avgWinPips / avgLossPips;
    const minWinRateNeeded = 1 / (1 + rewardRiskRatio);

    // Determine confidence level
    let confidenceLevel: 'high' | 'medium' | 'low' | 'very-low';
    if (adjustedEV >= this.MIN_EV_EXCELLENT) {
      confidenceLevel = 'high';
    } else if (adjustedEV >= this.MIN_EV_COMFORTABLE) {
      confidenceLevel = 'medium';
    } else if (adjustedEV > this.MIN_EV_THRESHOLD) {
      confidenceLevel = 'low';
    } else {
      confidenceLevel = 'very-low';
    }

    // ADVISORY MODE: Always approve, but provide strong warnings for negative EV
    const approved = true; // ALWAYS true - Alpha has final authority

    // Generate reasoning
    let reasoning = '';
    if (adjustedEV > this.MIN_EV_THRESHOLD) {
      // Positive EV
      reasoning = `✅ Positive EV of ${adjustedEV.toFixed(2)} pips per trade. `;
      if (adjustedEV >= this.MIN_EV_EXCELLENT) {
        reasoning += 'Excellent trade opportunity! ';
      } else if (adjustedEV >= this.MIN_EV_COMFORTABLE) {
        reasoning += 'Good trade opportunity. ';
      } else {
        reasoning += 'Marginal EV - proceed with caution. ';
      }
    } else {
      // Negative or zero EV - CRITICAL ADVISORY
      reasoning = `⚠️ ADVISORY: Negative EV of ${adjustedEV.toFixed(2)} pips per trade. `;
      reasoning += `This trade is expected to lose money over time. Strongly consider NO_TRADE unless high-confidence setup justifies override. `;
    }

    reasoning += `Win rate: ${(winRate * 100).toFixed(1)}% (need ${(minWinRateNeeded * 100).toFixed(1)}% to break even). `;
    reasoning += `RR: ${rewardRiskRatio.toFixed(2)}:1. `;

    // Generate recommendations
    const recommendations: string[] = [];

    if (adjustedEV <= this.MIN_EV_THRESHOLD) {
      // Negative EV - critical advisory
      recommendations.push(`⚠️ CRITICAL: Negative expected value`);
      recommendations.push(`Increase win rate to at least ${(minWinRateNeeded * 100).toFixed(0)}%`);
      recommendations.push(`Improve RR ratio to at least ${(1 / winRate - 1).toFixed(2)}:1`);
      recommendations.push('Strongly recommend waiting for better setup with clearer edge');
      recommendations.push('If proceeding, use minimum lot size');
    } else if (confidenceLevel === 'low') {
      recommendations.push('Consider waiting for higher EV setup');
      recommendations.push('Reduce position size due to marginal edge');
      recommendations.push('Set tight stop-loss to limit risk');
    } else if (confidenceLevel === 'medium') {
      recommendations.push('Standard position sizing appropriate');
      recommendations.push('Monitor trade closely');
    } else {
      recommendations.push('Strong setup - full position size acceptable');
      recommendations.push('Consider scaling in if opportunity allows');
    }

    if (adjustments.length > 0) {
      recommendations.push(`Adjustments applied: ${adjustments.join(', ')}`);
    }

    return {
      approved,
      expectedValue: adjustedEV,
      expectedValueMoney: evInMoney,
      confidenceLevel,
      minimumWinRateNeeded,
      reasoning,
      recommendations
    };
  }

  private getPipValue(symbol: string): number {
    const pipValues: Record<string, number> = {
      'EURUSD': 10,
      'GBPUSD': 10,
      'USDJPY': 9.09,
      'USDCHF': 10,
      'AUDUSD': 10,
      'NZDUSD': 10,
      'USDCAD': 7.69,
      'XAUUSD': 10,
      'XAGUSD': 5,
    };
    return pipValues[symbol] || 10;
  }

  calculateBreakevenMetrics(winRate: number, avgWinPips: number, avgLossPips: number): {
    currentRR: number;
    neededRR: number;
    surplusDeficit: number;
    rrSufficient: boolean;
  } {
    const currentRR = avgWinPips / avgLossPips;
    const neededRR = (1 - winRate) / winRate;
    const surplusDeficit = currentRR - neededRR;

    return {
      currentRR,
      neededRR,
      surplusDeficit,
      rrSufficient: surplusDeficit > 0
    };
  }

  async logEVDecision(
    userId: string,
    symbol: string,
    inputs: EVGateInputs,
    result: EVGateResult,
    goalSessionId?: string
  ): Promise<void> {
    try {
      await supabase.from('ev_gate_log').insert({
        user_id: userId,
        goal_session_id: goalSessionId,
        symbol,
        win_rate: inputs.winRate,
        avg_win_pips: inputs.avgWinPips,
        avg_loss_pips: inputs.avgLossPips,
        proposed_lot_size: inputs.proposedLotSize,
        market_condition: inputs.marketCondition,
        session_quality: inputs.sessionQuality,
        expected_value_pips: result.expectedValue,
        expected_value_money: result.expectedValueMoney,
        approved: result.approved,
        confidence_level: result.confidenceLevel,
        reasoning: result.reasoning,
        recommendations: result.recommendations
      });
    } catch (error) {
      console.error('Error logging EV decision:', error);
    }
  }

  async getRecentEVPerformance(userId: string, days: number = 30): Promise<{
    avgEV: number;
    approvalRate: number;
    actualVsExpectedEV: number;
    totalTrades: number;
  }> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const { data: logs, error } = await supabase
        .from('ev_gate_log')
        .select('expected_value_pips, approved')
        .eq('user_id', userId)
        .gte('created_at', cutoffDate.toISOString())
        .order('created_at', { ascending: false });

      if (error || !logs || logs.length === 0) {
        return {
          avgEV: 0,
          approvalRate: 0,
          actualVsExpectedEV: 0,
          totalTrades: 0
        };
      }

      const avgEV = logs.reduce((sum, log) => sum + log.expected_value_pips, 0) / logs.length;
      const approvalRate = logs.filter(log => log.approved).length / logs.length;

      return {
        avgEV,
        approvalRate,
        actualVsExpectedEV: 1.0, // Would need actual trade results to calculate
        totalTrades: logs.length
      };
    } catch (error) {
      console.error('Error fetching EV performance:', error);
      return {
        avgEV: 0,
        approvalRate: 0,
        actualVsExpectedEV: 0,
        totalTrades: 0
      };
    }
  }
}

export const evGatingSystem = new EVGatingSystem();
