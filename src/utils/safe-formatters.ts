/**
 * Safe Number Formatting Utilities
 *
 * Bulletproof formatters that handle undefined, null, NaN, and Infinity gracefully.
 * Use these instead of direct .toFixed() calls to prevent crashes.
 */

/**
 * Safely format a number with decimal places
 * @param value - The number to format (can be undefined/null)
 * @param decimals - Number of decimal places
 * @param fallback - Default value if input is invalid
 * @returns Formatted string
 */
export function safeToFixed(
  value: number | undefined | null,
  decimals: number,
  fallback: number = 0
): string {
  if (value === null || value === undefined || isNaN(value) || !isFinite(value)) {
    return fallback.toFixed(decimals);
  }
  return value.toFixed(decimals);
}

/**
 * Safely format a percentage
 * @param value - The percentage value (can be undefined/null)
 * @param decimals - Number of decimal places (default: 1)
 * @param fallback - Default value if input is invalid
 * @returns Formatted string with % symbol
 */
export function safePercent(
  value: number | undefined | null,
  decimals: number = 1,
  fallback: number = 0
): string {
  return `${safeToFixed(value, decimals, fallback)}%`;
}

/**
 * Safely format a currency value
 * @param value - The currency amount (can be undefined/null)
 * @param decimals - Number of decimal places (default: 2)
 * @param fallback - Default value if input is invalid
 * @param symbol - Currency symbol (default: $)
 * @returns Formatted string with currency symbol
 */
export function safeCurrency(
  value: number | undefined | null,
  decimals: number = 2,
  fallback: number = 0,
  symbol: string = '$'
): string {
  return `${symbol}${safeToFixed(value, decimals, fallback)}`;
}

/**
 * Safely format a number with fallback
 * @param value - The number to format (can be undefined/null)
 * @param fallback - Default value if input is invalid
 * @returns Number or fallback
 */
export function safeNumber(
  value: number | undefined | null,
  fallback: number = 0
): number {
  if (value === null || value === undefined || isNaN(value) || !isFinite(value)) {
    return fallback;
  }
  return value;
}

/**
 * Safely format a number with + or - prefix for gaps/deltas
 * @param value - The number to format (can be undefined/null)
 * @param decimals - Number of decimal places
 * @param fallback - Default value if input is invalid
 * @returns Formatted string with +/- prefix
 */
export function safeDelta(
  value: number | undefined | null,
  decimals: number,
  fallback: number = 0
): string {
  const num = safeNumber(value, fallback);
  const formatted = safeToFixed(num, decimals, fallback);
  return num >= 0 ? `+${formatted}` : formatted;
}

/**
 * Safely get a nested object property
 * @param obj - The object to access
 * @param path - Dot-notation path (e.g., 'user.profile.name')
 * @param fallback - Default value if path doesn't exist
 * @returns Value at path or fallback
 */
export function safeGet<T = any>(
  obj: any,
  path: string,
  fallback: T
): T {
  if (!obj) return fallback;

  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (current === null || current === undefined || !(key in current)) {
      return fallback;
    }
    current = current[key];
  }

  return current ?? fallback;
}
