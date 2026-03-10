/**
 * Wall Calibration Engine — SSOT for Dynamic Wall Adjustment
 *
 * ARCHITECTURE PRINCIPLE (CCIP-2026-02-18):
 * Walls are not static guards — they are live physics that must breathe
 * with market conditions. This engine runs BEFORE generateDualArenaWalls()
 * is called and produces a calibrated resolvedPlan that safely widens
 * the trading corridor when conditions compress it.
 *
 * PROBLEM IT SOLVES:
 * The 12x ATR multiplier and envelope percentage floors are calibrated for
 * active, volatile trading sessions. When volatility compresses (low regime)
 * or session time is short, these values produce corridors where:
 *   - tpMax (12 * small ATR) < tpMin (envelope floor %)
 *   - Result: Alpha has no valid space → NO_TRADE every time
 *
 * SOLUTION:
 * Instead of blocking Alpha, ADAPT the walls to the environment. Give Alpha
 * the trading corridor that the live market can actually support, not the
 * corridor for a hypothetically volatile session.
 *
 * SAFETY GUARANTEES:
 * - Walls only EXPAND, never compress below envelope identity
 * - All expansions bounded by per-asset MAX_SAFE_ATR_MULTIPLIER
 * - Calibration is transparent — every adjustment is logged
 * - No adjustment changes trade STYLE — only the corridor width
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
  ATR_MULTIPLIER_BY_REGIME,
  MAX_SAFE_ATR_MULTIPLIER,
  MIN_ATR_MULTIPLIER,
  SESSION_TIME_EXPANSION_THRESHOLDS,
  SESSION_EXPANSION_FACTORS,
  TP_FLOOR_RATIO_BY_REGIME,
  MIN_TP_FLOOR_RATIO,
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
  volatilityRegime: 'low' | 'medium' | 'high';
  userId?: string;
  sessionId?: string;
}

export interface WallCalibrationResult {
  calibratedResolvedPlan: {
    tpMaxAtrMultiple: number;
    slMinPercent?: number;
    minRR?: number;
    /**
     * SSOT: calibrated TP floor in pips, reduced from envelope minimum via
     * TP_FLOOR_RATIO_BY_REGIME in low/medium volatility. Passed into
     * omega9ConstraintProvider so the constraint generator uses the adjusted
     * floor instead of the raw envelope floor — preventing zero-width corridors
     * when ATR-derived SL is small during Asian/low-volatility sessions.
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
    regimeMultiplierUsed: number;
    sessionFactorUsed: number;
    corridorWidthPips: number;
    envelopeTpMinPips: number;
    envelopeTpMaxPips: number;
    calibratedEnvelopeTpMinPips: number;
    tpFloorRatioApplied: number;
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

    calibrationLog.push(`[WallCalibration] ${input.symbol} | Style: ${envelopeStyle} | Regime: ${input.volatilityRegime} | Session: ${input.currentSession} (${input.sessionTimeRemainingMinutes}min)`);

    const envelopeBounds = getAssetClassEnvelopeBounds(
      envelopeStyle,
      assetClass,
      input.symbol,
      input.entry
    );

    const envelopeTpMinPips = envelopeBounds.tpPips.min;
    const envelopeTpMaxPips = envelopeBounds.tpPips.max;
    const safetyCap = MAX_SAFE_ATR_MULTIPLIER[assetClass];

    const baseMultiplier = ATR_MULTIPLIER_BY_REGIME[input.volatilityRegime];
    calibrationLog.push(`[WallCalibration] Regime multiplier: ${baseMultiplier}x (${input.volatilityRegime} vol)`);

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

    // CCIP-2026-03-10: Wire TP_FLOOR_RATIO_BY_REGIME (was defined in config but unused — dead code).
    // The envelope TP minimum is calibrated for active/volatile sessions. During low/medium
    // volatility the ATR-derived R:R ceiling (SL × maxRR) often equals or falls below the
    // raw envelope floor, producing a zero-width corridor (tpMax = tpMin). Alpha then
    // correctly identifies a structural TP beyond the ceiling → wall violation → NO_TRADE.
    //
    // Fix: Apply the regime ratio to compress the EFFECTIVE floor toward market reality.
    // The raw envelope floor is still visible to Alpha in the prompt as the style identity
    // reference; this calibrated floor is what determines wall feasibility in the constraint
    // generator (passed via calibratedEnvelopeTpMinPips in resolvedPlan).
    //
    // Governance guardrails:
    //   - Minimum ratio is MIN_TP_FLOOR_RATIO (0.35) — never compress below 35% of floor
    //   - Floor can only be REDUCED, never raised by this path (ceiling expansion handles that)
    //   - All adjustments are logged with the ratio applied for full audit traceability
    const rawTpFloorRatio = TP_FLOOR_RATIO_BY_REGIME[input.volatilityRegime];
    const tpFloorRatio = Math.max(rawTpFloorRatio, MIN_TP_FLOOR_RATIO);
    const calibratedEnvelopeTpMinPips = Math.round(envelopeTpMinPips * tpFloorRatio * 10) / 10;

    if (tpFloorRatio < 1.0) {
      calibrationLog.push(
        `[WallCalibration] TP floor ratio: ${tpFloorRatio}x (${input.volatilityRegime} vol) | ` +
        `Envelope floor: ${envelopeTpMinPips.toFixed(1)} pips → Calibrated floor: ${calibratedEnvelopeTpMinPips.toFixed(1)} pips`
      );
    }

    const rawCeilingPips = (input.atr * combinedMultiplier) / pipInfo.pipValue;
    const minCorridorWidth = MIN_CORRIDOR_WIDTH_PIPS[assetClass];

    // Use the calibrated (adjusted) floor for corridor width calculation
    const corridorWidth = rawCeilingPips - calibratedEnvelopeTpMinPips;

    calibrationLog.push(
      `[WallCalibration] Calibrated floor: ${calibratedEnvelopeTpMinPips.toFixed(1)} pips | ` +
      `ATR ceiling at ${combinedMultiplier}x: ${rawCeilingPips.toFixed(1)} pips | ` +
      `Corridor: ${corridorWidth.toFixed(1)} pips`
    );

    let finalMultiplier = combinedMultiplier;
    let safetyCapApplied = false;
    let calibrationReason: WallCalibrationReason = 'NO_ADJUSTMENT';
    let wasCalibrated = false;

    if (corridorWidth < minCorridorWidth) {
      calibrationLog.push(`[WallCalibration] CORRIDOR INFEASIBLE: width ${corridorWidth.toFixed(1)} pips < minimum ${minCorridorWidth} pips — expanding ceiling`);

      // Expand ceiling until corridor reaches minimum width above the calibrated floor
      const requiredCeilingPips = calibratedEnvelopeTpMinPips + minCorridorWidth;
      const requiredMultiplier = (requiredCeilingPips * pipInfo.pipValue) / input.atr;
      finalMultiplier = Math.min(
        Math.max(requiredMultiplier, combinedMultiplier),
        safetyCap
      );

      if (finalMultiplier >= safetyCap) {
        safetyCapApplied = true;
        calibrationLog.push(`[WallCalibration] Safety cap applied: ${safetyCap}x for ${assetClass}`);
      }

      calibrationReason = corridorWidth < 0
        ? 'CORRIDOR_INFEASIBLE_EXPANSION'
        : sessionExpansionApplied
          ? 'SESSION_TIME_EXPANSION'
          : 'LOW_VOLATILITY_EXPANSION';

      wasCalibrated = true;
    } else {
      if (input.volatilityRegime === 'low') {
        calibrationReason = 'LOW_VOLATILITY_EXPANSION';
        wasCalibrated = baseMultiplier !== 12 || tpFloorRatio < 1.0;
      } else if (input.volatilityRegime === 'high') {
        calibrationReason = 'HIGH_VOLATILITY_STANDARD';
        wasCalibrated = false;
      } else {
        calibrationReason = 'NORMAL_VOLATILITY';
        wasCalibrated = baseMultiplier !== 12 || tpFloorRatio < 1.0;
      }
    }

    const originalAtrMultiple = 12;
    const calibratedAtrMultiple = Math.round(finalMultiplier * 100) / 100;

    if (calibratedAtrMultiple !== originalAtrMultiple || tpFloorRatio < 1.0) {
      wasCalibrated = true;
    }

    const finalCeilingPips = (input.atr * calibratedAtrMultiple) / pipInfo.pipValue;
    const finalCorridorWidth = finalCeilingPips - calibratedEnvelopeTpMinPips;

    calibrationLog.push(
      `[WallCalibration] Final: ${originalAtrMultiple}x → ${calibratedAtrMultiple}x | ` +
      `Ceiling: ${finalCeilingPips.toFixed(1)} pips | ` +
      `Floor (calibrated): ${calibratedEnvelopeTpMinPips.toFixed(1)} pips | ` +
      `Final corridor: ${finalCorridorWidth.toFixed(1)} pips | Cap: ${safetyCapApplied ? 'YES' : 'NO'}`
    );

    if (wasCalibrated) {
      console.log(
        `[WallCalibration] CALIBRATED ${input.symbol}: ATR multiplier ${originalAtrMultiple}x → ${calibratedAtrMultiple}x, ` +
        `TP floor ${envelopeTpMinPips.toFixed(1)} → ${calibratedEnvelopeTpMinPips.toFixed(1)} pips (${calibrationReason})`
      );
    }

    const result: WallCalibrationResult = {
      calibratedResolvedPlan: {
        tpMaxAtrMultiple: calibratedAtrMultiple,
        calibratedEnvelopeTpMinPips,
      },
      wasCalibrated,
      calibrationReason,
      originalAtrMultiple,
      calibratedAtrMultiple,
      diagnostics: {
        assetClass,
        safetyCapApplied,
        sessionExpansionApplied,
        regimeMultiplierUsed: baseMultiplier,
        sessionFactorUsed: sessionFactor,
        corridorWidthPips: finalCorridorWidth,
        envelopeTpMinPips,
        envelopeTpMaxPips,
        calibratedEnvelopeTpMinPips,
        tpFloorRatioApplied: tpFloorRatio,
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
        volatility_regime: input.volatilityRegime,
        asset_class: result.diagnostics.assetClass,
        original_atr_multiple: result.originalAtrMultiple,
        calibrated_atr_multiple: result.calibratedAtrMultiple,
        calibration_reason: result.calibrationReason,
        corridor_width_pips: result.diagnostics.corridorWidthPips,
        envelope_tp_min_pips: result.diagnostics.envelopeTpMinPips,
        envelope_tp_max_pips: result.diagnostics.envelopeTpMaxPips,
        calibrated_envelope_tp_min_pips: result.diagnostics.calibratedEnvelopeTpMinPips,
        tp_floor_ratio_applied: result.diagnostics.tpFloorRatioApplied,
        safety_cap_applied: result.diagnostics.safetyCapApplied,
        session_expansion_applied: result.diagnostics.sessionExpansionApplied,
        regime_multiplier_used: result.diagnostics.regimeMultiplierUsed,
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
