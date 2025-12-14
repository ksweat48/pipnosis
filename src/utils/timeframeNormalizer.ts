/**
 * Timeframe Normalizer
 *
 * Standardizes timeframe naming conventions across the application.
 * Handles conversions between different formats (e.g., '15m' <-> 'M15').
 */

export type TimeframeFormat = 'standard' | 'metatrader' | 'minutes';

export interface TimeframeInfo {
  standard: string;      // e.g., '15m'
  metatrader: string;    // e.g., 'M15'
  minutes: number;       // e.g., 15
  displayName: string;   // e.g., '15 minutes'
}

const TIMEFRAME_MAP: Record<string, TimeframeInfo> = {
  // 1 minute
  '1m': { standard: '1m', metatrader: 'M1', minutes: 1, displayName: '1 minute' },
  'M1': { standard: '1m', metatrader: 'M1', minutes: 1, displayName: '1 minute' },
  '1': { standard: '1m', metatrader: 'M1', minutes: 1, displayName: '1 minute' },

  // 5 minutes
  '5m': { standard: '5m', metatrader: 'M5', minutes: 5, displayName: '5 minutes' },
  'M5': { standard: '5m', metatrader: 'M5', minutes: 5, displayName: '5 minutes' },
  '5': { standard: '5m', metatrader: 'M5', minutes: 5, displayName: '5 minutes' },

  // 15 minutes
  '15m': { standard: '15m', metatrader: 'M15', minutes: 15, displayName: '15 minutes' },
  'M15': { standard: '15m', metatrader: 'M15', minutes: 15, displayName: '15 minutes' },
  '15': { standard: '15m', metatrader: 'M15', minutes: 15, displayName: '15 minutes' },

  // 30 minutes
  '30m': { standard: '30m', metatrader: 'M30', minutes: 30, displayName: '30 minutes' },
  'M30': { standard: '30m', metatrader: 'M30', minutes: 30, displayName: '30 minutes' },
  '30': { standard: '30m', metatrader: 'M30', minutes: 30, displayName: '30 minutes' },

  // 1 hour
  '1h': { standard: '1h', metatrader: 'H1', minutes: 60, displayName: '1 hour' },
  'H1': { standard: '1h', metatrader: 'H1', minutes: 60, displayName: '1 hour' },
  '60m': { standard: '1h', metatrader: 'H1', minutes: 60, displayName: '1 hour' },
  '60': { standard: '1h', metatrader: 'H1', minutes: 60, displayName: '1 hour' },

  // 4 hours
  '4h': { standard: '4h', metatrader: 'H4', minutes: 240, displayName: '4 hours' },
  'H4': { standard: '4h', metatrader: 'H4', minutes: 240, displayName: '4 hours' },
  '240m': { standard: '4h', metatrader: 'H4', minutes: 240, displayName: '4 hours' },
  '240': { standard: '4h', metatrader: 'H4', minutes: 240, displayName: '4 hours' },

  // 1 day
  '1d': { standard: '1d', metatrader: 'D1', minutes: 1440, displayName: '1 day' },
  'D1': { standard: '1d', metatrader: 'D1', minutes: 1440, displayName: '1 day' },
  '1440m': { standard: '1d', metatrader: 'D1', minutes: 1440, displayName: '1 day' },
  '1440': { standard: '1d', metatrader: 'D1', minutes: 1440, displayName: '1 day' },

  // 1 month
  '1M': { standard: '1M', metatrader: 'MN1', minutes: 43200, displayName: '1 month' },
  'MN1': { standard: '1M', metatrader: 'MN1', minutes: 43200, displayName: '1 month' }
};

/**
 * Normalize a timeframe string to a standard format
 */
export function normalizeTimeframe(timeframe: string, format: TimeframeFormat = 'standard'): string {
  const info = TIMEFRAME_MAP[timeframe];

  if (!info) {
    console.warn(`[Timeframe Normalizer] Unknown timeframe: ${timeframe}, returning as-is`);
    return timeframe;
  }

  switch (format) {
    case 'standard':
      return info.standard;
    case 'metatrader':
      return info.metatrader;
    case 'minutes':
      return info.minutes.toString();
    default:
      return info.standard;
  }
}

/**
 * Get timeframe information
 */
export function getTimeframeInfo(timeframe: string): TimeframeInfo | null {
  return TIMEFRAME_MAP[timeframe] || null;
}

/**
 * Check if a timeframe string is valid
 */
export function isValidTimeframe(timeframe: string): boolean {
  return timeframe in TIMEFRAME_MAP;
}

/**
 * Convert minutes to standard timeframe format
 */
export function minutesToTimeframe(minutes: number): string {
  const entry = Object.values(TIMEFRAME_MAP).find(tf => tf.minutes === minutes);
  return entry?.standard || `${minutes}m`;
}

/**
 * Get all available timeframes in a specific format
 */
export function getAllTimeframes(format: TimeframeFormat = 'standard'): string[] {
  const uniqueTimeframes = new Set<string>();

  Object.values(TIMEFRAME_MAP).forEach(info => {
    switch (format) {
      case 'standard':
        uniqueTimeframes.add(info.standard);
        break;
      case 'metatrader':
        uniqueTimeframes.add(info.metatrader);
        break;
      case 'minutes':
        uniqueTimeframes.add(info.minutes.toString());
        break;
    }
  });

  return Array.from(uniqueTimeframes).sort((a, b) => {
    const aInfo = Object.values(TIMEFRAME_MAP).find(tf =>
      tf.standard === a || tf.metatrader === a || tf.minutes.toString() === a
    );
    const bInfo = Object.values(TIMEFRAME_MAP).find(tf =>
      tf.standard === b || tf.metatrader === b || tf.minutes.toString() === b
    );
    return (aInfo?.minutes || 0) - (bInfo?.minutes || 0);
  });
}

/**
 * Normalize all timeframe keys in an object
 */
export function normalizeTimeframeKeys<T>(
  obj: Record<string, T>,
  format: TimeframeFormat = 'standard'
): Record<string, T> {
  const normalized: Record<string, T> = {};

  for (const [key, value] of Object.entries(obj)) {
    const normalizedKey = normalizeTimeframe(key, format);
    normalized[normalizedKey] = value;
  }

  return normalized;
}

/**
 * Find a timeframe in an object using any valid format
 */
export function findTimeframeInObject<T>(
  obj: Record<string, T>,
  timeframe: string
): { key: string; value: T } | null {
  // Try direct match first
  if (obj[timeframe]) {
    return { key: timeframe, value: obj[timeframe] };
  }

  // Try all equivalent formats
  const info = getTimeframeInfo(timeframe);
  if (!info) {
    return null;
  }

  const possibleKeys = [info.standard, info.metatrader, info.minutes.toString()];

  for (const key of possibleKeys) {
    if (obj[key]) {
      return { key, value: obj[key] };
    }
  }

  return null;
}
