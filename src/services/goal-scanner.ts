import { supabase } from '../lib/supabase';
import { forecastEngine, MarketConditions } from './forecast-engine';
import { goalSessionManager } from './goal-session-manager';
import { tradeExecutionEngine } from './trade-execution-engine';
import { normalizeTimeframeToDb } from '../utils/timeframe-utils';
import { calculatePositionSize, getCurrencyPipInfo, calculatePipDistance, calculateDollarPerPip } from '../utils/currencyHelpers';
import { getPositionSizeMultiplier } from '../config/risk-levels';
import { positionSafetyValidator } from './position-safety-validator';
import { getDefaultWatchlist } from '../config/watchlist';
import { getRiskPercentage } from '../config/risk-levels';
import { scanningStateMachine } from './scanning-state-machine';
import { weekendProtectionService } from './weekend-protection-service';
import { multiSymbolRanker, type SymbolScore } from './multi-symbol-ranker';
import { alphaOmegaOrchestrator, type FullMarketState } from './alpha-omega-orchestrator';
import { sharedIntelligenceCoordinator } from './shared-intelligence-coordinator';
import { computeOmegaSensors, type OmegaSensors } from './omega-sensors';
import type { TraderScore } from './ai-identity';

export interface SessionConfig {
  starting_balance: number;
  risk_mode: 'conservative' | 'moderate' | 'aggressive';
  goal_context?: {
    goal_type: string;
    target_amount: number;
    session_duration: number;
  };
  current_profit?: number;
}

export interface ScanResult {
  symbol: string;
  hasValidSetup: boolean;
  setupType?: string;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  confidence?: number;
  reasoning?: string;
  marketConditions: MarketConditions;
  alphaDecision?: any;
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
}

class GoalScanner {
  async scanMarket(sessionId: string, userId: string): Promise<ScanResult[]> {
    try {
      // STEP 1: Check scanning timing permissions
      const scanPermission = await scanningStateMachine.canScanNow(sessionId);

      if (!scanPermission.allowed) {
        console.log(`[Goal Scanner] ⏸️  Scanning blocked: ${scanPermission.message}`);

        // Add AI message explaining why scanning is blocked
        await goalSessionManager.addAIMessage(
          sessionId,
          userId,
          scanPermission.message,
          {
            scanningState: scanPermission.status,
            reason: scanPermission.reason,
            secondsRemaining: scanPermission.secondsRemaining
          },
          'warning'
        );

        return [];
      }

      console.log(`[Goal Scanner] ✅ Scanning allowed: ${scanPermission.message}`);

      const session = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (session.error || !session.data) {
        console.error('Session not found:', session.error);
        return [];
      }

      // STEP 2: Filter watchlist by open markets
      const fullWatchlist = session.data.watchlist || getDefaultWatchlist();
      const marketCheck = weekendProtectionService.canScanAnySymbol(fullWatchlist);

      if (!marketCheck.allowed) {
        console.log(`[Goal Scanner] 🛡️ No markets open for scanning`);

        await goalSessionManager.addAIMessage(
          sessionId,
          userId,
          `🛡️ All markets closed. Trading resumes Sunday 5:00 PM EST.`,
          {
            allMarketsClosed: true,
            closedSymbols: marketCheck.closedSymbols
          },
          'warning'
        );

        return [];
      }

      // Filter watchlist to only open markets
      const watchlist = marketCheck.openSymbols;
      const closedSymbols = marketCheck.closedSymbols;

      // Add market status message if some symbols are closed
      if (closedSymbols.length > 0) {
        const cryptoOnly = watchlist.every(s => ['BTCUSD', 'ETHUSD'].includes(s));

        console.log(`[Goal Scanner] 🕒 ${closedSymbols.length} symbols closed (Forex/Indices weekend). Scanning ${watchlist.length} open markets (${cryptoOnly ? 'Crypto only' : 'Mixed'}).`);

        let marketMessage = '';
        if (cryptoOnly) {
          marketMessage = `📊 Forex markets closed for weekend. Scanning crypto markets only (${watchlist.join(', ')}). Note: Crypto has wider spreads and higher volatility during forex closed hours.`;
        } else {
          marketMessage = `📊 Scanning ${watchlist.length} open markets. ${closedSymbols.length} symbols temporarily unavailable (weekend).`;
        }

        await goalSessionManager.addAIMessage(
          sessionId,
          userId,
          marketMessage,
          {
            openSymbols: watchlist,
            closedSymbols: closedSymbols,
            cryptoOnly
          },
          'info'
        );
      }

      console.log(`[Goal Scanner] 📊 Ranking ${watchlist.length} symbols by opportunity quality...`);

      const rankings: SymbolScore[] = await multiSymbolRanker.rankSymbols(watchlist);

      // Filter to only GOOD or better symbols (score ≥65)
      const qualitySymbols = rankings.filter(r => r.totalScore >= 65);

      console.log(`[Goal Scanner] 📊 Symbol Rankings:`);
      rankings.forEach((rank, idx) => {
        const emoji = rank.recommendation === 'EXCELLENT' ? '🌟' :
                     rank.recommendation === 'GOOD' ? '✅' :
                     rank.recommendation === 'FAIR' ? '⚡' :
                     rank.recommendation === 'POOR' ? '⚠️' : '❌';
        console.log(`  ${idx + 1}. ${emoji} ${rank.symbol}: ${rank.totalScore}/100 (${rank.recommendation}) - ${rank.reasoning}`);
      });

      console.log(`[Goal Scanner] ✅ Filtered to ${qualitySymbols.length} quality symbols (score ≥65)`);

      if (qualitySymbols.length === 0) {
        console.log('[Goal Scanner] ⚠️ No quality symbols meet criteria - scanning all symbols as fallback');
      }

      // Use quality-filtered symbols, or fall back to full watchlist if none pass
      const symbolsToScan = qualitySymbols.length > 0 ? qualitySymbols.map(r => r.symbol) : watchlist;
      const results: ScanResult[] = [];

      console.log(`[Goal Scanner] 🔍 Scanning ${symbolsToScan.length} symbols...`);

      for (const symbol of symbolsToScan) {
        const scanResult = await this.scanSymbol(symbol, session.data, userId);
        results.push(scanResult);
      }

      const lastScanTime = new Date();
      const nextScanTime = new Date(lastScanTime.getTime() + (session.data.scan_interval_seconds || 300) * 1000);

      await goalSessionManager.updateScanTime(sessionId, lastScanTime, nextScanTime);

      const validSetups = results.filter(r => r.hasValidSetup);
      let tradeExecuted = false;

      // STEP 3: Execute any valid setups found
      if (validSetups.length > 0) {
        console.log(`[Goal Scanner] 🎯 Found ${validSetups.length} valid setup(s), evaluating for execution...`);

        for (const setup of validSetups) {
          const result = await this.evaluateSignal(sessionId, setup, session.data);
          if (result) {
            const executionResult = await tradeExecutionEngine.executeSignal(
              result.signal,
              userId,
              session.data.auto_execute,
              result.alphaDecision
            );

            if (executionResult.success) {
              console.log(`[Goal Scanner] ✅ Trade signal executed: ${executionResult.message}`);
              tradeExecuted = true;
              break; // Stop after first successful trade
            } else {
              console.warn(`[Goal Scanner] ❌ Signal execution failed: ${executionResult.error}`);
            }
          }
        }
      }

      // STEP 4: Record scan completion
      await scanningStateMachine.recordScanCompletion(sessionId, tradeExecuted);

      if (tradeExecuted) {
        console.log('[Goal Scanner] 🎉 Trade found - scanning cycle counters reset');
      } else {
        console.log('[Goal Scanner] ⏭️  Scan completed - no trades found');
      }

      // STEP 5: Add AI summary message
      await goalSessionManager.addAIMessage(
        sessionId,
        userId,
        this.generateScanSummary(results, scanPermission),
        {
          scanResults: results,
          tradeExecuted,
          sessionNumber: scanPermission.sessionNumber,
          scansRemaining: scanPermission.scansRemaining
        },
        tradeExecuted ? 'positive' : 'neutral'
      );

      return results;
    } catch (error) {
      console.error('Error scanning market:', error);
      return [];
    }
  }

  async scanSymbol(symbol: string, sessionConfig: SessionConfig, userId: string): Promise<ScanResult> {
    try {
      const { data: candles } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', normalizeTimeframeToDb('15m'))
        .order('open_time', { ascending: false })
        .limit(100);

      if (!candles || candles.length < 50) {
        return {
          symbol,
          hasValidSetup: false,
          marketConditions: {
            symbol,
            volatility: 0,
            trend: 'sideways',
            volume: 0,
            momentum: 0,
            priceAction: 'insufficient_data',
          },
        };
      }

      const setup = await this.detectSetup(symbol, candles, sessionConfig, userId);

      return setup;
    } catch (error) {
      console.error(`Error scanning ${symbol}:`, error);
      return {
        symbol,
        hasValidSetup: false,
        marketConditions: {
          symbol,
          volatility: 0,
          trend: 'sideways',
          volume: 0,
          momentum: 0,
          priceAction: 'error',
        },
      };
    }
  }

  async detectSetup(symbol: string, candles: any[], sessionConfig: SessionConfig, userId: string): Promise<ScanResult> {
    const recentCandles = candles.slice(0, 50).reverse();
    const prices = recentCandles.map(c => c.close);
    const currentPrice = prices[prices.length - 1];

    const ema20 = this.calculateEMA(prices, 20);
    const ema50 = this.calculateEMA(prices, 50);
    const ema200 = this.calculateEMA(prices, Math.min(200, prices.length - 1));
    const vwap = this.calculateVWAP(recentCandles.slice(-20));
    const atr = this.calculateATR(recentCandles.slice(-14));
    const rsi = this.calculateRSI(prices, 14);

    const volatilityAnalysis = await forecastEngine.analyzeVolatility(symbol, candles);
    const trendAnalysis = await forecastEngine.analyzeTrendFormation(symbol, candles);

    const marketConditions: MarketConditions = {
      symbol,
      volatility: volatilityAnalysis.level === 'high' ? 80 : volatilityAnalysis.level === 'medium' ? 50 : 20,
      trend: this.determineTrend(recentCandles),
      volume: 50,
      momentum: trendAnalysis.confidence,
      priceAction: this.analyzePriceAction(recentCandles.slice(-5)),
    };

    const passesBasicFilter = this.passesBasicFilter(currentPrice, ema20, ema50, rsi, atr, marketConditions);

    if (!passesBasicFilter) {
      console.log(`[Goal Scanner] ❌ ${symbol}: Failed basic filter - skipping Alpha-Omega`);
      return {
        symbol,
        hasValidSetup: false,
        marketConditions,
      };
    }

    console.log(`[Goal Scanner] ✅ ${symbol}: Passed basic filter - calling Alpha-Omega...`);

    try {
      const scoutState = await sharedIntelligenceCoordinator.getScoutState(symbol, 'M15');
      if (scoutState && !scoutState.shouldReconvene && scoutState.cacheAgeSeconds < 300) {
        console.log(`[Goal Scanner] ⚡ ${symbol}: Scout says no opportunity (cache age: ${scoutState.cacheAgeSeconds}s)`);
        return {
          symbol,
          hasValidSetup: false,
          reasoning: `Scout: ${scoutState.marketSummary}`,
          marketConditions,
        };
      }

      const marketState = this.buildMarketState(symbol, recentCandles, {
        ema20, ema50, ema200, vwap, atr, rsi, volatilityAnalysis, trendAnalysis
      });

      const mockTraderScore: TraderScore = {
        current_score: 75,
        lifetime_profit: sessionConfig.current_profit || 0,
        lifetime_loss: 0,
        streak_wins: 0,
        streak_losses: 0,
        confidence_level: 'medium',
        risk_appetite: sessionConfig.risk_mode === 'aggressive' ? 3 : sessionConfig.risk_mode === 'conservative' ? 1 : 2,
        trading_style: 'balanced',
        total_trades: 0,
        win_rate: 50
      };

      const proposedSL = currentPrice - (atr * 1.8);
      const proposedTP = currentPrice + (atr * 3.0);

      // PRIORITY 3 FIX: Pass userId to makeTradeDecision for proper tracking
      const alphaDecision = await alphaOmegaOrchestrator.makeTradeDecision(
        marketState,
        mockTraderScore,
        proposedSL,
        proposedTP,
        sessionConfig.goal_context,
        userId
      );

      const hasValidSetup = (alphaDecision.action === 'BUY' || alphaDecision.action === 'SELL') &&
                            alphaDecision.confidence >= 60;

      const setupType = hasValidSetup
        ? `Alpha ${alphaDecision.action} (${alphaDecision.confidence}%)`
        : alphaDecision.action === 'WAIT' ? 'WAIT' : 'NO_TRADE';

      return {
        symbol,
        hasValidSetup,
        setupType,
        entry: alphaDecision.entry,
        stopLoss: alphaDecision.stopLoss,
        takeProfit: alphaDecision.takeProfit,
        confidence: alphaDecision.confidence,
        reasoning: alphaDecision.reasoning,
        marketConditions,
        alphaDecision,
      };
    } catch (error) {
      console.error(`[Goal Scanner] Alpha-Omega error for ${symbol}:`, error);
      return {
        symbol,
        hasValidSetup: false,
        reasoning: `Alpha-Omega error: ${error instanceof Error ? error.message : 'Unknown'}`,
        marketConditions,
      };
    }
  }

  private passesBasicFilter(
    price: number,
    ema20: number,
    ema50: number,
    rsi: number,
    atr: number,
    conditions: MarketConditions
  ): boolean {
    if (atr <= 0) return false;
    const atrPercent = (atr / price) * 100;
    if (atrPercent < 0.05) return false;
    if (rsi < 15 || rsi > 85) return false;
    if (conditions.priceAction === 'insufficient' || conditions.priceAction === 'error') return false;
    return true;
  }

  private buildMarketState(
    symbol: string,
    candles: any[],
    indicators: {
      ema20: number;
      ema50: number;
      ema200: number;
      vwap: number;
      atr: number;
      rsi: number;
      volatilityAnalysis: any;
      trendAnalysis: any;
    }
  ): FullMarketState {
    const currentCandle = candles[candles.length - 1];
    const price = currentCandle.close;

    const { support, resistance } = this.calculateSupportResistance(candles);
    const { swingHigh, swingLow } = this.calculateSwings(candles);

    const trend = indicators.ema20 > indicators.ema50 ? 'bull' : indicators.ema20 < indicators.ema50 ? 'bear' : 'sideways';
    const volatility = indicators.volatilityAnalysis.level;
    const momentum = indicators.trendAnalysis.confidence;

    const sensors: OmegaSensors = {
      sh: swingHigh,
      sl: swingLow,
      bos: 'none',
      cho: 'none',
      eqh: 0,
      eql: 0,
      vol_ratio: 1,
      vol_trend: 'stable',
      vol_spike: false,
      cvd: 0,
      rsi: indicators.rsi,
      macd: 0,
      macd_sig: 0,
      momentum,
      stoch: { k: 50, d: 50 },
      pat: { engulf: false, pin: false, doji: false, inside: false },
      mic: { wick_ratio: 0, body_size: 0, gap: false, trap: 'none' },
      ema20: indicators.ema20,
      ema50: indicators.ema50,
      ema200: indicators.ema200,
      atr: indicators.atr,
      vwap: indicators.vwap
    };

    return {
      symbol,
      price,
      ema20: indicators.ema20,
      ema50: indicators.ema50,
      ema200: indicators.ema200,
      rsi: indicators.rsi,
      stochRsi: 50,
      atr: indicators.atr,
      vwap: indicators.vwap,
      trend,
      volatility,
      momentum,
      support,
      resistance,
      swingHigh,
      swingLow,
      recentCandles: candles.slice(-30),
      omegaSensors: sensors
    };
  }

  private calculateSupportResistance(candles: any[]): { support: number[]; resistance: number[] } {
    const recentCandles = candles.slice(-20);
    const lows = recentCandles.map(c => c.low).sort((a: number, b: number) => a - b);
    const highs = recentCandles.map(c => c.high).sort((a: number, b: number) => b - a);

    return {
      support: lows.slice(0, 3),
      resistance: highs.slice(0, 3)
    };
  }

  private calculateSwings(candles: any[]): { swingHigh: number; swingLow: number } {
    const recentCandles = candles.slice(-10);
    let swingHigh = -Infinity;
    let swingLow = Infinity;

    for (const candle of recentCandles) {
      if (candle.high > swingHigh) swingHigh = candle.high;
      if (candle.low < swingLow) swingLow = candle.low;
    }

    return { swingHigh, swingLow };
  }

  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
      const change = (prices[i] || 0) - (prices[i - 1] || 0);
      if (change > 0) gains += change;
      else losses -= change;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  // REMOVED: getRiskThreshold - User exposure level no longer overrides LLM confidence
  // LLM autonomously determines minimum confidence based on:
  // - Current rank (Bronze, Silver, Gold, Alpha, Omega)
  // - Win/loss streak
  // - Pattern history
  // - Market conditions
  // - Reward engine state

  calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] || 0;

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  calculateVWAP(candles: any[], lookbackPeriod: number = 20): number {
    // Use only the most recent candles for VWAP to keep it responsive
    const relevantCandles = candles.slice(-lookbackPeriod);
    let totalVolume = 0;
    let totalPV = 0;

    for (const candle of relevantCandles) {
      const typical = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume || 1;
      totalPV += typical * volume;
      totalVolume += volume;
    }

    return totalVolume > 0 ? totalPV / totalVolume : 0;
  }

  calculateATR(candles: any[], period: number = 14): number {
    if (candles.length < period) return 0.001;

    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trs.push(tr);
    }

    return trs.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
  }

  determineTrend(candles: any[]): 'bullish' | 'bearish' | 'sideways' {
    if (!candles || candles.length < 20) return 'sideways';

    const prices = candles.map(c => c.close);
    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const change = ((lastPrice - firstPrice) / firstPrice) * 100;

    if (change > 0.5) return 'bullish';
    if (change < -0.5) return 'bearish';
    return 'sideways';
  }

  analyzePriceAction(candles: any[]): string {
    if (!candles || candles.length < 3) return 'insufficient';

    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];

    const bodySize = Math.abs(lastCandle.close - lastCandle.open);
    const wickSize = lastCandle.high - lastCandle.low;
    const bodyRatio = bodySize / wickSize;

    if (bodyRatio > 0.7) return 'strong_momentum';
    if (bodyRatio < 0.3) return 'indecision';

    const bullish = lastCandle.close > lastCandle.open;
    const prevBullish = prevCandle.close > prevCandle.open;

    if (bullish === prevBullish) return 'trending';
    return 'reversal';
  }

  generateScanSummary(results: ScanResult[], scanPermission?: any): string {
    const validSetups = results.filter(r => r.hasValidSetup);

    // Add scanning cycle context
    let cycleInfo = '';
    if (scanPermission?.sessionNumber && scanPermission?.scansRemaining !== undefined) {
      cycleInfo = ` [Session ${scanPermission.sessionNumber}/2, ${scanPermission.scansRemaining} scans remaining]`;
    }

    if (validSetups.length > 0) {
      const setupList = validSetups.map(s => `${s.symbol} (${s.setupType}, ${s.confidence}%)`).join(', ');
      return `Found ${validSetups.length} valid setup${validSetups.length > 1 ? 's' : ''}: ${setupList}. Preparing trade signals...${cycleInfo}`;
    }

    const highConfidenceForecasts = results.filter(r => r.marketConditions.momentum > 60);
    if (highConfidenceForecasts.length > 0) {
      return `No valid setups yet, but monitoring ${highConfidenceForecasts[0].symbol} — setup potentially forming soon. Will re-scan shortly.${cycleInfo}`;
    }

    return `Markets currently quiet across watchlist. No valid setups meeting risk criteria. Continuing scheduled scans...${cycleInfo}`;
  }

  async evaluateSignal(
    sessionId: string,
    scanResult: ScanResult,
    sessionConfig: SessionConfig
  ): Promise<{ signal: TradeSignal; alphaDecision?: any } | null> {
    if (!scanResult.hasValidSetup) return null;

    const direction: 'buy' | 'sell' = scanResult.setupType?.toUpperCase().includes('SELL') ? 'sell' : 'buy';

    // CRITICAL FIX: Use proper position sizing formula
    const balance = sessionConfig.starting_balance || 10000;
    const riskPercent = getRiskPercentage(sessionConfig.risk_mode);

    // Calculate position size using CORRECT formula
    let positionSize = calculatePositionSize(
      scanResult.symbol,
      balance,
      riskPercent,
      scanResult.entry!,
      scanResult.stopLoss!
    );

    // Get pip info for validation
    const pipInfo = getCurrencyPipInfo(scanResult.symbol);
    const stopDistancePips = calculatePipDistance(
      scanResult.symbol,
      scanResult.entry!,
      scanResult.stopLoss!
    );

    // SAFETY VALIDATION: Run through position safety validator
    const safetyResult = positionSafetyValidator.validatePosition(
      positionSize,
      scanResult.entry!,
      scanResult.stopLoss!,
      balance,
      [], // No other open trades in scanner context
      scanResult.symbol,
      pipInfo.pipValue,
      pipInfo.dollarPerPipPerLot
    );

    if (!safetyResult.isValid) {
      console.error('[Goal Scanner] 🚨 SAFETY VIOLATION - Trade blocked:');
      safetyResult.violations.forEach(v => console.error(`  ${v}`));
      return null;
    }

    // Use adjusted position size if safety validator changed it
    if (safetyResult.adjustedPositionSize) {
      positionSize = safetyResult.adjustedPositionSize;
      console.warn('[Goal Scanner] ⚠️  Position size adjusted by safety validator');
      safetyResult.safetyAdjustments.forEach(adj => console.warn(`  ${adj}`));
    }

    // Apply risk mode position size multiplier
    const positionSizeMultiplier = getPositionSizeMultiplier(sessionConfig.risk_mode);
    const positionSizeBeforeMultiplier = positionSize;
    positionSize = positionSize * positionSizeMultiplier;
    console.log(`[Goal Scanner] 📊 Risk mode position sizing: ${sessionConfig.risk_mode} (${positionSizeMultiplier}x) | ${positionSizeBeforeMultiplier.toFixed(3)} → ${positionSize.toFixed(3)} lots`);

    // Calculate actual dollar risk
    const dollarPerPip = calculateDollarPerPip(scanResult.symbol, positionSize);
    const actualRiskDollars = stopDistancePips * dollarPerPip;
    const actualRiskPercent = (actualRiskDollars / balance) * 100;

    // SANITY CHECK: Block if risk exceeds hard limit
    if (actualRiskPercent > 5.5) {
      console.error('[Goal Scanner] 🚨 HARD BLOCK: Risk exceeds 5.5% maximum');
      console.error(`  Calculated Risk: ${actualRiskPercent.toFixed(2)}% ($${actualRiskDollars.toFixed(2)})`);
      console.error(`  Position Size: ${positionSize.toFixed(3)} lots`);
      console.error(`  Stop Distance: ${stopDistancePips.toFixed(1)} pips`);
      console.error(`  Dollar Per Pip: $${dollarPerPip.toFixed(2)}`);
      return null;
    }

    // Log position details
    console.log('[Goal Scanner] 💰 Position Sizing Details:');
    console.log(`  Symbol: ${scanResult.symbol} (${pipInfo.symbolType})`);
    console.log(`  Account Balance: $${balance.toFixed(2)}`);
    console.log(`  Risk Mode: ${sessionConfig.risk_mode} (${riskPercent}%)`);
    console.log(`  Target Risk: $${(balance * riskPercent / 100).toFixed(2)}`);
    console.log(`  Stop Distance: ${stopDistancePips.toFixed(1)} pips`);
    console.log(`  Position Size: ${positionSize.toFixed(3)} lots`);
    console.log(`  Dollar Per Pip: $${dollarPerPip.toFixed(2)}`);
    console.log(`  Actual Risk: $${actualRiskDollars.toFixed(2)} (${actualRiskPercent.toFixed(2)}%)`);

    const stopDistance = Math.abs(scanResult.entry! - scanResult.stopLoss!);
    const riskReward = Math.abs(scanResult.takeProfit! - scanResult.entry!) / stopDistance;
    const expectedProfit = Math.abs(scanResult.takeProfit! - scanResult.entry!) * dollarPerPip;

    return {
      signal: {
        sessionId,
        symbol: scanResult.symbol,
        direction,
        entryPrice: scanResult.entry!,
        stopLoss: scanResult.stopLoss!,
        takeProfit: scanResult.takeProfit!,
        positionSize,
        confidence: scanResult.confidence!,
        setupType: scanResult.setupType!,
        reasoning: scanResult.reasoning!,
        riskReward,
        expectedProfit: Math.abs(expectedProfit),
      },
      alphaDecision: scanResult.alphaDecision,
    };
  }

  calculateRiskAmount(sessionConfig: SessionConfig): number {
    const balance = sessionConfig.starting_balance;
    const riskPercent = getRiskPercentage(sessionConfig.risk_mode) / 100;
    return balance * riskPercent;
  }
}

export const goalScanner = new GoalScanner();
