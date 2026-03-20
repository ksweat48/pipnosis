/**
 * Mid-Trade Monitor Service
 *
 * SSOT for mid-trade guidance data and recommendations.
 * Uses the deterministic mid-trade-plan-engine for all trigger evaluation.
 * Zero LLM calls — all 13 triggers are evaluated purely from stored plan + live price.
 *
 * GOVERNANCE: Read-only service - does NOT execute trades
 * CCIP: All guidance derives from mid_trade_plan snapshot stored at trade entry
 * SSOT: mid_trade_plan in goal_session_trades is the single authority for trade context
 */

import { supabase } from '@/lib/supabase';
import { calculatePnL } from '@/types/position';
import type { GoalSessionTrade } from '@/types/position';
import { calculatePipDistance } from '@/utils/currencyHelpers';
import {
  evaluateAllTriggers,
  type MidTradePlan,
  type TriggerEvaluation,
  type TrailingSLOptions
} from './mid-trade-plan-engine';

export interface MidTradeGuidance {
  tradeId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  takeProfit1?: number | null;
  takeProfit2?: number | null;
  currentPnL: number;
  timeInTrade: number;

  // Risk metrics
  distanceToSL: number;
  distanceToTP: number;
  drawdownPercent: number;
  urgencyScore: number;

  // Primary guidance (now explicit with prices)
  primaryAction: 'hold' | 'trail_sl' | 'warning' | 'tp1_timing' | 'risk_alert';
  primaryMessage: string;
  subMessage: string;
  actionColor: 'emerald' | 'amber' | 'red' | 'blue' | 'orange';

  // Explicit price advice
  actionPrice: number | null;
  actionLabel: string | null;
  thesisIntact: boolean;

  // Trailing SL options (populated when action is trail_sl)
  trailingSLOptions?: TrailingSLOptions;

  // Alpha trade plan snapshot (read-only, immutable after entry)
  midTradePlan?: MidTradePlan | null;

  // Price freshness (SSOT compliance)
  priceAgeSeconds?: number;
  isPriceFresh?: boolean;
  stalePriceWarning?: string;

  // Session context
  goalSessionId: string;

  // Alpha mid-trade re-analysis verdict (populated from thesis_status / alpha_recheck_verdict on trade)
  alphaRecheck?: {
    verdict: 'HOLD' | 'CLOSE_NOW' | 'TAKE_PARTIAL' | 'TRAIL_SL';
    thesisStatus: 'INTACT' | 'WEAKENING' | 'INVALIDATED';
    confidence: number;
    userMessage: string;
    alphaReasoning: string;
    triggerType: string;
    checkedAt: string;
    urgency: 'critical' | 'high' | 'medium' | 'low';
  } | null;

  // Alpha pre-trade answer sheet (read-only, parsed from alpha_reasoning_snapshot)
  answerSheet?: {
    Q1_trend_alignment: string;
    Q2_structure_level: string;
    Q3_prior_rejections: string;
    Q4_momentum_stage: string;
    Q5_failure_mode: string;
    Q5_failure_probability: number;
    Q5B_objective_alignment: string;
    Q6_entry_trigger: string;
    /** @deprecated Retained for backward-compat with pre-CCIP-2026-0316A stored records */
    Q7_confluence_count?: string;
    /** X/7 — each confirmed dimension with the specific data point that confirms it */
    Q7_confluence_confirmed?: string;
    /** Alpha's self-determined threshold, confirmed count, and PROCEED/NO_TRADE decision */
    Q7_confluence_judgment?: string;
    Q8_move_position_pct: number;
    Q8B_session_range_pct: number;
  } | null;

  /**
   * SSOT: R-multiple fields computed once in service layer from engine output.
   * NEVER re-derived in UI — always read from these fields.
   *
   * rMultiple:  current live R-multiple (negative = drawdown, positive = profit)
   * initialRR:  planned risk-reward ratio at entry  |TP - entry| / |SL - entry|
   * liveRR:     real-time remaining reward-to-risk   |TP - currentPrice| / |SL - currentPrice|
   */
  rMultiple: number;
  initialRR: number;
  liveRR: number;

  // Internal field retained for in-memory P&L recalculation by applyLivePrices
  // GOVERNANCE: Not rendered in UI — used exclusively by applyLivePrices
  lotSize: number;

  // CCIP-2026-0320D: TP1 milestone state — drives loud alert banner in MidTradeMonitor
  // tp1Hit: true when the first take profit was reached and SL was auto-moved to breakeven
  // tp1BreakevenSL: the exact SL price set after TP1 hit (null when TP1 not yet reached)
  tp1Hit: boolean;
  tp1BreakevenSL: number | null;
}

export interface MidTradeMonitorStats {
  totalOpenTrades: number;
  tradesByUrgency: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  totalUnrealizedPnL: number;
}

class MidTradeMonitorService {
  private lastRequestTime = 0;
  private requestInProgress = false;
  private lastSuccessfulUserId: string | null = null;

  // Per-trade fired-trigger sets: persists across calls to prevent re-firing
  private firedTriggersPerTrade = new Map<string, Set<string>>();

  /**
   * Get all mid-trade guidance for user's active trades
   * Sorted by urgency (most urgent first)
   *
   * CCIP COMPLIANCE:
   * - Throttling is transparent (logged)
   * - First request bypasses throttling (ensures initial discovery)
   * - Prevents concurrent requests (re-entrancy protection)
   */
  async getMidTradeGuidance(userId: string): Promise<{
    guidance: MidTradeGuidance[];
    stats: MidTradeMonitorStats;
  }> {
    const emptyResponse = {
      guidance: [],
      stats: {
        totalOpenTrades: 0,
        tradesByUrgency: { critical: 0, high: 0, medium: 0, low: 0 },
        totalUnrealizedPnL: 0
      }
    };

    if (this.requestInProgress) {
      return emptyResponse;
    }

    const now = Date.now();
    const isFirstRequest = this.lastSuccessfulUserId !== userId;
    const timeSinceLastRequest = now - this.lastRequestTime;
    const isThrottled = timeSinceLastRequest < 500;

    if (isThrottled && !isFirstRequest) {
      return emptyResponse;
    }

    this.lastRequestTime = now;
    this.requestInProgress = true;

    try {
      const { data: trades, error: tradesError } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'open')
        .order('opened_at', { ascending: false });

      if (tradesError) throw tradesError;
      if (!trades || trades.length === 0) {
        this.cleanupFiredTriggers(new Set());
        return {
          guidance: [],
          stats: {
            totalOpenTrades: 0,
            tradesByUrgency: { critical: 0, high: 0, medium: 0, low: 0 },
            totalUnrealizedPnL: 0
          }
        };
      }

      // Cleanup fired trigger sets for closed trades
      const openTradeIds = new Set(trades.map(t => t.id));
      this.cleanupFiredTriggers(openTradeIds);

      const symbols = Array.from(new Set(trades.map(t => t.symbol)));
      const [pricesResult, stalenessResult] = await Promise.all([
        supabase
          .from('realtime_prices')
          .select('symbol, bid, ask, created_at')
          .in('symbol', symbols)
          .order('created_at', { ascending: false }),
        supabase
          .from('polling_price_staleness')
          .select('symbol, staleness_minutes, is_critical')
          .in('symbol', symbols)
      ]);

      const { data: prices, error: pricesError } = pricesResult;
      if (pricesError) {
        console.error('[MidTradeMonitor] Error fetching prices:', pricesError);
      }

      const priceMap = new Map<string, { bid: number; ask: number; age: number; ageSeconds: number }>();
      if (prices) {
        for (const price of prices) {
          if (!priceMap.has(price.symbol)) {
            const ageMs = Date.now() - new Date(price.created_at).getTime();
            const ageSeconds = Math.floor(ageMs / 1000);
            const ageMinutes = ageSeconds / 60;
            priceMap.set(price.symbol, {
              bid: parseFloat(price.bid),
              ask: parseFloat(price.ask),
              age: ageMinutes,
              ageSeconds
            });
          }
        }
      }

      const stalenessMap = new Map<string, { staleness_minutes: number; is_critical: boolean }>();
      if (stalenessResult.data) {
        stalenessResult.data.forEach(item => {
          stalenessMap.set(item.symbol, {
            staleness_minutes: item.staleness_minutes,
            is_critical: item.is_critical
          });
        });
      }

      const guidanceList: MidTradeGuidance[] = [];
      let totalPnL = 0;

      for (const trade of trades) {
        const priceData = priceMap.get(trade.symbol);

        const currentPrice = priceData
          ? (trade.direction === 'buy' ? priceData.bid : priceData.ask)
          : (trade.current_price || trade.entry_price);

        const lotSize = trade.lot_size || trade.position_size;
        const pnl = calculatePnL(
          trade.direction,
          trade.entry_price,
          currentPrice,
          lotSize,
          trade.symbol
        );

        totalPnL += pnl;

        const risk = Math.abs(trade.entry_price - trade.stop_loss);
        const isLong = trade.direction === 'buy';
        const priceDiff = isLong
          ? (currentPrice - trade.entry_price)
          : (trade.entry_price - currentPrice);
        const drawdownPercent = Math.max(0, (-priceDiff / risk) * 100);

        const timeInTrade = trade.opened_at
          ? (Date.now() - new Date(trade.opened_at).getTime()) / 1000 / 60
          : 0;

        // Get or create fired-trigger set for this trade
        if (!this.firedTriggersPerTrade.has(trade.id)) {
          this.firedTriggersPerTrade.set(trade.id, new Set<string>());
        }
        const firedTriggers = this.firedTriggersPerTrade.get(trade.id)!;

        // Parse mid_trade_plan from DB (jsonb stored as object or null)
        const midTradePlan: MidTradePlan | null = trade.mid_trade_plan
          ? (typeof trade.mid_trade_plan === 'string'
            ? JSON.parse(trade.mid_trade_plan)
            : trade.mid_trade_plan)
          : null;

        // Parse answer_sheet from alpha_reasoning_snapshot (composite JSON or plain string)
        let answerSheet: MidTradeGuidance['answerSheet'] = null;
        if (trade.alpha_reasoning_snapshot) {
          try {
            const raw = typeof trade.alpha_reasoning_snapshot === 'string'
              ? JSON.parse(trade.alpha_reasoning_snapshot)
              : trade.alpha_reasoning_snapshot;
            if (raw && typeof raw === 'object' && raw.answer_sheet) {
              answerSheet = raw.answer_sheet;
            }
          } catch {
            // Non-JSON (legacy plain string) — no answer_sheet available
          }
        }

        // Parse alpha_recheck_verdict from trade (set by server-side wellness monitor)
        let alphaRecheck: MidTradeGuidance['alphaRecheck'] = null;
        if (trade.alpha_recheck_verdict && trade.thesis_status && trade.last_alpha_recheck_at) {
          try {
            const raw = typeof trade.alpha_recheck_verdict === 'string'
              ? JSON.parse(trade.alpha_recheck_verdict)
              : trade.alpha_recheck_verdict;
            if (raw && raw.verdict) {
              const urgencyMap: Record<string, 'critical' | 'high' | 'medium' | 'low'> = {
                CLOSE_NOW: 'critical',
                TAKE_PARTIAL: 'high',
                TRAIL_SL: 'medium',
                HOLD: 'low',
              };
              alphaRecheck = {
                verdict: raw.verdict,
                thesisStatus: trade.thesis_status as 'INTACT' | 'WEAKENING' | 'INVALIDATED',
                confidence: raw.confidence ?? 70,
                userMessage: raw.user_message || raw.userMessage || '',
                alphaReasoning: raw.alpha_reasoning || raw.alphaReasoning || '',
                triggerType: raw.trigger_type || raw.triggerType || '',
                checkedAt: trade.last_alpha_recheck_at,
                urgency: urgencyMap[raw.verdict] ?? 'low',
              };
            }
          } catch {
            // Non-parseable — skip
          }
        }

        // SSOT: Deterministic trigger evaluation — zero LLM calls
        const evaluation: TriggerEvaluation = evaluateAllTriggers(
          trade as GoalSessionTrade,
          currentPrice,
          midTradePlan,
          timeInTrade,
          firedTriggers
        );

        // Record triggered type to prevent re-firing in subsequent calls
        if (evaluation.triggered && evaluation.triggerType) {
          firedTriggers.add(evaluation.triggerType);
        }

        const staleness = stalenessMap.get(trade.symbol);
        const priceAgeSeconds = priceData?.ageSeconds || 0;
        const isFresh = !staleness?.is_critical && priceAgeSeconds < 300;
        let stalePriceWarning: string | undefined;

        if (staleness?.is_critical) {
          stalePriceWarning = `WARNING: Price data is ${Math.round(staleness.staleness_minutes)} minutes stale`;
        } else if (priceAgeSeconds > 120) {
          stalePriceWarning = `CAUTION: Price data is ${Math.round(priceAgeSeconds / 60)} minutes old`;
        }

        const distanceToSLPips = calculatePipDistance(trade.symbol, currentPrice, trade.stop_loss);
        const distanceToTPPips = calculatePipDistance(trade.symbol, currentPrice, trade.take_profit);

        // ─── RR calculations — computed once here, never re-derived in UI ──────
        // initialRR: planned reward-to-risk at entry (immutable after entry)
        const initialRisk = Math.abs(trade.entry_price - trade.stop_loss);
        const initialReward = Math.abs(trade.take_profit - trade.entry_price);
        const initialRR = initialRisk > 0 ? initialReward / initialRisk : 0;

        // liveRR: remaining reward vs remaining risk from current price
        const remainingReward = Math.abs(trade.take_profit - currentPrice);
        const remainingRisk = Math.abs(currentPrice - trade.stop_loss);
        const liveRR = remainingRisk > 0 ? remainingReward / remainingRisk : 0;

        guidanceList.push({
          tradeId: trade.id,
          symbol: trade.symbol,
          direction: trade.direction,
          entryPrice: trade.entry_price,
          currentPrice,
          stopLoss: trade.stop_loss,
          takeProfit: trade.take_profit,
          takeProfit1: trade.take_profit_1,
          takeProfit2: trade.take_profit_2,
          currentPnL: pnl,
          timeInTrade,
          distanceToSL: distanceToSLPips,
          distanceToTP: distanceToTPPips,
          drawdownPercent,
          urgencyScore: evaluation.urgencyScore,
          primaryAction: evaluation.action,
          primaryMessage: evaluation.primaryMessage,
          subMessage: evaluation.subMessage,
          actionColor: evaluation.color,
          actionPrice: evaluation.actionPrice,
          actionLabel: evaluation.actionLabel,
          thesisIntact: evaluation.thesisIntact,
          trailingSLOptions: evaluation.trailingSLOptions,
          midTradePlan,
          answerSheet,
          alphaRecheck,
          priceAgeSeconds,
          isPriceFresh: isFresh,
          stalePriceWarning,
          goalSessionId: trade.goal_session_id,
          rMultiple: evaluation.rMultiple,
          initialRR,
          liveRR,
          lotSize,
          tp1Hit: trade.tp1_hit === true,
          tp1BreakevenSL: trade.tp1_breakeven_price ?? null
        });
      }

      guidanceList.sort((a, b) => b.urgencyScore - a.urgencyScore);

      const stats: MidTradeMonitorStats = {
        totalOpenTrades: guidanceList.length,
        tradesByUrgency: {
          critical: guidanceList.filter(g => g.urgencyScore >= 80).length,
          high: guidanceList.filter(g => g.urgencyScore >= 60 && g.urgencyScore < 80).length,
          medium: guidanceList.filter(g => g.urgencyScore >= 40 && g.urgencyScore < 60).length,
          low: guidanceList.filter(g => g.urgencyScore < 40).length
        },
        totalUnrealizedPnL: totalPnL
      };

      this.lastSuccessfulUserId = userId;

      return { guidance: guidanceList, stats };
    } catch (error) {
      const isAbortError = error instanceof Error && (
        error.name === 'AbortError' ||
        error.message?.includes('signal is aborted') ||
        error.message?.includes('AbortError')
      );

      if (isAbortError) {
        return {
          guidance: [],
          stats: {
            totalOpenTrades: 0,
            tradesByUrgency: { critical: 0, high: 0, medium: 0, low: 0 },
            totalUnrealizedPnL: 0
          }
        };
      }

      console.error('[MidTradeMonitor] Error getting guidance:', error);
      return {
        guidance: [],
        stats: {
          totalOpenTrades: 0,
          tradesByUrgency: { critical: 0, high: 0, medium: 0, low: 0 },
          totalUnrealizedPnL: 0
        }
      };
    } finally {
      this.requestInProgress = false;
    }
  }

  /**
   * Apply live price updates to existing guidance entries in-memory.
   * Also re-evaluates triggers against the latest price for real-time responsiveness.
   *
   * SSOT COMPLIANCE:
   * - Does NOT query the database
   * - P&L recalculated using calculatePnL SSOT function
   * - Trigger messages updated from deterministic engine (no LLM)
   *
   * GOVERNANCE:
   * - ONLY path for live price injection into guidance state
   * - Components MUST use this method
   */
  applyLivePrices(
    currentGuidance: MidTradeGuidance[],
    livePrices: Array<{ symbol: string; bid: number; ask: number }>
  ): MidTradeGuidance[] {
    if (currentGuidance.length === 0 || livePrices.length === 0) return currentGuidance;

    const priceMap = new Map<string, { bid: number; ask: number }>();
    for (const p of livePrices) {
      priceMap.set(p.symbol, { bid: p.bid, ask: p.ask });
    }

    let changed = false;
    const updated = currentGuidance.map((guide) => {
      const live = priceMap.get(guide.symbol);
      if (!live) return guide;

      const newCurrentPrice = guide.direction === 'buy' ? live.bid : live.ask;

      if (newCurrentPrice === guide.currentPrice) return guide;

      changed = true;

      const newPnL = calculatePnL(
        guide.direction,
        guide.entryPrice,
        newCurrentPrice,
        guide.lotSize,
        guide.symbol
      );

      // Re-evaluate triggers with the new price (deterministic, zero cost)
      const firedTriggers = this.firedTriggersPerTrade.get(guide.tradeId) ?? new Set<string>();
      const timeInTrade = guide.timeInTrade + (1 / 30); // ~2s elapsed per 2s polling cycle

      const pseudoTrade = {
        id: guide.tradeId,
        direction: guide.direction,
        entry_price: guide.entryPrice,
        stop_loss: guide.stopLoss,
        take_profit: guide.takeProfit,
        symbol: guide.symbol,
        lot_size: guide.lotSize,
        position_size: guide.lotSize,
        opened_at: null,
        take_profit_1: guide.takeProfit1 ?? null,
        take_profit_2: guide.takeProfit2 ?? null,
        mid_trade_plan: guide.midTradePlan
      } as unknown as import('@/types/position').GoalSessionTrade;

      const evaluation = evaluateAllTriggers(
        pseudoTrade,
        newCurrentPrice,
        guide.midTradePlan ?? null,
        timeInTrade,
        firedTriggers
      );

      // Record newly fired triggers
      if (evaluation.triggered && evaluation.triggerType) {
        firedTriggers.add(evaluation.triggerType);
        if (!this.firedTriggersPerTrade.has(guide.tradeId)) {
          this.firedTriggersPerTrade.set(guide.tradeId, firedTriggers);
        }
      }

      // liveRR updates with every tick — remaining reward / remaining risk
      const updatedRemainingReward = Math.abs(guide.takeProfit - newCurrentPrice);
      const updatedRemainingRisk = Math.abs(newCurrentPrice - guide.stopLoss);
      const updatedLiveRR = updatedRemainingRisk > 0 ? updatedRemainingReward / updatedRemainingRisk : 0;

      return {
        ...guide,
        currentPrice: newCurrentPrice,
        currentPnL: newPnL,
        priceAgeSeconds: 0,
        isPriceFresh: true,
        stalePriceWarning: undefined,
        primaryAction: evaluation.action,
        primaryMessage: evaluation.primaryMessage,
        subMessage: evaluation.subMessage,
        actionColor: evaluation.color,
        actionPrice: evaluation.actionPrice,
        actionLabel: evaluation.actionLabel,
        thesisIntact: evaluation.thesisIntact,
        urgencyScore: evaluation.urgencyScore,
        trailingSLOptions: evaluation.trailingSLOptions,
        rMultiple: evaluation.rMultiple,
        liveRR: updatedLiveRR
      };
    });

    return changed ? updated : currentGuidance;
  }

  /**
   * Remove fired trigger sets for trades that are no longer open
   */
  private cleanupFiredTriggers(openTradeIds: Set<string>): void {
    for (const tradeId of this.firedTriggersPerTrade.keys()) {
      if (!openTradeIds.has(tradeId)) {
        this.firedTriggersPerTrade.delete(tradeId);
      }
    }
  }
}

export const midTradeMonitorService = new MidTradeMonitorService();
