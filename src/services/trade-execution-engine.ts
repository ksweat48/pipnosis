import { supabase } from '../lib/supabase';
import { goalSessionManager } from './goal-session-manager';
import { positionService } from './position-service';
import { getCurrencyPipInfo, roundLotSize, roundPnL } from '../utils/currencyHelpers';
import { strategyPlaybookManager } from './strategy-playbook-manager';
import { getRegimeBucket } from './regime-bucketing';
import { prodLogger } from '../lib/production-logger';
import { globalDialogManager } from './global-dialog-manager';

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
  // Playbook tracking context
  regimeSnapshot?: any;
  adversarialState?: any;
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

    // R:R validation removed - Safety Enforcer now auto-adjusts TP to meet minimum R:R
    // This allows good setups to execute with optimized parameters instead of rejection

    // Check for BOTH open AND pending trades to prevent race conditions
    const { data: openTrades } = await supabase
      .from('goal_session_trades')
      .select('*')
      .eq('goal_session_id', signal.sessionId)
      .in('status', ['open', 'pending']);

    const maxConcurrentTrades = session.risk_mode === 'low' ? 1 : session.risk_mode === 'high' ? 3 : 2;
    if (openTrades && openTrades.length >= maxConcurrentTrades) {
      return {
        valid: false,
        reason: `Maximum concurrent trades (${maxConcurrentTrades}) reached for ${session.risk_mode} mode`
      };
    }

    // CRITICAL: Prevent duplicate trades on the same symbol
    const existingSymbolTrade = openTrades?.find(trade => trade.symbol === signal.symbol);
    if (existingSymbolTrade) {
      return {
        valid: false,
        reason: `Already have an open/pending position on ${signal.symbol}`
      };
    }

    return { valid: true };
  }

  async createPendingTrade(
    signal: TradeSignal,
    userId: string,
    session: any
  ): Promise<TradeExecutionResult> {
    // CRITICAL: Validate all required fields before proceeding
    if (!signal.entryPrice || signal.entryPrice <= 0) {
      console.error('[Trade Execution] CRITICAL: Invalid entry price:', signal.entryPrice);
      return {
        success: false,
        error: 'Invalid entry price',
        message: 'Entry price must be greater than 0'
      };
    }

    if (!signal.stopLoss || signal.stopLoss <= 0) {
      console.error('[Trade Execution] CRITICAL: Invalid stop loss:', signal.stopLoss);
      return {
        success: false,
        error: 'Invalid stop loss',
        message: 'Stop loss must be greater than 0'
      };
    }

    if (!signal.takeProfit || signal.takeProfit <= 0) {
      console.error('[Trade Execution] CRITICAL: Invalid take profit:', signal.takeProfit);
      return {
        success: false,
        error: 'Invalid take profit',
        message: 'Take profit must be greater than 0'
      };
    }

    if (!signal.positionSize || signal.positionSize <= 0 || isNaN(signal.positionSize)) {
      console.error('[Trade Execution] CRITICAL: Invalid position size:', signal.positionSize);
      return {
        success: false,
        error: 'Invalid position size',
        message: 'Position size must be greater than 0'
      };
    }

    // Get playbook context for this trade
    const regimeBucket = signal.regimeSnapshot && signal.adversarialState
      ? getRegimeBucket(signal.regimeSnapshot, signal.adversarialState)
      : null;

    const activePlaybook = regimeBucket
      ? await strategyPlaybookManager.getActivePlaybook(signal.symbol, regimeBucket)
      : null;

    // Round lot size to broker standard precision (0.01 lots)
    const roundedLotSize = roundLotSize(signal.positionSize);

    // Calculate risk dollars for R-normalized metrics
    const pipInfo = getCurrencyPipInfo(signal.symbol);
    const riskPips = Math.abs(signal.entryPrice - signal.stopLoss) / pipInfo.pipValue;
    const dollarPerPip = roundedLotSize * 10; // Standard forex calculation
    const riskDollars = roundPnL(riskPips * dollarPerPip);

    console.log('[Trade Execution] Creating pending trade:', {
      symbol: signal.symbol,
      direction: signal.direction,
      entry_price: signal.entryPrice,
      stop_loss: signal.stopLoss,
      take_profit: signal.takeProfit,
      position_size: roundedLotSize
    });

    const { data: trade, error } = await supabase
      .from('goal_session_trades')
      .insert({
        goal_session_id: signal.sessionId,
        user_id: userId,
        symbol: signal.symbol,
        direction: signal.direction,
        entry_price: signal.entryPrice,
        stop_loss: signal.stopLoss,
        take_profit: signal.takeProfit,
        position_size: roundedLotSize,
        lot_size: roundedLotSize,
        status: 'pending',
        playbook_id: activePlaybook?.id || null,
        regime_bucket: regimeBucket,
        risk_dollars: riskDollars
      })
      .select()
      .single();

    if (error) {
      console.error('[Trade Execution] ❌ Failed to create pending trade:', error);
      console.error('[Trade Execution] ❌ Error details:', {
        code: error.code,
        message: error.message,
        details: error.details
      });
      return {
        success: false,
        error: error.message,
        message: 'Failed to save trade to database'
      };
    }

    console.log('[Trade Execution] ✅ Pending trade created:', {
      id: trade.id,
      symbol: trade.symbol,
      entry_price: trade.entry_price,
      status: trade.status
    });

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

    // CRITICAL: Validate all required fields before proceeding
    if (!signal.entryPrice || signal.entryPrice <= 0) {
      console.error('[Trade Execution] CRITICAL: Invalid entry price:', signal.entryPrice);
      return {
        success: false,
        error: 'Invalid entry price',
        message: 'Entry price must be greater than 0'
      };
    }

    if (!signal.stopLoss || signal.stopLoss <= 0) {
      console.error('[Trade Execution] CRITICAL: Invalid stop loss:', signal.stopLoss);
      return {
        success: false,
        error: 'Invalid stop loss',
        message: 'Stop loss must be greater than 0'
      };
    }

    if (!signal.takeProfit || signal.takeProfit <= 0) {
      console.error('[Trade Execution] CRITICAL: Invalid take profit:', signal.takeProfit);
      return {
        success: false,
        error: 'Invalid take profit',
        message: 'Take profit must be greater than 0'
      };
    }

    if (!signal.positionSize || signal.positionSize <= 0 || isNaN(signal.positionSize)) {
      console.error('[Trade Execution] CRITICAL: Invalid position size:', signal.positionSize);
      return {
        success: false,
        error: 'Invalid position size',
        message: 'Position size must be greater than 0'
      };
    }

    console.log(`[Trade Execution] ✅ Signal validation passed: entry=${signal.entryPrice}, sl=${signal.stopLoss}, tp=${signal.takeProfit}, size=${signal.positionSize}`);

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('account_balance')
      .eq('id', userId)
      .single();

    const currentBalance = parseFloat(profile?.account_balance || '10000');
    const requiredMargin = signal.positionSize * 1000;

    if (currentBalance < requiredMargin) {
      return {
        success: false,
        error: 'Insufficient balance',
        message: `Insufficient demo balance. Required: $${requiredMargin.toFixed(2)}, Available: $${currentBalance.toFixed(2)}`
      };
    }

    // Get playbook context for this trade
    const regimeBucket = signal.regimeSnapshot && signal.adversarialState
      ? getRegimeBucket(signal.regimeSnapshot, signal.adversarialState)
      : null;

    const activePlaybook = regimeBucket
      ? await strategyPlaybookManager.getActivePlaybook(signal.symbol, regimeBucket)
      : null;

    // Calculate risk dollars for R-normalized metrics
    const pipInfo = getCurrencyPipInfo(signal.symbol);
    const riskPips = Math.abs(signal.entryPrice - signal.stopLoss) / pipInfo.pipValue;
    const dollarPerPip = signal.positionSize * 10; // Standard forex calculation
    const riskDollars = riskPips * dollarPerPip;

    console.log(`[Playbook] Trade context: bucket=${regimeBucket}, playbook=${activePlaybook?.variant_id || 'none'}, risk=$${riskDollars.toFixed(2)}`);

    // Apply realistic slippage to entry price BEFORE inserting
    const actualEntryPrice = this.applySlippage(signal.symbol, signal.entryPrice, signal.direction);
    const slippagePips = Math.abs(actualEntryPrice - signal.entryPrice) / getCurrencyPipInfo(signal.symbol).pipValue;

    console.log(`[Trade Execution] Slippage applied: ${slippagePips.toFixed(1)} pips (${signal.entryPrice.toFixed(5)} → ${actualEntryPrice.toFixed(5)})`);

    // Insert trade with all required fields populated
    const tradeData = {
      goal_session_id: signal.sessionId,
      user_id: userId,
      symbol: signal.symbol,
      direction: signal.direction,
      entry_price: actualEntryPrice,
      stop_loss: signal.stopLoss,
      take_profit: signal.takeProfit,
      position_size: signal.positionSize,
      lot_size: signal.positionSize,
      status: 'open',
      order_type: 'market' as const,
      current_price: actualEntryPrice,
      current_pnl: 0,
      opened_at: new Date().toISOString(),
      playbook_id: activePlaybook?.id || null,
      regime_bucket: regimeBucket,
      risk_dollars: riskDollars
    };

    console.log('[Trade Execution] Inserting trade with data:', {
      symbol: tradeData.symbol,
      direction: tradeData.direction,
      entry_price: tradeData.entry_price,
      stop_loss: tradeData.stop_loss,
      take_profit: tradeData.take_profit,
      position_size: tradeData.position_size,
      status: tradeData.status
    });

    const { data: trade, error } = await supabase
      .from('goal_session_trades')
      .insert(tradeData)
      .select()
      .single();

    if (error) {
      console.error('[Trade Execution] ❌ Failed to create trade:', error);
      console.error('[Trade Execution] ❌ Error details:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      return {
        success: false,
        error: error.message,
        message: 'Failed to save trade to database'
      };
    }

    if (!trade) {
      console.error('[Trade Execution] ❌ CRITICAL: Trade created but no data returned');
      return {
        success: false,
        error: 'No trade data returned',
        message: 'Trade creation returned no data'
      };
    }

    // CRITICAL: Verify trade was created with all required fields
    console.log('[Trade Execution] ✅ Trade created successfully:', {
      id: trade.id,
      symbol: trade.symbol,
      direction: trade.direction,
      entry_price: trade.entry_price,
      stop_loss: trade.stop_loss,
      take_profit: trade.take_profit,
      position_size: trade.position_size,
      status: trade.status
    });

    if (!trade.entry_price || trade.entry_price <= 0) {
      console.error('[Trade Execution] ❌ CRITICAL: Trade created with invalid entry_price:', trade.entry_price);
      // Attempt to fix by updating
      const { error: fixError } = await supabase
        .from('goal_session_trades')
        .update({ entry_price: actualEntryPrice })
        .eq('id', trade.id);

      if (fixError) {
        console.error('[Trade Execution] ❌ Failed to fix entry_price:', fixError);
      } else {
        console.log('[Trade Execution] ✅ Fixed entry_price to:', actualEntryPrice);
        trade.entry_price = actualEntryPrice;
      }
    }

    prodLogger.trade('OPENED', signal.symbol, {
      direction: signal.direction.toUpperCase(),
      entry: actualEntryPrice,
      sl: signal.stopLoss,
      tp: signal.takeProfit,
      size: signal.positionSize,
      confidence: `${signal.confidence}%`,
      setup: signal.setupType
    });

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

    // Trigger immediate trade entry modal
    globalDialogManager.showTradeEntry({
      symbol: signal.symbol,
      direction: signal.direction,
      entryPrice: actualEntryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      lotSize: signal.positionSize,
      confidence: signal.confidence,
      priority: signal.confidence >= 85 ? 'urgent' : signal.confidence >= 75 ? 'high' : 'medium',
      setupType: signal.setupType,
      reasoning: signal.reasoning,
      expectedProfit: signal.expectedProfit,
      riskReward: signal.riskReward,
      autoExecuted: true
    }, signal.confidence >= 85 ? 'urgent' : signal.confidence >= 75 ? 'high' : 'medium');

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
        .select('account_balance')
        .eq('id', userId)
        .single();

      const currentBalance = parseFloat(profile?.account_balance || '10000');
      const requiredMargin = trade.position_size * 1000;

      if (currentBalance < requiredMargin) {
        return {
          success: false,
          error: 'Insufficient balance',
          message: `Insufficient demo balance. Required: $${requiredMargin.toFixed(2)}, Available: $${currentBalance.toFixed(2)}`
        };
      }

      // Verbose log removed

      // Open position directly in goal_session_trades
      const { error: updateError } = await supabase
        .from('goal_session_trades')
        .update({
          status: 'open',
          order_type: 'market',
          current_price: trade.entry_price,
          current_pnl: 0,
          opened_at: new Date().toISOString()
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
