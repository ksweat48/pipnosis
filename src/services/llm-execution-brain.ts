/**
 * LLM Execution Brain - Final Trade Decision with Personality
 *
 * Makes the final trade decision when conditions are met.
 * Injects trader score, personality state, and mission.
 * Ultra-compressed prompts for cost efficiency.
 */

import { openAIClient } from './openai-client';
import { getExecutionIdentity, type TraderScore } from './ai-identity';

export interface MicroSnapshot {
  p: number; // price
  e50: number;
  e200: number;
  rsi: number;
  st: number; // stoch rsi
  atr: number;
  vw: number;
  trend: string;
  vol: string;
  dir: string; // suggested direction from strategy

  // Omega Sensors (reduced set for micro snapshot)
  bos?: string; // structure
  cho?: string;
  vol_s?: number; // volume spike
  rdiv?: string; // rsi divergence
  mdiv?: string; // macd divergence
  pat?: { eng_b: number; eng_s: number; mom: number }; // key patterns only
}

export interface TradeDecision {
  action: 'BUY' | 'SELL' | 'NO_TRADE' | 'WAIT';
  entry?: number; // Optional for WAIT decisions
  stopLoss?: number; // Optional for WAIT decisions
  takeProfit?: number; // Optional for WAIT decisions
  risk_pct: number;
  confidence: number;
  reasoning: string;
  strategyMode: string;
}

class LLMExecutionBrain {
  /**
   * Decide whether to execute trade
   */
  async decideTrade(
    trigger: string,
    snapshot: MicroSnapshot,
    traderScore: TraderScore,
    strategyMode: string,
    conditionsMet: string[]
  ): Promise<TradeDecision> {
    const identity = getExecutionIdentity(traderScore);

    // Ultra-compressed prompt (< 300 tokens)
    const prompt = `${identity}

Trigger: ${trigger}
Strategy: ${strategyMode}
Conditions: ${conditionsMet.join(', ')}

Data:
${JSON.stringify(snapshot)}

Trade?
{
  "action": "BUY|SELL|NO_TRADE",
  "entry": ${snapshot.p},
  "stopLoss": number,
  "takeProfit": number,
  "risk_pct": 1-5,
  "confidence": 60-95,
  "reasoning": "brief why"
}

Max 150 tokens.`;

    console.log('[Execution Brain] 💡 Evaluating trade decision...');

    const response = await openAIClient.chat(
      [
        {
          role: 'system',
          content: 'Pipnosis Alpha. Decide fast. JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      {
        model: 'gpt-4o-mini',
        temperature: 0.2, // Low temp for consistent decisions
        max_tokens: 200,
        requestType: 'execution_decision',
        endpoint: 'llm-execution-brain'
      }
    );

    const content = response.choices[0]?.message?.content || '{}';
    const decision = this.parseDecisionResponse(content, snapshot, strategyMode);

    if (decision.action === 'NO_TRADE') {
      console.log(`[Execution Brain] ❌ No trade: ${decision.reasoning}`);
    } else {
      console.log(`[Execution Brain] ✅ ${decision.action} @ ${decision.entry}`);
      console.log(`[Execution Brain] SL: ${decision.stopLoss} | TP: ${decision.takeProfit}`);
      console.log(`[Execution Brain] Risk: ${decision.risk_pct}% | Conf: ${decision.confidence}%`);
      console.log(`[Execution Brain] Reason: ${decision.reasoning}`);
    }

    return decision;
  }

  /**
   * Parse LLM response into trade decision
   */
  private parseDecisionResponse(
    response: string,
    snapshot: MicroSnapshot,
    strategyMode: string
  ): TradeDecision {
    try {
      const cleaned = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      // Validate action
      const action = ['BUY', 'SELL', 'NO_TRADE'].includes(parsed.action)
        ? parsed.action
        : 'NO_TRADE';

      return {
        action,
        entry: parsed.entry || snapshot.p,
        stopLoss: parsed.stopLoss || 0,
        takeProfit: parsed.takeProfit || 0,
        risk_pct: Math.max(1, Math.min(5, parsed.risk_pct || 3)),
        confidence: Math.max(0, Math.min(100, parsed.confidence || 70)),
        reasoning: parsed.reasoning || 'AI decision',
        strategyMode
      };
    } catch (error) {
      console.error('[Execution Brain] Failed to parse response:', error);

      return {
        action: 'NO_TRADE',
        entry: snapshot.p,
        stopLoss: 0,
        takeProfit: 0,
        risk_pct: 0,
        confidence: 0,
        reasoning: 'Parse error',
        strategyMode
      };
    }
  }

  /**
   * Build micro snapshot for execution
   */
  buildMicroSnapshot(
    currentPrice: number,
    indicators: {
      ema50: number;
      ema200: number;
      rsi: number;
      stochRsi: number;
      atr: number;
      vwap: number;
    },
    priceAction: {
      trend: string;
      volatility: string;
    },
    suggestedDirection: 'buy' | 'sell'
  ): MicroSnapshot {
    return {
      p: parseFloat(currentPrice.toFixed(5)),
      e50: parseFloat(indicators.ema50.toFixed(5)),
      e200: parseFloat(indicators.ema200.toFixed(5)),
      rsi: Math.round(indicators.rsi),
      st: Math.round(indicators.stochRsi),
      atr: parseFloat(indicators.atr.toFixed(5)),
      vw: parseFloat(indicators.vwap.toFixed(5)),
      trend: priceAction.trend,
      vol: priceAction.volatility,
      dir: suggestedDirection
    };
  }

  /**
   * Calculate suggested SL/TP based on ATR and direction
   */
  calculateLevels(
    entry: number,
    atr: number,
    direction: 'buy' | 'sell',
    slMultiplier: number = 1.5,
    tpMultiplier: number = 2.5
  ): { stopLoss: number; takeProfit: number } {
    if (direction === 'buy') {
      return {
        stopLoss: entry - (atr * slMultiplier),
        takeProfit: entry + (atr * tpMultiplier)
      };
    } else {
      return {
        stopLoss: entry + (atr * slMultiplier),
        takeProfit: entry - (atr * tpMultiplier)
      };
    }
  }
}

export const llmExecutionBrain = new LLMExecutionBrain();
