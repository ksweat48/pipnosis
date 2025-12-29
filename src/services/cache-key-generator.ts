import { CandleData } from '../types';

export interface MarketStateSnapshot {
  symbol: string;
  timeframe: string;
  price: number;
  atr: number;
  rsi: number;
  emaFast: number;
  emaSlow: number;
  volume?: number;
  avgVolume?: number;
}

export interface CacheKeyComponents {
  symbol: string;
  timeframe: string;
  priceBucket: number;
  rsiBucket: number;
  trendBucket: string;
  volatilityBucket: string;
  volumeBucket?: string;
}

export interface MarketStateHash {
  hash: string;
  components: CacheKeyComponents;
  atrPriceBucket: number;
}

function calculateATR(candles: CandleData[], period: number = 14): number {
  if (candles.length < period + 1) return 0;

  let atrSum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1]?.close || candles[i].open;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    atrSum += tr;
  }

  return atrSum / period;
}

function calculateRSI(candles: CandleData[], period: number = 14): number {
  if (candles.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = candles.length - period; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) {
      gains += change;
    } else {
      losses -= change;
    }
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateEMA(candles: CandleData[], period: number): number {
  if (candles.length < period) return candles[candles.length - 1]?.close || 0;

  const multiplier = 2 / (period + 1);
  let ema = candles[candles.length - period].close;

  for (let i = candles.length - period + 1; i < candles.length; i++) {
    ema = (candles[i].close - ema) * multiplier + ema;
  }

  return ema;
}

function calculateAverageVolume(candles: CandleData[], period: number = 20): number {
  if (candles.length < period) return 0;

  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    sum += candles[i].volume || 0;
  }

  return sum / period;
}

export function buildMarketStateSnapshot(
  symbol: string,
  timeframe: string,
  candles: CandleData[]
): MarketStateSnapshot | null {
  if (!candles || candles.length < 20) {
    return null;
  }

  const currentCandle = candles[candles.length - 1];
  const atr = calculateATR(candles);
  const rsi = calculateRSI(candles);
  const emaFast = calculateEMA(candles, 8);
  const emaSlow = calculateEMA(candles, 21);
  const avgVolume = calculateAverageVolume(candles);

  return {
    symbol,
    timeframe,
    price: currentCandle.close,
    atr,
    rsi,
    emaFast,
    emaSlow,
    volume: currentCandle.volume,
    avgVolume
  };
}

export function calculatePriceBucket(price: number, atr: number): number {
  if (atr <= 0) {
    return Math.floor(price * 100);
  }
  return Math.floor(price / (0.25 * atr));
}

export function calculateRsiBucket(rsi: number): number {
  return Math.floor(rsi / 10);
}

export function calculateTrendBucket(
  price: number,
  emaFast: number,
  emaSlow: number
): string {
  const fastAboveSlow = emaFast > emaSlow;
  const priceAboveFast = price > emaFast;
  const priceAboveSlow = price > emaSlow;

  const fastSlowDiff = Math.abs(emaFast - emaSlow) / emaSlow * 100;
  const isStrong = fastSlowDiff > 0.3;

  if (fastAboveSlow && priceAboveFast && priceAboveSlow) {
    return isStrong ? 'strong_bull' : 'bull';
  }

  if (!fastAboveSlow && !priceAboveFast && !priceAboveSlow) {
    return isStrong ? 'strong_bear' : 'bear';
  }

  return 'sideways';
}

export function calculateVolatilityBucket(
  atr: number,
  price: number
): string {
  const atrPercent = (atr / price) * 100;

  if (atrPercent < 0.3) return 'low';
  if (atrPercent < 0.8) return 'medium';
  if (atrPercent < 1.5) return 'high';
  return 'extreme';
}

export function calculateVolumeBucket(
  currentVolume: number | undefined,
  avgVolume: number | undefined
): string {
  if (!currentVolume || !avgVolume || avgVolume === 0) {
    return 'normal';
  }

  const volumeRatio = currentVolume / avgVolume;

  if (volumeRatio < 0.5) return 'low';
  if (volumeRatio < 1.5) return 'normal';
  if (volumeRatio < 3.0) return 'high';
  return 'extreme';
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export function generateMarketStateHash(
  snapshot: MarketStateSnapshot
): MarketStateHash {
  const priceBucket = calculatePriceBucket(snapshot.price, snapshot.atr);
  const rsiBucket = calculateRsiBucket(snapshot.rsi);
  const trendBucket = calculateTrendBucket(
    snapshot.price,
    snapshot.emaFast,
    snapshot.emaSlow
  );
  const volatilityBucket = calculateVolatilityBucket(snapshot.atr, snapshot.price);
  const volumeBucket = calculateVolumeBucket(snapshot.volume, snapshot.avgVolume);

  const components: CacheKeyComponents = {
    symbol: snapshot.symbol,
    timeframe: snapshot.timeframe,
    priceBucket,
    rsiBucket,
    trendBucket,
    volatilityBucket,
    volumeBucket
  };

  const hashInput = `${snapshot.symbol}|${snapshot.timeframe}|${priceBucket}|${rsiBucket}|${trendBucket}|${volatilityBucket}`;
  const hash = simpleHash(hashInput);

  return {
    hash,
    components,
    atrPriceBucket: priceBucket
  };
}

export function generateOmegaVotesHash(
  votes: Array<{ brainName: string; vote: string; confidence: number }>
): string {
  const sortedVotes = [...votes].sort((a, b) => a.brainName.localeCompare(b.brainName));

  const votesString = sortedVotes
    .map(v => `${v.brainName}:${v.vote}:${Math.floor(v.confidence / 10)}`)
    .join('|');

  return simpleHash(votesString);
}

export function shouldUseCachedResult(
  cachedSnapshot: MarketStateSnapshot,
  currentSnapshot: MarketStateSnapshot
): boolean {
  const cachedHash = generateMarketStateHash(cachedSnapshot);
  const currentHash = generateMarketStateHash(currentSnapshot);

  return cachedHash.hash === currentHash.hash;
}

export function getTTLForTimeframe(timeframe: string): number {
  const ttlMap: Record<string, number> = {
    'M1': 3 * 60 * 1000,
    'M5': 8 * 60 * 1000,
    'M15': 15 * 60 * 1000,
    'M30': 20 * 60 * 1000,
    'H1': 30 * 60 * 1000,
    'H4': 60 * 60 * 1000,
    'D1': 4 * 60 * 60 * 1000
  };

  return ttlMap[timeframe] || 15 * 60 * 1000;
}

export function getTTLForAlphaCache(timeframe: string): number {
  return getTTLForTimeframe(timeframe) * 0.6;
}

export function getTTLForScoutCache(): number {
  return 60 * 1000;
}
