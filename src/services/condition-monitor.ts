/**
 * Condition Monitor - Watches LLM-Defined Triggers
 *
 * Evaluates whether strategy conditions are met.
 * NO LLM CALLS - pure logic evaluation for cost efficiency.
 */

import type { StrategyPlan } from './llm-strategy-brain';

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
}

export interface ConditionCheckResult {
  ready: boolean;
  conditionsMet: string[];
  conditionsFailed: string[];
  trigger: string;
  confidence: number;
}

class ConditionMonitor {
  /**
   * Check if strategy conditions are met
   */
  checkConditions(
    strategyPlan: StrategyPlan,
    marketState: MarketState
  ): ConditionCheckResult {
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

    return {
      ready,
      conditionsMet,
      conditionsFailed,
      trigger: ready ? `${strategyPlan.mode}_setup` : 'waiting',
      confidence: ready ? strategyPlan.confidence : 0
    };
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(condition: string, state: MarketState): boolean {
    const c = condition.toLowerCase().trim();

    // Price vs EMAs
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

    // Default: unknown condition = false
    console.warn(`[Condition Monitor] Unknown condition: ${condition}`);
    return false;
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
}

export const conditionMonitor = new ConditionMonitor();
