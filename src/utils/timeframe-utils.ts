/**
 * Timeframe utilities - Re-exports from SSOT
 *
 * IMPORTANT: This file re-exports from the centralized timeframe-hierarchy.ts
 * to maintain backward compatibility with existing imports.
 *
 * For new code, import directly from '@/config/timeframe-hierarchy'
 *
 * CCIP COMPLIANCE: Use generateTimeframe() for all new code that creates timeframes from user input.
 */

export {
  type Timeframe,
  normalizeTimeframe,
  formatTimeframeForDb,
  parseTimeframeFromDb,
  isValidTimeframe,
  generateTimeframe,
  ALL_TIMEFRAMES,
} from '@/config/timeframe-hierarchy';

import {
  type Timeframe,
  normalizeTimeframe,
  formatTimeframeForDb,
  generateTimeframe,
} from '@/config/timeframe-hierarchy';

export function appTimeframeToDb(timeframe: Timeframe): string {
  return formatTimeframeForDb(timeframe);
}

export function dbTimeframeToApp(dbTimeframe: string): Timeframe {
  return normalizeTimeframe(dbTimeframe);
}

export function normalizeTimeframeToDb(timeframe: string): string {
  return formatTimeframeForDb(normalizeTimeframe(timeframe));
}

/**
 * CCIP-compliant wrapper for generating timeframes
 * Use this when creating timeframes from user input
 */
export function generateValidTimeframeForDb(
  userInput?: string | null,
  defaultValue: Timeframe = 'M15'
): string {
  const timeframe = generateTimeframe(userInput, defaultValue);
  return formatTimeframeForDb(timeframe);
}
