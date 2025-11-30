/**
 * LLM Strategy Brain - Autonomous Strategy Planning
 *
 * The AI defines its own trading strategy based on market conditions
 * and current performance score. Plans triggers, conditions, and execution logic.
 */

import { openAIClient } from './openai-client';
import { getStrategyPlanningIdentity, type TraderScore } from './ai-identity';
import { strategyMemoryService } from './strategy-memory-service';
import type { RegimeSnapshot } from './regime-oracle';
import type { AdversarialSignal } from './adversarial-detector';

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

  // Omega Sensor Package (compressed)
  sh?: number; // swing_high
  sl?: number; // swing_low
  bos?: string; // break_of_structure
  cho?: string; // change_of_character
  eqh?: number; // equal_highs
  eql?: number; // equal_lows
  vol_s?: number; // volume_spike
  atr_t?: string; // atr_trend
  vol_r?: string; // vol_regime
  rdiv?: string; // rsi_divergence
  mdif?: number; // macd_diff
  mdiv?: string; // macd_divergence
  pat?: { // patterns
    eng_b: number;
    eng_s: number;
    pin_b: number;
    pin_s: number;
    doji: number;
    mom: number;
  };
  mic?: { // micro-structure
    pull: number;
    dvw: number;
    msr: string;
  };
}

export interface StrategyPlan {
  mode: 'trend' | 'breakout' | 'pullback' | 'reversal' | 'range';
  conditions: string[]; // ["p>e50", "rsi>50", "vw_above"]
  entry_logic: string; // "when 2 of 3 conditions=True"
  sl_calculation: string; // "atr*1.5"
  tp_calculation: string; // "atr*2.5"
  risk_pct: number; // 1-5%
  riskLevel: number; // 1-5%
  confidence: number; // 60-95
  rationale: string;
  watch_indicators: string[];
}

class LLMStrategyBrain {
  /**
   * Plan trading strategy based on market conditions, trader score, AND past memory
   */
  async planStrategy(
    snapshot: StrategySnapshot,
    traderScore: TraderScore,
    userId?: string,
    regime?: RegimeSnapshot,
    adversarial?: AdversarialSignal
  ): Promise<StrategyPlan> {
    const identity = getStrategyPlanningIdentity(traderScore);

    // Build regime context (compressed)
    let regimeSection = '';
    if (regime) {
      const atrState = regime.atr_compression ? 'comp' : regime.atr_expansion ? 'exp' : 'norm';
      regimeSection = `\n\nREGIME:\ns=${regime.session}\nvol=${regime.volatility_score}\ntrend=${regime.trend_strength_score}\nstruct=${regime.structure}\natr=${atrState}\nrisk=${regime.is_high_risk_regime ? 'HIGH' : 'norm'}\nwick=${regime.wick_risk}\n`;

      console.log('[Strategy Brain] 🌍 Regime context:', {
        session: regime.session,
        vol: regime.volatility_score,
        trend: regime.trend_strength_score,
        structure: regime.structure
      });
    }

    // Build adversarial context (compressed)
    let adversarialSection = '';
    if (adversarial && adversarial.is_adversarial) {
      const patternShort = adversarial.patterns.slice(0, 3).join(',');
      adversarialSection = `\n\nADVERSARIAL:\nlvl=${adversarial.level}\nscore=${adversarial.suspicion_score}\npat=${patternShort}\n`;

      console.log('[Strategy Brain] ⚠️  Adversarial context:', {
        level: adversarial.level,
        score: adversarial.suspicion_score,
        patterns: adversarial.patterns.length
      });
    }

    // Load strategy memory (if userId provided)
    let memorySection = '';
    if (userId) {
      try {
        const memory = await strategyMemoryService.loadMemory(
          userId,
          snapshot.sym,
          snapshot.trend,
          snapshot.vol
        );

        if (memory.memorySummary) {
          memorySection = `\n\nYOUR MEMORY (past performance):\n${memory.memorySummary}\n`;
          console.log('[Strategy Brain] 📚 Loaded strategy memory:');
          console.log(`  - Recent strategies: ${memory.recentStrategies.length}`);
          console.log(`  - Best in regime: ${memory.bestInCurrentRegime.length}`);
          console.log(`  - Experience: ${memory.regimeInsights.totalExperience} trades`);
        }
      } catch (error) {
        console.warn('[Strategy Brain] Failed to load memory:', error);
      }
    }

    // Ultra-compressed prompt with memory context
    const prompt = `${identity}

Market Snapshot:
${JSON.stringify(snapshot)}${regimeSection}${adversarialSection}${memorySection}

Analyze market, regime, adversarial, AND your memory. Define strategy for next 50-100 candles.

CRITICAL: conditions MUST use EXACT parseable codes:
- Price vs EMA: "p>e50", "p<e20", "p>e200", "p<e200"
- RSI: "rsi>70", "rsi<30", "rsi>50", "rsi<50", "rsi>40", "rsi<60"
- Trend: "trend=bull", "trend=bear"
- VWAP: "p>vw", "p<vw"
- EMA cross: "e20>e50", "e20<e50"
- Stoch RSI: "st>70", "st<30"
- Structure: "bos_bull", "bos_bear", "choch_bull", "choch_bear", "swing_high", "swing_low", "equal_highs", "equal_lows"
- Volume: "volume_spike", "vol_high", "vol_low", "atr_expanding", "atr_contracting"
- Divergence: "rsi_div_bull", "rsi_div_bear", "macd_div_bull", "macd_div_bear"
- Patterns: "bull_engulf", "bear_engulf", "pin_bar_bull", "pin_bar_bear", "doji", "momentum_bar"
- Micro: "pullback_complete", "near_vwap", "above_resistance", "below_support"
NO natural language. Use codes ONLY.

REGIME RULES (if regime provided):
- s=ny_open: avoid reversals, prefer breakouts, quick exits
- s=london: prefer trend continuation, pullbacks
- s=dead: avoid unless user override
- atr=comp + struct=range: avoid breakouts
- vol>80: reduce risk 50%
- risk=HIGH: require R:R > 2.0
- wick=high: widen stops 20%

ADVERSARIAL RULES (if adversarial provided):
- lvl=moderate: be cautious, avoid aggressive entries, prefer mean-reversion in stop-hunted ranges
- lvl=mild: extra caution, slightly tighter conditions
- stop_run patterns: consider fade plays if structure supports
- fake_breakout patterns: avoid breakout strategies, favor range trading
- whipsaw patterns: require stronger confirmation, reduce position expectations

Return JSON:
{
  "mode": "trend|breakout|pullback|reversal|range",
  "conditions": ["p>e50", "rsi>50", "trend=bull"],
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
        riskLevel: parsed.risk_pct || 3,
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
        riskLevel: 3,
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
