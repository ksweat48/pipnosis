import { Timeframe } from './metaapi';

export function timeframeToMinutes(timeframe: Timeframe): number {
  const map: Record<Timeframe, number> = {
    M1: 1,
    M5: 5,
    M15: 15,
    M30: 30,
    H1: 60,
    H4: 240,
    D1: 1440,
    W1: 10080,
    MN1: 43200
  };
  return map[timeframe] || 15;
}

export function getCandleOpenTime(timestamp: Date, timeframe: Timeframe): Date {
  const minutes = timeframeToMinutes(timeframe);
  const time = new Date(timestamp.getTime());

  if (timeframe === 'D1') {
    time.setUTCHours(0, 0, 0, 0);
    return time;
  }

  if (timeframe === 'W1') {
    const day = time.getUTCDay();
    const diff = (day === 0 ? -6 : 1) - day;
    time.setUTCDate(time.getUTCDate() + diff);
    time.setUTCHours(0, 0, 0, 0);
    return time;
  }

  if (timeframe === 'MN1') {
    time.setUTCDate(1);
    time.setUTCHours(0, 0, 0, 0);
    return time;
  }

  const ms = time.getTime();
  const intervalMs = minutes * 60 * 1000;
  const roundedMs = Math.floor(ms / intervalMs) * intervalMs;
  return new Date(roundedMs);
}

export function getCandleCloseTime(timestamp: Date, timeframe: Timeframe): Date {
  const openTime = getCandleOpenTime(timestamp, timeframe);
  const minutes = timeframeToMinutes(timeframe);
  return new Date(openTime.getTime() + minutes * 60 * 1000);
}

export function areSameCandlePeriod(
  time1: Date,
  time2: Date,
  timeframe: Timeframe
): boolean {
  const open1 = getCandleOpenTime(time1, timeframe);
  const open2 = getCandleOpenTime(time2, timeframe);
  return open1.getTime() === open2.getTime();
}

export function isNewCandlePeriod(
  currentTime: Date,
  lastCandleTime: Date,
  timeframe: Timeframe
): boolean {
  return !areSameCandlePeriod(currentTime, lastCandleTime, timeframe);
}

export function calculateStartTime(timeframe: Timeframe, limit: number, endTime: Date = new Date()): Date {
  const minutes = timeframeToMinutes(timeframe);
  const totalMinutes = minutes * limit;
  return new Date(endTime.getTime() - totalMinutes * 60 * 1000);
}

export function validateCandleSequence(
  candles: Array<{ time: Date }>,
  timeframe: Timeframe
): boolean {
  if (candles.length < 2) return true;

  const intervalMs = timeframeToMinutes(timeframe) * 60 * 1000;

  for (let i = 1; i < candles.length; i++) {
    const prevTime = candles[i - 1].time.getTime();
    const currTime = candles[i].time.getTime();
    const diff = currTime - prevTime;

    if (diff !== intervalMs && timeframe !== 'D1' && timeframe !== 'W1' && timeframe !== 'MN1') {
      return false;
    }
  }

  return true;
}

export function validateOHLC(open: number, high: number, low: number, close: number): boolean {
  if (high < low) return false;
  if (high < open || high < close) return false;
  if (low > open || low > close) return false;
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return false;
  return true;
}

export function alignTimestampToCandleBoundary(
  timestamp: Date,
  timeframe: Timeframe
): Date {
  return getCandleOpenTime(timestamp, timeframe);
}
