/**
 * Timestamp Normalization Utility - Re-exports from SSOT
 *
 * IMPORTANT: This file re-exports from the centralized timeframe-hierarchy.ts
 * to maintain backward compatibility with existing imports.
 *
 * For new code, import directly from '@/config/timeframe-hierarchy'
 */

export {
  type Timeframe,
  TIMEFRAME_MINUTES,
  TIMEFRAME_SECONDS,
  TIMEFRAME_MS,
  getTimeframeMinutes,
  getTimeframeMs,
  getTimeframeSeconds,
  normalizeTimestampToTimeframe as normalizeTimestamp,
  getCurrentCandleStart,
  getLastCompletedCandleStart,
  isCandleForming,
  isCandleCompleted,
  isTimestampAligned,
} from '@/config/timeframe-hierarchy';

import {
  type Timeframe,
  TIMEFRAME_SECONDS,
  normalizeTimestampToTimeframe,
  getTimeframeSeconds,
} from '@/config/timeframe-hierarchy';

export function getCandleEndTimestamp(candleStartSeconds: number, timeframe: Timeframe): number {
  return candleStartSeconds + TIMEFRAME_SECONDS[timeframe];
}

export function isTimestampInCandle(
  timestamp: Date | number,
  candleStartSeconds: number,
  timeframe: Timeframe
): boolean {
  const timestampSeconds = normalizeTimestampToTimeframe(timestamp, timeframe);
  return timestampSeconds === candleStartSeconds;
}

export function timestampToISO(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toISOString();
}

export function isoToTimestamp(isoString: string, timeframe: Timeframe): number {
  return normalizeTimestampToTimeframe(new Date(isoString), timeframe);
}

export function generateCandleTimestamps(
  startDate: Date,
  endDate: Date,
  timeframe: Timeframe
): number[] {
  const timestamps: number[] = [];
  const intervalSeconds = getTimeframeSeconds(timeframe);

  let currentTimestamp = normalizeTimestampToTimeframe(startDate, timeframe);
  const endTimestamp = normalizeTimestampToTimeframe(endDate, timeframe);

  while (currentTimestamp <= endTimestamp) {
    timestamps.push(currentTimestamp);
    currentTimestamp += intervalSeconds;
  }

  return timestamps;
}

export function formatTimestamp(timestampSeconds: number, includeDay: boolean = false): string {
  const date = new Date(timestampSeconds * 1000);
  if (includeDay) {
    return date.toISOString();
  }
  return date.toISOString().split('T')[1].slice(0, 8);
}

export interface CandleTimestampValidation {
  isValid: boolean;
  errors: string[];
}

export function validateCandleTimestamps(
  candles: Array<{ time: number; open_time?: string }>,
  timeframe: Timeframe
): CandleTimestampValidation {
  const errors: string[] = [];
  const intervalSeconds = TIMEFRAME_SECONDS[timeframe];

  candles.forEach((candle, index) => {
    if (candle.time % intervalSeconds !== 0) {
      errors.push(
        `Candle ${index}: timestamp ${candle.time} (${formatTimestamp(candle.time, true)}) is not aligned to ${timeframe}`
      );
    }

    if (index > 0) {
      const prevTime = candles[index - 1].time;
      const expectedTime = prevTime + intervalSeconds;

      if (candle.time < prevTime) {
        errors.push(`Candle ${index}: timestamp is before previous candle (backwards time travel)`);
      } else if (candle.time === prevTime) {
        errors.push(`Candle ${index}: duplicate timestamp ${candle.time}`);
      } else if (candle.time !== expectedTime) {
        const gapMinutes = (candle.time - expectedTime) / 60;
        errors.push(
          `Candle ${index}: gap detected - ${gapMinutes} minutes between candles (expected continuous)`
        );
      }
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}
