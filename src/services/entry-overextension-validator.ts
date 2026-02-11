/**
 * Entry Overextension Validator - SSOT Authority
 *
 * RESPONSIBILITY:
 * Single source of truth for detecting when current price is overextended
 * beyond the optimal entry zone and recommending intelligent degradation.
 *
 * GOVERNANCE MODEL:
 * - Engines VALIDATE (this service detects overextension)
 * - Alpha DECIDES (makes final trade decision with degradation applied)
 * - Trades DEGRADE INTELLIGENTLY (position size reduction, not blocking)
 *
 * ARCHITECTURAL PRINCIPLES:
 * - No silent mutations
 * - No blocking unless extreme
 * - All decisions auditable
 * - Degradation over rejection
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface OverextensionAnalysis {
  isOverextended: boolean;
  overextensionType: 'within_zone' | 'bought_high' | 'sold_low';
  severity: 'none' | 'minor' | 'moderate' | 'severe' | 'extreme';

  // Metrics
  currentPrice: number;
  optimalZoneMin: number;
  optimalZoneMax: number;
  optimalCenter: number;
  overextensionDistance: number;
  overextensionPercentage: number;

  // Degradation Recommendation
  degradationAction: 'none' | 'position_reduction' | 'stop_widening' | 'entry_blocked';
  positionSizeMultiplier: number; // 1.0 = no reduction, 0.5 = 50% reduction, 0 = blocked

  // Context
  reasoning: string;
  recommendation: string;
}

export interface OverextensionInput {
  symbol: string;
  direction: 'buy' | 'sell';
  currentPrice: number;
  optimalZoneMin: number;
  optimalZoneMax: number;
  alphaConfidence?: number;
  omegaConsensusCount?: number;
}

export class EntryOverextensionValidator {
  /**
   * Analyzes if current price is overextended beyond optimal zone
   * and provides intelligent degradation recommendations.
   */
  static analyzeOverextension(input: OverextensionInput): OverextensionAnalysis {
    const {
      symbol,
      direction,
      currentPrice,
      optimalZoneMin,
      optimalZoneMax,
      alphaConfidence,
      omegaConsensusCount
    } = input;

    const optimalCenter = (optimalZoneMin + optimalZoneMax) / 2;
    const zoneWidth = optimalZoneMax - optimalZoneMin;

    // Calculate overextension
    let overextensionDistance = 0;
    let overextensionType: 'within_zone' | 'bought_high' | 'sold_low' = 'within_zone';

    if (direction === 'buy') {
      if (currentPrice > optimalZoneMax) {
        overextensionDistance = currentPrice - optimalZoneMax;
        overextensionType = 'bought_high';
      }
    } else { // sell
      if (currentPrice < optimalZoneMin) {
        overextensionDistance = optimalZoneMin - currentPrice;
        overextensionType = 'sold_low';
      }
    }

    const overextensionPercentage = zoneWidth > 0
      ? (overextensionDistance / zoneWidth) * 100
      : 0;

    // Classify severity based on overextension percentage
    let severity: OverextensionAnalysis['severity'] = 'none';
    let degradationAction: OverextensionAnalysis['degradationAction'] = 'none';
    let positionSizeMultiplier = 1.0;

    if (overextensionPercentage === 0) {
      severity = 'none';
      degradationAction = 'none';
      positionSizeMultiplier = 1.0;
    } else if (overextensionPercentage <= 25) {
      // Minor: 1-25% beyond optimal zone
      severity = 'minor';
      degradationAction = 'position_reduction';
      positionSizeMultiplier = 0.75; // 25% reduction
    } else if (overextensionPercentage <= 50) {
      // Moderate: 26-50% beyond optimal zone
      severity = 'moderate';
      degradationAction = 'position_reduction';
      positionSizeMultiplier = 0.50; // 50% reduction
    } else if (overextensionPercentage <= 100) {
      // Severe: 51-100% beyond optimal zone
      severity = 'severe';
      degradationAction = 'position_reduction';
      positionSizeMultiplier = 0.25; // 75% reduction
    } else {
      // Extreme: >100% beyond optimal zone
      severity = 'extreme';
      degradationAction = 'entry_blocked';
      positionSizeMultiplier = 0; // Blocked
    }

    // High confidence trades get less aggressive degradation
    if (alphaConfidence && alphaConfidence >= 85) {
      positionSizeMultiplier = Math.min(1.0, positionSizeMultiplier + 0.15);
      logger.info('High confidence trade - reducing degradation', {
        symbol,
        originalMultiplier: positionSizeMultiplier - 0.15,
        adjustedMultiplier: positionSizeMultiplier
      });
    }

    // Strong omega consensus gets less aggressive degradation
    if (omegaConsensusCount && omegaConsensusCount >= 4) {
      positionSizeMultiplier = Math.min(1.0, positionSizeMultiplier + 0.10);
      logger.info('Strong omega consensus - reducing degradation', {
        symbol,
        consensusCount: omegaConsensusCount,
        adjustedMultiplier: positionSizeMultiplier
      });
    }

    // Generate reasoning
    const reasoning = this.generateReasoning(
      overextensionType,
      severity,
      overextensionDistance,
      overextensionPercentage,
      direction,
      currentPrice,
      optimalZoneMin,
      optimalZoneMax
    );

    const recommendation = this.generateRecommendation(
      degradationAction,
      positionSizeMultiplier,
      severity
    );

    return {
      isOverextended: overextensionType !== 'within_zone',
      overextensionType,
      severity,
      currentPrice,
      optimalZoneMin,
      optimalZoneMax,
      optimalCenter,
      overextensionDistance,
      overextensionPercentage,
      degradationAction,
      positionSizeMultiplier,
      reasoning,
      recommendation
    };
  }

  /**
   * Logs overextension event to governance system
   */
  static async logOverextensionEvent(
    sessionId: string,
    analysis: OverextensionAnalysis,
    input: OverextensionInput,
    originalPositionSize?: number,
    degradedPositionSize?: number
  ): Promise<string | null> {
    try {
      const { data, error } = await supabase.rpc('log_overextension_event', {
        p_session_id: sessionId,
        p_symbol: input.symbol,
        p_direction: input.direction,
        p_current_price: analysis.currentPrice,
        p_optimal_zone_min: analysis.optimalZoneMin,
        p_optimal_zone_max: analysis.optimalZoneMax,
        p_overextension_type: analysis.overextensionType,
        p_severity: analysis.severity,
        p_degradation_action: analysis.degradationAction,
        p_original_position_size: originalPositionSize || null,
        p_degraded_position_size: degradedPositionSize || null,
        p_alpha_confidence: input.alphaConfidence || null,
        p_omega_consensus_count: input.omegaConsensusCount || null
      });

      if (error) {
        logger.error('Failed to log overextension event', { error, sessionId });
        return null;
      }

      logger.info('Overextension event logged', {
        sessionId,
        eventId: data,
        severity: analysis.severity,
        action: analysis.degradationAction
      });

      return data as string;
    } catch (error) {
      logger.error('Exception logging overextension event', { error, sessionId });
      return null;
    }
  }

  /**
   * Updates overextension event with trade outcome
   */
  static async updateOverextensionOutcome(
    eventId: string,
    tradeId: string,
    postEntryMovement: number,
    wasProfitable: boolean
  ): Promise<void> {
    try {
      const retrospectiveQuality = wasProfitable ? 'vindicated' : 'mistake';

      const { error } = await supabase
        .from('entry_overextension_events')
        .update({
          trade_id: tradeId,
          post_entry_movement: postEntryMovement,
          was_profitable: wasProfitable,
          retrospective_quality: retrospectiveQuality
        })
        .eq('id', eventId);

      if (error) {
        logger.error('Failed to update overextension outcome', { error, eventId });
        return;
      }

      logger.info('Overextension outcome updated', {
        eventId,
        tradeId,
        wasProfitable,
        retrospectiveQuality
      });
    } catch (error) {
      logger.error('Exception updating overextension outcome', { error, eventId });
    }
  }

  private static generateReasoning(
    overextensionType: string,
    severity: string,
    distance: number,
    percentage: number,
    direction: string,
    currentPrice: number,
    zoneMin: number,
    zoneMax: number
  ): string {
    if (overextensionType === 'within_zone') {
      return `Entry price within optimal zone [${zoneMin.toFixed(5)} - ${zoneMax.toFixed(5)}]. No degradation needed.`;
    }

    const actionVerb = direction === 'buy' ? 'buying' : 'selling';
    const pricePosition = overextensionType === 'bought_high' ? 'above' : 'below';

    return `Entry is ${actionVerb} ${distance.toFixed(5)} pips ${pricePosition} optimal zone (${percentage.toFixed(1)}% overextended). ` +
      `Current price ${currentPrice.toFixed(5)} is outside optimal range [${zoneMin.toFixed(5)} - ${zoneMax.toFixed(5)}]. ` +
      `Severity: ${severity.toUpperCase()}.`;
  }

  private static generateRecommendation(
    action: string,
    multiplier: number,
    severity: string
  ): string {
    if (action === 'none') {
      return 'Proceed with full position size. Entry is within optimal zone.';
    }

    if (action === 'entry_blocked') {
      return 'EXTREME OVEREXTENSION: Entry blocked. Price is too far from optimal zone. Wait for retracement.';
    }

    const reductionPct = ((1 - multiplier) * 100).toFixed(0);
    return `${severity.toUpperCase()} overextension detected. Reducing position size by ${reductionPct}% to manage risk. ` +
      `Consider waiting for price to reenter optimal zone for better entry.`;
  }
}
