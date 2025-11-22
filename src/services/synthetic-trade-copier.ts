import { supabase } from '../lib/supabase';

/**
 * Synthetic Trade Copier
 *
 * Copies trades from synthetic_backtest_trades to trade_history
 * to enable Progressive Daily Learning analysis and AI Learning Center data.
 */

class SyntheticTradeCopier {
  /**
   * Copy all trades from a synthetic backtest session to trade_history
   */
  async copySyntheticTradesToHistory(sessionId: string, userId: string): Promise<number> {
    console.log(`[Trade Copier] 📋 Copying synthetic trades to history for session ${sessionId.substring(0, 8)}...`);

    try {
      const { data: syntheticTrades, error: fetchError } = await supabase
        .from('synthetic_backtest_trades')
        .select('*')
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .order('entry_time', { ascending: true });

      if (fetchError) {
        console.error('[Trade Copier] Error fetching synthetic trades:', fetchError);
        return 0;
      }

      if (!syntheticTrades || syntheticTrades.length === 0) {
        console.log('[Trade Copier] No synthetic trades found for session');
        return 0;
      }

      console.log(`[Trade Copier] Found ${syntheticTrades.length} synthetic trades to copy`);

      const tradesToInsert = syntheticTrades.map(trade => ({
        user_id: userId,
        position_id: trade.id,
        symbol: trade.symbol,
        position_type: trade.direction?.toLowerCase() || 'buy',
        lot_size: trade.position_size || 0.01,
        entry_price: trade.entry_price,
        exit_price: trade.exit_price,
        stop_loss: trade.stop_loss,
        take_profit: trade.take_profit,
        profit_loss: trade.pnl || 0,
        opened_at: trade.entry_time,
        closed_at: trade.exit_time || trade.entry_time,
        close_reason: trade.exit_reason || trade.outcome,
        strategy_name: 'Flow Trader v2 (Synthetic)',
        notes: this.buildTradeNotes(trade),
        confidence_score: trade.flow_v2_confidence || trade.ai_conviction || 50,
        setup_type: trade.setup_type || 'synthetic_backtest',
        market_conditions: trade.market_regime || {},
        ai_decision_id: null,
        ai_analyzed: false,
        ai_validated: false
      }));

      const { data: insertedTrades, error: insertError } = await supabase
        .from('trade_history')
        .insert(tradesToInsert)
        .select();

      if (insertError) {
        console.error('[Trade Copier] Error inserting trades into history:', insertError);
        return 0;
      }

      console.log(`[Trade Copier] ✅ Successfully copied ${insertedTrades?.length || 0} trades to history`);
      return insertedTrades?.length || 0;

    } catch (error) {
      console.error('[Trade Copier] Unexpected error copying trades:', error);
      return 0;
    }
  }

  /**
   * Build detailed notes for trade history
   */
  private buildTradeNotes(trade: any): string {
    const notes: string[] = [];

    notes.push('=== SYNTHETIC BACKTEST TRADE ===');
    notes.push(`Trade #${trade.trade_number}`);
    notes.push(`Session: ${trade.session_id.substring(0, 8)}`);

    if (trade.ai_reasoning_used) {
      notes.push('');
      notes.push('AI ANALYSIS:');
      if (trade.ai_rationale) {
        notes.push(`Rationale: ${trade.ai_rationale}`);
      }
      if (trade.ai_risk_assessment) {
        notes.push(`Risk: ${trade.ai_risk_assessment}`);
      }
      notes.push(`Conviction: ${trade.ai_conviction || 'N/A'}/100`);
    }

    notes.push('');
    notes.push('SETUP:');
    notes.push(`Type: ${trade.setup_type || 'N/A'}`);
    if (trade.h1_bias) {
      notes.push(`H1 Bias: ${trade.h1_bias}`);
    }
    notes.push(`M5 Filter: ${trade.m5_filter_passed ? 'PASS' : 'FAIL'}`);
    notes.push(`M1 Ready: ${trade.m1_execution_ready ? 'YES' : 'NO'}`);

    notes.push('');
    notes.push('RESULTS:');
    notes.push(`Outcome: ${trade.outcome || 'Unknown'}`);
    notes.push(`P&L: $${(trade.pnl || 0).toFixed(2)}`);
    notes.push(`Pips: ${(trade.pips_gained || 0).toFixed(1)}`);
    notes.push(`Duration: ${trade.holding_duration_minutes || 0} mins`);
    notes.push(`Quality Score: ${trade.quality_score || 0}/100`);

    if (trade.execution_reason) {
      notes.push('');
      notes.push(`Execution Reason: ${trade.execution_reason}`);
    }

    return notes.join('\n');
  }

  /**
   * Delete all synthetic trades from trade_history for a user
   * (useful for cleanup/reset)
   */
  async clearSyntheticTradesFromHistory(userId: string): Promise<number> {
    console.log('[Trade Copier] 🗑️ Clearing synthetic trades from history...');

    const { data: deletedTrades, error } = await supabase
      .from('trade_history')
      .delete()
      .eq('user_id', userId)
      .ilike('strategy_name', '%synthetic%')
      .select();

    if (error) {
      console.error('[Trade Copier] Error clearing synthetic trades:', error);
      return 0;
    }

    const count = deletedTrades?.length || 0;
    console.log(`[Trade Copier] ✅ Cleared ${count} synthetic trades from history`);
    return count;
  }

  /**
   * Get count of trades in trade_history for a session
   */
  async getTradeHistoryCount(userId: string, date?: Date): Promise<number> {
    const targetDate = date || new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const { count, error } = await supabase
      .from('trade_history')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('closed_at', startOfDay.toISOString())
      .lte('closed_at', endOfDay.toISOString());

    if (error) {
      console.error('[Trade Copier] Error counting trades:', error);
      return 0;
    }

    return count || 0;
  }
}

export const syntheticTradeCopier = new SyntheticTradeCopier();
