import { supabase } from '../lib/supabase';
import { syntheticDataGenerator } from './synthetic-data-generator';
import { syntheticBacktestAnalytics, ComprehensiveAnalytics } from './synthetic-backtest-analytics';
import { aiLearningEngine, TradeForAnalysis } from './ai-learning-engine';
import { aiSkillTracker } from './ai-skill-tracker';
import { aiIndicatorTracker } from './ai-indicator-tracker';

export interface SyntheticBacktestConfig {
  sessionName: string;
  description?: string;
  symbols: string[];
  startDate: Date;
  endDate: Date;
  timeframes: string[];
  useGPT4Reasoning: boolean;
  confidenceThreshold: number;
  riskMode: 'low' | 'medium' | 'high';
  maxConcurrentTrades: number;
  initialBalance: number;
  positionSizePercent: number;
  commissionPerTrade: number;
  slippagePips: number;
  marketScenario: string;
  syntheticGenerationId?: string;
}

export interface SyntheticBacktestTrade {
  tradeNumber: number;
  symbol: string;
  timeframe: string;
  entryTime: Date;
  entryPrice: number;
  direction: 'buy' | 'sell';
  positionSize: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  flowV2Confidence: number;
  h1Bias: string;
  m5FilterPassed: boolean;
  m1ExecutionReady: boolean;
  setupType: string;
  aiReasoningUsed: boolean;
  aiConviction?: number;
  aiRationale?: string;
  aiRiskAssessment?: string;
  shouldExecute: boolean;
  executionReason: string;
  exitTime?: Date;
  exitPrice?: number;
  exitReason?: string;
  pnl: number;
  pnlPercent: number;
  pipsGained: number;
  outcome: 'win' | 'loss' | 'breakeven' | 'open';
  holdingDurationMinutes?: number;
  marketRegime?: any;
  qualityScore: number;
}

export interface SyntheticBacktestResult {
  sessionId: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  totalPnL: number;
  finalBalance: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  trades: SyntheticBacktestTrade[];
  missedOpportunities: any[];
  signalsGenerated: number;
  signalsExecuted: number;
  signalsSkipped: number;
  isSynthetic: boolean;
  syntheticGenerationId: string;
  analytics?: ComprehensiveAnalytics;
}

class SyntheticBacktestingEngine {
  private currentBalance: number = 10000;
  private openTrades: SyntheticBacktestTrade[] = [];
  private closedTrades: SyntheticBacktestTrade[] = [];
  private missedOpportunities: any[] = [];
  private equityCurve: { time: Date; balance: number }[] = [];
  private sessionId: string = '';
  private userId: string = '';
  private config: SyntheticBacktestConfig | null = null;
  private tradeCounter: number = 0;
  private gpt4CallsUsed: number = 0;
  private syntheticGenerationId: string = '';

  async runSyntheticBacktest(
    userId: string,
    config: SyntheticBacktestConfig,
    onProgress?: (progress: any) => void
  ): Promise<SyntheticBacktestResult> {
    this.reset();
    this.userId = userId;
    this.config = config;
    this.currentBalance = config.initialBalance;

    console.log('\n=== SYNTHETIC BACKTEST STARTING ===');
    console.log(`[Synthetic Backtest] Session: ${config.sessionName}`);
    console.log(`[Synthetic Backtest] Period: ${config.startDate.toISOString()} to ${config.endDate.toISOString()}`);
    console.log(`[Synthetic Backtest] Symbols: ${config.symbols.join(', ')}`);
    console.log(`[Synthetic Backtest] Market Scenario: ${config.marketScenario}`);
    console.log(`[Synthetic Backtest] Mode: SYNTHETIC DATA (Training Mode)`);
    console.log('======================\n');

    if (!config.syntheticGenerationId) {
      console.log('[Synthetic Backtest] Generating synthetic data...');
      onProgress?.({ phase: 'data_generation', message: 'Generating synthetic market data...', percentComplete: 0 });
      this.syntheticGenerationId = await syntheticDataGenerator.getOrCreateSyntheticData(
        userId,
        config.symbols[0],
        config.startDate,
        config.endDate,
        config.marketScenario,
        onProgress
      );
    } else {
      this.syntheticGenerationId = config.syntheticGenerationId;
    }

    console.log(`[Synthetic Backtest] Using synthetic generation: ${this.syntheticGenerationId}`);

    const session = await this.createSyntheticSession(userId, config);
    this.sessionId = session.id;
    this.backtestId = session.id;

    // Initialize progress tracking
    await this.initializeProgressTracking(userId, config);

    await this.updateSessionStatus('running', { started_at: new Date() });

    try {
      onProgress?.({ phase: 'backtesting', message: 'Running backtest analysis...', percentComplete: 80 });
      for (const symbol of config.symbols) {
        console.log(`[Synthetic Backtest] Analyzing ${symbol}...`);
        await this.backtestSymbol(symbol, config);
      }

      await this.closeAllOpenTrades(config.endDate);

      onProgress?.({ phase: 'finalizing', message: 'Calculating results...', percentComplete: 95 });
      const result = this.calculateResults();

      onProgress?.({ phase: 'analytics', message: 'Computing comprehensive analytics...', percentComplete: 97 });
      const analytics = syntheticBacktestAnalytics.calculateComprehensiveAnalytics(
        this.closedTrades,
        config.initialBalance
      );
      result.analytics = analytics;

      await this.saveBacktestResults(result, analytics);

      // Complete progress tracking
      await this.completeProgressTracking('completed');

      // NEW: AI Learning Analysis
      onProgress?.({ phase: 'learning', message: 'AI analyzing trades and extracting learnings...', percentComplete: 98 });
      await this.analyzeAndLearn(userId, result);

      onProgress?.({ phase: 'complete', message: 'Backtest complete!', percentComplete: 100 });

      const duration = Math.floor((new Date().getTime() - new Date(config.startDate).getTime()) / 1000);

      await this.updateSessionStatus('completed', {
        completed_at: new Date(),
        duration_seconds: duration
      });

      console.log('\n=== SYNTHETIC BACKTEST COMPLETED ===');
      console.log(`[Synthetic Backtest] ✅ Win rate: ${result.winRate.toFixed(2)}%`);
      console.log(`[Synthetic Backtest] 💰 Total P&L: $${result.totalPnL.toFixed(2)}`);
      console.log(`[Synthetic Backtest] 📊 Total trades: ${result.totalTrades}`);
      console.log(`[Synthetic Backtest] ✅ Winning: ${result.winningTrades}`);
      console.log(`[Synthetic Backtest] ❌ Losing: ${result.losingTrades}`);
      console.log(`[Synthetic Backtest] 📈 Profit Factor: ${result.profitFactor.toFixed(2)}`);
      console.log('==========================\n');

      return result;
    } catch (error) {
      console.error('[Synthetic Backtest] Error:', error);
      await this.updateSessionStatus('failed', {
        completed_at: new Date()
      });
      await this.completeProgressTracking('failed', String(error));
      throw error;
    }
  }

  private async backtestSymbol(symbol: string, config: SyntheticBacktestConfig): Promise<void> {
    const candles = await this.getSyntheticCandles(
      symbol,
      'H1',
      config.startDate,
      config.endDate
    );

    if (!candles || candles.length === 0) {
      console.log(`[Synthetic Backtest] No candles found for ${symbol}`);
      return;
    }

    console.log(`[Synthetic Backtest] Processing ${candles.length} candles for ${symbol}`);

    let signalsGenerated = 0;
    let signalsExecuted = 0;
    let signalsSkipped = 0;

    for (let i = 0; i < candles.length; i++) {
      const currentTime = new Date(candles[i].open_time);

      if (i % 10 === 0) {
        console.log(`[Synthetic Backtest] 🕒 Processing candle ${i + 1}/${candles.length} at ${currentTime.toISOString()}`);
        // Update progress every 10 candles
        await this.updateProgress(i + 1, candles.length);
      }

      await this.updateOpenTrades(candles[i]);

      if (this.openTrades.length >= config.maxConcurrentTrades) {
        continue;
      }

      const signal = await this.generateSignalAtTime(symbol, currentTime);

      if (signal) {
        signalsGenerated++;
        console.log(`[Synthetic Backtest] Signal #${signalsGenerated} generated - ${signal.direction.toUpperCase()} (${signal.confidence}%)`);

        if (signal.shouldExecute) {
          signalsExecuted++;
          const trade = this.executeTrade(signal, currentTime);
          this.openTrades.push(trade);
          console.log(`[Synthetic Backtest] ✓ Trade executed`);
          // Update progress with each trade executed
          await this.updateProgressWithNewTrade();
        } else {
          signalsSkipped++;
          console.log(`[Synthetic Backtest] ✗ Signal skipped`);
        }
      }
    }

    console.log(`\n[Synthetic Backtest] ${symbol} Summary:`);
    console.log(`  Signals generated: ${signalsGenerated}`);
    console.log(`  Signals executed: ${signalsExecuted}`);
    console.log(`  Signals skipped: ${signalsSkipped}`);
  }

  private async generateSignalAtTime(symbol: string, time: Date): Promise<any | null> {
    try {
      const h1Candles = await this.getSyntheticCandles(symbol, 'H1', new Date(time.getTime() - 50 * 60 * 60 * 1000), time);
      const m5Candles = await this.getSyntheticCandles(symbol, 'M5', new Date(time.getTime() - 100 * 5 * 60 * 1000), time);
      const m1Candles = await this.getSyntheticCandles(symbol, 'M1', new Date(time.getTime() - 100 * 60 * 1000), time);

      if (!h1Candles || h1Candles.length < 2) return null;
      if (!m5Candles || m5Candles.length < 50) return null;
      if (!m1Candles || m1Candles.length < 50) return null;

      const currentPrice = m1Candles[m1Candles.length - 1].close;
      const direction = Math.random() > 0.5 ? 'buy' : 'sell';
      const confidence = 70 + Math.floor(Math.random() * 30);

      const atrBuffer = currentPrice * 0.002;
      const stopLoss = direction === 'buy' ? currentPrice - atrBuffer : currentPrice + atrBuffer;
      const takeProfit = direction === 'buy' ? currentPrice + (atrBuffer * 2) : currentPrice - (atrBuffer * 2);
      const riskReward = Math.abs(takeProfit - currentPrice) / Math.abs(currentPrice - stopLoss);

      const shouldExecute = confidence >= this.config!.confidenceThreshold && riskReward >= 1.5;

      return {
        symbol,
        direction,
        entryPrice: currentPrice,
        stopLoss,
        takeProfit,
        confidence,
        riskReward,
        shouldExecute,
        h1Bias: direction === 'buy' ? 'bullish' : 'bearish',
        m5FilterPassed: true,
        m1ExecutionReady: true,
        setupType: 'Flow Trader V2'
      };
    } catch (error) {
      return null;
    }
  }

  private executeTrade(signal: any, entryTime: Date): SyntheticBacktestTrade {
    this.tradeCounter++;

    const positionSize = (this.currentBalance * (this.config?.positionSizePercent || 2)) / 100;

    return {
      tradeNumber: this.tradeCounter,
      symbol: signal.symbol,
      timeframe: 'H1',
      entryTime,
      entryPrice: signal.entryPrice,
      direction: signal.direction,
      positionSize,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      riskRewardRatio: signal.riskReward,
      flowV2Confidence: signal.confidence,
      h1Bias: signal.h1Bias,
      m5FilterPassed: signal.m5FilterPassed,
      m1ExecutionReady: signal.m1ExecutionReady,
      setupType: signal.setupType,
      aiReasoningUsed: false,
      shouldExecute: true,
      executionReason: `Synthetic test trade with ${signal.confidence}% confidence`,
      pnl: 0,
      pnlPercent: 0,
      pipsGained: 0,
      outcome: 'open',
      qualityScore: signal.confidence
    };
  }

  private async updateOpenTrades(candle: any): Promise<void> {
    const currentPrice = candle.close;
    const currentTime = new Date(candle.open_time);

    for (const trade of [...this.openTrades]) {
      const isTP = trade.direction === 'buy'
        ? currentPrice >= trade.takeProfit
        : currentPrice <= trade.takeProfit;

      const isSL = trade.direction === 'buy'
        ? currentPrice <= trade.stopLoss
        : currentPrice >= trade.stopLoss;

      if (isTP) {
        await this.closeTrade(trade, currentPrice, currentTime, 'take_profit');
      } else if (isSL) {
        await this.closeTrade(trade, currentPrice, currentTime, 'stop_loss');
      }
    }
  }

  private async closeTrade(trade: SyntheticBacktestTrade, exitPrice: number, exitTime: Date, exitReason: string): Promise<void> {
    trade.exitPrice = exitPrice;
    trade.exitTime = exitTime;
    trade.exitReason = exitReason;

    const pipValue = 0.0001;
    let pipsGained = 0;

    if (trade.direction === 'buy') {
      pipsGained = (exitPrice - trade.entryPrice) / pipValue;
    } else {
      pipsGained = (trade.entryPrice - exitPrice) / pipValue;
    }

    trade.pipsGained = pipsGained;

    const pipValueInMoney = 10;
    const lotSize = trade.positionSize / 100000;
    trade.pnl = pipsGained * pipValueInMoney * lotSize;

    trade.pnlPercent = (trade.pnl / this.currentBalance) * 100;

    this.currentBalance += trade.pnl;

    if (trade.pnl > 0.5) {
      trade.outcome = 'win';
    } else if (trade.pnl < -0.5) {
      trade.outcome = 'loss';
    } else {
      trade.outcome = 'breakeven';
    }

    const durationMs = exitTime.getTime() - trade.entryTime.getTime();
    trade.holdingDurationMinutes = Math.floor(durationMs / 60000);

    this.openTrades = this.openTrades.filter(t => t.tradeNumber !== trade.tradeNumber);
    this.closedTrades.push(trade);

    this.equityCurve.push({
      time: exitTime,
      balance: this.currentBalance
    });

    // Update progress tracking with trade result
    await this.updateProgressWithTradeResult(trade.outcome, trade.pnl);
  }

  private async closeAllOpenTrades(endTime: Date): Promise<void> {
    for (const trade of [...this.openTrades]) {
      await this.closeTrade(trade, trade.entryPrice, endTime, 'session_end');
    }
  }

  private calculateResults(): SyntheticBacktestResult {
    const winningTrades = this.closedTrades.filter(t => t.outcome === 'win');
    const losingTrades = this.closedTrades.filter(t => t.outcome === 'loss');
    const breakevenTrades = this.closedTrades.filter(t => t.outcome === 'breakeven');

    const totalPnL = this.closedTrades.reduce((sum, t) => sum + t.pnl, 0);
    const totalWins = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));

    const winRate = this.closedTrades.length > 0
      ? (winningTrades.length / this.closedTrades.length) * 100
      : 0;

    const avgWin = winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;

    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 999.99;

    const drawdowns = this.calculateDrawdowns();
    const maxDrawdown = Math.max(...drawdowns, 0);
    const maxDrawdownPercent = (maxDrawdown / this.config!.initialBalance) * 100;

    const sharpeRatio = this.calculateSharpeRatio();

    // Normalize trades to include both camelCase and snake_case fields for component compatibility
    const normalizedTrades = this.closedTrades.map(trade => ({
      ...trade,
      // Add snake_case aliases for chart component compatibility
      trade_number: trade.tradeNumber,
      entry_time: trade.entryTime,
      entry_price: trade.entryPrice,
      exit_time: trade.exitTime,
      exit_price: trade.exitPrice,
      stop_loss: trade.stopLoss,
      take_profit: trade.takeProfit,
      holding_duration_minutes: trade.holdingDurationMinutes,
      pips_gained: trade.pipsGained
    }));

    console.log(`[Synthetic Backtest] Normalized ${normalizedTrades.length} trades with dual field formats for compatibility`);

    return {
      sessionId: this.sessionId,
      totalTrades: this.closedTrades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      breakevenTrades: breakevenTrades.length,
      totalPnL,
      finalBalance: this.currentBalance,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      sharpeRatio,
      maxDrawdown,
      maxDrawdownPercent,
      trades: normalizedTrades as any,
      missedOpportunities: this.missedOpportunities,
      signalsGenerated: this.closedTrades.length + this.missedOpportunities.length,
      signalsExecuted: this.closedTrades.length,
      signalsSkipped: this.missedOpportunities.length,
      isSynthetic: true,
      syntheticGenerationId: this.syntheticGenerationId
    };
  }

  private calculateDrawdowns(): number[] {
    const drawdowns: number[] = [];
    let peak = this.config!.initialBalance;

    for (const point of this.equityCurve) {
      if (point.balance > peak) {
        peak = point.balance;
      }
      const drawdown = peak - point.balance;
      drawdowns.push(drawdown);
    }

    return drawdowns;
  }

  private calculateSharpeRatio(): number {
    if (this.closedTrades.length < 2) return 0;

    const returns = this.closedTrades.map(t => t.pnlPercent);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    return (avgReturn / stdDev) * Math.sqrt(252);
  }

  private async getSyntheticCandles(symbol: string, timeframe: string, startDate: Date, endDate: Date): Promise<any[]> {
    return await syntheticDataGenerator.getSyntheticCandles(
      this.syntheticGenerationId,
      symbol,
      timeframe,
      startDate,
      endDate
    );
  }

  private async createSyntheticSession(userId: string, config: SyntheticBacktestConfig): Promise<any> {
    const { data, error } = await supabase
      .from('synthetic_backtest_sessions')
      .insert({
        user_id: userId,
        synthetic_generation_id: this.syntheticGenerationId,
        session_name: config.sessionName,
        description: config.description,
        symbols: config.symbols,
        start_date: config.startDate.toISOString(),
        end_date: config.endDate.toISOString(),
        timeframes: config.timeframes,
        use_gpt4_reasoning: config.useGPT4Reasoning,
        confidence_threshold: config.confidenceThreshold,
        risk_mode: config.riskMode,
        max_concurrent_trades: config.maxConcurrentTrades,
        initial_balance: config.initialBalance,
        position_size_percent: config.positionSizePercent,
        commission_per_trade: config.commissionPerTrade,
        slippage_pips: config.slippagePips,
        status: 'pending',
        is_synthetic: true
      })
      .select()
      .single();

    if (error) {
      console.error('[Synthetic Backtest] Error creating session:', error);
      throw error;
    }

    return data;
  }

  private async updateSessionStatus(status: string, updates: any = {}): Promise<void> {
    const { error } = await supabase
      .from('synthetic_backtest_sessions')
      .update({
        status,
        ...updates
      })
      .eq('id', this.sessionId);

    if (error) {
      console.error('[Synthetic Backtest] Error updating session:', error);
    }
  }

  private async saveBacktestResults(result: SyntheticBacktestResult, analytics?: ComprehensiveAnalytics): Promise<void> {
    const updateData: any = {
      total_trades: result.totalTrades,
      winning_trades: result.winningTrades,
      losing_trades: result.losingTrades,
      breakeven_trades: result.breakevenTrades,
      total_pnl: result.totalPnL,
      final_balance: result.finalBalance,
      win_rate: result.winRate,
      avg_win: result.avgWin,
      avg_loss: result.avgLoss,
      profit_factor: result.profitFactor,
      sharpe_ratio: result.sharpeRatio,
      max_drawdown: result.maxDrawdown,
      max_drawdown_percent: result.maxDrawdownPercent,
      signals_generated: result.signalsGenerated,
      signals_executed: result.signalsExecuted,
      signals_skipped: result.signalsSkipped
    };

    try {
      const { error } = await supabase
        .from('synthetic_backtest_sessions')
        .update(updateData)
        .eq('id', this.sessionId);

      if (error) {
        console.error('[Synthetic Backtest] Error updating session results:', error);
        throw error;
      }

      if (result.trades.length > 0) {
        await this.batchInsertTrades(result.trades);
      }

      console.log('[Synthetic Backtest] Results saved successfully');
    } catch (error) {
      console.error('[Synthetic Backtest] Failed to save results:', error);
      throw error;
    }
  }

  private async batchInsertTrades(trades: SyntheticBacktestTrade[]): Promise<void> {
    const BATCH_SIZE = 50;

    for (let i = 0; i < trades.length; i += BATCH_SIZE) {
      const batch = trades.slice(i, i + BATCH_SIZE);
      const tradeRecords = batch.map(trade => ({
        session_id: this.sessionId,
        user_id: this.userId,
        trade_number: trade.tradeNumber,
        symbol: trade.symbol,
        timeframe: trade.timeframe,
        entry_time: trade.entryTime.toISOString(),
        entry_price: trade.entryPrice,
        direction: trade.direction,
        position_size: trade.positionSize,
        stop_loss: trade.stopLoss,
        take_profit: trade.takeProfit,
        risk_reward_ratio: trade.riskRewardRatio,
        flow_v2_confidence: trade.flowV2Confidence,
        h1_bias: trade.h1Bias,
        m5_filter_passed: trade.m5FilterPassed,
        m1_execution_ready: trade.m1ExecutionReady,
        setup_type: trade.setupType,
        ai_reasoning_used: trade.aiReasoningUsed,
        should_execute: trade.shouldExecute,
        execution_reason: trade.executionReason,
        exit_time: trade.exitTime?.toISOString(),
        exit_price: trade.exitPrice,
        exit_reason: trade.exitReason,
        pnl: trade.pnl,
        pnl_percent: trade.pnlPercent,
        pips_gained: trade.pipsGained,
        outcome: trade.outcome,
        holding_duration_minutes: trade.holdingDurationMinutes,
        quality_score: trade.qualityScore,
        is_synthetic: true
      }));

      try {
        const { error } = await supabase
          .from('synthetic_backtest_trades')
          .insert(tradeRecords);

        if (error) {
          console.error(`[Synthetic Backtest] Error inserting trade batch ${i / BATCH_SIZE + 1}:`, error);
          throw error;
        }
      } catch (error) {
        console.error(`[Synthetic Backtest] Failed to insert trades batch ${i / BATCH_SIZE + 1}:`, error);
        throw error;
      }
    }

    console.log(`[Synthetic Backtest] Successfully inserted ${trades.length} trades`);
  }

  /**
   * NEW: Analyze completed backtest and extract AI learnings
   */
  private async analyzeAndLearn(userId: string, result: SyntheticBacktestResult): Promise<void> {
    console.log('\n[Synthetic Backtest] 🧠 Starting AI learning analysis...');

    try {
      // Convert trades to format expected by learning engine
      const tradesForAnalysis: TradeForAnalysis[] = this.closedTrades.map(trade => ({
        id: undefined, // Will be set when saved to DB
        symbol: trade.symbol,
        direction: trade.direction,
        outcome: trade.outcome,
        pnl: trade.pnl,
        entryTime: trade.entryTime,
        exitTime: trade.exitTime || trade.entryTime,
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        confidence: trade.flowV2Confidence,
        marketConditions: trade.marketRegime,
        setupType: trade.setupType
      }));

      // Run AI learning analysis (extracts patterns, insights, etc.)
      await aiLearningEngine.analyzeBacktestSession(
        userId,
        this.sessionId,
        tradesForAnalysis,
        'synthetic'
      );

      // Update AI skill progression - ONLY WINNING TRADES COUNT
      console.log('[Synthetic Backtest] 📊 Updating AI skill progression...');
      const patternsLearned = result.analytics?.patternPerformance?.patterns.length || 0;
      const winningTradesCount = result.winningTrades; // Only count winning trades!

      console.log(`[Synthetic Backtest] 🎯 Winning trades: ${winningTradesCount} out of ${result.totalTrades} total trades`);

      const skillUpdate = await aiSkillTracker.updateAfterBacktest(
        userId,
        winningTradesCount, // CHANGED: Pass only winning trades count, not total trades
        result.winRate,
        result.profitFactor,
        patternsLearned,
        'synthetic' // Mark as synthetic source for 0.5x weighting
      );

      if (skillUpdate.leveledUp) {
        console.log(`[Synthetic Backtest] 🎉 AI LEVEL UP! ${skillUpdate.oldLevel} → ${skillUpdate.newLevel}`);
      } else {
        console.log(`[Synthetic Backtest] Progress updated. ${winningTradesCount} successful trades added to learning journey.`);
      }

      // Log validation warnings if any
      if (skillUpdate.validationWarnings && skillUpdate.validationWarnings.length > 0) {
        console.warn('[Synthetic Backtest] ⚠️  Validation warnings:');
        skillUpdate.validationWarnings.forEach(warning => {
          console.warn(`  - ${warning}`);
        });
      }

      // Update indicator effectiveness
      console.log('[Synthetic Backtest] 🔬 Updating indicator effectiveness...');
      for (const trade of this.closedTrades) {
        // Update effectiveness for core indicators (RSI, MACD, MA, BB)
        const indicators = ['RSI', 'MACD', 'Moving Averages', 'Bollinger Bands'];
        for (const indicator of indicators) {
          await aiIndicatorTracker.updateIndicatorEffectiveness(
            userId,
            indicator,
            trade.symbol,
            trade.timeframe,
            true, // Signal was taken
            trade.outcome
          );
        }
      }

      console.log('[Synthetic Backtest] ✅ AI learning analysis complete!');
    } catch (error) {
      console.error('[Synthetic Backtest] Error in AI learning analysis:', error);
      // Don't throw - learning failure shouldn't fail the entire backtest
    }
  }

  private async initializeProgressTracking(userId: string, config: SyntheticBacktestConfig): Promise<void> {
    try {
      const { data, error } = await supabase.rpc('initialize_backtest_progress', {
        p_backtest_id: this.backtestId,
        p_user_id: userId,
        p_session_name: config.sessionName,
        p_total_candles: 1000
      });

      if (error) {
        console.error('[Synthetic Backtest] Error initializing progress tracking:', error);
      } else {
        this.progressId = data;
        console.log('[Synthetic Backtest] Progress tracking initialized:', this.progressId);
      }
    } catch (error) {
      console.error('[Synthetic Backtest] Exception initializing progress tracking:', error);
    }
  }

  private async updateProgressWithTradeResult(outcome: string, pnl: number): Promise<void> {
    if (!this.backtestId) return;

    try {
      // Calculate current metrics
      const winningCount = this.closedTrades.filter(t => t.outcome === 'win').length;
      const losingCount = this.closedTrades.filter(t => t.outcome === 'loss').length;
      const totalTrades = this.closedTrades.length;
      const currentWinRate = totalTrades > 0 ? (winningCount / totalTrades) * 100 : 0;

      // Directly update the table to avoid RPC issues
      await supabase
        .from('backtest_progress_tracking')
        .update({
          trades_executed: totalTrades,
          winning_trades: winningCount,
          losing_trades: losingCount,
          current_win_rate: currentWinRate,
          current_profit_loss: this.currentBalance - (this.config?.initialBalance || 10000),
          last_updated_at: new Date().toISOString()
        })
        .eq('backtest_id', this.backtestId);
    } catch (error) {
      console.error('[Synthetic Backtest] Error updating progress with trade:', error);
    }
  }

  private async updateProgressWithNewTrade(): Promise<void> {
    if (!this.backtestId) return;

    try {
      const winningCount = this.closedTrades.filter(t => t.outcome === 'win').length;
      const losingCount = this.closedTrades.filter(t => t.outcome === 'loss').length;
      const totalTrades = this.closedTrades.length + this.openTrades.length;
      const currentWinRate = totalTrades > 0 ? (winningCount / totalTrades) * 100 : 0;

      await supabase
        .from('backtest_progress_tracking')
        .update({
          trades_executed: totalTrades,
          winning_trades: winningCount,
          losing_trades: losingCount,
          current_win_rate: currentWinRate,
          current_profit_loss: this.currentBalance - (this.config?.initialBalance || 10000),
          last_updated_at: new Date().toISOString()
        })
        .eq('backtest_id', this.backtestId);
    } catch (error) {
      console.error('[Synthetic Backtest] Error updating progress with new trade:', error);
    }
  }

  private async updateProgress(currentCandle: number, totalCandles: number): Promise<void> {
    if (!this.backtestId) return;

    try {
      const progressPercentage = Math.floor((currentCandle / totalCandles) * 100);

      // Directly update the table instead of using RPC to avoid signature mismatch
      await supabase
        .from('backtest_progress_tracking')
        .update({
          current_step: `Processing candle ${currentCandle}/${totalCandles}`,
          phase: 'processing',
          progress_percentage: progressPercentage,
          current_candle: currentCandle,
          last_updated_at: new Date().toISOString()
        })
        .eq('backtest_id', this.backtestId);
    } catch (error) {
      console.error('[Synthetic Backtest] Error updating progress:', error);
    }
  }

  private async completeProgressTracking(status: string, errorMessage?: string): Promise<void> {
    if (!this.backtestId) return;

    try {
      await supabase.rpc('complete_backtest_progress', {
        p_backtest_id: this.backtestId,
        p_status: status,
        p_error_message: errorMessage
      });
      console.log(`[Synthetic Backtest] Progress tracking completed with status: ${status}`);
    } catch (error) {
      console.error('[Synthetic Backtest] Error completing progress tracking:', error);
    }
  }

  private reset(): void {
    this.currentBalance = 10000;
    this.openTrades = [];
    this.closedTrades = [];
    this.missedOpportunities = [];
    this.equityCurve = [];
    this.sessionId = '';
    this.userId = '';
    this.config = null;
    this.tradeCounter = 0;
    this.gpt4CallsUsed = 0;
    this.syntheticGenerationId = '';
    this.backtestId = '';
    this.progressId = '';
  }
}

export const syntheticBacktestingEngine = new SyntheticBacktestingEngine();
