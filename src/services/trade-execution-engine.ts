import { supabase } from '../lib/supabase';
import { goalSessionManager } from './goal-session-manager';
import { simulatedTradingService } from './simulated-trading';
import { getCurrencyPipInfo } from '../utils/currencyHelpers';

export interface TradeSignal {
  sessionId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  positionSize: number;
  confidence: number;
  setupType: string;
  reasoning: string;
  riskReward: number;
  expectedProfit: number;
}

export interface TradeExecutionResult {
  success: boolean;
  tradeId?: string;
  error?: string;
  message: string;
}

class TradeExecutionEngine {
  /**
   * Apply realistic slippage to entry price
   * Simulates 0.5-1.0 pip slippage in the unfavorable direction
   */
  private applySlippage(symbol: string, entryPrice: number, direction: 'buy' | 'sell'): number {
    const pipInfo = getCurrencyPipInfo(symbol);

    // Random slippage between 0.5 and 1.0 pips
    const slippagePips = 0.5 + Math.random() * 0.5;
    const slippagePrice = slippagePips * pipInfo.pipValue;

    // Apply in unfavorable direction
    if (direction === 'buy') {
      return entryPrice + slippagePrice; // Pay more for buy
    } else {
      return entryPrice - slippagePrice; // Get less for sell
    }
  }

  async executeSignal(
    signal: TradeSignal,
    userId: string,
    autoExecute: boolean = false
  ): Promise<TradeExecutionResult> {
    try {
      console.log(`[Trade Execution] Processing signal for ${signal.symbol}...`);

      const { data: session, error: sessionError } = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('id', signal.sessionId)
        .single();

      if (sessionError || !session) {
        return {
          success: false,
          error: 'Session not found',
          message: 'Could not find active goal session'
        };
      }

      const validationResult = await this.validateSignal(signal, session);
      if (!validationResult.valid) {
        return {
          success: false,
          error: validationResult.reason,
          message: `Signal validation failed: ${validationResult.reason}`
        };
      }

      if (autoExecute) {
        return await this.executeLiveTrade(signal, userId, session);
      } else {
        return await this.createPendingTrade(signal, userId, session);
      }
    } catch (error) {
      console.error('[Trade Execution] Error executing signal:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Failed to execute trade signal'
      };
    }
  }

  async validateSignal(signal: TradeSignal, session: any): Promise<{ valid: boolean; reason?: string }> {
    if (signal.confidence < 50) {
      return { valid: false, reason: 'Confidence too low' };
    }

    const riskThresholds = {
      low: 80,
      medium: 70,
      high: 70
    };

    const threshold = riskThresholds[session.risk_mode as keyof typeof riskThresholds] || 75;
    if (signal.confidence < threshold) {
      return {
        valid: false,
        reason: `Confidence ${signal.confidence}% below ${session.risk_mode} mode threshold (${threshold}%)`
      };
    }

    if (signal.riskReward < 1.5) {
      return { valid: false, reason: `Risk/reward ratio ${signal.riskReward.toFixed(2)} too low (minimum 1.5)` };
    }

    const { data: openTrades } = await supabase
      .from('goal_session_trades')
      .select('*')
      .eq('goal_session_id', signal.sessionId)
      .eq('status', 'open');

    const maxConcurrentTrades = session.risk_mode === 'low' ? 1 : session.risk_mode === 'high' ? 3 : 2;
    if (openTrades && openTrades.length >= maxConcurrentTrades) {
      return {
        valid: false,
        reason: `Maximum concurrent trades (${maxConcurrentTrades}) reached for ${session.risk_mode} mode`
      };
    }

    return { valid: true };
  }

  async createPendingTrade(
    signal: TradeSignal,
    userId: string,
    session: any
  ): Promise<TradeExecutionResult> {
    const { data: trade, error } = await supabase
      .from('goal_session_trades')
      .insert({
        goal_session_id: signal.sessionId,
        symbol: signal.symbol,
        direction: signal.direction,
        entry_price: signal.entryPrice,
        stop_loss: signal.stopLoss,
        take_profit: signal.takeProfit,
        position_size: signal.positionSize,
        status: 'pending'
      })
      .select()
      .single();

    if (error) {
      console.error('[Trade Execution] Failed to create pending trade:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to save trade to database'
      };
    }

    await supabase
      .from('goal_sessions')
      .update({ status: 'trade_pending' })
      .eq('id', signal.sessionId);

    await goalSessionManager.addAIMessage(
      signal.sessionId,
      userId,
      `Trade signal detected on ${signal.symbol}! ${signal.setupType} setup with ${signal.confidence}% confidence. ${signal.reasoning}. Awaiting your confirmation to execute.`,
      { signal, trade },
      'encouraging'
    );

    await supabase.from('goal_notifications').insert({
      goal_session_id: signal.sessionId,
      user_id: userId,
      notification_type: 'signal',
      priority: 'urgent',
      title: `Trade Signal: ${signal.symbol}`,
      message: `${signal.setupType} detected. Confidence: ${signal.confidence}%. Entry: ${signal.entryPrice}, SL: ${signal.stopLoss}, TP: ${signal.takeProfit}`,
      data: { signal, tradeId: trade.id },
      channels: ['in_app', 'email']
    });

    return {
      success: true,
      tradeId: trade.id,
      message: `Trade signal created for ${signal.symbol}. Awaiting confirmation.`
    };
  }

  async executeLiveTrade(
    signal: TradeSignal,
    userId: string,
    session: any
  ): Promise<TradeExecutionResult> {
    console.log(`[Trade Execution] Executing live trade for ${signal.symbol}...`);

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('demo_balance')
      .eq('id', userId)
      .single();

    const currentBalance = parseFloat(profile?.demo_balance || '10000');
    const requiredMargin = signal.positionSize * 1000;

    if (currentBalance < requiredMargin) {
      return {
        success: false,
        error: 'Insufficient balance',
        message: `Insufficient demo balance. Required: $${requiredMargin.toFixed(2)}, Available: $${currentBalance.toFixed(2)}`
      };
    }

    const { data: trade, error } = await supabase
      .from('goal_session_trades')
      .insert({
        goal_session_id: signal.sessionId,
        symbol: signal.symbol,
        direction: signal.direction,
        entry_price: signal.entryPrice,
        stop_loss: signal.stopLoss,
        take_profit: signal.takeProfit,
        position_size: signal.positionSize,
        status: 'open',
        opened_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('[Trade Execution] Failed to create trade:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to save trade to database'
      };
    }

    // Apply realistic slippage to entry price
    const actualEntryPrice = this.applySlippage(signal.symbol, signal.entryPrice, signal.direction);
    const slippagePips = Math.abs(actualEntryPrice - signal.entryPrice) / getCurrencyPipInfo(signal.symbol).pipValue;

    console.log(`[Trade Execution] ✅ Creating simulated position for ${signal.symbol}...`);
    console.log(`[Trade Execution] Slippage applied: ${slippagePips.toFixed(1)} pips (${signal.entryPrice} → ${actualEntryPrice})`);
    console.log(`[Trade Execution] This will make SL/TP visible on chart`);

    const simulatedResult = await simulatedTradingService.executeTrade({
      symbol: signal.symbol,
      action: signal.direction,
      lotSize: signal.positionSize,
      entry: actualEntryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      strategy: 'ai_goal',
      confidence: signal.confidence,
      setupType: signal.setupType
    }, userId);

    if (!simulatedResult.success) {
      console.error('[Trade Execution] ❌ Failed to create simulated position:', simulatedResult.error);
      await supabase
        .from('goal_session_trades')
        .update({ status: 'rejected' })
        .eq('id', trade.id);

      return {
        success: false,
        error: simulatedResult.message,
        message: 'Failed to create simulated position'
      };
    }

    console.log(`[Trade Execution] ✅ simulated_positions entry created`);
    console.log(`[Trade Execution] ✅ Position ID: ${simulatedResult.position?.id}`);

    await supabase
      .from('goal_session_trades')
      .update({ simulated_position_id: simulatedResult.position?.id })
      .eq('id', trade.id);

    await supabase
      .from('goal_sessions')
      .update({ status: 'in_trade' })
      .eq('id', signal.sessionId);

    await goalSessionManager.addAIMessage(
      signal.sessionId,
      userId,
      `Trade executed on ${signal.symbol}! ${signal.direction.toUpperCase()} at ${signal.entryPrice}. ${signal.setupType} setup with ${signal.confidence}% confidence. Stop Loss: ${signal.stopLoss}, Take Profit: ${signal.takeProfit}. Expected R:R = ${signal.riskReward.toFixed(2)}`,
      { signal, trade },
      'encouraging'
    );

    await supabase.from('goal_notifications').insert({
      goal_session_id: signal.sessionId,
      user_id: userId,
      notification_type: 'signal',
      priority: 'urgent',
      title: `Trade Executed: ${signal.symbol}`,
      message: `${signal.direction.toUpperCase()} trade opened at ${signal.entryPrice}. Monitoring position...`,
      data: { signal, tradeId: trade.id },
      channels: ['in_app', 'email']
    });

    return {
      success: true,
      tradeId: trade.id,
      message: `Trade executed successfully on ${signal.symbol}`
    };
  }

  async confirmPendingTrade(tradeId: string, userId: string): Promise<TradeExecutionResult> {
    try {
      const { data: trade, error: fetchError } = await supabase
        .from('goal_session_trades')
        .select('*, goal_sessions!inner(*)')
        .eq('id', tradeId)
        .eq('goal_sessions.user_id', userId)
        .single();

      if (fetchError || !trade) {
        return {
          success: false,
          error: 'Trade not found',
          message: 'Could not find pending trade'
        };
      }

      if (trade.status !== 'pending') {
        return {
          success: false,
          error: 'Invalid status',
          message: `Trade is ${trade.status}, not pending`
        };
      }

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('demo_balance')
        .eq('id', userId)
        .single();

      const currentBalance = parseFloat(profile?.demo_balance || '10000');
      const requiredMargin = trade.position_size * 1000;

      if (currentBalance < requiredMargin) {
        return {
          success: false,
          error: 'Insufficient balance',
          message: `Insufficient demo balance. Required: $${requiredMargin.toFixed(2)}, Available: $${currentBalance.toFixed(2)}`
        };
      }

      console.log(`[Trade Execution] Creating simulated position for confirmed trade ${trade.symbol}...`);
      const simulatedResult = await simulatedTradingService.executeTrade({
        symbol: trade.symbol,
        action: trade.direction,
        lotSize: trade.position_size,
        entry: trade.entry_price,
        stopLoss: trade.stop_loss,
        takeProfit: trade.take_profit,
        strategy: 'ai_goal'
      }, userId);

      if (!simulatedResult.success) {
        console.error('[Trade Execution] Failed to create simulated position:', simulatedResult.error);
        return {
          success: false,
          error: simulatedResult.message,
          message: 'Failed to create simulated position'
        };
      }

      const { error: updateError } = await supabase
        .from('goal_session_trades')
        .update({
          status: 'open',
          opened_at: new Date().toISOString(),
          simulated_position_id: simulatedResult.position?.id
        })
        .eq('id', tradeId);

      if (updateError) {
        return {
          success: false,
          error: updateError.message,
          message: 'Failed to confirm trade'
        };
      }

      await supabase
        .from('goal_sessions')
        .update({ status: 'in_trade' })
        .eq('id', trade.goal_session_id);

      await goalSessionManager.addAIMessage(
        trade.goal_session_id,
        userId,
        `Trade confirmed and opened on ${trade.symbol}! ${trade.direction.toUpperCase()} at ${trade.entry_price}. Now monitoring position for stop loss (${trade.stop_loss}) and take profit (${trade.take_profit}).`,
        { trade },
        'encouraging'
      );

      return {
        success: true,
        tradeId: trade.id,
        message: `Trade confirmed on ${trade.symbol}`
      };
    } catch (error) {
      console.error('[Trade Execution] Error confirming trade:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Failed to confirm trade'
      };
    }
  }

  async rejectPendingTrade(tradeId: string, userId: string, reason?: string): Promise<TradeExecutionResult> {
    try {
      const { data: trade, error: fetchError } = await supabase
        .from('goal_session_trades')
        .select('*, goal_sessions!inner(*)')
        .eq('id', tradeId)
        .eq('goal_sessions.user_id', userId)
        .single();

      if (fetchError || !trade) {
        return {
          success: false,
          error: 'Trade not found',
          message: 'Could not find pending trade'
        };
      }

      const { error: updateError } = await supabase
        .from('goal_session_trades')
        .update({ status: 'rejected' })
        .eq('id', tradeId);

      if (updateError) {
        return {
          success: false,
          error: updateError.message,
          message: 'Failed to reject trade'
        };
      }

      await supabase
        .from('goal_sessions')
        .update({ status: 'scanning' })
        .eq('id', trade.goal_session_id);

      await goalSessionManager.addAIMessage(
        trade.goal_session_id,
        userId,
        `Trade signal on ${trade.symbol} rejected${reason ? `: ${reason}` : ''}. Continuing market scan for better opportunities.`,
        { trade, reason },
        'neutral'
      );

      return {
        success: true,
        tradeId: trade.id,
        message: `Trade on ${trade.symbol} rejected. Continuing scan.`
      };
    } catch (error) {
      console.error('[Trade Execution] Error rejecting trade:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Failed to reject trade'
      };
    }
  }
}

export const tradeExecutionEngine = new TradeExecutionEngine();
