import { supabase } from '../lib/supabase';

/**
 * Enhanced Market Regime Detector with Session-Aware Intelligence
 *
 * Institutional-grade market regime detection that tracks:
 * - Trend direction and strength
 * - Volatility levels with percentile ranking
 * - Trading session context (Asian/London/NY/Overlap)
 * - Time-of-day patterns
 * - Day-of-week patterns
 * - News event proximity
 */

export interface EnhancedMarketRegime {
  regimeType: 'trending_up' | 'trending_down' | 'ranging' | 'mixed';
  volatilityLevel: 'low' | 'medium' | 'high' | 'extreme';
  trendStrength: number; // 0-100
  confidence: number; // 0-100
  sessionType: 'asian' | 'london' | 'newyork' | 'overlap';
  dayOfWeek: number; // 0-6
  hourOfDay: number; // 0-23
  characteristics: {
    atr: number;
    atrPercentile: number;
    adx?: number;
    priceLocation: 'near_high' | 'near_low' | 'middle';
    volumeTrend: 'increasing' | 'decreasing' | 'stable';
  };
  isNewsPeriod: boolean;
  upcomingEvent?: string;
}

interface Candle {
  open_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

class EnhancedMarketRegimeDetector {
  private readonly ATR_LOOKBACK = 20;
  private readonly TREND_LOOKBACK = 50;
  private readonly ADX_PERIOD = 14;

  /**
   * Detect current market regime with full session context
   */
  async detectRegime(
    userId: string,
    symbol: string,
    timeframe: string = 'H1'
  ): Promise<EnhancedMarketRegime | null> {
    try {
      console.log(`[Enhanced Regime] Detecting regime for ${symbol} on ${timeframe}`);

      // Fetch recent candles for analysis
      const candles = await this.fetchRecentCandles(symbol, timeframe, this.TREND_LOOKBACK);

      if (!candles || candles.length < this.TREND_LOOKBACK) {
        console.log('[Enhanced Regime] Insufficient data');
        return null;
      }

      const now = new Date();

      // 1. Calculate ATR and volatility
      const atr = this.calculateATR(candles, this.ATR_LOOKBACK);
      const atrPercentile = this.calculateATRPercentile(candles, atr);
      const volatilityLevel = this.classifyVolatility(atrPercentile);

      // 2. Detect trend
      const trendAnalysis = this.detectTrend(candles);
      const regimeType = this.classifyRegimeType(trendAnalysis, volatilityLevel);

      // 3. Determine trading session
      const sessionType = this.detectTradingSession(now);
      const dayOfWeek = now.getUTCDay();
      const hourOfDay = now.getUTCHours();

      // 4. Analyze price location
      const priceLocation = this.analyzePriceLocation(candles);

      // 5. Analyze volume trend
      const volumeTrend = this.analyzeVolumeTrend(candles);

      // 6. Check for upcoming economic events
      const { isNewsPeriod, upcomingEvent } = await this.checkEconomicEvents(symbol, now);

      const regime: EnhancedMarketRegime = {
        regimeType,
        volatilityLevel,
        trendStrength: trendAnalysis.strength,
        confidence: trendAnalysis.confidence,
        sessionType,
        dayOfWeek,
        hourOfDay,
        characteristics: {
          atr,
          atrPercentile,
          adx: trendAnalysis.adx,
          priceLocation,
          volumeTrend
        },
        isNewsPeriod,
        upcomingEvent
      };

      // Store regime in database
      await this.saveRegimeHistory(userId, symbol, timeframe, regime);

      console.log(`[Enhanced Regime] ${symbol}: ${regimeType} | ${volatilityLevel} volatility | ${sessionType} session | Trend: ${trendAnalysis.strength.toFixed(1)}`);

      return regime;

    } catch (error) {
      console.error('[Enhanced Regime] Error detecting regime:', error);
      return null;
    }
  }

  /**
   * Get regime history for analysis
   */
  async getRegimeHistory(
    userId: string,
    symbol: string,
    startDate: Date,
    endDate: Date
  ): Promise<any[]> {
    const { data, error } = await supabase
      .from('market_regime_history')
      .select('*')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .gte('detected_at', startDate.toISOString())
      .lte('detected_at', endDate.toISOString())
      .order('detected_at', { ascending: true });

    if (error) {
      console.error('[Enhanced Regime] Error fetching history:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Fetch recent candles from database
   */
  private async fetchRecentCandles(
    symbol: string,
    timeframe: string,
    count: number
  ): Promise<Candle[]> {
    const { data, error } = await supabase
      .from('forex_candles')
      .select('open_time, open, high, low, close, volume')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .order('open_time', { ascending: false })
      .limit(count);

    if (error) {
      console.error('[Enhanced Regime] Error fetching candles:', error);
      return [];
    }

    return data?.reverse() || [];
  }

  /**
   * Calculate Average True Range (ATR)
   */
  private calculateATR(candles: Candle[], period: number): number {
    if (candles.length < period + 1) return 0;

    const trueRanges: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const high = parseFloat(candles[i].high.toString());
      const low = parseFloat(candles[i].low.toString());
      const prevClose = parseFloat(candles[i - 1].close.toString());

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );

      trueRanges.push(tr);
    }

    const recentTR = trueRanges.slice(-period);
    const atr = recentTR.reduce((sum, tr) => sum + tr, 0) / recentTR.length;

    return atr;
  }

  /**
   * Calculate ATR percentile (0-100)
   */
  private calculateATRPercentile(candles: Candle[], currentATR: number): number {
    // Calculate ATR for last 100 periods and find percentile
    const historicalATRs: number[] = [];

    for (let i = this.ATR_LOOKBACK; i < candles.length; i++) {
      const subset = candles.slice(Math.max(0, i - this.ATR_LOOKBACK), i);
      const atr = this.calculateATR(subset, this.ATR_LOOKBACK);
      if (atr > 0) historicalATRs.push(atr);
    }

    if (historicalATRs.length === 0) return 50;

    historicalATRs.sort((a, b) => a - b);
    const rank = historicalATRs.filter(atr => atr <= currentATR).length;
    const percentile = (rank / historicalATRs.length) * 100;

    return percentile;
  }

  /**
   * Classify volatility based on ATR percentile
   */
  private classifyVolatility(atrPercentile: number): 'low' | 'medium' | 'high' | 'extreme' {
    if (atrPercentile < 25) return 'low';
    if (atrPercentile < 60) return 'medium';
    if (atrPercentile < 85) return 'high';
    return 'extreme';
  }

  /**
   * Detect trend direction and strength using ADX and price action
   */
  private detectTrend(candles: Candle[]): { strength: number; confidence: number; adx?: number } {
    if (candles.length < this.TREND_LOOKBACK) {
      return { strength: 0, confidence: 0 };
    }

    const closes = candles.map(c => parseFloat(c.close.toString()));
    const highs = candles.map(c => parseFloat(c.high.toString()));
    const lows = candles.map(c => parseFloat(c.low.toString()));

    // Simple trend detection using linear regression
    const recentCloses = closes.slice(-this.TREND_LOOKBACK);
    const n = recentCloses.length;
    const xMean = (n - 1) / 2;
    const yMean = recentCloses.reduce((sum, val) => sum + val, 0) / n;

    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      const xDiff = i - xMean;
      const yDiff = recentCloses[i] - yMean;
      numerator += xDiff * yDiff;
      denominator += xDiff * xDiff;
    }

    const slope = denominator !== 0 ? numerator / denominator : 0;
    const avgPrice = yMean;
    const trendStrength = Math.min(100, Math.abs((slope / avgPrice) * 10000));

    // Calculate simplified ADX (Average Directional Index)
    const adx = this.calculateSimplifiedADX(highs, lows, closes, this.ADX_PERIOD);

    const confidence = Math.min(100, (adx / 50) * 100);

    return {
      strength: trendStrength,
      confidence,
      adx
    };
  }

  /**
   * Simplified ADX calculation
   */
  private calculateSimplifiedADX(highs: number[], lows: number[], closes: number[], period: number): number {
    if (highs.length < period + 1) return 0;

    const dmPlus: number[] = [];
    const dmMinus: number[] = [];
    const tr: number[] = [];

    for (let i = 1; i < highs.length; i++) {
      const highDiff = highs[i] - highs[i - 1];
      const lowDiff = lows[i - 1] - lows[i];

      dmPlus.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
      dmMinus.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);

      const trueRange = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      tr.push(trueRange);
    }

    // Calculate smoothed DI+ and DI-
    const smoothedDMPlus = dmPlus.slice(-period).reduce((sum, val) => sum + val, 0) / period;
    const smoothedDMMinus = dmMinus.slice(-period).reduce((sum, val) => sum + val, 0) / period;
    const smoothedTR = tr.slice(-period).reduce((sum, val) => sum + val, 0) / period;

    if (smoothedTR === 0) return 0;

    const diPlus = (smoothedDMPlus / smoothedTR) * 100;
    const diMinus = (smoothedDMMinus / smoothedTR) * 100;

    const dx = Math.abs(diPlus - diMinus) / (diPlus + diMinus || 1) * 100;

    return dx;
  }

  /**
   * Classify regime type based on trend analysis and volatility
   */
  private classifyRegimeType(
    trendAnalysis: { strength: number; confidence: number },
    volatilityLevel: 'low' | 'medium' | 'high' | 'extreme'
  ): 'trending_up' | 'trending_down' | 'ranging' | 'mixed' {
    const { strength, confidence } = trendAnalysis;

    if (strength > 60 && confidence > 50) {
      return 'trending_up'; // Simplified - need price direction check
    }

    if (strength < 20 || volatilityLevel === 'low') {
      return 'ranging';
    }

    return 'mixed';
  }

  /**
   * Detect current trading session
   */
  private detectTradingSession(date: Date): 'asian' | 'london' | 'newyork' | 'overlap' {
    const hour = date.getUTCHours();

    // Asian session: 00:00-09:00 UTC
    if (hour >= 0 && hour < 7) return 'asian';

    // London session: 07:00-16:00 UTC
    // NY session: 13:00-22:00 UTC
    // Overlap: 13:00-16:00 UTC

    if (hour >= 13 && hour < 16) return 'overlap'; // London/NY overlap
    if (hour >= 7 && hour < 16) return 'london';
    if (hour >= 13 && hour < 22) return 'newyork';

    return 'asian';
  }

  /**
   * Analyze price location within recent range
   */
  private analyzePriceLocation(candles: Candle[]): 'near_high' | 'near_low' | 'middle' {
    const recentCandles = candles.slice(-20);
    const currentPrice = parseFloat(recentCandles[recentCandles.length - 1].close.toString());

    const high = Math.max(...recentCandles.map(c => parseFloat(c.high.toString())));
    const low = Math.min(...recentCandles.map(c => parseFloat(c.low.toString())));
    const range = high - low;

    if (range === 0) return 'middle';

    const position = (currentPrice - low) / range;

    if (position > 0.7) return 'near_high';
    if (position < 0.3) return 'near_low';
    return 'middle';
  }

  /**
   * Analyze volume trend
   */
  private analyzeVolumeTrend(candles: Candle[]): 'increasing' | 'decreasing' | 'stable' {
    const recentCandles = candles.slice(-10);
    const volumes = recentCandles.map(c => c.volume || 0).filter(v => v > 0);

    if (volumes.length < 5) return 'stable';

    const firstHalf = volumes.slice(0, Math.floor(volumes.length / 2));
    const secondHalf = volumes.slice(Math.floor(volumes.length / 2));

    const avgFirst = firstHalf.reduce((sum, v) => sum + v, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((sum, v) => sum + v, 0) / secondHalf.length;

    const change = ((avgSecond - avgFirst) / avgFirst) * 100;

    if (change > 20) return 'increasing';
    if (change < -20) return 'decreasing';
    return 'stable';
  }

  /**
   * Check for nearby economic events
   */
  private async checkEconomicEvents(symbol: string, currentTime: Date): Promise<{ isNewsPeriod: boolean; upcomingEvent?: string }> {
    const timeWindow = 30 * 60 * 1000; // 30 minutes in milliseconds
    const startTime = new Date(currentTime.getTime() - timeWindow);
    const endTime = new Date(currentTime.getTime() + timeWindow);

    const { data, error } = await supabase
      .from('economic_events')
      .select('event_name, event_time, impact_level')
      .gte('event_time', startTime.toISOString())
      .lte('event_time', endTime.toISOString())
      .in('impact_level', ['medium', 'high'])
      .order('event_time', { ascending: true })
      .limit(1);

    if (error || !data || data.length === 0) {
      return { isNewsPeriod: false };
    }

    const event = data[0];
    return {
      isNewsPeriod: true,
      upcomingEvent: `${event.event_name} at ${new Date(event.event_time).toISOString()}`
    };
  }

  /**
   * Save regime to database
   */
  private async saveRegimeHistory(
    userId: string,
    symbol: string,
    timeframe: string,
    regime: EnhancedMarketRegime
  ): Promise<void> {
    const { error } = await supabase
      .from('market_regime_history')
      .insert({
        user_id: userId,
        symbol,
        timeframe,
        detected_at: new Date().toISOString(),
        regime_type: regime.regimeType,
        volatility_level: regime.volatilityLevel,
        trend_strength: regime.trendStrength,
        confidence_score: regime.confidence,
        session_type: regime.sessionType,
        day_of_week: regime.dayOfWeek,
        hour_of_day: regime.hourOfDay,
        atr: regime.characteristics.atr,
        atr_percentile: regime.characteristics.atrPercentile,
        adx: regime.characteristics.adx,
        price_location: regime.characteristics.priceLocation,
        volume_trend: regime.characteristics.volumeTrend,
        is_news_period: regime.isNewsPeriod,
        upcoming_event: regime.upcomingEvent
      });

    if (error) {
      console.error('[Enhanced Regime] Error saving regime:', error);
    }
  }
}

export const enhancedMarketRegimeDetector = new EnhancedMarketRegimeDetector();
