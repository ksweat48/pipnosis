/**
 * Alpha Thought Stream Service
 *
 * SSOT for Alpha's real-time thought process emissions during market scanning.
 * Provides visibility into Alpha's decision-making steps, Omega Council votes,
 * and final trade selection reasoning.
 *
 * Architecture:
 * - Ephemeral storage: Thoughts clear when new scan starts
 * - Real-time streaming: Via Supabase subscriptions
 * - Rich metadata: Omega votes, confidence scores, rankings
 * - Debounced emissions: Prevents flooding (200ms min interval)
 *
 * Integration Points:
 * - goal-scanner.ts: Scan lifecycle events
 * - coordinator-alpha.ts: Omega Council votes and Alpha decisions
 * - best-symbol-selector.ts: Symbol comparison and ranking
 */

import { supabase } from '../lib/supabase';
import { getSupabaseAdmin, isAdminClientAvailable } from '../lib/supabase-admin';
import { logger, LogCategory } from '../lib/logger';
import type { OmegaVote } from '../brains/omega/trend';
import type { Omega8Vote } from '../types/omega';

export type ThoughtStepType =
  | 'scan_start'
  | 'filtering'
  | 'omega_voting'
  | 'comparing'
  | 'analyzing_entry'
  | 'alpha_loading_snapshot'
  | 'alpha_platform_intel'
  | 'alpha_narrative'
  | 'alpha_risk_check'
  | 'alpha_micro_regime'
  | 'alpha_liquidity_intent'
  | 'alpha_pattern_analysis'
  | 'alpha_stop_calculation'
  | 'alpha_feasibility'
  | 'alpha_constraints'
  | 'alpha_final_decision'
  | 'final_decision'
  | 'execution'
  | 'scan_complete';

export interface ThoughtMetadata {
  [key: string]: any;
}

export interface OmegaCouncilVotes {
  trend?: OmegaVote | null;
  scalper?: OmegaVote | null;
  confirmation?: OmegaVote | null;
  reversal?: OmegaVote | null;
  volatility?: OmegaVote | null;
  risk?: OmegaVote | null;
  omega8?: Omega8Vote | null;
}

export interface CandidateSummary {
  symbol: string;
  confidence: number;
  action: 'BUY' | 'SELL' | 'NO_TRADE';
  score?: number;
}

export interface ComparisonResult {
  candidates: CandidateSummary[];
  winner: string;
  winner_reason: string;
}

class AlphaThoughtStream {
  private static instance: AlphaThoughtStream;
  private lastEmissionTime: number = 0;
  private readonly MIN_EMISSION_INTERVAL_MS = 50; // Debounce: 50ms between thoughts (reduced for real-time feedback)
  private stepCounter: Map<string, number> = new Map(); // Track step numbers per session

  private constructor() {}

  static getInstance(): AlphaThoughtStream {
    if (!AlphaThoughtStream.instance) {
      AlphaThoughtStream.instance = new AlphaThoughtStream();
    }
    return AlphaThoughtStream.instance;
  }

  /**
   * Clear all thoughts for a session when new scan starts
   * Marks existing thoughts as inactive (ephemeral behavior)
   */
  async clearScanThoughts(sessionId: string): Promise<void> {
    try {
      // Prefer admin client if available (server-side), fall back to regular client (browser)
      const adminClient = getSupabaseAdmin();
      const client = adminClient || supabase;

      const { error } = await client.rpc('clear_scan_thoughts', {
        p_session_id: sessionId
      });

      if (error) {
        logger.error(LogCategory.AI_TRADING, '[AlphaThoughtStream] Failed to clear scan thoughts:', error);
        throw error;
      }

      // Reset step counter for this session
      this.stepCounter.set(sessionId, 0);

      logger.info(LogCategory.AI_TRADING, `[AlphaThoughtStream] ✅ Cleared thoughts for session ${sessionId}`);
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, '[AlphaThoughtStream] Error clearing scan thoughts:', error);
    }
  }

  /**
   * Core method to emit a thought step
   * Handles debouncing and step numbering automatically
   *
   * CRITICAL: Uses admin client to bypass RLS policies
   * This ensures thoughts are logged even if user session expires during scan
   */
  private async emitThought(
    sessionId: string,
    userId: string,
    stepType: ThoughtStepType,
    message: string,
    metadata: ThoughtMetadata = {}
  ): Promise<void> {
    try {
      // Debounce rapid emissions
      const now = Date.now();
      if (now - this.lastEmissionTime < this.MIN_EMISSION_INTERVAL_MS) {
        await new Promise(resolve => setTimeout(resolve, this.MIN_EMISSION_INTERVAL_MS));
      }
      this.lastEmissionTime = Date.now();

      // Increment step counter
      const currentStep = (this.stepCounter.get(sessionId) || 0) + 1;
      this.stepCounter.set(sessionId, currentStep);

      // Prefer admin client if available (server-side), fall back to regular client (browser)
      // With updated RLS policies, regular client works fine for user's own data
      const adminClient = getSupabaseAdmin();
      const client = adminClient || supabase;

      const { error } = await client
        .from('alpha_scan_thoughts')
        .insert({
          session_id: sessionId,
          user_id: userId,
          step_type: stepType,
          step_number: currentStep,
          message,
          metadata,
          is_active_scan: true
        });

      if (error) {
        logger.error(LogCategory.AI_TRADING, '[AlphaThoughtStream] ❌ Failed to emit thought:', error);
        throw error;
      }

      logger.info(LogCategory.AI_TRADING, `[AlphaThoughtStream] 💭 Step ${currentStep}: ${stepType} - ${message.substring(0, 60)}...`);
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, '[AlphaThoughtStream] ❌ Error emitting thought:', error);
      // Don't throw - allow trading to continue even if logging fails
    }
  }

  /**
   * Emit scan start thought
   * Example: "Scanning 6 currency pairs for high-probability setups..."
   */
  async emitScanStart(
    sessionId: string,
    userId: string,
    symbolCount: number,
    symbols: string[]
  ): Promise<void> {
    const message = `Scanning ${symbolCount} currency pair${symbolCount !== 1 ? 's' : ''} for high-probability setups...`;
    await this.emitThought(sessionId, userId, 'scan_start', message, {
      symbol_count: symbolCount,
      symbols
    });
  }

  /**
   * Emit filtering results thought
   * Example: "Found 3 quality setups worth analyzing (filtered from 6 total)..."
   */
  async emitFiltering(
    sessionId: string,
    userId: string,
    qualityCount: number,
    totalCount: number,
    qualitySymbols: string[]
  ): Promise<void> {
    if (qualityCount === 0) {
      const message = `Quality filter: No symbols met threshold (checked ${totalCount} pair${totalCount !== 1 ? 's' : ''})`;
      await this.emitThought(sessionId, userId, 'filtering', message, {
        quality_count: 0,
        total_count: totalCount,
        quality_symbols: []
      });
    } else {
      const message = `Found ${qualityCount} quality setup${qualityCount !== 1 ? 's' : ''} worth analyzing (filtered from ${totalCount} total)`;
      await this.emitThought(sessionId, userId, 'filtering', message, {
        quality_count: qualityCount,
        total_count: totalCount,
        quality_symbols: qualitySymbols
      });
    }
  }

  /**
   * Emit Omega Council voting thought
   * Example: "EURUSD Omega Council: Trend BUY 85%, Scalper BUY 90%, Risk HOLD 60% | Consensus: BUY"
   */
  async emitOmegaVoting(
    sessionId: string,
    userId: string,
    symbol: string,
    votes: OmegaCouncilVotes
  ): Promise<void> {
    // Build vote summary
    const votesSummary: string[] = [];
    let buyCount = 0;
    let sellCount = 0;
    let noTradeCount = 0;

    // Count votes and build summary
    const votesList = [
      { name: 'Trend', vote: votes.trend },
      { name: 'Scalper', vote: votes.scalper },
      { name: 'Confirmation', vote: votes.confirmation },
      { name: 'Reversal', vote: votes.reversal },
      { name: 'Volatility', vote: votes.volatility },
      { name: 'Risk', vote: votes.risk }
    ];

    votesList.forEach(({ name, vote }) => {
      if (!vote) return;

      const action = vote.action;
      const confidence = vote.confidence;

      votesSummary.push(`${name}: ${action} ${confidence}%`);

      if (action === 'BUY') buyCount++;
      else if (action === 'SELL') sellCount++;
      else if (action === 'NO_TRADE') noTradeCount++;
    });

    // Determine consensus
    let consensus = 'MIXED';
    let consensusStrength = '';

    if (buyCount > sellCount && buyCount > noTradeCount) {
      consensus = 'BUY';
      consensusStrength = buyCount >= 4 ? 'STRONG' : buyCount >= 3 ? 'MODERATE' : 'WEAK';
    } else if (sellCount > buyCount && sellCount > noTradeCount) {
      consensus = 'SELL';
      consensusStrength = sellCount >= 4 ? 'STRONG' : sellCount >= 3 ? 'MODERATE' : 'WEAK';
    } else if (noTradeCount > buyCount && noTradeCount > sellCount) {
      consensus = 'NO_TRADE';
    }

    const message = `${symbol} Omega Council: ${votesSummary.join(', ')} | Consensus: ${consensusStrength ? consensusStrength + ' ' : ''}${consensus}`;

    await this.emitThought(sessionId, userId, 'omega_voting', message, {
      symbol,
      votes: {
        trend: votes.trend,
        scalper: votes.scalper,
        confirmation: votes.confirmation,
        reversal: votes.reversal,
        volatility: votes.volatility,
        risk: votes.risk
      },
      vote_counts: {
        buy: buyCount,
        sell: sellCount,
        wait: 0,
        no_trade: noTradeCount
      },
      consensus,
      consensus_strength: consensusStrength
    });
  }

  /**
   * Emit symbol comparison thought
   * Example: "Comparing 2 opportunities: EURUSD (85 pts), GBPUSD (72 pts)"
   */
  async emitComparing(
    sessionId: string,
    userId: string,
    candidates: CandidateSummary[]
  ): Promise<void> {
    const candidateList = candidates
      .map(c => `${c.symbol} (${c.score?.toFixed(0) || c.confidence}%)`)
      .join(', ');

    const message = `Comparing ${candidates.length} opportunit${candidates.length !== 1 ? 'ies' : 'y'}: ${candidateList}`;

    await this.emitThought(sessionId, userId, 'comparing', message, {
      candidate_count: candidates.length,
      candidates: candidates.map(c => ({
        symbol: c.symbol,
        confidence: c.confidence,
        action: c.action,
        score: c.score
      }))
    });
  }

  /**
   * Emit analyzing entry thought
   * Example: "Analyzing EURUSD entry quality and risk/reward..."
   */
  async emitAnalyzingEntry(
    sessionId: string,
    userId: string,
    symbol: string,
    confidence: number
  ): Promise<void> {
    const message = `Analyzing ${symbol} entry quality and risk/reward (${confidence}% confidence)...`;

    await this.emitThought(sessionId, userId, 'analyzing_entry', message, {
      symbol,
      confidence
    });
  }

  /**
   * Emit condition evaluation transparency thought
   * Shows why conditions aren't met and what's needed
   */
  async emitConditionEvaluation(
    sessionId: string,
    userId: string,
    symbol: string,
    alphaThoughts: string,
    conditionsMet: number,
    conditionsTotal: number
  ): Promise<void> {
    const message = `${symbol}: ${conditionsMet}/${conditionsTotal} conditions met\n${alphaThoughts}`;

    await this.emitThought(sessionId, userId, 'analyzing_entry', message, {
      symbol,
      conditions_met: conditionsMet,
      conditions_total: conditionsTotal,
      thoughts: alphaThoughts
    });
  }

  /**
   * Emit per-symbol reasoning during the comparison phase.
   * Reuses the 'comparing' step type (already in DB constraint) to surface
   * each candidate's individual Alpha reasoning before the final decision.
   * Called once per evaluated symbol. SSOT: uses existing comparing step type.
   */
  async emitSymbolReasoning(
    sessionId: string,
    userId: string,
    symbol: string,
    action: string,
    confidence: number,
    reasoning: string
  ): Promise<void> {
    const actionLabel = action === 'BUY' ? 'BUY' : action === 'SELL' ? 'SELL' : 'NO_TRADE';
    const message = `${symbol} [${actionLabel} ${confidence}%]: ${reasoning}`;
    await this.emitThought(sessionId, userId, 'comparing', message, {
      symbol,
      action: actionLabel,
      confidence,
      reasoning,
      per_symbol: true
    });
  }

  /**
   * Emit final decision thought
   * Example: "EURUSD selected - highest confidence entry at 1.12345"
   */
  async emitFinalDecision(
    sessionId: string,
    userId: string,
    result: {
      selected: boolean;
      symbol: string | null;
      action?: 'BUY' | 'SELL' | 'WAIT' | 'NO_TRADE';
      confidence?: number;
      entry?: number;
      reasoning: string;
    }
  ): Promise<void> {
    let message: string;

    if (!result.selected || !result.symbol) {
      message = `No quality setups found - ${result.reasoning}`;
    } else {
      const actionIcon = result.action === 'BUY' ? '📈' : result.action === 'SELL' ? '📉' : '';
      message = `${actionIcon} ${result.symbol} selected - ${result.reasoning}`;
    }

    await this.emitThought(sessionId, userId, 'final_decision', message, {
      selected: result.selected,
      symbol: result.symbol,
      action: result.action,
      confidence: result.confidence,
      entry: result.entry,
      reasoning: result.reasoning
    });
  }

  /**
   * Emit execution thought
   * Example: "Executing SELL EURUSD at 1.12345..."
   */
  async emitExecution(
    sessionId: string,
    userId: string,
    symbol: string,
    action: 'BUY' | 'SELL',
    entry: number
  ): Promise<void> {
    const message = `Executing ${action} ${symbol} at ${entry.toFixed(5)}...`;

    await this.emitThought(sessionId, userId, 'execution', message, {
      symbol,
      action,
      entry
    });
  }

  /**
   * Emit scan complete thought
   * Example: "Scan complete - 1 trade executed" or "Scan complete - monitoring 2 setups"
   */
  async emitScanComplete(
    sessionId: string,
    userId: string,
    result: {
      tradeExecuted: boolean;
      tradesFound: number;
      monitoringCount: number;
      scanDurationMs: number;
    }
  ): Promise<void> {
    let message: string;

    if (result.tradeExecuted) {
      message = `Scan complete - trade executed (${result.scanDurationMs}ms)`;
    } else if (result.monitoringCount > 0) {
      message = `Scan complete - monitoring ${result.monitoringCount} setup${result.monitoringCount !== 1 ? 's' : ''} (${result.scanDurationMs}ms)`;
    } else {
      message = `Scan complete - no quality setups found (${result.scanDurationMs}ms)`;
    }

    await this.emitThought(sessionId, userId, 'scan_complete', message, {
      trade_executed: result.tradeExecuted,
      trades_found: result.tradesFound,
      monitoring_count: result.monitoringCount,
      scan_duration_ms: result.scanDurationMs
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // ALPHA COORDINATOR PROGRESS THOUGHTS (Granular feedback during 6s decision)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Emit Alpha loading snapshot thought
   */
  async emitAlphaLoadingSnapshot(
    sessionId: string,
    userId: string,
    symbol: string
  ): Promise<void> {
    const message = `Loading intelligence snapshot for ${symbol}...`;
    await this.emitThought(sessionId, userId, 'alpha_loading_snapshot', message, { symbol });
  }

  /**
   * Emit Alpha platform intelligence thought
   */
  async emitAlphaPlatformIntel(
    sessionId: string,
    userId: string,
    symbol: string
  ): Promise<void> {
    const message = `Fetching platform-wide intelligence for ${symbol}...`;
    await this.emitThought(sessionId, userId, 'alpha_platform_intel', message, { symbol });
  }

  /**
   * Emit Alpha narrative building thought
   */
  async emitAlphaNarrative(
    sessionId: string,
    userId: string,
    symbol: string
  ): Promise<void> {
    const message = `Building daily narrative and institutional context for ${symbol}...`;
    await this.emitThought(sessionId, userId, 'alpha_narrative', message, { symbol });
  }

  /**
   * Emit Alpha risk assessment thought
   */
  async emitAlphaRiskCheck(
    sessionId: string,
    userId: string,
    symbol: string
  ): Promise<void> {
    const message = `Evaluating professional risk assessment for ${symbol}...`;
    await this.emitThought(sessionId, userId, 'alpha_risk_check', message, { symbol });
  }

  /**
   * Emit Alpha micro-regime classification thought
   */
  async emitAlphaMicroRegime(
    sessionId: string,
    userId: string,
    symbol: string
  ): Promise<void> {
    const message = `Classifying micro-regime and behavioral patterns for ${symbol}...`;
    await this.emitThought(sessionId, userId, 'alpha_micro_regime', message, { symbol });
  }

  /**
   * Emit Alpha liquidity intent thought
   */
  async emitAlphaLiquidityIntent(
    sessionId: string,
    userId: string,
    symbol: string
  ): Promise<void> {
    const message = `Analyzing liquidity intent and predator positioning for ${symbol}...`;
    await this.emitThought(sessionId, userId, 'alpha_liquidity_intent', message, { symbol });
  }

  /**
   * Emit Alpha pattern analysis thought
   */
  async emitAlphaPatternAnalysis(
    sessionId: string,
    userId: string,
    symbol: string
  ): Promise<void> {
    const message = `Analyzing multi-timeframe patterns for ${symbol}...`;
    await this.emitThought(sessionId, userId, 'alpha_pattern_analysis', message, { symbol });
  }

  /**
   * Emit Alpha stop-loss calculation thought
   */
  async emitAlphaStopCalculation(
    sessionId: string,
    userId: string,
    symbol: string
  ): Promise<void> {
    const message = `Calculating professional stop-loss anchor for ${symbol}...`;
    await this.emitThought(sessionId, userId, 'alpha_stop_calculation', message, { symbol });
  }

  /**
   * Emit Alpha feasibility check thought
   */
  async emitAlphaFeasibility(
    sessionId: string,
    userId: string,
    symbol: string
  ): Promise<void> {
    const message = `Checking trade feasibility and market conditions for ${symbol}...`;
    await this.emitThought(sessionId, userId, 'alpha_feasibility', message, { symbol });
  }

  /**
   * Emit Alpha constraints generation thought
   */
  async emitAlphaConstraints(
    sessionId: string,
    userId: string,
    symbol: string
  ): Promise<void> {
    const message = `Generating execution constraints and risk parameters for ${symbol}...`;
    await this.emitThought(sessionId, userId, 'alpha_constraints', message, { symbol });
  }

  /**
   * Emit Alpha final decision thought (BEFORE LLM call)
   */
  async emitAlphaFinalDecision(
    sessionId: string,
    userId: string,
    symbol: string
  ): Promise<void> {
    const message = `Alpha making final decision on ${symbol}...`;
    await this.emitThought(sessionId, userId, 'alpha_final_decision', message, { symbol });
  }
}

export const alphaThoughtStream = AlphaThoughtStream.getInstance();
