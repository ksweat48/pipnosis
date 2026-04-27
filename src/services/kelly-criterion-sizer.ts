import { supabase } from '../lib/supabase';
import { TRADE_CONSTRAINTS } from '../config/trade-constraints';
import { TRADING_CONSTANTS } from '../config/trading-constants';
import { calculateDollarPerPip, calculatePipDistance } from '../utils/currencyHelpers';

// CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
export type KellyTradeStyle = 'MICRO_INTRADAY';

export interface KellyInputs {
  winRate: number; // 0-1 (e.g., 0.55 for 55%)
  avgWinPips: number;
  avgLossPips: number;
  currentBalance: number;
  symbol: string;
  userId: string;
  tradeStyle?: KellyTradeStyle;
}

export interface KellySizingResult {
  optimalFraction: number; // Full Kelly fraction
  conservativeFraction: number; // Fractional Kelly (25%)
  recommendedLotSize: number;
  riskAmount: number;
  reasoning: string;
  kellyMultiplier: number; // How many times Kelly we're using
  edgeStrength: 'negative' | 'weak' | 'moderate' | 'strong';
  advisory?: {
    level: 'INFO' | 'WARNING' | 'CRITICAL';
    message: string;
    suggestion: string;
  };
}

class KellyCriterionSizer {
  // Pull constants from centralized config
  private readonly FRACTIONAL_KELLY = TRADE_CONSTRAINTS.positionSizing.kelly.fractionalMultiplier;
  private readonly MIN_WIN_RATE_ADVISORY = TRADE_CONSTRAINTS.positionSizing.kelly.minWinRateAdvisory;
  private readonly MIN_EDGE_ADVISORY = TRADE_CONSTRAINTS.positionSizing.kelly.minEdgeAdvisory;
  private readonly MAX_RISK_PER_TRADE = TRADE_CONSTRAINTS.positionSizing.kelly.maxRiskCap;
  private readonly MIN_LOT_SIZE = TRADE_CONSTRAINTS.positionSizing.kelly.minLotSize;

  calculateOptimalSize(inputs: KellyInputs): KellySizingResult {
    const { winRate, avgWinPips, avgLossPips, currentBalance, symbol, userId } = inputs;

    // Calculate odds (reward-to-risk ratio)
    const rewardRiskRatio = avgWinPips / avgLossPips;

    // Kelly formula: f* = (bp - q) / b
    // Where b = odds, p = win probability, q = loss probability
    const p = winRate;
    const q = 1 - winRate;
    const b = rewardRiskRatio;

    // Calculate edge (expected value per trade)
    const edge = (p * avgWinPips) - (q * avgLossPips);
    const edgePercent = edge / avgLossPips;

    // Full Kelly fraction
    let fullKelly = (b * p - q) / b;

    // Classify edge strength
    let edgeStrength: 'negative' | 'weak' | 'moderate' | 'strong';
    if (edgePercent < 0) {
      edgeStrength = 'negative';
    } else if (edgePercent < 0.10) {
      edgeStrength = 'weak';
    } else if (edgePercent < 0.25) {
      edgeStrength = 'moderate';
    } else {
      edgeStrength = 'strong';
    }

    // ADVISORY checks (no longer block trades)
    let advisory: KellySizingResult['advisory'] | undefined;

    if (winRate < this.MIN_WIN_RATE_ADVISORY) {
      advisory = {
        level: 'WARNING',
        message: `Win rate ${(winRate * 100).toFixed(1)}% below professional standard ${(this.MIN_WIN_RATE_ADVISORY * 100).toFixed(0)}%`,
        suggestion: 'Use minimum sizing or paper trade until consistency improves'
      };
    } else if (fullKelly <= 0 || edgePercent < this.MIN_EDGE_ADVISORY) {
      advisory = {
        level: 'CRITICAL',
        message: `Kelly criterion indicates negative or minimal edge. Edge: ${(edgePercent * 100).toFixed(2)}%`,
        suggestion: 'Strongly consider NO_TRADE or reduce to minimum lot size'
      };
    }

    // If advisory triggered, use minimum lot size instead of zero
    if (advisory) {
      // PHASE 2: Use SSOT constant for minimum risk (already imported at top)
      const minRiskAmount = currentBalance * TRADING_CONSTANTS.RISK_PERCENTAGES.MIN_PER_TRADE; // 0.01 (1%)
      const dollarPerPipAt1Lot = calculateDollarPerPip(symbol, 1.0);
      const minLotSize = this.MIN_LOT_SIZE;

      return {
        optimalFraction: fullKelly <= 0 ? 0 : fullKelly,
        conservativeFraction: 0.005, // 0.5% minimum risk
        recommendedLotSize: minLotSize,
        riskAmount: minLotSize * avgLossPips * dollarPerPipAt1Lot,
        reasoning: `⚠️ ADVISORY: ${advisory.message}. Using minimum lot size ${minLotSize}. RR: ${rewardRiskRatio.toFixed(2)}:1. Win rate: ${(winRate * 100).toFixed(1)}%. ${advisory.suggestion}`,
        kellyMultiplier: this.FRACTIONAL_KELLY,
        edgeStrength,
        advisory
      };
    }

    // Apply fractional Kelly for safety
    const conservativeFraction = Math.max(0, fullKelly * this.FRACTIONAL_KELLY);

    // Apply maximum risk cap
    const cappedFraction = Math.min(conservativeFraction, this.MAX_RISK_PER_TRADE);

    // Calculate risk amount
    const riskAmount = currentBalance * cappedFraction;

    // Convert to lot size using SSOT dollar-per-pip calculation
    const dollarPerPipAt1Lot = calculateDollarPerPip(symbol, 1.0);
    const recommendedLotSize = Math.max(0.01, riskAmount / (avgLossPips * dollarPerPipAt1Lot));

    // Round to nearest 0.01 lot
    const roundedLotSize = Math.round(recommendedLotSize * 100) / 100;

    // Generate reasoning
    let reasoning = `Kelly suggests ${(fullKelly * 100).toFixed(1)}% of balance. `;
    reasoning += `Using fractional Kelly (${this.FRACTIONAL_KELLY * 100}%) = ${(conservativeFraction * 100).toFixed(1)}%. `;

    if (conservativeFraction !== cappedFraction) {
      reasoning += `Capped at ${(this.MAX_RISK_PER_TRADE * 100)}% max risk. `;
    }

    reasoning += `Edge: ${(edgePercent * 100).toFixed(2)}% (${edgeStrength}). `;
    reasoning += `RR: ${rewardRiskRatio.toFixed(2)}:1. Win rate: ${(winRate * 100).toFixed(1)}%.`;

    return {
      optimalFraction: fullKelly,
      conservativeFraction: cappedFraction,
      recommendedLotSize: roundedLotSize,
      riskAmount: roundedLotSize * avgLossPips * dollarPerPipAt1Lot,
      reasoning,
      kellyMultiplier: this.FRACTIONAL_KELLY,
      edgeStrength
    };
  }

  async getHistoricalStats(userId: string, symbol?: string, tradeStyle?: KellyTradeStyle): Promise<{
    winRate: number;
    avgWinPips: number;
    avgLossPips: number;
    totalTrades: number;
    styleSymbolBreakdown?: {
      style: string;
      symbol: string;
      winRate: number;
      avgWinPips: number;
      avgLossPips: number;
      evPerTrade: number;
      trades: number;
    };
  }> {
    const CONSERVATIVE_DEFAULTS = {
      winRate: 0.45,
      avgWinPips: 20,
      avgLossPips: 15,
      totalTrades: 0
    };

    try {
      let query = supabase
        .from('goal_session_trades')
        .select('symbol, entry_price, exit_price, direction, stop_loss, take_profit, current_pnl, resolved_style')
        .eq('user_id', userId)
        .eq('status', 'closed')
        .not('exit_price', 'is', null)
        .not('current_pnl', 'is', null);

      if (tradeStyle) {
        query = query.eq('resolved_style', tradeStyle);
      }

      if (symbol) {
        query = query.eq('symbol', symbol);
      }

      const { data: trades, error } = await query.limit(100).order('created_at', { ascending: false });

      if (error || !trades || trades.length < 5) {
        if (tradeStyle && !symbol) {
          return this.getHistoricalStats(userId);
        }
        if (tradeStyle && symbol) {
          return this.getHistoricalStats(userId, undefined, tradeStyle);
        }
        return CONSERVATIVE_DEFAULTS;
      }

      const wins = trades.filter(t => Number(t.current_pnl) > 0);
      const losses = trades.filter(t => Number(t.current_pnl) <= 0);

      const winRate = wins.length / trades.length;

      const avgWinPips = wins.length > 0
        ? wins.reduce((sum, t) => {
            if (!t.symbol || !t.entry_price || !t.exit_price) return sum;
            return sum + calculatePipDistance(t.symbol, Number(t.entry_price), Number(t.exit_price));
          }, 0) / wins.length
        : 20;

      const avgLossPips = losses.length > 0
        ? losses.reduce((sum, t) => {
            if (!t.symbol || !t.entry_price || !t.exit_price) return sum;
            return sum + calculatePipDistance(t.symbol, Number(t.entry_price), Number(t.exit_price));
          }, 0) / losses.length
        : 15;

      const evPerTrade = (winRate * avgWinPips) - ((1 - winRate) * avgLossPips);

      const result = {
        winRate: Math.max(0.15, Math.min(0.85, winRate)),
        avgWinPips: Math.max(5, avgWinPips),
        avgLossPips: Math.max(5, avgLossPips),
        totalTrades: trades.length,
        styleSymbolBreakdown: (tradeStyle || symbol) ? {
          style: tradeStyle || 'ALL',
          symbol: symbol || 'ALL',
          winRate,
          avgWinPips,
          avgLossPips,
          evPerTrade,
          trades: trades.length
        } : undefined
      };

      return result;
    } catch (error) {
      console.error('Error fetching historical stats:', error);
      return CONSERVATIVE_DEFAULTS;
    }
  }

  async logKellyDecision(
    userId: string,
    symbol: string,
    inputs: KellyInputs,
    result: KellySizingResult,
    goalSessionId?: string
  ): Promise<void> {
    try {
      await supabase.from('kelly_sizing_log').insert({
        user_id: userId,
        goal_session_id: goalSessionId,
        symbol,
        trade_style: inputs.tradeStyle || null,
        win_rate: inputs.winRate,
        avg_win_pips: inputs.avgWinPips,
        avg_loss_pips: inputs.avgLossPips,
        full_kelly_fraction: result.optimalFraction,
        fractional_kelly_fraction: result.conservativeFraction,
        recommended_lot_size: result.recommendedLotSize,
        risk_amount: result.riskAmount,
        edge_strength: result.edgeStrength,
        reasoning: result.reasoning,
        current_balance: inputs.currentBalance
      });
    } catch (error) {
      console.error('Error logging Kelly decision:', error);
    }
  }
}

export const kellyCriterionSizer = new KellyCriterionSizer();
