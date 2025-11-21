import { supabase } from '@/lib/supabase';

/**
 * AI Session Consistency Tracker
 *
 * Manages session-based tracking for Win Rate and Profit Factor
 * to ensure AI demonstrates CONSISTENT performance over 10-session periods.
 *
 * Key Validation Rules:
 * - WR Spread: Max 10% spread (max WR - min WR) over last 10 sessions
 * - PF Average: Must meet level-specific requirements over last 10 sessions
 */

interface SessionMetrics {
  sessionId: string;
  winRate: number;
  profitFactor: number;
  winsCount: number;
  totalTrades: number;
  totalWinsValue: number;
  totalLossesValue: number;
  symbol?: string;
  timeframe?: string;
  strategyName?: string;
  backtestType: 'live' | 'backtest' | 'synthetic';
}

interface ConsistencyValidationResult {
  passed: boolean;
  wrSpread: number;
  pfAverage: number;
  sessionCount: number;
  wrSpreadViolation: boolean;
  pfAverageViolation: boolean;
  requiredPF?: number;
  failureReason?: string;
  details: {
    minWR: number;
    maxWR: number;
    last10WRs: number[];
    last10PFs: number[];
  };
}

class AISessionConsistencyTracker {
  // WR Spread thresholds by skill level transition (more lenient for early levels)
  private readonly WR_SPREAD_LIMITS: Record<number, number> = {
    1: 35.0,  // Novice -> Intermediate (very lenient - AI is still learning)
    2: 25.0,  // Intermediate -> Pro (lenient)
    3: 15.0,  // Pro -> Expert (moderate)
    4: 12.0,  // Expert -> Master (stricter)
    5: 10.0,  // Master -> Exceptional (strict)
    6: 8.0    // Exceptional (maintain - very strict)
  };

  // PF requirements by skill level (for next level advancement) - aligned with 10-session avg
  private readonly PF_REQUIREMENTS: Record<number, number> = {
    1: 1.0,  // Novice -> Intermediate
    2: 1.2,  // Intermediate -> Pro
    3: 1.5,  // Pro -> Expert
    4: 1.8,  // Expert -> Master
    5: 2.0,  // Master -> Exceptional
    6: 2.5   // Exceptional (maintain)
  };

  /**
   * Record session metrics after backtest completion
   */
  async recordSessionMetrics(
    userId: string,
    metrics: SessionMetrics
  ): Promise<void> {
    console.log(`[Session Consistency] Recording session ${metrics.sessionId} - WR: ${metrics.winRate.toFixed(1)}%, PF: ${metrics.profitFactor.toFixed(2)}`);

    try {
      // Insert WR tracking
      const { error: wrError } = await supabase
        .from('ai_session_wr_tracking')
        .insert({
          user_id: userId,
          session_id: metrics.sessionId,
          win_rate: metrics.winRate,
          wins_count: metrics.winsCount,
          total_trades: metrics.totalTrades,
          backtest_type: metrics.backtestType,
          symbol: metrics.symbol,
          timeframe: metrics.timeframe,
          strategy_name: metrics.strategyName
        });

      if (wrError) {
        console.error('[Session Consistency] Error recording WR:', wrError);
      }

      // Insert PF tracking
      const { error: pfError } = await supabase
        .from('ai_session_pf_tracking')
        .insert({
          user_id: userId,
          session_id: metrics.sessionId,
          profit_factor: metrics.profitFactor,
          total_wins_value: metrics.totalWinsValue,
          total_losses_value: metrics.totalLossesValue,
          backtest_type: metrics.backtestType,
          symbol: metrics.symbol,
          timeframe: metrics.timeframe,
          strategy_name: metrics.strategyName
        });

      if (pfError) {
        console.error('[Session Consistency] Error recording PF:', pfError);
      }

      console.log('[Session Consistency] ✅ Session metrics recorded');
    } catch (error) {
      console.error('[Session Consistency] Exception recording metrics:', error);
    }
  }

  /**
   * Validate consistency for skill level advancement
   * Returns true if AI has demonstrated consistent performance
   */
  async validateConsistency(
    userId: string,
    targetSkillLevel: number,
    currentSkillLevel: number
  ): Promise<ConsistencyValidationResult> {
    console.log(`[Session Consistency] Validating consistency for level ${currentSkillLevel} -> ${targetSkillLevel}`);

    try {
      // Get last 10 sessions (excluding sessions with 0 trades)
      const { data: wrSessions, error: wrError } = await supabase
        .from('ai_session_wr_tracking')
        .select('win_rate, session_date, total_trades')
        .eq('user_id', userId)
        .gt('total_trades', 0)
        .gt('wins_count', 0)
        .order('session_date', { ascending: false })
        .limit(10);

      if (wrError) {
        console.error('[Session Consistency] Error fetching WR sessions:', wrError);
        return this.getFailedValidation('Database error fetching WR sessions');
      }

      const { data: pfSessions, error: pfError } = await supabase
        .from('ai_session_pf_tracking')
        .select('profit_factor, session_date, total_wins_value')
        .eq('user_id', userId)
        .gt('total_wins_value', 0)
        .order('session_date', { ascending: false })
        .limit(10);

      if (pfError) {
        console.error('[Session Consistency] Error fetching PF sessions:', pfError);
        return this.getFailedValidation('Database error fetching PF sessions');
      }

      // Check if we have enough sessions
      const sessionCount = Math.min(wrSessions?.length || 0, pfSessions?.length || 0);

      if (sessionCount < 10) {
        console.log(`[Session Consistency] ⏳ Only ${sessionCount}/10 sessions completed - consistency validation skipped`);
        return {
          passed: true, // Don't block advancement until 10 sessions are complete
          wrSpread: 0,
          pfAverage: 0,
          sessionCount,
          wrSpreadViolation: false,
          pfAverageViolation: false,
          failureReason: `Need ${10 - sessionCount} more sessions before consistency validation applies`,
          details: {
            minWR: 0,
            maxWR: 0,
            last10WRs: [],
            last10PFs: []
          }
        };
      }

      // Calculate WR spread (max - min) - filter out any 0% win rates
      const winRates = wrSessions
        .map(s => parseFloat(s.win_rate.toString()))
        .filter(wr => wr > 0);

      if (winRates.length === 0) {
        console.log('[Session Consistency] No valid win rates found after filtering');
        return this.getFailedValidation('No valid sessions with winning trades');
      }

      const maxWR = Math.max(...winRates);
      const minWR = Math.min(...winRates);
      const wrSpread = maxWR - minWR;

      console.log(`[Session Consistency] WR Spread: ${wrSpread.toFixed(1)}% (Range: ${minWR.toFixed(1)}% - ${maxWR.toFixed(1)}%)`);
      console.log(`[Session Consistency] Valid sessions used: ${winRates.length}`);

      // Calculate PF average - filter out invalid values
      const profitFactors = pfSessions
        .map(s => parseFloat(s.profit_factor.toString()))
        .filter(pf => pf > 0 && isFinite(pf));

      if (profitFactors.length === 0) {
        console.log('[Session Consistency] No valid profit factors found');
        return this.getFailedValidation('No valid sessions with profit factor');
      }

      const pfAverage = profitFactors.reduce((sum, pf) => sum + pf, 0) / profitFactors.length;

      console.log(`[Session Consistency] PF Average: ${pfAverage.toFixed(2)}`);

      // Get required PF and WR spread limit for target level
      const requiredPF = this.PF_REQUIREMENTS[targetSkillLevel] || 1.0;
      const maxAllowedWRSpread = this.WR_SPREAD_LIMITS[targetSkillLevel] || 10.0;

      console.log(`[Session Consistency] Level ${currentSkillLevel} -> ${targetSkillLevel}: Max WR spread allowed: ${maxAllowedWRSpread}%`);

      // Check violations
      const wrSpreadViolation = wrSpread > maxAllowedWRSpread;
      const pfAverageViolation = pfAverage < requiredPF;

      const passed = !wrSpreadViolation && !pfAverageViolation;

      let failureReason: string | undefined;
      if (!passed) {
        const reasons: string[] = [];
        if (wrSpreadViolation) {
          reasons.push(`WR spread too high: ${wrSpread.toFixed(1)}% (max: ${maxAllowedWRSpread}%)`);
        }
        if (pfAverageViolation) {
          reasons.push(`PF average too low: ${pfAverage.toFixed(2)} (required: ${requiredPF}+)`);
        }
        failureReason = reasons.join('; ');
      }

      if (passed) {
        console.log('[Session Consistency] ✅ Consistency validation PASSED');
      } else {
        console.warn(`[Session Consistency] ❌ Consistency validation FAILED: ${failureReason}`);
      }

      return {
        passed,
        wrSpread,
        pfAverage,
        sessionCount,
        wrSpreadViolation,
        pfAverageViolation,
        requiredPF,
        failureReason,
        details: {
          minWR,
          maxWR,
          last10WRs: winRates,
          last10PFs: profitFactors
        }
      };
    } catch (error) {
      console.error('[Session Consistency] Exception during validation:', error);
      return this.getFailedValidation(`Exception: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get current consistency status for display
   */
  async getConsistencyStatus(userId: string): Promise<ConsistencyValidationResult | null> {
    try {
      const { data: wrSessions } = await supabase
        .from('ai_session_wr_tracking')
        .select('win_rate')
        .eq('user_id', userId)
        .order('session_date', { ascending: false })
        .limit(10);

      const { data: pfSessions } = await supabase
        .from('ai_session_pf_tracking')
        .select('profit_factor')
        .eq('user_id', userId)
        .order('session_date', { ascending: false })
        .limit(10);

      if (!wrSessions || !pfSessions) return null;

      const sessionCount = Math.min(wrSessions.length, pfSessions.length);

      if (sessionCount === 0) return null;

      const winRates = wrSessions.map(s => parseFloat(s.win_rate.toString()));
      const profitFactors = pfSessions.map(s => parseFloat(s.profit_factor.toString()));

      const maxWR = Math.max(...winRates);
      const minWR = Math.min(...winRates);
      const wrSpread = maxWR - minWR;
      const pfAverage = profitFactors.reduce((sum, pf) => sum + pf, 0) / profitFactors.length;

      return {
        passed: wrSpread <= this.MAX_WR_SPREAD,
        wrSpread,
        pfAverage,
        sessionCount,
        wrSpreadViolation: wrSpread > this.MAX_WR_SPREAD,
        pfAverageViolation: false,
        details: {
          minWR,
          maxWR,
          last10WRs: winRates,
          last10PFs: profitFactors
        }
      };
    } catch (error) {
      console.error('[Session Consistency] Error getting consistency status:', error);
      return null;
    }
  }

  /**
   * Get last N sessions for display
   */
  async getRecentSessions(userId: string, limit: number = 10): Promise<Array<{
    sessionId: string;
    sessionDate: string;
    winRate: number;
    profitFactor: number;
    backtestType: string;
  }>> {
    try {
      const { data: wrSessions } = await supabase
        .from('ai_session_wr_tracking')
        .select('session_id, session_date, win_rate, backtest_type')
        .eq('user_id', userId)
        .order('session_date', { ascending: false })
        .limit(limit);

      const { data: pfSessions } = await supabase
        .from('ai_session_pf_tracking')
        .select('session_id, profit_factor')
        .eq('user_id', userId)
        .order('session_date', { ascending: false })
        .limit(limit);

      if (!wrSessions || !pfSessions) return [];

      // Match sessions by ID
      return wrSessions.map(wr => {
        const pf = pfSessions.find(p => p.session_id === wr.session_id);
        return {
          sessionId: wr.session_id,
          sessionDate: wr.session_date,
          winRate: parseFloat(wr.win_rate.toString()),
          profitFactor: pf ? parseFloat(pf.profit_factor.toString()) : 0,
          backtestType: wr.backtest_type
        };
      });
    } catch (error) {
      console.error('[Session Consistency] Error getting recent sessions:', error);
      return [];
    }
  }

  /**
   * Helper to create failed validation result
   */
  private getFailedValidation(reason: string): ConsistencyValidationResult {
    return {
      passed: false,
      wrSpread: 0,
      pfAverage: 0,
      sessionCount: 0,
      wrSpreadViolation: false,
      pfAverageViolation: false,
      failureReason: reason,
      details: {
        minWR: 0,
        maxWR: 0,
        last10WRs: [],
        last10PFs: []
      }
    };
  }

  /**
   * Clear old session data (keep only last 100 sessions per user)
   */
  async cleanupOldSessions(userId: string): Promise<void> {
    try {
      // Get 100th oldest session date
      const { data: wrSessions } = await supabase
        .from('ai_session_wr_tracking')
        .select('session_date')
        .eq('user_id', userId)
        .order('session_date', { ascending: false })
        .limit(1)
        .range(99, 99);

      if (wrSessions && wrSessions.length > 0) {
        const cutoffDate = wrSessions[0].session_date;

        // Delete WR sessions older than cutoff
        await supabase
          .from('ai_session_wr_tracking')
          .delete()
          .eq('user_id', userId)
          .lt('session_date', cutoffDate);

        // Delete PF sessions older than cutoff
        await supabase
          .from('ai_session_pf_tracking')
          .delete()
          .eq('user_id', userId)
          .lt('session_date', cutoffDate);

        console.log('[Session Consistency] ✅ Cleaned up old sessions');
      }
    } catch (error) {
      console.error('[Session Consistency] Error cleaning up old sessions:', error);
    }
  }
}

export const aiSessionConsistencyTracker = new AISessionConsistencyTracker();
export type { SessionMetrics, ConsistencyValidationResult };
