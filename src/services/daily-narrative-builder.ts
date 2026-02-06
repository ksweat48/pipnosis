/**
 * Daily Narrative Builder
 *
 * Builds institutional-style daily market narrative:
 * - Daily high/low
 * - Daily displacement (range traveled)
 * - Liquidity sweeps (Asian low, daily highs)
 * - Session context
 * - Range position
 *
 * This provides "smart money" context for intraday decisions
 */

import { marketDataService } from './market-data-service';
import { getCurrencyPipInfo, calculatePipDistance } from '../utils/currencyHelpers';

export interface DailyNarrative {
  symbol: string;
  date: string;

  // Daily levels
  dailyHigh: number;
  dailyLow: number;
  dailyOpen: number;
  dailyRange: number;        // High - Low in pips
  dailyDisplacement: number; // Total distance traveled (not just range)

  // Current position
  currentPrice: number;
  rangePosition: number;     // 0-100: where in daily range (0=low, 100=high)

  // Bias and structure
  dailyBias: 'bullish' | 'bearish' | 'neutral';
  structureQuality: 'clean' | 'choppy' | 'ranging';

  // Session context
  currentSession: 'asian' | 'london' | 'ny' | 'overlap' | 'closed';
  asianRange: { high: number; low: number } | null;

  // Liquidity analysis
  liquiditySweeps: {
    asianLowSwept: boolean;
    asianHighSwept: boolean;
    dailyHighTested: boolean;
    dailyLowTested: boolean;
  };

  // Narrative summary
  narrative: string;
  intradayContext: string;
}

class DailyNarrativeBuilder {
  /**
   * Build daily narrative for a symbol
   * ALWAYS returns data - uses fallback if database has no candles
   * ✅ SSOT: Uses MarketDataService for candle queries
   */
  async build(symbol: string, currentPrice: number): Promise<DailyNarrative> {
    try {
      const now = new Date();
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const dateStr = todayUTC.toISOString().split('T')[0];

      const candles = await marketDataService.getCandlesInRange(
        symbol,
        'M15',
        todayUTC,
        now,
        true // Ascending order
      );

      if (!candles || candles.length === 0) {
        console.warn(`[Daily Narrative] No data for ${symbol} today - using fallback`);
        return this.buildFallbackNarrative(symbol, currentPrice, dateStr);
      }

      // Calculate daily high/low/open
      const dailyHigh = Math.max(...candles.map(c => c.high));
      const dailyLow = Math.min(...candles.map(c => c.low));
      const dailyOpen = candles[0].open;

      // Calculate daily range in pips
      const dailyRange = calculatePipDistance(symbol, dailyHigh, dailyLow);

      // Calculate displacement (sum of absolute moves)
      let totalDisplacement = 0;
      for (let i = 1; i < candles.length; i++) {
        totalDisplacement += Math.abs(candles[i].close - candles[i - 1].close);
      }
      const dailyDisplacement = totalDisplacement / pipFactor;

      // Calculate range position (where is current price in the range?)
      const rangePosition = dailyRange > 0
        ? ((currentPrice - dailyLow) / (dailyHigh - dailyLow)) * 100
        : 50;

      // Determine daily bias
      const dailyBias = this.calculateDailyBias(dailyOpen, currentPrice, dailyHigh, dailyLow);

      // Determine structure quality
      const structureQuality = this.assessStructure(candles, dailyRange);

      // Get Asian session range (first 8 hours of day, roughly)
      const asianRange = this.getAsianRange(candles);

      // Analyze liquidity sweeps
      const liquiditySweeps = this.analyzeLiquiditySweeps(
        currentPrice,
        dailyHigh,
        dailyLow,
        asianRange
      );

      // Determine current session
      const currentSession = this.getCurrentSession();

      // Build narrative
      const narrative = this.buildNarrative({
        symbol,
        dailyRange,
        dailyDisplacement,
        rangePosition,
        dailyBias,
        structureQuality,
        liquiditySweeps,
        currentSession
      });

      const intradayContext = this.buildIntradayContext({
        rangePosition,
        dailyBias,
        currentSession,
        liquiditySweeps
      });

      return {
        symbol,
        date: dateStr,
        dailyHigh,
        dailyLow,
        dailyOpen,
        dailyRange,
        dailyDisplacement,
        currentPrice,
        rangePosition,
        dailyBias,
        structureQuality,
        currentSession,
        asianRange,
        liquiditySweeps,
        narrative,
        intradayContext
      };
    } catch (error) {
      console.error('[Daily Narrative] Error building narrative:', error);
      const dateStr = new Date().toISOString().split('T')[0];
      return this.buildFallbackNarrative(symbol, currentPrice, dateStr);
    }
  }

  /**
   * Build fallback narrative when no candle data is available
   * Uses current price and session context to provide useful information
   */
  private buildFallbackNarrative(symbol: string, currentPrice: number, dateStr: string): DailyNarrative {
    const currentSession = this.getCurrentSession();
    const pipInfo = getCurrencyPipInfo(symbol);

    const estimatedDailyRange = symbol.includes('XAU') ? 200 :
                                 symbol.includes('US30') ? 300 :
                                 symbol.includes('JPY') ? 50 : 60;

    const halfRange = (estimatedDailyRange * pipInfo.pipValue) / 2;
    const estimatedHigh = currentPrice + halfRange;
    const estimatedLow = currentPrice - halfRange;

    return {
      symbol,
      date: dateStr,
      dailyHigh: estimatedHigh,
      dailyLow: estimatedLow,
      dailyOpen: currentPrice,
      dailyRange: estimatedDailyRange,
      dailyDisplacement: estimatedDailyRange * 0.5,
      currentPrice,
      rangePosition: 50,
      dailyBias: 'neutral',
      structureQuality: 'ranging',
      currentSession,
      asianRange: null,
      liquiditySweeps: {
        asianLowSwept: false,
        asianHighSwept: false,
        dailyHighTested: false,
        dailyLowTested: false
      },
      narrative: `${symbol} daily data unavailable - using estimated range of ${estimatedDailyRange} pips. Session: ${currentSession}.`,
      intradayContext: `Limited daily context available. Current session: ${currentSession}. Trade with caution until full data is available.`
    };
  }

  /**
   * Calculate daily bias
   */
  private calculateDailyBias(
    open: number,
    current: number,
    high: number,
    low: number
  ): 'bullish' | 'bearish' | 'neutral' {
    const range = high - low;
    const move = current - open;
    const movePercent = range > 0 ? (move / range) * 100 : 0;

    if (movePercent > 20) return 'bullish';
    if (movePercent < -20) return 'bearish';
    return 'neutral';
  }

  /**
   * Assess structure quality
   */
  private assessStructure(candles: any[], dailyRange: number): 'clean' | 'choppy' | 'ranging' {
    if (candles.length < 4) return 'ranging';

    // Calculate how many times price reversed direction
    let reversals = 0;
    for (let i = 2; i < candles.length; i++) {
      const prev2 = candles[i - 2].close;
      const prev1 = candles[i - 1].close;
      const curr = candles[i].close;

      const dir1 = prev1 > prev2 ? 'up' : 'down';
      const dir2 = curr > prev1 ? 'up' : 'down';

      if (dir1 !== dir2) reversals++;
    }

    const reversalRate = reversals / (candles.length - 2);

    if (dailyRange < 30) return 'ranging';  // Less than 30 pips range
    if (reversalRate > 0.6) return 'choppy'; // Many direction changes
    return 'clean';
  }

  /**
   * Get Asian session range (approximate)
   */
  private getAsianRange(candles: any[]): { high: number; low: number } | null {
    // Asian session is roughly first 32 candles (8 hours of M15)
    const asianCandles = candles.slice(0, Math.min(32, candles.length));

    if (asianCandles.length < 4) return null;

    return {
      high: Math.max(...asianCandles.map(c => c.high)),
      low: Math.min(...asianCandles.map(c => c.low))
    };
  }

  /**
   * Analyze liquidity sweeps
   */
  private analyzeLiquiditySweeps(
    currentPrice: number,
    dailyHigh: number,
    dailyLow: number,
    asianRange: { high: number; low: number } | null
  ): DailyNarrative['liquiditySweeps'] {
    const threshold = 0.0005; // 5 pips tolerance

    return {
      asianLowSwept: asianRange ? currentPrice < asianRange.low + threshold : false,
      asianHighSwept: asianRange ? currentPrice > asianRange.high - threshold : false,
      dailyHighTested: currentPrice > dailyHigh - threshold,
      dailyLowTested: currentPrice < dailyLow + threshold
    };
  }

  /**
   * Get current trading session
   */
  private getCurrentSession(): DailyNarrative['currentSession'] {
    const now = new Date();
    const utcHour = now.getUTCHours();

    // London: 8-16 UTC
    // NY: 13-21 UTC
    // Overlap: 13-16 UTC
    // Asian: 23-8 UTC

    if (utcHour >= 13 && utcHour < 16) return 'overlap';
    if (utcHour >= 8 && utcHour < 16) return 'london';
    if (utcHour >= 13 && utcHour < 21) return 'ny';
    if (utcHour >= 23 || utcHour < 8) return 'asian';
    return 'closed';
  }

  /**
   * Build narrative string
   */
  private buildNarrative(input: {
    symbol: string;
    dailyRange: number;
    dailyDisplacement: number;
    rangePosition: number;
    dailyBias: string;
    structureQuality: string;
    liquiditySweeps: any;
    currentSession: string;
  }): string {
    const parts = [];

    // Range and displacement
    parts.push(`${input.symbol} daily range: ${input.dailyRange.toFixed(1)} pips`);
    parts.push(`Total displacement: ${input.dailyDisplacement.toFixed(1)} pips (${input.structureQuality})`);

    // Position
    parts.push(`Price at ${input.rangePosition.toFixed(0)}% of daily range`);

    // Bias
    parts.push(`Daily bias: ${input.dailyBias}`);

    // Liquidity
    const sweeps = [];
    if (input.liquiditySweeps.asianLowSwept) sweeps.push('Asian low swept');
    if (input.liquiditySweeps.asianHighSwept) sweeps.push('Asian high swept');
    if (input.liquiditySweeps.dailyHighTested) sweeps.push('testing daily high');
    if (input.liquiditySweeps.dailyLowTested) sweeps.push('testing daily low');
    if (sweeps.length > 0) {
      parts.push(`Liquidity: ${sweeps.join(', ')}`);
    }

    // Session
    parts.push(`Session: ${input.currentSession}`);

    return parts.join('. ') + '.';
  }

  /**
   * Build intraday trading context
   */
  private buildIntradayContext(input: {
    rangePosition: number;
    dailyBias: string;
    currentSession: string;
    liquiditySweeps: any;
  }): string {
    const parts = [];

    // Position-based context
    if (input.rangePosition > 70) {
      parts.push('Near daily highs - watch for resistance/reversal');
    } else if (input.rangePosition < 30) {
      parts.push('Near daily lows - watch for support/bounce');
    } else {
      parts.push('Mid-range - look for directional bias confirmation');
    }

    // Session context
    if (input.currentSession === 'overlap') {
      parts.push('London-NY overlap - expect high volume and quick moves');
    } else if (input.currentSession === 'asian') {
      parts.push('Asian session - expect lower volume, range-bound behavior');
    }

    // Liquidity context
    if (input.liquiditySweeps.asianLowSwept) {
      parts.push('Asian low liquidity swept - possible bullish continuation');
    }

    return parts.join('. ') + '.';
  }
}

export const dailyNarrativeBuilder = new DailyNarrativeBuilder();
