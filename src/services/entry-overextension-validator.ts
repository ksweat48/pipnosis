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
 *
 * TIER 3 FIX: Consolidated to use SSOT definitions from entry-overextension-calculator.ts
 * - Removed duplicate STYLE_OVEREXTENSION_THRESHOLDS
 * - Removed duplicate TradeStyle type
 * - Removed duplicate normalizeStyle function
 * - Uses shared calculation logic for consistency
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import {
  STYLE_OVEREXTENSION_THRESHOLDS,
  type TradeStyle,
  calculateOverextension,
  normalizeStyle
} from '../utils/entry-overextension-calculator';

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
   *
   * TIER 3 FIX: Delegates calculation to SSOT calculator module
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

    // Normalize style to SSOT format
    const normalizedStyle = normalizeStyle(style);

    // Calculate optimal zone center for alphaEntry parameter
    const alphaEntry = (optimalZoneMin + optimalZoneMax) / 2;

    // Delegate core calculation to SSOT calculator
    const calculationResult = calculateOverextension(
      currentPrice,
      alphaEntry,
      symbol,
      direction === 'buy' ? 'long' : 'short',
      normalizedStyle,
      undefined // atrValue - zone is already provided, so ATR recalculation not needed
    );

    // Override optimal zone with provided values (validator receives explicit zone from caller)
    const overextensionResult = {
      ...calculationResult,
      optimalZone: {
        min: optimalZoneMin,
        max: optimalZoneMax,
        center: alphaEntry,
        width: optimalZoneMax - optimalZoneMin,
        calculationMethod: 'provided' as const
      }
    };

    // Generate block reason if invalid
    let blockReason: string | null = null;
    if (!overextensionResult.isValid) {
      const actionVerb = direction === 'buy' ? 'BUYING HIGH' : 'SELLING LOW';
      blockReason = `ENTRY INVALID: ${actionVerb} - ${overextensionResult.overextensionPercentage.toFixed(1)}% overextended (max allowed: ${overextensionResult.maxAllowedPercentage}% for ${normalizedStyle} style). ` +
        `Entry price ${currentPrice.toFixed(5)} is outside optimal zone [${optimalZoneMin.toFixed(5)} - ${optimalZoneMax.toFixed(5)}]. ` +
        `Alpha must wait for pullback into optimal zone or abort trade.`;
    }

    // Generate reasoning
    const reasoning = this.generateReasoning(
      overextensionResult.overextensionType,
      overextensionResult.severity,
      overextensionResult.overextensionDistance,
      overextensionResult.overextensionPercentage,
      direction,
      currentPrice,
      optimalZoneMin,
      optimalZoneMax,
      overextensionResult.isValid,
      overextensionResult.maxAllowedPercentage,
      normalizedStyle
    );

    logger.info('[EntryOverextensionValidator] Validation result', {
      symbol,
      direction,
      style: normalizedStyle,
      isValid: overextensionResult.isValid,
      overextensionPct: overextensionResult.overextensionPercentage.toFixed(1),
      threshold: overextensionResult.maxAllowedPercentage,
      overextensionType: overextensionResult.overextensionType,
      severity: overextensionResult.severity
    });

    return {
      isValid: overextensionResult.isValid,
      overextensionType: overextensionResult.overextensionType,
      severity: overextensionResult.severity,
      currentPrice,
      optimalZoneMin,
      optimalZoneMax,
      optimalCenter: alphaEntry,
      overextensionDistance: overextensionResult.overextensionDistance,
      overextensionPercentage: overextensionResult.overextensionPercentage,
      maxAllowedOverextension: overextensionResult.maxAllowedPercentage,
      style: normalizedStyle,
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

}
