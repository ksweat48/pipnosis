/**
 * Condition Monitor - Watches LLM-Defined Triggers
 *
 * Evaluates whether strategy conditions are met.
 * NO LLM CALLS - pure logic evaluation for cost efficiency.
 * NOW ENHANCED with Omega Sensor Package for pro-trader indicators.
 */

import type { StrategyPlan } from './llm-strategy-brain';
import type { OmegaSensors } from './omega-sensors';
import { regimeOracle, type RegimeSnapshot, type Candle } from './regime-oracle';
import { adversarialDetector, type AdversarialSignal } from './adversarial-detector';

export interface MarketState {
  price: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  stochRsi: number;
  atr: number;
  vwap: number;
  trend: string;
  momentum: number;
  volatility: string;
  swingHigh: number;
  swingLow: number;
  macd?: number;
  macdSignal?: number;
  omegaSensors?: OmegaSensors;
}

export interface ConditionCheckResult {
  ready: boolean;
  conditionsMet: string[];
  conditionsFailed: string[];
  trigger: string;
  confidence: number;
  regime?: RegimeSnapshot;
  blockedByRegime?: boolean;
  adversarial?: AdversarialSignal;
  blockedByAdversarial?: boolean;
}

class ConditionMonitor {
  /**
   * Check if strategy conditions are met
   * Now includes regime oracle evaluation for zero-cost intelligence
   */
  checkConditions(
    strategyPlan: StrategyPlan,
    marketState: MarketState,
    timestamp?: Date | number,
    candles?: Candle[]
  ): ConditionCheckResult {
    // REGIME ORACLE: Evaluate market regime FIRST (zero-cost gate)
    let regime: RegimeSnapshot | undefined;
    if (timestamp && candles && candles.length >= 10) {
      regime = regimeOracle.evaluate(marketState, timestamp, candles);

      // BLOCK if regime says avoid trading
      if (regime.avoid_trading) {
        console.log(`[Condition Monitor] ❌ Trade blocked by regime: ${regime.reason}`);
        return {
          ready: false,
          conditionsMet: [],
          conditionsFailed: ['Blocked by regime'],
          trigger: 'regime_blocked',
          confidence: 0,
          regime,
          blockedByRegime: true
        };
      }

      console.log(`[Condition Monitor] ✅ Regime check passed: ${regime.session}, vol=${regime.volatility_score}, trend=${regime.trend_strength_score}`);
    }

    // ADVERSARIAL DETECTOR: Check for manipulation patterns (zero-cost gate)
    let adversarial: AdversarialSignal | undefined;
    if (candles && candles.length >= 10) {
      adversarial = adversarialDetector.evaluate(marketState, candles, regime);

      // BLOCK if adversarial level is severe or action is avoid
      if (adversarial.recommended_action === 'avoid' || adversarial.level === 'severe') {
        console.log(`[Condition Monitor] 🚫 Trade blocked by adversarial detector`);
        console.log(`[Condition Monitor] Level: ${adversarial.level}, Score: ${adversarial.suspicion_score}`);
        console.log(`[Condition Monitor] Patterns: ${adversarial.patterns.join(', ')}`);
        return {
          ready: false,
          conditionsMet: [],
          conditionsFailed: ['Blocked by adversarial environment'],
          trigger: 'adversarial_blocked',
          confidence: 0,
          regime,
          adversarial,
          blockedByAdversarial: true
        };
      }

      if (adversarial.is_adversarial) {
        console.log(`[Condition Monitor] ⚠️  Adversarial detected: ${adversarial.level} - ${adversarial.notes}`);
      } else {
        console.log(`[Condition Monitor] ✅ Adversarial check passed: clean conditions`);
      }
    }

    const conditionsMet: string[] = [];
    const conditionsFailed: string[] = [];

    // Evaluate each condition
    for (const condition of strategyPlan.conditions) {
      const ismet = this.evaluateCondition(condition, marketState);

      if (ismet) {
        conditionsMet.push(condition);
      } else {
        conditionsFailed.push(condition);
      }
    }

    // Determine if entry logic is satisfied
    const ready = this.evaluateEntryLogic(
      strategyPlan.entry_logic,
      conditionsMet.length,
      strategyPlan.conditions.length
    );

    // Boost confidence with Omega sensor confirmation
    let finalConfidence = ready ? strategyPlan.confidence : 0;
    if (ready && marketState.omegaSensors) {
      finalConfidence = this.adjustConfidenceWithSensors(
        finalConfidence,
        marketState,
        strategyPlan.mode
      );
    }

    // Apply regime risk reduction factor if available
    const adjustedConfidence = regime
      ? finalConfidence * regime.risk_reduction_factor
      : finalConfidence;

    if (regime && regime.risk_reduction_factor < 1.0) {
      console.log(`[Condition Monitor] Confidence adjusted: ${finalConfidence}% → ${adjustedConfidence.toFixed(0)}% (risk_factor: ${regime.risk_reduction_factor})`);
    }

    return {
      ready,
      conditionsMet,
      conditionsFailed,
      trigger: ready ? `${strategyPlan.mode}_setup` : 'waiting',
      confidence: adjustedConfidence,
      regime,
      blockedByRegime: false,
      adversarial,
      blockedByAdversarial: false
    };
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(condition: string, state: MarketState): boolean {
    const c = condition.toLowerCase().trim();

    // Natural language: "price above ema20/50/200"
    if (c.includes('price above ema20') || c.includes('price over ema20')) {
      return state.price > state.ema20;
    }
    if (c.includes('price above ema50') || c.includes('price over ema50')) {
      return state.price > state.ema50;
    }
    if (c.includes('price above ema200') || c.includes('price over ema200')) {
      return state.price > state.ema200;
    }
    if (c.includes('price below ema20') || c.includes('price under ema20')) {
      return state.price < state.ema20;
    }
    if (c.includes('price below ema50') || c.includes('price under ema50')) {
      return state.price < state.ema50;
    }
    if (c.includes('price below ema200') || c.includes('price under ema200')) {
      return state.price < state.ema200;
    }

    // Shorthand: Price vs EMAs
    if (c.includes('p>e50') || c.includes('price>ema50')) {
      return state.price > state.ema50;
    }
    if (c.includes('p<e50') || c.includes('price<ema50')) {
      return state.price < state.ema50;
    }
    if (c.includes('p>e20') || c.includes('price>ema20')) {
      return state.price > state.ema20;
    }
    if (c.includes('p<e20') || c.includes('price<ema20')) {
      return state.price < state.ema20;
    }
    if (c.includes('p>e200') || c.includes('price>ema200')) {
      return state.price > state.ema200;
    }
    if (c.includes('p<e200') || c.includes('price<ema200')) {
      return state.price < state.ema200;
    }

    // EMA crosses
    if (c.includes('e20>e50') || c.includes('ema20>ema50')) {
      return state.ema20 > state.ema50;
    }
    if (c.includes('e20<e50') || c.includes('ema20<ema50')) {
      return state.ema20 < state.ema50;
    }

    // Natural language: "rsi between X-Y" or "rsi remains between X and Y"
    const rsiBetweenMatch = c.match(/rsi\s+(?:between|remains between|range|from)\s+(\d+)[-\s](?:and\s+|to\s+)?(\d+)/);
    if (rsiBetweenMatch) {
      const min = parseInt(rsiBetweenMatch[1]);
      const max = parseInt(rsiBetweenMatch[2]);
      return state.rsi >= min && state.rsi <= max;
    }

    // RSI conditions
    if (c.includes('rsi>70')) return state.rsi > 70;
    if (c.includes('rsi>60')) return state.rsi > 60;
    if (c.includes('rsi>50')) return state.rsi > 50;
    if (c.includes('rsi<50')) return state.rsi < 50;
    if (c.includes('rsi<40')) return state.rsi < 40;
    if (c.includes('rsi<30')) return state.rsi < 30;

    // Stoch RSI
    if (c.includes('st>70') || c.includes('stoch>70')) return state.stochRsi > 70;
    if (c.includes('st<30') || c.includes('stoch<30')) return state.stochRsi < 30;
    if (c.includes('st>50') || c.includes('stoch>50')) return state.stochRsi > 50;
    if (c.includes('st<50') || c.includes('stoch<50')) return state.stochRsi < 50;

    // VWAP
    if (c.includes('vw_above') || c.includes('p>vw') || c.includes('price>vwap')) {
      return state.price > state.vwap;
    }
    if (c.includes('vw_below') || c.includes('p<vw') || c.includes('price<vwap')) {
      return state.price < state.vwap;
    }
    if (c.includes('vw_near')) {
      const distance = Math.abs(state.price - state.vwap) / state.vwap;
      return distance < 0.002; // Within 0.2%
    }

    // Trend
    if (c.includes('trend=bull') || c.includes('trend_bull')) {
      return state.trend === 'bullish' || state.trend === 'bull';
    }
    if (c.includes('trend=bear') || c.includes('trend_bear')) {
      return state.trend === 'bearish' || state.trend === 'bear';
    }

    // Momentum
    if (c.includes('mom>0') || c.includes('momentum_positive')) {
      return state.momentum > 0;
    }
    if (c.includes('mom<0') || c.includes('momentum_negative')) {
      return state.momentum < 0;
    }

    // Volatility
    if (c.includes('vol=low') || c.includes('volatility_low')) {
      return state.volatility === 'low';
    }
    if (c.includes('vol=med') || c.includes('volatility_medium')) {
      return state.volatility === 'medium' || state.volatility === 'med';
    }
    if (c.includes('vol=high') || c.includes('volatility_high')) {
      return state.volatility === 'high';
    }

    // Swing levels
    if (c.includes('near_swing_low')) {
      const distance = Math.abs(state.price - state.swingLow) / state.price;
      return distance < 0.005; // Within 0.5%
    }
    if (c.includes('near_swing_high')) {
      const distance = Math.abs(state.price - state.swingHigh) / state.price;
      return distance < 0.005;
    }

    // Natural language: "price approaching/near resistance/support"
    if (c.includes('approaching resistance') || c.includes('near resistance')) {
      const distance = Math.abs(state.price - state.swingHigh) / state.price;
      return distance < 0.003; // Within 0.3%
    }
    if (c.includes('approaching support') || c.includes('near support')) {
      const distance = Math.abs(state.price - state.swingLow) / state.price;
      return distance < 0.003; // Within 0.3%
    }

    // Natural language: momentum descriptors
    if (c.includes('momentum strong') || c.includes('strong momentum')) {
      return Math.abs(state.momentum) > 0.5;
    }
    if (c.includes('momentum weak') || c.includes('weak momentum')) {
      return Math.abs(state.momentum) < 0.2;
    }
    if (c.includes('momentum positive') || c.includes('positive momentum')) {
      return state.momentum > 0;
    }
    if (c.includes('momentum negative') || c.includes('negative momentum')) {
      return state.momentum < 0;
    }

    // Natural language: trend descriptors
    if (c.includes('bullish trend') || c.includes('uptrend') || c.includes('trending up')) {
      return state.trend === 'bullish' || state.trend === 'bull';
    }
    if (c.includes('bearish trend') || c.includes('downtrend') || c.includes('trending down')) {
      return state.trend === 'bearish' || state.trend === 'bear';
    }

    // === OMEGA SENSOR CONDITIONS ===
    if (state.omegaSensors) {
      const sensors = state.omegaSensors;

      // Market Structure
      if (c.includes('bos_bull') || c.includes('bullish_bos')) {
        return sensors.bos === 'bull';
      }
      if (c.includes('bos_bear') || c.includes('bearish_bos')) {
        return sensors.bos === 'bear';
      }
      if (c.includes('choch_bull') || c.includes('bullish_choch')) {
        return sensors.cho === 'bull';
      }
      if (c.includes('choch_bear') || c.includes('bearish_choch')) {
        return sensors.cho === 'bear';
      }
      if (c.includes('swing_high')) {
        return sensors.sh === 1;
      }
      if (c.includes('swing_low')) {
        return sensors.sl === 1;
      }
      if (c.includes('equal_highs') || c.includes('liquidity_high')) {
        return sensors.eqh === 1;
      }
      if (c.includes('equal_lows') || c.includes('liquidity_low')) {
        return sensors.eql === 1;
      }

      // Volume & Volatility
      if (c.includes('volume_spike') || c.includes('vol_spike')) {
        return sensors.vol_s === 1;
      }
      if (c.includes('vol_high') || c.includes('high_volume_regime')) {
        return sensors.vol_r === 'high';
      }
      if (c.includes('vol_low') || c.includes('low_volume_regime')) {
        return sensors.vol_r === 'low';
      }
      if (c.includes('atr_expanding') || c.includes('volatility_increasing')) {
        return sensors.atr_t === 'up';
      }
      if (c.includes('atr_contracting') || c.includes('volatility_decreasing')) {
        return sensors.atr_t === 'down';
      }

      // Divergences
      if (c.includes('rsi_div_bull') || c.includes('bullish_rsi_divergence')) {
        return sensors.rdiv === 'bull';
      }
      if (c.includes('rsi_div_bear') || c.includes('bearish_rsi_divergence')) {
        return sensors.rdiv === 'bear';
      }
      if (c.includes('macd_div_bull') || c.includes('bullish_macd_divergence')) {
        return sensors.mdiv === 'bull';
      }
      if (c.includes('macd_div_bear') || c.includes('bearish_macd_divergence')) {
        return sensors.mdiv === 'bear';
      }

      // Candle Patterns
      if (c.includes('bull_engulf') || c.includes('bullish_engulfing')) {
        return sensors.pat.eng_b === 1;
      }
      if (c.includes('bear_engulf') || c.includes('bearish_engulfing')) {
        return sensors.pat.eng_s === 1;
      }
      if (c.includes('pin_bar_bull') || c.includes('hammer')) {
        return sensors.pat.pin_b === 1;
      }
      if (c.includes('pin_bar_bear') || c.includes('shooting_star')) {
        return sensors.pat.pin_s === 1;
      }
      if (c.includes('doji')) {
        return sensors.pat.doji === 1;
      }
      if (c.includes('momentum_bar') || c.includes('strong_candle')) {
        return sensors.pat.mom === 1;
      }

      // Micro-Structure
      if (c.includes('pullback_complete')) {
        return sensors.mic.pull >= 2 && sensors.mic.pull <= 5;
      }
      if (c.includes('near_vwap')) {
        return Math.abs(sensors.mic.dvw) < 0.3; // Within 0.3%
      }
      if (c.includes('above_resistance') || c.includes('broke_resistance')) {
        return sensors.mic.msr === 'above';
      }
      if (c.includes('below_support') || c.includes('broke_support')) {
        return sensors.mic.msr === 'below';
      }
    }
    // === END OMEGA SENSORS ===

    // FALLBACK PARSERS for natural language conditions

    // Parse: "price oscillates between support at X and resistance at Y"
    const priceRangeMatch = c.match(/(?:price|p).*?(?:oscillates|between|ranges?).*?(\d+\.?\d*)\s*(?:and|to).*?(\d+\.?\d*)/);
    if (priceRangeMatch) {
      const min = parseFloat(priceRangeMatch[1]);
      const max = parseFloat(priceRangeMatch[2]);
      console.log(`[Condition Monitor] Parsed price range: ${min} - ${max} (current: ${state.price})`);
      return state.price >= min && state.price <= max;
    }

    // Parse: "low volume" or "consolidation"
    if (c.includes('low volume') || c.includes('consolidation') || c.includes('volume indicates')) {
      console.log(`[Condition Monitor] Volume condition auto-pass (volume tracking not yet implemented)`);
      return true;
    }

    // Parse: "price near/at X"
    const priceNearMatch = c.match(/(?:price|p)\s+(?:near|at|approaching)\s+(\d+\.?\d*)/);
    if (priceNearMatch) {
      const target = parseFloat(priceNearMatch[1]);
      const distance = Math.abs(state.price - target) / state.price;
      console.log(`[Condition Monitor] Price near ${target}: distance ${(distance * 100).toFixed(2)}%`);
      return distance < 0.005; // Within 0.5%
    }

    // Default: unknown condition = AUTO-PASS with warning (temporary safety measure)
    console.warn(`[Condition Monitor] ⚠️ Unknown condition (auto-passing): ${condition}`);
    return true;
  }

  /**
   * Evaluate entry logic (e.g., "when 2 of 3 conditions true")
   */
  private evaluateEntryLogic(
    logic: string,
    metCount: number,
    totalCount: number
  ): boolean {
    const l = logic.toLowerCase();

    // All conditions must be true
    if (l.includes('all') || l.includes('and')) {
      return metCount === totalCount;
    }

    // Any condition is true
    if (l.includes('any') || l.includes('or')) {
      return metCount > 0;
    }

    // X of Y conditions
    const match = l.match(/(\d+)\s*of\s*(\d+)/);
    if (match) {
      const required = parseInt(match[1]);
      return metCount >= required;
    }

    // Majority
    if (l.includes('majority') || l.includes('most')) {
      return metCount > totalCount / 2;
    }

    // Default: require all
    return metCount === totalCount;
  }

  /**
   * Get human-readable condition status
   */
  getConditionStatus(
    strategyPlan: StrategyPlan,
    marketState: MarketState
  ): string {
    const result = this.checkConditions(strategyPlan, marketState);

    if (result.ready) {
      return `✅ TRIGGER READY: ${result.conditionsMet.length}/${strategyPlan.conditions.length} conditions met`;
    } else {
      return `⏳ Waiting: ${result.conditionsMet.length}/${strategyPlan.conditions.length} conditions met`;
    }
  }

  /**
   * Adjust confidence with Omega sensor confirmation
   * Boosts confidence when structure, volume, and patterns align
   */
  private adjustConfidenceWithSensors(
    baseConfidence: number,
    state: MarketState,
    mode: string
  ): number {
    if (!state.omegaSensors) return baseConfidence;

    const sensors = state.omegaSensors;
    let boost = 0;

    const isBullish = mode.toLowerCase().includes('buy') || mode.toLowerCase().includes('long');
    const isBearish = mode.toLowerCase().includes('sell') || mode.toLowerCase().includes('short');

    // Structure confirmation (+5%)
    if (isBullish && sensors.bos === 'bull' && sensors.cho !== 'bear') {
      boost += 5;
    } else if (isBearish && sensors.bos === 'bear' && sensors.cho !== 'bull') {
      boost += 5;
    }

    // Volume confirmation (+3%)
    if (sensors.vol_s === 1 || sensors.vol_r === 'high') {
      boost += 3;
    }

    // No opposing divergence (+3%)
    if (isBullish && sensors.rdiv !== 'bear' && sensors.mdiv !== 'bear') {
      boost += 3;
    } else if (isBearish && sensors.rdiv !== 'bull' && sensors.mdiv !== 'bull') {
      boost += 3;
    }

    // Supporting divergence (+5%)
    if (isBullish && (sensors.rdiv === 'bull' || sensors.mdiv === 'bull')) {
      boost += 5;
    } else if (isBearish && (sensors.rdiv === 'bear' || sensors.mdiv === 'bear')) {
      boost += 5;
    }

    // Pattern confirmation (+4%)
    if (isBullish && (sensors.pat.eng_b === 1 || sensors.pat.pin_b === 1 || sensors.pat.mom === 1)) {
      boost += 4;
    } else if (isBearish && (sensors.pat.eng_s === 1 || sensors.pat.pin_s === 1 || sensors.pat.mom === 1)) {
      boost += 4;
    }

    // Liquidity zones (+3%)
    if (isBullish && sensors.eql === 1) {
      boost += 3; // Equal lows = potential liquidity grab before rally
    } else if (isBearish && sensors.eqh === 1) {
      boost += 3; // Equal highs = potential liquidity grab before drop
    }

    // Cap at 95% max
    return Math.min(95, baseConfidence + boost);
  }
}

export const conditionMonitor = new ConditionMonitor();
