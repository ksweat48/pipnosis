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
   */
  async logTradeEntry(entry: JournalEntry): Promise<string | null> {
    try {
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
          journal_entry_type: 'trade'
        })
        .select('id')
        .single();

      if (error) {
        console.error('[LLM Reasoning Logger] Error creating journal entry:', error);
        return null;
      }

      console.log(`[LLM Reasoning Logger] ✅ Trade journal entry created: ${data.id}`);
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
