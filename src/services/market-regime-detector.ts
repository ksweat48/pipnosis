import { supabase } from '../lib/supabase';

/**
 * Market Regime Detector
 *
 * Classifies current market conditions to enable intelligent strategy selection.
 * Detects:
 * - Trend direction and strength
 * - Volatility levels
 * - Market phase (ranging vs trending)
 * - Trading session
 */

interface MarketRegime {
  regimeType: 'trending_up' | 'trending_down' | 'ranging' | 'mixed';
  volatilityLevel: 'low' | 'medium' | 'high' | 'extreme';
  trendStrength: number; // 0-100
  confidence: number; // 0-100
  sessionType: 'asian' | 'london' | 'newyork' | 'overlap';
  characteristics: {
    atr: number;
    atrPercentile: number;
    adx?: number;
    priceLocation: 'near_high' | 'near_low' | 'middle';
    volumeTrend: 'increasing' | 'decreasing' | 'stable';
  };
}

class MarketRegimeDetector {
  private readonly ATR_LOOKBACK = 20;
  private readonly TREND_LOOKBACK = 50;

  /**
   * Detect current market regime for a symbol
   */
  async detectRegime(
    symbol: string,
    timeframe: string = 'H1'
  ): Promise<MarketRegime | null> {
    try {
      // Fetch recent candles for analysis
      const candles = await this.fetchRecentCandles(symbol, timeframe, this.TREND_LOOKBACK);

      if (!candles || candles.length < this.TREND_LOOKBACK) {
        console.log('[Market Regime] Insufficient data for regime detection');
        return null;
      }

      // 1. Calculate ATR (volatility)
      const atr = this.calculateATR(candles, this.ATR_LOOKBACK);
      const atrPercentile = this.calculateATRPercentile(candles, atr);

      // 2. Determine volatility level
      const volatilityLevel = this.classifyVolatility(atrPercentile);

      // 3. Detect trend
      const trendAnalysis = this.detectTrend(candles);

      // 4. Determine regime type
      const regimeType = this.classifyRegimeType(trendAnalysis, volatilityLevel);

      // 5. Determine trading session
      const sessionType = this.detectTradingSession();

      // 6. Analyze price location
      const priceLocation = this.analyzePriceLocation(candles);

      // 7. Analyze volume trend (simplified)
      const volumeTrend = this.analyzeVolumeTrend(candles);

      const regime: MarketRegime = {
        regimeType,
        volatilityLevel,
        trendStrength: trendAnalysis.strength,
        confidence: trendAnalysis.confidence,
        sessionType,
        characteristics: {
          atr,
          atrPercentile,
          adx: trendAnalysis.adx,
          priceLocation,
          volumeTrend
        }
      };

      // Store regime in database for history
      await this.saveRegimeHistory(symbol, timeframe, regime);

      console.log(`[Market Regime] ${symbol}: ${regimeType} | Volatility: ${volatilityLevel} | Trend Strength: ${trendAnalysis.strength.toFixed(1)}`);

      return regime;

    } catch (error) {
      console.error('[Market Regime] Error detecting regime:', error);
      return null;
    }
  }

  /**
   * Fetch recent candles from database
   */
  private async fetchRecentCandles(
    symbol: string,
    timeframe: string,
    count: number
  ): Promise<any[]> {
    const { data, error } = await supabase
      .from('forex_candles')
      .select('*')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .order('open_time', { ascending: false })
      .limit(count);

    if (error) {
      console.error('[Market Regime] Error fetching candles:', error);
      return [];
    }

    return data?.reverse() || [];
  }

  /**
   * Calculate Average True Range (ATR)
   */
  private calculateATR(candles: any[], period: number): number {
    if (candles.length < period + 1) return 0;

    const trueRanges: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const high = parseFloat(candles[i].high);
      const low = parseFloat(candles[i].low);
      const prevClose = parseFloat(candles[i - 1].close);

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );

      trueRanges.push(tr);
    }

    // Take last 'period' true ranges and average
    const recentTR = trueRanges.slice(-period);
    const atr = recentTR.reduce((sum, tr) => sum + tr, 0) / recentTR.length;

    return atr;
  }

  /**
   * Calculate ATR percentile (where current ATR ranks historically)
   */
  private calculateATRPercentile(candles: any[], currentATR: number): number {
    const allATRs: number[] = [];

    // Calculate ATR for each window
    for (let i = this.ATR_LOOKBACK; i < candles.length; i++) {
      const window = candles.slice(i - this.ATR_LOOKBACK, i);
      const atr = this.calculateATR(window, this.ATR_LOOKBACK);
      allATRs.push(atr);
    }

    if (allATRs.length === 0) return 50;

    // Calculate percentile
    const sorted = [...allATRs].sort((a, b) => a - b);
    const rank = sorted.filter(atr => atr <= currentATR).length;
    const percentile = (rank / sorted.length) * 100;

    return percentile;
  }

  /**
   * Classify volatility level based on ATR percentile
   */
  private classifyVolatility(atrPercentile: number): 'low' | 'medium' | 'high' | 'extreme' {
    if (atrPercentile >= 90) return 'extreme';
    if (atrPercentile >= 70) return 'high';
    if (atrPercentile >= 30) return 'medium';
    return 'low';
  }

  /**
   * Detect trend direction and strength
   */
  private detectTrend(candles: any[]): {
    direction: 'up' | 'down' | 'sideways';
    strength: number;
    confidence: number;
    adx?: number;
  } {
    if (candles.length < 20) {
      return { direction: 'sideways', strength: 0, confidence: 0 };
    }

    const closes = candles.map(c => parseFloat(c.close));

    // Simple trend detection: compare recent vs older prices
    const recentPeriod = 10;
    const olderPeriod = 20;

    const recentAvg = closes.slice(-recentPeriod).reduce((sum, c) => sum + c, 0) / recentPeriod;
    const olderAvg = closes.slice(-olderPeriod, -recentPeriod).reduce((sum, c) => sum + c, 0) / recentPeriod;

    const priceChange = ((recentAvg - olderAvg) / olderAvg) * 100;

    // Calculate slope strength
    const firstPrice = closes[0];
    const lastPrice = closes[closes.length - 1];
    const overallChange = ((lastPrice - firstPrice) / firstPrice) * 100;

    // Determine direction
    let direction: 'up' | 'down' | 'sideways' = 'sideways';
    if (Math.abs(priceChange) < 0.2) {
      direction = 'sideways';
    } else if (priceChange > 0) {
      direction = 'up';
    } else {
      direction = 'down';
    }

    // Calculate strength (0-100)
    const strength = Math.min(100, Math.abs(overallChange) * 20);

    // Confidence based on consistency
    const positiveCandles = candles.filter((c, i) => i > 0 && parseFloat(c.close) > parseFloat(candles[i - 1].close)).length;
    const consistency = (positiveCandles / (candles.length - 1)) * 100;
    const confidence = direction === 'up' ? consistency : direction === 'down' ? (100 - consistency) : 50;

    return {
      direction,
      strength,
      confidence,
      adx: strength // Simplified ADX approximation
    };
  }

  /**
   * Classify regime type based on trend and volatility
   */
  private classifyRegimeType(
    trend: { direction: string; strength: number },
    volatility: string
  ): 'trending_up' | 'trending_down' | 'ranging' | 'mixed' {
    if (trend.strength < 30) {
      return 'ranging';
    }

    if (trend.direction === 'up' && trend.strength >= 50) {
      return 'trending_up';
    }

    if (trend.direction === 'down' && trend.strength >= 50) {
      return 'trending_down';
    }

    return 'mixed';
  }

  /**
   * Detect current trading session
   */
  private detectTradingSession(): 'asian' | 'london' | 'newyork' | 'overlap' {
    const now = new Date();
    const utcHour = now.getUTCHours();

    // Session times in UTC
    // Asian: 00:00 - 09:00
    // London: 08:00 - 17:00
    // New York: 13:00 - 22:00

    if (utcHour >= 13 && utcHour < 17) {
      return 'overlap'; // London-NY overlap
    } else if (utcHour >= 8 && utcHour < 13) {
      return 'london';
    } else if (utcHour >= 13 && utcHour < 22) {
      return 'newyork';
    } else {
      return 'asian';
    }
  }

  /**
   * Analyze price location relative to recent range
   */
  private analyzePriceLocation(candles: any[]): 'near_high' | 'near_low' | 'middle' {
    if (candles.length < 20) return 'middle';

    const recent = candles.slice(-20);
    const highs = recent.map(c => parseFloat(c.high));
    const lows = recent.map(c => parseFloat(c.low));
    const currentPrice = parseFloat(candles[candles.length - 1].close);

    const rangeHigh = Math.max(...highs);
    const rangeLow = Math.min(...lows);
    const rangeSize = rangeHigh - rangeLow;

    const positionInRange = (currentPrice - rangeLow) / rangeSize;

    if (positionInRange > 0.7) return 'near_high';
    if (positionInRange < 0.3) return 'near_low';
    return 'middle';
  }

  /**
   * Analyze volume trend (simplified - using price momentum as proxy)
   */
  private analyzeVolumeTrend(candles: any[]): 'increasing' | 'decreasing' | 'stable' {
    if (candles.length < 10) return 'stable';

    const recent = candles.slice(-10);
    const ranges = recent.map(c => parseFloat(c.high) - parseFloat(c.low));

    const firstHalf = ranges.slice(0, 5);
    const secondHalf = ranges.slice(5);

    const avgFirst = firstHalf.reduce((sum, r) => sum + r, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((sum, r) => sum + r, 0) / secondHalf.length;

    const change = ((avgSecond - avgFirst) / avgFirst) * 100;

    if (change > 10) return 'increasing';
    if (change < -10) return 'decreasing';
    return 'stable';
  }

  /**
   * Save regime detection to history
   */
  private async saveRegimeHistory(
    symbol: string,
    timeframe: string,
    regime: MarketRegime
  ): Promise<void> {
    try {
      // Get authenticated user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from('market_regime_history').insert({
        user_id: user.id,
        symbol,
        timeframe,
        regime_type: regime.regimeType,
        volatility_level: regime.volatilityLevel,
        trend_strength: regime.trendStrength,
        atr: regime.characteristics.atr,
        atr_percentile: regime.characteristics.atrPercentile,
        adx: regime.characteristics.adx,
        price_location: regime.characteristics.priceLocation,
        volume_trend: regime.characteristics.volumeTrend,
        session_type: regime.sessionType,
        regime_start: new Date()
      });
    } catch (error) {
      // Silently fail - regime history is not critical
    }
  }

  /**
   * Get recent regime history for analysis
   */
  async getRecentRegimeHistory(
    userId: string,
    symbol: string,
    limit: number = 20
  ): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('market_regime_history')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .order('detected_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[Market Regime] Error fetching history:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[Market Regime] Error:', error);
      return [];
    }
  }

  /**
   * Detect regime changes
   */
  async hasRegimeChanged(
    userId: string,
    symbol: string,
    currentRegime: MarketRegime
  ): Promise<boolean> {
    const history = await this.getRecentRegimeHistory(userId, symbol, 2);

    if (history.length < 1) return false;

    const previousRegime = history[0];

    // Check if regime type changed
    if (currentRegime.regimeType !== previousRegime.regime_type) {
      console.log(`[Market Regime] ⚡ Regime change detected: ${previousRegime.regime_type} → ${currentRegime.regimeType}`);
      return true;
    }

    // Check if volatility level changed significantly
    if (currentRegime.volatilityLevel !== previousRegime.volatility_level) {
      console.log(`[Market Regime] ⚡ Volatility change: ${previousRegime.volatility_level} → ${currentRegime.volatilityLevel}`);
      return true;
    }

    return false;
  }
}

export const marketRegimeDetector = new MarketRegimeDetector();
export type { MarketRegime };
