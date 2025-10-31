import { calculateEMA, calculateRSI, calculateATR, detectCandlePatterns, CandlePattern } from '@/utils/technicalIndicators';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface MACD {
  macd: number;
  signal: number;
  histogram: number;
}

export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
}

export interface TechnicalSignal {
  symbol: string;
  timeframe: string;
  score: number;
  direction: 'buy' | 'sell';
  confidence: 'low' | 'medium' | 'high';
  currentPrice: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  indicators: {
    ema9: number;
    ema21: number;
    ema50: number;
    rsi: number;
    macd: MACD;
    bollingerBands: BollingerBands;
    atr: number;
    pattern?: CandlePattern;
  };
  reasons: string[];
  timestamp: Date;
}

export class TechnicalScanEngine {
  calculateMACD(candles: Candle[]): MACD[] {
    if (candles.length < 35) return [];

    const ema12 = calculateEMA(candles, 12);
    const ema26 = calculateEMA(candles, 26);

    const macdLine: { time: number; value: number }[] = [];
    for (let i = 0; i < Math.min(ema12.length, ema26.length); i++) {
      macdLine.push({
        time: ema12[i].time,
        value: ema12[i].value - ema26[i].value
      });
    }

    const macdCandles = macdLine.map(m => ({
      time: m.time,
      open: m.value,
      high: m.value,
      low: m.value,
      close: m.value
    }));

    const signalLine = calculateEMA(macdCandles, 9);

    const results: MACD[] = [];
    for (let i = 0; i < Math.min(macdLine.length, signalLine.length); i++) {
      results.push({
        macd: macdLine[i].value,
        signal: signalLine[i].value,
        histogram: macdLine[i].value - signalLine[i].value
      });
    }

    return results;
  }

  calculateBollingerBands(candles: Candle[], period: number = 20): BollingerBands[] {
    if (candles.length < period) return [];

    const results: BollingerBands[] = [];

    for (let i = period - 1; i < candles.length; i++) {
      const slice = candles.slice(i - period + 1, i + 1);
      const closes = slice.map(c => c.close);

      const sma = closes.reduce((sum, val) => sum + val, 0) / period;

      const variance = closes.reduce((sum, val) => sum + Math.pow(val - sma, 2), 0) / period;
      const stdDev = Math.sqrt(variance);

      results.push({
        upper: sma + (stdDev * 2),
        middle: sma,
        lower: sma - (stdDev * 2)
      });
    }

    return results;
  }

  detectSupportResistance(candles: Candle[], lookback: number = 50): { support: number; resistance: number } {
    if (candles.length < lookback) {
      lookback = candles.length;
    }

    const recentCandles = candles.slice(-lookback);
    const lows = recentCandles.map(c => c.low);
    const highs = recentCandles.map(c => c.high);

    const support = Math.min(...lows);
    const resistance = Math.max(...highs);

    return { support, resistance };
  }

  calculateTrendStrength(ema9: number, ema21: number, ema50: number): number {
    if (ema9 > ema21 && ema21 > ema50) {
      const separation = ((ema9 - ema50) / ema50) * 100;
      return Math.min(separation * 10, 100);
    } else if (ema9 < ema21 && ema21 < ema50) {
      const separation = ((ema50 - ema9) / ema50) * 100;
      return Math.min(separation * 10, 100);
    }
    return 0;
  }

  isEmaCrossover(currentEma9: number, currentEma21: number, prevEma9: number, prevEma21: number): {
    isCrossover: boolean;
    direction: 'bullish' | 'bearish' | null
  } {
    const bullishCross = prevEma9 <= prevEma21 && currentEma9 > currentEma21;
    const bearishCross = prevEma9 >= prevEma21 && currentEma9 < currentEma21;

    return {
      isCrossover: bullishCross || bearishCross,
      direction: bullishCross ? 'bullish' : bearishCross ? 'bearish' : null
    };
  }

  analyzeTechnicals(symbol: string, timeframe: string, candles: Candle[]): TechnicalSignal | null {
    if (candles.length < 60) {
      return null;
    }

    const ema9Results = calculateEMA(candles, 9);
    const ema21Results = calculateEMA(candles, 21);
    const ema50Results = calculateEMA(candles, 50);
    const rsiResults = calculateRSI(candles, 14);
    const atrResults = calculateATR(candles, 14);
    const macdResults = this.calculateMACD(candles);
    const bbResults = this.calculateBollingerBands(candles);
    const patterns = detectCandlePatterns(candles);

    if (ema9Results.length === 0 || ema21Results.length === 0 || ema50Results.length === 0 ||
        rsiResults.length === 0 || atrResults.length === 0 || macdResults.length === 0 ||
        bbResults.length === 0) {
      return null;
    }

    const currentCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];

    const ema9 = ema9Results[ema9Results.length - 1].value;
    const ema21 = ema21Results[ema21Results.length - 1].value;
    const ema50 = ema50Results[ema50Results.length - 1].value;
    const prevEma9 = ema9Results[ema9Results.length - 2].value;
    const prevEma21 = ema21Results[ema21Results.length - 2].value;

    const rsi = rsiResults[rsiResults.length - 1].value;
    const atr = atrResults[atrResults.length - 1].value;
    const macd = macdResults[macdResults.length - 1];
    const bb = bbResults[bbResults.length - 1];

    const recentPattern = patterns.length > 0 ? patterns[patterns.length - 1] : null;
    const { support, resistance } = this.detectSupportResistance(candles);

    const emaCross = this.isEmaCrossover(ema9, ema21, prevEma9, prevEma21);
    const trendStrength = this.calculateTrendStrength(ema9, ema21, ema50);

    let score = 0;
    let direction: 'buy' | 'sell' = 'buy';
    const reasons: string[] = [];

    const bullishSignals = {
      emaCrossover: emaCross.isCrossover && emaCross.direction === 'bullish',
      emaAlignment: ema9 > ema21 && ema21 > ema50,
      rsiOversold: rsi < 35,
      rsiNeutral: rsi >= 40 && rsi <= 60,
      macdBullish: macd.macd > macd.signal && macd.histogram > 0,
      macdCrossover: macd.histogram > 0 && macd.histogram > (macdResults[macdResults.length - 2]?.histogram || 0),
      priceBelowBB: currentCandle.close < bb.lower,
      priceAboveBB: currentCandle.close > bb.middle,
      bullishPattern: recentPattern && ['Hammer', 'Bullish Engulfing', 'Momentum Bullish'].includes(recentPattern.pattern),
      nearSupport: Math.abs(currentCandle.close - support) < (atr * 0.5)
    };

    const bearishSignals = {
      emaCrossover: emaCross.isCrossover && emaCross.direction === 'bearish',
      emaAlignment: ema9 < ema21 && ema21 < ema50,
      rsiOverbought: rsi > 65,
      rsiNeutral: rsi >= 40 && rsi <= 60,
      macdBearish: macd.macd < macd.signal && macd.histogram < 0,
      macdCrossover: macd.histogram < 0 && macd.histogram < (macdResults[macdResults.length - 2]?.histogram || 0),
      priceAboveBB: currentCandle.close > bb.upper,
      priceBelowBB: currentCandle.close < bb.middle,
      bearishPattern: recentPattern && ['Inverted Hammer', 'Bearish Engulfing', 'Momentum Bearish'].includes(recentPattern.pattern),
      nearResistance: Math.abs(currentCandle.close - resistance) < (atr * 0.5)
    };

    const bullishScore = Object.values(bullishSignals).filter(Boolean).length;
    const bearishScore = Object.values(bearishSignals).filter(Boolean).length;

    if (bullishScore > bearishScore) {
      direction = 'buy';

      if (bullishSignals.emaCrossover) { score += 20; reasons.push('EMA bullish crossover'); }
      if (bullishSignals.emaAlignment) { score += 15; reasons.push('Strong uptrend alignment'); }
      if (bullishSignals.rsiOversold) { score += 15; reasons.push('RSI oversold reversal'); }
      if (bullishSignals.rsiNeutral) { score += 5; reasons.push('RSI neutral momentum'); }
      if (bullishSignals.macdBullish) { score += 10; reasons.push('MACD bullish'); }
      if (bullishSignals.macdCrossover) { score += 15; reasons.push('MACD bullish crossover'); }
      if (bullishSignals.priceBelowBB) { score += 10; reasons.push('Price bouncing from lower BB'); }
      if (bullishSignals.priceAboveBB) { score += 5; reasons.push('Price above middle BB'); }
      if (bullishSignals.bullishPattern) { score += 10; reasons.push(`Bullish pattern: ${recentPattern?.pattern}`); }
      if (bullishSignals.nearSupport) { score += 10; reasons.push('Near support level'); }

      score += Math.min(trendStrength / 2, 10);

    } else if (bearishScore > bullishScore) {
      direction = 'sell';

      if (bearishSignals.emaCrossover) { score += 20; reasons.push('EMA bearish crossover'); }
      if (bearishSignals.emaAlignment) { score += 15; reasons.push('Strong downtrend alignment'); }
      if (bearishSignals.rsiOverbought) { score += 15; reasons.push('RSI overbought reversal'); }
      if (bearishSignals.rsiNeutral) { score += 5; reasons.push('RSI neutral momentum'); }
      if (bearishSignals.macdBearish) { score += 10; reasons.push('MACD bearish'); }
      if (bearishSignals.macdCrossover) { score += 15; reasons.push('MACD bearish crossover'); }
      if (bearishSignals.priceAboveBB) { score += 10; reasons.push('Price rejecting upper BB'); }
      if (bearishSignals.priceBelowBB) { score += 5; reasons.push('Price below middle BB'); }
      if (bearishSignals.bearishPattern) { score += 10; reasons.push(`Bearish pattern: ${recentPattern?.pattern}`); }
      if (bearishSignals.nearResistance) { score += 10; reasons.push('Near resistance level'); }

      score += Math.min(trendStrength / 2, 10);
    } else {
      return null;
    }

    if (score < 50) {
      return null;
    }

    const confidence: 'low' | 'medium' | 'high' =
      score >= 85 ? 'high' :
      score >= 70 ? 'medium' : 'low';

    const currentPrice = currentCandle.close;
    const atrMultiplier = direction === 'buy' ? 1 : -1;

    const stopLoss = direction === 'buy'
      ? currentPrice - (atr * 1.5)
      : currentPrice + (atr * 1.5);

    const takeProfit = direction === 'buy'
      ? currentPrice + (atr * 3)
      : currentPrice - (atr * 3);

    return {
      symbol,
      timeframe,
      score: Math.min(score, 100),
      direction,
      confidence,
      currentPrice,
      entryPrice: currentPrice,
      stopLoss,
      takeProfit,
      indicators: {
        ema9,
        ema21,
        ema50,
        rsi,
        macd,
        bollingerBands: bb,
        atr,
        pattern: recentPattern?.pattern
      },
      reasons,
      timestamp: new Date()
    };
  }

  scanMultipleSymbols(symbols: string[], candleData: Map<string, Candle[]>, timeframe: string): TechnicalSignal[] {
    const signals: TechnicalSignal[] = [];

    for (const symbol of symbols) {
      const candles = candleData.get(symbol);
      if (!candles) continue;

      const signal = this.analyzeTechnicals(symbol, timeframe, candles);
      if (signal && signal.score >= 60) {
        signals.push(signal);
      }
    }

    return signals.sort((a, b) => b.score - a.score);
  }
}

export const technicalScanEngine = new TechnicalScanEngine();
