/**
 * Trade Learning Filter - SSOT for Trade Learning Eligibility
 *
 * This is the SINGLE SOURCE OF TRUTH for determining whether a trade
 * should be included in Alpha's learning systems.
 *
 * CRITICAL: All learning services must use this filter to ensure consistency.
 * System closures should NEVER affect Alpha's learning - they're not Alpha's fault.
 */

import { CloseReason, isSystemClosure } from '../types/position';
import { mapDatabaseToCloseReason, mapAnalysisToCloseReason } from './close-reason-mapper';

/**
 * Determine if a trade should be included in learning systems
 *
 * Returns false for:
 * - System closures (weekend_protection, holiday_closure, force_closed, market_closed)
 * - These are external factors, NOT Alpha's trading decisions
 *
 * Returns true for:
 * - Organic trade outcomes (TP, SL, manual closes, etc.)
 * - These reflect Alpha's decision quality
 */
export function shouldIncludeInLearning(closeReason: CloseReason | string | null | undefined): boolean {
  if (!closeReason) {
    // No close reason means likely still open or data issue
    return false;
  }

  // Normalize to CloseReason type
  let normalizedReason: CloseReason;

  if (typeof closeReason === 'string') {
    // Could be database string or analysis string
    // Try database format first (more common)
    normalizedReason = mapDatabaseToCloseReason(closeReason);

    // If that returned 'manual' but string doesn't match, try analysis format
    if (normalizedReason === 'manual' && closeReason.toLowerCase() !== 'manual') {
      normalizedReason = mapAnalysisToCloseReason(closeReason);
    }
  } else {
    normalizedReason = closeReason;
  }

  // System closures should NOT affect learning
  if (isSystemClosure(normalizedReason)) {
    return false;
  }

  // All other close reasons should be included in learning
  return true;
}

/**
 * Get human-readable reason why a trade is excluded from learning
 * Returns null if trade should be included
 */
export function getExclusionReason(closeReason: CloseReason | string | null | undefined): string | null {
  if (!shouldIncludeInLearning(closeReason)) {
    if (!closeReason) {
      return 'No close reason recorded';
    }

    // Normalize to CloseReason type
    let normalizedReason: CloseReason;
    if (typeof closeReason === 'string') {
      normalizedReason = mapDatabaseToCloseReason(closeReason);
    } else {
      normalizedReason = closeReason;
    }

    if (isSystemClosure(normalizedReason)) {
      return `System closure (${normalizedReason}) - not Alpha's decision`;
    }

    return 'Trade data incomplete';
  }

  return null;
}

/**
 * Batch filter trades for learning eligibility
 * Returns only trades that should be included in learning
 */
export function filterTradesForLearning<T extends { close_reason?: CloseReason | string | null }>(
  trades: T[]
): T[] {
  return trades.filter(trade => shouldIncludeInLearning(trade.close_reason));
}

/**
 * Count trades excluded from learning
 * Useful for analytics and debugging
 */
export function countExcludedTrades<T extends { close_reason?: CloseReason | string | null }>(
  trades: T[]
): {
  total: number;
  excluded: number;
  systemClosures: number;
  missingData: number;
} {
  let excluded = 0;
  let systemClosures = 0;
  let missingData = 0;

  for (const trade of trades) {
    if (!shouldIncludeInLearning(trade.close_reason)) {
      excluded++;

      if (!trade.close_reason) {
        missingData++;
      } else {
        // Normalize to CloseReason type
        let normalizedReason: CloseReason;
        if (typeof trade.close_reason === 'string') {
          normalizedReason = mapDatabaseToCloseReason(trade.close_reason);
        } else {
          normalizedReason = trade.close_reason;
        }

        if (isSystemClosure(normalizedReason)) {
          systemClosures++;
        }
      }
    }
  }

  return {
    total: trades.length,
    excluded,
    systemClosures,
    missingData
  };
}
