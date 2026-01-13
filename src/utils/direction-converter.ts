/**
 * Direction Format Converter - Single Source of Truth
 *
 * CRITICAL: Database tables expect lowercase 'buy' | 'sell' format
 *
 * Different parts of the system use different formats:
 * - entry_intents table: 'long' | 'short'
 * - goal_session_trades table: 'buy' | 'sell'
 * - TypeScript types: 'buy' | 'sell'
 *
 * This converter ensures consistent format conversion across all trade execution paths.
 */

export type DirectionDB = 'buy' | 'sell';
export type DirectionLowercase = 'buy' | 'sell';
export type DirectionLongShort = 'long' | 'short';
export type DirectionAny = DirectionDB | DirectionLowercase | DirectionLongShort;

/**
 * Convert any direction format to database format ('buy' | 'sell')
 *
 * @throws Error if invalid direction provided
 */
export function toDirectionDB(direction: DirectionAny): DirectionDB {
  if (!direction || typeof direction !== 'string') {
    throw new Error(`[Direction Converter] Invalid direction: ${direction} (type: ${typeof direction})`);
  }

  const normalized = direction.toLowerCase();

  switch (normalized) {
    case 'buy':
    case 'long':
      return 'buy';

    case 'sell':
    case 'short':
      return 'sell';

    default:
      throw new Error(`[Direction Converter] Unknown direction format: '${direction}'. Expected: 'buy', 'sell', 'long', 'short', 'BUY', or 'SELL'`);
  }
}

/**
 * Convert database direction to long/short format ('long' | 'short')
 */
export function toLongShort(direction: DirectionAny): DirectionLongShort {
  const normalized = direction.toLowerCase();

  switch (normalized) {
    case 'buy':
    case 'long':
      return 'long';

    case 'sell':
    case 'short':
      return 'short';

    default:
      throw new Error(`[Direction Converter] Unknown direction format: '${direction}'`);
  }
}

/**
 * Convert database direction to lowercase format ('buy' | 'sell')
 */
export function toLowercase(direction: DirectionAny): DirectionLowercase {
  const normalized = direction.toLowerCase();

  switch (normalized) {
    case 'buy':
    case 'long':
      return 'buy';

    case 'sell':
    case 'short':
      return 'sell';

    default:
      throw new Error(`[Direction Converter] Unknown direction format: '${direction}'`);
  }
}

/**
 * Validate direction format before database insertion
 * Returns validation result with converted value
 */
export function validateDirection(direction: any): {
  valid: boolean;
  converted?: DirectionDB;
  error?: string;
} {
  try {
    const converted = toDirectionDB(direction);
    return {
      valid: true,
      converted
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown validation error'
    };
  }
}
