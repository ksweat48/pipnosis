import { supabase } from '../lib/supabase';
import { FlowV2Signal } from '../strategies/flow-trader-v2';

export interface ReasoningDecision {
  strategySelected: string;
  conviction: number;
  rationale: string;
  shouldExecute: boolean;
  riskAssessment: string;
  adaptiveAdjustments?: string;
  profitPreservationIndex: number;
}

export interface MarketRegime {
  volatility: 'low' | 'medium' | 'high';
  trend: 'strong_bullish' | 'bullish' | 'sideways' | 'bearish' | 'strong_bearish';
  momentum: number;
  structure: 'healthy' | 'consolidating' | 'breaking';
}

class AutonomousReasoningEngine {
  private apiKey: string;
  private readonly COST_PER_1K_TOKENS = 0.005;
  private readonly MAX_TOKENS_PER_SESSION = 50000;
  private sessionTokenUsage: Map<string, number> = new Map();

  constructor() {
    this.apiKey = typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_OPENAI_API_KEY || ''
      : process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
  }

  async reasonAboutSignal(
    signal: FlowV2Signal,
    sessionId: string,
    userId: string,
    sessionConfig: any,
    openTrades: any[]
  ): Promise<ReasoningDecision> {
    try {
      if (!this.apiKey) {
        console.log('[Reasoning Engine] No API key, using fallback logic');
        return this.fallbackReasoning(signal, sessionConfig, openTrades);
      }

      const tokenUsage = this.sessionTokenUsage.get(sessionId) || 0;
      if (tokenUsage >= this.MAX_TOKENS_PER_SESSION) {
        console.log('[Reasoning Engine] Token limit reached, using fallback');
        return this.fallbackReasoning(signal, sessionConfig, openTrades);
      }

      const marketRegime = await this.detectMarketRegime(signal.symbol);
      const ppi = this.calculateProfitPreservationIndex(openTrades, signal);

      const prompt = this.buildReasoningPrompt(signal, sessionConfig, openTrades, marketRegime, ppi);

      console.log(`[Reasoning Engine] Analyzing ${signal.symbol} signal with GPT-4o...`);
      const startTime = Date.now();

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are Pipnosis, an expert autonomous trading AI. Analyze trade signals with precision, assess risks honestly, and provide clear reasoning. Your goal is 80%+ win rate with strong risk management. Respond in valid JSON only.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 1000
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[Reasoning Engine] API error:', errorData);
        return this.fallbackReasoning(signal, sessionConfig, openTrades);
      }

      const data = await response.json();
      const latency = Date.now() - startTime;
      const tokensUsed = data.usage?.total_tokens || 0;

      this.sessionTokenUsage.set(sessionId, tokenUsage + tokensUsed);

      const content = data.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content in API response');
      }

      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const aiResponse = JSON.parse(cleanContent);

      const decision: ReasoningDecision = {
        strategySelected: aiResponse.strategy || 'flow_v2',
        conviction: aiResponse.conviction || signal.confidence,
        rationale: aiResponse.rationale || signal.reasoning,
        shouldExecute: aiResponse.should_execute || false,
        riskAssessment: aiResponse.risk_assessment || 'Unknown',
        adaptiveAdjustments: aiResponse.adaptive_adjustments,
        profitPreservationIndex: ppi
      };

      await this.logReasoning(sessionId, userId, decision, marketRegime, tokensUsed, latency);

      console.log(`[Reasoning Engine] Decision: ${decision.shouldExecute ? 'EXECUTE' : 'SKIP'} (conviction: ${decision.conviction}%)`);

      return decision;

    } catch (error) {
      console.error('[Reasoning Engine] Error:', error);
      return this.fallbackReasoning(signal, sessionConfig, openTrades);
    }
  }

  buildReasoningPrompt(
    signal: FlowV2Signal,
    sessionConfig: any,
    openTrades: any[],
    regime: MarketRegime,
    ppi: number
  ): string {
    const openPositionsContext = openTrades.length > 0
      ? `\nOpen Positions: ${openTrades.length} (${openTrades.map(t => `${t.symbol} ${t.direction}`).join(', ')})`
      : '\nNo open positions';

    return `Evaluate this Flow Trader V2 signal for autonomous execution:

**Signal Details:**
Symbol: ${signal.symbol}
Direction: ${signal.direction.toUpperCase()}
Entry: ${signal.entryPrice.toFixed(5)}
Stop Loss: ${signal.stopLoss.toFixed(5)}
Take Profit: ${signal.takeProfit.toFixed(5)}
Risk:Reward: 1:${signal.riskReward.toFixed(2)}
Confidence: ${signal.confidence}%
Setup: ${signal.setupType}

**Flow V2 Analysis:**
${signal.reasoning}

**Session Context:**
Goal: ${sessionConfig.goal_type} - $${sessionConfig.target_value}
Risk Mode: ${sessionConfig.risk_mode}
Timeframe: ${sessionConfig.timeframe}
${openPositionsContext}
Profit Preservation Index: ${ppi.toFixed(2)}

**Market Regime:**
Volatility: ${regime.volatility}
Trend: ${regime.trend}
Momentum: ${regime.momentum.toFixed(2)}
Structure: ${regime.structure}

**Your Task:**
1. Validate the Flow V2 signal quality
2. Assess if this is the RIGHT TRADE at the RIGHT TIME
3. Consider: Does this align with user goals? Is risk appropriate? Should we wait for better?
4. Decide: EXECUTE or SKIP

**Response Format (JSON only):**
{
  "strategy": "flow_v2",
  "conviction": <0-100, your confidence in THIS specific trade>,
  "should_execute": <true|false>,
  "rationale": "<2-3 sentences explaining your decision in plain English>",
  "risk_assessment": "<Acceptable|Elevated|High - with brief reason>",
  "adaptive_adjustments": "<optional: any modifications to SL/TP/size or 'none'>"
}`;
  }

  fallbackReasoning(signal: FlowV2Signal, sessionConfig: any, openTrades: any[]): ReasoningDecision {
    console.log('[Reasoning Engine] Using rule-based fallback logic');

    const riskThresholds = {
      low: 85,
      medium: 75,
      high: 70
    };

    const threshold = riskThresholds[sessionConfig.risk_mode as keyof typeof riskThresholds] || 75;
    const meetsThreshold = signal.confidence >= threshold;

    const maxConcurrent = sessionConfig.max_concurrent_trades || 2;
    const canAddTrade = openTrades.length < maxConcurrent;

    const shouldExecute = meetsThreshold && canAddTrade && signal.riskReward >= 1.5;

    let rationale = '';
    if (!meetsThreshold) {
      rationale = `Signal confidence ${signal.confidence}% below ${sessionConfig.risk_mode} mode threshold (${threshold}%). Waiting for higher quality setup.`;
    } else if (!canAddTrade) {
      rationale = `Maximum concurrent trades (${maxConcurrent}) reached. Waiting for existing positions to close.`;
    } else if (signal.riskReward < 1.5) {
      rationale = `Risk:reward ratio ${signal.riskReward.toFixed(2)} below minimum 1.5. Skipping.`;
    } else {
      rationale = `Flow V2 signal meets all criteria. ${signal.reasoning}. Executing with ${signal.confidence}% confidence.`;
    }

    return {
      strategySelected: 'flow_v2',
      conviction: signal.confidence,
      rationale,
      shouldExecute,
      riskAssessment: signal.confidence >= 80 ? 'Acceptable' : signal.confidence >= 70 ? 'Elevated' : 'High',
      profitPreservationIndex: this.calculateProfitPreservationIndex(openTrades, signal)
    };
  }

  async detectMarketRegime(symbol: string): Promise<MarketRegime> {
    try {
      const { data: candles } = await supabase
        .from('forex_candles')
        .select('high, low, close, volume')
        .eq('symbol', symbol)
        .eq('timeframe', '15m')
        .order('open_time', { ascending: false })
        .limit(50);

      if (!candles || candles.length < 20) {
        return {
          volatility: 'medium',
          trend: 'sideways',
          momentum: 50,
          structure: 'consolidating'
        };
      }

      const closes = candles.map(c => c.close).reverse();
      const highs = candles.map(c => c.high).reverse();
      const lows = candles.map(c => c.low).reverse();

      const atr = this.calculateATR(highs, lows, closes);
      const atrPercent = (atr / closes[closes.length - 1]) * 100;

      let volatility: 'low' | 'medium' | 'high' = 'medium';
      if (atrPercent < 0.5) volatility = 'low';
      else if (atrPercent > 1.5) volatility = 'high';

      const sma20 = this.calculateSMA(closes, 20);
      const currentPrice = closes[closes.length - 1];
      const priceVsSMA = ((currentPrice - sma20) / sma20) * 100;

      let trend: 'strong_bullish' | 'bullish' | 'sideways' | 'bearish' | 'strong_bearish' = 'sideways';
      if (priceVsSMA > 1.0) trend = 'strong_bullish';
      else if (priceVsSMA > 0.3) trend = 'bullish';
      else if (priceVsSMA < -1.0) trend = 'strong_bearish';
      else if (priceVsSMA < -0.3) trend = 'bearish';

      const momentum = this.calculateMomentum(closes);

      const recentHigh = Math.max(...highs.slice(-10));
      const recentLow = Math.min(...lows.slice(-10));
      const range = recentHigh - recentLow;
      const position = (currentPrice - recentLow) / range;

      let structure: 'healthy' | 'consolidating' | 'breaking' = 'healthy';
      if (position > 0.4 && position < 0.6) structure = 'consolidating';
      else if (volatility === 'high') structure = 'breaking';

      return { volatility, trend, momentum, structure };

    } catch (error) {
      console.error('[Reasoning Engine] Error detecting regime:', error);
      return {
        volatility: 'medium',
        trend: 'sideways',
        momentum: 50,
        structure: 'consolidating'
      };
    }
  }

  calculateProfitPreservationIndex(openTrades: any[], newSignal: FlowV2Signal): number {
    if (openTrades.length === 0) return 100;

    let totalRisk = 0;
    let totalExposure = 0;

    for (const trade of openTrades) {
      const risk = Math.abs(trade.entry_price - trade.stop_loss) * trade.position_size;
      totalRisk += risk;

      if (trade.symbol === newSignal.symbol) {
        totalExposure += trade.position_size;
      }
    }

    const newRisk = Math.abs(newSignal.entryPrice - newSignal.stopLoss);
    const sameSymbolPenalty = totalExposure > 0 ? 20 : 0;
    const riskPenalty = (totalRisk / 100) * 10;

    const ppi = Math.max(0, 100 - riskPenalty - sameSymbolPenalty);
    return ppi;
  }

  calculateATR(highs: number[], lows: number[], closes: number[]): number {
    if (highs.length < 2) return 0.001;

    const trs = [];
    for (let i = 1; i < Math.min(highs.length, 15); i++) {
      const high = highs[i];
      const low = lows[i];
      const prevClose = closes[i - 1];

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trs.push(tr);
    }

    return trs.reduce((sum, tr) => sum + tr, 0) / trs.length;
  }

  calculateSMA(values: number[], period: number): number {
    if (values.length < period) return values[values.length - 1] || 0;
    const slice = values.slice(-period);
    return slice.reduce((sum, val) => sum + val, 0) / period;
  }

  calculateMomentum(closes: number[]): number {
    if (closes.length < 10) return 50;

    const change = ((closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10]) * 100;

    return Math.min(100, Math.max(0, 50 + (change * 10)));
  }

  async logReasoning(
    sessionId: string,
    userId: string,
    decision: ReasoningDecision,
    marketConditions: MarketRegime,
    tokensUsed: number,
    latencyMs: number
  ): Promise<void> {
    try {
      await supabase.from('reasoning_log').insert({
        goal_session_id: sessionId,
        user_id: userId,
        reasoning_type: 'signal_evaluation',
        strategy_selected: decision.strategySelected,
        conviction: decision.conviction,
        market_conditions: marketConditions,
        reasoning_text: decision.rationale,
        decision: decision.shouldExecute ? 'execute' : 'skip',
        model_used: 'gpt-4o',
        tokens_used: tokensUsed,
        latency_ms: latencyMs
      });
    } catch (error) {
      console.error('[Reasoning Engine] Error logging reasoning:', error);
    }
  }

  async shouldSwitchStrategy(
    sessionId: string,
    userId: string,
    currentStrategy: string,
    marketRegime: MarketRegime
  ): Promise<{ shouldSwitch: boolean; newStrategy: string; reason: string }> {
    if (currentStrategy !== 'flow_v2') {
      return { shouldSwitch: false, newStrategy: currentStrategy, reason: 'Already using alternative strategy' };
    }

    let shouldSwitch = false;
    let newStrategy = 'flow_v2';
    let reason = '';

    if (marketRegime.volatility === 'low' && marketRegime.trend === 'sideways') {
      shouldSwitch = true;
      newStrategy = 'range_sniper';
      reason = 'Low volatility sideways market detected. Range Sniper strategy better suited for mean reversion.';
    } else if (marketRegime.volatility === 'high' && marketRegime.momentum > 75) {
      shouldSwitch = true;
      newStrategy = 'trend_rider';
      reason = 'High volatility with strong momentum. Trend Rider strategy better for capturing extended moves.';
    }

    if (shouldSwitch) {
      await supabase.from('strategy_switches').insert({
        goal_session_id: sessionId,
        user_id: userId,
        from_strategy: currentStrategy,
        to_strategy: newStrategy,
        reason,
        market_regime_change: marketRegime,
        confidence: 75
      });
    }

    return { shouldSwitch, newStrategy, reason };
  }

  getTokenUsage(sessionId: string): number {
    return this.sessionTokenUsage.get(sessionId) || 0;
  }

  resetTokenUsage(sessionId: string): void {
    this.sessionTokenUsage.delete(sessionId);
  }
}

export const autonomousReasoningEngine = new AutonomousReasoningEngine();
