/**
 * Thesis Rejection Learning Logger
 *
 * HIGH-VALUE LEARNING SIGNAL: When Alpha rejects a cached thesis, it means:
 * - Market truth changed
 * - Thesis was poorly formed
 * - Regime signature was insufficient
 * - Structure invalidation occurred
 *
 * This is a first-class learning signal for:
 * - Offline analysis of false theses
 * - Improving regime signature definition
 * - Improving thesis quality
 * - Improving Omega weighting
 *
 * IMPORTANT: Rejections do NOT:
 * - Penalize Alpha confidence
 * - Auto-disable caching
 * - Trigger errors or alerts
 *
 * They are purely for learning and improvement.
 */

import { supabase } from '../lib/supabase';
import { ThesisRejectionEvent, RegimeSignature } from '../types/alpha-thesis';
import { logger } from '../lib/logger';

/**
 * Log thesis rejection event to database
 * Stores high-value learning signal for offline analysis
 */
export async function logThesisRejection(
  thesisId: string,
  symbol: string,
  rejectionReason: string,
  currentRegimeSnapshot: RegimeSignature,
  timeSinceThesisMs: number,
  executionStyle: string,
  sessionContext: string
): Promise<void> {
  try {
    const rejectionEvent: Omit<ThesisRejectionEvent, 'rejectedAt'> = {
      thesisId,
      symbol,
      rejectionReason,
      currentRegimeSnapshot,
      timeSinceThesisMs,
      executionStyle,
      sessionContext
    };

    const { error } = await supabase
      .from('alpha_thesis_rejections')
      .insert({
        thesis_id: thesisId,
        symbol,
        rejection_reason: rejectionReason,
        current_regime_snapshot: currentRegimeSnapshot,
        time_since_thesis_ms: timeSinceThesisMs,
        execution_style: executionStyle,
        session_context: sessionContext,
        rejected_at: new Date().toISOString()
      });

    if (error) {
      logger.error('[ThesisRejectionLogger] Failed to log rejection', {
        error: error.message,
        symbol,
        thesisId
      });
      return;
    }

    logger.info('[ThesisRejectionLogger] Rejection logged successfully', {
      symbol,
      thesisId,
      reason: rejectionReason,
      timeSinceMs: timeSinceThesisMs
    });
  } catch (error) {
    logger.error('[ThesisRejectionLogger] Unexpected error logging rejection', {
      error: error instanceof Error ? error.message : 'Unknown error',
      symbol,
      thesisId
    });
  }
}

/**
 * Get rejection analytics for a symbol
 * Used for offline analysis and thesis quality improvement
 *
 * CCIP-REJECTION-LOGGER-FIX: Added queryFailed flag so callers can distinguish
 * a genuine "no rejections in window" (queryFailed: false, totalRejections: 0)
 * from a DB error that returned zeroed defaults (queryFailed: true).
 */
export async function getRejectionAnalytics(
  symbol: string,
  days: number = 7
): Promise<{
  totalRejections: number;
  avgTimeSinceThesisMs: number;
  topRejectionReasons: Array<{ reason: string; count: number }>;
  rejectionRate: number;
  queryFailed: boolean;
}> {
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Get rejection count
    const { data: rejections, error: rejectionsError } = await supabase
      .from('alpha_thesis_rejections')
      .select('*')
      .eq('symbol', symbol)
      .gte('rejected_at', since.toISOString());

    if (rejectionsError) {
      throw rejectionsError;
    }

    if (!rejections || rejections.length === 0) {
      return {
        totalRejections: 0,
        avgTimeSinceThesisMs: 0,
        topRejectionReasons: [],
        rejectionRate: 0,
        queryFailed: false
      };
    }

    // Calculate average time since thesis
    const avgTimeSinceThesisMs = rejections.reduce(
      (sum, r) => sum + (r.time_since_thesis_ms || 0),
      0
    ) / rejections.length;

    // Count rejection reasons
    const reasonCounts = new Map<string, number>();
    for (const rejection of rejections) {
      const reason = rejection.rejection_reason || 'Unknown';
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }

    const topRejectionReasons = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Get total thesis lookups to calculate rejection rate
    const { count: totalLookups } = await supabase
      .from('alpha_market_thesis_cache')
      .select('*', { count: 'exact', head: true })
      .eq('symbol', symbol)
      .gte('created_at', since.toISOString());

    const rejectionRate = totalLookups ? rejections.length / totalLookups : 0;

    return {
      totalRejections: rejections.length,
      avgTimeSinceThesisMs,
      topRejectionReasons,
      rejectionRate,
      queryFailed: false
    };
  } catch (error) {
    logger.error('[ThesisRejectionLogger] Failed to get analytics', {
      error: error instanceof Error ? error.message : 'Unknown error',
      symbol
    });

    return {
      totalRejections: 0,
      avgTimeSinceThesisMs: 0,
      topRejectionReasons: [],
      rejectionRate: 0,
      queryFailed: true
    };
  }
}

/**
 * Get regime-specific rejection patterns
 * Identifies which regime signatures produce the most rejections
 *
 * CCIP-REJECTION-LOGGER-FIX: Returns { data, queryFailed } so callers distinguish
 * genuine empty results from DB errors.
 */
export async function getRegimeRejectionPatterns(
  days: number = 30
): Promise<{
  data: Array<{
    htfBias: string;
    microRegime: string;
    volatilityRegime: string;
    structureState: string;
    rejectionCount: number;
    avgTimeSinceThesisMs: number;
  }>;
  queryFailed: boolean;
}> {
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data: rejections, error } = await supabase
      .from('alpha_thesis_rejections')
      .select('*')
      .gte('rejected_at', since.toISOString());

    if (error) {
      throw error;
    }

    if (!rejections || rejections.length === 0) {
      return { data: [], queryFailed: false };
    }

    // Group by regime signature
    const regimeGroups = new Map<string, {
      signature: RegimeSignature;
      rejections: number;
      totalTime: number;
    }>();

    for (const rejection of rejections) {
      const snapshot = rejection.current_regime_snapshot as RegimeSignature;
      if (!snapshot) continue;

      const key = `${snapshot.htfBias}|${snapshot.microRegime}|${snapshot.volatilityRegime}|${snapshot.structureState}`;

      const existing = regimeGroups.get(key);
      if (existing) {
        existing.rejections++;
        existing.totalTime += rejection.time_since_thesis_ms || 0;
      } else {
        regimeGroups.set(key, {
          signature: snapshot,
          rejections: 1,
          totalTime: rejection.time_since_thesis_ms || 0
        });
      }
    }

    // Convert to array and sort by rejection count
    const data = Array.from(regimeGroups.values())
      .map(group => ({
        htfBias: group.signature.htfBias,
        microRegime: group.signature.microRegime,
        volatilityRegime: group.signature.volatilityRegime,
        structureState: group.signature.structureState,
        rejectionCount: group.rejections,
        avgTimeSinceThesisMs: group.totalTime / group.rejections
      }))
      .sort((a, b) => b.rejectionCount - a.rejectionCount)
      .slice(0, 10);

    return { data, queryFailed: false };
  } catch (error) {
    logger.error('[ThesisRejectionLogger] Failed to get regime patterns', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return { data: [], queryFailed: true };
  }
}

/**
 * Get execution-style rejection patterns
 * Identifies if certain execution styles trigger more rejections
 * (Note: This is for analysis only - execution style should NOT influence caching)
 *
 * CCIP-REJECTION-LOGGER-FIX: Returns { data, queryFailed } so callers distinguish
 * genuine empty results from DB errors.
 */
export async function getExecutionStyleRejectionPatterns(
  days: number = 30
): Promise<{
  data: Array<{
    executionStyle: string;
    sessionContext: string;
    rejectionCount: number;
    avgTimeSinceThesisMs: number;
  }>;
  queryFailed: boolean;
}> {
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data: rejections, error } = await supabase
      .from('alpha_thesis_rejections')
      .select('*')
      .gte('rejected_at', since.toISOString());

    if (error) {
      throw error;
    }

    if (!rejections || rejections.length === 0) {
      return { data: [], queryFailed: false };
    }

    // Group by execution style and session
    const styleGroups = new Map<string, {
      rejections: number;
      totalTime: number;
    }>();

    for (const rejection of rejections) {
      const key = `${rejection.execution_style}|${rejection.session_context}`;

      const existing = styleGroups.get(key);
      if (existing) {
        existing.rejections++;
        existing.totalTime += rejection.time_since_thesis_ms || 0;
      } else {
        styleGroups.set(key, {
          rejections: 1,
          totalTime: rejection.time_since_thesis_ms || 0
        });
      }
    }

    // Convert to array and sort by rejection count
    const data = Array.from(styleGroups.entries())
      .map(([key, group]) => {
        const [executionStyle, sessionContext] = key.split('|');
        return {
          executionStyle,
          sessionContext,
          rejectionCount: group.rejections,
          avgTimeSinceThesisMs: group.totalTime / group.rejections
        };
      })
      .sort((a, b) => b.rejectionCount - a.rejectionCount)
      .slice(0, 10);

    return { data, queryFailed: false };
  } catch (error) {
    logger.error('[ThesisRejectionLogger] Failed to get style patterns', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    return { data: [], queryFailed: true };
  }
}
