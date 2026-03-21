/**
 * Post-Trade Analyzer
 *
 * Analyzes trade outcomes vs LLM predictions to determine accuracy and lessons learned.
 * Triggered when a trade closes, this service:
 * 1. Compares expected outcome vs actual outcome
 * 2. Evaluates prediction accuracy
 * 3. Generates natural language lessons
 * 4. Updates journal with post-trade analysis
 * 5. Feeds data back to confidence calibration
 * 6. Populates AI learning tables (ai_trade_analysis, alpha_meta_insights, etc.)
 */

import { supabase } from '../lib/supabase';
import { llmReasoningLogger, PostTradeAnalysis } from './llm-reasoning-logger';
import { logger } from '../lib/logger';
import { tpQualityTracker } from './tp-quality-tracker';
import { shouldIncludeInLearning, getExclusionReason } from '../utils/trade-learning-filter';
import { mapCloseReasonToAnalysis, deriveAnalysisCloseReason } from '../utils/close-reason-mapper';
import { getNearMissData, isNearMissTrade, isTP1OnlyTrade } from '../utils/trade-outcome-classifier';
import { getCurrencyPipInfo } from '../utils/currencyHelpers';
import { CloseReason } from '../types/position';
import { strategyPlaybookManager } from './strategy-playbook-manager';
import { getRegimeBucket } from './regime-bucketing';

function formatHoldDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

interface TradeData {
  id: string;
  userId: string;
  symbol: string;
  direction?: 'buy' | 'sell';
  entryPrice?: number;
  exitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  pnl: number;
  entryTime?: Date;
  exitTime?: Date;
  journalEntryId?: string;
  expectedOutcome?: string;
  convictionLevel?: number;
  patternIdentified?: string;
  closeReason?: string;
  tp1Hit?: boolean;
  tp2Hit?: boolean;
  peakProfit?: number | null;
  tradeStyle?: string | null;
  timeframe?: string | null;
  plannedEntryPrice?: number | null;
  /**
   * SSOT: The goal session scan session_id (text UUID stored in alpha_strategy_memory.session_id).
   * Required to resolve which strategy record to update after trade closure.
   * Passed through from TradeClosureEventProcessor via the closure event.
   */
  sessionId?: string | null;
}

class PostTradeAnalyzer {
  /**
   * Analyze trade outcome when position closes
   *
   * IMPORTANT: System closures (weekend_protection, holiday_closure, etc.) are
   * excluded from learning as they are NOT Alpha's fault
   */
  async analyzeClosedTrade(tradeData: TradeData): Promise<void> {
    try {
      console.log(`[Post-Trade Analyzer] Analyzing trade ${tradeData.id} for ${tradeData.symbol}`);

      const outcome = this.determineOutcome(tradeData.pnl);

      // STEP 1: ALWAYS ensure journal entry exists (user-facing record of every trade)
      // Journal creation is DECOUPLED from learning eligibility per SSOT principles:
      // - Journal = authoritative record of ALL trades (user-facing)
      // - Learning = selective AI analysis (only for eligible trades)
      let journalEntry = await this.getJournalEntry(tradeData.id);

      if (!journalEntry) {
        console.log(`[Post-Trade Analyzer] No journal entry for trade ${tradeData.id} - creating`);
        journalEntry = await this.createRetroactiveJournalEntry(tradeData);

        if (!journalEntry) {
          console.error(`[Post-Trade Analyzer] Failed to create journal entry for trade ${tradeData.id}`);
          return;
        }

        console.log(`[Post-Trade Analyzer] Journal entry created for trade ${tradeData.id}`);
      }

      // STEP 2: Always update journal with closure data (outcome, pnl, exit info)
      await this.updateJournalWithClosureData(journalEntry, tradeData, outcome);

      // STEP 3: Check learning eligibility - only AI learning tables are gated
      // Compute peak_hit_ratio from peakProfit before the filter call
      const peakHitRatio = this.computePeakHitRatio(tradeData);

      const learningEligible = shouldIncludeInLearning(tradeData.closeReason, {
        tp1_hit: tradeData.tp1Hit,
        tp2_hit: tradeData.tp2Hit,
        peak_hit_ratio: peakHitRatio,
        final_pnl: tradeData.pnl,
      });

      if (!learningEligible) {
        const exclusionReason = getExclusionReason(tradeData.closeReason, {
          tp1_hit: tradeData.tp1Hit,
          tp2_hit: tradeData.tp2Hit,
          peak_hit_ratio: peakHitRatio,
          final_pnl: tradeData.pnl,
        });
        console.log(`[Post-Trade Analyzer] Skipping AI learning - ${exclusionReason} (journal entry preserved)`);
        return;
      }

      // STEP 4: Full analysis pipeline (only for learning-eligible trades)
      const fullTradeData = await this.enrichTradeData(tradeData);

      // Derive the authoritative analysis close reason using the SSOT mapper.
      // This replaces ad-hoc close reason checks scattered across learning services.
      const analysisCloseReason = deriveAnalysisCloseReason({
        dbCloseReason: fullTradeData.closeReason,
        tp1Hit: fullTradeData.tp1Hit ?? false,
        tp2Hit: fullTradeData.tp2Hit ?? false,
        peakHitRatio: peakHitRatio,
        finalPnl: fullTradeData.pnl,
      });

      const nearMissData = getNearMissData({
        close_reason: fullTradeData.closeReason,
        profit_loss: fullTradeData.pnl,
        peak_hit_ratio: peakHitRatio,
      });

      const tp1Only = isTP1OnlyTrade({
        close_reason: fullTradeData.closeReason,
        tp1_hit: fullTradeData.tp1Hit,
        tp2_hit: fullTradeData.tp2Hit,
      });

      const { wasPredictionCorrect, accuracyScore, actualOutcome } = this.analyzePredictionAccuracy(
        fullTradeData,
        journalEntry.expected_outcome,
        analysisCloseReason,
        nearMissData
      );

      const lessonLearned = this.generateLessonLearned(
        fullTradeData,
        journalEntry,
        wasPredictionCorrect,
        nearMissData,
        tp1Only
      );

      const mistakeIdentified = wasPredictionCorrect ? undefined : this.identifyMistake(fullTradeData, journalEntry, nearMissData);
      const whatWorked = wasPredictionCorrect ? this.identifyWhatWorked(fullTradeData, journalEntry) : undefined;

      if (fullTradeData.exitTime && fullTradeData.exitPrice) {
        const analysis: PostTradeAnalysis = {
          journalEntryId: journalEntry.id,
          exitTime: fullTradeData.exitTime,
          exitPrice: fullTradeData.exitPrice,
          pnl: fullTradeData.pnl,
          outcome,
          actualOutcome,
          wasPredictionCorrect,
          accuracyScore,
          lessonLearned,
          mistakeIdentified,
          whatWorked
        };

        await llmReasoningLogger.logPostTradeAnalysis(analysis);
      }

      await this.logAccuracyTracking(fullTradeData, journalEntry, wasPredictionCorrect);
      await this.populateAILearningTables(fullTradeData, journalEntry, outcome, wasPredictionCorrect, analysisCloseReason);
      await this.trackTPOutcome(fullTradeData, outcome, peakHitRatio, nearMissData, tp1Only);

      // Persist near-miss flag and peak_hit_ratio back to the trade record
      if (peakHitRatio != null || nearMissData || tp1Only) {
        await this.persistNearMissFlags(fullTradeData, peakHitRatio, nearMissData, tp1Only);
      }

      // SSOT: Update strategy memory with this trade outcome.
      // This is the single authoritative place in the live pipeline that feeds
      // trade results back to alpha_strategy_memory, closing the learning loop.
      // The RPC resolves the active strategy by session_id + symbol and updates
      // performance counters atomically.
      await this.updateStrategyMemory(fullTradeData, outcome, lessonLearned, whatWorked, mistakeIdentified);

      console.log(`[Post-Trade Analyzer] Analysis complete for ${tradeData.symbol}`);
    } catch (error) {
      console.error('[Post-Trade Analyzer] Error analyzing trade:', error);
    }
  }

  private async updateJournalWithClosureData(
    journalEntry: any,
    tradeData: TradeData,
    outcome: 'win' | 'loss' | 'breakeven'
  ): Promise<void> {
    try {
      const updateData: Record<string, any> = {
        outcome,
        pnl: tradeData.pnl,
        updated_at: new Date().toISOString(),
      };

      if (tradeData.exitPrice) {
        updateData.exit_price = tradeData.exitPrice;
      }
      if (tradeData.exitTime) {
        updateData.exit_time = tradeData.exitTime.toISOString();
      }

      // Determine the new journal stage based on close reason and prior stage
      const closeReason = tradeData.closeReason || 'unknown';
      const priorStage: string = journalEntry.journal_stage || 'open';
      const isTP1Close = closeReason === 'take_profit_1' || tradeData.tp1Hit === true;
      const isTP2Close = closeReason === 'take_profit_2' || tradeData.tp2Hit === true;

      if (isTP2Close) {
        updateData.journal_stage = 'tp2_hit';
        if (tradeData.exitPrice) updateData.tp2_exit_price = tradeData.exitPrice;

        // CCIP FIX (2026-03-01 TP-MODAL-PNL-SSOT): Store INCREMENTAL TP2 leg P&L, not
        // the total trade P&L. Since the full position (100%) stays open from entry through
        // both milestones (TP1 is advisory-only, no partial close), the TP2 incremental
        // gain = total final P&L minus the P&L that was already booked at TP1.
        // This gives users the correct breakdown: Entry→TP1 (tp1_pnl) + TP1→TP2 (tp2_pnl).
        // SSOT: tp1_pnl is written by the TP1 branch below and persisted in ai_trade_journal;
        // we read it back here from journalEntry to avoid any re-calculation drift.
        const existingTP1Pnl: number | null = journalEntry.tp1_pnl != null
          ? parseFloat(String(journalEntry.tp1_pnl))
          : null;
        updateData.tp2_pnl = existingTP1Pnl != null
          ? Math.round((tradeData.pnl - existingTP1Pnl) * 100) / 100
          : tradeData.pnl;
      } else if (isTP1Close) {
        updateData.journal_stage = 'tp1_hit';
        updateData.tp1_pnl = tradeData.pnl;
        if (tradeData.exitPrice) updateData.tp1_exit_price = tradeData.exitPrice;
      } else {
        updateData.journal_stage = 'final';
      }

      // Build the progressive narrative.
      // If the entry already has a goal_pnl_at_achievement the user's goal was
      // crossed before this TP fired — include all milestones in the narrative.
      const goalPnL: number | null = journalEntry.goal_pnl_at_achievement ?? null;

      updateData.actual_outcome = this.buildProgressiveNarrative({
        closeReason,
        finalPnL: tradeData.pnl,
        exitPrice: tradeData.exitPrice,
        goalPnL,
        priorStage,
        isTP1Close,
        isTP2Close,
        tp1Pnl: journalEntry.tp1_pnl ?? null,
        entryPrice: journalEntry.entry_price ?? tradeData.entryPrice,
        entryTime: journalEntry.entry_time ? new Date(journalEntry.entry_time) : tradeData.entryTime,
        exitTime: tradeData.exitTime,
        direction: tradeData.direction ?? journalEntry.direction,
        symbol: tradeData.symbol,
      });

      const { error } = await supabase
        .from('ai_trade_journal')
        .update(updateData)
        .eq('id', journalEntry.id);

      if (error) {
        console.error('[Post-Trade Analyzer] Failed to update journal closure data:', error);
      }
    } catch (error) {
      console.error('[Post-Trade Analyzer] Error updating journal closure data:', error);
    }
  }

  /**
   * Build the human-readable "What Actually Happened" narrative.
   *
   * Produces a full-journey string like:
   *   "Goal hit at +$12.40 → continued to TP1 at +$18.60 → held to TP2 at +$24.80"
   *
   * Falls back to a simple one-liner for trades without a goal milestone.
   */
  private buildProgressiveNarrative(params: {
    closeReason: string;
    finalPnL: number;
    exitPrice?: number;
    goalPnL: number | null;
    priorStage: string;
    isTP1Close: boolean;
    isTP2Close: boolean;
    tp1Pnl: number | null;
    entryPrice?: number;
    entryTime?: Date;
    exitTime?: Date;
    direction?: string;
    symbol?: string;
  }): string {
    const { closeReason, finalPnL, exitPrice, goalPnL, priorStage, isTP1Close, isTP2Close, tp1Pnl, entryPrice, entryTime, exitTime, direction, symbol } = params;
    const pnlStr = (v: number) => `${v >= 0 ? '+' : ''}$${Math.abs(v).toFixed(2)}`;

    const pipValue = symbol?.includes('JPY') ? 0.01 : 0.0001;
    const pipsMoved = (entryPrice && exitPrice && direction)
      ? Math.round(Math.abs(exitPrice - entryPrice) / pipValue)
      : null;
    const pipsDirection = (entryPrice && exitPrice && direction)
      ? ((direction === 'buy' ? exitPrice > entryPrice : exitPrice < entryPrice) ? 'in favour' : 'against')
      : null;

    const holdMs = (entryTime && exitTime) ? (exitTime.getTime() - entryTime.getTime()) : null;
    const holdStr = holdMs !== null ? formatHoldDuration(holdMs) : null;

    const parts: string[] = [];

    // Was the goal milestone crossed before this closure?
    if (goalPnL !== null && (priorStage === 'goal_achieved' || priorStage === 'tp1_hit')) {
      parts.push(`Goal hit at ${pnlStr(goalPnL)}`);
    }

    // Was TP1 already recorded (we're now at TP2)?
    if (isTP2Close && tp1Pnl !== null) {
      parts.push(`continued to TP1 at ${pnlStr(tp1Pnl)}`);
      parts.push(`held to TP2 at ${pnlStr(finalPnL)}`);
    } else if (isTP1Close) {
      if (parts.length > 0) {
        parts.push(`continued to TP1 at ${pnlStr(finalPnL)}`);
      } else {
        parts.push(`TP1 hit at ${pnlStr(finalPnL)}`);
      }
    } else if (isTP2Close) {
      if (parts.length > 0) {
        parts.push(`held to TP2 at ${pnlStr(finalPnL)}`);
      } else {
        parts.push(`TP2 hit at ${pnlStr(finalPnL)}`);
      }
    } else if (closeReason === 'goal_achieved') {
      parts.push(`Goal achieved — closed at ${pnlStr(finalPnL)}`);
    } else if (closeReason === 'stop_loss') {
      parts.push(`Stop loss hit at ${pnlStr(finalPnL)}`);
    } else if (finalPnL > 0) {
      parts.push(`Closed manually for a profit of ${pnlStr(finalPnL)}`);
    } else if (finalPnL < 0) {
      parts.push(`Closed with a loss of ${pnlStr(finalPnL)}`);
    } else {
      parts.push(`Closed at breakeven`);
    }

    const suffix: string[] = [];
    if (pipsMoved !== null && pipsDirection !== null) suffix.push(`${pipsMoved} pips ${pipsDirection}`);
    if (holdStr) suffix.push(`held ${holdStr}`);
    if (suffix.length > 0) parts.push(suffix.join(', '));

    return parts.join(' — ');
  }

  private async enrichTradeData(tradeData: TradeData): Promise<TradeData & { alphaReasoningSnapshot?: string | null; tp1ReasoningFromRecord?: string | null; tp2ReasoningFromRecord?: string | null }> {
    try {
      const { data: trade } = await supabase
        .from('goal_session_trades')
        .select('direction, entry_price, exit_price, stop_loss, take_profit, created_at, closed_at, tp1_hit, tp2_hit, peak_profit, trade_style, timeframe, alpha_reasoning_snapshot, tp1_reasoning, tp2_reasoning')
        .eq('id', tradeData.id)
        .maybeSingle();

      if (trade) {
        return {
          ...tradeData,
          direction: tradeData.direction || trade.direction,
          entryPrice: tradeData.entryPrice ?? trade.entry_price,
          exitPrice: tradeData.exitPrice ?? trade.exit_price,
          stopLoss: tradeData.stopLoss ?? trade.stop_loss,
          takeProfit: tradeData.takeProfit ?? trade.take_profit,
          entryTime: tradeData.entryTime || new Date(trade.created_at),
          exitTime: tradeData.exitTime || (trade.closed_at ? new Date(trade.closed_at) : new Date()),
          tp1Hit: tradeData.tp1Hit ?? trade.tp1_hit,
          tp2Hit: tradeData.tp2Hit ?? trade.tp2_hit,
          peakProfit: tradeData.peakProfit ?? trade.peak_profit ?? null,
          tradeStyle: tradeData.tradeStyle ?? trade.trade_style ?? null,
          timeframe: tradeData.timeframe ?? trade.timeframe ?? null,
          alphaReasoningSnapshot: trade.alpha_reasoning_snapshot ?? null,
          tp1ReasoningFromRecord: trade.tp1_reasoning ?? null,
          tp2ReasoningFromRecord: trade.tp2_reasoning ?? null,
        };
      }
    } catch (error) {
      console.error('[Post-Trade Analyzer] Failed to enrich trade data:', error);
    }

    return tradeData;
  }

  /**
   * Get journal entry for a trade
   */
  private async getJournalEntry(tradeId: string): Promise<any | null> {
    const { data, error } = await supabase
      .from('ai_trade_journal')
      .select('*')
      .eq('trade_id', tradeId)
      .maybeSingle();

    if (error) {
      console.error('[Post-Trade Analyzer] Error fetching journal:', error);
      return null;
    }

    return data;
  }

  /**
   * Create retroactive journal entry for trades that were opened without one.
   *
   * CCIP-2026-0321: Safety net for legacy trades or any edge-case gap.
   * Reads alpha_reasoning_snapshot from goal_session_trades to recover Alpha's
   * original context instead of showing placeholder text.
   */
  private async createRetroactiveJournalEntry(tradeData: TradeData): Promise<any | null> {
    try {
      const enriched = await this.enrichTradeData(tradeData);
      const dir = enriched.direction || 'buy';
      const entryPrice = enriched.entryPrice || 0;
      const stopLoss = enriched.stopLoss || 0;
      const takeProfit = enriched.takeProfit || 0;

      const sym = enriched.symbol || '';
      const pipValue = sym.includes('JPY') ? 0.01
        : sym.toLowerCase().includes('xau') || sym.toLowerCase().includes('gold') ? 0.1
        : sym.toLowerCase().includes('xag') || sym.toLowerCase().includes('silver') ? 0.01
        : 0.0001;
      const pricePrecision = sym.includes('JPY') ? 3
        : sym.toLowerCase().includes('xau') || sym.toLowerCase().includes('gold') ? 2
        : sym.toLowerCase().includes('xag') || sym.toLowerCase().includes('silver') ? 3
        : 5;
      const slPips = stopLoss > 0 && entryPrice > 0 ? Math.round(Math.abs(entryPrice - stopLoss) / pipValue) : 0;
      const tpPips = takeProfit > 0 && entryPrice > 0 ? Math.round(Math.abs(takeProfit - entryPrice) / pipValue) : 0;
      const rr = slPips > 0 ? (tpPips / slPips).toFixed(1) : 'N/A';

      // CCIP-2026-0321: Attempt to recover Alpha's original narrative from
      // alpha_reasoning_snapshot stored in goal_session_trades at execution time.
      const snapshot = (enriched as any).alphaReasoningSnapshot;
      let recoveredNarrative: string | null = null;
      let recoveredMarketRead: string | null = null;
      let recoveredExpectedOutcome: string | null = null;

      if (snapshot) {
        try {
          const parsed = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
          const as = parsed?.answer_sheet;
          const narrative = typeof parsed?.narrative === 'string' ? parsed.narrative : null;

          recoveredNarrative = narrative;

          if (as && typeof as === 'object') {
            const parts: string[] = [];
            if (as.Q1_trend_alignment) parts.push(`Trend: ${as.Q1_trend_alignment}`);
            if (as.Q2_structure_level) parts.push(`Structure: ${as.Q2_structure_level}`);
            if (as.Q4_momentum_stage) parts.push(`Momentum: ${as.Q4_momentum_stage}`);
            if (as.Q6_entry_trigger) parts.push(`Entry trigger: ${as.Q6_entry_trigger}`);
            const conf = as.Q7_confluence_judgment || as.Q7_confluence_confirmed || as.Q7_confluence_count;
            if (conf) parts.push(`Confluence: ${conf}`);
            if (as.Q8C_price_location_zone) parts.push(`Price zone: ${as.Q8C_price_location_zone}`);
            if (as.kill_zone && as.kill_zone !== 'NONE') parts.push(`Kill zone: ${as.kill_zone}`);
            if (as.intermarket_correlation && as.intermarket_correlation !== 'UNKNOWN') {
              parts.push(`Intermarket: ${as.intermarket_correlation}`);
            }
            if (parts.length > 0) recoveredMarketRead = parts.join('. ') + '.';

            let plan = `Entry: ${entryPrice.toFixed(pricePrecision)} | SL: ${stopLoss.toFixed(pricePrecision)} (${slPips} pips) | TP: ${takeProfit.toFixed(pricePrecision)} (${tpPips} pips) | R:R ${rr}:1`;
            if (as.Q5B_objective_alignment) plan += `. Objective: ${as.Q5B_objective_alignment}`;
            if (as.Q5_failure_mode && as.Q5_failure_mode !== 'NONE') plan += `. Invalidated if: ${as.Q5_failure_mode}`;
            recoveredExpectedOutcome = plan;
          } else if (narrative) {
            recoveredMarketRead = narrative;
          }
        } catch {
          // Snapshot parse failed — fall through to computed fallback
        }
      }

      const marketRead = recoveredMarketRead
        || (entryPrice > 0
          ? `Entered ${sym} at ${entryPrice.toFixed(pricePrecision)}. Stop: ${stopLoss.toFixed(pricePrecision)} (${slPips} pips risk). Target: ${takeProfit.toFixed(pricePrecision)} (${tpPips} pips).`
          : 'Entry conditions were not captured at open time.');

      const expectedOutcome = recoveredExpectedOutcome
        || (takeProfit > 0 && stopLoss > 0
          ? `Entry: ${entryPrice.toFixed(pricePrecision)} | SL: ${stopLoss.toFixed(pricePrecision)} (${slPips} pips) | TP: ${takeProfit.toFixed(pricePrecision)} (${tpPips} pips) | R:R ${rr}:1`
          : 'Target levels not recorded.');

      const llmReasoning = recoveredNarrative
        || (entryPrice > 0
          ? `${dir.toUpperCase()} ${sym} at ${entryPrice.toFixed(pricePrecision)} — ${enriched.closeReason === 'stop_loss' ? 'stopped out' : enriched.closeReason || 'closed'}.`
          : `${dir.toUpperCase()} trade on ${sym}. Close reason: ${enriched.closeReason || 'unknown'}.`);

      const insertData: Record<string, any> = {
        user_id: enriched.userId,
        trade_id: enriched.id,
        symbol: sym,
        direction: dir,
        entry_time: enriched.entryTime ? enriched.entryTime.toISOString() : new Date().toISOString(),
        entry_price: entryPrice,
        stop_loss: stopLoss,
        take_profit: takeProfit,
        llm_reasoning: llmReasoning,
        market_read: marketRead,
        expected_outcome: expectedOutcome,
        pattern_identified: enriched.patternIdentified || 'System Trade',
        conviction_level: enriched.convictionLevel || 70,
        rank_at_time: 'System',
        outcome: 'open',
        journal_entry_type: 'trade',
        pnl: enriched.pnl,
      };

      if (enriched.exitTime) insertData.exit_time = enriched.exitTime.toISOString();
      if (enriched.exitPrice) insertData.exit_price = enriched.exitPrice;

      const { data, error } = await supabase
        .from('ai_trade_journal')
        .upsert(insertData, { onConflict: 'trade_id' })
        .select()
        .single();

      if (error) {
        console.error('[Post-Trade Analyzer] Error creating retroactive journal:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[Post-Trade Analyzer] Exception creating retroactive journal:', error);
      return null;
    }
  }

  /**
   * Determine trade outcome
   */
  private determineOutcome(pnl: number): 'win' | 'loss' | 'breakeven' {
    if (pnl > 0) return 'win';
    if (pnl < 0) return 'loss';
    return 'breakeven';
  }

  /**
   * Compute peak_hit_ratio: how far did price travel toward TP at its best point,
   * expressed as a fraction of the total TP distance (0.0 = no progress, 1.0 = TP hit).
   *
   * Uses peakProfit from the trade record when available (most accurate).
   * Falls back to exit price distance for trades without peak tracking.
   *
   * SSOT: This is the single place that computes this ratio.
   */
  private computePeakHitRatio(tradeData: TradeData): number | null {
    if (!tradeData.entryPrice || !tradeData.takeProfit || !tradeData.stopLoss) return null;

    const tpDistance = Math.abs(tradeData.takeProfit - tradeData.entryPrice);
    if (tpDistance === 0) return null;

    if (tradeData.peakProfit != null && tradeData.peakProfit > 0) {
      const slDistance = Math.abs(tradeData.entryPrice - tradeData.stopLoss);
      if (slDistance === 0) return null;
      const riskInDollars = slDistance;
      const peakRR = tradeData.peakProfit / riskInDollars;
      const plannedRR = tpDistance / Math.abs(tradeData.entryPrice - tradeData.stopLoss);
      if (plannedRR === 0) return null;
      return Math.min(1.0, peakRR / plannedRR);
    }

    if (!tradeData.exitPrice) return null;
    const exitDistance = Math.abs(tradeData.exitPrice - tradeData.entryPrice);
    const directionCorrect = tradeData.direction === 'buy'
      ? tradeData.exitPrice > tradeData.entryPrice
      : tradeData.exitPrice < tradeData.entryPrice;

    if (!directionCorrect) return 0;
    return Math.min(1.0, exitDistance / tpDistance);
  }

  /**
   * Persist near-miss flags and peak_hit_ratio back to the trades table
   * so future queries and admin dashboards can see the classification.
   */
  private async persistNearMissFlags(
    tradeData: TradeData,
    peakHitRatio: number | null,
    nearMissData: ReturnType<typeof getNearMissData>,
    tp1Only: boolean
  ): Promise<void> {
    try {
      const updates: Record<string, unknown> = {};
      if (peakHitRatio != null) updates.peak_hit_ratio = peakHitRatio;
      if (nearMissData) updates.near_miss = true;
      if (tp1Only) updates.tp1_only = true;

      if (Object.keys(updates).length === 0) return;

      await supabase
        .from('goal_session_trades')
        .update(updates)
        .eq('id', tradeData.id);
    } catch (error) {
      logger.error('[Post-Trade Analyzer] Failed to persist near-miss flags', { error });
    }
  }

  /**
   * Analyze how accurate the LLM's prediction was
   */
  private analyzePredictionAccuracy(
    tradeData: TradeData,
    expectedOutcome?: string,
    analysisCloseReason?: string,
    nearMissData?: ReturnType<typeof getNearMissData>
  ): { wasPredictionCorrect: boolean; accuracyScore: number; actualOutcome: string } {
    const actualOutcome = this.describeActualOutcome(tradeData, nearMissData);

    // Near-miss: direction was correct, Alpha called the move right.
    // Treat as prediction-correct with reduced accuracy score to signal TP placement fault.
    if (nearMissData) {
      const accuracyScore = nearMissData.severity === 'critical' ? 82
        : nearMissData.severity === 'significant' ? 75
        : 68;
      return {
        wasPredictionCorrect: true,
        accuracyScore,
        actualOutcome,
      };
    }

    // TP1-only: partial victory. Direction correct, first target hit.
    if (analysisCloseReason === 'tp1_only') {
      return {
        wasPredictionCorrect: true,
        accuracyScore: 78,
        actualOutcome,
      };
    }

    // Did price hit TP or SL?
    const hitTP = this.didHitTargetProfit(tradeData);
    const hitSL = this.didHitStopLoss(tradeData);

    let wasPredictionCorrect = false;
    let accuracyScore = 50;

    if (!expectedOutcome) {
      wasPredictionCorrect = tradeData.pnl > 0;
      accuracyScore = tradeData.pnl > 0 ? 75 : 25;
    } else {
      const expectedTP = expectedOutcome.toLowerCase().includes('take profit') ||
                         expectedOutcome.toLowerCase().includes('target') ||
                         expectedOutcome.toLowerCase().includes('win');

      wasPredictionCorrect = (expectedTP && hitTP) || (!expectedTP && hitSL);

      if (wasPredictionCorrect) {
        accuracyScore = 90 + (Math.random() * 10);
      } else {
        if (tradeData.pnl > 0 && !expectedTP) {
          accuracyScore = 60;
        } else if (tradeData.pnl < 0 && expectedTP) {
          accuracyScore = 30;
        } else {
          accuracyScore = 45;
        }
      }
    }

    return { wasPredictionCorrect, accuracyScore, actualOutcome };
  }

  /**
   * Describe what actually happened in the trade
   */
  private describeActualOutcome(
    tradeData: TradeData,
    nearMissData?: ReturnType<typeof getNearMissData>
  ): string {
    if (nearMissData) {
      const pct = Math.round(nearMissData.peakHitRatio * 100);
      return `Near-miss: Price moved ${pct}% of the way to the take profit target before reversing. `
        + `Alpha correctly identified the direction — the TP was placed too far. `
        + `Final P&L: $${tradeData.pnl.toFixed(2)}.`;
    }

    if (tradeData.tp1Hit && !tradeData.tp2Hit) {
      return `TP1 hit — partial target achieved. Price did not continue to TP2. Final P&L: $${tradeData.pnl.toFixed(2)}.`;
    }

    const hitTP = this.didHitTargetProfit(tradeData);
    const hitSL = this.didHitStopLoss(tradeData);

    if (hitTP) {
      return `Price moved in the expected direction and hit the take profit target at ${tradeData.takeProfit?.toFixed(5) ?? 'N/A'}. The trade was a success.`;
    } else if (hitSL) {
      return `Price reversed against the position and hit the stop loss at ${tradeData.stopLoss?.toFixed(5) ?? 'N/A'}. The trade resulted in a loss.`;
    } else if (tradeData.pnl > 0) {
      return `Trade was closed manually for a profit of $${tradeData.pnl.toFixed(2)} before hitting TP.`;
    } else if (tradeData.pnl < 0) {
      return `Trade was closed manually for a loss of $${Math.abs(tradeData.pnl).toFixed(2)} before hitting SL.`;
    } else {
      return `Trade was closed at breakeven.`;
    }
  }

  /**
   * Check if trade hit take profit
   */
  private didHitTargetProfit(tradeData: TradeData): boolean {
    if (!tradeData.exitPrice || !tradeData.takeProfit || !tradeData.entryPrice) return false;
    const priceDiff = Math.abs(tradeData.exitPrice - tradeData.takeProfit);
    const threshold = Math.abs(tradeData.takeProfit - tradeData.entryPrice) * 0.02;
    return priceDiff <= threshold;
  }

  private didHitStopLoss(tradeData: TradeData): boolean {
    if (!tradeData.exitPrice || !tradeData.stopLoss || !tradeData.entryPrice) return false;
    const priceDiff = Math.abs(tradeData.exitPrice - tradeData.stopLoss);
    const threshold = Math.abs(tradeData.stopLoss - tradeData.entryPrice) * 0.02;
    return priceDiff <= threshold;
  }

  /**
   * Generate natural language lesson learned
   */
  private generateLessonLearned(
    tradeData: TradeData,
    journalEntry: any,
    wasPredictionCorrect: boolean,
    nearMissData?: ReturnType<typeof getNearMissData>,
    tp1Only?: boolean
  ): string {
    if (nearMissData) {
      const pct = Math.round(nearMissData.peakHitRatio * 100);
      return `Directional analysis was correct — price reached ${pct}% of the TP distance. `
        + `This is a near-miss, not a loss. The TP target was placed ${100 - pct}% too far for ${tradeData.symbol}. `
        + `Consider tightening TP placement on future scalp trades for this symbol.`;
    }

    if (tp1Only) {
      return `TP1 was hit successfully — partial target achieved. Price did not continue to TP2. `
        + `Review whether TP2 was too far for this market condition or if momentum data suggested holding was correct.`;
    }

    if (wasPredictionCorrect && tradeData.pnl > 0) {
      return `My market analysis was accurate. The ${journalEntry.pattern_identified || 'setup'} pattern played out as expected, validating my ${journalEntry.conviction_level}% conviction. I should continue trusting similar setups with this confidence level.`;
    } else if (wasPredictionCorrect && tradeData.pnl < 0) {
      return `My market read was correct, but the pattern didn't follow through. This suggests that while my analysis was sound, external factors (news, liquidity, or market regime shift) overrode the technical setup. I need to be more cautious even with high conviction.`;
    } else if (!wasPredictionCorrect && tradeData.pnl > 0) {
      return `I was wrong about the direction but still made a profit. This was likely due to quick adaptation or luck. I shouldn't rely on this - my initial analysis needs improvement for ${journalEntry.pattern_identified || 'this type of setup'}.`;
    } else {
      return `My prediction was incorrect and the trade lost. The ${journalEntry.pattern_identified || 'pattern'} didn't work as expected. I need to re-evaluate my understanding of this setup, possibly adjusting my confidence threshold or avoiding similar conditions.`;
    }
  }

  /**
   * Identify what mistake was made (for losses)
   */
  private identifyMistake(
    tradeData: TradeData,
    journalEntry: any,
    nearMissData?: ReturnType<typeof getNearMissData>
  ): string {
    if (tradeData.pnl >= 0 && !nearMissData) return '';

    if (nearMissData) {
      const pct = Math.round(nearMissData.peakHitRatio * 100);
      return `TP placement error: price reached ${pct}% of the target distance. TP was set too far for this ${tradeData.symbol} scalp move. This is not a directional error.`;
    }

    const mistakes = [];

    // Overconfidence
    if (journalEntry.conviction_level > 85 && tradeData.pnl < 0) {
      mistakes.push('I was overconfident with ' + journalEntry.conviction_level + '% conviction on a losing trade');
    }

    // Pattern misread
    if (journalEntry.pattern_identified) {
      mistakes.push(`The ${journalEntry.pattern_identified} pattern didn't validate before entry`);
    }

    // Market regime mismatch
    if (journalEntry.market_read && journalEntry.market_read.includes('volatile')) {
      mistakes.push('I traded in high volatility without proper risk adjustment');
    }

    return mistakes.length > 0 ? mistakes.join('. ') : 'Trade setup did not materialize as expected';
  }

  /**
   * Identify what worked well (for wins)
   */
  private identifyWhatWorked(tradeData: TradeData, journalEntry: any): string {
    if (tradeData.pnl <= 0) return '';

    const successes = [];

    // Pattern recognition
    if (journalEntry.pattern_identified) {
      successes.push(`The ${journalEntry.pattern_identified} pattern was correctly identified and executed`);
    }

    // Confidence calibration
    if (journalEntry.conviction_level >= 80) {
      successes.push('High conviction (' + journalEntry.conviction_level + '%) was justified');
    }

    // Market read
    if (journalEntry.market_read) {
      successes.push('Market analysis was accurate');
    }

    return successes.length > 0 ? successes.join('. ') : 'Trade execution was sound';
  }

  /**
   * Log accuracy data for calibration tracking
   */
  private async logAccuracyTracking(
    tradeData: TradeData,
    journalEntry: any,
    predictionCorrect: boolean
  ): Promise<void> {
    try {
      const predictedOutcome = journalEntry.expected_outcome?.toLowerCase().includes('profit') ? 'tp_hit' : 'sl_hit';
      const actualOutcome = tradeData.pnl > 0 ? 'tp_hit' : tradeData.pnl < 0 ? 'sl_hit' : 'breakeven';

      await supabase.from('trade_accuracy_tracking').insert({
        user_id: tradeData.userId,
        trade_id: tradeData.id,
        journal_entry_id: journalEntry.id,
        predicted_outcome: predictedOutcome,
        actual_outcome: actualOutcome,
        prediction_correct: predictionCorrect,
        llm_confidence: journalEntry.conviction_level,
        pattern_name: journalEntry.pattern_identified,
        pattern_worked: predictionCorrect,
        trade_date: tradeData.exitTime ? tradeData.exitTime.toISOString() : new Date().toISOString()
      });
    } catch (error) {
      console.error('[Post-Trade Analyzer] Error logging accuracy:', error);
    }
  }

  /**
   * Populate AI learning tables for platform intelligence
   */
  private async populateAILearningTables(
    tradeData: TradeData,
    journalEntry: any,
    outcome: 'win' | 'loss' | 'breakeven',
    predictionCorrect: boolean,
    analysisCloseReason?: string
  ): Promise<void> {
    try {
      logger.info('[Post-Trade Analyzer] Populating AI learning tables');

      // Write to ai_trade_analysis
      await this.writeAITradeAnalysis(tradeData, journalEntry, outcome);

      // Update alpha_meta_insights
      if (journalEntry.pattern_identified) {
        await this.updateAlphaMetaInsights(tradeData, journalEntry, outcome);
      }

      // Update alpha_confidence_calibration
      if (journalEntry.conviction_level) {
        await this.updateAlphaConfidenceCalibration(
          tradeData.userId,
          journalEntry.conviction_level,
          predictionCorrect,
          outcome
        );
      }

      // Log execution quality
      await this.logExecutionQuality(tradeData, journalEntry);

      logger.info('[Post-Trade Analyzer] ✅ AI learning tables updated');
    } catch (error) {
      logger.error('[Post-Trade Analyzer] Error populating AI learning tables:', error);
    }
  }

  /**
   * Write comprehensive analysis to ai_trade_analysis table
   */
  private async writeAITradeAnalysis(
    tradeData: TradeData,
    journalEntry: any,
    outcome: 'win' | 'loss' | 'breakeven'
  ): Promise<void> {
    try {
      const riskReward = this.calculateRiskReward(tradeData);
      const durationMinutes = this.calculateTradeDuration(tradeData);

      await supabase.from('ai_trade_analysis').insert({
        user_id: tradeData.userId,
        live_trade_id: tradeData.id,
        symbol: tradeData.symbol,
        direction: tradeData.direction || 'buy',
        outcome: outcome,
        pnl: tradeData.pnl,
        entry_time: tradeData.entryTime ? tradeData.entryTime.toISOString() : new Date().toISOString(),
        exit_time: tradeData.exitTime ? tradeData.exitTime.toISOString() : new Date().toISOString(),
        duration_minutes: durationMinutes,
        entry_confidence: journalEntry.conviction_level || 0,
        reasoning: journalEntry.llm_reasoning,  // Schema field: reasoning (not ai_reasoning)
        market_conditions: {  // Consolidate into schema field: market_conditions
          setup: journalEntry.pattern_identified || 'unknown',
          market_read: journalEntry.market_read
        },
        contributed_to_global_learning: true
      });
    } catch (error) {
      logger.error('[Post-Trade Analyzer] Error writing ai_trade_analysis:', error);
    }
  }

  /**
   * Update alpha meta-insights for pattern learning
   */
  private async updateAlphaMetaInsights(
    tradeData: TradeData,
    journalEntry: any,
    outcome: 'win' | 'loss' | 'breakeven'
  ): Promise<void> {
    try {
      const pattern = journalEntry.pattern_identified;
      const winRate = outcome === 'win' ? 100 : 0;

      // Check if insight exists
      const { data: existing } = await supabase
        .from('alpha_meta_insights')
        .select('*')
        .eq('user_id', tradeData.userId)
        .eq('symbol', tradeData.symbol)
        .ilike('insight_description', `%${pattern}%${tradeData.symbol}%`)
        .maybeSingle();

      if (existing) {
        // Update existing
        const sampleSize = (existing.supporting_evidence?.sample_size || 0) + 1;
        const newWinRate = ((existing.improvement_seen || 0) * (sampleSize - 1) + winRate) / sampleSize;

        await supabase
          .from('alpha_meta_insights')
          .update({
            improvement_seen: newWinRate,
            confidence_in_insight: Math.min(95, 50 + (sampleSize * 2)),
            supporting_evidence: {
              sample_size: sampleSize,
              last_updated: new Date().toISOString()
            },
            validated: sampleSize >= 10,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        // Create new
        const insightType = outcome === 'win' ? 'strength' : outcome === 'loss' ? 'weakness' : 'neutral';

        await supabase.from('alpha_meta_insights').insert({
          user_id: tradeData.userId,
          symbol: tradeData.symbol,
          insight_type: insightType,
          insight_description: `${pattern} on ${tradeData.symbol}`,
          improvement_seen: winRate,
          confidence_in_insight: 50,
          supporting_evidence: {
            sample_size: 1,
            last_updated: new Date().toISOString()
          },
          validated: false
        });
      }
    } catch (error) {
      logger.error('[Post-Trade Analyzer] Error updating alpha_meta_insights:', error);
    }
  }

  /**
   * Update alpha confidence calibration buckets
   */
  private async updateAlphaConfidenceCalibration(
    userId: string,
    confidence: number,
    predictionCorrect: boolean,
    outcome: 'win' | 'loss' | 'breakeven'
  ): Promise<void> {
    try {
      const bucket = this.getConfidenceBucket(confidence);
      const actualWinRate = outcome === 'win' ? 100 : 0;

      const { data: existing } = await supabase
        .from('alpha_confidence_calibration')
        .select('*')
        .eq('user_id', userId)
        .eq('confidence_bucket', bucket)
        .maybeSingle();

      if (existing) {
        const newSampleSize = existing.sample_size + 1;
        const newActualWR = ((existing.actual_win_rate * existing.sample_size) + actualWinRate) / newSampleSize;
        const calibrationError = Math.abs(confidence - newActualWR);

        await supabase
          .from('alpha_confidence_calibration')
          .update({
            sample_size: newSampleSize,
            actual_win_rate: newActualWR,
            predicted_win_rate: confidence,
            calibration_error: calibrationError,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        const calibrationError = Math.abs(confidence - actualWinRate);

        await supabase.from('alpha_confidence_calibration').insert({
          user_id: userId,
          confidence_bucket: bucket,
          sample_size: 1,
          actual_win_rate: actualWinRate,
          predicted_win_rate: confidence,
          calibration_error: calibrationError
        });
      }
    } catch (error) {
      logger.error('[Post-Trade Analyzer] Error updating alpha_confidence_calibration:', error);
    }
  }

  /**
   * Log execution quality metrics
   */
  private async logExecutionQuality(tradeData: TradeData, journalEntry: any): Promise<void> {
    try {
      const actualEntry = tradeData.entryPrice ?? 0;
      const plannedEntry = tradeData.plannedEntryPrice ?? actualEntry;

      const slippagePips = this.calculateSlippagePips(
        tradeData.symbol,
        tradeData.direction ?? 'buy',
        plannedEntry,
        actualEntry
      );

      const slHunting = this.didHitStopLoss(tradeData) && tradeData.pnl < 0;

      await supabase.from('execution_quality_log').insert({
        user_id: tradeData.userId,
        symbol: tradeData.symbol,
        trade_id: tradeData.id,
        goal_session_id: tradeData.sessionId ?? null,
        session: this.determineSession(tradeData.entryTime || new Date()),
        expected_entry: plannedEntry,
        actual_entry: actualEntry,
        slippage_pips: slippagePips,
        expected_sl: tradeData.stopLoss ?? null,
        actual_sl_hit: this.didHitStopLoss(tradeData) ? tradeData.stopLoss ?? null : null,
        sl_hunting_suspected: slHunting,
        spread_at_entry: 0,
        spread_at_exit: 0,
        rejection_occurred: false
      });
    } catch (error) {
      logger.error('[Post-Trade Analyzer] Error logging execution quality:', error);
    }
  }

  private calculateSlippagePips(
    symbol: string,
    direction: 'buy' | 'sell',
    plannedEntry: number,
    actualEntry: number
  ): number {
    if (plannedEntry === 0 || actualEntry === 0) return 0;

    const rawDiff = actualEntry - plannedEntry;

    let pipSize = 0.0001;
    if (symbol.includes('JPY')) pipSize = 0.01;
    else if (symbol === 'XAUUSD') pipSize = 0.1;
    else if (symbol === 'XAGUSD') pipSize = 0.001;
    else if (symbol === 'US30' || symbol === 'NAS100' || symbol === 'SPX500') pipSize = 1;
    else if (symbol === 'BTCUSD' || symbol === 'ETHUSD') pipSize = 1;

    const slippage = direction === 'buy' ? rawDiff / pipSize : -rawDiff / pipSize;
    return Math.abs(parseFloat(slippage.toFixed(2)));
  }

  /**
   * Calculate risk-reward ratio
   */
  private calculateRiskReward(tradeData: TradeData): number {
    if (!tradeData.entryPrice || !tradeData.stopLoss || !tradeData.takeProfit) return 0;
    const risk = Math.abs(tradeData.entryPrice - tradeData.stopLoss);
    const reward = Math.abs(tradeData.takeProfit - tradeData.entryPrice);
    return risk > 0 ? reward / risk : 0;
  }

  private calculateTradeDuration(tradeData: TradeData): number {
    if (!tradeData.entryTime || !tradeData.exitTime) return 0;
    const entryTime = tradeData.entryTime.getTime();
    const exitTime = tradeData.exitTime.getTime();
    return Math.round((exitTime - entryTime) / 60000);
  }

  /**
   * Determine close reason
   * ✅ SSOT: Use centralized mapper for close reason conversion
   */
  private determineCloseReason(tradeData: TradeData): string {
    // Use provided close reason if available
    if (tradeData.closeReason) {
      // Map CloseReason type to analysis string using centralized mapper
      return mapCloseReasonToAnalysis(tradeData.closeReason as CloseReason);
    }

    // Fallback to price-based detection
    if (this.didHitTargetProfit(tradeData)) return 'tp_hit';
    if (this.didHitStopLoss(tradeData)) return 'sl_hit';
    return 'manual_close';
  }

  /**
   * Get confidence bucket
   */
  private getConfidenceBucket(confidence: number): number {
    if (confidence >= 95) return 95;
    if (confidence >= 90) return 90;
    if (confidence >= 85) return 85;
    if (confidence >= 80) return 80;
    if (confidence >= 75) return 75;
    return 70;
  }

  /**
   * Update alpha_strategy_memory after a live trade closes.
   *
   * SSOT: This is the single authoritative update path for strategy performance
   * ratings in live trading. The RPC resolve_strategy_for_trade finds the active
   * strategy by session_id + symbol and atomically increments all counters.
   *
   * Called only for learning-eligible trades (system closures excluded upstream).
   */
  private async updateStrategyMemory(
    tradeData: TradeData,
    outcome: 'win' | 'loss' | 'breakeven',
    lessonLearned?: string,
    whatWorked?: string,
    mistakeIdentified?: string
  ): Promise<void> {
    if (!tradeData.sessionId) {
      logger.debug('[Post-Trade Analyzer] Skipping strategy memory update — no sessionId', { tradeId: tradeData.id });
      return;
    }

    try {
      const holdMinutes = tradeData.entryTime && tradeData.exitTime
        ? Math.round((tradeData.exitTime.getTime() - tradeData.entryTime.getTime()) / 60000)
        : 0;

      const { data: strategyId, error } = await supabase.rpc('resolve_strategy_for_trade', {
        p_user_id:      tradeData.userId,
        p_session_id:   tradeData.sessionId,
        p_symbol:       tradeData.symbol,
        p_outcome:      outcome,
        p_pnl:          tradeData.pnl,
        p_hold_minutes: holdMinutes,
        p_what_worked:  outcome === 'win' ? (whatWorked ?? null) : null,
        p_what_failed:  outcome !== 'win' ? (mistakeIdentified ?? null) : null,
        p_key_lesson:   lessonLearned ?? null,
      });

      if (error) {
        logger.error('[Post-Trade Analyzer] Strategy memory update RPC failed', { error, tradeId: tradeData.id });
        return;
      }

      if (strategyId) {
        logger.info('[Post-Trade Analyzer] Strategy memory updated', {
          strategyId,
          outcome,
          symbol: tradeData.symbol,
          pnl: tradeData.pnl,
        });

        // After updating strategy memory, check if any playbook variants should be promoted.
        // This is intentionally fire-and-forget — a promotion failure must not block trade closure.
        this.triggerPlaybookPromotion(tradeData, strategyId).catch((err) => {
          logger.warn('[Post-Trade Analyzer] Playbook promotion check failed (non-blocking)', { err });
        });
      } else {
        logger.debug('[Post-Trade Analyzer] No active strategy found for session — memory update skipped', {
          sessionId: tradeData.sessionId,
          symbol: tradeData.symbol,
        });
      }
    } catch (error) {
      logger.error('[Post-Trade Analyzer] Exception updating strategy memory', { error });
    }
  }

  /**
   * Trigger playbook promotion evaluation after a strategy has been updated.
   *
   * Looks up the updated strategy's regime bucket and mode, then asks the
   * StrategyPlaybookManager to evaluate whether a better variant should be promoted.
   * This is the SSOT for playbook promotion — previously it was only called in
   * backtesting (event-based-llm-engine.ts) but never in the live pipeline.
   */
  private async triggerPlaybookPromotion(tradeData: TradeData, strategyId: string): Promise<void> {
    const { data: strategy } = await supabase
      .from('alpha_strategy_memory')
      .select('strategy_mode, timeframe, market_regime')
      .eq('id', strategyId)
      .maybeSingle();

    if (!strategy || !strategy.strategy_mode || !strategy.timeframe) return;

    const regimeBucket = getRegimeBucket({ structure: strategy.market_regime } as any, undefined);

    await strategyPlaybookManager.evaluateAndPromotePlaybooks(
      tradeData.userId,
      tradeData.symbol,
      strategy.timeframe,
      strategy.strategy_mode,
      regimeBucket
    );
  }

  /**
   * Determine trading session
   */
  private determineSession(date: Date): string {
    const hour = date.getUTCHours();
    if (hour >= 0 && hour < 8) return 'Tokyo';
    if (hour >= 8 && hour < 16) return 'London';
    if (hour >= 16 && hour < 24) return 'NewYork';
    return 'Unknown';
  }

  /**
   * Track TP outcome for Elite TP System learning.
   * Also writes tp_near_miss_log and tp1_only_log records when applicable.
   */
  private async trackTPOutcome(
    tradeData: TradeData,
    outcome: 'win' | 'loss' | 'breakeven',
    peakHitRatio: number | null,
    nearMissData: ReturnType<typeof getNearMissData>,
    tp1Only: boolean
  ): Promise<void> {
    try {
      if (!tradeData.entryPrice || !tradeData.exitPrice || !tradeData.stopLoss || !tradeData.takeProfit) {
        logger.debug('[Post-Trade Analyzer] Skipping TP tracking - missing price data');
        return;
      }

      let tpOutcome: 'hit' | 'stopped_out' | 'partial_hit' | 'manual_close' | 'timeout' | 'near_miss';
      let actualRR: number | undefined;

      const slDistance = Math.abs(tradeData.entryPrice - tradeData.stopLoss);
      const exitDistance = Math.abs(tradeData.exitPrice - tradeData.entryPrice);

      if (nearMissData) {
        tpOutcome = 'near_miss';
        actualRR = -(exitDistance / slDistance);
      } else if (outcome === 'win') {
        const tpDistance = Math.abs(tradeData.takeProfit - tradeData.entryPrice);
        const hitRatio = exitDistance / tpDistance;

        if (hitRatio >= 0.95) {
          tpOutcome = 'hit';
        } else if (hitRatio >= 0.5) {
          tpOutcome = 'partial_hit';
        } else {
          tpOutcome = 'manual_close';
        }

        actualRR = exitDistance / slDistance;
      } else if (outcome === 'loss') {
        tpOutcome = 'stopped_out';
        actualRR = -(exitDistance / slDistance);
      } else {
        tpOutcome = 'manual_close';
        actualRR = 0;
      }

      const timeToFillMinutes = tradeData.exitTime && tradeData.entryTime
        ? Math.round((tradeData.exitTime.getTime() - tradeData.entryTime.getTime()) / (1000 * 60))
        : 0;

      await tpQualityTracker.updateTPOutcome(
        tradeData.id,
        tpOutcome === 'near_miss' ? 'stopped_out' : tpOutcome,
        actualRR,
        timeToFillMinutes
      );

      // Write near-miss log record
      if (nearMissData && peakHitRatio != null) {
        const pipInfo = getCurrencyPipInfo(tradeData.symbol);
        const tpDistancePips = Math.abs(tradeData.takeProfit - tradeData.entryPrice) / pipInfo.pipValue;
        const slDistancePips = Math.abs(tradeData.entryPrice - tradeData.stopLoss) / pipInfo.pipValue;

        const bestPrice = tradeData.direction === 'buy'
          ? tradeData.entryPrice + (Math.abs(tradeData.takeProfit - tradeData.entryPrice) * peakHitRatio)
          : tradeData.entryPrice - (Math.abs(tradeData.takeProfit - tradeData.entryPrice) * peakHitRatio);

        await supabase.from('tp_near_miss_log').insert({
          user_id: tradeData.userId,
          trade_id: tradeData.id,
          symbol: tradeData.symbol,
          direction: tradeData.direction || 'buy',
          style: tradeData.tradeStyle ?? null,
          timeframe: tradeData.timeframe ?? null,
          entry_price: tradeData.entryPrice,
          stop_loss: tradeData.stopLoss,
          take_profit: tradeData.takeProfit,
          peak_price: bestPrice,
          peak_hit_ratio: peakHitRatio,
          tp_distance_pips: tpDistancePips,
          sl_distance_pips: slDistancePips,
          final_pnl: tradeData.pnl,
          close_reason: tradeData.closeReason ?? 'manual',
        });
      }

      // Write tp1_only log record
      if (tp1Only && tradeData.tp1Hit) {
        const { data: tradeRow } = await supabase
          .from('goal_session_trades')
          .select('tp1_price, tp2_price, tp1_pnl, max_profit_after_tp1')
          .eq('id', tradeData.id)
          .maybeSingle();

        if (tradeRow?.tp1_price) {
          const priceContPastTp1 = tradeRow.max_profit_after_tp1 != null && tradeRow.max_profit_after_tp1 > (tradeRow.tp1_pnl ?? 0);

          let reversalPips: number | null = null;
          if (tradeRow.max_profit_after_tp1 != null && tradeRow.tp1_pnl != null) {
            const pipInfo = getCurrencyPipInfo(tradeData.symbol);
            const slDist = Math.abs((tradeData.entryPrice ?? 0) - (tradeData.stopLoss ?? 0));
            const profitDiff = tradeRow.max_profit_after_tp1 - tradeData.pnl;
            if (slDist > 0) {
              reversalPips = (profitDiff / slDist) * (1 / pipInfo.pipValue) * slDist;
            }
          }

          await supabase.from('tp1_only_log').insert({
            user_id: tradeData.userId,
            trade_id: tradeData.id,
            symbol: tradeData.symbol,
            direction: tradeData.direction || 'buy',
            style: tradeData.tradeStyle ?? null,
            timeframe: tradeData.timeframe ?? null,
            tp1_price: tradeRow.tp1_price,
            tp2_price: tradeRow.tp2_price ?? null,
            tp1_pnl: tradeData.pnl,
            max_profit_after_tp1: tradeRow.max_profit_after_tp1 ?? null,
            price_continued_past_tp1: priceContPastTp1,
            reversal_after_tp1_pips: reversalPips,
            final_close_reason: tradeData.closeReason ?? 'manual',
          });
        }
      }

      logger.info('[Post-Trade Analyzer] TP outcome tracked', {
        tradeId: tradeData.id,
        tpOutcome,
        actualRR,
        peakHitRatio,
        nearMiss: !!nearMissData,
        tp1Only,
        timeToFillMinutes
      });
    } catch (error) {
      logger.error('[Post-Trade Analyzer] Failed to track TP outcome', { error });
    }
  }
}

export const postTradeAnalyzer = new PostTradeAnalyzer();
