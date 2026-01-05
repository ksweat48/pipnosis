/**
 * Alpha Safety Zones - Graduated Guardrails System
 *
 * Philosophy: Preserve Alpha's intelligence while preventing catastrophic trades
 *
 * Design Principles:
 * 1. GREEN ZONE: Full Alpha authority - optimal trading conditions
 * 2. YELLOW ZONE: Alpha proceeds with warning - suboptimal but acceptable
 * 3. ORANGE ZONE: Requires explicit override + reasoning - risky but potentially justified
 * 4. RED ZONE: HARD BLOCK - mathematical/physical limits where even Alpha cannot override
 *
 * This system allows Alpha to be creative and adaptive while maintaining survival boundaries.
 */

export type SafetyZone = 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED';
export type TradeStyle = 'SCALP' | 'INTRADAY' | 'SWING';

export interface SafetyZoneConfig {
  zone: SafetyZone;
  min_rr_ratio: number;
  min_tp_distance_atr: number;
  min_trade_duration_seconds: number;
  allow_alpha_override: boolean;
  requires_explicit_reasoning: boolean;
  description: string;
}

/**
 * Get safety zones dynamically adjusted for trade style
 * CRITICAL FIX: RED ZONE thresholds now vary by trade style
 *
 * SCALP: 0.2:1 minimum (fast, high-frequency)
 * INTRADAY: 0.3:1 minimum (standard)
 * SWING: 0.5:1 minimum (patient, higher targets)
 */
export function getSafetyZones(tradeStyle: TradeStyle = 'INTRADAY'): SafetyZoneConfig[] {
  // Adjust RED ZONE threshold based on trade style
  let redZoneMinRR = 0.3; // Default INTRADAY
  let redZoneMinTPAtr = 1.0;

  if (tradeStyle === 'SCALP') {
    redZoneMinRR = 0.2; // Scalp: Lower minimum for fast trades
    redZoneMinTPAtr = 0.8;
  } else if (tradeStyle === 'SWING') {
    redZoneMinRR = 0.5; // Swing: Higher minimum for patient trades
    redZoneMinTPAtr = 1.5;
  }

  return [
    {
      zone: 'GREEN',
      min_rr_ratio: 1.5,
      min_tp_distance_atr: 5.0,
      min_trade_duration_seconds: 0,
      allow_alpha_override: true,
      requires_explicit_reasoning: false,
      description: 'Optimal trading conditions - Full Alpha authority'
    },
    {
      zone: 'YELLOW',
      min_rr_ratio: 1.0,
      min_tp_distance_atr: 3.0,
      min_trade_duration_seconds: 60,
      allow_alpha_override: true,
      requires_explicit_reasoning: false,
      description: 'Suboptimal conditions - Alpha can proceed with warning'
    },
    {
      zone: 'ORANGE',
      min_rr_ratio: 0.5,
      min_tp_distance_atr: 2.0,
      min_trade_duration_seconds: 120,
      allow_alpha_override: true,
      requires_explicit_reasoning: true,
      description: 'Risky conditions - Alpha must provide explicit override reasoning'
    },
    {
      zone: 'RED',
      min_rr_ratio: redZoneMinRR,
      min_tp_distance_atr: redZoneMinTPAtr,
      min_trade_duration_seconds: 300,
      allow_alpha_override: false,
      requires_explicit_reasoning: false,
      description: `HARD BLOCK - ${tradeStyle} survival limits (R:R ≥ ${redZoneMinRR}:1)`
    }
  ];
}

// Backwards compatibility: default SAFETY_ZONES (INTRADAY style)
export const SAFETY_ZONES = getSafetyZones('INTRADAY');

export interface SafetyViolation {
  zone: SafetyZone;
  violation_type: 'rr_ratio' | 'tp_distance' | 'instant_close' | 'multiple_violations';
  actual_value: number;
  threshold_value: number;
  severity: 'warning' | 'requires_override' | 'hard_block';
  message: string;
  allow_override: boolean;
}

export interface SafetyEvaluation {
  zone: SafetyZone;
  is_safe: boolean;
  violations: SafetyViolation[];
  requires_override_reasoning: boolean;
  can_proceed: boolean;
  recommended_action: 'PROCEED' | 'PROCEED_WITH_WARNING' | 'REQUIRE_OVERRIDE' | 'HARD_BLOCK';
  safety_score: number;
}

export class AlphaSafetyZoneEvaluator {
  /**
   * Evaluate trade safety based on R:R ratio, TP distance, and trade characteristics
   * CRITICAL FIX: Now accepts tradeStyle for dynamic RED ZONE thresholds
   */
  evaluateTrade(params: {
    rrRatio: number;
    tpDistancePips: number;
    slDistancePips: number;
    atr: number;
    symbol: string;
    estimatedDurationSeconds?: number;
    tradeStyle?: TradeStyle;
  }): SafetyEvaluation {
    const { rrRatio, tpDistancePips, atr, estimatedDurationSeconds = 0, tradeStyle = 'INTRADAY' } = params;

    // Get style-specific safety zones
    const safetyZones = getSafetyZones(tradeStyle);
    console.log(`[Alpha Safety] Evaluating ${tradeStyle} trade: R:R ${rrRatio.toFixed(2)}:1, RED zone minimum: ${safetyZones[3].min_rr_ratio}:1`);

    const tpDistanceATR = tpDistancePips / (atr || 1);
    const violations: SafetyViolation[] = [];
    let currentZone: SafetyZone = 'GREEN';

    for (let i = safetyZones.length - 1; i >= 0; i--) {
      const zone = safetyZones[i];

      if (rrRatio < zone.min_rr_ratio) {
        violations.push({
          zone: zone.zone,
          violation_type: 'rr_ratio',
          actual_value: rrRatio,
          threshold_value: zone.min_rr_ratio,
          severity: zone.zone === 'RED' ? 'hard_block' : zone.zone === 'ORANGE' ? 'requires_override' : 'warning',
          message: `R:R ratio ${rrRatio.toFixed(3)} below ${zone.zone} zone minimum ${zone.min_rr_ratio.toFixed(1)}`,
          allow_override: zone.allow_alpha_override
        });
        currentZone = zone.zone;
        break;
      }

      if (tpDistanceATR < zone.min_tp_distance_atr) {
        violations.push({
          zone: zone.zone,
          violation_type: 'tp_distance',
          actual_value: tpDistanceATR,
          threshold_value: zone.min_tp_distance_atr,
          severity: zone.zone === 'RED' ? 'hard_block' : zone.zone === 'ORANGE' ? 'requires_override' : 'warning',
          message: `TP distance ${tpDistanceATR.toFixed(1)} ATR below ${zone.zone} zone minimum ${zone.min_tp_distance_atr.toFixed(1)} ATR`,
          allow_override: zone.allow_alpha_override
        });
        currentZone = zone.zone;
        break;
      }

      if (estimatedDurationSeconds > 0 && estimatedDurationSeconds < zone.min_trade_duration_seconds) {
        violations.push({
          zone: zone.zone,
          violation_type: 'instant_close',
          actual_value: estimatedDurationSeconds,
          threshold_value: zone.min_trade_duration_seconds,
          severity: zone.zone === 'RED' ? 'hard_block' : zone.zone === 'ORANGE' ? 'requires_override' : 'warning',
          message: `Trade duration ${estimatedDurationSeconds}s below ${zone.zone} zone minimum ${zone.min_trade_duration_seconds}s`,
          allow_override: zone.allow_alpha_override
        });
        if (zone.zone > currentZone) {
          currentZone = zone.zone;
        }
      }
    }

    const zoneConfig = safetyZones.find(z => z.zone === currentZone)!;
    const isSafe = violations.length === 0;
    const canProceed = isSafe || (violations.length > 0 && violations.every(v => v.allow_override));

    let recommendedAction: SafetyEvaluation['recommended_action'];
    if (currentZone === 'RED') {
      recommendedAction = 'HARD_BLOCK';
    } else if (currentZone === 'ORANGE') {
      recommendedAction = 'REQUIRE_OVERRIDE';
    } else if (currentZone === 'YELLOW') {
      recommendedAction = 'PROCEED_WITH_WARNING';
    } else {
      recommendedAction = 'PROCEED';
    }

    const safetyScore = this.calculateSafetyScore(rrRatio, tpDistanceATR, currentZone);

    return {
      zone: currentZone,
      is_safe: isSafe,
      violations,
      requires_override_reasoning: zoneConfig.requires_explicit_reasoning,
      can_proceed: canProceed,
      recommended_action: recommendedAction,
      safety_score: safetyScore
    };
  }

  /**
   * Calculate a safety score (0-100) based on R:R and TP distance
   */
  private calculateSafetyScore(rrRatio: number, tpDistanceATR: number, zone: SafetyZone): number {
    // Handle NaN/Infinity cases
    if (!isFinite(rrRatio) || !isFinite(tpDistanceATR)) {
      return 0;
    }

    const rrScore = Math.min(100, (rrRatio / 2.0) * 100);
    const tpScore = Math.min(100, (tpDistanceATR / 5.0) * 100);
    const zoneMultiplier = zone === 'GREEN' ? 1.0 : zone === 'YELLOW' ? 0.8 : zone === 'ORANGE' ? 0.5 : 0.2;

    const score = (rrScore * 0.6 + tpScore * 0.4) * zoneMultiplier;

    // Ensure final score is a valid number
    return isFinite(score) ? Math.round(score) : 0;
  }

  /**
   * Get zone color for UI display
   */
  getZoneColor(zone: SafetyZone): string {
    switch (zone) {
      case 'GREEN': return '#10b981';
      case 'YELLOW': return '#f59e0b';
      case 'ORANGE': return '#f97316';
      case 'RED': return '#ef4444';
    }
  }

  /**
   * Get human-readable zone description
   */
  getZoneDescription(zone: SafetyZone): string {
    return SAFETY_ZONES.find(z => z.zone === zone)?.description || 'Unknown zone';
  }
}

export const alphaSafetyZoneEvaluator = new AlphaSafetyZoneEvaluator();
