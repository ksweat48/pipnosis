import { supabase } from '../lib/supabase';

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
}

class KellyCriterionSizer {
  private readonly FRACTIONAL_KELLY = 0.25; // Use 25% of Kelly for safety
  private readonly MIN_WIN_RATE = 0.35; // Minimum win rate to trade
  private readonly MIN_EDGE = 0.01; // Minimum edge (1%)
  private readonly MAX_RISK_PER_TRADE = 0.05; // UPDATED: Max 5% for aggressive mode (was 2%)

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

    // Safety checks
    if (winRate < this.MIN_WIN_RATE) {
      return this.rejectTrade(
        'Win rate too low',
        `Win rate of ${(winRate * 100).toFixed(1)}% is below minimum ${(this.MIN_WIN_RATE * 100).toFixed(0)}%`,
        edgeStrength
      );
    }

    if (fullKelly <= 0 || edgePercent < this.MIN_EDGE) {
      return this.rejectTrade(
        'No positive edge',
        `Kelly criterion indicates no edge. Edge: ${(edgePercent * 100).toFixed(2)}%`,
        edgeStrength
      );
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

  private rejectTrade(reason: string, details: string, edgeStrength: 'negative' | 'weak' | 'moderate' | 'strong'): KellySizingResult {
    return {
      optimalFraction: 0,
      conservativeFraction: 0,
      recommendedLotSize: 0,
      riskAmount: 0,
      reasoning: `❌ TRADE REJECTED: ${reason}. ${details}`,
      kellyMultiplier: 0,
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
      // Query goal_trades for historical performance
      let query = supabase
        .from('goal_trades')
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
      const avgWinPips = wins.reduce((sum, t) => {
        const pips = Math.abs(t.exit_price - t.entry_price) * 10000; // Approximate pip conversion
        return sum + pips;
      }, 0) / (wins.length || 1);

      const avgLossPips = losses.reduce((sum, t) => {
        const pips = Math.abs(t.exit_price - t.entry_price) * 10000;
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
