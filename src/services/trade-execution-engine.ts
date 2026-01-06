import { supabase } from '../lib/supabase';
import { goalSessionManager } from './goal-session-manager';
import { positionService } from './position-service';
import { getCurrencyPipInfo, roundLotSize, roundPnL, calculatePipDistance } from '../utils/currencyHelpers';
import { strategyPlaybookManager } from './strategy-playbook-manager';
import { getRegimeBucket } from './regime-bucketing';
import { prodLogger } from '../lib/production-logger';
import { globalDialogManager } from './global-dialog-manager';
import { llmReasoningLogger } from './llm-reasoning-logger';
import { getMinConfidenceThreshold } from '../config/risk-levels';

interface LivePriceResult {
  price: number;
  source: string;
  timestamp: Date;
}

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
  // Dual TP system
  tp1Price?: number;
  tp2Price?: number;
  tp1Confidence?: number;
  tp1Reasoning?: string;
  tp2Reasoning?: string;
  // Playbook tracking context
  regimeSnapshot?: any;
  adversarialState?: any;
  // SSOT Snapshot metadata (Issue #2 fix)
  snapshotTimestamp: number;  // When snapshot was created
  snapshotPrice: number;      // Price at snapshot time
  snapshotHash: string;       // Hash for validation
}

export interface TradeExecutionResult {
  success: boolean;
  tradeId?: string;
  error?: string;
  message: string;
  isMonitoring?: boolean;
}

class TradeExecutionEngine {
  /**
   * Fetch the CURRENT live price for a symbol at execution time
   * This ensures trades execute at actual market price, not stale analysis price
   */
  private async fetchLivePrice(symbol: string): Promise<LivePriceResult | null> {
    try {
      const { data: latestCandle, error } = await supabase
        .from('forex_candles')
        .select('close, open_time')
        .eq('symbol', symbol)
        .order('open_time', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !latestCandle) {
        console.warn(`[Trade Execution] Could not fetch live price for ${symbol}:`, error?.message);

        const { data: realtimePrice } = await supabase
          .from('realtime_prices')
          .select('price, updated_at')
          .eq('symbol', symbol)
          .maybeSingle();

        if (realtimePrice?.price) {
          return {
            price: realtimePrice.price,
            source: 'realtime_prices',
            timestamp: new Date(realtimePrice.updated_at)
          };
        }
        return null;
      }

      return {
        price: latestCandle.close,
        source: 'forex_candles',
        timestamp: new Date(latestCandle.open_time)
      };
    } catch (error) {
      console.error(`[Trade Execution] Error fetching live price for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get maximum allowed price slippage for a symbol type
   * Indices like NAS100 are much more volatile than forex pairs
   */
  private getMaxAllowedSlippage(symbol: string): number {
    const pipInfo = getCurrencyPipInfo(symbol);

    if (pipInfo.symbolType === 'index') {
      return 30 * pipInfo.pipValue;
    } else if (pipInfo.symbolType === 'crypto') {
      return 50 * pipInfo.pipValue;
    } else {
      return 5 * pipInfo.pipValue;
    }
  }

  /**
   * Apply realistic slippage to entry price
   * Adjusted for symbol type - indices have higher slippage than forex
   */
  private applySlippage(symbol: string, entryPrice: number, direction: 'buy' | 'sell'): number {
    const pipInfo = getCurrencyPipInfo(symbol);

    let slippagePips: number;
    if (pipInfo.symbolType === 'index') {
      slippagePips = 1 + Math.random() * 3;
    } else if (pipInfo.symbolType === 'crypto') {
      slippagePips = 2 + Math.random() * 5;
    } else {
      slippagePips = 0.5 + Math.random() * 0.5;
    }

    const slippagePrice = slippagePips * pipInfo.pipValue;

    if (direction === 'buy') {
      return entryPrice + slippagePrice;
    } else {
      return entryPrice - slippagePrice;
    }
  }

  /**
   * Adjust SL and TP relative to a new entry price while maintaining pip distances
   */
  private adjustLevelsForNewEntry(
    symbol: string,
    originalEntry: number,
    newEntry: number,
    originalSL: number,
    originalTP: number,
    direction: 'buy' | 'sell'
  ): { stopLoss: number; takeProfit: number } {
    const pipInfo = getCurrencyPipInfo(symbol);

    const slPips = Math.abs(originalEntry - originalSL) / pipInfo.pipValue;
    const tpPips = Math.abs(originalTP - originalEntry) / pipInfo.pipValue;

    let newSL: number;
    let newTP: number;

    if (direction === 'buy') {
      newSL = newEntry - (slPips * pipInfo.pipValue);
      newTP = newEntry + (tpPips * pipInfo.pipValue);
    } else {
      newSL = newEntry + (slPips * pipInfo.pipValue);
      newTP = newEntry - (tpPips * pipInfo.pipValue);
    }

    return { stopLoss: newSL, takeProfit: newTP };
  }

  async executeSignal(
    signal: TradeSignal,
    userId: string,
    autoExecute: boolean = false,
    alphaDecision?: any
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

      if (alphaDecision?.entry_intent) {
        console.log('[Trade Execution] Entry intent detected, checking execution strategy...');
        const { EntryExecutionCoordinator } = await import('./entry-execution-coordinator');

        const result = await EntryExecutionCoordinator.handleAlphaDecision(
          userId,
          signal.sessionId,
          alphaDecision,
          signal.symbol
        );

        if (!result.shouldExecuteImmediately) {
          console.log(`[Trade Execution] Entry monitoring started (intent: ${result.intentId})`);
          return {
            success: true,
            tradeId: result.intentId,
            message: 'Entry monitoring started - trade will execute when conditions are met',
            isMonitoring: true
          };
        }

        console.log('[Trade Execution] High urgency or immediate momentum - executing now');
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
    // PRIORITY FIX (Issue #2): Validate snapshot age BEFORE execution
    const snapshotAge = Date.now() - signal.snapshotTimestamp;
    const MAX_SNAPSHOT_AGE = 30000; // 30 seconds

    if (snapshotAge > MAX_SNAPSHOT_AGE) {
      console.warn(`[Trade Execution] ⚠️ Snapshot too old (${Math.round(snapshotAge / 1000)}s > 30s)`);
      return {
        valid: false,
        reason: `Snapshot expired (${Math.round(snapshotAge / 1000)}s old). Please rescan market.`
      };
    }

    if (signal.confidence < 50) {
      return { valid: false, reason: 'Confidence too low' };
    }

    const threshold = session.min_confidence || getMinConfidenceThreshold(session.risk_mode);
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
    const dollarPerPip = roundedLotSize * pipInfo.dollarPerPipPerLot; // Use symbol-specific calculation
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
        risk_dollars: riskDollars,
        ai_confidence: signal.confidence,
        ai_reasoning: signal.reasoning,
        ai_strategy_used: signal.setupType
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

    // CRITICAL FIX: Create journal entry for pending trade
    try {
      const journalEntryId = await llmReasoningLogger.logTradeEntry({
        userId: userId,
        tradeId: trade.id,
        sessionId: signal.sessionId,
        symbol: signal.symbol,
        direction: signal.direction,
        entryTime: new Date(),
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        llmReasoning: signal.reasoning || `AI detected ${signal.direction.toUpperCase()} opportunity on ${signal.symbol} with ${signal.confidence}% confidence. Setup: ${signal.setupType}. Awaiting user confirmation to execute.`,
        marketRead: `Market conditions evaluated for ${signal.symbol}. Pending entry at ${signal.entryPrice.toFixed(5)}. ${signal.setupType} setup identified.`,
        expectedOutcome: `Expecting price to move to take profit at ${signal.takeProfit.toFixed(5)} (${signal.riskReward.toFixed(2)}:1 R:R) once trade is confirmed. Stop loss will be placed at ${signal.stopLoss.toFixed(5)}.`,
        patternIdentified: signal.setupType || 'AI Setup',
        convictionLevel: signal.confidence,
        rankAtTime: 'Autonomous AI'
      });

      if (journalEntryId) {
        console.log(`[Trade Execution] ✅ Journal entry created for pending trade: ${journalEntryId}`);
      } else {
        console.warn(`[Trade Execution] ⚠️ Failed to create journal entry for pending trade ${trade.id}`);
      }
    } catch (journalError) {
      console.error(`[Trade Execution] ❌ Exception creating journal entry for pending trade:`, journalError);
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
      type: 'signal',
      priority: 'urgent',
      title: `Trade Signal: ${signal.symbol}`,
      message: `${signal.setupType} detected. Confidence: ${signal.confidence}%. Entry: ${signal.entryPrice}, SL: ${signal.stopLoss}, TP: ${signal.takeProfit}`,
      metadata: { signal, tradeId: trade.id },
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
    const dollarPerPip = signal.positionSize * pipInfo.dollarPerPipPerLot; // Use symbol-specific calculation
    const riskDollars = riskPips * dollarPerPip;

    console.log(`[Playbook] Trade context: bucket=${regimeBucket}, playbook=${activePlaybook?.variant_id || 'none'}, risk=$${riskDollars.toFixed(2)}`);

    // CRITICAL FIX: Fetch LIVE price at execution time, not stale signal price
    const livePrice = await this.fetchLivePrice(signal.symbol);
    const executionBasePrice = livePrice?.price || signal.entryPrice;
    const priceSource = livePrice ? livePrice.source : 'signal';

    // Calculate price movement from signal to adjust entry/SL/TP accordingly
    const priceDifference = Math.abs(executionBasePrice - signal.entryPrice);
    const priceDiffPips = calculatePipDistance(signal.symbol, signal.entryPrice, executionBasePrice);

    console.log(`[Trade Execution] Price check: Signal=${signal.entryPrice.toFixed(5)}, Live=${executionBasePrice.toFixed(5)}, Diff=${priceDiffPips.toFixed(1)} pips`);

    // Always adjust SL and TP to maintain the same pip distances from the new entry
    // Never reject trades - adapt to current market price instead
    let adjustedSL = signal.stopLoss;
    let adjustedTP = signal.takeProfit;
    const useLivePrice = livePrice && priceDifference > (pipInfo.pipValue * 2);

    if (useLivePrice) {
      const adjustedLevels = this.adjustLevelsForNewEntry(
        signal.symbol,
        signal.entryPrice,
        executionBasePrice,
        signal.stopLoss,
        signal.takeProfit,
        signal.direction
      );
      adjustedSL = adjustedLevels.stopLoss;
      adjustedTP = adjustedLevels.takeProfit;
      console.log(`[Trade Execution] Levels adjusted for live price: SL=${adjustedSL.toFixed(5)}, TP=${adjustedTP.toFixed(5)}`);
    }

    // Apply realistic slippage to live entry price
    const actualEntryPrice = this.applySlippage(signal.symbol, executionBasePrice, signal.direction);
    const slippagePips = Math.abs(actualEntryPrice - executionBasePrice) / pipInfo.pipValue;
    const totalPriceShift = calculatePipDistance(signal.symbol, signal.entryPrice, actualEntryPrice);

    console.log(`[Trade Execution] LIVE EXECUTION: Signal=${signal.entryPrice.toFixed(5)} -> Live=${executionBasePrice.toFixed(5)} -> Final=${actualEntryPrice.toFixed(5)} (${priceSource})`);
    console.log(`[Trade Execution] Total shift from signal: ${totalPriceShift.toFixed(1)} pips | Slippage: ${slippagePips.toFixed(1)} pips`);

    // Recalculate risk with adjusted levels
    const finalRiskPips = Math.abs(actualEntryPrice - adjustedSL) / pipInfo.pipValue;
    const finalRiskDollars = finalRiskPips * dollarPerPip;

    // Insert trade with all required fields populated (using adjusted SL/TP)
    const tradeData = {
      goal_session_id: signal.sessionId,
      user_id: userId,
      symbol: signal.symbol,
      direction: signal.direction,
      entry_price: actualEntryPrice,
      stop_loss: adjustedSL,
      take_profit: adjustedTP,
      position_size: signal.positionSize,
      lot_size: signal.positionSize,
      status: 'open',
      order_type: 'market' as const,
      current_price: actualEntryPrice,
      current_pnl: 0,
      opened_at: new Date().toISOString(),
      playbook_id: activePlaybook?.id || null,
      regime_bucket: regimeBucket,
      risk_dollars: finalRiskDollars,
      ai_confidence: signal.confidence,
      ai_reasoning: signal.reasoning,
      ai_strategy_used: signal.setupType,
      // Dual TP system
      tp1_price: signal.tp1Price || null,
      tp2_price: signal.tp2Price || null,
      tp1_confidence: signal.tp1Confidence || null,
      tp1_reasoning: signal.tp1Reasoning || null,
      tp2_reasoning: signal.tp2Reasoning || null
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

    // CRITICAL FIX: Create journal entry for autonomous trading
    try {
      const journalEntryId = await llmReasoningLogger.logTradeEntry({
        userId: userId,
        tradeId: trade.id,
        sessionId: signal.sessionId,
        symbol: signal.symbol,
        direction: signal.direction,
        entryTime: new Date(),
        entryPrice: actualEntryPrice,
        stopLoss: adjustedSL,
        takeProfit: adjustedTP,
        llmReasoning: signal.reasoning || `AI took ${signal.direction.toUpperCase()} trade on ${signal.symbol} with ${signal.confidence}% confidence. Setup: ${signal.setupType}`,
        marketRead: `Market conditions evaluated for ${signal.symbol}. LIVE entry at ${actualEntryPrice.toFixed(5)} (signal was ${signal.entryPrice.toFixed(5)}, shift: ${totalPriceShift.toFixed(1)} pips). ${signal.setupType} setup identified.`,
        expectedOutcome: `Expecting price to move to take profit at ${adjustedTP.toFixed(5)} (${signal.riskReward.toFixed(2)}:1 R:R). Stop loss placed at ${adjustedSL.toFixed(5)}.`,
        patternIdentified: signal.setupType || 'AI Setup',
        convictionLevel: signal.confidence,
        rankAtTime: 'Autonomous AI'
      });

      if (journalEntryId) {
        console.log(`[Trade Execution] ✅ Journal entry created: ${journalEntryId}`);
      } else {
        console.warn(`[Trade Execution] ⚠️ Failed to create journal entry for trade ${trade.id}`);
      }
    } catch (journalError) {
      console.error(`[Trade Execution] ❌ Exception creating journal entry:`, journalError);
    }

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
      sl: adjustedSL,
      tp: adjustedTP,
      size: signal.positionSize,
      confidence: `${signal.confidence}%`,
      setup: signal.setupType,
      priceShift: `${totalPriceShift.toFixed(1)} pips from signal`
    });

    await supabase
      .from('goal_sessions')
      .update({ status: 'in_trade' })
      .eq('id', signal.sessionId);

    // Build TP message based on whether dual TP system is used
    const tpMessage = trade.tp1_price && trade.tp2_price
      ? `TP1 (Conservative): ${trade.tp1_price.toFixed(5)}${trade.tp1_confidence ? ` (${trade.tp1_confidence}% likely)` : ''}, TP2 (Full): ${trade.tp2_price.toFixed(5)}`
      : `Take Profit: ${adjustedTP.toFixed(5)}`;

    await goalSessionManager.addAIMessage(
      signal.sessionId,
      userId,
      `Trade executed on ${signal.symbol}! ${signal.direction.toUpperCase()} at ${actualEntryPrice.toFixed(5)}. ${signal.setupType} setup with ${signal.confidence}% confidence. Stop Loss: ${adjustedSL.toFixed(5)}, ${tpMessage}. Expected R:R = ${signal.riskReward.toFixed(2)}:1 ($${signal.expectedProfit.toFixed(2)})`,
      { signal, trade, actualEntryPrice, adjustedSL, adjustedTP },
      'encouraging'
    );

    // Build notification message with dual TP info
    const notificationTpMessage = trade.tp1_price && trade.tp2_price
      ? `TP1: ${trade.tp1_price.toFixed(5)}, TP2: ${trade.tp2_price.toFixed(5)}`
      : `TP: ${adjustedTP.toFixed(5)}`;

    const { error: notificationError } = await supabase.from('goal_notifications').insert({
      goal_session_id: signal.sessionId,
      user_id: userId,
      type: 'trade_entry',
      priority: 'urgent',
      title: `Trade Executed: ${signal.symbol}`,
      message: `${signal.direction.toUpperCase()} trade opened at ${actualEntryPrice.toFixed(5)}. SL: ${adjustedSL.toFixed(5)}, ${notificationTpMessage}. Expected R:R = ${signal.riskReward.toFixed(2)}:1`,
      metadata: {
        signal,
        tradeId: trade.id,
        trade_data: {
          symbol: signal.symbol,
          direction: signal.direction,
          entry_price: actualEntryPrice,
          stop_loss: adjustedSL,
          take_profit: adjustedTP,
          lot_size: signal.positionSize,
          confidence: signal.confidence,
          setup_type: signal.setupType,
          price_shift_pips: totalPriceShift,
          tp1_price: trade.tp1_price || null,
          tp2_price: trade.tp2_price || null,
          tp1_confidence: trade.tp1_confidence || null
        }
      },
      channels: ['in_app']
    });

    if (notificationError) {
      console.error('[Trade Execution] CRITICAL: Failed to log notification:', notificationError);
      prodLogger.error('trade_execution', 'Failed to insert notification', { error: notificationError, signal });
    } else {
      console.log('[Trade Execution] ✅ Notification logged successfully for', signal.symbol);
    }

    // Trigger immediate trade entry modal with ACTUAL execution values
    globalDialogManager.showTradeEntry({
      symbol: signal.symbol,
      direction: signal.direction,
      entryPrice: actualEntryPrice,
      stopLoss: adjustedSL,
      takeProfit: adjustedTP,
      lotSize: signal.positionSize,
      confidence: signal.confidence,
      priority: signal.confidence >= 85 ? 'urgent' : signal.confidence >= 75 ? 'high' : 'medium',
      setupType: signal.setupType,
      reasoning: signal.reasoning,
      expectedProfit: signal.expectedProfit,
      riskReward: signal.riskReward,
      autoExecuted: true,
      goal_session_id: signal.sessionId,
      // Dual TP system from created trade
      tp1: trade.tp1_price || undefined,
      tp2: trade.tp2_price || undefined,
      tp1Confidence: trade.tp1_confidence || undefined
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
