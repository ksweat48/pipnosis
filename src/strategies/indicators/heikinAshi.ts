import { Candle } from '../../lib/indicators';

export interface HeikinAshiCandle {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  color: 'green' | 'red';
  volume: number;
}

export function convertToHeikinAshi(candles: Candle[]): HeikinAshiCandle[] {
  if (candles.length === 0) {
    return [];
  }

  const haCandles: HeikinAshiCandle[] = [];

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const haClose = (candle.open + candle.high + candle.low + candle.close) / 4;

    let haOpen: number;
    if (i === 0) {
      haOpen = (candle.open + candle.close) / 2;
    } else {
      const prevHA = haCandles[i - 1];
      haOpen = (prevHA.open + prevHA.close) / 2;
    }

    const haHigh = Math.max(candle.high, haOpen, haClose);
    const haLow = Math.min(candle.low, haOpen, haClose);

    haCandles.push({
      time: candle.time instanceof Date ? candle.time : new Date(candle.time),
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
      color: haClose >= haOpen ? 'green' : 'red',
      volume: candle.volume
    });
  }

  return haCandles;
}

export function detectHeikinAshiShift(
  candles: Candle[],
  direction: 'BUY' | 'SELL'
): boolean {
  if (candles.length < 2) {
    return false;
  }

  const haCandles = convertToHeikinAshi(candles);
  const current = haCandles[haCandles.length - 1];
  const previous = haCandles[haCandles.length - 2];

  if (direction === 'BUY') {
    return previous.color === 'red' && current.color === 'green';
  } else {
    return previous.color === 'green' && current.color === 'red';
  }
}

export function getLastOppositeColorCandle(
  candles: Candle[],
  currentDirection: 'BUY' | 'SELL'
): HeikinAshiCandle | null {
  const haCandles = convertToHeikinAshi(candles);
  const targetColor = currentDirection === 'BUY' ? 'red' : 'green';

  for (let i = haCandles.length - 1; i >= 0; i--) {
    if (haCandles[i].color === targetColor) {
      return haCandles[i];
    }
  }

  return null;
}

export function getCurrentHeikinAshiColor(candles: Candle[]): 'green' | 'red' | null {
  if (candles.length === 0) {
    return null;
  }

  const haCandles = convertToHeikinAshi(candles);
  return haCandles[haCandles.length - 1].color;
}

export function countConsecutiveColors(
  candles: Candle[],
  color: 'green' | 'red'
): number {
  const haCandles = convertToHeikinAshi(candles);
  let count = 0;

  for (let i = haCandles.length - 1; i >= 0; i--) {
    if (haCandles[i].color === color) {
      count++;
    } else {
      break;
    }
  }

  return count;
}
