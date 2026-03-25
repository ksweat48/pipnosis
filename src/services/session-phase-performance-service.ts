/**
 * SESSION-PHASE-STYLE PERFORMANCE SERVICE
 *
 * SSOT AUTHORITY: This service is the single authority for reading and writing
 * session × phase × style and session × phase × setup_type performance data.
 *
 * WRITE PATH: recordTradeOutcome() — called exclusively by TradeClosureCoordinator
 *   after a confirmed successful trade closure. No other code writes to the
 *   performance tables. Both upserts go through SECURITY DEFINER RPCs.
 *
 * READ PATH: getSessionPhasePerformance() and getSetupTypePerformance() —
 *   called by AlphaIntelligenceAggregator to populate the intelligence snapshot
 *   that Alpha reads every scan.
 *
 * CCIP COMPLIANCE: All DB writes use RPCs, not direct DML. Non-blocking on error.
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface SessionPhasePerformanceRow {
  session_name: string;
  market_phase: string;
  trade_style: string;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_confidence: number;
  avg_pnl: number;
}

export interface SetupTypeContextPerformanceRow {
  session_name: string;
  market_phase: string;
  setup_type: string;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_pnl: number;
}

export interface TradeOutcomeForPerformance {
  userId: string;
  sessionName: string;
  marketPhase: string;
  tradeStyle: string;
  setupType: string | null;
  isWin: boolean;
  pnl: number;
  confidence: number;
}

export class SessionPhasePerformanceService {
  /**
   * Called by TradeClosureCoordinator after a successful closure.
   * Extracts session/phase context from the closed trade record and
   * upserts both performance tables via SECURITY DEFINER RPCs.
   * Non-blocking: errors are logged but do not interrupt the closure flow.
   */
  async recordTradeOutcome(params: TradeOutcomeForPerformance): Promise<void> {
    const { userId, sessionName, marketPhase, tradeStyle, setupType, isWin, pnl, confidence } = params;

    const calls: Promise<unknown>[] = [
      supabase.rpc('upsert_session_phase_performance', {
        p_user_id:      userId,
        p_session_name: sessionName,
        p_market_phase: marketPhase,
        p_trade_style:  tradeStyle,
        p_is_win:       isWin,
        p_pnl:          pnl,
        p_confidence:   confidence,
      }),
    ];

    if (setupType) {
      calls.push(
        supabase.rpc('upsert_setup_type_context_performance', {
          p_user_id:      userId,
          p_session_name: sessionName,
          p_market_phase: marketPhase,
          p_setup_type:   setupType,
          p_is_win:       isWin,
          p_pnl:          pnl,
        })
      );
    }

    try {
      const results = await Promise.allSettled(calls);
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          logger.warn(`[SessionPhasePerf] RPC ${i === 0 ? 'upsert_session_phase_performance' : 'upsert_setup_type_context_performance'} failed (non-blocking):`, r.reason);
        }
      });
    } catch (err) {
      logger.warn('[SessionPhasePerf] recordTradeOutcome failed (non-blocking):', err);
    }
  }

  /**
   * Reads all session-phase-style rows for a user.
   * Minimum 3 trades per bucket required to be returned (low-n buckets are noise).
   */
  async getSessionPhasePerformance(userId: string): Promise<SessionPhasePerformanceRow[]> {
    try {
      const { data, error } = await supabase
        .from('alpha_session_phase_performance')
        .select('session_name, market_phase, trade_style, total_trades, wins, losses, win_rate, avg_confidence, avg_pnl')
        .eq('user_id', userId)
        .gte('total_trades', 3)
        .order('total_trades', { ascending: false });

      if (error || !data) return [];
      return data as SessionPhasePerformanceRow[];
    } catch (err) {
      logger.warn('[SessionPhasePerf] getSessionPhasePerformance failed (non-blocking):', err);
      return [];
    }
  }

  /**
   * Reads all setup-type-context rows for a user.
   * Minimum 3 trades per bucket required.
   */
  async getSetupTypePerformance(userId: string): Promise<SetupTypeContextPerformanceRow[]> {
    try {
      const { data, error } = await supabase
        .from('alpha_setup_type_context_performance')
        .select('session_name, market_phase, setup_type, total_trades, wins, losses, win_rate, avg_pnl')
        .eq('user_id', userId)
        .gte('total_trades', 3)
        .order('total_trades', { ascending: false });

      if (error || !data) return [];
      return data as SetupTypeContextPerformanceRow[];
    } catch (err) {
      logger.warn('[SessionPhasePerf] getSetupTypePerformance failed (non-blocking):', err);
      return [];
    }
  }

  /**
   * Derive session name from a UTC timestamp.
   * Mirrors the session logic in alpha-identity.ts so the label written at close
   * matches the label Alpha uses when reasoning about sessions.
   */
  static deriveSessionName(timestamp: Date | string): string {
    const d = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const utcHour = d.getUTCHours();

    if (utcHour >= 23 || utcHour < 8)  return 'asian';
    if (utcHour >= 8  && utcHour < 13) return 'london';
    if (utcHour >= 12 && utcHour < 17) return 'overlap';
    if (utcHour >= 17 && utcHour < 23) return 'new_york';
    return 'unknown';
  }

  /**
   * Extract market phase from the regime_snapshot jsonb stored on the trade.
   * Falls back to 'unknown' for any missing/invalid data.
   */
  static extractMarketPhase(regimeSnapshot: Record<string, unknown> | null | undefined): string {
    if (!regimeSnapshot) return 'unknown';
    const phase = (regimeSnapshot['market_phase'] || regimeSnapshot['phase'] || regimeSnapshot['q12_phase'] || '') as string;
    const normalised = phase.toLowerCase().trim();
    const valid = ['accumulation', 'expansion', 'distribution', 'retracement', 'reversal'];
    return valid.includes(normalised) ? normalised : 'unknown';
  }
}

export const sessionPhasePerformanceService = new SessionPhasePerformanceService();
