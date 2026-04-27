import { supabase } from '../lib/supabase';
import { TRADE_CONSTRAINTS } from '../config/trade-constraints';
import { calculateDollarPerPip } from '../utils/currencyHelpers';

// CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
export type EVTradeStyle = 'MICRO_INTRADAY';

export interface SymbolEdgeData {
  style: string;
  symbol: string;
  winRate: number;
  avgWinPips: number;
  avgLossPips: number;
  evPerTrade: number;
  trades: number;
}

export interface EVGateInputs {
  winRate: number;
  avgWinPips: number;
  avgLossPips: number;
  proposedLotSize: number;
  symbol: string;
  userId: string;
  marketCondition?: 'trending' | 'ranging' | 'volatile' | 'normal';
  sessionQuality?: 'london' | 'newyork' | 'overlap' | 'asian' | 'off-hours';
  tradeStyle?: EVTradeStyle;
  stopLossPips?: number;
  symbolEdge?: SymbolEdgeData;
}

export interface EVGateResult {
  approved: boolean;
  expectedValue: number;
  expectedValueMoney: number;
  confidenceLevel: 'high' | 'medium' | 'low' | 'very-low';
  minimumWinRateNeeded: number;
  reasoning: string;
  recommendations: string[];
  symbolEdgeSummary?: string;
}

class EVGatingSystem {
  private getStyleThresholds(tradeStyle?: EVTradeStyle, slPips?: number) {
    // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
    void tradeStyle;
    const style: EVTradeStyle = 'MICRO_INTRADAY';
    const config = TRADE_CONSTRAINTS.positionSizing.expectedValue;
    const styleConfig = config.styleThresholds[style] || config.styleThresholds['MICRO_INTRADAY'];
    const sl = slPips && slPips > 0 ? slPips : 1;

    return {
      minimumEV: sl * styleConfig.minimumEvPercent,
      comfortableEV: sl * styleConfig.comfortableEvPercent,
      excellentEV: sl * styleConfig.excellentEvPercent
    };
  }

  evaluateTrade(inputs: EVGateInputs): EVGateResult {
    const { winRate, avgWinPips, avgLossPips, proposedLotSize, symbol, marketCondition, sessionQuality, tradeStyle, stopLossPips, symbolEdge } = inputs;

    const lossRate = 1 - winRate;
    const baseEV = (winRate * avgWinPips) - (lossRate * avgLossPips);

    let adjustedEV = baseEV;
    const adjustments: string[] = [];

    if (marketCondition === 'volatile') {
      adjustedEV *= 0.85;
      adjustments.push('Volatile market (-15% EV)');
    } else if (marketCondition === 'trending') {
      adjustedEV *= 1.10;
      adjustments.push('Trending market (+10% EV)');
    } else if (marketCondition === 'ranging') {
      adjustedEV *= 0.90;
      adjustments.push('Ranging market (-10% EV)');
    }

    if (sessionQuality === 'overlap') {
      adjustedEV *= 1.05;
      adjustments.push('Session overlap (+5% EV)');
    } else if (sessionQuality === 'off-hours') {
      adjustedEV *= 0.80;
      adjustments.push('Off-hours trading (-20% EV)');
    } else if (sessionQuality === 'asian') {
      adjustedEV *= 0.85;
      adjustments.push('Asian session (-15% EV)');
    }

    const dollarPerPipAt1Lot = calculateDollarPerPip(symbol, 1.0);
    const evInMoney = adjustedEV * dollarPerPipAt1Lot * proposedLotSize;

    const rewardRiskRatio = avgWinPips / avgLossPips;
    const minWinRateNeeded = 1 / (1 + rewardRiskRatio);

    const thresholds = this.getStyleThresholds(tradeStyle, stopLossPips || avgLossPips);

    let confidenceLevel: 'high' | 'medium' | 'low' | 'very-low';
    if (adjustedEV >= thresholds.excellentEV) {
      confidenceLevel = 'high';
    } else if (adjustedEV >= thresholds.comfortableEV) {
      confidenceLevel = 'medium';
    } else if (adjustedEV > thresholds.minimumEV) {
      confidenceLevel = 'low';
    } else {
      confidenceLevel = 'very-low';
    }

    const approved = adjustedEV >= thresholds.minimumEV;

    let reasoning = '';
    if (approved && adjustedEV > 0) {
      const evAsPercentOfSL = stopLossPips && stopLossPips > 0
        ? ((adjustedEV / stopLossPips) * 100).toFixed(1)
        : 'N/A';
      reasoning = `EV: +${adjustedEV.toFixed(2)} pips (${evAsPercentOfSL}% of SL). `;
      if (confidenceLevel === 'high') {
        reasoning += 'Excellent edge. ';
      } else if (confidenceLevel === 'medium') {
        reasoning += 'Good edge. ';
      } else {
        reasoning += 'Marginal edge - proceed with caution. ';
      }
    } else if (!approved) {
      const neededRR = ((1 - winRate) / winRate);
      reasoning = `BLOCKED: EV ${adjustedEV.toFixed(2)} pips is below minimum ${thresholds.minimumEV.toFixed(2)} pips (3% of SL). `;
      reasoning += `Your ${tradeStyle || 'MICRO_INTRADAY'} win rate of ${(winRate * 100).toFixed(1)}% needs RR >= ${neededRR.toFixed(2)}:1 to break even. Current RR: ${rewardRiskRatio.toFixed(2)}:1. `;
      reasoning += `Adjust TP or SL to bring EV above ${thresholds.minimumEV.toFixed(2)} pips. `;
    } else {
      reasoning = `EV: ${adjustedEV.toFixed(2)} pips (near breakeven). `;
    }

    reasoning += `Win rate: ${(winRate * 100).toFixed(1)}% (need ${(minWinRateNeeded * 100).toFixed(1)}% to break even). `;
    reasoning += `RR: ${rewardRiskRatio.toFixed(2)}:1. `;

    let symbolEdgeSummary: string | undefined;
    if (symbolEdge && symbolEdge.trades >= 5) {
      const edgeLabel = symbolEdge.evPerTrade >= 0 ? '+' : '';
      symbolEdgeSummary = `${symbolEdge.style} on ${symbolEdge.symbol}: ${(symbolEdge.winRate * 100).toFixed(1)}% WR, ${edgeLabel}${symbolEdge.evPerTrade.toFixed(2)} pips/trade (${symbolEdge.trades} trades)`;
      reasoning += symbolEdgeSummary + '. ';
    }

    const recommendations: string[] = [];

    if (!approved) {
      recommendations.push(`BLOCKED: EV below 3% of SL minimum threshold`);
      recommendations.push(`Need win rate >= ${(minWinRateNeeded * 100).toFixed(0)}% OR RR >= ${((1 - winRate) / winRate).toFixed(2)}:1`);
      recommendations.push('Widen TP or tighten SL to improve edge');
    } else if (confidenceLevel === 'very-low') {
      recommendations.push('Near-zero edge - strongly consider waiting for better setup');
      recommendations.push('Use minimum lot size if proceeding');
    } else if (confidenceLevel === 'low') {
      recommendations.push('Thin edge - consider reduced position size');
    } else if (confidenceLevel === 'medium') {
      recommendations.push('Standard position sizing appropriate');
    } else {
      recommendations.push('Strong edge - full position size acceptable');
    }

    if (adjustments.length > 0) {
      recommendations.push(`Adjustments: ${adjustments.join(', ')}`);
    }

    return {
      approved,
      expectedValue: adjustedEV,
      expectedValueMoney: evInMoney,
      confidenceLevel,
      minimumWinRateNeeded: minWinRateNeeded,
      reasoning,
      recommendations,
      symbolEdgeSummary
    };
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
        trade_style: inputs.tradeStyle || null,
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
