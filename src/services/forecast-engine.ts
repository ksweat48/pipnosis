import { supabase } from '../lib/supabase';

export interface MarketConditions {
  symbol: string;
  volatility: number;
  trend: 'bullish' | 'bearish' | 'sideways';
  volume: number;
  momentum: number;
  priceAction: string;
}

export interface ForecastResult {
  symbol: string;
  forecastType: 'next_scan' | 'setup_forming' | 'volatility_window';
  predictedTime: Date;
  confidenceScore: number;
  reasoning: string;
  conditions: MarketConditions;
}

class ForecastEngine {
  async analyzeTrendFormation(symbol: string, candles: any[]): Promise<{ forming: boolean; timeToSetup: number; confidence: number }> {
    if (!candles || candles.length < 50) {
      return { forming: false, timeToSetup: 60, confidence: 0 };
    }

    const recentCandles = candles.slice(-20);
    const prices = recentCandles.map(c => c.close);

    const ema20 = this.calculateEMA(prices, 20);
    const ema50 = this.calculateEMA(candles.slice(-50).map(c => c.close), 50);

    const currentPrice = prices[prices.length - 1];
    const priceToEma20Distance = Math.abs(currentPrice - ema20) / currentPrice * 100;
    const emaConvergence = Math.abs(ema20 - ema50) / ema50 * 100;

    let forming = false;
    let timeToSetup = 60;
    let confidence = 0;

    if (priceToEma20Distance < 0.5 && emaConvergence < 0.3) {
      forming = true;
      timeToSetup = 30;
      confidence = 75;
    } else if (priceToEma20Distance < 1.0 && emaConvergence < 0.5) {
      forming = true;
      timeToSetup = 45;
      confidence = 60;
    } else if (priceToEma20Distance < 1.5) {
      forming = false;
      timeToSetup = 60;
      confidence = 40;
    } else {
      forming = false;
      timeToSetup = 90;
      confidence = 20;
    }

    return { forming, timeToSetup, confidence };
  }

  calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] || 0;

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  async analyzeVolatility(symbol: string, candles: any[]): Promise<{ level: 'low' | 'medium' | 'high'; increasing: boolean; nextVolatileWindow: number }> {
    if (!candles || candles.length < 20) {
      return { level: 'medium', increasing: false, nextVolatileWindow: 60 };
    }

    const recentCandles = candles.slice(-20);
    const ranges = recentCandles.map(c => Math.abs(c.high - c.low));
    const avgRange = ranges.reduce((sum, r) => sum + r, 0) / ranges.length;

    const lastFiveRanges = ranges.slice(-5);
    const recentAvgRange = lastFiveRanges.reduce((sum, r) => sum + r, 0) / lastFiveRanges.length;

    const increasing = recentAvgRange > avgRange * 1.1;

    let level: 'low' | 'medium' | 'high' = 'medium';
    let nextVolatileWindow = 60;

    if (avgRange < 0.001) {
      level = 'low';
      nextVolatileWindow = 90;
    } else if (avgRange > 0.005) {
      level = 'high';
      nextVolatileWindow = 15;
    } else {
      level = 'medium';
      nextVolatileWindow = 30;
    }

    if (increasing) {
      nextVolatileWindow = Math.max(15, nextVolatileWindow - 15);
    }

    return { level, increasing, nextVolatileWindow };
  }

  async generateForecast(
    sessionId: string,
    symbol: string,
    candles: any[],
    scanInterval: number
  ): Promise<ForecastResult | null> {
    try {
      const trendAnalysis = await this.analyzeTrendFormation(symbol, candles);
      const volatilityAnalysis = await this.analyzeVolatility(symbol, candles);

      let forecastType: 'next_scan' | 'setup_forming' | 'volatility_window' = 'next_scan';
      let predictedMinutes = scanInterval;
      let confidenceScore = 50;
      let reasoning = '';

      if (trendAnalysis.forming && trendAnalysis.confidence > 70) {
        forecastType = 'setup_forming';
        predictedMinutes = trendAnalysis.timeToSetup;
        confidenceScore = trendAnalysis.confidence;
        reasoning = `Strong setup forming on ${symbol}. Price converging with EMA support/resistance. Expected entry opportunity in ${predictedMinutes} minutes based on momentum patterns.`;
      } else if (volatilityAnalysis.increasing && volatilityAnalysis.level === 'high') {
        forecastType = 'volatility_window';
        predictedMinutes = volatilityAnalysis.nextVolatileWindow;
        confidenceScore = 70;
        reasoning = `Volatility increasing on ${symbol}. High-probability trading window opening in ${predictedMinutes} minutes. Monitoring for breakout patterns.`;
      } else if (trendAnalysis.forming && trendAnalysis.confidence > 50) {
        forecastType = 'setup_forming';
        predictedMinutes = trendAnalysis.timeToSetup;
        confidenceScore = trendAnalysis.confidence;
        reasoning = `Potential setup developing on ${symbol}. Price action suggests possible entry in ${predictedMinutes} minutes. Confidence level: ${confidenceScore}%.`;
      } else if (volatilityAnalysis.level === 'low') {
        forecastType = 'next_scan';
        predictedMinutes = volatilityAnalysis.nextVolatileWindow;
        confidenceScore = 40;
        reasoning = `Market quiet on ${symbol}. Low volatility detected. Re-scanning in ${predictedMinutes} minutes when activity typically increases.`;
      } else {
        forecastType = 'next_scan';
        predictedMinutes = scanInterval;
        confidenceScore = 50;
        reasoning = `No valid setups on ${symbol} currently. Continuing systematic scan in ${predictedMinutes} minutes. Watching for VWAP and EMA convergence.`;
      }

      const predictedTime = new Date(Date.now() + predictedMinutes * 60 * 1000);

      const conditions: MarketConditions = {
        symbol,
        volatility: volatilityAnalysis.level === 'high' ? 80 : volatilityAnalysis.level === 'medium' ? 50 : 20,
        trend: this.determineTrend(candles),
        volume: 50,
        momentum: trendAnalysis.confidence,
        priceAction: trendAnalysis.forming ? 'converging' : 'ranging',
      };

      const { error } = await supabase
        .from('goal_forecasts')
        .insert({
          goal_session_id: sessionId,
          symbol,
          forecast_type: forecastType,
          predicted_time: predictedTime.toISOString(),
          confidence_score: confidenceScore,
          reasoning,
          conditions,
        });

      if (error) {
        console.error('Error saving forecast:', error);
      }

      return {
        symbol,
        forecastType,
        predictedTime,
        confidenceScore,
        reasoning,
        conditions,
      };
    } catch (error) {
      console.error('Error generating forecast:', error);
      return null;
    }
  }

  determineTrend(candles: any[]): 'bullish' | 'bearish' | 'sideways' {
    if (!candles || candles.length < 20) return 'sideways';

    const recentCandles = candles.slice(-20);
    const prices = recentCandles.map(c => c.close);

    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const change = ((lastPrice - firstPrice) / firstPrice) * 100;

    if (change > 0.5) return 'bullish';
    if (change < -0.5) return 'bearish';
    return 'sideways';
  }

  async getLatestForecast(sessionId: string): Promise<any | null> {
    try {
      const { data, error } = await supabase
        .from('goal_forecasts')
        .select('*')
        .eq('goal_session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error fetching latest forecast:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in getLatestForecast:', error);
      return null;
    }
  }

  async getSessionForecasts(sessionId: string, limit: number = 10): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('goal_forecasts')
        .select('*')
        .eq('goal_session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching forecasts:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getSessionForecasts:', error);
      return [];
    }
  }

  async validateForecast(forecastId: string, actualOutcome: string): Promise<void> {
    try {
      await supabase
        .from('goal_forecasts')
        .update({
          accuracy_validated: true,
          actual_outcome: actualOutcome,
        })
        .eq('id', forecastId);
    } catch (error) {
      console.error('Error validating forecast:', error);
    }
  }

  calculateNextScanTime(
    currentConditions: MarketConditions,
    baseInterval: number,
    recentForecasts: any[]
  ): number {
    let adjustedInterval = baseInterval;

    if (currentConditions.volatility > 70) {
      adjustedInterval = Math.max(10, baseInterval - 5);
    } else if (currentConditions.volatility < 30) {
      adjustedInterval = baseInterval + 15;
    }

    if (currentConditions.momentum > 70) {
      adjustedInterval = Math.max(10, adjustedInterval - 5);
    }

    if (recentForecasts.length > 0) {
      const lastForecast = recentForecasts[0];
      const timeSinceLastForecast = Date.now() - new Date(lastForecast.created_at).getTime();

      if (timeSinceLastForecast < 5 * 60 * 1000) {
        adjustedInterval = Math.max(adjustedInterval, 10);
      }
    }

    return adjustedInterval;
  }
}

export const forecastEngine = new ForecastEngine();
