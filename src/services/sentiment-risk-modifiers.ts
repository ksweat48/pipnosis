/**
 * Sentiment Risk Modifiers
 *
 * Applies Risk-ON/Risk-OFF logic to modify trade parameters based on
 * market sentiment analysis from Omega-7.
 *
 * Modifies:
 * - Position size (risk percentage)
 * - Stop loss distance
 * - Take profit distance
 * - Entry confirmation requirements
 */

import { AggregatedSentiment } from './sentiment-aggregator';

export interface TradePlan {
  action: 'BUY' | 'SELL' | 'NO_TRADE';
  symbol: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  risk_pct: number;
  conditionsMet: string[];
  conditionsRequired: number;
}

export interface ModifiedTradePlan extends TradePlan {
  original_risk_pct: number;
  original_sl: number;
  original_tp: number;
  sentiment_applied: boolean;
  modifications: string[];
}

class SentimentRiskModifiers {
  /**
   * Apply sentiment-based modifiers to trade plan
   */
  applyModifiers(plan: TradePlan, sentiment: AggregatedSentiment): ModifiedTradePlan {
    // Store original values
    const modified: ModifiedTradePlan = {
      ...plan,
      original_risk_pct: plan.risk_pct,
      original_sl: plan.stopLoss,
      original_tp: plan.takeProfit,
      sentiment_applied: true,
      modifications: []
    };

    // Skip if NO_TRADE
    if (plan.action === 'NO_TRADE') {
      modified.sentiment_applied = false;
      return modified;
    }

    // Apply Risk-OFF Protection
    if (this.isRiskOff(sentiment, plan)) {
      this.applyRiskOffProtection(modified, sentiment);
    }

    // Apply Risk-ON Acceleration
    else if (this.isRiskOn(sentiment)) {
      this.applyRiskOnAcceleration(modified, sentiment);
    }

    // Mixed sentiment - no modific modifications
    else {
      modified.modifications.push('Mixed sentiment - no adjustments');
    }

    console.log('[SentimentMods] Applied modifiers:', {
      sentiment: sentiment.sentiment,
      volatility: sentiment.volatility,
      usd_strength: sentiment.usd_strength,
      modifications: modified.modifications
    });

    return modified;
  }

  /**
   * Check if Risk-OFF conditions apply
   */
  private isRiskOff(sentiment: AggregatedSentiment, plan: TradePlan): boolean {
    // Risk-OFF if:
    // - Sentiment is risk_off
    // - High volatility
    // - Strong USD + XAU/USD sell (bad combo)
    // - Warnings present (fear_spike, event, rumor)

    if (sentiment.sentiment === 'risk_off') {
      return true;
    }

    if (sentiment.volatility === 'high') {
      return true;
    }

    if (sentiment.usd_strength === 'strong' && plan.symbol === 'XAUUSD' && plan.action === 'SELL') {
      return true;
    }

    if (sentiment.warnings.some(w => ['fear_spike', 'event', 'rumor'].includes(w))) {
      return true;
    }

    return false;
  }

  /**
   * Check if Risk-ON conditions apply
   */
  private isRiskOn(sentiment: AggregatedSentiment): boolean {
    return sentiment.sentiment === 'risk_on' && sentiment.volatility === 'low';
  }

  /**
   * Apply Risk-OFF protection (reduce risk, tighten SL, delay entries)
   */
  private applyRiskOffProtection(plan: ModifiedTradePlan, sentiment: AggregatedSentiment): void {
    // Reduce position size by 40%
    plan.risk_pct = plan.risk_pct * 0.6;
    plan.modifications.push('Risk-OFF: Position size reduced to 60%');

    // Tighten stop loss by 20%
    const slDistance = Math.abs(plan.entry - plan.stopLoss);
    const newSlDistance = slDistance * 0.8;

    if (plan.action === 'BUY') {
      plan.stopLoss = plan.entry - newSlDistance;
    } else {
      plan.stopLoss = plan.entry + newSlDistance;
    }
    plan.modifications.push('Risk-OFF: Stop loss tightened to 80%');

    // Require extra confirmation
    plan.conditionsRequired = plan.conditionsRequired + 1;
    plan.modifications.push('Risk-OFF: Extra confirmation required');

    // Add warnings to reasoning
    if (sentiment.warnings.length > 0) {
      plan.modifications.push(`Warnings: ${sentiment.warnings.join(', ')}`);
    }

    console.log('[SentimentMods] Risk-OFF protection applied:', {
      risk_reduction: '40%',
      sl_tightening: '20%',
      extra_confirmation: true,
      warnings: sentiment.warnings
    });
  }

  /**
   * Apply Risk-ON acceleration (increase risk, widen TP)
   */
  private applyRiskOnAcceleration(plan: ModifiedTradePlan, sentiment: AggregatedSentiment): void {
    // Increase position size by 20% (cap at 5%)
    plan.risk_pct = Math.min(plan.risk_pct * 1.2, 5.0);
    plan.modifications.push('Risk-ON: Position size increased to 120% (max 5%)');

    // Widen take profit by 15%
    const tpDistance = Math.abs(plan.takeProfit - plan.entry);
    const newTpDistance = tpDistance * 1.15;

    if (plan.action === 'BUY') {
      plan.takeProfit = plan.entry + newTpDistance;
    } else {
      plan.takeProfit = plan.entry - newTpDistance;
    }
    plan.modifications.push('Risk-ON: Take profit widened to 115%');

    console.log('[SentimentMods] Risk-ON acceleration applied:', {
      risk_increase: '20%',
      tp_widening: '15%'
    });
  }

  /**
   * Get modifier summary for logging
   */
  getModifierSummary(modified: ModifiedTradePlan): string {
    if (!modified.sentiment_applied) {
      return 'No sentiment modifiers applied';
    }

    return `Sentiment modifiers: ${modified.modifications.join(' | ')}`;
  }

  /**
   * Check if trade should be blocked due to extreme sentiment
   */
  shouldBlockTrade(sentiment: AggregatedSentiment, plan: TradePlan): { block: boolean; reason: string } {
    // Block if confidence is too low
    if (sentiment.confidence < 20) {
      return {
        block: true,
        reason: 'Sentiment confidence too low (<20%)'
      };
    }

    // Block if major warnings and already in risk-off
    if (sentiment.sentiment === 'risk_off' &&
        sentiment.volatility === 'high' &&
        sentiment.warnings.length >= 2) {
      return {
        block: true,
        reason: 'Extreme risk-off conditions + multiple warnings'
      };
    }

    return { block: false, reason: '' };
  }
}

export const sentimentRiskModifiers = new SentimentRiskModifiers();
