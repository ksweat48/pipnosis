import { Candle, calculateRSI, calculateEMA, calculateATR } from '@/lib/indicators';
import { analyzeMarket, AiMarketSummary } from '@/lib/aiMarketEngine';
import { detectCandlePattern } from '@/lib/candlePatterns';
import { detectAdvancedPattern } from '@/lib/advancedPatterns';
import { PairAnalysisSnapshot } from './ai-pair-prediction';

export interface ConsolidatedPairAnalysis {
  snapshot: PairAnalysisSnapshot;
  marketSummary: AiMarketSummary;
  displaySummary: string;
  readinessIndicator: 'ready' | 'close' | 'far' | 'not_viable';
}

class ConsolidatedPairAnalysisService {
  async analyzePair(
    symbol: string,
    candles: Candle[],
    userId: string,
    sessionId?: string,
    timeframe: string = 'M15'
  ): Promise<ConsolidatedPairAnalysis> {
    if (candles.length < 50) {
      throw new Error(`Insufficient candles for analysis. Got ${candles.length}, need at least 50`);
    }

    const marketSummary = await analyzeMarket(candles);

    const currentCandle = candles[candles.length - 1];
    const currentPrice = currentCandle.close;

    const rsiValue = calculateRSI(candles, 14);
    const rsiStatus = this.getRSIStatus(rsiValue);

    const ema9Values = this.calculateEMAArray(candles, 9);
    const ema21Values = this.calculateEMAArray(candles, 21);
    const ema9 = ema9Values[ema9Values.length - 1];
    const ema21 = ema21Values[ema21Values.length - 1];

    const vwapValue = marketSummary.vwap?.value || 0;
    const vwapSpread = currentPrice - vwapValue;
    const vwapPosition = this.getVWAPPosition(currentPrice, vwapValue);

    const atrValue = calculateATR(candles, 14);
    const atrStatus = this.getATRStatus(atrValue, currentPrice);

    const volumeData = this.analyzeVolume(candles);

    const emaCrossoverStatus = this.getEMACrossoverStatus(ema9, ema21, ema9Values, ema21Values);
    const emaSlopeDirection = this.getEMASlopeDirection(ema9Values);

    const candlePattern = detectCandlePattern(candles);

    const advancedPattern = detectAdvancedPattern(candles);

    const trendStrength = this.calculateTrendStrength(ema9Values, ema21Values, candles);

    const snapshot: PairAnalysisSnapshot = {
      userId,
      sessionId,
      symbol,
      timeframe,
      currentPrice,
      spreadFromVwap: vwapSpread,
      spreadFromEma9: currentPrice - ema9,
      rsiValue,
      rsiStatus,
      vwapValue,
      vwapPosition,
      vwapSpread,
      volumeChangePercent: volumeData.changePercent,
      volumeStatus: volumeData.status,
      volume20barAvg: volumeData.avg,
      atrValue,
      atrStatus,
      ema9Value: ema9,
      ema21Value: ema21,
      emaCrossoverStatus,
      emaSlopeDirection,
      trendStrengthPercent: trendStrength,
      priceStructureTag: advancedPattern?.type || 'Unknown',
      structureConfidence: (advancedPattern?.confidence as 'LOW' | 'MODERATE' | 'HIGH') || 'LOW',
      candlePatternName: candlePattern?.type || 'None',
      candlePatternDirection: candlePattern?.direction?.toUpperCase() as 'BULLISH' | 'BEARISH' | 'NEUTRAL' || 'NEUTRAL',
      candlePatternConfidence: candlePattern?.strength === 'Strong' ? 'HIGH' : candlePattern?.strength === 'Moderate' ? 'MODERATE' : 'LOW',
      marketSentiment: marketSummary.sentiment?.status || 'NEUTRAL',
      sentimentConfidence: marketSummary.sentiment?.confidence || 0,
      combinedScore: this.calculateCombinedScore(marketSummary, rsiStatus, vwapPosition, volumeData.status),
      fullAnalysis: {
        marketSummary,
        candlePattern,
        advancedPattern,
        technicalIndicators: {
          rsi: rsiValue,
          ema9,
          ema21,
          atr: atrValue,
          vwap: vwapValue
        }
      }
    };

    const displaySummary = this.buildDisplaySummary(snapshot, marketSummary);
    const readinessIndicator = this.assessReadiness(snapshot, marketSummary);

    return {
      snapshot,
      marketSummary,
      displaySummary,
      readinessIndicator
    };
  }

  private getRSIStatus(rsiValue: number): 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL' {
    if (rsiValue > 70) return 'OVERBOUGHT';
    if (rsiValue < 30) return 'OVERSOLD';
    return 'NEUTRAL';
  }

  private getVWAPPosition(currentPrice: number, vwapValue: number): 'ABOVE' | 'BELOW' | 'NEAR' {
    const percentDiff = Math.abs((currentPrice - vwapValue) / vwapValue) * 100;
    if (percentDiff < 0.05) return 'NEAR';
    return currentPrice > vwapValue ? 'ABOVE' : 'BELOW';
  }

  private getATRStatus(atrValue: number, currentPrice: number): 'LOW' | 'NORMAL' | 'HIGH' {
    const atrPercent = (atrValue / currentPrice) * 100;
    if (atrPercent < 0.3) return 'LOW';
    if (atrPercent > 0.8) return 'HIGH';
    return 'NORMAL';
  }

  private analyzeVolume(candles: Candle[]): {
    changePercent: number;
    status: 'LOW' | 'STABLE' | 'HIGH';
    avg: number;
  } {
    const volumes = candles.map(c => c.volume || 0);
    const last20 = volumes.slice(-20);
    const avg = last20.reduce((a, b) => a + b, 0) / last20.length;
    const current = volumes[volumes.length - 1];
    const changePercent = ((current - avg) / avg) * 100;

    let status: 'LOW' | 'STABLE' | 'HIGH';
    if (changePercent > 30) status = 'HIGH';
    else if (changePercent < -30) status = 'LOW';
    else status = 'STABLE';

    return { changePercent, status, avg };
  }

  private calculateEMAArray(candles: Candle[], period: number): number[] {
    const emaValues: number[] = [];
    const closePrices = candles.map(c => c.close);

    for (let i = period; i <= closePrices.length; i++) {
      const subset = closePrices.slice(0, i);
      const emaValue = calculateEMA(subset, period);
      emaValues.push(emaValue);
    }

    return emaValues;
  }

  private getEMACrossoverStatus(ema9: number, ema21: number, ema9Values: number[], ema21Values: number[]): string {
    const prevEma9 = ema9Values[ema9Values.length - 2];
    const prevEma21 = ema21Values[ema21Values.length - 2];

    const currentGap = Math.abs(ema9 - ema21);
    const percentGap = (currentGap / ema21) * 100;

    if (ema9 > ema21 && prevEma9 <= prevEma21) {
      return 'Bullish Crossover (EMA9 crossed above EMA21)';
    } else if (ema9 < ema21 && prevEma9 >= prevEma21) {
      return 'Bearish Crossover (EMA9 crossed below EMA21)';
    } else if (ema9 > ema21) {
      if (percentGap < 0.1) return 'Bullish (EMA9 near EMA21 - potential pullback)';
      return 'Bullish (EMA9 above EMA21)';
    } else {
      if (percentGap < 0.1) return 'Bearish (EMA9 near EMA21 - potential pullback)';
      return 'Bearish (EMA9 below EMA21)';
    }
  }

  private getEMASlopeDirection(emaValues: number[]): 'UP' | 'DOWN' | 'FLAT' {
    const last5 = emaValues.slice(-5);
    const first = last5[0];
    const last = last5[last5.length - 1];
    const percentChange = ((last - first) / first) * 100;

    if (percentChange > 0.1) return 'UP';
    if (percentChange < -0.1) return 'DOWN';
    return 'FLAT';
  }

  private calculateTrendStrength(ema9Values: number[], ema21Values: number[], candles: Candle[]): number {
    const ema9Slope = this.calculateSlope(ema9Values.slice(-10));
    const ema21Slope = this.calculateSlope(ema21Values.slice(-10));

    const priceSlope = this.calculateSlope(candles.slice(-10).map(c => c.close));

    const slopeAlignment = (ema9Slope > 0 && ema21Slope > 0 && priceSlope > 0) ||
                          (ema9Slope < 0 && ema21Slope < 0 && priceSlope < 0);

    const gap = Math.abs(ema9Values[ema9Values.length - 1] - ema21Values[ema21Values.length - 1]);
    const gapPercent = (gap / ema21Values[ema21Values.length - 1]) * 100;

    let strength = 50;
    if (slopeAlignment) strength += 30;
    strength += Math.min(gapPercent * 20, 20);

    return Math.min(Math.max(strength, 0), 100);
  }

  private calculateSlope(values: number[]): number {
    if (values.length < 2) return 0;
    const n = values.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }

    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  }

  private calculateCombinedScore(
    marketSummary: AiMarketSummary,
    rsiStatus: string,
    vwapPosition: string,
    volumeStatus: string
  ): number {
    let score = 0;

    if (marketSummary.sentiment) {
      score += marketSummary.sentiment.confidence * 0.3;
    }

    if (rsiStatus === 'OVERSOLD' || rsiStatus === 'OVERBOUGHT') {
      score += 20;
    } else {
      score += 10;
    }

    if (vwapPosition === 'NEAR') {
      score += 20;
    } else {
      score += 5;
    }

    if (volumeStatus === 'HIGH') {
      score += 15;
    } else if (volumeStatus === 'STABLE') {
      score += 10;
    } else {
      score += 5;
    }

    if (marketSummary.tradeSignal?.status === 'VALID') {
      score += 15;
    }

    return Math.min(score, 100);
  }

  private buildDisplaySummary(snapshot: PairAnalysisSnapshot, marketSummary: AiMarketSummary): string {
    const sections = [];

    sections.push(`📊 ${snapshot.symbol} - ${snapshot.timeframe} Analysis`);
    sections.push(`Current Price: ${snapshot.currentPrice.toFixed(5)}`);
    sections.push('');

    sections.push('🔢 Key Indicators:');
    sections.push(`RSI (14): ${snapshot.rsiValue?.toFixed(1)} - ${snapshot.rsiStatus}`);
    sections.push(`VWAP: ${snapshot.vwapPosition} (spread: ${snapshot.vwapSpread?.toFixed(5)})`);
    sections.push(`Volume: ${snapshot.volumeStatus} (${snapshot.volumeChangePercent?.toFixed(1)}% vs avg)`);
    sections.push(`ATR (14): ${snapshot.atrValue?.toFixed(6)} - ${snapshot.atrStatus} volatility`);
    sections.push('');

    sections.push('📈 EMA Trend:');
    sections.push(`${snapshot.emaCrossoverStatus}`);
    sections.push(`Slope: ${snapshot.emaSlopeDirection}, Strength: ${snapshot.trendStrengthPercent?.toFixed(0)}%`);
    sections.push('');

    sections.push('🧬 Pattern & Structure:');
    sections.push(`Structure: ${snapshot.priceStructureTag} (${snapshot.structureConfidence})`);
    if (snapshot.candlePatternName !== 'None') {
      sections.push(`Candle: ${snapshot.candlePatternName} - ${snapshot.candlePatternDirection} (${snapshot.candlePatternConfidence})`);
    }
    sections.push('');

    sections.push('🧠 Market Sentiment:');
    sections.push(`${snapshot.marketSentiment} - ${snapshot.sentimentConfidence?.toFixed(0)}% confidence`);
    sections.push(`Combined Score: ${snapshot.combinedScore?.toFixed(0)}/100`);

    return sections.join('\n');
  }

  private assessReadiness(snapshot: PairAnalysisSnapshot, marketSummary: AiMarketSummary): 'ready' | 'close' | 'far' | 'not_viable' {
    let readySignals = 0;
    let totalSignals = 0;

    totalSignals++;
    if (snapshot.rsiStatus === 'OVERSOLD' || snapshot.rsiStatus === 'OVERBOUGHT') {
      readySignals++;
    }

    totalSignals++;
    if (snapshot.vwapPosition === 'NEAR') {
      readySignals++;
    }

    totalSignals++;
    if (snapshot.volumeStatus === 'HIGH') {
      readySignals++;
    }

    totalSignals++;
    if (snapshot.emaCrossoverStatus?.includes('Crossover')) {
      readySignals++;
    }

    totalSignals++;
    if (snapshot.candlePatternConfidence === 'HIGH') {
      readySignals++;
    }

    totalSignals++;
    if ((snapshot.sentimentConfidence || 0) > 70) {
      readySignals++;
    }

    const readinessPercent = (readySignals / totalSignals) * 100;

    if (readinessPercent >= 80) return 'ready';
    if (readinessPercent >= 60) return 'close';
    if (readinessPercent < 40) return 'not_viable';
    return 'far';
  }
}

export const consolidatedPairAnalysisService = new ConsolidatedPairAnalysisService();
