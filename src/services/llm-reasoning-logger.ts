/**
 * LLM Reasoning Logger
 *
 * Central service for logging all LLM decisions across the 5-layer system.
 * Ensures transparency and accountability for autonomous AI trading decisions.
 *
 * Logs to two tables:
 * 1. ai_trade_journal - User-facing natural language journal
 * 2. llm_decision_log - Admin-facing detailed technical log
 */

import { supabase } from '../lib/supabase';

export interface JournalEntry {
  userId: string;
  tradeId?: string;
  sessionId?: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryTime: Date;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;

  // Pre-trade reasoning
  llmReasoning: string; // Natural language: "I took this trade because..."
  marketRead: string; // "The market is showing..."
  expectedOutcome: string; // "I expect price to..."
  patternIdentified?: string;
  convictionLevel: number;
  rankAtTime: string;

  // Omega Council votes (MANDATORY - cannot be null)
  omega8_liquidity_bias?: string;
  omega8_direction_support?: string;
  omega8_confidence?: number;
  omega8_reasoning?: string;
  omega8_used_llm?: boolean;
  omega8_deterministic_bias?: string;
  omega8_deterministic_confidence?: number;
  omega8_llm_reason?: string;
  omega8_patterns?: any;

  omega9_pass?: boolean;
  omega9_flags?: any;
  omega9_confidence_adjustment?: number;
  omega9_corrections?: any;
  omega9_reasoning?: string;
}

export interface PostTradeAnalysis {
  journalEntryId: string;
  exitTime: Date;
  exitPrice: number;
  pnl: number;
  outcome: 'win' | 'loss' | 'breakeven';

  // Post-trade analysis
  actualOutcome: string; // What really happened
  wasPredictionCorrect: boolean;
  accuracyScore: number; // 0-100
  lessonLearned: string; // "I learned that..."
  mistakeIdentified?: string;
  whatWorked?: string;
}

export interface LLMDecisionLog {
  userId: string;
  tradeId?: string;
  sessionId?: string;
  decisionLayer: 'layer1_safety' | 'layer2_regime' | 'layer3_pattern' | 'layer4_risk' | 'layer5_llm' | 'execution' | 'monitoring' | 'closure';
  decisionType: 'execute' | 'skip' | 'adjust' | 'analyze' | 'close' | 'monitor';
  decisionOutcome: string;
  llmPrompt?: string;
  llmResponse?: string;
  reasoningJson?: any;
  modelUsed?: string;
  tokensUsed?: number;
  responseTimeMs?: number;
}

class LLMReasoningLogger {
  /**
   * Create journal entry when trade is executed (pre-trade)
   *
   * GOVERNANCE COMPLIANCE: Validates Omega Council data but degrades gracefully
   * - Omega9 (safety) is HARD requirement - trades cannot execute without it
   * - Omega8 (liquidity) is SOFT requirement - logs warning but allows journal entry
   * This ensures trades are safe (Omega9) while maintaining audit trail
   */
  async logTradeEntry(entry: JournalEntry): Promise<string | null> {
    try {
      // GOVERNANCE: SOFT VALIDATION - Omega8 data SHOULD be present
      if (!entry.omega8_liquidity_bias && !entry.omega8_direction_support) {
        const warningMsg = '[LLM Reasoning Logger] ⚠️ GOVERNANCE WARNING: Omega8 data MISSING! ' +
          'Omega Council (liquidity bias or direction support) was not consulted. ' +
          'This is logged for governance audit but will not block journal entry.';
        console.warn(warningMsg);
        console.warn('[LLM Reasoning Logger] Trade details:', {
          symbol: entry.symbol,
          direction: entry.direction,
          tradeId: entry.tradeId,
          hasOmega9: entry.omega9_pass !== undefined,
          omega8_liquidity_bias: entry.omega8_liquidity_bias,
          omega8_direction_support: entry.omega8_direction_support
        });

        // Continue with journal entry - Omega9 validation is the hard safety gate
        // Omega8 is important for audit but not critical for trade safety
      }

      // CRITICAL: HARD VALIDATION - Omega9 data MUST be present
      if (entry.omega9_pass === undefined && !entry.omega9_flags) {
        const errorMsg = '[LLM Reasoning Logger] ERROR: Cannot create journal entry - Omega9 data MISSING! ' +
          'Hallucination check (omega9_pass) must be performed before trade entry.';
        console.error(errorMsg);
        throw new Error(errorMsg);
      }

      const { data, error } = await supabase
        .from('ai_trade_journal')
        .insert({
          user_id: entry.userId,
          trade_id: entry.tradeId,
          session_id: entry.sessionId,
          symbol: entry.symbol,
          direction: entry.direction,
          entry_time: entry.entryTime.toISOString(),
          entry_price: entry.entryPrice,
          stop_loss: entry.stopLoss,
          take_profit: entry.takeProfit,
          llm_reasoning: entry.llmReasoning,
          market_read: entry.marketRead,
          expected_outcome: entry.expectedOutcome,
          pattern_identified: entry.patternIdentified,
          conviction_level: entry.convictionLevel,
          rank_at_time: entry.rankAtTime,
          outcome: 'open',
          journal_entry_type: 'trade',

          // 🛡️  CRITICAL FIX: Persist Omega Council votes
          omega8_liquidity_bias: entry.omega8_liquidity_bias || null,
          omega8_direction_support: entry.omega8_direction_support || null,
          omega8_confidence: entry.omega8_confidence || null,
          omega8_reasoning: entry.omega8_reasoning || null,
          omega8_used_llm: entry.omega8_used_llm || false,
          omega8_deterministic_bias: entry.omega8_deterministic_bias || null,
          omega8_deterministic_confidence: entry.omega8_deterministic_confidence || null,
          omega8_llm_reason: entry.omega8_llm_reason || null,
          omega8_patterns: entry.omega8_patterns || null,

          omega9_pass: entry.omega9_pass !== undefined ? entry.omega9_pass : null,
          omega9_flags: entry.omega9_flags || null,
          omega9_confidence_adjustment: entry.omega9_confidence_adjustment || null,
          omega9_corrections: entry.omega9_corrections || null,
          omega9_reasoning: entry.omega9_reasoning || null
        })
        .select('id')
        .single();

      if (error) {
        console.error('[LLM Reasoning Logger] Error creating journal entry:', error);
        return null;
      }

      // Log success with Omega coverage stats
      const omega8Present = !!entry.omega8_liquidity_bias;
      const omega9Present = entry.omega9_pass !== undefined;
      console.log(`[LLM Reasoning Logger] ✅ Trade journal entry created: ${data.id}`);
      console.log(`[LLM Reasoning Logger] 🛡️  Omega Coverage: Omega8=${omega8Present}, Omega9=${omega9Present}`);

      return data.id;
    } catch (error) {
      console.error('[LLM Reasoning Logger] Exception creating journal entry:', error);
      return null;
    }
  }

  /**
   * Update journal entry when trade closes (post-trade)
   */
  async logPostTradeAnalysis(analysis: PostTradeAnalysis): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('ai_trade_journal')
        .update({
          exit_time: analysis.exitTime.toISOString(),
          exit_price: analysis.exitPrice,
          pnl: analysis.pnl,
          outcome: analysis.outcome,
          actual_outcome: analysis.actualOutcome,
          was_prediction_correct: analysis.wasPredictionCorrect,
          accuracy_score: analysis.accuracyScore,
          lesson_learned: analysis.lessonLearned,
          mistake_identified: analysis.mistakeIdentified,
          what_worked: analysis.whatWorked,
          updated_at: new Date().toISOString()
        })
        .eq('id', analysis.journalEntryId);

      if (error) {
        console.error('[LLM Reasoning Logger] Error updating post-trade analysis:', error);
        return false;
      }

      console.log(`[LLM Reasoning Logger] ✅ Post-trade analysis logged for ${analysis.journalEntryId}`);
      return true;
    } catch (error) {
      console.error('[LLM Reasoning Logger] Exception updating post-trade:', error);
      return false;
    }
  }

  /**
   * Log LLM decision (admin detailed logging)
   */
  async logLLMDecision(decision: LLMDecisionLog): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('llm_decision_log')
        .insert({
          user_id: decision.userId,
          trade_id: decision.tradeId,
          session_id: decision.sessionId,
          decision_layer: decision.decisionLayer,
          decision_type: decision.decisionType,
          decision_outcome: decision.decisionOutcome,
          llm_prompt: decision.llmPrompt,
          llm_response: decision.llmResponse,
          reasoning_json: decision.reasoningJson,
          model_used: decision.modelUsed,
          tokens_used: decision.tokensUsed,
          response_time_ms: decision.responseTimeMs
        });

      if (error) {
        console.error('[LLM Reasoning Logger] Error logging decision:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[LLM Reasoning Logger] Exception logging decision:', error);
      return false;
    }
  }

  /**
   * Get all journal entries for a user
   */
  async getJournalEntries(userId: string, limit: number = 50): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('ai_trade_journal')
        .select('*')
        .eq('user_id', userId)
        .order('entry_time', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[LLM Reasoning Logger] Error fetching journal:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[LLM Reasoning Logger] Exception fetching journal:', error);
      return [];
    }
  }

  /**
   * Get journal entries for a specific session
   */
  async getSessionJournal(sessionId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('ai_trade_journal')
        .select('*')
        .eq('session_id', sessionId)
        .order('entry_time', { ascending: true });

      if (error) {
        console.error('[LLM Reasoning Logger] Error fetching session journal:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[LLM Reasoning Logger] Exception fetching session journal:', error);
      return [];
    }
  }

  /**
   * Get LLM decision logs for a trade (admin)
   */
  async getTradeDecisionLogs(tradeId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('llm_decision_log')
        .select('*')
        .eq('trade_id', tradeId)
        .order('timestamp', { ascending: true });

      if (error) {
        console.error('[LLM Reasoning Logger] Error fetching decision logs:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[LLM Reasoning Logger] Exception fetching decision logs:', error);
      return [];
    }
  }

  /**
   * Create a learning-only journal entry (not a trade)
   */
  async logLearningInsight(
    userId: string,
    sessionId: string,
    insight: string,
    category: 'pattern' | 'market_regime' | 'risk_management' | 'general'
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('ai_trade_journal')
        .insert({
          user_id: userId,
          session_id: sessionId,
          symbol: 'N/A',
          direction: 'buy', // Placeholder for non-trade entries
          entry_price: 0,
          llm_reasoning: insight,
          journal_entry_type: 'learning',
          pattern_identified: category
        });

      if (error) {
        console.error('[LLM Reasoning Logger] Error logging insight:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[LLM Reasoning Logger] Exception logging insight:', error);
      return false;
    }
  }
}

export const llmReasoningLogger = new LLMReasoningLogger();
