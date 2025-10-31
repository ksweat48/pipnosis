import { TechnicalSignal } from './technicalScanEngine';

interface Candle {
  time: string | Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface AIMarketAnalysis {
  symbol: string;
  timeframe: string;
  trend: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  reasoning: string;
  keyLevels: {
    support: number[];
    resistance: number[];
  };
  riskAssessment: string;
  timeHorizon: string;
  entryStrategy?: string;
  exitStrategy?: string;
  timestamp: Date;
}

class AIMarketEngine {
  private apiKey: string;
  private apiCallCount: number = 0;
  private lastApiCall: Date | null = null;
  private cache: Map<string, { analysis: AIMarketAnalysis; timestamp: Date }> = new Map();
  private readonly CACHE_DURATION_MS = 15 * 60 * 1000;
  private readonly MAX_CALLS_PER_HOUR = 20;
  private readonly MIN_CALL_INTERVAL_MS = 3 * 60 * 1000;

  constructor() {
    this.apiKey = import.meta.env.VITE_OPENAI_API_KEY || '';
  }

  private canMakeApiCall(): { allowed: boolean; reason?: string } {
    if (!this.apiKey) {
      return { allowed: false, reason: 'OpenAI API key not configured' };
    }

    if (this.apiCallCount >= this.MAX_CALLS_PER_HOUR) {
      return { allowed: false, reason: 'Hourly API call limit reached' };
    }

    if (this.lastApiCall) {
      const timeSinceLastCall = Date.now() - this.lastApiCall.getTime();
      if (timeSinceLastCall < this.MIN_CALL_INTERVAL_MS) {
        return { allowed: false, reason: `Wait ${Math.ceil((this.MIN_CALL_INTERVAL_MS - timeSinceLastCall) / 1000)}s before next API call` };
      }
    }

    return { allowed: true };
  }

  private getCacheKey(symbol: string, timeframe: string): string {
    return `${symbol}_${timeframe}`;
  }

  private getFromCache(symbol: string, timeframe: string): AIMarketAnalysis | null {
    const key = this.getCacheKey(symbol, timeframe);
    const cached = this.cache.get(key);

    if (!cached) return null;

    const age = Date.now() - cached.timestamp.getTime();
    if (age > this.CACHE_DURATION_MS) {
      this.cache.delete(key);
      return null;
    }

    console.log(`[AI Cache] Using cached analysis for ${symbol} ${timeframe} (age: ${Math.round(age / 1000)}s)`);
    return cached.analysis;
  }

  private saveToCache(symbol: string, timeframe: string, analysis: AIMarketAnalysis): void {
    const key = this.getCacheKey(symbol, timeframe);
    this.cache.set(key, { analysis, timestamp: new Date() });
  }

  private formatCandlesForAI(candles: Candle[], limit: number = 20): string {
    const recentCandles = candles.slice(-limit);
    return recentCandles.map((c, i) => {
      const time = typeof c.time === 'string' ? c.time : new Date(c.time).toISOString();
      return `${i + 1}. Time: ${time}, O: ${c.open}, H: ${c.high}, L: ${c.low}, C: ${c.close}`;
    }).join('\n');
  }

  private buildAnalysisPrompt(symbol: string, timeframe: string, candles: Candle[], technicalSignal?: TechnicalSignal): string {
    const candleData = this.formatCandlesForAI(candles);
    const currentPrice = candles[candles.length - 1].close;

    let prompt = `You are an expert forex market analyst. Analyze the following ${symbol} ${timeframe} candlestick data and provide a concise trading analysis.

Recent ${symbol} candlestick data (most recent ${Math.min(candles.length, 20)} candles):
${candleData}

Current Price: ${currentPrice}`;

    if (technicalSignal) {
      prompt += `

Technical Scan Engine detected a ${technicalSignal.direction.toUpperCase()} signal with score ${technicalSignal.score}/100:
- EMA9: ${technicalSignal.indicators.ema9.toFixed(5)}
- EMA21: ${technicalSignal.indicators.ema21.toFixed(5)}
- EMA50: ${technicalSignal.indicators.ema50.toFixed(5)}
- RSI: ${technicalSignal.indicators.rsi.toFixed(2)}
- MACD: ${technicalSignal.indicators.macd.macd.toFixed(5)} (Signal: ${technicalSignal.indicators.macd.signal.toFixed(5)})
- ATR: ${technicalSignal.indicators.atr.toFixed(5)}
- Pattern: ${technicalSignal.indicators.pattern || 'None'}
- Reasons: ${technicalSignal.reasons.join(', ')}`;
    }

    prompt += `

Provide your analysis in the following JSON format (respond ONLY with valid JSON, no markdown):
{
  "trend": "bullish|bearish|neutral",
  "confidence": <number 0-100>,
  "recommendation": "strong_buy|buy|hold|sell|strong_sell",
  "reasoning": "<2-3 sentence market context and validation>",
  "keyLevels": {
    "support": [<price1>, <price2>],
    "resistance": [<price1>, <price2>]
  },
  "riskAssessment": "<1-2 sentence risk analysis>",
  "timeHorizon": "<short|medium|long term outlook>",
  "entryStrategy": "<optimal entry approach>",
  "exitStrategy": "<take profit and stop loss strategy>"
}`;

    return prompt;
  }

  async analyzeMarket(candles: Candle[], technicalSignal?: TechnicalSignal): Promise<AIMarketAnalysis> {
    const symbol = technicalSignal?.symbol || 'UNKNOWN';
    const timeframe = technicalSignal?.timeframe || 'H1';

    const cached = this.getFromCache(symbol, timeframe);
    if (cached) {
      return cached;
    }

    const callCheck = this.canMakeApiCall();
    if (!callCheck.allowed) {
      console.warn(`[AI Engine] Cannot make API call: ${callCheck.reason}`);
      return this.createFallbackAnalysis(symbol, timeframe, candles, technicalSignal);
    }

    try {
      console.log(`[AI Engine] Analyzing ${symbol} ${timeframe} with GPT-4...`);

      const prompt = this.buildAnalysisPrompt(symbol, timeframe, candles, technicalSignal);

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
              content: 'You are an expert forex technical analyst. Provide concise, actionable trading analysis in JSON format.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 800
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`OpenAI API error: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No content in OpenAI response');
      }

      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const aiResponse = JSON.parse(cleanContent);

      const analysis: AIMarketAnalysis = {
        symbol,
        timeframe,
        trend: aiResponse.trend,
        confidence: aiResponse.confidence,
        recommendation: aiResponse.recommendation,
        reasoning: aiResponse.reasoning,
        keyLevels: aiResponse.keyLevels,
        riskAssessment: aiResponse.riskAssessment,
        timeHorizon: aiResponse.timeHorizon,
        entryStrategy: aiResponse.entryStrategy,
        exitStrategy: aiResponse.exitStrategy,
        timestamp: new Date()
      };

      this.apiCallCount++;
      this.lastApiCall = new Date();
      this.saveToCache(symbol, timeframe, analysis);

      console.log(`[AI Engine] Analysis complete. API calls: ${this.apiCallCount}/${this.MAX_CALLS_PER_HOUR}`);

      return analysis;

    } catch (error) {
      console.error('[AI Engine] Analysis failed:', error);
      return this.createFallbackAnalysis(symbol, timeframe, candles, technicalSignal);
    }
  }

  private createFallbackAnalysis(
    symbol: string,
    timeframe: string,
    candles: Candle[],
    technicalSignal?: TechnicalSignal
  ): AIMarketAnalysis {
    console.log('[AI Engine] Using fallback rule-based analysis');

    if (technicalSignal) {
      const trendMap: Record<string, 'bullish' | 'bearish' | 'neutral'> = {
        buy: 'bullish',
        sell: 'bearish'
      };

      const recMap: Record<string, 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell'> = {
        buy: technicalSignal.score >= 85 ? 'strong_buy' : 'buy',
        sell: technicalSignal.score >= 85 ? 'strong_sell' : 'sell'
      };

      return {
        symbol,
        timeframe,
        trend: trendMap[technicalSignal.direction] || 'neutral',
        confidence: technicalSignal.score,
        recommendation: recMap[technicalSignal.direction] || 'hold',
        reasoning: `Technical analysis suggests ${technicalSignal.direction} opportunity. ${technicalSignal.reasons.join('. ')}.`,
        keyLevels: {
          support: [technicalSignal.stopLoss],
          resistance: [technicalSignal.takeProfit]
        },
        riskAssessment: `Risk managed with SL at ${technicalSignal.stopLoss.toFixed(5)} and TP at ${technicalSignal.takeProfit.toFixed(5)}. R:R ratio approximately 1:2.`,
        timeHorizon: timeframe === 'M5' || timeframe === 'M15' ? 'Short-term scalp' : 'Intraday swing',
        entryStrategy: `Enter at current price ${technicalSignal.entryPrice.toFixed(5)} with confirmation from ${technicalSignal.confidence} confidence setup.`,
        exitStrategy: `Target: ${technicalSignal.takeProfit.toFixed(5)}, Stop: ${technicalSignal.stopLoss.toFixed(5)}`,
        timestamp: new Date()
      };
    }

    const currentPrice = candles[candles.length - 1].close;
    return {
      symbol,
      timeframe,
      trend: 'neutral',
      confidence: 30,
      recommendation: 'hold',
      reasoning: 'Market conditions are unclear. Waiting for stronger technical confirmation before entering.',
      keyLevels: {
        support: [currentPrice * 0.998],
        resistance: [currentPrice * 1.002]
      },
      riskAssessment: 'Low probability setup. Recommend staying on sidelines until clearer signal emerges.',
      timeHorizon: 'No clear trend',
      timestamp: new Date()
    };
  }

  resetHourlyLimit(): void {
    this.apiCallCount = 0;
    console.log('[AI Engine] Hourly API call limit reset');
  }

  getUsageStats(): { callsUsed: number; maxCalls: number; cacheSize: number } {
    return {
      callsUsed: this.apiCallCount,
      maxCalls: this.MAX_CALLS_PER_HOUR,
      cacheSize: this.cache.size
    };
  }
}

export const aiMarketEngine = new AIMarketEngine();

export async function analyzeMarket(candles: Candle[], technicalSignal?: TechnicalSignal): Promise<AIMarketAnalysis> {
  return aiMarketEngine.analyzeMarket(candles, technicalSignal);
}

setInterval(() => {
  aiMarketEngine.resetHourlyLimit();
}, 60 * 60 * 1000);
