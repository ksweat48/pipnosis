/**
 * Recent Trade Context Service
 *
 * SSOT Authority: Single source of truth for "what just happened on this symbol"
 * within the current session.
 *
 * CCIP 2026-03-02: Introduced as part of re-entry bias check system.
 * Before this service, the executor had zero memory of prior trade outcomes within
 * a session.  Repeated same-direction re-entries after stop-losses on the same
 * symbol with no regime change were creating compounding losses.
 *
 * Responsibilities:
 * - Query the last closed trade on a symbol/direction combination within a session
 * - Return a structured result that the executor can use to assess re-entry safety
 * - Classify the prior close reason into 3 buckets: stop_loss, take_profit, manual
 *
 * Does NOT:
 * - Make trading decisions (callers decide whether to allow/block)
 * - Call external APIs
 * - Modify any state
 *
 * GOVERNANCE: This service is READ-ONLY.  It never writes to the database.
 */

import { supabase } from '../lib/supabase';

export interface RecentTradeContextResult {
  found: boolean;
  tradeId?: string;
  symbol?: string;
  direction?: 'buy' | 'sell';
  closedAt?: Date;
  closeReason?: 'stop_loss' | 'take_profit' | 'manual';
  tp1WasHit?: boolean;
  tp2WasHit?: boolean;
  minutesAgo?: number;
  regimeSnapshot?: any;
  entryPrice?: number;
  exitPrice?: number;
}

class RecentTradeContext {
  /**
   * Return the most recent CLOSED trade for a given symbol + direction within the session.
   * Only looks back `lookbackMinutes` minutes to avoid stale signal interference.
   *
   * @param symbol         Instrument (e.g. 'USDJPY')
   * @param direction      Trade direction ('buy' | 'sell')
   * @param sessionId      Goal session UUID — scopes the query to current session only
   * @param lookbackMinutes How far back to look (default 30 minutes)
   */
  async getRecentClose(
    symbol: string,
    direction: 'buy' | 'sell',
    sessionId: string,
    lookbackMinutes = 30
  ): Promise<RecentTradeContextResult> {
    try {
      const cutoff = new Date(Date.now() - lookbackMinutes * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('goal_session_trades')
        .select(
          'id, symbol, direction, close_reason, tp1_hit, tp2_hit, closed_at, ' +
          'regime_snapshot, entry_price, exit_price'
        )
        .eq('goal_session_id', sessionId)
        .eq('symbol', symbol)
        .eq('direction', direction)
        .eq('status', 'closed')
        .gte('closed_at', cutoff)
        .order('closed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return { found: false };
      }

      const closedAt = new Date(data.closed_at);
      const minutesAgo = Math.round((Date.now() - closedAt.getTime()) / 60000);

      const rawReason: string = data.close_reason ?? '';
      let closeReason: 'stop_loss' | 'take_profit' | 'manual';
      if (rawReason === 'stop_loss') {
        closeReason = 'stop_loss';
      } else if (
        rawReason === 'take_profit' ||
        rawReason === 'take_profit_1' ||
        rawReason === 'take_profit_2'
      ) {
        closeReason = 'take_profit';
      } else {
        closeReason = 'manual';
      }

      return {
        found: true,
        tradeId: data.id,
        symbol: data.symbol,
        direction: data.direction,
        closedAt,
        closeReason,
        tp1WasHit: data.tp1_hit ?? false,
        tp2WasHit: data.tp2_hit ?? false,
        minutesAgo,
        regimeSnapshot: data.regime_snapshot ?? null,
        entryPrice: data.entry_price,
        exitPrice: data.exit_price,
      };
    } catch {
      return { found: false };
    }
  }

  /**
   * Compare two regime snapshots to determine whether the market regime has
   * structurally changed between the prior trade and now.
   *
   * "Changed" means at least one of the three pillars differs:
   *   - session_phase  (e.g. LONDON → NEW_YORK)
   *   - volatility_tier (e.g. LOW → HIGH)
   *   - htf_trend_direction (e.g. BULLISH → BEARISH)
   *
   * This is intentionally permissive: if ANY pillar differs the regime is
   * considered changed and re-entry is allowed.  The point is to block re-entry
   * only when the market is structurally identical to the environment that
   * produced the prior stop-loss.
   *
   * SSOT: regime snapshot fields are set by regime-oracle.ts at trade execution time.
   */
  hasRegimeChanged(priorSnapshot: any, currentSnapshot: any): boolean {
    if (!priorSnapshot || !currentSnapshot) return true;

    const priorPhase     = priorSnapshot?.session_phase ?? null;
    const currentPhase   = currentSnapshot?.session_phase ?? null;
    const priorVolatility   = priorSnapshot?.volatility_tier ?? null;
    const currentVolatility = currentSnapshot?.volatility_tier ?? null;
    const priorHTF    = priorSnapshot?.htf_trend_direction ?? null;
    const currentHTF  = currentSnapshot?.htf_trend_direction ?? null;

    return (
      priorPhase !== currentPhase ||
      priorVolatility !== currentVolatility ||
      priorHTF !== currentHTF
    );
  }
}

export const recentTradeContext = new RecentTradeContext();
