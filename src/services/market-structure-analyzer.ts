/**
 * MARKET STRUCTURE ANALYZER
 *
 * Identifies key market levels for intelligent decision-making:
 * - Support and Resistance levels
 * - Liquidity zones (high volume consolidation areas)
 * - Trend strength scoring
 * - Volatility regime classification
 */

export interface SupportResistanceLevel {
  price: number;
  strength: number; // 0-100
  type: 'support' | 'resistance';
  touches: number;
  recentlyTested: boolean;
}

export interface LiquidityZone {
  high: number;
  low: number;
  midpoint: number;
  volume: number;
  strength: number; // 0-100
}

export interface MarketStructure {
  supportLevels: number[];
  resistanceLevels: number[];
  liquidityZones: LiquidityZone[];
  trendStrength: number; // 0-100
  volatilityRegimeScore: number; // 0-100
  nearestSupport: number | null;
  nearestResistance: number | null;
}

export interface CandleData {
  time: number | Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

class MarketStructureAnalyzer {

  /**
   * Analyze market structure from recent candles
   */
  analyzeStructure(
    candles: CandleData[],
    currentPrice: number,
    indicators: {
      ema9: number;
      ema21: number;
      ema50: number;
      atr: number;
      rsi: number;
    }
  ): MarketStructure {
    if (!candles || candles.length < 20) {
      return this.getEmptyStructure(currentPrice);
    }

    // Find support and resistance levels
    const { supportLevels, resistanceLevels } = this.findKeyLevels(candles, currentPrice);

    // Identify liquidity zones
    const liquidityZones = this.findLiquidityZones(candles);

    // Calculate trend strength
    const trendStrength = this.calculateTrendStrength(
      currentPrice,
      indicators.ema9,
      indicators.ema21,
      indicators.ema50,
      indicators.rsi
    );

    // Calculate volatility regime score
    const volatilityRegimeScore = this.calculateVolatilityRegime(
      indicators.atr,
      currentPrice,
      candles
    );

    // Find nearest levels
    const nearestSupport = this.findNearestLevel(currentPrice, supportLevels, 'below');
    const nearestResistance = this.findNearestLevel(currentPrice, resistanceLevels, 'above');

    return {
      supportLevels,
      resistanceLevels,
      liquidityZones,
      trendStrength,
      volatilityRegimeScore,
      nearestSupport,
      nearestResistance
    };
  }

  /**
   * Find key support and resistance levels using swing highs/lows
   */
  private findKeyLevels(
    candles: CandleData[],
    currentPrice: number
  ): { supportLevels: number[]; resistanceLevels: number[] } {
    const swingHighs: number[] = [];
    const swingLows: number[] = [];

    // Look for swing points (local highs/lows with at least 2 candles on each side)
    for (let i = 2; i < candles.length - 2; i++) {
      const current = candles[i];
      const leftLow1 = candles[i - 1].low;
      const leftLow2 = candles[i - 2].low;
      const rightLow1 = candles[i + 1].low;
      const rightLow2 = candles[i + 2].low;

      const leftHigh1 = candles[i - 1].high;
      const leftHigh2 = candles[i - 2].high;
      const rightHigh1 = candles[i + 1].high;
      const rightHigh2 = candles[i + 2].high;

      // Swing Low: lower than surrounding candles
      if (
        current.low < leftLow1 &&
        current.low < leftLow2 &&
        current.low < rightLow1 &&
        current.low < rightLow2
      ) {
        swingLows.push(current.low);
      }

      // Swing High: higher than surrounding candles
      if (
        current.high > leftHigh1 &&
        current.high > leftHigh2 &&
        current.high > rightHigh1 &&
        current.high > rightHigh2
      ) {
        swingHighs.push(current.high);
      }
    }

    // Cluster levels that are within 0.1% of each other
    const supportLevels = this.clusterLevels(swingLows, currentPrice * 0.001);
    const resistanceLevels = this.clusterLevels(swingHighs, currentPrice * 0.001);

    // Filter to top 3 support and resistance levels closest to current price
    const topSupports = supportLevels
      .filter(level => level < currentPrice)
      .sort((a, b) => Math.abs(currentPrice - a) - Math.abs(currentPrice - b))
      .slice(0, 3);

    const topResistances = resistanceLevels
      .filter(level => level > currentPrice)
      .sort((a, b) => Math.abs(currentPrice - a) - Math.abs(currentPrice - b))
      .slice(0, 3);

    return {
      supportLevels: topSupports,
      resistanceLevels: topResistances
    };
  }

  /**
   * Cluster price levels that are close together
   */
  private clusterLevels(levels: number[], threshold: number): number[] {
    if (levels.length === 0) return [];

    const sorted = [...levels].sort((a, b) => a - b);
    const clusters: number[] = [];
    let currentCluster = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      if (Math.abs(sorted[i] - sorted[i - 1]) <= threshold) {
        currentCluster.push(sorted[i]);
      } else {
        // Calculate average of cluster
        const avg = currentCluster.reduce((sum, val) => sum + val, 0) / currentCluster.length;
        clusters.push(avg);
        currentCluster = [sorted[i]];
      }
    }

    // Add last cluster
    if (currentCluster.length > 0) {
      const avg = currentCluster.reduce((sum, val) => sum + val, 0) / currentCluster.length;
      clusters.push(avg);
    }

    return clusters;
  }

  /**
   * Find liquidity zones (consolidation areas with high volume)
   */
  private findLiquidityZones(candles: CandleData[]): LiquidityZone[] {
    const zones: LiquidityZone[] = [];

    // Look for consolidation patterns (price range within 0.3% for 5+ candles)
    for (let i = 0; i < candles.length - 5; i++) {
      const segment = candles.slice(i, i + 5);
      const highs = segment.map(c => c.high);
      const lows = segment.map(c => c.low);
      const rangeHigh = Math.max(...highs);
      const rangeLow = Math.min(...lows);
      const rangeMid = (rangeHigh + rangeLow) / 2;
      const rangePercent = ((rangeHigh - rangeLow) / rangeMid) * 100;

      // If price stayed within 0.3% range for 5 candles, it's a liquidity zone
      if (rangePercent < 0.3) {
        const totalVolume = segment.reduce((sum, c) => sum + (c.volume || 0), 0);
        const strength = Math.min(100, (segment.length / 10) * 100); // More candles = stronger zone

        zones.push({
          high: rangeHigh,
          low: rangeLow,
          midpoint: rangeMid,
          volume: totalVolume,
          strength
        });
      }
    }

    // Return top 3 zones by strength
    return zones
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 3);
  }

  /**
   * Calculate trend strength from EMA alignment and RSI
   */
  private calculateTrendStrength(
    price: number,
    ema9: number,
    ema21: number,
    ema50: number,
    rsi: number
  ): number {
    let strength = 50; // Neutral baseline

    // EMA alignment scoring
    // Perfect bullish: price > EMA9 > EMA21 > EMA50
    // Perfect bearish: price < EMA9 < EMA21 < EMA50
    const bullishAlignment = price > ema9 && ema9 > ema21 && ema21 > ema50;
    const bearishAlignment = price < ema9 && ema9 < ema21 && ema21 < ema50;

    if (bullishAlignment) {
      // Calculate how far apart the EMAs are (wider = stronger trend)
      const ema9to21Gap = ((ema9 - ema21) / ema21) * 100;
      const ema21to50Gap = ((ema21 - ema50) / ema50) * 100;
      const avgGap = (ema9to21Gap + ema21to50Gap) / 2;

      strength = 50 + Math.min(50, avgGap * 10); // Scale gap to 0-50 range
    } else if (bearishAlignment) {
      const ema9to21Gap = ((ema21 - ema9) / ema21) * 100;
      const ema21to50Gap = ((ema50 - ema21) / ema50) * 100;
      const avgGap = (ema9to21Gap + ema21to50Gap) / 2;

      strength = 50 + Math.min(50, avgGap * 10); // Scale gap to 0-50 range
    } else {
      // Mixed signals = weak trend
      strength = 30;
    }

    // RSI confirmation (extreme RSI = strong trend)
    if (rsi > 65 && bullishAlignment) {
      strength = Math.min(100, strength + 10);
    } else if (rsi < 35 && bearishAlignment) {
      strength = Math.min(100, strength + 10);
    } else if (rsi > 50 && rsi < 65 && bullishAlignment) {
      // Moderate RSI in bullish trend = healthy
      strength = Math.min(100, strength + 5);
    } else if (rsi > 35 && rsi < 50 && bearishAlignment) {
      // Moderate RSI in bearish trend = healthy
      strength = Math.min(100, strength + 5);
    }

    return Math.max(0, Math.min(100, strength));
  }

  /**
   * Calculate volatility regime score from ATR
   */
  private calculateVolatilityRegime(
    atr: number,
    currentPrice: number,
    candles: CandleData[]
  ): number {
    // Calculate ATR as percentage of price
    const atrPercent = (atr / currentPrice) * 100;

    // Compare to historical ATR
    const recentCandles = candles.slice(-20);
    const historicalATRs = recentCandles.map(c => {
      const tr = Math.max(
        c.high - c.low,
        Math.abs(c.high - (recentCandles[recentCandles.indexOf(c) - 1]?.close || c.close)),
        Math.abs(c.low - (recentCandles[recentCandles.indexOf(c) - 1]?.close || c.close))
      );
      return (tr / c.close) * 100;
    });

    const avgHistoricalATR = historicalATRs.reduce((sum, val) => sum + val, 0) / historicalATRs.length;

    // Score based on current ATR vs historical
    // 0 = very low volatility, 50 = normal, 100 = very high volatility
    const ratio = atrPercent / avgHistoricalATR;

    let score = 50; // Normal baseline
    if (ratio < 0.7) {
      // Low volatility
      score = ratio * 71; // 0.7 ratio = 50 score
    } else if (ratio > 1.3) {
      // High volatility
      score = 50 + Math.min(50, (ratio - 1.3) * 50);
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Find nearest level above or below current price
   */
  private findNearestLevel(
    currentPrice: number,
    levels: number[],
    direction: 'above' | 'below'
  ): number | null {
    if (levels.length === 0) return null;

    const validLevels = direction === 'above'
      ? levels.filter(l => l > currentPrice)
      : levels.filter(l => l < currentPrice);

    if (validLevels.length === 0) return null;

    const sorted = validLevels.sort((a, b) => {
      const diffA = Math.abs(currentPrice - a);
      const diffB = Math.abs(currentPrice - b);
      return diffA - diffB;
    });

    return sorted[0];
  }

  /**
   * Get empty structure when insufficient data
   */
  private getEmptyStructure(currentPrice: number): MarketStructure {
    return {
      supportLevels: [],
      resistanceLevels: [],
      liquidityZones: [],
      trendStrength: 50,
      volatilityRegimeScore: 50,
      nearestSupport: null,
      nearestResistance: null
    };
  }
}

export const marketStructureAnalyzer = new MarketStructureAnalyzer();
