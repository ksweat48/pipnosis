/**
 * Pure utility functions for timeframe normalization
 * Safe to import in both browser and Node.js environments
 */

export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';

export function appTimeframeToDb(timeframe: Timeframe): string {
  // Database uses UPPERCASE format: M1, M5, H1, etc. (same as app format)
  // Ensure timeframe is uppercase to handle any legacy lowercase variants
  return timeframe.toUpperCase();
}

export function dbTimeframeToApp(dbTimeframe: string): Timeframe {
  // Database format is the same as app format (both uppercase)
  // Support legacy lowercase formats by converting to uppercase
  const normalized = dbTimeframe.toUpperCase();

  // Validate it's a known timeframe
  const validTimeframes: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
  if (validTimeframes.includes(normalized as Timeframe)) {
    return normalized as Timeframe;
  }

  // Legacy mappings for old format
  const legacyMapping: Record<string, Timeframe> = {
    '1M': 'M1',
    '5M': 'M5',
    '15M': 'M15',
    '30M': 'M30',
    '1H': 'H1',
    '4H': 'H4',
    '1D': 'D1'
  };

  return legacyMapping[normalized] || 'M1';
}

export function normalizeTimeframeToDb(timeframe: string): string {
  const upper = timeframe.toUpperCase();

  // Already in correct format (M1, M5, M15, etc.)
  if (/^[MHD]\d+$/.test(upper)) {
    return upper;
  }

  // Handle legacy formats (1m, 5m, 1h, etc.)
  const legacyMapping: Record<string, string> = {
    '1M': 'M1',
    '5M': 'M5',
    '15M': 'M15',
    '30M': 'M30',
    '1H': 'H1',
    '4H': 'H4',
    '1D': 'D1',
    // Lowercase variants
    '1m': 'M1',
    '5m': 'M5',
    '15m': 'M15',
    '30m': 'M30',
    '1h': 'H1',
    '4h': 'H4',
    '1d': 'D1'
  };

  return legacyMapping[timeframe] || upper;
}
