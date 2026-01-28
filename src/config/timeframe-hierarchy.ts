/**
 * TIMEFRAME HIERARCHY - SINGLE SOURCE OF TRUTH
 *
 * This is the AUTHORITATIVE source for ALL timeframe-related definitions in the system.
 * NO other file should define Timeframe types, constants, or mappings.
 *
 * Import from this file ONLY:
 * - Timeframe type
 * - ALL_TIMEFRAMES constant
 * - Timeframe conversion functions
 * - Timeframe hierarchy configurations
 * - Display/storage limits
 */

export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';

export type RiskMode = 'low' | 'medium' | 'high';

export type AnalysisDepth = 'quick' | 'moderate' | 'deep';

export const ALL_TIMEFRAMES: readonly Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'] as const;

export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  M1: 1,
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H4: 240,
  D1: 1440,
} as const;

export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  M1: 60,
  M5: 300,
  M15: 900,
  M30: 1800,
  H1: 3600,
  H4: 14400,
  D1: 86400,
} as const;

export const TIMEFRAME_MS: Record<Timeframe, number> = {
  M1: 60000,
  M5: 300000,
  M15: 900000,
  M30: 1800000,
  H1: 3600000,
  H4: 14400000,
  D1: 86400000,
} as const;

export const TIMEFRAME_DISPLAY_LABELS: Record<Timeframe, string> = {
  M1: '1 Minute',
  M5: '5 Minutes',
  M15: '15 Minutes',
  M30: '30 Minutes',
  H1: '1 Hour',
  H4: '4 Hours',
  D1: '1 Day',
} as const;

export const TIMEFRAME_SHORT_LABELS: Record<Timeframe, string> = {
  M1: '1m',
  M5: '5m',
  M15: '15m',
  M30: '30m',
  H1: '1h',
  H4: '4h',
  D1: '1d',
} as const;

export interface TimeframeLimits {
  displayLimit: number;
  minRequired: number;
  lookbackHours: number;
  historicalStorage: number;
}

export const TIMEFRAME_LIMITS: Record<Timeframe, TimeframeLimits> = {
  M1: { displayLimit: 200, minRequired: 100, lookbackHours: 336, historicalStorage: 20160 },
  M5: { displayLimit: 300, minRequired: 150, lookbackHours: 720, historicalStorage: 8640 },
  M15: { displayLimit: 400, minRequired: 200, lookbackHours: 1440, historicalStorage: 5760 },
  M30: { displayLimit: 500, minRequired: 250, lookbackHours: 2160, historicalStorage: 4320 },
  H1: { displayLimit: 500, minRequired: 250, lookbackHours: 4320, historicalStorage: 4320 },
  H4: { displayLimit: 500, minRequired: 250, lookbackHours: 8760, historicalStorage: 2190 },
  D1: { displayLimit: 365, minRequired: 200, lookbackHours: 8760, historicalStorage: 365 },
} as const;

export const TIMEFRAME_POLL_INTERVALS: Record<Timeframe, number> = {
  M1: 5000,
  M5: 15000,
  M15: 30000,
  M30: 60000,
  H1: 120000,
  H4: 240000,
  D1: 600000,
} as const;

export interface TimeframeHierarchy {
  primary: Timeframe;
  secondary: Timeframe;
  tertiary?: Timeframe;
  analysisDepth: AnalysisDepth;
}

export const RISK_MODE_TIMEFRAME_HIERARCHY: Record<RiskMode, TimeframeHierarchy> = {
  high: {
    primary: 'M5',
    secondary: 'M15',
    tertiary: 'H1',
    analysisDepth: 'quick',
  },
  medium: {
    primary: 'M15',
    secondary: 'H1',
    tertiary: 'H4',
    analysisDepth: 'moderate',
  },
  low: {
    primary: 'H1',
    secondary: 'H4',
    tertiary: 'D1',
    analysisDepth: 'deep',
  },
} as const;

export interface MultiTimeframeConfig {
  entryTimeframe: Timeframe;
  trendTimeframe: Timeframe;
  contextTimeframe: Timeframe;
}

export const MTF_ANALYSIS_CONFIGS: Record<RiskMode, MultiTimeframeConfig> = {
  high: {
    entryTimeframe: 'M5',
    trendTimeframe: 'M15',
    contextTimeframe: 'H1',
  },
  medium: {
    entryTimeframe: 'M15',
    trendTimeframe: 'H1',
    contextTimeframe: 'H4',
  },
  low: {
    entryTimeframe: 'H1',
    trendTimeframe: 'H4',
    contextTimeframe: 'D1',
  },
} as const;

const LEGACY_TIMEFRAME_MAP: Record<string, Timeframe> = {
  '1m': 'M1', '5m': 'M5', '15m': 'M15', '30m': 'M30',
  '1h': 'H1', '4h': 'H4', '1d': 'D1',
  '1M': 'M1', '5M': 'M5', '15M': 'M15', '30M': 'M30',
  '1H': 'H1', '4H': 'H4', '1D': 'D1',
  'm1': 'M1', 'm5': 'M5', 'm15': 'M15', 'm30': 'M30',
  'h1': 'H1', 'h4': 'H4', 'd1': 'D1',
  // Natural language timeframes (from goal parsing)
  '1 day': 'D1', '1 hour': 'H1', '1 week': 'D1', '1 month': 'D1',
  '1day': 'D1', '1hour': 'H1', '1week': 'D1', '1month': 'D1',
};

export function isValidTimeframe(value: string): value is Timeframe {
  return ALL_TIMEFRAMES.includes(value as Timeframe);
}

export function normalizeTimeframe(input: string): Timeframe {
  const upper = input.toUpperCase();
  if (isValidTimeframe(upper)) {
    return upper;
  }
  const mapped = LEGACY_TIMEFRAME_MAP[input];
  if (mapped) {
    return mapped;
  }
  return 'M15';
}

export function getTimeframeMinutes(timeframe: Timeframe): number {
  return TIMEFRAME_MINUTES[timeframe];
}

export function getTimeframeSeconds(timeframe: Timeframe): number {
  return TIMEFRAME_SECONDS[timeframe];
}

export function getTimeframeMs(timeframe: Timeframe): number {
  return TIMEFRAME_MS[timeframe];
}

export function getDisplayLimit(timeframe: Timeframe): number {
  return TIMEFRAME_LIMITS[timeframe].displayLimit;
}

export function getMinRequiredCandles(timeframe: Timeframe): number {
  return TIMEFRAME_LIMITS[timeframe].minRequired;
}

export function getLookbackHours(timeframe: Timeframe): number {
  return TIMEFRAME_LIMITS[timeframe].lookbackHours;
}

export function getPollInterval(timeframe: Timeframe): number {
  return TIMEFRAME_POLL_INTERVALS[timeframe];
}

export function getTimeframeLabel(timeframe: Timeframe): string {
  return TIMEFRAME_DISPLAY_LABELS[timeframe];
}

export function getTimeframeShortLabel(timeframe: Timeframe): string {
  return TIMEFRAME_SHORT_LABELS[timeframe];
}

export function getTimeframeHierarchy(riskMode: RiskMode): TimeframeHierarchy {
  return RISK_MODE_TIMEFRAME_HIERARCHY[riskMode];
}

export function getMTFConfig(riskMode: RiskMode): MultiTimeframeConfig {
  return MTF_ANALYSIS_CONFIGS[riskMode];
}

export function getPrimaryTimeframe(riskMode: RiskMode): Timeframe {
  return RISK_MODE_TIMEFRAME_HIERARCHY[riskMode].primary;
}

export function getSecondaryTimeframe(riskMode: RiskMode): Timeframe {
  return RISK_MODE_TIMEFRAME_HIERARCHY[riskMode].secondary;
}

export function getTertiaryTimeframe(riskMode: RiskMode): Timeframe | undefined {
  return RISK_MODE_TIMEFRAME_HIERARCHY[riskMode].tertiary;
}

export function getAnalysisDepth(riskMode: RiskMode): AnalysisDepth {
  return RISK_MODE_TIMEFRAME_HIERARCHY[riskMode].analysisDepth;
}

export function getAllTimeframesForRiskMode(riskMode: RiskMode): Timeframe[] {
  const hierarchy = RISK_MODE_TIMEFRAME_HIERARCHY[riskMode];
  const timeframes: Timeframe[] = [hierarchy.primary, hierarchy.secondary];
  if (hierarchy.tertiary) {
    timeframes.push(hierarchy.tertiary);
  }
  return timeframes;
}

export function isTimeframeCompatibleWithRiskMode(timeframe: Timeframe, riskMode: RiskMode): boolean {
  const allowedTimeframes = getAllTimeframesForRiskMode(riskMode);
  return allowedTimeframes.includes(timeframe);
}

export function getTimeframeRank(timeframe: Timeframe): number {
  return ALL_TIMEFRAMES.indexOf(timeframe);
}

export function isHigherTimeframe(tf1: Timeframe, tf2: Timeframe): boolean {
  return getTimeframeRank(tf1) > getTimeframeRank(tf2);
}

export function isLowerTimeframe(tf1: Timeframe, tf2: Timeframe): boolean {
  return getTimeframeRank(tf1) < getTimeframeRank(tf2);
}

export function getNextHigherTimeframe(timeframe: Timeframe): Timeframe | null {
  const rank = getTimeframeRank(timeframe);
  if (rank >= ALL_TIMEFRAMES.length - 1) {
    return null;
  }
  return ALL_TIMEFRAMES[rank + 1];
}

export function getNextLowerTimeframe(timeframe: Timeframe): Timeframe | null {
  const rank = getTimeframeRank(timeframe);
  if (rank <= 0) {
    return null;
  }
  return ALL_TIMEFRAMES[rank - 1];
}

export function formatTimeframeForDb(timeframe: Timeframe): string {
  return timeframe;
}

export function parseTimeframeFromDb(dbTimeframe: string): Timeframe {
  return normalizeTimeframe(dbTimeframe);
}

export function minutesToTimeframe(minutes: number): Timeframe | null {
  for (const [tf, mins] of Object.entries(TIMEFRAME_MINUTES)) {
    if (mins === minutes) {
      return tf as Timeframe;
    }
  }
  return null;
}

export function normalizeTimestampToTimeframe(
  timestamp: Date | number,
  timeframe: Timeframe
): number {
  const intervalMs = TIMEFRAME_MS[timeframe];
  let timestampMs: number;

  if (timestamp instanceof Date) {
    timestampMs = timestamp.getTime();
  } else if (timestamp < 10000000000) {
    timestampMs = timestamp * 1000;
  } else {
    timestampMs = timestamp;
  }

  const normalizedMs = Math.floor(timestampMs / intervalMs) * intervalMs;
  return Math.floor(normalizedMs / 1000);
}

export function getCurrentCandleStart(timeframe: Timeframe): number {
  return normalizeTimestampToTimeframe(new Date(), timeframe);
}

export function getLastCompletedCandleStart(timeframe: Timeframe): number {
  const currentStart = getCurrentCandleStart(timeframe);
  return currentStart - TIMEFRAME_SECONDS[timeframe];
}

export function isCandleForming(candleStartSeconds: number, timeframe: Timeframe): boolean {
  return candleStartSeconds === getCurrentCandleStart(timeframe);
}

export function isCandleCompleted(candleStartSeconds: number, timeframe: Timeframe): boolean {
  return candleStartSeconds < getCurrentCandleStart(timeframe);
}

export function isTimestampAligned(timestampSeconds: number, timeframe: Timeframe): boolean {
  return timestampSeconds % TIMEFRAME_SECONDS[timeframe] === 0;
}
