import { supabase } from '../lib/supabase';
import { forecastEngine, MarketConditions } from './forecast-engine';
import { goalSessionManager } from './goal-session-manager';
import { tradeExecutionEngine } from './trade-execution-engine';

export interface ScanResult {
  symbol: string;
  hasValidSetup: boolean;
  setupType?: string;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  confidence?: number;
  reasoning?: string;
  marketConditions: MarketConditions;
}

export interface TradeSignal {
  sessionId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  positionSize: number;
  confidence: number;
  setupType: string;
  reasoning: string;
  riskReward: number;
  expectedProfit: number;
}

class GoalScanner {
  async scanMarket(sessionId: string, userId: string): Promise<ScanResult[]> {
    try {
      const session = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (session.error || !session.data) {
        console.error('Session not found:', session.error);
        return [];
      }

      const watchlist = session.data.watchlist || ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD'];
      const results: ScanResult[] = [];

      for (const symbol of watchlist) {
        const scanResult = await this.scanSymbol(symbol, session.data);
        results.push(scanResult);
      }

      const lastScanTime = new Date();
      const nextScanTime = new Date(lastScanTime.getTime() + session.data.scan_interval_minutes * 60 * 1000);

      await goalSessionManager.updateScanTime(sessionId, lastScanTime, nextScanTime);

      const validSetups = results.filter(r => r.hasValidSetup);

      if (validSetups.length > 0) {
        console.log(`[Goal Scanner] Found ${validSetups.length} valid setup(s), evaluating for execution...`);

        for (const setup of validSetups) {
          const signal = await this.evaluateSignal(sessionId, setup, session.data);
          if (signal) {
            const executionResult = await tradeExecutionEngine.executeSignal(
              signal,
              userId,
              session.data.auto_execute
            );

            if (executionResult.success) {
              console.log(`[Goal Scanner] Trade signal processed: ${executionResult.message}`);
            } else {
              console.warn(`[Goal Scanner] Signal execution failed: ${executionResult.error}`);
            }
          }
        }
      }

      await goalSessionManager.addAIMessage(
        sessionId,
        userId,
        this.generateScanSummary(results),
        { scanResults: results },
        'neutral'
      );

      return results;
    } catch (error) {
      console.error('Error scanning market:', error);
      return [];
    }
  }

  async scanSymbol(symbol: string, sessionConfig: any): Promise<ScanResult> {
    try {
      const { data: candles } = await supabase
        .from('market_data')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', '15m')
        .order('timestamp', { ascending: false })
        .limit(100);

      if (!candles || candles.length < 50) {
        return {
          symbol,
          hasValidSetup: false,
          marketConditions: {
            symbol,
            volatility: 0,
            trend: 'sideways',
            volume: 0,
            momentum: 0,
            priceAction: 'insufficient_data',
          },
        };
      }

      const setup = await this.detectSetup(symbol, candles, sessionConfig);

      return setup;
    } catch (error) {
      console.error(`Error scanning ${symbol}:`, error);
      return {
        symbol,
        hasValidSetup: false,
        marketConditions: {
          symbol,
          volatility: 0,
          trend: 'sideways',
          volume: 0,
          momentum: 0,
          priceAction: 'error',
        },
      };
    }
  }

  async detectSetup(symbol: string, candles: any[], sessionConfig: any): Promise<ScanResult> {
    const recentCandles = candles.slice(0, 50).reverse();
    const prices = recentCandles.map(c => c.close);
    const currentPrice = prices[prices.length - 1];

    const ema20 = this.calculateEMA(prices, 20);
    const ema50 = this.calculateEMA(prices, 50);

    const vwap = this.calculateVWAP(recentCandles.slice(-20));

    const atr = this.calculateATR(recentCandles.slice(-14));

    const priceToEma20 = ((currentPrice - ema20) / currentPrice) * 100;
    const priceToVwap = ((currentPrice - vwap) / currentPrice) * 100;

    const volatilityAnalysis = await forecastEngine.analyzeVolatility(symbol, candles);
    const trendAnalysis = await forecastEngine.analyzeTrendFormation(symbol, candles);

    const marketConditions: MarketConditions = {
      symbol,
      volatility: volatilityAnalysis.level === 'high' ? 80 : volatilityAnalysis.level === 'medium' ? 50 : 20,
      trend: this.determineTrend(recentCandles),
      volume: 50,
      momentum: trendAnalysis.confidence,
      priceAction: this.analyzePriceAction(recentCandles.slice(-5)),
    };

    let hasValidSetup = false;
    let setupType = '';
    let entry = currentPrice;
    let stopLoss = 0;
    let takeProfit = 0;
    let confidence = 0;
    let reasoning = '';

    if (Math.abs(priceToVwap) < 0.1 && ema20 > ema50 && priceToEma20 > -0.2 && priceToEma20 < 0.3) {
      hasValidSetup = true;
      setupType = 'VWAP Bounce Long';
      entry = currentPrice;
      stopLoss = currentPrice - (atr * 1.5);
      takeProfit = currentPrice + (atr * 2.5);
      confidence = 75;
      reasoning = `Bullish setup on ${symbol}. Price testing VWAP support with EMA alignment. Entry: ${entry.toFixed(5)}, SL: ${stopLoss.toFixed(5)}, TP: ${takeProfit.toFixed(5)}`;
    } else if (Math.abs(priceToVwap) < 0.1 && ema20 < ema50 && priceToEma20 < 0.2 && priceToEma20 > -0.3) {
      hasValidSetup = true;
      setupType = 'VWAP Rejection Short';
      entry = currentPrice;
      stopLoss = currentPrice + (atr * 1.5);
      takeProfit = currentPrice - (atr * 2.5);
      confidence = 75;
      reasoning = `Bearish setup on ${symbol}. Price rejecting VWAP resistance with EMA alignment. Entry: ${entry.toFixed(5)}, SL: ${stopLoss.toFixed(5)}, TP: ${takeProfit.toFixed(5)}`;
    } else if (trendAnalysis.forming && trendAnalysis.confidence > 70) {
      hasValidSetup = true;
      setupType = 'EMA Trend Following';
      entry = currentPrice;
      const direction = ema20 > ema50 ? 1 : -1;
      stopLoss = currentPrice - (direction * atr * 1.5);
      takeProfit = currentPrice + (direction * atr * 2.5);
      confidence = trendAnalysis.confidence;
      reasoning = `${direction > 0 ? 'Bullish' : 'Bearish'} trend setup on ${symbol}. EMA crossover confirmed with momentum. Entry: ${entry.toFixed(5)}, SL: ${stopLoss.toFixed(5)}, TP: ${takeProfit.toFixed(5)}`;
    }

    const riskThreshold = this.getRiskThreshold(sessionConfig.risk_mode);
    if (hasValidSetup && confidence < riskThreshold) {
      hasValidSetup = false;
      reasoning = `Setup confidence (${confidence}%) below risk threshold (${riskThreshold}%) for ${sessionConfig.risk_mode} mode.`;
    }

    return {
      symbol,
      hasValidSetup,
      setupType,
      entry,
      stopLoss,
      takeProfit,
      confidence,
      reasoning,
      marketConditions,
    };
  }

  getRiskThreshold(riskMode: string): number {
    const thresholds = {
      low: 80,
      medium: 70,
      high: 60,
    };
    return thresholds[riskMode as keyof typeof thresholds] || 70;
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

  calculateVWAP(candles: any[]): number {
    let totalVolume = 0;
    let totalPV = 0;

    for (const candle of candles) {
      const typical = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume || 1;
      totalPV += typical * volume;
      totalVolume += volume;
    }

    return totalVolume > 0 ? totalPV / totalVolume : 0;
  }

  calculateATR(candles: any[], period: number = 14): number {
    if (candles.length < period) return 0.001;

    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trs.push(tr);
    }

    return trs.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
  }

  determineTrend(candles: any[]): 'bullish' | 'bearish' | 'sideways' {
    if (!candles || candles.length < 20) return 'sideways';

    const prices = candles.map(c => c.close);
    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const change = ((lastPrice - firstPrice) / firstPrice) * 100;

    if (change > 0.5) return 'bullish';
    if (change < -0.5) return 'bearish';
    return 'sideways';
  }

  analyzePriceAction(candles: any[]): string {
    if (!candles || candles.length < 3) return 'insufficient';

    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];

    const bodySize = Math.abs(lastCandle.close - lastCandle.open);
    const wickSize = lastCandle.high - lastCandle.low;
    const bodyRatio = bodySize / wickSize;

    if (bodyRatio > 0.7) return 'strong_momentum';
    if (bodyRatio < 0.3) return 'indecision';

    const bullish = lastCandle.close > lastCandle.open;
    const prevBullish = prevCandle.close > prevCandle.open;

    if (bullish === prevBullish) return 'trending';
    return 'reversal';
  }

  generateScanSummary(results: ScanResult[]): string {
    const validSetups = results.filter(r => r.hasValidSetup);

    if (validSetups.length > 0) {
      const setupList = validSetups.map(s => `${s.symbol} (${s.setupType}, ${s.confidence}%)`).join(', ');
      return `Found ${validSetups.length} valid setup${validSetups.length > 1 ? 's' : ''}: ${setupList}. Preparing trade signals...`;
    }

    const highConfidenceForecasts = results.filter(r => r.marketConditions.momentum > 60);
    if (highConfidenceForecasts.length > 0) {
      return `No valid setups yet, but monitoring ${highConfidenceForecasts[0].symbol} — setup potentially forming soon. Will re-scan shortly.`;
    }

    return `Markets currently quiet across watchlist. No valid setups meeting risk criteria. Continuing scheduled scans...`;
  }

  async evaluateSignal(
    sessionId: string,
    scanResult: ScanResult,
    sessionConfig: any
  ): Promise<TradeSignal | null> {
    if (!scanResult.hasValidSetup) return null;

    const direction: 'buy' | 'sell' = scanResult.reasoning?.toLowerCase().includes('bearish') ? 'sell' : 'buy';

    const riskAmount = this.calculateRiskAmount(sessionConfig);
    const stopDistance = Math.abs(scanResult.entry! - scanResult.stopLoss!);
    const positionSize = stopDistance > 0 ? riskAmount / stopDistance : 0.01;

    const riskReward = Math.abs(scanResult.takeProfit! - scanResult.entry!) / stopDistance;
    const expectedProfit = (scanResult.takeProfit! - scanResult.entry!) * positionSize * (direction === 'buy' ? 1 : -1);

    return {
      sessionId,
      symbol: scanResult.symbol,
      direction,
      entryPrice: scanResult.entry!,
      stopLoss: scanResult.stopLoss!,
      takeProfit: scanResult.takeProfit!,
      positionSize,
      confidence: scanResult.confidence!,
      setupType: scanResult.setupType!,
      reasoning: scanResult.reasoning!,
      riskReward,
      expectedProfit: Math.abs(expectedProfit),
    };
  }

  calculateRiskAmount(sessionConfig: any): number {
    const balance = sessionConfig.starting_balance;
    const riskPercentages = {
      low: 0.01,
      medium: 0.02,
      high: 0.03,
    };

    const riskPercent = riskPercentages[sessionConfig.risk_mode as keyof typeof riskPercentages] || 0.02;
    return balance * riskPercent;
  }
}

export const goalScanner = new GoalScanner();
