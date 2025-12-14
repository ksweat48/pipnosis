/**
 * Centralized Timestamp Normalization Utility
 *
 * This utility ensures ALL timestamps across the application are normalized consistently.
 * CRITICAL: Every service that creates or processes candles MUST use these functions.
 *
 * Purpose: Eliminate timing overlaps and ensure perfect candle alignment.
 */

export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';

const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  M1: 1,
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H4: 240,
  D1: 1440,
};

/**
 * Get the number of minutes in a timeframe
 */
export function getTimeframeMinutes(timeframe: Timeframe): number {
  return TIMEFRAME_MINUTES[timeframe];
}

/**
 * Get the number of milliseconds in a timeframe
 */
export function getTimeframeMs(timeframe: Timeframe): number {
  return TIMEFRAME_MINUTES[timeframe] * 60 * 1000;
}

/**
 * Get the number of seconds in a timeframe
 */
export function getTimeframeSeconds(timeframe: Timeframe): number {
  return TIMEFRAME_MINUTES[timeframe] * 60;
}

/**
 * Normalize a timestamp to the start of its candle period
 *
 * @param timestamp - Can be Date, milliseconds, or seconds
 * @param timeframe - The timeframe to align to
 * @returns Normalized timestamp in SECONDS (Unix timestamp)
 *
 * @example
 * // For M5 timeframe, any time between 10:00:00 and 10:04:59 becomes 10:00:00
 * normalizeTimestamp(new Date('2025-01-17T10:03:45Z'), 'M5') // Returns timestamp for 10:00:00
 */
export function normalizeTimestamp(timestamp: Date | number, timeframe: Timeframe): number {
  const intervalMs = getTimeframeMs(timeframe);

  let timestampMs: number;

  if (timestamp instanceof Date) {
    timestampMs = timestamp.getTime();
  } else if (timestamp < 10000000000) {
    // Likely seconds, convert to milliseconds
    timestampMs = timestamp * 1000;
  } else {
    // Already milliseconds
    timestampMs = timestamp;
  }

  // Align to timeframe boundary
  const normalizedMs = Math.floor(timestampMs / intervalMs) * intervalMs;

  // Return as seconds (Unix timestamp)
  return Math.floor(normalizedMs / 1000);
}

/**
 * Get the start timestamp of the current candle period
 */
export function getCurrentCandleStart(timeframe: Timeframe): number {
  return normalizeTimestamp(new Date(), timeframe);
}

/**
 * Get the start timestamp of the previous completed candle
 */
export function getLastCompletedCandleStart(timeframe: Timeframe): number {
  const currentStart = getCurrentCandleStart(timeframe);
  const intervalSeconds = getTimeframeSeconds(timeframe);
  return currentStart - intervalSeconds;
}

/**
 * Get the end timestamp for a candle (exclusive)
 */
export function getCandleEndTimestamp(candleStartSeconds: number, timeframe: Timeframe): number {
  const intervalSeconds = getTimeframeSeconds(timeframe);
  return candleStartSeconds + intervalSeconds;
}

/**
 * Check if a timestamp falls within a specific candle period
 */
export function isTimestampInCandle(
  timestamp: Date | number,
  candleStartSeconds: number,
  timeframe: Timeframe
): boolean {
  const timestampSeconds = normalizeTimestamp(timestamp, timeframe);
  return timestampSeconds === candleStartSeconds;
}

/**
 * Check if a candle is currently forming (not yet completed)
 */
export function isCandleForming(candleStartSeconds: number, timeframe: Timeframe): boolean {
  const currentCandleStart = getCurrentCandleStart(timeframe);
  return candleStartSeconds === currentCandleStart;
}

/**
 * Check if a candle is completed
 */
export function isCandleCompleted(candleStartSeconds: number, timeframe: Timeframe): boolean {
  const currentCandleStart = getCurrentCandleStart(timeframe);
  return candleStartSeconds < currentCandleStart;
}

/**
 * Convert normalized timestamp to ISO string
 */
export function timestampToISO(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toISOString();
}

/**
 * Convert ISO string to normalized timestamp
 */
export function isoToTimestamp(isoString: string, timeframe: Timeframe): number {
  return normalizeTimestamp(new Date(isoString), timeframe);
}

/**
 * Validate that a timestamp is properly aligned to a timeframe
 */
export function isTimestampAligned(timestampSeconds: number, timeframe: Timeframe): boolean {
  const intervalSeconds = getTimeframeSeconds(timeframe);
  return timestampSeconds % intervalSeconds === 0;
}

/**
 * Generate an array of normalized timestamps between start and end dates
 */
export function generateCandleTimestamps(
  startDate: Date,
  endDate: Date,
  timeframe: Timeframe
): number[] {
  const timestamps: number[] = [];
  const intervalSeconds = getTimeframeSeconds(timeframe);

  let currentTimestamp = normalizeTimestamp(startDate, timeframe);
  const endTimestamp = normalizeTimestamp(endDate, timeframe);

  while (currentTimestamp <= endTimestamp) {
    timestamps.push(currentTimestamp);
    currentTimestamp += intervalSeconds;
  }

  return timestamps;
}

/**
 * Format timestamp for debugging/logging
 */
export function formatTimestamp(timestampSeconds: number, includeDay: boolean = false): string {
  const date = new Date(timestampSeconds * 1000);
  if (includeDay) {
    return date.toISOString();
  }
  return date.toISOString().split('T')[1].slice(0, 8); // HH:MM:SS only
}

/**
 * Validate candle data has proper timestamps
 */
export interface CandleTimestampValidation {
  isValid: boolean;
  errors: string[];
}

export function validateCandleTimestamps(
  candles: Array<{ time: number; open_time?: string }>,
  timeframe: Timeframe
): CandleTimestampValidation {
  const errors: string[] = [];

  candles.forEach((candle, index) => {
    // Check alignment
    if (!isTimestampAligned(candle.time, timeframe)) {
      errors.push(
        `Candle ${index}: timestamp ${candle.time} (${formatTimestamp(candle.time, true)}) is not aligned to ${timeframe}`
      );
    }

    // Check for gaps/overlaps with previous candle
    if (index > 0) {
      const prevTime = candles[index - 1].time;
      const expectedTime = prevTime + getTimeframeSeconds(timeframe);

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
