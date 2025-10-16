import { supabase } from '@/lib/supabase';
import { marketDataService } from './market-data';
import { FxFlowScalperV2, MultiTimeframeCandles } from '@/strategies/core/fxFlowScalperV2';
import { analyzeMarket, AiMarketSummary } from '@/lib/aiMarketEngine';
import { Candle } from '@/lib/indicators';
import { Timeframe } from './metaapi';

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

const PIPNOSIS_TRADING_LAWS = [
  "Law #1: Capital Preservation - Never risk more than 2-4% of account balance per trade",
  "Law #2: Risk-Reward Ratio - Minimum 1:1 RRR, target 2:1 or better",
  "Law #3: Drawdown Management - Maximum 15% account drawdown before stopping",
  "Law #4: Trade Limit - Maximum 6 trades per day in auto mode",
  "Law #5: AI Final Decision - AI has ultimate authority on trade execution",
  "Law #6: Quality Over Quantity - Only high-probability setups with multiple confirmations",
  "Law #7: No Revenge Trading - No re-entry after stop loss without new analysis",
  "Law #8: Market Hours - Only trade during active market sessions",
  "Law #9: Stop Loss Mandatory - Every trade must have a stop loss",
  "Law #10: Take Profit Strategy - Define clear profit targets before entry"
];

export interface AITradeDecision {
  id: string;
  userId: string;
  symbol: string;
  timeframe: string;
  decisionType: 'manual' | 'auto';
  chatgptPrompt: string;
  chatgptResponse: any;
  marketContext: any;
  tradeDirection?: 'BUY' | 'SELL';
  confidenceScore?: number;
  strategyUsed: string;
  reasoning: string;
  approved: boolean;
  executed: boolean;
  tradeId?: string;
  createdAt: Date;
  executedAt?: Date;
}

export interface TradeOption {
  id: string;
  userId: string;
  decisionId: string;
  optionType: 'low_risk' | 'medium_risk' | 'high_risk';
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  estimatedProfit: number;
  estimatedLoss: number;
  riskRewardRatio: number;
  confidence: number;
  reasoning: string;
  selected: boolean;
  createdAt: Date;
}

export interface AIAnalysisRequest {
  userId: string;
  prompt: string;
  accountBalance: number;
  decisionType: 'manual' | 'auto';
  symbols?: string[];
  timeframe?: string;
}

export interface AIAnalysisResult {
  decision: AITradeDecision;
  options: TradeOption[];
  marketSummary: AiMarketSummary;
  strategyComparison: {
    fxflowBaseline: any;
    aiIndependent: any;
    hybrid: any;
    selected: string;
  };
}

class AITradingEngine {
  private fxFlowStrategy: FxFlowScalperV2;

  constructor() {
    this.fxFlowStrategy = new FxFlowScalperV2();
  }

  async analyzeTradeRequest(request: AIAnalysisRequest): Promise<AIAnalysisResult> {
    const symbols = request.symbols || ['EURUSD', 'GBPUSD', 'XAUUSD'];
    const timeframe = request.timeframe || 'M15';

    const bestOpportunity = await this.findBestOpportunity(symbols, request.userId);

    if (!bestOpportunity) {
      throw new Error('No profitable trade opportunities found in the current market conditions.');
    }

    const { symbol, candles, marketSummary, fxflowSignal } = bestOpportunity;

    const marketContext = {
      symbol,
      timeframe,
      currentPrice: candles.m1[candles.m1.length - 1].close,
      marketSummary,
      fxflowSignal,
      accountBalance: request.accountBalance
    };

    const chatgptPrompt = this.buildChatGPTPrompt(request, marketContext);

    const chatgptResponse = await this.callChatGPT(chatgptPrompt);

    const aiIndependentSignal = this.parseAIResponse(chatgptResponse, marketContext);

    const strategyComparison = this.compareStrategies(
      fxflowSignal,
      aiIndependentSignal,
      marketSummary
    );

    const selectedStrategy = this.selectBestStrategy(strategyComparison);

    const decision = await this.createTradeDecision({
      userId: request.userId,
      symbol,
      timeframe,
      decisionType: request.decisionType,
      chatgptPrompt,
      chatgptResponse,
      marketContext,
      strategyUsed: selectedStrategy.name,
      signal: selectedStrategy.signal
    });

    const options = await this.generateTradeOptions(
      decision.id,
      request.userId,
      selectedStrategy.signal,
      request.accountBalance
    );

    return {
      decision,
      options,
      marketSummary,
      strategyComparison: {
        fxflowBaseline: fxflowSignal,
        aiIndependent: aiIndependentSignal,
        hybrid: null,
        selected: selectedStrategy.name
      }
    };
  }

  private async findBestOpportunity(symbols: string[], userId: string) {
    let bestOpportunity: any = null;
    let highestConfidence = 0;

    for (const symbol of symbols) {
      try {
        const [h1Candles, m5Candles, m1Candles] = await Promise.all([
          marketDataService.getHistoricalData(symbol, 'H1' as Timeframe, 50, true, true),
          marketDataService.getHistoricalData(symbol, 'M5' as Timeframe, 100, true, true),
          marketDataService.getHistoricalData(symbol, 'M1' as Timeframe, 100, true, true)
        ]);

        const candles: MultiTimeframeCandles = {
          h1: h1Candles,
          m5: m5Candles,
          m1: m1Candles
        };

        const marketSummary = await analyzeMarket(m1Candles);

        const fxflowEvaluation = await this.fxFlowStrategy.evaluateStrategy(symbol, candles);

        if (fxflowEvaluation.trade && fxflowEvaluation.trade.confidence > highestConfidence) {
          highestConfidence = fxflowEvaluation.trade.confidence;
          bestOpportunity = {
            symbol,
            candles,
            marketSummary,
            fxflowSignal: fxflowEvaluation.trade
          };
        }
      } catch (error) {
        console.error(`Error analyzing ${symbol}:`, error);
        continue;
      }
    }

    return bestOpportunity;
  }

  private buildChatGPTPrompt(request: AIAnalysisRequest, marketContext: any): string {
    return `You are Pipnosis AI, an expert forex trading system. You MUST follow these 10 Immutable Laws:

${PIPNOSIS_TRADING_LAWS.join('\n')}

USER REQUEST: "${request.prompt}"

ACCOUNT BALANCE: $${request.accountBalance}

CURRENT MARKET CONDITIONS:
Symbol: ${marketContext.symbol}
Current Price: ${marketContext.currentPrice}
Market Sentiment: ${marketContext.marketSummary.sentiment.status} (${marketContext.marketSummary.sentiment.confidence}% confidence)
RSI: ${marketContext.marketSummary.rsi.value} (${marketContext.marketSummary.rsi.status})
VWAP Position: ${marketContext.marketSummary.vwap.position}
Volume: ${marketContext.marketSummary.volume.status}
Trade Signal: ${marketContext.marketSummary.tradeSignal.status}
${marketContext.marketSummary.tradeSignal.direction ? `Direction: ${marketContext.marketSummary.tradeSignal.direction}` : ''}
${marketContext.marketSummary.tradeSignal.reason ? `Reason: ${marketContext.marketSummary.tradeSignal.reason}` : ''}

BASELINE STRATEGY (FxFlowScalperV2) RECOMMENDATION:
Direction: ${marketContext.fxflowSignal.direction}
Entry: ${marketContext.fxflowSignal.entryPrice}
Stop Loss: ${marketContext.fxflowSignal.stopLoss}
Take Profit: ${marketContext.fxflowSignal.takeProfit}
Confidence: ${marketContext.fxflowSignal.confidence}%
Risk/Reward: ${marketContext.fxflowSignal.riskReward}

TASK:
Analyze the current market conditions and provide your independent trading recommendation. You may agree with the baseline strategy, propose modifications, or suggest a completely different approach if you predict higher success.

Return ONLY valid JSON in this exact format:
{
  "agree_with_baseline": true|false,
  "direction": "BUY"|"SELL",
  "entry_price": number,
  "stop_loss": number,
  "take_profit": number,
  "confidence": number (0-100),
  "risk_reward_ratio": number,
  "reasoning": "Detailed explanation referencing Pipnosis Laws and market conditions",
  "strategy_type": "baseline"|"modified_baseline"|"independent",
  "key_factors": ["factor1", "factor2", "factor3"]
}`;
  }

  private async callChatGPT(prompt: string): Promise<any> {
    if (!OPENAI_API_KEY) {
      console.warn('OpenAI API key not configured, using mock response');
      return this.getMockChatGPTResponse();
    }

    try {
      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: 'You are Pipnosis AI, an expert forex trading assistant. Always return valid JSON responses.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;

      return JSON.parse(content);
    } catch (error) {
      console.error('ChatGPT API call failed:', error);
      return this.getMockChatGPTResponse();
    }
  }

  private getMockChatGPTResponse(): any {
    return {
      agree_with_baseline: true,
      direction: 'BUY',
      entry_price: 1.0850,
      stop_loss: 1.0820,
      take_profit: 1.0910,
      confidence: 78,
      risk_reward_ratio: 2.0,
      reasoning: 'Market conditions support baseline strategy. RSI oversold with bullish divergence. Following Law #6 (Quality Over Quantity) and Law #2 (Minimum 1:1 RRR).',
      strategy_type: 'baseline',
      key_factors: ['RSI oversold', 'VWAP support', 'Strong volume confirmation']
    };
  }

  private parseAIResponse(chatgptResponse: any, marketContext: any): any {
    return {
      direction: chatgptResponse.direction,
      entryPrice: chatgptResponse.entry_price || marketContext.currentPrice,
      stopLoss: chatgptResponse.stop_loss,
      takeProfit: chatgptResponse.take_profit,
      confidence: chatgptResponse.confidence,
      riskReward: chatgptResponse.risk_reward_ratio,
      reasoning: chatgptResponse.reasoning,
      strategyType: chatgptResponse.strategy_type,
      keyFactors: chatgptResponse.key_factors
    };
  }

  private compareStrategies(fxflowSignal: any, aiSignal: any, marketSummary: AiMarketSummary) {
    const fxflowScore = this.calculateStrategyScore(fxflowSignal, marketSummary);
    const aiScore = this.calculateStrategyScore(aiSignal, marketSummary);

    return {
      fxflow: {
        signal: fxflowSignal,
        score: fxflowScore,
        confidence: fxflowSignal.confidence
      },
      ai: {
        signal: aiSignal,
        score: aiScore,
        confidence: aiSignal.confidence
      }
    };
  }

  private calculateStrategyScore(signal: any, marketSummary: AiMarketSummary): number {
    let score = signal.confidence || 0;

    if (marketSummary.tradeSignal.status === 'VALID') {
      score += 10;
    }

    if (signal.riskReward >= 2.0) {
      score += 10;
    } else if (signal.riskReward >= 1.5) {
      score += 5;
    }

    if (marketSummary.sentiment.confidence > 70) {
      score += 5;
    }

    return Math.min(score, 100);
  }

  private selectBestStrategy(comparison: any) {
    if (comparison.ai.score > comparison.fxflow.score + 10) {
      return {
        name: 'ai_independent',
        signal: comparison.ai.signal
      };
    }

    return {
      name: 'fxflow_baseline',
      signal: comparison.fxflow.signal
    };
  }

  private async createTradeDecision(params: {
    userId: string;
    symbol: string;
    timeframe: string;
    decisionType: 'manual' | 'auto';
    chatgptPrompt: string;
    chatgptResponse: any;
    marketContext: any;
    strategyUsed: string;
    signal: any;
  }): Promise<AITradeDecision> {
    const { data, error } = await supabase
      .from('ai_trade_decisions')
      .insert({
        user_id: params.userId,
        symbol: params.symbol,
        timeframe: params.timeframe,
        decision_type: params.decisionType,
        chatgpt_prompt: params.chatgptPrompt,
        chatgpt_response: params.chatgptResponse,
        market_context: params.marketContext,
        trade_direction: params.signal.direction,
        confidence_score: params.signal.confidence,
        strategy_used: params.strategyUsed,
        reasoning: params.signal.reasoning || params.chatgptResponse.reasoning,
        approved: false,
        executed: false
      })
      .select()
      .single();

    if (error) throw error;

    return {
      id: data.id,
      userId: data.user_id,
      symbol: data.symbol,
      timeframe: data.timeframe,
      decisionType: data.decision_type,
      chatgptPrompt: data.chatgpt_prompt,
      chatgptResponse: data.chatgpt_response,
      marketContext: data.market_context,
      tradeDirection: data.trade_direction,
      confidenceScore: data.confidence_score,
      strategyUsed: data.strategy_used,
      reasoning: data.reasoning,
      approved: data.approved,
      executed: data.executed,
      createdAt: new Date(data.created_at)
    };
  }

  private async generateTradeOptions(
    decisionId: string,
    userId: string,
    signal: any,
    accountBalance: number
  ): Promise<TradeOption[]> {
    const options = this.calculateRiskVariants(signal, accountBalance);

    const insertData = options.map(opt => ({
      user_id: userId,
      decision_id: decisionId,
      option_type: opt.optionType,
      symbol: signal.symbol || 'EURUSD',
      direction: signal.direction,
      entry_price: opt.entryPrice,
      stop_loss: opt.stopLoss,
      take_profit: opt.takeProfit,
      lot_size: opt.lotSize,
      estimated_profit: opt.estimatedProfit,
      estimated_loss: opt.estimatedLoss,
      risk_reward_ratio: opt.riskRewardRatio,
      confidence: opt.confidence,
      reasoning: opt.reasoning,
      selected: false
    }));

    const { data, error } = await supabase
      .from('trade_options')
      .insert(insertData)
      .select();

    if (error) throw error;

    return data.map((d: any) => ({
      id: d.id,
      userId: d.user_id,
      decisionId: d.decision_id,
      optionType: d.option_type,
      symbol: d.symbol,
      direction: d.direction,
      entryPrice: d.entry_price,
      stopLoss: d.stop_loss,
      takeProfit: d.take_profit,
      lotSize: d.lot_size,
      estimatedProfit: d.estimated_profit,
      estimatedLoss: d.estimated_loss,
      riskRewardRatio: d.risk_reward_ratio,
      confidence: d.confidence,
      reasoning: d.reasoning,
      selected: d.selected,
      createdAt: new Date(d.created_at)
    }));
  }

  private calculateRiskVariants(signal: any, accountBalance: number) {
    const baseEntry = signal.entryPrice;
    const baseStopLoss = signal.stopLoss;
    const baseTakeProfit = signal.takeProfit;

    const lowRiskPercent = 0.01;
    const mediumRiskPercent = 0.02;
    const highRiskPercent = 0.04;

    const stopLossPips = Math.abs(baseEntry - baseStopLoss) * 10000;
    const takeProfitPips = Math.abs(baseTakeProfit - baseEntry) * 10000;

    const lowLotSize = this.calculateLotSize(accountBalance, lowRiskPercent, stopLossPips);
    const mediumLotSize = this.calculateLotSize(accountBalance, mediumRiskPercent, stopLossPips);
    const highLotSize = this.calculateLotSize(accountBalance, highRiskPercent, stopLossPips);

    return [
      {
        optionType: 'low_risk' as const,
        entryPrice: baseEntry,
        stopLoss: baseStopLoss,
        takeProfit: baseTakeProfit,
        lotSize: lowLotSize,
        estimatedProfit: this.calculateProfit(lowLotSize, takeProfitPips),
        estimatedLoss: this.calculateProfit(lowLotSize, stopLossPips) * -1,
        riskRewardRatio: takeProfitPips / stopLossPips,
        confidence: signal.confidence,
        reasoning: 'Conservative approach risking 1% of account. Ideal for capital preservation (Law #1).'
      },
      {
        optionType: 'medium_risk' as const,
        entryPrice: baseEntry,
        stopLoss: baseStopLoss,
        takeProfit: baseTakeProfit,
        lotSize: mediumLotSize,
        estimatedProfit: this.calculateProfit(mediumLotSize, takeProfitPips),
        estimatedLoss: this.calculateProfit(mediumLotSize, stopLossPips) * -1,
        riskRewardRatio: takeProfitPips / stopLossPips,
        confidence: signal.confidence,
        reasoning: 'Balanced approach risking 2% of account. Standard risk management (Law #1).'
      },
      {
        optionType: 'high_risk' as const,
        entryPrice: baseEntry,
        stopLoss: baseStopLoss,
        takeProfit: baseTakeProfit,
        lotSize: highLotSize,
        estimatedProfit: this.calculateProfit(highLotSize, takeProfitPips),
        estimatedLoss: this.calculateProfit(highLotSize, stopLossPips) * -1,
        riskRewardRatio: takeProfitPips / stopLossPips,
        confidence: Math.max(signal.confidence - 10, 50),
        reasoning: 'Aggressive approach risking 4% of account. Maximum allowed risk (Law #1).'
      }
    ];
  }

  private calculateLotSize(accountBalance: number, riskPercent: number, stopLossPips: number): number {
    const riskAmount = accountBalance * riskPercent;
    const pipValue = 10;
    const lotSize = riskAmount / (stopLossPips * pipValue);
    return Math.max(0.01, Math.round(lotSize * 100) / 100);
  }

  private calculateProfit(lotSize: number, pips: number): number {
    const pipValue = 10;
    return Math.round(lotSize * pips * pipValue * 100) / 100;
  }

  async approveTradeOption(optionId: string, userId: string): Promise<boolean> {
    const { data: option, error: optionError } = await supabase
      .from('trade_options')
      .update({ selected: true })
      .eq('id', optionId)
      .eq('user_id', userId)
      .select()
      .single();

    if (optionError) throw optionError;

    const { error: decisionError } = await supabase
      .from('ai_trade_decisions')
      .update({ approved: true })
      .eq('id', option.decision_id)
      .eq('user_id', userId);

    if (decisionError) throw decisionError;

    return true;
  }
}

export const aiTradingEngine = new AITradingEngine();
