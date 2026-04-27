/**
 * LLM Strategy Brain - Autonomous Strategy Planning
 *
 * The AI defines its own trading strategy based on market conditions
 * and current performance score. Plans triggers, conditions, and execution logic.
 */

import { openAIClient } from './openai-client';
import { PIPNOSIS_IDENTITY, type TraderScore } from './ai-identity';
import { strategyMemoryService } from './strategy-memory-service';
import type { RegimeSnapshot } from './regime-oracle';
import type { AdversarialSignal } from './adversarial-detector';
import { strategyPlaybookManager } from './strategy-playbook-manager';

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
    adversarial?: AdversarialSignal,
    tradeStyle?: string
  ): Promise<StrategyPlan> {
    const identity = `You are ${PIPNOSIS_IDENTITY.name}, ${PIPNOSIS_IDENTITY.role}. ${PIPNOSIS_IDENTITY.primeDirect}`;

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

    // Load playbook context (NEW: Deep Strategy Memory)
    let playbookSection = '';
    if (userId) {
      try {
        const playbookContext = await strategyPlaybookManager.getPlaybookContext(
          userId,
          snapshot.sym,
          snapshot.tf,
          'trend', // Default mode, can be adjusted
          regime,
          adversarial
        );

        if (playbookContext.has_playbook) {
          playbookSection = `\n\n${playbookContext.compressed_summary}\n`;
          console.log('[Strategy Brain] 📖 Loaded playbook:');
          if (playbookContext.stats) {
            console.log(`  - WR: ${(playbookContext.stats.win_rate * 100).toFixed(0)}%`);
            console.log(`  - Avg R: ${playbookContext.stats.avg_pnl_r.toFixed(2)}`);
            console.log(`  - Trades: ${playbookContext.stats.trades_count}`);
          }
        }
      } catch (error) {
        console.warn('[Strategy Brain] Failed to load playbook:', error);
      }
    }

    // Load strategy memory (if userId provided)
    let memorySection = '';
    if (userId) {
      try {
        const memory = await strategyMemoryService.loadMemory(
          userId,
          snapshot.sym,
          snapshot.trend
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

    const styleDirective = this.buildImmutableStyleDirective(tradeStyle);

    const prompt = `${identity}

Market Snapshot:
${JSON.stringify(snapshot)}${regimeSection}${adversarialSection}${playbookSection}${memorySection}${styleDirective}

Analyze market, regime, adversarial, playbook, AND your memory. Define strategy for next 50-100 candles.

${playbookSection ? 'NOTE: Use PLAYBOOK as starting point. You may adjust params slightly based on current conditions.' : ''}

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

DIRECTIONAL AWARENESS (MANDATORY — match conditions to ACTUAL market direction):
- trend=bull in snapshot → use bull conditions: "trend=bull", "rsi>50", "p>e50", "bos_bull", "bull_engulf"
- trend=bear in snapshot → use bear conditions: "trend=bear", "rsi<50", "p<e50", "bos_bear", "bear_engulf"
- trend=side in snapshot → use range/neutral conditions: "near_vwap", "rsi>40", "rsi<60", "vol_high", "pullback_complete", "near_swing_low", "near_swing_high"
- NEVER mix bull-only conditions with a bearish trend snapshot. Match direction or use neutral conditions.
- Current trend in snapshot: "${snapshot.trend}" — generate conditions that are ACHIEVABLE in this regime.

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

PLAYBOOK RULES (if playbook provided):
- Use playbook as baseline template
- May adjust SL/TP by ±15% based on current volatility
- May add 1-2 filters if conditions warrant
- Respect proven R:R ratios from playbook history
- If playbook WR > 60%, trust its approach
- If playbook trades < 20, allow more experimentation

Return JSON:
{
  "mode": "trend|breakout|pullback|reversal|range",
  "conditions": ["<direction-appropriate codes based on snapshot trend>"],
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
        endpoint: 'llm-strategy-brain',
        symbol: snapshot.sym
      }
    );

    const content = response.choices[0]?.message?.content || '{}';
    const plan = this.parseStrategyResponse(content, snapshot.trend);

    this.enforceImmutableStyle(plan, tradeStyle);

    console.log(`[Strategy Brain] ✅ Strategy: ${plan.mode}`);
    console.log(`[Strategy Brain] Conditions: ${plan.conditions.join(', ')}`);
    console.log(`[Strategy Brain] Risk: ${plan.risk_pct}% | Confidence: ${plan.confidence}%`);
    console.log(`[Strategy Brain] Rationale: ${plan.rationale}`);

    return plan;
  }

  private readonly STYLE_ALLOWED_MODES: Record<string, string[]> = {
    scalper: ['trend', 'breakout', 'pullback'],
    scalp: ['trend', 'breakout', 'pullback'],
    micro: ['trend', 'pullback', 'range', 'breakout'],
    intraday: ['trend', 'reversal', 'pullback', 'breakout'],
  };

  private enforceImmutableStyle(plan: StrategyPlan, tradeStyle?: string): void {
    if (!tradeStyle) return;

    const normalized = tradeStyle.toLowerCase();
    const allowedModes = this.STYLE_ALLOWED_MODES[normalized];
    if (!allowedModes) return;

    if (!allowedModes.includes(plan.mode)) {
      console.warn(`[GOVERNANCE] Style enforcement: LLM returned "${plan.mode}" but ${normalized} only allows [${allowedModes.join(', ')}]. Overriding to "${allowedModes[0]}".`);
      plan.mode = allowedModes[0] as StrategyPlan['mode'];
    }
  }

  private buildImmutableStyleDirective(tradeStyle?: string): string {
    if (!tradeStyle) return '';

    const normalized = tradeStyle.toLowerCase();

    // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform (MICRO_INTRADAY).
    // All legacy style strings collapse to MICRO_INTRADAY constraints.
    void normalized;
    const config = {
      label: 'MICRO_INTRADAY',
      allowedModes: ['trend', 'pullback', 'range', 'breakout'],
      durationRange: '20 minutes - 4 hours',
      riskRange: '1-7%',
      conditions: 'Focus on M5 structure, EMA alignment, trend/pullback confirmation. TP1 = fast scalp partial; TP2 = full intraday target.',
    };

    console.log(`[Strategy Brain] IMMUTABLE STYLE: ${config.label} (user selection locked)`);

    return `

IMMUTABLE TRADE STYLE (NON-NEGOTIABLE):
Style: ${config.label}
Duration: ${config.durationRange}
Risk: ${config.riskRange}
Allowed modes: ${config.allowedModes.join(', ')}
${config.conditions}
YOU MUST choose "mode" from: ${config.allowedModes.map(m => `"${m}"`).join(' | ')}
YOU MUST NOT use any mode outside this list. This is the user's locked trade style.
YOU MUST generate conditions appropriate for ${config.label} duration and risk profile.`;
  }

  /**
   * Parse LLM response into strategy plan
   * SSOT FIX: Accept detected trend so fallback strategy is directionally appropriate.
   */
  private parseStrategyResponse(response: string, detectedTrend?: string): StrategyPlan {
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
        confidence: parsed.confidence ?? null,
        rationale: parsed.rationale || 'Default strategy',
        watch_indicators: parsed.watch_indicators || ['ema20', 'ema50', 'rsi']
      };
    } catch (error) {
      console.error('[Strategy Brain] Failed to parse response:', error);

      const fallback = this.buildDirectionalFallback(detectedTrend);
      console.warn(`[Strategy Brain] Using directional fallback for trend="${detectedTrend}": ${fallback.conditions.join(', ')}`);
      return fallback;
    }
  }

  /**
   * SSOT: Build a directionally-appropriate fallback strategy when LLM parsing fails.
   * Prevents hard-coded bull conditions from being applied to bear/sideways markets.
   */
  private buildDirectionalFallback(trend?: string): StrategyPlan {
    const t = (trend || 'side').toLowerCase();

    if (t === 'bullish' || t === 'bull') {
      return {
        mode: 'trend',
        conditions: ['p>e50', 'rsi>50', 'trend=bull'],
        entry_logic: 'when 2 of 3 conditions true',
        sl_calculation: 'atr*1.5',
        tp_calculation: 'atr*2.5',
        risk_pct: 3,
        riskLevel: 3,
        confidence: 65,
        rationale: 'Fallback bull trend-following strategy',
        watch_indicators: ['ema50', 'rsi', 'vwap']
      };
    }

    if (t === 'bearish' || t === 'bear') {
      return {
        mode: 'trend',
        conditions: ['p<e50', 'rsi<50', 'trend=bear'],
        entry_logic: 'when 2 of 3 conditions true',
        sl_calculation: 'atr*1.5',
        tp_calculation: 'atr*2.5',
        risk_pct: 3,
        riskLevel: 3,
        confidence: 65,
        rationale: 'Fallback bear trend-following strategy',
        watch_indicators: ['ema50', 'rsi', 'vwap']
      };
    }

    return {
      mode: 'range',
      conditions: ['near_vwap', 'rsi>40', 'vol_high'],
      entry_logic: 'when 2 of 3 conditions true',
      sl_calculation: 'atr*1.5',
      tp_calculation: 'atr*2.0',
      risk_pct: 2,
      riskLevel: 2,
      confidence: 60,
      rationale: 'Fallback sideways/range strategy',
      watch_indicators: ['vwap', 'rsi', 'atr']
    };
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
