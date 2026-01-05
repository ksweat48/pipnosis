/**
 * Timeframe utilities - Re-exports from SSOT
 *
 * IMPORTANT: This file re-exports from the centralized timeframe-hierarchy.ts
 * to maintain backward compatibility with existing imports.
 *
 * For new code, import directly from '@/config/timeframe-hierarchy'
 */

export {
  type Timeframe,
  normalizeTimeframe,
  formatTimeframeForDb,
  parseTimeframeFromDb,
  isValidTimeframe,
  ALL_TIMEFRAMES,
} from '@/config/timeframe-hierarchy';

import {
  type Timeframe,
  normalizeTimeframe,
  formatTimeframeForDb,
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
