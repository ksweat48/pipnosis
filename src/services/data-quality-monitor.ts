import { Timeframe, TickData } from './metaapi';
import TinyEmitter from 'tiny-emitter';

export type DataQualityScore = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

export interface SymbolQualityMetrics {
  symbol: string;
  timeframe: Timeframe;
  score: DataQualityScore;
  lastTickTime: Date | null;
  ticksReceived: number;
  tickRate: number;
  priceAnomalies: number;
  spreadAnomalies: number;
  missedCandles: number;
  dataGaps: number;
  lastAnomaly: string | null;
  updatedAt: Date;
}

interface PriceHistory {
  price: number;
  timestamp: Date;
}

class DataQualityMonitor extends TinyEmitter {
  private metricsMap: Map<string, SymbolQualityMetrics> = new Map();
  private priceHistory: Map<string, PriceHistory[]> = new Map();
  private readonly MAX_PRICE_HISTORY = 100;
  private readonly TICK_RATE_WINDOW_MS = 60000;
  private readonly ANOMALY_THRESHOLD_PERCENT = 2;
  private readonly MAX_SPREAD_PIPS = 50;

  initializeSymbol(symbol: string, timeframe: Timeframe): void {
    const key = this.getKey(symbol, timeframe);

    if (!this.metricsMap.has(key)) {
      const metrics: SymbolQualityMetrics = {
        symbol,
        timeframe,
        score: 'excellent',
        lastTickTime: null,
        ticksReceived: 0,
        tickRate: 0,
        priceAnomalies: 0,
        spreadAnomalies: 0,
        missedCandles: 0,
        dataGaps: 0,
        lastAnomaly: null,
        updatedAt: new Date()
      };

      this.metricsMap.set(key, metrics);
      this.priceHistory.set(key, []);
      console.log(`📊 Initialized quality monitoring for ${symbol} ${timeframe}`);
    }
  }

  recordTick(tick: TickData): void {
    const keys = Array.from(this.metricsMap.keys()).filter(k => k.startsWith(`${tick.symbol}_`));

    keys.forEach(key => {
      const metrics = this.metricsMap.get(key);
      if (!metrics) return;

      metrics.lastTickTime = tick.time;
      metrics.ticksReceived++;
      metrics.updatedAt = new Date();

      const midPrice = (tick.bid + tick.ask) / 2;
      const spread = tick.ask - tick.bid;

      const priceAnomaly = this.detectPriceAnomaly(key, midPrice, tick.time);
      if (priceAnomaly) {
        metrics.priceAnomalies++;
        metrics.lastAnomaly = priceAnomaly;
        this.emit('anomaly-detected', { symbol: tick.symbol, type: 'price', message: priceAnomaly });
      }

      const spreadAnomaly = this.detectSpreadAnomaly(tick.symbol, spread);
      if (spreadAnomaly) {
        metrics.spreadAnomalies++;
        metrics.lastAnomaly = spreadAnomaly;
        this.emit('anomaly-detected', { symbol: tick.symbol, type: 'spread', message: spreadAnomaly });
      }

      metrics.tickRate = this.calculateTickRate(key);
      metrics.score = this.calculateQualityScore(metrics);

      this.emit('quality-update', metrics);
    });
  }

  recordMissedCandle(symbol: string, timeframe: Timeframe): void {
    const key = this.getKey(symbol, timeframe);
    const metrics = this.metricsMap.get(key);

    if (metrics) {
      metrics.missedCandles++;
      metrics.lastAnomaly = 'Missed candle';
      metrics.score = this.calculateQualityScore(metrics);
      metrics.updatedAt = new Date();
      this.emit('quality-update', metrics);
    }
  }

  recordDataGap(symbol: string, timeframe: Timeframe): void {
    const key = this.getKey(symbol, timeframe);
    const metrics = this.metricsMap.get(key);

    if (metrics) {
      metrics.dataGaps++;
      metrics.lastAnomaly = 'Data gap detected';
      metrics.score = this.calculateQualityScore(metrics);
      metrics.updatedAt = new Date();
      this.emit('quality-update', metrics);
    }
  }

  getMetrics(symbol: string, timeframe: Timeframe): SymbolQualityMetrics | null {
    const key = this.getKey(symbol, timeframe);
    return this.metricsMap.get(key) || null;
  }

  getAllMetrics(): SymbolQualityMetrics[] {
    return Array.from(this.metricsMap.values());
  }

  getOverallScore(): DataQualityScore {
    const allMetrics = this.getAllMetrics();
    if (allMetrics.length === 0) return 'excellent';

    const scores = allMetrics.map(m => m.score);

    if (scores.some(s => s === 'critical')) return 'critical';
    if (scores.some(s => s === 'poor')) return 'poor';
    if (scores.some(s => s === 'fair')) return 'fair';
    if (scores.every(s => s === 'excellent')) return 'excellent';
    return 'good';
  }

  private getKey(symbol: string, timeframe: Timeframe): string {
    return `${symbol}_${timeframe}`;
  }

  private detectPriceAnomaly(key: string, price: number, timestamp: Date): string | null {
    const history = this.priceHistory.get(key) || [];

    if (history.length === 0) {
      history.push({ price, timestamp });
      this.priceHistory.set(key, history);
      return null;
    }

    const recentHistory = history.slice(-10);
    const avgPrice = recentHistory.reduce((sum, h) => sum + h.price, 0) / recentHistory.length;
    const priceChange = Math.abs((price - avgPrice) / avgPrice) * 100;

    if (priceChange > this.ANOMALY_THRESHOLD_PERCENT) {
      const anomaly = `Price jumped ${priceChange.toFixed(2)}% (${avgPrice.toFixed(5)} -> ${price.toFixed(5)})`;
      console.warn(`⚠️ ${anomaly}`);

      history.push({ price, timestamp });
      if (history.length > this.MAX_PRICE_HISTORY) {
        history.shift();
      }
      this.priceHistory.set(key, history);

      return anomaly;
    }

    history.push({ price, timestamp });
    if (history.length > this.MAX_PRICE_HISTORY) {
      history.shift();
    }
    this.priceHistory.set(key, history);

    return null;
  }

  private detectSpreadAnomaly(symbol: string, spread: number): string | null {
    const spreadPips = symbol.includes('JPY') ? spread * 100 : spread * 10000;

    if (spreadPips > this.MAX_SPREAD_PIPS) {
      const anomaly = `Abnormal spread: ${spreadPips.toFixed(1)} pips`;
      console.warn(`⚠️ ${anomaly} for ${symbol}`);
      return anomaly;
    }

    return null;
  }

  private calculateTickRate(key: string): number {
    const history = this.priceHistory.get(key) || [];
    if (history.length < 2) return 0;

    const now = Date.now();
    const recentTicks = history.filter(h => now - h.timestamp.getTime() < this.TICK_RATE_WINDOW_MS);

    if (recentTicks.length < 2) return 0;

    const timeSpanMs = now - recentTicks[0].timestamp.getTime();
    const ticksPerSecond = (recentTicks.length / timeSpanMs) * 1000;

    return ticksPerSecond;
  }

  private calculateQualityScore(metrics: SymbolQualityMetrics): DataQualityScore {
    let score = 100;

    if (metrics.lastTickTime) {
      const timeSinceLastTick = Date.now() - metrics.lastTickTime.getTime();
      if (timeSinceLastTick > 60000) {
        score -= 30;
      } else if (timeSinceLastTick > 30000) {
        score -= 15;
      }
    } else {
      score -= 20;
    }

    score -= metrics.priceAnomalies * 5;
    score -= metrics.spreadAnomalies * 3;
    score -= metrics.missedCandles * 10;
    score -= metrics.dataGaps * 15;

    if (metrics.tickRate < 0.1 && metrics.ticksReceived > 10) {
      score -= 20;
    } else if (metrics.tickRate < 0.5 && metrics.ticksReceived > 10) {
      score -= 10;
    }

    if (score >= 90) return 'excellent';
    if (score >= 75) return 'good';
    if (score >= 60) return 'fair';
    if (score >= 40) return 'poor';
    return 'critical';
  }

  reset(symbol?: string, timeframe?: Timeframe): void {
    if (symbol && timeframe) {
      const key = this.getKey(symbol, timeframe);
      this.metricsMap.delete(key);
      this.priceHistory.delete(key);
      console.log(`🔄 Reset quality metrics for ${symbol} ${timeframe}`);
    } else {
      this.metricsMap.clear();
      this.priceHistory.clear();
      console.log('🔄 Reset all quality metrics');
    }
  }
}

export const dataQualityMonitor = new DataQualityMonitor();
