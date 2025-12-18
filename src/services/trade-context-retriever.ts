/**
 * Trade Context Retriever
 *
 * Fetches comprehensive context about a trade including:
 * - Original entry reasoning and AI analysis
 * - Journal entries with market read and expected outcomes
 * - Setup pattern and confirmations
 * - Expected trade duration and targets
 *
 * This context is CRITICAL for wellness checks - Alpha needs to know
 * the ORIGINAL THESIS to evaluate if the trade is still on track
 */

import { supabase } from '../lib/supabase';

export interface TradeContext {
  // Basic trade info
  tradeId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  entryTime: Date;

  // Original AI reasoning
  originalReasoning: string;
  setupPattern: string;
  confidence: number;
  strategyUsed: string;

  // Journal entry context (if available)
  marketRead?: string;
  expectedOutcome?: string;
  patternIdentified?: string;
  convictionLevel?: number;

  // Technical context
  regimeBucket?: string;
  playbookId?: string;
  riskDollars?: number;

  // Derived insights
  minutesInTrade: number;
  expectedDurationMinutes?: number;
}

class TradeContextRetriever {
  /**
   * Get comprehensive context for a trade
   */
  async getTradeContext(tradeId: string): Promise<TradeContext | null> {
    try {
      // Fetch trade data with AI reasoning
      const { data: trade, error: tradeError } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('id', tradeId)
        .maybeSingle();

      if (tradeError || !trade) {
        console.error('[TradeContext] Failed to fetch trade:', tradeError);
        return null;
      }

      // Fetch journal entry for detailed context
      const { data: journalEntry, error: journalError } = await supabase
        .from('ai_trade_journal')
        .select('*')
        .eq('trade_id', tradeId)
        .maybeSingle();

      if (journalError) {
        console.warn('[TradeContext] Failed to fetch journal entry:', journalError);
      }

      // Calculate time in trade
      const entryTime = new Date(trade.opened_at || trade.created_at);
      const now = new Date();
      const minutesInTrade = (now.getTime() - entryTime.getTime()) / 1000 / 60;

      // Build comprehensive context
      const context: TradeContext = {
        tradeId: trade.id,
        symbol: trade.symbol,
        direction: trade.direction,
        entryPrice: trade.entry_price,
        stopLoss: trade.stop_loss,
        takeProfit: trade.take_profit,
        entryTime,

        // AI reasoning from trade record
        originalReasoning: trade.ai_reasoning || 'No reasoning recorded',
        setupPattern: trade.ai_strategy_used || 'Unknown setup',
        confidence: trade.ai_confidence || 0,
        strategyUsed: trade.ai_strategy_used || 'Unknown',

        // Journal context (if available)
        marketRead: journalEntry?.market_read,
        expectedOutcome: journalEntry?.expected_outcome,
        patternIdentified: journalEntry?.pattern_identified,
        convictionLevel: journalEntry?.conviction_level,

        // Technical context
        regimeBucket: trade.regime_bucket,
        playbookId: trade.playbook_id,
        riskDollars: trade.risk_dollars,

        // Derived
        minutesInTrade: Math.floor(minutesInTrade)
      };

      console.log(`[TradeContext] Retrieved context for ${trade.symbol}: ${context.setupPattern} (${context.confidence}% confidence)`);

      return context;
    } catch (error) {
      console.error('[TradeContext] Error retrieving trade context:', error);
      return null;
    }
  }

  /**
   * Build a concise summary of the original thesis
   */
  buildThesisSummary(context: TradeContext): string {
    const parts: string[] = [];

    // Setup pattern
    if (context.setupPattern !== 'Unknown setup') {
      parts.push(`Setup: ${context.setupPattern}`);
    }

    // Pattern identified
    if (context.patternIdentified && context.patternIdentified !== context.setupPattern) {
      parts.push(`Pattern: ${context.patternIdentified}`);
    }

    // Confidence
    parts.push(`${context.confidence}% confidence`);

    // Regime
    if (context.regimeBucket) {
      parts.push(`Regime: ${context.regimeBucket}`);
    }

    return parts.join(' | ');
  }

  /**
   * Extract key price levels being watched from original reasoning
   */
  extractWatchedLevels(context: TradeContext): { support: number[]; resistance: number[] } {
    const support: number[] = [];
    const resistance: number[] = [];

    // For now, use SL and TP as key levels
    // In future, could parse reasoning text for specific levels
    if (context.direction === 'buy') {
      support.push(context.stopLoss);
      resistance.push(context.takeProfit);
    } else {
      resistance.push(context.stopLoss);
      support.push(context.takeProfit);
    }

    return { support, resistance };
  }
}

export const tradeContextRetriever = new TradeContextRetriever();
