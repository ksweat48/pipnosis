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
 *    OR if the trade qualifies as a near-miss (direction correct, peak_hit_ratio >= 0.70)
 * 3. Milestone = SL, TP, TP1, TP2, or trailing_stop
 * 4. Near-miss = manual/session close, final P&L <= 0, but price reached 70%+ of TP distance
 * 5. Early manual close (before any milestone, not a near-miss) = EXCLUDED from learning
 *
 * RATIONALE: Alpha should learn from fully executed trades AND from near-miss events
 * where it correctly identified direction but the TP target was placed too far.
 * Near-miss trades are entered with a distinct 'near_miss' analysis reason so they
 * are counted as directional wins but TP placement failures — not as full losses.
 */

import { CloseReason, isSystemClosure, isMilestoneClose } from '../types/position';
import { mapDatabaseToCloseReason, mapAnalysisToCloseReason } from './close-reason-mapper';

/**
 * Determine if a trade should be included in learning systems
 *
 * EXCLUSION RULES:
 * 1. System closures (weekend_protection, holiday_closure, force_closed, market_closed) - NOT Alpha's fault
 * 2. Manual closes WITHOUT milestone AND NOT a near-miss - user exited early, not a complete trade
 * 3. Missing close reason - incomplete data
 *
 * INCLUSION RULES:
 * 1. Milestone closes (SL, TP, TP1, TP2, trailing_stop) - fully executed
 * 2. Manual closes if trade already hit a milestone (breakeven included via trailing_stop)
 * 3. Goal-based closes (goal_achieved) - valid outcome
 * 4. Near-miss: manual/session close, P&L <= 0, peak_hit_ratio >= 0.70 — direction was correct
 *
 * @param closeReason - The close reason from database or analysis
 * @param tradeData - Optional trade data with milestone flags and near-miss metrics
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
    peak_hit_ratio?: number | null;
    final_pnl?: number | null;
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

  // Rule 4: Manual closes — ONLY if trade reached a milestone first OR qualifies as near-miss
  if (normalizedReason === 'manual') {
    if (tradeData) {
      const reachedMilestone =
        tradeData.tp1_hit === true ||
        tradeData.tp2_hit === true ||
        tradeData.sl_hit === true ||
        tradeData.trailing_active === true ||
        tradeData.breakeven_moved === true;

      if (reachedMilestone) return true;

      // Near-miss path: direction was correct (peak reached 70%+ of TP distance)
      // but trade closed in loss before any milestone fired.
      // Alpha correctly called the move — it should learn from this even though
      // it wasn't a milestone close. The TP was placed too far.
      const NEAR_MISS_THRESHOLD = 0.70;
      const isNearMiss =
        tradeData.peak_hit_ratio != null &&
        tradeData.peak_hit_ratio >= NEAR_MISS_THRESHOLD &&
        (tradeData.final_pnl == null || tradeData.final_pnl <= 0);

      return isNearMiss;
    }

    // Without trade data, we can't verify milestone or near-miss status.
    // CONSERVATIVE: Exclude from learning (fail-safe).
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
    peak_hit_ratio?: number | null;
    final_pnl?: number | null;
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
      return 'Manual close before reaching any milestone (SL/TP1/TP2) and peak_hit_ratio < 0.70 - incomplete trade, not a near-miss';
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
  peak_hit_ratio?: number | null;
  profit_loss?: number | string | null;
}>(
  trades: T[]
): T[] {
  return trades.filter(trade => {
    const finalPnl = trade.profit_loss != null
      ? (typeof trade.profit_loss === 'string' ? parseFloat(trade.profit_loss) : trade.profit_loss)
      : null;

    return shouldIncludeInLearning(trade.close_reason, {
      tp1_hit: trade.tp1_hit,
      tp2_hit: trade.tp2_hit,
      sl_hit: trade.sl_hit,
      trailing_active: trade.trailing_active,
      breakeven_moved: trade.breakeven_moved,
      peak_hit_ratio: trade.peak_hit_ratio,
      final_pnl: finalPnl
    });
  });
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
  peak_hit_ratio?: number | null;
  profit_loss?: number | string | null;
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
    const finalPnl = trade.profit_loss != null
      ? (typeof trade.profit_loss === 'string' ? parseFloat(trade.profit_loss as string) : trade.profit_loss as number)
      : null;

    const tradeData = {
      tp1_hit: trade.tp1_hit,
      tp2_hit: trade.tp2_hit,
      sl_hit: trade.sl_hit,
      trailing_active: trade.trailing_active,
      breakeven_moved: trade.breakeven_moved,
      peak_hit_ratio: trade.peak_hit_ratio,
      final_pnl: finalPnl
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
