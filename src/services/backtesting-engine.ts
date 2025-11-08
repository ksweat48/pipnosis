import { supabase } from '../lib/supabase';
import { flowTraderV2, FlowV2Signal } from '../strategies/flow-trader-v2';
import { autonomousReasoningEngine, ReasoningDecision } from './autonomous-reasoning-engine';

export interface BacktestConfig {
  sessionName: string;
  description?: string;
  symbols: string[];
  startDate: Date;
  endDate: Date;
  timeframes: string[];
  aiConfigId?: string;
  useGPT4Reasoning: boolean;
  confidenceThreshold: number;
  riskMode: 'low' | 'medium' | 'high';
  maxConcurrentTrades: number;
  initialBalance: number;
  positionSizePercent: number;
  commissionPerTrade: number;
  slippagePips: number;
}

export interface BacktestTrade {
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

export interface BacktestResult {
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
  trades: BacktestTrade[];
  missedOpportunities: any[];
  signalsGenerated: number;
  signalsExecuted: number;
  signalsSkipped: number;
}

class BacktestingEngine {
  private currentBalance: number = 10000;
  private openTrades: BacktestTrade[] = [];
  private closedTrades: BacktestTrade[] = [];
  private missedOpportunities: any[] = [];
  private equityCurve: { time: Date; balance: number }[] = [];
  private sessionId: string = '';
  private userId: string = '';
  private config: BacktestConfig | null = null;
  private tradeCounter: number = 0;
  private gpt4CallsUsed: number = 0;

  async runBacktest(
    userId: string,
    config: BacktestConfig
  ): Promise<BacktestResult> {
    this.reset();
    this.userId = userId;
    this.config = config;
    this.currentBalance = config.initialBalance;

    console.log('\n=== BACKTEST STARTING ===');
    console.log(`[Backtesting] Session: ${config.sessionName}`);
    console.log(`[Backtesting] Period: ${config.startDate.toISOString()} to ${config.endDate.toISOString()}`);
    console.log(`[Backtesting] Symbols: ${config.symbols.join(', ')}`);
    console.log(`[Backtesting] Mode: Independent (not using real-time aggregator)`);
    console.log('======================\n');

    // PRE-FLIGHT VALIDATION: Check data availability
    console.log('[Backtesting] Running pre-flight data validation...');
    const dataCheck = await this.validateDataAvailability(config);

    if (!dataCheck.isValid) {
      console.error('[Backtesting] Pre-flight check FAILED:');
      console.error(dataCheck.issues.join('\n'));
      throw new Error(`Data validation failed: ${dataCheck.issues.join('; ')}`);
    }

    console.log('[Backtesting] ✅ Pre-flight check PASSED');
    console.log(`[Backtesting] Available data: ${JSON.stringify(dataCheck.stats, null, 2)}\n`);

    const session = await this.createBacktestSession(userId, config);
    this.sessionId = session.id;

    await this.updateSessionStatus('running', { started_at: new Date() });

    try {
      for (const symbol of config.symbols) {
        console.log(`[Backtesting] Analyzing ${symbol}...`);
        await this.backtestSymbol(symbol, config);
      }

      await this.closeAllOpenTrades(config.endDate);

      const result = this.calculateResults();

      await this.saveBacktestResults(result);

      await this.updateSessionStatus('completed', {
        completed_at: new Date(),
        ...result
      });

      console.log('\n=== BACKTEST COMPLETED ===');
      console.log(`[Backtesting] ✅ Win rate: ${result.winRate.toFixed(2)}%`);
      console.log(`[Backtesting] 💰 Total P&L: $${result.totalPnL.toFixed(2)}`);
      console.log(`[Backtesting] 📊 Total trades: ${result.totalTrades}`);
      console.log(`[Backtesting] ✅ Winning: ${result.winningTrades}`);
      console.log(`[Backtesting] ❌ Losing: ${result.losingTrades}`);
      console.log(`[Backtesting] 📈 Profit Factor: ${result.profitFactor.toFixed(2)}`);
      console.log('==========================\n');

      return result;
    } catch (error) {
      console.error('[Backtesting] Error:', error);
      await this.updateSessionStatus('failed', {
        completed_at: new Date()
      });
      throw error;
    }
  }

  private async backtestSymbol(symbol: string, config: BacktestConfig): Promise<void> {
    const candles = await this.getHistoricalCandles(
      symbol,
      config.startDate,
      config.endDate
    );

    if (!candles || candles.length === 0) {
      console.log(`[Backtesting] No candles found for ${symbol}`);
      return;
    }

    console.log(`[Backtesting] Processing ${candles.length} candles for ${symbol}`);
    console.log(`[Backtesting] Date range: ${candles[0].open_time} to ${candles[candles.length - 1].open_time}`);

    let signalsExamined = 0;
    let signalsGenerated = 0;
    let signalsExecuted = 0;
    let signalsSkipped = 0;

    for (let i = 0; i < candles.length; i++) {
      const currentTime = new Date(candles[i].open_time);

      // Log progress at key intervals
      if (i % 50 === 0 || i === 0) {
        console.log(`[Backtesting] 🕒 Processing candle ${i + 1}/${candles.length} at ${currentTime.toISOString()}`);
      }

      this.updateOpenTrades(candles[i]);

      if (this.openTrades.length >= config.maxConcurrentTrades) {
        continue;
      }

      signalsExamined++;
      const signal = await this.generateSignalAtTime(symbol, currentTime);

      if (signal) {
        signalsGenerated++;
        console.log(`[Backtesting] Signal #${signalsGenerated} generated at ${currentTime.toISOString()} - ${signal.direction.toUpperCase()} ${symbol} (${signal.confidence}% confidence)`);

        const decision = await this.evaluateSignal(signal, config);

        if (decision.shouldExecute) {
          signalsExecuted++;
          const trade = this.executeTrade(signal, decision, currentTime);
          this.openTrades.push(trade);
          console.log(`[Backtesting] ✓ Trade executed: ${signal.direction.toUpperCase()} @ ${signal.entryPrice.toFixed(5)}`);
        } else {
          signalsSkipped++;
          this.recordMissedOpportunity(signal, decision, currentTime);
          console.log(`[Backtesting] ✗ Signal skipped: ${decision.rationale}`);
        }
      }

      if (i % 100 === 0 && i > 0) {
        const progressPercent = Math.round((i / candles.length) * 100);
        console.log(`[Backtesting] 📊 Progress: ${i}/${candles.length} candles (${progressPercent}%) | Signals: ${signalsGenerated} generated, ${signalsExecuted} executed, ${signalsSkipped} skipped`);
        await this.updateSessionProgress(i, candles.length);
      }
    }

    console.log(`\n[Backtesting] ${symbol} Summary:`);
    console.log(`  Candles examined: ${candles.length}`);
    console.log(`  Potential signals examined: ${signalsExamined}`);
    console.log(`  Signals generated: ${signalsGenerated} (${((signalsGenerated/signalsExamined)*100).toFixed(2)}%)`);
    console.log(`  Signals executed: ${signalsExecuted}`);
    console.log(`  Signals skipped: ${signalsSkipped}`);
  }

  private async generateSignalAtTime(
    symbol: string,
    time: Date
  ): Promise<FlowV2Signal | null> {
    try {
      // Pass the historical time to Flow V2 so it only analyzes data up to that point
      const signal = await flowTraderV2.analyzeSetup(symbol, this.sessionId, time);
      return signal;
    } catch (error) {
      // Silently handle errors during backtesting - many timepoints won't generate signals
      if (error instanceof Error && !error.message.includes('insufficient data')) {
        console.warn(`[Backtesting] Signal generation issue for ${symbol} at ${time.toISOString()}:`, error.message);
      }
      return null;
    }
  }

  private async evaluateSignal(
    signal: FlowV2Signal,
    config: BacktestConfig
  ): Promise<ReasoningDecision & { shouldExecute: boolean }> {
    if (config.useGPT4Reasoning && this.gpt4CallsUsed < 100) {
      try {
        const decision = await autonomousReasoningEngine.reasonAboutSignal(
          signal,
          this.sessionId,
          this.userId,
          {
            risk_mode: config.riskMode,
            max_concurrent_trades: config.maxConcurrentTrades,
            goal_type: 'backtest',
            target_value: 0,
            timeframe: '1h'
          },
          this.openTrades
        );

        this.gpt4CallsUsed++;
        return decision;
      } catch (error) {
        console.error('[Backtesting] GPT-4 reasoning failed, using fallback:', error);
      }
    }

    const thresholds = {
      low: 85,
      medium: 75,
      high: 70
    };

    const threshold = thresholds[config.riskMode];
    const meetsThreshold = signal.confidence >= threshold;
    const canAddTrade = this.openTrades.length < config.maxConcurrentTrades;
    const goodRR = signal.riskReward >= 1.5;

    const shouldExecute = meetsThreshold && canAddTrade && goodRR;

    let rationale = '';
    if (!meetsThreshold) {
      rationale = `Signal confidence ${signal.confidence}% below ${config.riskMode} mode threshold (${threshold}%). Skipped.`;
    } else if (!canAddTrade) {
      rationale = `Maximum concurrent trades (${config.maxConcurrentTrades}) reached.`;
    } else if (!goodRR) {
      rationale = `Risk:reward ratio ${signal.riskReward.toFixed(2)} below minimum 1.5.`;
    } else {
      rationale = `Flow V2 signal meets all criteria. Executing with ${signal.confidence}% confidence.`;
    }

    return {
      strategySelected: 'flow_v2',
      conviction: signal.confidence,
      rationale,
      shouldExecute,
      riskAssessment: signal.confidence >= 80 ? 'Acceptable' : 'Elevated',
      profitPreservationIndex: 100
    };
  }

  private executeTrade(
    signal: FlowV2Signal,
    decision: ReasoningDecision,
    entryTime: Date
  ): BacktestTrade {
    this.tradeCounter++;

    const positionSize = (this.currentBalance * (this.config?.positionSizePercent || 2)) / 100;

    const trade: BacktestTrade = {
      tradeNumber: this.tradeCounter,
      symbol: signal.symbol,
      timeframe: '1h',
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
      aiReasoningUsed: this.config?.useGPT4Reasoning || false,
      aiConviction: decision.conviction,
      aiRationale: decision.rationale,
      aiRiskAssessment: decision.riskAssessment,
      shouldExecute: true,
      executionReason: decision.rationale,
      pnl: 0,
      pnlPercent: 0,
      pipsGained: 0,
      outcome: 'open',
      qualityScore: signal.confidence
    };

    console.log(`[Backtesting] Trade #${this.tradeCounter}: ${signal.direction.toUpperCase()} ${signal.symbol} @ ${signal.entryPrice.toFixed(5)}`);

    return trade;
  }

  private updateOpenTrades(candle: any): void {
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
        this.closeTrade(trade, currentPrice, currentTime, 'take_profit');
      } else if (isSL) {
        this.closeTrade(trade, currentPrice, currentTime, 'stop_loss');
      }
    }
  }

  private closeTrade(
    trade: BacktestTrade,
    exitPrice: number,
    exitTime: Date,
    exitReason: string
  ): void {
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

    console.log(`[Backtesting] Trade #${trade.tradeNumber} closed: ${trade.outcome.toUpperCase()} - P&L: $${trade.pnl.toFixed(2)}`);
  }

  private closeAllOpenTrades(endTime: Date): void {
    console.log(`[Backtesting] Closing ${this.openTrades.length} open trades at session end`);

    for (const trade of [...this.openTrades]) {
      this.closeTrade(trade, trade.entryPrice, endTime, 'session_end');
    }
  }

  private recordMissedOpportunity(
    signal: FlowV2Signal,
    decision: ReasoningDecision,
    time: Date
  ): void {
    this.missedOpportunities.push({
      symbol: signal.symbol,
      opportunityTime: time,
      flowV2Confidence: signal.confidence,
      direction: signal.direction,
      entryPrice: signal.entryPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      setupType: signal.setupType,
      skipReason: decision.rationale,
      aiConviction: decision.conviction,
      wasQualityTrade: signal.confidence >= 70,
      qualityScore: signal.confidence
    });
  }

  private calculateResults(): BacktestResult {
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

    const signalsGenerated = this.closedTrades.length + this.missedOpportunities.length;
    const signalsExecuted = this.closedTrades.length;
    const signalsSkipped = this.missedOpportunities.length;

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
      trades: this.closedTrades,
      missedOpportunities: this.missedOpportunities,
      signalsGenerated,
      signalsExecuted,
      signalsSkipped
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

  private async getHistoricalCandles(
    symbol: string,
    startDate: Date,
    endDate: Date
  ): Promise<any[]> {
    const { data, error } = await supabase
      .from('forex_candles')
      .select('*')
      .eq('symbol', symbol)
      .eq('timeframe', '1h')
      .gte('open_time', startDate.toISOString())
      .lte('open_time', endDate.toISOString())
      .order('open_time', { ascending: true });

    if (error) {
      console.error('[Backtesting] Error fetching candles:', error);
      console.error('[Backtesting] Error details:', error);
      return [];
    }

    console.log(`[Backtesting] Loaded ${data?.length || 0} H1 candles for ${symbol}`);
    return data || [];
  }

  private async validateDataAvailability(
    config: BacktestConfig
  ): Promise<{ isValid: boolean; issues: string[]; stats: any }> {
    const issues: string[] = [];
    const stats: any = {};

    // Check if dates are in the past
    const now = new Date();
    if (config.startDate > now) {
      issues.push(`⚠️  Start date (${config.startDate.toISOString()}) is in the future!`);
    }
    if (config.endDate > now) {
      issues.push(`⚠️  End date (${config.endDate.toISOString()}) is in the future!`);
    }

    // Check data availability for each symbol and timeframe
    for (const symbol of config.symbols) {
      stats[symbol] = {};

      for (const timeframe of ['1h', '5m', '1m']) {
        const { data, error } = await supabase
          .from('forex_candles')
          .select('open_time', { count: 'exact' })
          .eq('symbol', symbol)
          .eq('timeframe', timeframe)
          .gte('open_time', config.startDate.toISOString())
          .lte('open_time', config.endDate.toISOString());

        const count = data?.length || 0;
        stats[symbol][timeframe] = count;

        // Minimum candle requirements based on Flow V2 strategy
        const minRequired = timeframe === '1h' ? 50 : 100;

        if (count === 0) {
          issues.push(`❌ No ${timeframe} candles found for ${symbol} in date range`);
        } else if (count < minRequired) {
          issues.push(`⚠️  Only ${count} ${timeframe} candles for ${symbol} (need ${minRequired} for Flow V2 strategy)`);
        }

        if (error) {
          issues.push(`❌ Database error checking ${symbol} ${timeframe}: ${error.message}`);
        }
      }
    }

    // Check if date range is reasonable
    const daysDiff = Math.floor((config.endDate.getTime() - config.startDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff < 1) {
      issues.push(`⚠️  Date range is very short (${daysDiff} days). Consider at least 7 days for meaningful backtest.`);
    }

    return {
      isValid: issues.filter(i => i.startsWith('❌')).length === 0,
      issues,
      stats
    };
  }

  private async createBacktestSession(
    userId: string,
    config: BacktestConfig
  ): Promise<any> {
    const { data, error } = await supabase
      .from('backtest_sessions')
      .insert({
        user_id: userId,
        session_name: config.sessionName,
        description: config.description,
        symbols: config.symbols,
        start_date: config.startDate.toISOString(),
        end_date: config.endDate.toISOString(),
        timeframes: config.timeframes,
        ai_config_id: config.aiConfigId,
        use_gpt4_reasoning: config.useGPT4Reasoning,
        confidence_threshold: config.confidenceThreshold,
        risk_mode: config.riskMode,
        max_concurrent_trades: config.maxConcurrentTrades,
        initial_balance: config.initialBalance,
        position_size_percent: config.positionSizePercent,
        commission_per_trade: config.commissionPerTrade,
        slippage_pips: config.slippagePips,
        status: 'pending'
      })
      .select()
      .single();

    if (error) {
      console.error('[Backtesting] Error creating session:', error);
      throw error;
    }

    return data;
  }

  private async updateSessionStatus(status: string, updates: any = {}): Promise<void> {
    await supabase
      .from('backtest_sessions')
      .update({
        status,
        ...updates
      })
      .eq('id', this.sessionId);
  }

  private async updateSessionProgress(current: number, total: number): Promise<void> {
    await supabase
      .from('backtest_sessions')
      .update({
        candles_processed: current
      })
      .eq('id', this.sessionId);
  }

  private async saveBacktestResults(result: BacktestResult): Promise<void> {
    await supabase
      .from('backtest_sessions')
      .update({
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
        signals_skipped: result.signalsSkipped,
        gpt4_calls_made: this.gpt4CallsUsed,
        estimated_api_cost: this.gpt4CallsUsed * 0.1
      })
      .eq('id', this.sessionId);

    for (const trade of result.trades) {
      await supabase
        .from('backtest_trades')
        .insert({
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
          ai_conviction: trade.aiConviction,
          ai_rationale: trade.aiRationale,
          ai_risk_assessment: trade.aiRiskAssessment,
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
          quality_score: trade.qualityScore
        });
    }

    for (const opp of result.missedOpportunities) {
      await supabase
        .from('missed_opportunities')
        .insert({
          session_id: this.sessionId,
          user_id: this.userId,
          symbol: opp.symbol,
          timeframe: '1h',
          opportunity_time: opp.opportunityTime.toISOString(),
          flow_v2_confidence: opp.flowV2Confidence,
          direction: opp.direction,
          entry_price: opp.entryPrice,
          stop_loss: opp.stopLoss,
          take_profit: opp.takeProfit,
          setup_type: opp.setupType,
          skip_reason: opp.skipReason,
          ai_conviction: opp.aiConviction,
          was_quality_trade: opp.wasQualityTrade,
          quality_score: opp.qualityScore
        });
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
  }
}

export const backtestingEngine = new BacktestingEngine();
