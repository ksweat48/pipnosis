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

export interface SafetyZoneConfig {
  zone: SafetyZone;
  min_rr_ratio: number;
  min_tp_distance_atr: number;
  min_trade_duration_seconds: number;
  allow_alpha_override: boolean;
  requires_explicit_reasoning: boolean;
  description: string;
}

export const SAFETY_ZONES: SafetyZoneConfig[] = [
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
    min_rr_ratio: 0.3,
    min_tp_distance_atr: 1.0,
    min_trade_duration_seconds: 300,
    allow_alpha_override: false,
    requires_explicit_reasoning: false,
    description: 'HARD BLOCK - Mathematical survival limits, even Alpha cannot override'
  }
];

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
   */
  evaluateTrade(params: {
    rrRatio: number;
    tpDistancePips: number;
    slDistancePips: number;
    atr: number;
    symbol: string;
    estimatedDurationSeconds?: number;
  }): SafetyEvaluation {
    const { rrRatio, tpDistancePips, atr, estimatedDurationSeconds = 0 } = params;

    const tpDistanceATR = tpDistancePips / (atr || 1);
    const violations: SafetyViolation[] = [];
    let currentZone: SafetyZone = 'GREEN';

    for (let i = SAFETY_ZONES.length - 1; i >= 0; i--) {
      const zone = SAFETY_ZONES[i];

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

    const zoneConfig = SAFETY_ZONES.find(z => z.zone === currentZone)!;
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
    const rrScore = Math.min(100, (rrRatio / 2.0) * 100);
    const tpScore = Math.min(100, (tpDistanceATR / 5.0) * 100);
    const zoneMultiplier = zone === 'GREEN' ? 1.0 : zone === 'YELLOW' ? 0.8 : zone === 'ORANGE' ? 0.5 : 0.2;

    return Math.round((rrScore * 0.6 + tpScore * 0.4) * zoneMultiplier);
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
