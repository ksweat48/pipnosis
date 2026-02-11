/**
 * Entry Overextension Validator - SSOT Authority for Entry Precision
 *
 * RESPONSIBILITY:
 * Enforces entry discipline by invalidating trades that enter outside optimal zone.
 *
 * CORE PRINCIPLE:
 * "Overextension is a PRECISION VIOLATION, not a risk parameter."
 * Alpha must either enter correctly or not enter. No "enter badly but smaller."
 *
 * GOVERNANCE MODEL:
 * - Engines VALIDATE (this service detects overextension)
 * - Alpha DECIDES (but cannot proceed if invalid)
 * - Trades BLOCKED (not degraded)
 *
 * ARCHITECTURAL PRINCIPLES:
 * - Hard invalidation (binary VALID/INVALID)
 * - No position size mutation
 * - No confidence overrides
 * - No silent execution
 * - Full audit trail
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

/**
 * Style-specific overextension thresholds
 * Scalp requires strictest precision, Intraday allows more tolerance
 */
export const STYLE_OVEREXTENSION_THRESHOLDS = {
  scalp: 15,      // Scalp: Maximum 15% overextension (strictest)
  micro: 30,      // Micro: Maximum 30% overextension
  day: 50,        // Day/Intraday: Maximum 50% overextension
  swing: 50,      // Swing: Maximum 50% overextension (most tolerant)
  precision: 15   // Precision: Maximum 15% overextension (strict like scalp)
} as const;

export type TradeStyle = keyof typeof STYLE_OVEREXTENSION_THRESHOLDS;

export interface OverextensionValidation {
  isValid: boolean;
  overextensionType: 'within_zone' | 'bought_high' | 'sold_low';
  severity: 'none' | 'minor' | 'moderate' | 'severe' | 'extreme';

  // Metrics
  currentPrice: number;
  optimalZoneMin: number;
  optimalZoneMax: number;
  optimalCenter: number;
  overextensionDistance: number;
  overextensionPercentage: number;

  // Validation Decision
  maxAllowedOverextension: number;
  style: TradeStyle;
  blockReason: string | null;

  // Context
  reasoning: string;
}

export interface ValidationInput {
  symbol: string;
  direction: 'buy' | 'sell';
  currentPrice: number;
  optimalZoneMin: number;
  optimalZoneMax: number;
  style: TradeStyle;
  alphaConfidence?: number;
  omegaConsensusCount?: number;
}

export class EntryOverextensionValidator {
  /**
   * Validates if entry is within acceptable overextension threshold
   * Returns VALID or INVALID (no degradation)
   */
  static validateEntry(input: ValidationInput): OverextensionValidation {
    const {
      symbol,
      direction,
      currentPrice,
      optimalZoneMin,
      optimalZoneMax,
      style,
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

    // Get style-specific threshold
    const maxAllowedOverextension = STYLE_OVEREXTENSION_THRESHOLDS[style] || 25;

    // Classify severity (informational only, does not affect decision)
    let severity: OverextensionValidation['severity'] = 'none';
    if (overextensionPercentage === 0) {
      severity = 'none';
    } else if (overextensionPercentage <= 25) {
      severity = 'minor';
    } else if (overextensionPercentage <= 50) {
      severity = 'moderate';
    } else if (overextensionPercentage <= 100) {
      severity = 'severe';
    } else {
      severity = 'extreme';
    }

    // HARD INVALIDATION: Binary decision
    const isValid = overextensionPercentage <= maxAllowedOverextension;

    // Generate block reason if invalid
    let blockReason: string | null = null;
    if (!isValid) {
      const actionVerb = direction === 'buy' ? 'BUYING HIGH' : 'SELLING LOW';
      blockReason = `ENTRY INVALID: ${actionVerb} - ${overextensionPercentage.toFixed(1)}% overextended (max allowed: ${maxAllowedOverextension}% for ${style} style). ` +
        `Entry price ${currentPrice.toFixed(5)} is outside optimal zone [${optimalZoneMin.toFixed(5)} - ${optimalZoneMax.toFixed(5)}]. ` +
        `Alpha must wait for pullback into optimal zone or abort trade.`;
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
      optimalZoneMax,
      isValid,
      maxAllowedOverextension,
      style
    );

    logger.info('[EntryOverextensionValidator] Validation result', {
      symbol,
      direction,
      style,
      isValid,
      overextensionPct: overextensionPercentage.toFixed(1),
      threshold: maxAllowedOverextension,
      overextensionType,
      severity
    });

    return {
      isValid,
      overextensionType,
      severity,
      currentPrice,
      optimalZoneMin,
      optimalZoneMax,
      optimalCenter,
      overextensionDistance,
      overextensionPercentage,
      maxAllowedOverextension,
      style,
      blockReason,
      reasoning
    };
  }

  /**
   * Logs overextension event to governance system
   */
  static async logOverextensionEvent(
    sessionId: string,
    validation: OverextensionValidation,
    input: ValidationInput
  ): Promise<string | null> {
    try {
      const { data, error } = await supabase.rpc('log_overextension_event', {
        p_session_id: sessionId,
        p_symbol: input.symbol,
        p_direction: input.direction,
        p_current_price: validation.currentPrice,
        p_optimal_zone_min: validation.optimalZoneMin,
        p_optimal_zone_max: validation.optimalZoneMax,
        p_overextension_type: validation.overextensionType,
        p_severity: validation.severity,
        p_entry_blocked: !validation.isValid,
        p_style: validation.style,
        p_max_allowed_pct: validation.maxAllowedOverextension,
        p_decision_reason: validation.blockReason || validation.reasoning,
        p_alpha_confidence: input.alphaConfidence || null,
        p_omega_consensus_count: input.omegaConsensusCount || null
      });

      if (error) {
        logger.error('[EntryOverextensionValidator] Failed to log event', {
          error,
          sessionId
        });
        return null;
      }

      logger.info('[EntryOverextensionValidator] Event logged', {
        sessionId,
        eventId: data,
        isValid: validation.isValid,
        severity: validation.severity
      });

      return data as string;
    } catch (error) {
      logger.error('[EntryOverextensionValidator] Exception logging event', {
        error,
        sessionId
      });
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
        logger.error('[EntryOverextensionValidator] Failed to update outcome', {
          error,
          eventId
        });
        return;
      }

      logger.info('[EntryOverextensionValidator] Outcome updated', {
        eventId,
        tradeId,
        wasProfitable,
        retrospectiveQuality
      });
    } catch (error) {
      logger.error('[EntryOverextensionValidator] Exception updating outcome', {
        error,
        eventId
      });
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
    zoneMax: number,
    isValid: boolean,
    maxAllowed: number,
    style: string
  ): string {
    if (overextensionType === 'within_zone') {
      return `✅ VALID ENTRY: Price ${currentPrice.toFixed(5)} is within optimal zone [${zoneMin.toFixed(5)} - ${zoneMax.toFixed(5)}]. ` +
        `No overextension detected. Entry precision maintained.`;
    }

    const actionVerb = direction === 'buy' ? 'buying' : 'selling';
    const pricePosition = overextensionType === 'bought_high' ? 'above' : 'below';

    if (isValid) {
      return `✅ ACCEPTABLE: Entry is ${actionVerb} ${distance.toFixed(5)} pips ${pricePosition} optimal zone (${percentage.toFixed(1)}% overextended). ` +
        `Within ${maxAllowed}% threshold for ${style} style. Severity: ${severity.toUpperCase()}. Entry allowed.`;
    } else {
      return `❌ INVALID: Entry is ${actionVerb} ${distance.toFixed(5)} pips ${pricePosition} optimal zone (${percentage.toFixed(1)}% overextended). ` +
        `Exceeds ${maxAllowed}% threshold for ${style} style. Severity: ${severity.toUpperCase()}. ENTRY BLOCKED. ` +
        `Alpha must wait for pullback or abort trade. No position size reduction - precision violation.`;
    }
  }

  /**
   * Get style from session data with fallback
   */
  static normalizeStyle(styleInput: string | undefined): TradeStyle {
    if (!styleInput) return 'day'; // Default fallback

    const normalized = styleInput.toLowerCase().trim();

    // Map common variations
    if (normalized === 'scalp' || normalized === 'scalper') return 'scalp';
    if (normalized === 'micro') return 'micro';
    if (normalized === 'day' || normalized === 'intraday') return 'day';
    if (normalized === 'swing') return 'swing';
    if (normalized === 'precision') return 'precision';

    // Default to day if unknown
    logger.warn('[EntryOverextensionValidator] Unknown style, defaulting to day', {
      styleInput,
      normalized
    });
    return 'day';
  }
}
