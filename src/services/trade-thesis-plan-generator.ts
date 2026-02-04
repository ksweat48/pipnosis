/**
 * TRADE THESIS PLAN GENERATOR - Single Source of Truth (SSOT)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTHORITY: This is the SOLE authority for creating thesis plans for trades.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RESPONSIBILITIES:
 * 1. Extract detailed thesis conditions from Alpha's analysis
 * 2. Structure invalidation logic (when thesis breaks)
 * 3. Define confirmation conditions (what validates thesis)
 * 4. Identify key price levels and their meaning
 * 5. Store expected trade behavior timeline
 * 6. Create immutable thesis snapshot at trade entry
 *
 * DOES NOT:
 * - Evaluate thesis during trade life (ThesisMonitoringAuthority does this)
 * - Store or modify thesis after creation (immutable)
 * - Log monitoring events (monitoring authority does this)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CCIP COMPLIANCE:
 * ═══════════════════════════════════════════════════════════════════════════
 * - Single creation point for all thesis plans
 * - Called exactly once per trade
 * - Validates thesis data before storage
 * - Returns thesis_plan_id for all downstream references
 * - SSOT: No thesis logic duplicated elsewhere
 */

import { supabase } from '@/lib/supabase';
import type { AlphaDecisionContract } from '@/types/alpha-decision-contract';
import type { MarketSnapshot } from '@/types/index';

/**
 * Invalidation condition - triggers thesis break
 */
export interface InvalidationCondition {
  condition: 'price_breaks_below' | 'price_breaks_above' | 'closes_outside_range' | 'time_exceeded' | 'momentum_reversal';
  level?: number;
  level_min?: number;
  level_max?: number;
  duration_minutes?: number;
  reason: string;
  severity: 'soft' | 'hard' | 'critical';
}

/**
 * Confirmation condition - validates thesis remains sound
 */
export interface ConfirmationCondition {
  condition: 'holds_above_level' | 'holds_below_level' | 'momentum_direction' | 'price_in_range' | 'time_decay_acceptable';
  level?: number;
  level_min?: number;
  level_max?: number;
  direction?: 'up' | 'down';
  duration_minutes?: number;
  via_indicator?: string;
}

/**
 * Key price level to watch
 */
export interface KeyLevel {
  price: number;
  type: 'support' | 'resistance' | 'entry' | 'sl' | 'tp1' | 'tp2' | 'continuation_level' | 'breakout_trigger';
  significance: 'primary' | 'secondary' | 'tertiary';
  description: string;
  action_if_broken?: string;
}

/**
 * Complete thesis plan for a trade
 */
export interface TradeThersisPlan {
  thesis_narrative: string;
  regime_snapshot: Record<string, any>;
  setup_type: 'momentum' | 'reversal' | 'structure_break' | 'continuation' | 'breakout' | 'pullback';
  invalidation_conditions: InvalidationCondition[];
  confirmation_conditions: ConfirmationCondition[];
  key_levels: KeyLevel[];
  expected_duration_minutes: number;
  expected_direction: 'up' | 'down' | 'range-bound';
  expected_volatility: 'low' | 'medium' | 'high';
  alpha_confidence_at_entry: number;
  confidence_band_upper: number;
  confidence_band_lower: number;
  thesis_risk_reward: number;
  thesis_expected_holding_time_minutes: number;
}

/**
 * Result of thesis plan creation
 */
export interface ThesisPlanCreateResult {
  success: boolean;
  thesis_plan_id?: string;
  error?: string;
}

class TradeThesisPlanGenerator {
  /**
   * Generate and store thesis plan for a trade
   *
   * AUTHORITY: This is the ONLY way to create thesis plans
   * Called exactly once per trade, right after entry execution
   *
   * @param userId - User who owns the trade
   * @param goalSessionId - Goal session context
   * @param tradeId - Trade this thesis applies to
   * @param alphaDecision - Alpha's decision with reasoning
   * @param symbol - Trading symbol
   * @param direction - Entry direction
   * @param marketSnapshot - Current market conditions at entry
   * @returns Result with thesis_plan_id or error
   */
  async generateAndStoreThersisPlan(
    userId: string,
    goalSessionId: string,
    tradeId: string,
    alphaDecision: AlphaDecisionContract,
    symbol: string,
    direction: 'buy' | 'sell',
    marketSnapshot: MarketSnapshot
  ): Promise<ThesisPlanCreateResult> {
    try {
      // Extract thesis narrative from Alpha's decision reasoning
      const thesisNarrative = this.extractThesisNarrative(alphaDecision);

      // Build invalidation conditions from Alpha's risk analysis
      const invalidationConditions = this.buildInvalidationConditions(alphaDecision, direction);

      // Build confirmation conditions to track thesis health
      const confirmationConditions = this.buildConfirmationConditions(alphaDecision, direction);

      // Extract key levels from analysis
      const keyLevels = this.extractKeyLevels(alphaDecision, marketSnapshot, direction);

      // Build complete thesis plan
      const confidenceScore = Math.max(0, Math.min(1, (alphaDecision.confidence || 50) / 100)); // Convert 0-100 to 0-1
      const thesisPlan: TradeThersisPlan = {
        thesis_narrative: thesisNarrative,
        regime_snapshot: this.captureRegimeSnapshot(marketSnapshot),
        setup_type: this.classifySetupType(alphaDecision),
        invalidation_conditions: invalidationConditions,
        confirmation_conditions: confirmationConditions,
        key_levels: keyLevels,
        expected_duration_minutes: this.estimateExpectedDuration(alphaDecision),
        expected_direction: direction === 'buy' ? 'up' : 'down',
        expected_volatility: this.estimateVolatility(marketSnapshot),
        alpha_confidence_at_entry: confidenceScore,
        confidence_band_upper: Math.min(1, confidenceScore + 0.15),
        confidence_band_lower: Math.max(0, confidenceScore - 0.15),
        thesis_risk_reward: this.calculateThesisRiskReward(alphaDecision),
        thesis_expected_holding_time_minutes: this.estimateExpectedDuration(alphaDecision),
      };

      // Call database function to create thesis plan (SSOT creation)
      const { data: result, error } = await supabase
        .rpc('create_trade_thesis_plan', {
          p_user_id: userId,
          p_goal_session_id: goalSessionId,
          p_trade_id: tradeId,
          p_symbol: symbol,
          p_direction: direction,
          p_thesis_narrative: thesisPlan.thesis_narrative,
          p_regime_snapshot: thesisPlan.regime_snapshot,
          p_setup_type: thesisPlan.setup_type,
          p_invalidation_conditions: invalidationConditions,
          p_confirmation_conditions: confirmationConditions,
          p_key_levels: keyLevels,
          p_expected_duration_minutes: thesisPlan.expected_duration_minutes,
          p_expected_direction: thesisPlan.expected_direction,
          p_expected_volatility: thesisPlan.expected_volatility,
          p_alpha_confidence_at_entry: thesisPlan.alpha_confidence_at_entry,
          p_confidence_band_upper: thesisPlan.confidence_band_upper,
          p_confidence_band_lower: thesisPlan.confidence_band_lower,
          p_thesis_risk_reward: thesisPlan.thesis_risk_reward,
          p_thesis_expected_holding_time_minutes: thesisPlan.thesis_expected_holding_time_minutes,
        });

      if (error || !result?.success) {
        return {
          success: false,
          error: error?.message || result?.error || 'Failed to create thesis plan',
        };
      }

      console.log(`[TradeThesisPlanGenerator] Thesis plan created: ${result.thesis_plan_id} for trade ${tradeId}`);

      return {
        success: true,
        thesis_plan_id: result.thesis_plan_id,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error creating thesis plan',
      };
    }
  }

  /**
   * Extract narrative thesis from Alpha's decision
   * Combines reasoning and market context
   */
  private extractThesisNarrative(alphaDecision: AlphaDecisionContract): string {
    const parts: string[] = [];

    if (alphaDecision.reasoning) {
      parts.push(alphaDecision.reasoning);
    }

    if (alphaDecision.marketContext?.regime) {
      parts.push(`Market regime: ${alphaDecision.marketContext.regime}`);
    }

    if (alphaDecision.marketAssessment?.reasoning) {
      parts.push(`Expected: ${alphaDecision.marketAssessment.reasoning}`);
    }

    return parts.join(' | ') || 'Trade entry based on technical analysis';
  }

  /**
   * Build invalidation conditions that break the thesis
   */
  private buildInvalidationConditions(alphaDecision: AlphaDecisionContract, direction: 'buy' | 'sell'): InvalidationCondition[] {
    const conditions: InvalidationCondition[] = [];

    // Stop loss is CRITICAL invalidation
    if (alphaDecision.tradeSpec.stopLoss) {
      conditions.push({
        condition: direction === 'buy' ? 'price_breaks_below' : 'price_breaks_above',
        level: alphaDecision.tradeSpec.stopLoss,
        reason: 'Stop loss exceeded - risk management threshold',
        severity: 'critical',
      });
    }

    // Add invalidation if price reverts significantly from entry
    conditions.push({
      condition: direction === 'buy' ? 'price_breaks_below' : 'price_breaks_above',
      level: alphaDecision.tradeSpec.entry * (direction === 'buy' ? 0.998 : 1.002),
      reason: 'Entry zone invalidated - entry premise broken',
      severity: 'soft',
    });

    return conditions;
  }

  /**
   * Build confirmation conditions that validate thesis
   */
  private buildConfirmationConditions(alphaDecision: AlphaDecisionContract, direction: 'buy' | 'sell'): ConfirmationCondition[] {
    const conditions: ConfirmationCondition[] = [];

    // Price must stay above/below entry region for confirmation
    if (alphaDecision.tradeSpec.entry) {
      const entryBuffer = alphaDecision.tradeSpec.entry * 0.002; // 0.2% buffer
      conditions.push({
        condition: direction === 'buy' ? 'holds_above_level' : 'holds_below_level',
        level: direction === 'buy' ? alphaDecision.tradeSpec.entry - entryBuffer : alphaDecision.tradeSpec.entry + entryBuffer,
        duration_minutes: 5,
        reason: 'Entry region holding intact',
      });
    }

    // Momentum direction confirmation from market context
    if (alphaDecision.marketContext?.volatility) {
      conditions.push({
        condition: 'momentum_direction',
        direction: direction === 'buy' ? 'up' : 'down',
        via_indicator: 'market_volatility_context',
        reason: 'Expected volatility present',
      });
    }

    return conditions;
  }

  /**
   * Extract key price levels to watch
   */
  private extractKeyLevels(alphaDecision: AlphaDecisionContract, marketSnapshot: MarketSnapshot, direction: 'buy' | 'sell'): KeyLevel[] {
    const levels: KeyLevel[] = [];
    const spec = alphaDecision.tradeSpec;

    // Entry level
    if (spec.entry) {
      levels.push({
        price: spec.entry,
        type: 'entry',
        significance: 'primary',
        description: 'Entry price point',
      });
    }

    // Stop loss
    if (spec.stopLoss) {
      levels.push({
        price: spec.stopLoss,
        type: 'sl',
        significance: 'primary',
        description: 'Risk management stop loss',
        action_if_broken: 'Close position - thesis invalidated',
      });
    }

    // Take profit targets
    if (spec.takeProfit) {
      levels.push({
        price: spec.takeProfit,
        type: 'tp1',
        significance: 'primary',
        description: 'Primary take profit target',
        action_if_broken: 'Close or reduce position',
      });
    }

    if (spec.takeProfit2) {
      levels.push({
        price: spec.takeProfit2,
        type: 'tp2',
        significance: 'secondary',
        description: 'Secondary take profit target',
        action_if_broken: 'Final position exit',
      });
    }

    // Support/Resistance from market snapshot
    if (marketSnapshot.technicalLevels) {
      if (marketSnapshot.technicalLevels.support) {
        levels.push({
          price: marketSnapshot.technicalLevels.support,
          type: 'support',
          significance: 'secondary',
          description: 'Technical support level',
        });
      }
      if (marketSnapshot.technicalLevels.resistance) {
        levels.push({
          price: marketSnapshot.technicalLevels.resistance,
          type: 'resistance',
          significance: 'secondary',
          description: 'Technical resistance level',
        });
      }
    }

    return levels;
  }

  /**
   * Capture regime snapshot at trade entry
   */
  private captureRegimeSnapshot(marketSnapshot: MarketSnapshot): Record<string, any> {
    return {
      timestamp: new Date().toISOString(),
      marketConditions: marketSnapshot.marketConditions,
      volatility: marketSnapshot.volatility,
      trend: marketSnapshot.trend,
      supportResistance: marketSnapshot.technicalLevels,
      vwapDeviation: marketSnapshot.vwapDeviation,
      orderflowMetrics: marketSnapshot.orderflowMetrics,
    };
  }

  /**
   * Classify setup type based on Alpha's decision
   */
  private classifySetupType(alphaDecision: AlphaDecisionContract): 'momentum' | 'reversal' | 'structure_break' | 'continuation' | 'breakout' | 'pullback' {
    const keywords = (alphaDecision.reasoning || '').toLowerCase();

    if (keywords.includes('reversal') || keywords.includes('bounce')) return 'reversal';
    if (keywords.includes('breakout') || keywords.includes('break above') || keywords.includes('break below')) return 'breakout';
    if (keywords.includes('momentum') || keywords.includes('trending')) return 'momentum';
    if (keywords.includes('structure') || keywords.includes('structure break')) return 'structure_break';
    if (keywords.includes('pullback') || keywords.includes('pull back')) return 'pullback';
    if (keywords.includes('continuation') || keywords.includes('continue')) return 'continuation';

    return 'momentum'; // Default
  }

  /**
   * Estimate expected holding time based on trade style
   */
  private estimateExpectedDuration(alphaDecision: AlphaDecisionContract): number {
    const style = alphaDecision.tradeSpec.style || 'INTRADAY';

    switch (style) {
      case 'SCALP':
        return 15; // 15 minutes
      case 'MICRO_INTRADAY':
        return 60; // 1 hour
      case 'INTRADAY':
      default:
        return 120; // 2 hours
    }
  }

  /**
   * Estimate volatility from market conditions
   */
  private estimateVolatility(marketSnapshot: MarketSnapshot): 'low' | 'medium' | 'high' {
    const volatility = marketSnapshot.volatility || 0;

    if (volatility < 0.01) return 'low';
    if (volatility < 0.03) return 'medium';
    return 'high';
  }

  /**
   * Calculate risk/reward ratio from trade spec
   */
  private calculateThesisRiskReward(alphaDecision: AlphaDecisionContract): number {
    const spec = alphaDecision.tradeSpec;
    const risk = Math.abs(spec.entry - spec.stopLoss);
    const reward = Math.abs(spec.takeProfit - spec.entry);

    if (risk === 0) return 2.0; // Default
    return reward / risk;
  }
}

export const tradeThesisPlanGenerator = new TradeThesisPlanGenerator();
