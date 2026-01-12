import { supabase } from '../lib/supabase';
import { TRADE_CONSTRAINTS } from '../config/trade-constraints';

export interface KellyInputs {
  winRate: number; // 0-1 (e.g., 0.55 for 55%)
  avgWinPips: number;
  avgLossPips: number;
  currentBalance: number;
  symbol: string;
  userId: string;
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
      const minRiskAmount = currentBalance * 0.005; // 0.5% minimum risk
      const pipValue = this.getPipValue(symbol);
      const minLotSize = this.MIN_LOT_SIZE;

      return {
        optimalFraction: fullKelly <= 0 ? 0 : fullKelly,
        conservativeFraction: 0.005, // 0.5% minimum risk
        recommendedLotSize: minLotSize,
        riskAmount: minLotSize * avgLossPips * pipValue,
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

    // Convert to lot size (assuming $10 per pip for standard lot)
    // This will need adjustment based on symbol-specific pip values
    const pipValue = this.getPipValue(symbol);
    const recommendedLotSize = Math.max(0.01, riskAmount / (avgLossPips * pipValue));

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
      riskAmount: roundedLotSize * avgLossPips * pipValue,
      reasoning,
      kellyMultiplier: this.FRACTIONAL_KELLY,
      edgeStrength
    };
  }


  private getPipValue(symbol: string): number {
    // Standard pip values for common pairs (per standard lot)
    const pipValues: Record<string, number> = {
      'EURUSD': 10,
      'GBPUSD': 10,
      'USDJPY': 9.09, // Approximate for 110 rate
      'USDCHF': 10,
      'AUDUSD': 10,
      'NZDUSD': 10,
      'USDCAD': 7.69, // Approximate for 1.30 rate
      'XAUUSD': 10, // Gold
      'XAGUSD': 5,  // Silver
    };

    return pipValues[symbol] || 10; // Default to $10
  }

  async getHistoricalStats(userId: string, symbol?: string): Promise<{
    winRate: number;
    avgWinPips: number;
    avgLossPips: number;
    totalTrades: number;
  }> {
    try {
      // Query goal_session_trades for historical performance
      let query = supabase
        .from('goal_session_trades')
        .select('status, entry_price, exit_price, direction, stop_loss, take_profit')
        .eq('user_id', userId)
        .in('status', ['win', 'loss']);

      if (symbol) {
        query = query.eq('symbol', symbol);
      }

      const { data: trades, error } = await query.limit(100).order('created_at', { ascending: false });

      if (error || !trades || trades.length < 10) {
        // Not enough data, return conservative defaults
        return {
          winRate: 0.45, // Conservative default
          avgWinPips: 20,
          avgLossPips: 15,
          totalTrades: 0
        };
      }

      // Calculate statistics
      const wins = trades.filter(t => t.status === 'win');
      const losses = trades.filter(t => t.status === 'loss');

      const winRate = wins.length / trades.length;

      // Calculate average win/loss in pips
      // ✅ SSOT FIX: Use calculatePipDistance() instead of hardcoded * 10000
      const { calculatePipDistance } = await import('../utils/currencyHelpers');

      const avgWinPips = wins.reduce((sum, t) => {
        if (!t.symbol || !t.entry_price || !t.exit_price) return sum;
        const pips = calculatePipDistance(t.symbol, t.entry_price, t.exit_price);
        return sum + pips;
      }, 0) / (wins.length || 1);

      const avgLossPips = losses.reduce((sum, t) => {
        if (!t.symbol || !t.entry_price || !t.exit_price) return sum;
        const pips = calculatePipDistance(t.symbol, t.entry_price, t.exit_price);
        return sum + pips;
      }, 0) / (losses.length || 1);

      return {
        winRate: Math.max(0.35, Math.min(0.75, winRate)), // Clamp between 35-75%
        avgWinPips: Math.max(10, avgWinPips), // Minimum 10 pips
        avgLossPips: Math.max(10, avgLossPips),
        totalTrades: trades.length
      };
    } catch (error) {
      console.error('Error fetching historical stats:', error);
      // Return conservative defaults
      return {
        winRate: 0.45,
        avgWinPips: 20,
        avgLossPips: 15,
        totalTrades: 0
      };
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
