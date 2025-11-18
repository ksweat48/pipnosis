/**
 * LLM Evaluation Backtest Service
 *
 * Event-based backtesting system that measures LLM trading skill
 * Flow V2 detects setups locally, LLM evaluates only high-probability triggers
 * Runs entirely in local memory, writes single summary to Supabase at end
 */

import { supabase } from '../lib/supabase';
import { eventBasedLLMEngine, EventBasedEngineConfig, SimulatedTrade } from './event-based-llm-engine';
import { localSessionMemory, SessionSummary } from './local-session-memory';
import { aiSkillTracker } from './ai-skill-tracker';

export interface LLMBacktestConfig {
  sessionName: string;
  description?: string;
  symbol: string;
  startDate: Date;
  endDate: Date;
  timeframe: string;
  useLLM: boolean;
  riskMode: 'low' | 'medium' | 'high';
  maxConcurrentTrades: number;
  initialBalance: number;
}

export interface BacktestProgress {
  phase: 'loading' | 'processing' | 'analyzing' | 'complete';
  message: string;
  percentComplete: number;
  candlesProcessed: number;
  totalCandles: number;
  triggersDetected: number;
  llmCallsMade: number;
  tradesExecuted: number;
  currentBalance: number;
}

class LLMEvaluationBacktest {
  /**
   * Run complete LLM evaluation backtest
   */
  async runBacktest(
    userId: string,
    config: LLMBacktestConfig,
    onProgress?: (progress: BacktestProgress) => void
  ): Promise<SessionSummary> {
    const sessionId = `eb-bt-${userId}-${Date.now()}`;

    console.log('\n=== EVENT-BASED LLM BACKTEST STARTING ===');
    console.log(`[LLM Backtest] Session: ${config.sessionName}`);
    console.log(`[LLM Backtest] Symbol: ${config.symbol}`);
    console.log(`[LLM Backtest] Period: ${config.startDate.toISOString()} to ${config.endDate.toISOString()}`);
    console.log(`[LLM Backtest] LLM Enabled: ${config.useLLM}`);
    console.log('=======================================\n');

    onProgress?.({
      phase: 'loading',
      message: 'Loading historical candle data...',
      percentComplete: 5,
      candlesProcessed: 0,
      totalCandles: 0,
      triggersDetected: 0,
      llmCallsMade: 0,
      tradesExecuted: 0,
      currentBalance: config.initialBalance
    });

    const candles = await this.loadHistoricalCandles(config.symbol, config.timeframe, config.startDate, config.endDate);

    if (candles.length < 100) {
      throw new Error(`Insufficient historical data: only ${candles.length} candles found`);
    }

    console.log(`[LLM Backtest] Loaded ${candles.length} candles`);

    localSessionMemory.createSession(sessionId, userId, config.sessionName, {
      symbol: config.symbol,
      timeframe: config.timeframe,
      useLLM: config.useLLM,
      riskMode: config.riskMode,
      initialBalance: config.initialBalance
    });

    onProgress?.({
      phase: 'processing',
      message: 'Processing candles and detecting triggers...',
      percentComplete: 10,
      candlesProcessed: 0,
      totalCandles: candles.length,
      triggersDetected: 0,
      llmCallsMade: 0,
      tradesExecuted: 0,
      currentBalance: config.initialBalance
    });

    const engineConfig: EventBasedEngineConfig = {
      symbol: config.symbol,
      timeframe: config.timeframe,
      useLLM: config.useLLM,
      riskMode: config.riskMode,
      maxConcurrentTrades: config.maxConcurrentTrades,
      initialBalance: config.initialBalance
    };

    let openTrades: SimulatedTrade[] = [];
    const closedTrades: SimulatedTrade[] = [];

    for (let i = 50; i < candles.length; i++) {
      localSessionMemory.recordCandleProcessed(sessionId);

      const lookbackCandles = candles.slice(Math.max(0, i - 100), i + 1);

      const result = await eventBasedLLMEngine.processCandle(
        lookbackCandles,
        engineConfig,
        openTrades
      );

      if (result.trigger) {
        localSessionMemory.recordTrigger(sessionId, result.trigger);
      }

      if (result.llmCalled) {
        localSessionMemory.recordLLMCall(sessionId, 0, {});
      }

      if (result.trade) {
        openTrades.push(result.trade);
        localSessionMemory.recordTrade(sessionId, result.trade);
      }

      openTrades = eventBasedLLMEngine.updateOpenTrades(openTrades, candles[i]);

      const newlyClosedTrades = openTrades.filter(t => t.outcome !== 'open');
      newlyClosedTrades.forEach(trade => {
        localSessionMemory.recordTradeClosure(sessionId, trade);
        closedTrades.push(trade);
      });
      openTrades = openTrades.filter(t => t.outcome === 'open');

      if (i % 100 === 0 || i === candles.length - 1) {
        const stats = localSessionMemory.getSessionStatistics(sessionId);
        const progressPercent = 10 + Math.floor(((i - 50) / (candles.length - 50)) * 80);

        onProgress?.({
          phase: 'processing',
          message: `Processing candles: ${i}/${candles.length}`,
          percentComplete: progressPercent,
          candlesProcessed: i,
          totalCandles: candles.length,
          triggersDetected: stats?.triggersDetected || 0,
          llmCallsMade: stats?.llmCallsMade || 0,
          tradesExecuted: stats?.tradesExecuted || 0,
          currentBalance: stats?.finalBalance || config.initialBalance
        });
      }
    }

    onProgress?.({
      phase: 'analyzing',
      message: 'Closing open positions and generating summary...',
      percentComplete: 92,
      candlesProcessed: candles.length,
      totalCandles: candles.length,
      triggersDetected: 0,
      llmCallsMade: 0,
      tradesExecuted: 0,
      currentBalance: config.initialBalance
    });

    const lastCandle = candles[candles.length - 1];
    for (const trade of openTrades) {
      eventBasedLLMEngine.updateOpenTrades([trade], lastCandle);
      if (trade.outcome !== 'open') {
        localSessionMemory.recordTradeClosure(sessionId, trade);
        closedTrades.push(trade);
      }
    }

    onProgress?.({
      phase: 'analyzing',
      message: 'Generating session summary...',
      percentComplete: 95,
      candlesProcessed: candles.length,
      totalCandles: candles.length,
      triggersDetected: 0,
      llmCallsMade: 0,
      tradesExecuted: 0,
      currentBalance: config.initialBalance
    });

    const summary = localSessionMemory.generateSessionSummary(sessionId);

    if (!summary) {
      throw new Error('Failed to generate session summary');
    }

    await this.saveBacktestSummary(summary);

    console.log('\n=== EVENT-BASED LLM BACKTEST COMPLETE ===');
    console.log(`[LLM Backtest] Candles Processed: ${summary.statistics.candlesProcessed}`);
    console.log(`[LLM Backtest] Triggers Detected: ${summary.statistics.triggersDetected}`);
    console.log(`[LLM Backtest] LLM Calls: ${summary.statistics.llmCallsMade}`);
    console.log(`[LLM Backtest] Trades Executed: ${summary.statistics.tradesExecuted}`);
    console.log(`[LLM Backtest] Win Rate: ${summary.statistics.winRate.toFixed(2)}%`);
    console.log(`[LLM Backtest] Total P&L: $${summary.statistics.totalPnL.toFixed(2)}`);
    console.log(`[LLM Backtest] Profit Factor: ${summary.statistics.profitFactor.toFixed(2)}`);
    console.log(`[LLM Backtest] Avg Hold Time: ${summary.statistics.avgHoldTimeMinutes.toFixed(1)} min`);
    console.log(`[LLM Backtest] Trigger→Trade Ratio: ${(summary.statistics.triggerToTradeRatio * 100).toFixed(1)}%`);
    console.log('==========================================\n');

    await this.updateAISkillProgression(userId, summary);

    onProgress?.({
      phase: 'complete',
      message: 'Backtest complete!',
      percentComplete: 100,
      candlesProcessed: candles.length,
      totalCandles: candles.length,
      triggersDetected: summary.statistics.triggersDetected,
      llmCallsMade: summary.statistics.llmCallsMade,
      tradesExecuted: summary.statistics.tradesExecuted,
      currentBalance: summary.statistics.finalBalance
    });

    localSessionMemory.closeSession(sessionId);
    eventBasedLLMEngine.resetTokenUsage();

    return summary;
  }

  /**
   * Load historical candles from Supabase
   */
  private async loadHistoricalCandles(
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date
  ): Promise<any[]> {
    const { data: candles, error } = await supabase
      .from('forex_candles')
      .select('open_time, open, high, low, close, volume')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe.toLowerCase())
      .gte('open_time', startDate.toISOString())
      .lte('open_time', endDate.toISOString())
      .order('open_time', { ascending: true });

    if (error) {
      console.error('[LLM Backtest] Error loading candles:', error);
      throw new Error(`Failed to load candles: ${error.message}`);
    }

    return candles || [];
  }

  /**
   * Save backtest summary to Supabase
   */
  private async saveBacktestSummary(summary: SessionSummary): Promise<void> {
    try {
      const { error } = await supabase.from('event_based_backtest_sessions').insert({
        user_id: summary.userId,
        session_name: summary.sessionName,
        start_time: summary.startTime,
        end_time: summary.endTime,
        duration_seconds: summary.durationSeconds,
        symbol: summary.config.symbol,
        timeframe: summary.config.timeframe,
        risk_mode: summary.config.riskMode,
        initial_balance: summary.config.initialBalance,
        used_llm: summary.config.useLLM,
        candles_processed: summary.statistics.candlesProcessed,
        triggers_detected: summary.statistics.triggersDetected,
        trigger_types: summary.statistics.triggerTypes,
        llm_calls_made: summary.statistics.llmCallsMade,
        llm_tokens_used: summary.statistics.llmTokensUsed,
        llm_cost_estimate: summary.statistics.llmCostEstimate,
        trades_executed: summary.statistics.tradesExecuted,
        trades_won: summary.statistics.tradesWon,
        trades_lost: summary.statistics.tradesLost,
        trades_breakeven: summary.statistics.tradesBreakeven,
        win_rate: summary.statistics.winRate,
        total_pnl: summary.statistics.totalPnL,
        final_balance: summary.statistics.finalBalance,
        avg_win: summary.statistics.avgWin,
        avg_loss: summary.statistics.avgLoss,
        profit_factor: summary.statistics.profitFactor,
        max_drawdown: summary.statistics.maxDrawdown,
        avg_hold_time_minutes: summary.statistics.avgHoldTimeMinutes,
        trigger_to_trade_ratio: summary.statistics.triggerToTradeRatio,
        trades_summary: summary.trades,
        trigger_distribution: summary.triggerDistribution
      });

      if (error) {
        console.error('[LLM Backtest] Error saving summary:', error);
        throw new Error(`Failed to save backtest summary: ${error.message}`);
      }

      console.log('[LLM Backtest] ✅ Summary saved to Supabase');
    } catch (error) {
      console.error('[LLM Backtest] Exception saving summary:', error);
      throw error;
    }
  }

  /**
   * Update AI skill progression based on backtest results
   */
  private async updateAISkillProgression(userId: string, summary: SessionSummary): Promise<void> {
    try {
      console.log('[LLM Backtest] 📊 Updating AI skill progression...');

      const winningTrades = summary.statistics.tradesWon;
      const exploratoryWinningTrades = summary.trades.filter(
        t => t.outcome === 'win' && t.confidence >= 60 && t.confidence < 75
      ).length;

      console.log(`[LLM Backtest] 🎯 Winning trades: ${winningTrades} out of ${summary.statistics.tradesExecuted}`);
      console.log(`[LLM Backtest] 🔍 Exploratory winning trades: ${exploratoryWinningTrades}`);

      const skillUpdate = await aiSkillTracker.updateAfterBacktest(
        userId,
        winningTrades,
        summary.statistics.winRate,
        summary.statistics.profitFactor,
        0,
        'event_based_backtest',
        exploratoryWinningTrades
      );

      if (skillUpdate.leveledUp) {
        console.log(`[LLM Backtest] 🎉 AI LEVEL UP! ${skillUpdate.oldLevel} → ${skillUpdate.newLevel}`);
      } else {
        console.log(`[LLM Backtest] Progress updated. ${winningTrades} successful trades added.`);
      }

      if (skillUpdate.validationWarnings && skillUpdate.validationWarnings.length > 0) {
        console.warn('[LLM Backtest] ⚠️  Validation warnings:');
        skillUpdate.validationWarnings.forEach(warning => {
          console.warn(`  - ${warning}`);
        });
      }
    } catch (error) {
      console.error('[LLM Backtest] Error updating AI skill progression:', error);
    }
  }
}

export const llmEvaluationBacktest = new LLMEvaluationBacktest();
