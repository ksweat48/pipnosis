/**
 * LLM Strategy Brain - Autonomous Strategy Planning
 *
 * The AI defines its own trading strategy based on market conditions
 * and current performance score. Plans triggers, conditions, and execution logic.
 */

import { openAIClient } from './openai-client';
import { getStrategyPlanningIdentity, type TraderScore } from './ai-identity';

export interface StrategySnapshot {
  sym: string;
  tf: string;
  p: number;
  e20: number;
  e50: number;
  e200: number;
  rsi: number;
  st: number; // stoch rsi
  atr: number;
  vw: number;
  sup: number[];
  res: number[];
  c: number[][]; // last 5 candles [o,h,l,c]
  vol: string; // low/med/high
  sw: { h: number; l: number };
  trend: string; // bull/bear/side
  mom: number; // momentum
}

export interface StrategyPlan {
  mode: 'trend' | 'breakout' | 'pullback' | 'reversal' | 'range';
  conditions: string[]; // ["p>e50", "rsi>50", "vw_above"]
  entry_logic: string; // "when 2 of 3 conditions=True"
  sl_calculation: string; // "atr*1.5"
  tp_calculation: string; // "atr*2.5"
  risk_pct: number; // 1-5%
  confidence: number; // 60-95
  rationale: string;
  watch_indicators: string[];
}

class LLMStrategyBrain {
  /**
   * Plan trading strategy based on market conditions and trader score
   */
  async planStrategy(
    snapshot: StrategySnapshot,
    traderScore: TraderScore
  ): Promise<StrategyPlan> {
    const identity = getStrategyPlanningIdentity(traderScore);

    // Ultra-compressed prompt (< 300 tokens)
    const prompt = `${identity}

Market Snapshot:
${JSON.stringify(snapshot)}

Analyze market. Define strategy for next 50-100 candles.

Return JSON:
{
  "mode": "trend|breakout|pullback|reversal|range",
  "conditions": ["condition1", "condition2", "condition3"],
  "entry_logic": "when X of Y conditions true",
  "sl_calculation": "atr*X",
  "tp_calculation": "atr*Y",
  "risk_pct": 1-5,
  "confidence": 60-95,
  "rationale": "brief explanation",
  "watch_indicators": ["ema20", "rsi", "vwap"]
}

Max 200 tokens.`;

    console.log('[Strategy Brain] 🧠 Planning strategy...');

    const response = await openAIClient.chat(
      [
        {
          role: 'system',
          content: 'You are Pipnosis Alpha. Return JSON only. Be concise.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      {
        model: 'gpt-4o-mini',
        temperature: 0.4, // Some creativity for strategy
        max_tokens: 300,
        requestType: 'strategy_planning',
        endpoint: 'llm-strategy-brain'
      }
    );

    const content = response.choices[0]?.message?.content || '{}';
    const plan = this.parseStrategyResponse(content);

    console.log(`[Strategy Brain] ✅ Strategy: ${plan.mode}`);
    console.log(`[Strategy Brain] Conditions: ${plan.conditions.join(', ')}`);
    console.log(`[Strategy Brain] Risk: ${plan.risk_pct}% | Confidence: ${plan.confidence}%`);
    console.log(`[Strategy Brain] Rationale: ${plan.rationale}`);

    return plan;
  }

  /**
   * Parse LLM response into strategy plan
   */
  private parseStrategyResponse(response: string): StrategyPlan {
    try {
      const cleaned = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      return {
        mode: parsed.mode || 'trend',
        conditions: parsed.conditions || [],
        entry_logic: parsed.entry_logic || 'when all conditions true',
        sl_calculation: parsed.sl_calculation || 'atr*1.5',
        tp_calculation: parsed.tp_calculation || 'atr*2.5',
        risk_pct: parsed.risk_pct || 3,
        confidence: parsed.confidence || 70,
        rationale: parsed.rationale || 'Default strategy',
        watch_indicators: parsed.watch_indicators || ['ema20', 'ema50', 'rsi']
      };
    } catch (error) {
      console.error('[Strategy Brain] Failed to parse response:', error);

      // Fallback strategy
      return {
        mode: 'trend',
        conditions: ['p>e50', 'rsi>50', 'trend=bull'],
        entry_logic: 'when all 3 conditions true',
        sl_calculation: 'atr*1.5',
        tp_calculation: 'atr*2.5',
        risk_pct: 3,
        confidence: 70,
        rationale: 'Fallback trend-following strategy',
        watch_indicators: ['ema20', 'ema50', 'rsi', 'vwap']
      };
    }
  }

  /**
   * Build compressed snapshot from full market data
   */
  buildStrategySnapshot(
    candles: any[],
    symbol: string,
    timeframe: string,
    indicators: {
      ema20: number;
      ema50: number;
      ema200: number;
      rsi: number;
      stochRsi: number;
      atr: number;
      vwap: number;
    },
    priceAction: {
      trend: string;
      momentum: number;
      volatility: string;
    },
    levels: {
      support: number[];
      resistance: number[];
      swingHigh: number;
      swingLow: number;
    }
  ): StrategySnapshot {
    const currentPrice = candles[candles.length - 1].close;
    const recentCandles = candles.slice(-5).map(c => [
      parseFloat(c.open.toFixed(5)),
      parseFloat(c.high.toFixed(5)),
      parseFloat(c.low.toFixed(5)),
      parseFloat(c.close.toFixed(5))
    ]);

    return {
      sym: symbol,
      tf: timeframe,
      p: parseFloat(currentPrice.toFixed(5)),
      e20: parseFloat(indicators.ema20.toFixed(5)),
      e50: parseFloat(indicators.ema50.toFixed(5)),
      e200: parseFloat(indicators.ema200.toFixed(5)),
      rsi: Math.round(indicators.rsi),
      st: Math.round(indicators.stochRsi),
      atr: parseFloat(indicators.atr.toFixed(5)),
      vw: parseFloat(indicators.vwap.toFixed(5)),
      sup: levels.support.map(s => parseFloat(s.toFixed(5))),
      res: levels.resistance.map(r => parseFloat(r.toFixed(5))),
      c: recentCandles,
      vol: priceAction.volatility,
      sw: {
        h: parseFloat(levels.swingHigh.toFixed(5)),
        l: parseFloat(levels.swingLow.toFixed(5))
      },
      trend: priceAction.trend,
      mom: Math.round(priceAction.momentum)
    };
  }
}

export const llmStrategyBrain = new LLMStrategyBrain();
