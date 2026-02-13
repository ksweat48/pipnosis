/**
 * Dynamic Pip Value Calculator (TIER 3 FIX)
 *
 * SSOT Authority: Calculates real-time pip values for JPY pairs using live USDJPY rate.
 *
 * Governance:
 * - Validates: Fetches live rates and calculates dynamic values
 * - Alpha Decides: Uses enhanced pip values for better sizing
 * - Degrades Intelligently: Falls back to static $10 with warning if rate unavailable
 *
 * CCIP Compliance: Non-breaking enhancement to existing pip calculation
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

interface PipValueResult {
  dollarPerPipPerLot: number;
  source: 'dynamic' | 'static_fallback';
  usdjpyRate?: number;
  timestamp?: Date;
}

// Cache for USDJPY rate (5 minute TTL)
let cachedRate: { rate: number; timestamp: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * TIER 3 FIX: Dynamic JPY pip calculations
 *
 * Calculates dollar value per pip for JPY pairs using live USDJPY rate.
 * Formula: $1 USD = X JPY, so 1 pip (0.01 JPY) = $1 / (USDJPY * 100)
 *
 * For standard 0.1 lot (10,000 units):
 * Pip Value = (0.01 * 10,000) / USDJPY rate
 *
 * @param symbol Currency pair (e.g., EURJPY, GBPJPY)
 * @returns Pip value result with source tracking
 */
export async function calculateDynamicJPYPipValue(
  symbol: string
): Promise<PipValueResult> {
  // Only apply to JPY pairs
  if (!symbol.endsWith('JPY')) {
    return {
      dollarPerPipPerLot: 10,
      source: 'static_fallback' as const
    };
  }

  try {
    // Check cache first
    const now = Date.now();
    if (cachedRate && (now - cachedRate.timestamp) < CACHE_TTL_MS) {
      const pipValue = calculatePipValueFromRate(cachedRate.rate);
      return {
        dollarPerPipPerLot: pipValue,
        source: 'dynamic' as const,
        usdjpyRate: cachedRate.rate,
        timestamp: new Date(cachedRate.timestamp)
      };
    }

    // Fetch live USDJPY rate from realtime_prices
    const { data: priceData, error } = await supabase
      .from('realtime_prices')
      .select('bid, ask')
      .eq('symbol', 'USDJPY')
      .maybeSingle();

    if (error || !priceData || !priceData.bid || !priceData.ask) {
      // Intelligent degradation: warn but don't block
      logger.warn('Dynamic pip calculator: USDJPY rate unavailable, using static $10 fallback', {
        symbol,
        error: error?.message,
        dataPresent: !!priceData
      });

      return {
        dollarPerPipPerLot: 10,
        source: 'static_fallback' as const
      };
    }

    // Calculate mid-price
    const usdjpyRate = (priceData.bid + priceData.ask) / 2;

    // Update cache
    cachedRate = {
      rate: usdjpyRate,
      timestamp: now
    };

    const pipValue = calculatePipValueFromRate(usdjpyRate);

    logger.info('Dynamic pip calculator: Using live USDJPY rate', {
      symbol,
      usdjpyRate,
      pipValue,
      source: 'dynamic'
    });

    return {
      dollarPerPipPerLot: pipValue,
      source: 'dynamic' as const,
      usdjpyRate,
      timestamp: new Date()
    };

  } catch (error) {
    // Intelligent degradation: catch any unexpected errors
    logger.warn('Dynamic pip calculator: Error calculating dynamic pip value, using static fallback', {
      symbol,
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      dollarPerPipPerLot: 10,
      source: 'static_fallback' as const
    };
  }
}

/**
 * Calculate pip value from USDJPY rate
 *
 * For 0.1 lot (10,000 units) of JPY pair:
 * - 1 pip = 0.01 JPY
 * - Pip value in units = 0.01 * 10,000 = 100 JPY
 * - Convert to USD = 100 / USDJPY rate
 *
 * Example: If USDJPY = 150.00
 * - Pip value = 100 / 150 = $0.667 per 0.01 lot
 * - For 0.1 lot = $0.667 * 10 = $6.67
 *
 * Normalized to per 0.1 lot: multiply by 10
 */
function calculatePipValueFromRate(usdjpyRate: number): number {
  // For 0.1 lot (10,000 units)
  const pipValuePerMiniLot = (0.01 * 10000) / usdjpyRate;

  // Normalize to standard "per 0.1 lot" format
  const normalizedValue = pipValuePerMiniLot * 10;

  // Round to 2 decimal places for consistency
  return Math.round(normalizedValue * 100) / 100;
}

/**
 * Get cached USDJPY rate without fetching (for display purposes)
 */
export function getCachedUSDJPYRate(): number | null {
  if (!cachedRate) return null;

  const now = Date.now();
  if ((now - cachedRate.timestamp) > CACHE_TTL_MS) {
    return null; // Expired
  }

  return cachedRate.rate;
}

/**
 * Clear cache (for testing or manual refresh)
 */
export function clearPipValueCache(): void {
  cachedRate = null;
  logger.info('Dynamic pip calculator: Cache cleared');
}
