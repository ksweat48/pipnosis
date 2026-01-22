/**
 * Trade Learning Filter - SSOT for Trade Learning Eligibility
 *
 * This is the SINGLE SOURCE OF TRUTH for determining whether a trade
 * should be included in Alpha's learning systems.
 *
 * CRITICAL: All learning services must use this filter to ensure consistency.
 *
 * LEARNING RULES:
 * 1. System closures (weekend_protection, holiday_closure, etc.) NEVER affect learning
 * 2. Manual closes ONLY affect learning if trade reached a milestone first
 * 3. Milestone = SL, TP, TP1, TP2, or trailing_stop
 * 4. Early manual close (before any milestone) = EXCLUDED from learning
 *
 * RATIONALE: Alpha should only learn from fully executed trades where its decision
 * reached a natural conclusion, not from user impatience or premature intervention.
 */

import { CloseReason, isSystemClosure, isMilestoneClose } from '../types/position';
import { mapDatabaseToCloseReason, mapAnalysisToCloseReason } from './close-reason-mapper';

/**
 * Determine if a trade should be included in learning systems
 *
 * EXCLUSION RULES:
 * 1. System closures (weekend_protection, holiday_closure, force_closed, market_closed) - NOT Alpha's fault
 * 2. Manual closes WITHOUT milestone - user exited early, not a complete trade
 * 3. Missing close reason - incomplete data
 *
 * INCLUSION RULES:
 * 1. Milestone closes (SL, TP, TP1, TP2, trailing_stop) - fully executed
 * 2. Manual closes if trade already hit a milestone (breakeven included via trailing_stop)
 * 3. Goal-based closes (goal_achieved) - valid outcome
 *
 * @param closeReason - The close reason from database or analysis
 * @param tradeData - Optional trade data with milestone flags (tp1_hit, tp2_hit, etc.)
 * @returns true if trade should be included in Alpha's learning
 */
export function shouldIncludeInLearning(
  closeReason: CloseReason | string | null | undefined,
  tradeData?: {
    tp1_hit?: boolean;
    tp2_hit?: boolean;
    sl_hit?: boolean;
    trailing_active?: boolean;
    breakeven_moved?: boolean;
  }
): boolean {
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

  // Rule 1: System closures should NEVER affect learning
  if (isSystemClosure(normalizedReason)) {
    return false;
  }

  // Rule 2: Milestone closes ALWAYS included (these are fully executed)
  if (isMilestoneClose(normalizedReason)) {
    return true;
  }

  // Rule 3: Goal-based closes are valid outcomes
  if (normalizedReason === 'goal_achieved') {
    return true;
  }

  // Rule 4: Manual closes - ONLY if trade reached a milestone first
  if (normalizedReason === 'manual') {
    // If we have trade data, check milestone flags
    if (tradeData) {
      const reachedMilestone =
        tradeData.tp1_hit === true ||
        tradeData.tp2_hit === true ||
        tradeData.sl_hit === true ||
        tradeData.trailing_active === true ||
        tradeData.breakeven_moved === true;

      // Only include if reached a milestone before manual close
      return reachedMilestone;
    }

    // Without trade data, we can't verify milestone status
    // CONSERVATIVE: Exclude from learning (fail-safe)
    // This prevents polluting learning data with potentially premature closes
    return false;
  }

  // Rule 5: All other reasons (risk_limit, session_ended, etc.) are excluded
  // These are typically system/time-based, not trade execution outcomes
  return false;
}

/**
 * Get human-readable reason why a trade is excluded from learning
 * Returns null if trade should be included
 */
export function getExclusionReason(
  closeReason: CloseReason | string | null | undefined,
  tradeData?: {
    tp1_hit?: boolean;
    tp2_hit?: boolean;
    sl_hit?: boolean;
    trailing_active?: boolean;
    breakeven_moved?: boolean;
  }
): string | null {
  if (!shouldIncludeInLearning(closeReason, tradeData)) {
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

    if (normalizedReason === 'manual') {
      return 'Manual close before reaching any milestone (SL/TP1/TP2) - incomplete trade';
    }

    if (normalizedReason === 'session_ended' || normalizedReason === 'goal_expired') {
      return 'Time-based closure - not a trading decision outcome';
    }

    return 'Trade data incomplete or non-execution related closure';
  }

  return null;
}

/**
 * Batch filter trades for learning eligibility
 * Returns only trades that should be included in learning
 */
export function filterTradesForLearning<T extends {
  close_reason?: CloseReason | string | null;
  tp1_hit?: boolean;
  tp2_hit?: boolean;
  sl_hit?: boolean;
  trailing_active?: boolean;
  breakeven_moved?: boolean;
}>(
  trades: T[]
): T[] {
  return trades.filter(trade =>
    shouldIncludeInLearning(trade.close_reason, {
      tp1_hit: trade.tp1_hit,
      tp2_hit: trade.tp2_hit,
      sl_hit: trade.sl_hit,
      trailing_active: trade.trailing_active,
      breakeven_moved: trade.breakeven_moved
    })
  );
}

/**
 * Count trades excluded from learning
 * Useful for analytics and debugging
 */
export function countExcludedTrades<T extends {
  close_reason?: CloseReason | string | null;
  tp1_hit?: boolean;
  tp2_hit?: boolean;
  sl_hit?: boolean;
  trailing_active?: boolean;
  breakeven_moved?: boolean;
}>(
  trades: T[]
): {
  total: number;
  excluded: number;
  systemClosures: number;
  earlyManualCloses: number;
  missingData: number;
} {
  let excluded = 0;
  let systemClosures = 0;
  let earlyManualCloses = 0;
  let missingData = 0;

  for (const trade of trades) {
    const tradeData = {
      tp1_hit: trade.tp1_hit,
      tp2_hit: trade.tp2_hit,
      sl_hit: trade.sl_hit,
      trailing_active: trade.trailing_active,
      breakeven_moved: trade.breakeven_moved
    };

    if (!shouldIncludeInLearning(trade.close_reason, tradeData)) {
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
        } else if (normalizedReason === 'manual') {
          earlyManualCloses++;
        }
      }
    }
  }

  return {
    total: trades.length,
    excluded,
    systemClosures,
    earlyManualCloses,
    missingData
  };
}
