/**
 * Goal Session Core Engine - Server-Side Compatible
 *
 * Pure trading logic with NO browser dependencies (no timers, no DOM, no window)
 * Can be used by both client-side UI and server-side scheduled functions
 * Designed for autonomous operation in Netlify scheduled functions
 */

import { supabase } from '../lib/supabase';
import { eventBasedLLMEngine, SimulatedTrade } from './event-based-llm-engine';
import { localSessionMemory } from './local-session-memory';
import { tradeExecutionEngine } from './trade-execution-engine';
import { midTradeTriggerDetector, type MarketConditions } from './mid-trade-trigger-detector';
import { llmMidTradeEvaluator } from './llm-mid-trade-evaluator';
import { logger, LogCategory } from '../lib/logger';
import { normalizeTimeframeToDb } from '../utils/timeframe-utils';

export interface GoalSessionProcessResult {
  success: boolean;
  message: string;
  tradesExecuted?: number;
  triggersDetected?: number;
  llmCallsMade?: number;
  currentBalance?: number;
  shouldContinue: boolean;
}

export interface GoalSessionState {
  goalSessionId: string;
  userId: string;
  watchlist: string[];
  timeframe: string;
  openTrades: SimulatedTrade[];
  lastProcessedCandleTime: Date | null;
  sessionStartTime: Date;
  initialBalance: number;
  currentBalance: number;
  scanCount: number;
}

/**
 * Process one iteration of a goal session
 * This is the core logic that both client and server can call
 */
export async function processGoalSessionIteration(
  state: GoalSessionState
): Promise<GoalSessionProcessResult> {
  try {
    const { goalSessionId, userId, watchlist, timeframe } = state;

    if (!watchlist || watchlist.length === 0) {
      logger.error(LogCategory.AI_TRADING, '[Core] No symbols in watchlist');
      return {
        success: false,
        message: 'Session has no symbols to monitor',
        shouldContinue: false
      };
    }

    let llmCallsMade = 0;
    let triggersDetected = 0;
    let tradesExecuted = 0;

    // Process EACH symbol in the watchlist
    for (const symbol of watchlist) {
      // Fetch latest candles from database
      const dbTimeframe = normalizeTimeframeToDb(timeframe);
      logger.debug(LogCategory.AI_TRADING, `[Core] Processing ${symbol} ${timeframe}`);

      const { data: candles, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', dbTimeframe)
        .order('open_time', { ascending: false })
        .limit(100);

      if (error || !candles || candles.length < 50) {
        logger.warn(LogCategory.AI_TRADING, `[Core] Insufficient data for ${symbol}, skipping`);
        continue;
      }

      const sortedCandles = candles.reverse();
      const latestCandle = sortedCandles[sortedCandles.length - 1];

      // Check if this is a new candle
      if (state.lastProcessedCandleTime &&
          new Date(latestCandle.open_time).getTime() <= state.lastProcessedCandleTime.getTime()) {
        continue;
      }

      // Update state
      state.lastProcessedCandleTime = new Date(latestCandle.open_time);
      state.scanCount++;

      // Update open trades for this symbol with latest price
      const symbolTrades = state.openTrades.filter(t => t.symbol === symbol);
      for (const trade of symbolTrades) {
        if (trade.outcome === 'open') {
          trade.currentPrice = parseFloat(latestCandle.close);
          trade.profitLoss = trade.direction === 'buy'
            ? (trade.currentPrice - trade.entryPrice) * trade.positionSize
            : (trade.entryPrice - trade.currentPrice) * trade.positionSize;
        }
      }

      // Check mid-trade triggers for open positions on this symbol
      for (const trade of symbolTrades) {
        if (trade.outcome === 'open') {
          const conditions = calculateMarketConditions(sortedCandles, latestCandle);
          const triggers = midTradeTriggerDetector.detectTriggers(trade, conditions, latestCandle);

          if (triggers.length > 0) {
            triggersDetected += triggers.length;

            // Evaluate with LLM
            const evaluation = await llmMidTradeEvaluator.evaluatePosition(
              trade,
              triggers,
              sortedCandles,
              userId
            );

            llmCallsMade++;

            if (evaluation.action !== 'hold') {
              await handleLLMPositionAction(trade, evaluation, goalSessionId, userId);
            }
          }
        }
      }

      // Look for new trade opportunities on this symbol
      const { data: goalSession } = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('id', goalSessionId)
        .single();

      if (!goalSession) continue;

      const maxConcurrentTrades = 3;
      const allowNewTrades = goalSession.status === 'scanning' || goalSession.status === 'active';

      if (allowNewTrades && state.openTrades.length < maxConcurrentTrades) {
        const newSignal = await eventBasedLLMEngine.evaluateCandleStream(
          sortedCandles,
          symbol,
          userId,
          goalSessionId
        );

        if (newSignal && newSignal.direction) {
          llmCallsMade++;
          triggersDetected++;

          const executed = await executeLiveTrade(newSignal, goalSessionId, userId, state);
          if (executed) {
            tradesExecuted++;
          }
        }
      }
    }

    // Handle closed trades
    const closedTrades = state.openTrades.filter(t => t.outcome !== 'open');
    for (const trade of closedTrades) {
      await handleTradeClosure(trade, goalSessionId, userId, state.initialBalance);
    }
    state.openTrades = state.openTrades.filter(t => t.outcome === 'open');

    // Calculate current balance
    state.currentBalance = calculateCurrentBalance(state);

    // Check daily loss limit
    const maxLossPercent = 10;
    const maxLossAmount = -(state.initialBalance * (maxLossPercent / 100));
    if (state.currentBalance <= state.initialBalance + maxLossAmount) {
      await stopGoalSession(goalSessionId, 'Daily loss limit reached');
      return {
        success: true,
        message: 'Session stopped - daily loss limit reached',
        shouldContinue: false
      };
    }

    // Check if goal achieved
    const { data: goalSession } = await supabase
      .from('goal_sessions')
      .select('*')
      .eq('id', goalSessionId)
      .single();

    if (!goalSession) {
      return {
        success: false,
        message: 'Goal session not found',
        shouldContinue: false
      };
    }

    // Check if timeframe expired
    if (goalSession.end_time) {
      const endTime = new Date(goalSession.end_time);
      const now = new Date();

      if (now >= endTime && goalSession.status !== 'soft_closing') {
        await supabase
          .from('goal_sessions')
          .update({
            status: 'soft_closing',
            timeframe_expired_at: now.toISOString(),
            trades_open_at_expiration: state.openTrades.length
          })
          .eq('id', goalSessionId);

        logger.info(LogCategory.AI_TRADING, `🏁 Session timeframe expired. ${state.openTrades.length} trades still open.`);
      }
    }

    // Check if goal achieved
    if (goalSession.current_progress >= goalSession.target_value && goalSession.status !== 'goal_achieved') {
      await supabase
        .from('goal_sessions')
        .update({
          status: 'goal_achieved',
          goal_achieved_at: new Date().toISOString(),
          goal_achieved_pnl: goalSession.current_progress
        })
        .eq('id', goalSessionId);

      logger.info(LogCategory.AI_TRADING, `🎯 GOAL ACHIEVED! Target: $${goalSession.target_value}, Achieved: $${goalSession.current_progress}`);
    }

    // If soft closing and no open trades, complete the session
    if (goalSession.status === 'soft_closing' && state.openTrades.length === 0) {
      await stopGoalSession(goalSessionId, 'All positions closed after timeframe expiration');
      return {
        success: true,
        message: 'Session completed',
        shouldContinue: false
      };
    }

    // Update session status
    await supabase
      .from('goal_sessions')
      .update({
        last_scan_time: new Date().toISOString(),
        current_pnl: state.currentBalance - state.initialBalance
      })
      .eq('id', goalSessionId);

    return {
      success: true,
      message: 'Iteration complete',
      tradesExecuted,
      triggersDetected,
      llmCallsMade,
      currentBalance: state.currentBalance,
      shouldContinue: true
    };
  } catch (error) {
    logger.error(LogCategory.AI_TRADING, '[Core] Error processing iteration:', error);
    return {
      success: false,
      message: `Error: ${(error as Error).message}`,
      shouldContinue: true
    };
  }
}

/**
 * Initialize a goal session for processing
 */
export async function initializeGoalSession(goalSessionId: string): Promise<GoalSessionState | null> {
  try {
    const { data: goalSession, error } = await supabase
      .from('goal_sessions')
      .select('*')
      .eq('id', goalSessionId)
      .single();

    if (error || !goalSession) {
      logger.error(LogCategory.AI_TRADING, '[Core] Goal session not found');
      return null;
    }

    // Get open trades from database
    const { data: positions } = await supabase
      .from('simulated_positions')
      .select('*')
      .eq('goal_session_id', goalSessionId)
      .eq('status', 'open');

    const openTrades: SimulatedTrade[] = (positions || []).map(p => ({
      id: p.id,
      symbol: p.symbol,
      direction: p.direction as 'buy' | 'sell',
      entryPrice: parseFloat(p.entry_price),
      currentPrice: parseFloat(p.current_price || p.entry_price),
      stopLoss: parseFloat(p.stop_loss),
      takeProfit: parseFloat(p.take_profit),
      positionSize: parseFloat(p.position_size),
      profitLoss: parseFloat(p.profit_loss || '0'),
      outcome: 'open' as const,
      entryTime: new Date(p.entry_time),
      closeTime: null,
      closePrice: null,
      closeReason: null,
      reasoning: p.reasoning || '',
      triggerType: p.trigger_type || 'unknown'
    }));

    const watchlist = goalSession.watchlist || ['XAUUSD', 'EURUSD', 'GBPUSD'];

    const state: GoalSessionState = {
      goalSessionId,
      userId: goalSession.user_id,
      watchlist: Array.isArray(watchlist) ? watchlist : [watchlist],
      timeframe: goalSession.timeframe || '15m',
      openTrades,
      lastProcessedCandleTime: goalSession.last_scan_time ? new Date(goalSession.last_scan_time) : null,
      sessionStartTime: new Date(goalSession.created_at),
      initialBalance: parseFloat(goalSession.initial_balance || '1000'),
      currentBalance: parseFloat(goalSession.initial_balance || '1000') + parseFloat(goalSession.current_pnl || '0'),
      scanCount: 0
    };

    // Initialize LLM engine
    await eventBasedLLMEngine.initialize(state.userId, goalSessionId);
    eventBasedLLMEngine.setAutonomousBrain(true);

    return state;
  } catch (error) {
    logger.error(LogCategory.AI_TRADING, '[Core] Error initializing session:', error);
    return null;
  }
}

/**
 * Calculate market conditions from candles
 */
function calculateMarketConditions(candles: any[], latestCandle: any): MarketConditions {
  const prices = candles.map(c => parseFloat(c.close));
  const currentPrice = parseFloat(latestCandle.close);

  // Simple RSI calculation
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < Math.min(14, prices.length); i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  const rs = gains / (losses || 1);
  const rsi = 100 - (100 / (1 + rs));

  // Trend detection
  const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, prices.length);
  const trend = currentPrice > sma20 ? 'up' : currentPrice < sma20 ? 'down' : 'sideways';

  // Volatility
  const atr = calculateATR(candles.slice(-14));

  return {
    currentPrice,
    trend,
    rsi,
    atr,
    volume: parseFloat(latestCandle.volume || '0'),
    time: new Date(latestCandle.open_time)
  };
}

/**
 * Calculate ATR
 */
function calculateATR(candles: any[]): number {
  if (candles.length === 0) return 0;
  const trs = candles.map(c => parseFloat(c.high) - parseFloat(c.low));
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

/**
 * Calculate current balance
 */
function calculateCurrentBalance(state: GoalSessionState): number {
  const openPnL = state.openTrades.reduce((sum, t) => sum + t.profitLoss, 0);
  return state.initialBalance + openPnL;
}

/**
 * Handle LLM position action
 */
async function handleLLMPositionAction(
  trade: SimulatedTrade,
  evaluation: any,
  goalSessionId: string,
  userId: string
): Promise<void> {
  logger.info(LogCategory.AI_TRADING, `[Core] LLM decided: ${evaluation.action} for trade ${trade.id}`);

  if (evaluation.action === 'close') {
    await tradeExecutionEngine.closeLivePosition(trade.id, evaluation.reasoning);
  } else if (evaluation.action === 'adjust_sl') {
    await tradeExecutionEngine.adjustStopLoss(trade.id, evaluation.newStopLoss, evaluation.reasoning);
  } else if (evaluation.action === 'adjust_tp') {
    await tradeExecutionEngine.adjustTakeProfit(trade.id, evaluation.newTakeProfit, evaluation.reasoning);
  }
}

/**
 * Handle trade closure
 */
async function handleTradeClosure(
  trade: SimulatedTrade,
  goalSessionId: string,
  userId: string,
  initialBalance: number
): Promise<void> {
  logger.info(LogCategory.AI_TRADING, `[Core] Trade closed: ${trade.outcome} | P&L: $${trade.profitLoss.toFixed(2)}`);

  // Save to trade history
  await tradeExecutionEngine.saveTradeToHistory(trade, goalSessionId, userId);

  // Update goal session progress
  const { data: goalSession } = await supabase
    .from('goal_sessions')
    .select('*')
    .eq('id', goalSessionId)
    .single();

  if (goalSession) {
    const newProgress = (goalSession.current_progress || 0) + trade.profitLoss;
    const totalTrades = (goalSession.total_trades || 0) + 1;
    const winningTrades = trade.profitLoss > 0 ? (goalSession.winning_trades || 0) + 1 : (goalSession.winning_trades || 0);

    await supabase
      .from('goal_sessions')
      .update({
        current_progress: newProgress,
        progress_percentage: (newProgress / goalSession.target_value) * 100,
        total_trades: totalTrades,
        winning_trades: winningTrades,
        current_pnl: newProgress
      })
      .eq('id', goalSessionId);
  }
}

/**
 * Execute live trade
 */
async function executeLiveTrade(
  signal: any,
  goalSessionId: string,
  userId: string,
  state: GoalSessionState
): Promise<boolean> {
  try {
    const result = await tradeExecutionEngine.executeLiveTrade(
      {
        goalSessionId,
        symbol: signal.symbol,
        direction: signal.direction,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        positionSize: signal.positionSize || 0.01,
        confidence: signal.confidence || 0.7,
        reasoning: signal.reasoning || 'LLM signal',
        triggerType: signal.triggerType || 'llm_entry',
        timestamp: new Date()
      },
      userId
    );

    if (result.success && result.trade) {
      state.openTrades.push(result.trade);
      logger.info(LogCategory.AI_TRADING, `[Core] Trade executed: ${signal.direction} ${signal.symbol} @ ${signal.entryPrice}`);
      return true;
    }

    return false;
  } catch (error) {
    logger.error(LogCategory.AI_TRADING, '[Core] Error executing trade:', error);
    return false;
  }
}

/**
 * Stop goal session
 */
async function stopGoalSession(goalSessionId: string, reason: string): Promise<void> {
  await supabase
    .from('goal_sessions')
    .update({
      status: 'completed',
      end_time: new Date().toISOString(),
      completion_reason: reason
    })
    .eq('id', goalSessionId);

  logger.info(LogCategory.AI_TRADING, `[Core] Session stopped: ${reason}`);
}
