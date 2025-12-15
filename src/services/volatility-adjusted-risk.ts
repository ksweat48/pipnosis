import { supabase } from '../lib/supabase';

export interface VolatilityRiskInputs {
  symbol: string;
  baseRiskPercent: number; // Base risk percentage (e.g., 1%)
  currentATR: number; // Current ATR in pips
  userId: string;
}

export interface VolatilityRiskResult {
  adjustedRiskPercent: number;
  riskMultiplier: number; // How much we adjusted from base
  volatilityState: 'very-low' | 'low' | 'normal' | 'high' | 'very-high';
  recommendedStopLoss: number; // In pips
  reasoning: string;
  warnings: string[];
}

class VolatilityAdjustedRisk {
  private readonly ATR_PERIOD = 14; // Standard ATR period
  private readonly VOLATILITY_LOOKBACK_DAYS = 30;

  // Volatility thresholds (in pips for major pairs)
  private readonly VOLATILITY_THRESHOLDS = {
    'EURUSD': { veryLow: 30, low: 50, normal: 70, high: 100, veryHigh: 150 },
    'GBPUSD': { veryLow: 40, low: 70, normal: 100, high: 150, veryHigh: 200 },
    'USDJPY': { veryLow: 30, low: 50, normal: 70, high: 100, veryHigh: 150 },
    'XAUUSD': { veryLow: 200, low: 400, normal: 800, high: 1500, veryHigh: 2500 },
    'DEFAULT': { veryLow: 30, low: 50, normal: 70, high: 100, veryHigh: 150 }
  };

  async adjustRiskForVolatility(inputs: VolatilityRiskInputs): Promise<VolatilityRiskResult> {
    const { symbol, baseRiskPercent, currentATR, userId } = inputs;

    // Get historical volatility for comparison
    const historicalATR = await this.getHistoricalATR(symbol, userId);

    // Determine volatility state
    const thresholds = this.VOLATILITY_THRESHOLDS[symbol as keyof typeof this.VOLATILITY_THRESHOLDS]
      || this.VOLATILITY_THRESHOLDS.DEFAULT;

    let volatilityState: 'very-low' | 'low' | 'normal' | 'high' | 'very-high';
    if (currentATR <= thresholds.veryLow) {
      volatilityState = 'very-low';
    } else if (currentATR <= thresholds.low) {
      volatilityState = 'low';
    } else if (currentATR <= thresholds.normal) {
      volatilityState = 'normal';
    } else if (currentATR <= thresholds.high) {
      volatilityState = 'high';
    } else {
      volatilityState = 'very-high';
    }

    // Calculate risk multiplier based on volatility
    // Lower volatility = can risk more (better stop placement)
    // Higher volatility = must risk less (wider stops needed)
    let riskMultiplier: number;

    switch (volatilityState) {
      case 'very-low':
        riskMultiplier = 1.3; // Can increase risk by 30%
        break;
      case 'low':
        riskMultiplier = 1.1; // Can increase risk by 10%
        break;
      case 'normal':
        riskMultiplier = 1.0; // Keep base risk
        break;
      case 'high':
        riskMultiplier = 0.75; // Reduce risk by 25%
        break;
      case 'very-high':
        riskMultiplier = 0.5; // Reduce risk by 50%
        break;
    }

    // Calculate adjusted risk
    const adjustedRiskPercent = baseRiskPercent * riskMultiplier;

    // Calculate recommended stop loss (2x ATR is common practice)
    const recommendedStopLoss = currentATR * 2;

    // Generate warnings
    const warnings: string[] = [];

    if (volatilityState === 'very-high') {
      warnings.push('⚠️ EXTREME VOLATILITY: Consider staying out of market');
      warnings.push('Stop losses may be hit frequently in current conditions');
      warnings.push('Slippage risk is elevated');
    } else if (volatilityState === 'high') {
      warnings.push('⚠️ High volatility: Reduce position size');
      warnings.push('Use wider stops to avoid noise');
    } else if (volatilityState === 'very-low') {
      warnings.push('Very low volatility: Market may be consolidating');
      warnings.push('Breakout potential - be ready for volatility expansion');
    }

    // Compare to historical average
    if (historicalATR > 0) {
      const volatilityRatio = currentATR / historicalATR;
      if (volatilityRatio > 1.5) {
        warnings.push(`Volatility is ${((volatilityRatio - 1) * 100).toFixed(0)}% above normal`);
      } else if (volatilityRatio < 0.7) {
        warnings.push(`Volatility is ${((1 - volatilityRatio) * 100).toFixed(0)}% below normal`);
      }
    }

    // Generate reasoning
    let reasoning = `Current ATR: ${currentATR.toFixed(1)} pips (${volatilityState} volatility). `;
    reasoning += `Risk adjusted from ${baseRiskPercent.toFixed(2)}% to ${adjustedRiskPercent.toFixed(2)}% `;
    reasoning += `(${riskMultiplier}x multiplier). `;
    reasoning += `Recommended stop: ${recommendedStopLoss.toFixed(1)} pips (2×ATR). `;

    if (historicalATR > 0) {
      reasoning += `30-day avg ATR: ${historicalATR.toFixed(1)} pips. `;
    }

    return {
      adjustedRiskPercent,
      riskMultiplier,
      volatilityState,
      recommendedStopLoss,
      reasoning,
      warnings
    };
  }

  private async getHistoricalATR(symbol: string, userId: string): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.VOLATILITY_LOOKBACK_DAYS);

      // Query recent volatility logs
      const { data: logs, error } = await supabase
        .from('volatility_risk_log')
        .select('current_atr')
        .eq('symbol', symbol)
        .gte('created_at', cutoffDate.toISOString())
        .order('created_at', { ascending: false })
        .limit(30);

      if (error || !logs || logs.length === 0) {
        return 0; // No historical data
      }

      // Calculate average
      const avgATR = logs.reduce((sum, log) => sum + log.current_atr, 0) / logs.length;
      return avgATR;
    } catch (error) {
      console.error('Error fetching historical ATR:', error);
      return 0;
    }
  }

  calculateATR(candles: Array<{ high: number; low: number; close: number }>, period: number = 14): number {
    if (candles.length < period + 1) {
      return 0;
    }

    const trueRanges: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      // True Range is the greatest of:
      // 1. Current High - Current Low
      // 2. Abs(Current High - Previous Close)
      // 3. Abs(Current Low - Previous Close)
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );

      trueRanges.push(tr);
    }

    // Calculate ATR as simple moving average of TR
    const recentTRs = trueRanges.slice(-period);
    const atr = recentTRs.reduce((sum, tr) => sum + tr, 0) / period;

    return atr;
  }

  async logVolatilityAdjustment(
    userId: string,
    symbol: string,
    inputs: VolatilityRiskInputs,
    result: VolatilityRiskResult,
    goalSessionId?: string
  ): Promise<void> {
    try {
      await supabase.from('volatility_risk_log').insert({
        user_id: userId,
        goal_session_id: goalSessionId,
        symbol,
        base_risk_percent: inputs.baseRiskPercent,
        current_atr: inputs.currentATR,
        adjusted_risk_percent: result.adjustedRiskPercent,
        risk_multiplier: result.riskMultiplier,
        volatility_state: result.volatilityState,
        recommended_stop_loss: result.recommendedStopLoss,
        reasoning: result.reasoning,
        warnings: result.warnings
      });
    } catch (error) {
      console.error('Error logging volatility adjustment:', error);
    }
  }

  getVolatilityBasedTimeframe(volatilityState: 'very-low' | 'low' | 'normal' | 'high' | 'very-high'): string {
    // Recommend timeframe based on volatility
    switch (volatilityState) {
      case 'very-low':
        return 'H1-H4'; // Lower timeframes in low volatility
      case 'low':
        return 'H1';
      case 'normal':
        return 'M15-H1';
      case 'high':
        return 'H4-D1'; // Higher timeframes in high volatility
      case 'very-high':
        return 'D1'; // Stay on daily in extreme volatility
    }
  }
}

export const volatilityAdjustedRisk = new VolatilityAdjustedRisk();
