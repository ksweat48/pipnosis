/**
 * Timeframe Conversion Utility
 *
 * The database stores timeframes in UPPERCASE format: M1, M5, M15, M30, H1, H4, D1, W1, MN
 * The application UI uses the same UPPERCASE format: M1, M5, M15, M30, H1, H4, D1, W1, MN
 *
 * This utility ensures consistent conversion between app and database formats.
 */

export type AppTimeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'MN';
export type DatabaseTimeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'MN';

/**
 * Convert application timeframe to database timeframe format
 * Note: Currently they are the same (both uppercase), but this function
 * exists for consistency and future-proofing
 */
export function appToDbTimeframe(appTimeframe: string): string {
  // Normalize input
  const normalized = appTimeframe.toUpperCase();

  // Map common variations to standard format
  const mapping: Record<string, string> = {
    // Lowercase variations
    'm1': 'M1',
    'm5': 'M5',
    'm15': 'M15',
    'm30': 'M30',
    'h1': 'H1',
    'h4': 'H4',
    'd1': 'D1',
    'mn': 'MN',

    // Numeric-only variations
    '1m': 'M1',
    '5m': 'M5',
    '15m': 'M15',
    '30m': 'M30',
    '1h': 'H1',
    '4h': 'H4',
    '1d': 'D1',
    '1mo': 'MN',

    // Already correct format
    'M1': 'M1',
    'M5': 'M5',
    'M15': 'M15',
    'M30': 'M30',
    'H1': 'H1',
    'H4': 'H4',
    'D1': 'D1',
    'MN': 'MN'
  };

  const result = mapping[normalized] || mapping[appTimeframe.toLowerCase()];

  if (!result) {
    console.warn(`Unknown timeframe format: ${appTimeframe}, returning as-is`);
    return normalized;
  }

  return result;
}

/**
 * Convert database timeframe to application timeframe format
 * Note: Currently they are the same (both uppercase)
 */
export function dbToAppTimeframe(dbTimeframe: string): string {
  // Database format IS the app format (both uppercase)
  return dbTimeframe.toUpperCase();
}

/**
 * Validate if a timeframe string is in the correct format
 */
export function isValidTimeframe(timeframe: string): boolean {
  const valid = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'MN'];
  return valid.includes(timeframe.toUpperCase());
}

/**
 * Get timeframe in minutes for calculations
 */
export function timeframeToMinutes(timeframe: string): number {
  const normalized = appToDbTimeframe(timeframe);

  const mapping: Record<string, number> = {
    'M1': 1,
    'M5': 5,
    'M15': 15,
    'M30': 30,
    'H1': 60,
    'H4': 240,
    'D1': 1440,
    'MN': 43200
  };

  return mapping[normalized] || 1;
}

/**
 * Get human-readable timeframe label
 */
export function timeframeToLabel(timeframe: string): string {
  const normalized = appToDbTimeframe(timeframe);

  const mapping: Record<string, string> = {
    'M1': '1 Minute',
    'M5': '5 Minutes',
    'M15': '15 Minutes',
    'M30': '30 Minutes',
    'H1': '1 Hour',
    'H4': '4 Hours',
    'D1': '1 Day',
    'MN': '1 Month'
  };

  return mapping[normalized] || normalized;
}
