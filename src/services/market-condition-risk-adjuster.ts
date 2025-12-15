import { supabase } from '../lib/supabase';

export interface MarketConditionInputs {
  symbol: string;
  timeOfDay: Date;
  userId: string;
}

export interface MarketConditionResult {
  sessionQuality: 'london' | 'newyork' | 'overlap' | 'asian' | 'off-hours';
  liquidityScore: number; // 0-1 (1 = best liquidity)
  riskMultiplier: number; // Adjust risk based on session
  spreadMultiplier: number; // Expected spread increase/decrease
  reasoning: string;
  warnings: string[];
  optimalTimeframes: string[];
}

class MarketConditionRiskAdjuster {
  private readonly LONDON_OPEN = 8; // 8:00 GMT
  private readonly LONDON_CLOSE = 17; // 17:00 GMT
  private readonly NEWYORK_OPEN = 13; // 13:00 GMT (8am EST)
  private readonly NEWYORK_CLOSE = 22; // 22:00 GMT (5pm EST)
  private readonly TOKYO_OPEN = 0; // 00:00 GMT
  private readonly TOKYO_CLOSE = 9; // 09:00 GMT

  assessMarketCondition(inputs: MarketConditionInputs): MarketConditionResult {
    const { symbol, timeOfDay } = inputs;

    // Get GMT hour
    const hour = timeOfDay.getUTCHours();
    const dayOfWeek = timeOfDay.getUTCDay(); // 0 = Sunday, 6 = Saturday

    // Determine trading session
    let sessionQuality: MarketConditionResult['sessionQuality'];
    let liquidityScore: number;
    let riskMultiplier: number;
    let spreadMultiplier: number;
    const warnings: string[] = [];
    let optimalTimeframes: string[];

    // Check for weekend
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      sessionQuality = 'off-hours';
      liquidityScore = 0.1;
      riskMultiplier = 0.3;
      spreadMultiplier = 3.0;
      warnings.push('🛑 WEEKEND: Market is closed or has extremely low liquidity');
      warnings.push('Avoid trading on weekends due to wide spreads');
      optimalTimeframes = ['D1'];
    }
    // London/NY overlap (best liquidity)
    else if (hour >= this.NEWYORK_OPEN && hour < this.LONDON_CLOSE) {
      sessionQuality = 'overlap';
      liquidityScore = 1.0;
      riskMultiplier = 1.2; // Can increase risk slightly
      spreadMultiplier = 0.8; // Spreads tightest
      optimalTimeframes = ['M5', 'M15', 'H1'];
    }
    // London session
    else if (hour >= this.LONDON_OPEN && hour < this.LONDON_CLOSE) {
      sessionQuality = 'london';
      liquidityScore = 0.9;
      riskMultiplier = 1.1;
      spreadMultiplier = 0.9;
      optimalTimeframes = ['M15', 'H1'];
    }
    // New York session
    else if (hour >= this.NEWYORK_OPEN && hour < this.NEWYORK_CLOSE) {
      sessionQuality = 'newyork';
      liquidityScore = 0.85;
      riskMultiplier = 1.0;
      spreadMultiplier = 1.0;
      optimalTimeframes = ['M15', 'H1'];
    }
    // Asian session
    else if (hour >= this.TOKYO_OPEN && hour < this.TOKYO_CLOSE) {
      sessionQuality = 'asian';
      liquidityScore = 0.6;
      riskMultiplier = 0.7; // Reduce risk in lower liquidity
      spreadMultiplier = 1.3;
      warnings.push('⚠️ Asian session: Lower volatility and liquidity');
      warnings.push('Consider wider stops and smaller positions');
      optimalTimeframes = ['H1', 'H4'];
    }
    // Off-hours (late US evening, early Asian)
    else {
      sessionQuality = 'off-hours';
      liquidityScore = 0.4;
      riskMultiplier = 0.5;
      spreadMultiplier = 1.8;
      warnings.push('⚠️ OFF-HOURS: Very low liquidity');
      warnings.push('Spreads are wider, slippage risk is elevated');
      warnings.push('Consider waiting for major session opens');
      optimalTimeframes = ['H4', 'D1'];
    }

    // Symbol-specific adjustments
    if (symbol === 'XAUUSD') {
      // Gold is more volatile during NY session
      if (sessionQuality === 'newyork' || sessionQuality === 'overlap') {
        liquidityScore *= 1.1;
        warnings.push('Gold is most active during NY session');
      } else if (sessionQuality === 'asian') {
        liquidityScore *= 0.8;
        riskMultiplier *= 0.85;
        warnings.push('Gold has lower liquidity during Asian session');
      }
    } else if (symbol.includes('JPY')) {
      // JPY pairs more active during Asian session
      if (sessionQuality === 'asian') {
        liquidityScore *= 1.3;
        riskMultiplier *= 1.1;
        warnings.push('JPY pairs are more active during Asian session');
      }
    } else if (symbol.includes('GBP')) {
      // GBP most active during London
      if (sessionQuality === 'london' || sessionQuality === 'overlap') {
        liquidityScore *= 1.1;
      }
    }

    // Check for first/last hour of trading day (higher volatility)
    if (hour === this.LONDON_OPEN || hour === this.NEWYORK_OPEN) {
      warnings.push('⚠️ Session open: Expect higher volatility and potential whipsaws');
      spreadMultiplier *= 1.2;
    }

    if (hour === this.LONDON_CLOSE - 1 || hour === this.NEWYORK_CLOSE - 1) {
      warnings.push('⚠️ Session close: Liquidity may be drying up');
      riskMultiplier *= 0.9;
    }

    // Generate reasoning
    let reasoning = `Session: ${sessionQuality.toUpperCase()}. `;
    reasoning += `Liquidity score: ${(liquidityScore * 100).toFixed(0)}/100. `;
    reasoning += `Risk adjustment: ${(riskMultiplier * 100).toFixed(0)}% of base risk. `;
    reasoning += `Expected spreads: ${(spreadMultiplier * 100).toFixed(0)}% of normal. `;
    reasoning += `Optimal timeframes: ${optimalTimeframes.join(', ')}.`;

    return {
      sessionQuality,
      liquidityScore,
      riskMultiplier,
      spreadMultiplier,
      reasoning,
      warnings,
      optimalTimeframes
    };
  }

  async logMarketCondition(
    userId: string,
    inputs: MarketConditionInputs,
    result: MarketConditionResult,
    goalSessionId?: string
  ): Promise<void> {
    try {
      await supabase.from('market_condition_log').insert({
        user_id: userId,
        goal_session_id: goalSessionId,
        symbol: inputs.symbol,
        time_of_day: inputs.timeOfDay.toISOString(),
        session_quality: result.sessionQuality,
        liquidity_score: result.liquidityScore,
        risk_multiplier: result.riskMultiplier,
        spread_multiplier: result.spreadMultiplier,
        reasoning: result.reasoning
      });
    } catch (error) {
      console.error('Error logging market condition:', error);
    }
  }

  isHighImpactNewsTime(timeOfDay: Date): boolean {
    const hour = timeOfDay.getUTCHours();
    const minute = timeOfDay.getUTCMinutes();
    const dayOfWeek = timeOfDay.getUTCDay();

    // Common high-impact news times (GMT)
    const highImpactTimes = [
      { hour: 8, minute: 30 }, // UK data
      { hour: 12, minute: 30 }, // ECB, EU data
      { hour: 13, minute: 30 }, // US data (ADP, GDP, etc.)
      { hour: 14, minute: 0 },  // US ISM
      { hour: 14, minute: 15 }, // US Industrial Production
      { hour: 15, minute: 0 },  // FOMC Minutes
    ];

    // Check if within 30 minutes of high-impact time
    for (const newsTime of highImpactTimes) {
      const timeDiff = Math.abs((hour * 60 + minute) - (newsTime.hour * 60 + newsTime.minute));
      if (timeDiff <= 30) {
        return true;
      }
    }

    // First Friday of month (NFP)
    if (dayOfWeek === 5 && timeOfDay.getUTCDate() <= 7) {
      if (hour === 13 && minute >= 15 && minute <= 45) {
        return true; // NFP release time
      }
    }

    return false;
  }

  getOptimalTradingHours(symbol: string): Array<{ start: number; end: number; quality: string }> {
    const schedule = [
      { start: 13, end: 17, quality: 'Excellent (London/NY Overlap)' },
      { start: 8, end: 13, quality: 'Good (London Session)' },
      { start: 17, end: 22, quality: 'Good (NY Session)' },
      { start: 0, end: 8, quality: 'Fair (Asian Session)' },
      { start: 22, end: 24, quality: 'Poor (Off-hours)' },
    ];

    if (symbol.includes('JPY')) {
      // Boost Asian session for JPY pairs
      const asianIndex = schedule.findIndex(s => s.start === 0);
      if (asianIndex >= 0) {
        schedule[asianIndex].quality = 'Good (Asian Session - JPY Active)';
      }
    }

    return schedule;
  }
}

export const marketConditionRiskAdjuster = new MarketConditionRiskAdjuster();
