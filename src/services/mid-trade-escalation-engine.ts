/**
 * Mid-Trade Escalation Engine
 *
 * SSOT orchestrator that bridges deterministic trigger detection (mid-trade-plan-engine)
 * and Alpha re-analysis (alpha-midtrade-analyst). This is the missing link that was
 * causing zero Alpha mid-trade interventions despite full trigger + analyst infrastructure.
 *
 * CCIP Governance: CCIP-2026-0322A — Alpha Escalation Pipeline
 *
 * Responsibilities:
 * 1. Evaluate all deterministic triggers against open trades
 * 2. Determine if a trigger warrants Alpha re-analysis
 * 3. Call runAlphaMidTradeReanalysis() when escalation is warranted
 * 4. Persist verdict to goal_session_trades via persist_alpha_recheck_verdict RPC
 * 5. Record fired triggers in mid_trade_trigger_blocks (persisted, not in-memory)
 *
 * Design Principles:
 * - Alpha is called on MEANINGFUL triggers only (not every percentage threshold)
 * - Rate-limited per trade: max 1 Alpha call per 15 minutes (except emergencies)
 * - Emergency triggers (near_sl + severe drawdown) bypass rate limit
 * - All verdicts are persisted to DB immediately (SSOT compliance)
 * - In-memory fired-trigger Set is seeded from DB on first load (survives refresh)
 *
 * GOVERNANCE:
 * - Does NOT execute trades (read + advise only)
 * - Does NOT modify mid_trade_plan (immutable after entry)
 * - Only writes: alpha_recheck_verdict, thesis_status, last_alpha_recheck_at
 * - All writes go through persist_alpha_recheck_verdict RPC (SECURITY DEFINER)
 */

import { supabase } from '@/lib/supabase';
import { logger, LogCategory } from '@/lib/logger';
import {
  runAlphaMidTradeReanalysis,
  shouldEscalateToAlpha,
  isRateLimited,
  type AlphaRecheckInput,
  type AlphaRecheckResult,
} from '@/brains/alpha-midtrade-analyst';
import {
  evaluateAllTriggers,
  type MidTradePlan,
  type TriggerEvaluation,
} from './mid-trade-plan-engine';
import { calculatePnL } from '@/types/position';

interface OpenTrade {
  id: string;
  user_id: string;
  goal_session_id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  current_price: number;
  stop_loss: number;
  take_profit: number;
  take_profit_1: number | null;
  lot_size: number;
  opened_at: string | null;
  mid_trade_plan: MidTradePlan | null;
  alpha_reasoning_snapshot: any;
  alpha_recheck_verdict: any;
  thesis_status: string | null;
  last_alpha_recheck_at: string | null;
  alpha_recheck_count: number;
  tp1_hit: boolean;
  tp1_breakeven_price: number | null;
}

interface EscalationResult {
  tradeId: string;
  symbol: string;
  triggerType: string | null;
  escalated: boolean;
  verdict: AlphaRecheckResult | null;
  reason: string;
}

class MidTradeEscalationEngine {
  private isRunning = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  private firedTriggersCache = new Map<string, Set<string>>();

  private CHECK_INTERVAL_MS = 30_000;

  start(): void {
    if (this.intervalId) return;
    logger.info(LogCategory.TRADE_EXECUTION, '[EscalationEngine] Starting');
    this.runCycle();
    this.intervalId = setInterval(() => this.runCycle(), this.CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info(LogCategory.TRADE_EXECUTION, '[EscalationEngine] Stopped');
  }

  private async runCycle(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const trades = await this.fetchOpenTrades();
      if (trades.length === 0) return;

      const prices = await this.fetchPrices(trades.map(t => t.symbol));

      for (const trade of trades) {
        await this.processTrade(trade, prices);
      }
    } catch (err) {
      logger.error(LogCategory.TRADE_EXECUTION, '[EscalationEngine] Cycle error:', err);
    } finally {
      this.isRunning = false;
    }
  }

  private async fetchOpenTrades(): Promise<OpenTrade[]> {
    const { data, error } = await supabase.rpc('get_open_trades_needing_escalation');
    if (error) {
      logger.error(LogCategory.TRADE_EXECUTION, '[EscalationEngine] Failed to fetch trades:', error);
      return [];
    }
    return (data || []) as OpenTrade[];
  }

  private async fetchPrices(symbols: string[]): Promise<Map<string, { bid: number; ask: number }>> {
    const uniqueSymbols = [...new Set(symbols)];
    const { data } = await supabase
      .from('realtime_prices')
      .select('symbol, bid, ask')
      .in('symbol', uniqueSymbols)
      .order('created_at', { ascending: false });

    const map = new Map<string, { bid: number; ask: number }>();
    if (data) {
      for (const row of data) {
        if (!map.has(row.symbol)) {
          map.set(row.symbol, { bid: parseFloat(row.bid), ask: parseFloat(row.ask) });
        }
      }
    }
    return map;
  }

  private async processTrade(
    trade: OpenTrade,
    prices: Map<string, { bid: number; ask: number }>
  ): Promise<EscalationResult> {
    const priceData = prices.get(trade.symbol);
    const currentPrice = priceData
      ? (trade.direction === 'buy' ? priceData.bid : priceData.ask)
      : trade.current_price;

    if (!currentPrice || currentPrice <= 0) {
      return { tradeId: trade.id, symbol: trade.symbol, triggerType: null, escalated: false, verdict: null, reason: 'No live price' };
    }

    const minutesInTrade = trade.opened_at
      ? (Date.now() - new Date(trade.opened_at).getTime()) / 1000 / 60
      : 0;

    const risk = Math.abs(trade.entry_price - trade.stop_loss);
    const isLong = trade.direction === 'buy';
    const priceDiff = isLong
      ? (currentPrice - trade.entry_price)
      : (trade.entry_price - currentPrice);
    const drawdownPercent = Math.max(0, (-priceDiff / risk) * 100);
    const rMultiple = risk > 0 ? priceDiff / risk : 0;

    if (!this.firedTriggersCache.has(trade.id)) {
      const persisted = await this.loadPersistedTriggers(trade.id);
      this.firedTriggersCache.set(trade.id, persisted);
    }
    const firedTriggers = this.firedTriggersCache.get(trade.id)!;

    const midTradePlan: MidTradePlan | null = trade.mid_trade_plan
      ? (typeof trade.mid_trade_plan === 'string'
          ? JSON.parse(trade.mid_trade_plan)
          : trade.mid_trade_plan)
      : null;

    const pseudoTrade = {
      id: trade.id,
      user_id: trade.user_id,
      direction: trade.direction,
      entry_price: trade.entry_price,
      stop_loss: trade.stop_loss,
      take_profit: trade.take_profit,
      take_profit_1: trade.take_profit_1,
      take_profit_2: null,
      symbol: trade.symbol,
      lot_size: trade.lot_size,
      position_size: trade.lot_size,
      opened_at: trade.opened_at,
      mid_trade_plan: midTradePlan,
      status: 'open',
    } as any;

    const evaluation: TriggerEvaluation = evaluateAllTriggers(
      pseudoTrade,
      currentPrice,
      midTradePlan,
      minutesInTrade,
      firedTriggers
    );

    if (!evaluation.triggered || !evaluation.triggerType) {
      return { tradeId: trade.id, symbol: trade.symbol, triggerType: null, escalated: false, verdict: null, reason: 'No trigger fired' };
    }

    const triggerType = evaluation.triggerType;

    if (firedTriggers.has(triggerType)) {
      return { tradeId: trade.id, symbol: trade.symbol, triggerType, escalated: false, verdict: null, reason: 'Trigger already fired' };
    }

    firedTriggers.add(triggerType);
    await this.persistTriggerFired(trade.id, trade.user_id, triggerType);

    if (!shouldEscalateToAlpha(triggerType, drawdownPercent, rMultiple)) {
      return { tradeId: trade.id, symbol: trade.symbol, triggerType, escalated: false, verdict: null, reason: 'Trigger does not warrant Alpha escalation' };
    }

    if (isRateLimited(trade.last_alpha_recheck_at, triggerType)) {
      return { tradeId: trade.id, symbol: trade.symbol, triggerType, escalated: false, verdict: null, reason: 'Rate limited — last recheck < 15 min ago' };
    }

    let answerSheet: AlphaRecheckInput['answerSheet'] = null;
    if (trade.alpha_reasoning_snapshot) {
      try {
        const raw = typeof trade.alpha_reasoning_snapshot === 'string'
          ? JSON.parse(trade.alpha_reasoning_snapshot)
          : trade.alpha_reasoning_snapshot;
        if (raw?.answer_sheet) answerSheet = raw.answer_sheet;
      } catch {
        // non-JSON snapshot — fine
      }
    }

    let originalReasoning = 'No reasoning recorded';
    if (trade.alpha_reasoning_snapshot) {
      try {
        const raw = typeof trade.alpha_reasoning_snapshot === 'string'
          ? JSON.parse(trade.alpha_reasoning_snapshot)
          : trade.alpha_reasoning_snapshot;
        if (raw?.narrative) originalReasoning = raw.narrative;
        else if (typeof raw === 'string') originalReasoning = raw;
      } catch {
        if (typeof trade.alpha_reasoning_snapshot === 'string') {
          originalReasoning = trade.alpha_reasoning_snapshot.slice(0, 500);
        }
      }
    }

    const input: AlphaRecheckInput = {
      tradeId: trade.id,
      userId: trade.user_id,
      sessionId: trade.goal_session_id,
      symbol: trade.symbol,
      direction: trade.direction,
      entryPrice: trade.entry_price,
      currentPrice,
      stopLoss: trade.stop_loss,
      takeProfit: trade.take_profit,
      rMultiple,
      drawdownPercent,
      minutesInTrade,
      midTradePlan,
      originalReasoning,
      answerSheet,
      triggerType,
      triggerReason: evaluation.primaryMessage,
      thesisIntactBefore: trade.thesis_status !== 'WEAKENING' && trade.thesis_status !== 'INVALIDATED',
    };

    logger.info(LogCategory.TRADE_EXECUTION, `[EscalationEngine] Calling Alpha for ${trade.symbol} | trigger=${triggerType} | rMultiple=${rMultiple.toFixed(2)}R`);

    let verdict: AlphaRecheckResult;
    try {
      verdict = await runAlphaMidTradeReanalysis(input);
    } catch (err) {
      logger.error(LogCategory.TRADE_EXECUTION, '[EscalationEngine] Alpha reanalysis failed:', err);
      return { tradeId: trade.id, symbol: trade.symbol, triggerType, escalated: true, verdict: null, reason: 'Alpha call failed' };
    }

    await this.persistVerdict(trade, triggerType, evaluation.primaryMessage, verdict, currentPrice, rMultiple, drawdownPercent, minutesInTrade);

    return { tradeId: trade.id, symbol: trade.symbol, triggerType, escalated: true, verdict, reason: 'Alpha recheck completed' };
  }

  private async persistVerdict(
    trade: OpenTrade,
    triggerType: string,
    triggerReason: string,
    verdict: AlphaRecheckResult,
    currentPrice: number,
    rMultiple: number,
    drawdownPercent: number,
    minutesInTrade: number
  ): Promise<void> {
    try {
      const { data, error } = await supabase.rpc('persist_alpha_recheck_verdict', {
        p_trade_id: trade.id,
        p_user_id: trade.user_id,
        p_goal_session_id: trade.goal_session_id,
        p_trigger_type: triggerType,
        p_trigger_reason: triggerReason,
        p_verdict: verdict.verdict,
        p_thesis_status: verdict.thesisStatus,
        p_confidence: verdict.confidence,
        p_alpha_reasoning: verdict.alphaReasoning,
        p_user_message: verdict.userMessage,
        p_urgency: verdict.urgency,
        p_current_price: currentPrice,
        p_r_multiple: rMultiple,
        p_drawdown_percent: drawdownPercent,
        p_minutes_in_trade: minutesInTrade,
        p_model_used: verdict.modelUsed,
        p_tokens_used: verdict.tokensUsed,
        p_should_notify: verdict.shouldNotify,
        p_thesis_status_before: trade.thesis_status || 'new',
      });

      if (error) {
        logger.error(LogCategory.TRADE_EXECUTION, '[EscalationEngine] Failed to persist verdict:', error);
      } else {
        logger.info(LogCategory.TRADE_EXECUTION, `[EscalationEngine] Verdict persisted for ${trade.symbol} | verdict=${verdict.verdict} | thesis=${verdict.thesisStatus}`);
      }
    } catch (err) {
      logger.error(LogCategory.TRADE_EXECUTION, '[EscalationEngine] Exception persisting verdict:', err);
    }
  }

  private async loadPersistedTriggers(tradeId: string): Promise<Set<string>> {
    try {
      const { data, error } = await supabase.rpc('get_fired_triggers_for_trade', { p_trade_id: tradeId });
      if (error) {
        logger.warn(LogCategory.TRADE_EXECUTION, '[EscalationEngine] get_fired_triggers_for_trade RPC error (trade may re-fire triggers this session):', { tradeId, status: (error as { code?: string }).code, message: error.message });
        return new Set<string>();
      }
      return new Set<string>((data || []) as string[]);
    } catch (err) {
      logger.warn(LogCategory.TRADE_EXECUTION, '[EscalationEngine] get_fired_triggers_for_trade exception:', { tradeId, err });
      return new Set<string>();
    }
  }

  private async persistTriggerFired(tradeId: string, userId: string, triggerType: string): Promise<void> {
    try {
      await supabase.rpc('record_trigger_fired', {
        p_trade_id: tradeId,
        p_user_id: userId,
        p_trigger_type: triggerType,
      });
    } catch {
      // Non-fatal — in-memory Set still prevents re-fire this session
    }
  }

  clearTradeCache(tradeId: string): void {
    this.firedTriggersCache.delete(tradeId);
  }
}

export const midTradeEscalationEngine = new MidTradeEscalationEngine();
