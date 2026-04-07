/**
 * Wall Calibration Engine — SSOT for Dynamic Wall Adjustment
 *
 * ARCHITECTURE PRINCIPLE (CCIP-2026-02-18, updated CCIP-2026-04-07):
 * The wall is a fixed safety boundary — it exists to prevent physically
 * impossible trades, NOT to control Alpha's execution space based on a
 * pre-classified volatility label.
 *
 * CCIP-2026-04-07 CHANGE:
 * Removed all volatility-regime-driven branching. The previous engine read
 * a 'low/medium/high' label computed from static atrPercent thresholds and
 * used it to select different ATR multipliers (12x/14x/16x) and TP floor
 * compression ratios (40%/65%/100%). This caused:
 *  - NAS100/US30 always classified 'low' → 16x multiplier, 40% TP floor
 *  - Wall secretly tightening against Alpha based on incorrect classification
 *  - Alpha prompt containing false 'low volatility' context
 *
 * CURRENT BEHAVIOUR:
 * - Single FIXED_ATR_MULTIPLIER (14x) for all instruments and all sessions
 * - No TP floor compression — envelope floors are used as-is
 * - Session-time expansion still applied when time remaining is critically short
 * - Emergency corridor expansion still applied when ceiling < floor + min width
 * - All expansions bounded by per-asset MAX_SAFE_ATR_MULTIPLIER safety ceilings
 *
 * SSOT COMPLIANCE:
 * - All constants read from wall-calibration-config.ts (one place)
 * - Asset classification delegated to assetClassifier
 * - Pip math delegated to getCurrencyPipInfo
 * - Supabase logging via supabase client (non-blocking, fire-and-forget)
 */

import { getCurrencyPipInfo } from '../utils/currencyHelpers';
import { assetClassifier } from './asset-classifier';
import { supabase } from '../lib/supabase';
import {
  FIXED_ATR_MULTIPLIER,
  MAX_SAFE_ATR_MULTIPLIER,
  MIN_ATR_MULTIPLIER,
  SESSION_TIME_EXPANSION_THRESHOLDS,
  SESSION_EXPANSION_FACTORS,
  MIN_CORRIDOR_WIDTH_PIPS,
  CALIBRATION_AUDIT_ENABLED,
  type WallCalibrationReason,
  type AssetCalibrationClass,
} from '../config/wall-calibration-config';

import { getAssetClassEnvelopeBounds } from '../config/style-execution-envelopes';
import type { TradeStyle, LegacyRiskMode } from '../types/omega9-constraints';

export interface WallCalibrationInput {
  symbol: string;
  entry: number;
  atr: number;
  tradeStyle: TradeStyle;
  riskMode: LegacyRiskMode;
  currentSession: string;
  sessionTimeRemainingMinutes: number;
  userId?: string;
  sessionId?: string;
}

export interface WallCalibrationResult {
  calibratedResolvedPlan: {
    tpMaxAtrMultiple: number;
    slMinPercent?: number;
    minRR?: number;
    /**
     * CCIP-2026-04-07: TP floor in pips derived from the envelope minimum.
     * No compression is applied — the envelope floor is used as-is.
     * Passed into omega9ConstraintProvider so the constraint generator uses
     * this value consistently. Emergency corridor expansion may adjust this
     * if the corridor is physically infeasible.
     */
    calibratedEnvelopeTpMinPips?: number;
  };
  wasCalibrated: boolean;
  calibrationReason: WallCalibrationReason;
  originalAtrMultiple: number;
  calibratedAtrMultiple: number;
  diagnostics: {
    assetClass: AssetCalibrationClass;
    safetyCapApplied: boolean;
    sessionExpansionApplied: boolean;
    baseMultiplierUsed: number;
    sessionFactorUsed: number;
    corridorWidthPips: number;
    envelopeTpMinPips: number;
    envelopeTpMaxPips: number;
    calibrationLog: string[];
  };
}

const STYLE_MAP: Record<TradeStyle, 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY'> = {
  scalper: 'SCALP',
  micro: 'MICRO_INTRADAY',
  intraday: 'INTRADAY',
};

class WallCalibrationEngine {
  /**
   * Primary entry point.
   *
   * Computes the calibrated resolvedPlan to pass into generateDualArenaWalls().
   * This is the ONLY function coordinators should call.
   *
   * FLOW:
   * 1. Compute what the raw walls would be (atrMax ceiling in pips)
   * 2. Compute what the envelope floor requires (tpMin in pips)
   * 3. If ceiling >= floor + minCorridorWidth → no calibration needed
   * 4. Otherwise → expand ATR multiplier step by step until corridor is valid
   * 5. Cap at asset-class safety ceiling
   * 6. Log calibration event to Supabase (non-blocking)
   */
  calibrate(input: WallCalibrationInput): WallCalibrationResult {
    const calibrationLog: string[] = [];
    const pipInfo = getCurrencyPipInfo(input.symbol);
    const assetCategory = assetClassifier.getAssetCategory(input.symbol);
    const assetClass = this.mapAssetClass(assetCategory);
    const envelopeStyle = STYLE_MAP[input.tradeStyle] || 'INTRADAY';

    calibrationLog.push(`[WallCalibration] ${input.symbol} | Style: ${envelopeStyle} | Session: ${input.currentSession} (${input.sessionTimeRemainingMinutes}min)`);

    const envelopeBounds = getAssetClassEnvelopeBounds(
      envelopeStyle,
      assetClass,
      input.symbol,
      input.entry
    );

    const envelopeTpMinPips = envelopeBounds.tpPips.min;
    const envelopeTpMaxPips = envelopeBounds.tpPips.max;
    const safetyCap = MAX_SAFE_ATR_MULTIPLIER[assetClass];

    // CCIP-2026-04-07: Single fixed multiplier for all instruments and sessions.
    // No regime-driven branching — Alpha is the sole authority on volatility interpretation.
    const baseMultiplier = FIXED_ATR_MULTIPLIER;
    calibrationLog.push(`[WallCalibration] Fixed ATR multiplier: ${baseMultiplier}x (no regime classification)`);

    let sessionFactor = 1.0;
    let sessionExpansionApplied = false;
    const sessionMins = input.sessionTimeRemainingMinutes;

    if (sessionMins <= SESSION_TIME_EXPANSION_THRESHOLDS.CRITICAL_MINUTES) {
      sessionFactor = SESSION_EXPANSION_FACTORS.CRITICAL;
      sessionExpansionApplied = true;
      calibrationLog.push(`[WallCalibration] Session CRITICAL (${sessionMins}min <= ${SESSION_TIME_EXPANSION_THRESHOLDS.CRITICAL_MINUTES}min) — applying ${sessionFactor}x session factor`);
    } else if (sessionMins <= SESSION_TIME_EXPANSION_THRESHOLDS.LOW_MINUTES) {
      sessionFactor = SESSION_EXPANSION_FACTORS.LOW;
      sessionExpansionApplied = true;
      calibrationLog.push(`[WallCalibration] Session LOW (${sessionMins}min <= ${SESSION_TIME_EXPANSION_THRESHOLDS.LOW_MINUTES}min) — applying ${sessionFactor}x session factor`);
    } else if (sessionMins <= SESSION_TIME_EXPANSION_THRESHOLDS.MODERATE_MINUTES) {
      sessionFactor = SESSION_EXPANSION_FACTORS.MODERATE;
      sessionExpansionApplied = true;
      calibrationLog.push(`[WallCalibration] Session MODERATE (${sessionMins}min <= ${SESSION_TIME_EXPANSION_THRESHOLDS.MODERATE_MINUTES}min) — applying ${sessionFactor}x session factor`);
    }

    const combinedMultiplier = Math.min(
      Math.max(baseMultiplier * sessionFactor, MIN_ATR_MULTIPLIER),
      safetyCap
    );

    // CCIP-2026-04-07: Envelope floor is used as-is — no TP floor compression.
    // The old TP_FLOOR_RATIO_BY_REGIME system (40%/65%/100%) was compressing the
    // envelope floor based on the incorrectly-classified volatility label. Removed.
    const envelopeTpMinPipsEffective = envelopeTpMinPips;

    const rawCeilingPips = (input.atr * combinedMultiplier) / pipInfo.pipValue;
    const minCorridorWidth = MIN_CORRIDOR_WIDTH_PIPS[assetClass];
    const corridorWidth = rawCeilingPips - envelopeTpMinPipsEffective;

    calibrationLog.push(
      `[WallCalibration] Envelope floor: ${envelopeTpMinPipsEffective.toFixed(1)} pips | ` +
      `ATR ceiling at ${combinedMultiplier}x: ${rawCeilingPips.toFixed(1)} pips | ` +
      `Corridor: ${corridorWidth.toFixed(1)} pips`
    );

    let finalMultiplier = combinedMultiplier;
    let safetyCapApplied = false;
    let calibrationReason: WallCalibrationReason = 'NO_ADJUSTMENT';
    let wasCalibrated = sessionExpansionApplied;

    if (corridorWidth < minCorridorWidth) {
      calibrationLog.push(`[WallCalibration] CORRIDOR INFEASIBLE: width ${corridorWidth.toFixed(1)} pips < minimum ${minCorridorWidth} pips — expanding ceiling`);

      const requiredCeilingPips = envelopeTpMinPipsEffective + minCorridorWidth;
      const requiredMultiplier = (requiredCeilingPips * pipInfo.pipValue) / input.atr;
      finalMultiplier = Math.min(
        Math.max(requiredMultiplier, combinedMultiplier),
        safetyCap
      );

      if (finalMultiplier >= safetyCap) {
        safetyCapApplied = true;
        calibrationLog.push(`[WallCalibration] Safety cap applied: ${safetyCap}x for ${assetClass}`);
      }

      calibrationReason = 'CORRIDOR_INFEASIBLE_EXPANSION';
      wasCalibrated = true;
    } else if (sessionExpansionApplied) {
      calibrationReason = 'SESSION_TIME_EXPANSION';
    }

    const originalAtrMultiple = FIXED_ATR_MULTIPLIER;
    const calibratedAtrMultiple = Math.round(finalMultiplier * 100) / 100;

    if (calibratedAtrMultiple !== originalAtrMultiple) {
      wasCalibrated = true;
    }

    const finalCeilingPips = (input.atr * calibratedAtrMultiple) / pipInfo.pipValue;
    const finalCorridorWidth = finalCeilingPips - envelopeTpMinPipsEffective;

    calibrationLog.push(
      `[WallCalibration] Final: ${originalAtrMultiple}x → ${calibratedAtrMultiple}x | ` +
      `Ceiling: ${finalCeilingPips.toFixed(1)} pips | ` +
      `Floor: ${envelopeTpMinPipsEffective.toFixed(1)} pips | ` +
      `Final corridor: ${finalCorridorWidth.toFixed(1)} pips | Cap: ${safetyCapApplied ? 'YES' : 'NO'}`
    );

    if (wasCalibrated) {
      console.log(
        `[WallCalibration] CALIBRATED ${input.symbol}: ATR multiplier ${originalAtrMultiple}x → ${calibratedAtrMultiple}x (${calibrationReason})`
      );
    }

    const result: WallCalibrationResult = {
      calibratedResolvedPlan: {
        tpMaxAtrMultiple: calibratedAtrMultiple,
        calibratedEnvelopeTpMinPips: envelopeTpMinPipsEffective,
      },
      wasCalibrated,
      calibrationReason,
      originalAtrMultiple,
      calibratedAtrMultiple,
      diagnostics: {
        assetClass,
        safetyCapApplied,
        sessionExpansionApplied,
        baseMultiplierUsed: baseMultiplier,
        sessionFactorUsed: sessionFactor,
        corridorWidthPips: finalCorridorWidth,
        envelopeTpMinPips,
        envelopeTpMaxPips,
        calibrationLog,
      },
    };

    if (CALIBRATION_AUDIT_ENABLED && wasCalibrated) {
      this.logCalibrationEvent(input, result).catch(err => {
        console.warn('[WallCalibration] Non-blocking audit log failure:', err);
      });
    }

    return result;
  }

  /**
   * Log calibration event to Supabase for governance audit trail.
   * Fire-and-forget — never blocks Alpha's execution path.
   */
  private async logCalibrationEvent(
    input: WallCalibrationInput,
    result: WallCalibrationResult
  ): Promise<void> {
    try {
      await supabase.from('wall_calibration_events').insert({
        symbol: input.symbol,
        trade_style: input.tradeStyle,
        current_session: input.currentSession,
        session_time_remaining_minutes: input.sessionTimeRemainingMinutes,
        asset_class: result.diagnostics.assetClass,
        original_atr_multiple: result.originalAtrMultiple,
        calibrated_atr_multiple: result.calibratedAtrMultiple,
        calibration_reason: result.calibrationReason,
        corridor_width_pips: result.diagnostics.corridorWidthPips,
        envelope_tp_min_pips: result.diagnostics.envelopeTpMinPips,
        envelope_tp_max_pips: result.diagnostics.envelopeTpMaxPips,
        safety_cap_applied: result.diagnostics.safetyCapApplied,
        session_expansion_applied: result.diagnostics.sessionExpansionApplied,
        base_multiplier_used: result.diagnostics.baseMultiplierUsed,
        session_factor_used: result.diagnostics.sessionFactorUsed,
        entry_price: input.entry,
        atr_value: input.atr,
        user_id: input.userId || null,
        session_id: input.sessionId || null,
      });
    } catch (err) {
      console.warn('[WallCalibration] Audit log insert failed (non-blocking):', err);
    }
  }

  private mapAssetClass(category: string): AssetCalibrationClass {
    switch (category) {
      case 'crypto': return 'CRYPTO';
      case 'metal': return 'METAL';
      case 'index': return 'INDEX';
      default: return 'FOREX';
    }
  }
}

export const wallCalibrationEngine = new WallCalibrationEngine();
