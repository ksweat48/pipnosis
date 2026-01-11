/**
 * Entry Urgency Calculator - Time-Based EQS Threshold Decay
 *
 * SINGLE SOURCE OF TRUTH for time-based entry urgency logic.
 *
 * ARCHITECTURE:
 * - Automatically determines urgency phase based on time elapsed and trading style
 * - No user configuration - style (SCALP/MICRO/INTRADAY) determines time thresholds
 * - High Alpha confidence accelerates phase transitions
 * - Phase 1 (Strict) → Phase 2 (Relaxed) → Phase 3 (Urgent)
 *
 * PHASE PROGRESSION:
 * - Phase 1: Original threshold (60 EQS)
 * - Phase 2: Relaxed threshold (50 EQS)
 * - Phase 3: Urgent threshold (40 EQS)
 *
 * TIME THRESHOLDS BY STYLE:
 * - SCALP: 5min → 15min → 25min (fast)
 * - MICRO_INTRADAY: 8min → 20min → 35min (medium)
 * - INTRADAY: 15min → 35min → 55min (slower)
 */

import { ENTRY_URGENCY_CONFIG, StyleName } from '../config/alpha-identity';
import { logger } from '../lib/logger';

export interface UrgencyPhaseResult {
  phase: 1 | 2 | 3;
  timeAdjustedThreshold: number;
  zoneTolerancePips: number;
  minutesElapsed: number;
  minutesUntilNextPhase: number | null;
  minutesUntilExpiry: number;
  isExpired: boolean;
  accelerationFactor: number;
}

export class EntryUrgencyCalculator {
  /**
   * Calculate current urgency phase and adjusted threshold
   */
  static calculateUrgency(
    createdAt: Date,
    style: StyleName,
    alphaConfidence: number
  ): UrgencyPhaseResult {
    const now = new Date();
    const minutesElapsed = (now.getTime() - createdAt.getTime()) / (1000 * 60);

    const styleConfig = ENTRY_URGENCY_CONFIG.STYLE_TIME_THRESHOLDS[style];
    const zoneToleranceConfig = ENTRY_URGENCY_CONFIG.ZONE_TOLERANCE_PIPS[style];
    const accelerationFactor = this.getAccelerationFactor(alphaConfidence);

    const phase2Threshold = styleConfig.PHASE_2_MINUTES * accelerationFactor;
    const phase3Threshold = styleConfig.PHASE_3_MINUTES * accelerationFactor;
    const expiryThreshold = styleConfig.MAX_WAIT_MINUTES * accelerationFactor;

    let phase: 1 | 2 | 3;
    let timeAdjustedThreshold: number;
    let zoneTolerancePips: number;
    let minutesUntilNextPhase: number | null;

    if (minutesElapsed < phase2Threshold) {
      phase = 1;
      timeAdjustedThreshold = ENTRY_URGENCY_CONFIG.PHASE_THRESHOLDS.PHASE_1.threshold;
      zoneTolerancePips = zoneToleranceConfig.PHASE_1;
      minutesUntilNextPhase = phase2Threshold - minutesElapsed;
    } else if (minutesElapsed < phase3Threshold) {
      phase = 2;
      timeAdjustedThreshold = ENTRY_URGENCY_CONFIG.PHASE_THRESHOLDS.PHASE_2.threshold;
      zoneTolerancePips = zoneToleranceConfig.PHASE_2;
      minutesUntilNextPhase = phase3Threshold - minutesElapsed;
    } else {
      phase = 3;
      timeAdjustedThreshold = ENTRY_URGENCY_CONFIG.PHASE_THRESHOLDS.PHASE_3.threshold;
      zoneTolerancePips = zoneToleranceConfig.PHASE_3;
      minutesUntilNextPhase = null;
    }

    const minutesUntilExpiry = Math.max(0, expiryThreshold - minutesElapsed);
    const isExpired = minutesElapsed >= expiryThreshold;

    logger.debug('[EntryUrgency]', {
      style,
      minutesElapsed: minutesElapsed.toFixed(1),
      phase,
      threshold: timeAdjustedThreshold,
      zoneTolerancePips,
      alphaConfidence,
      accelerationFactor,
      minutesUntilNextPhase: minutesUntilNextPhase?.toFixed(1),
      minutesUntilExpiry: minutesUntilExpiry.toFixed(1),
      isExpired,
    });

    return {
      phase,
      timeAdjustedThreshold,
      zoneTolerancePips,
      minutesElapsed,
      minutesUntilNextPhase,
      minutesUntilExpiry,
      isExpired,
      accelerationFactor,
    };
  }

  /**
   * Get acceleration factor based on Alpha confidence
   * Higher confidence = faster phase transitions
   */
  private static getAccelerationFactor(alphaConfidence: number): number {
    if (alphaConfidence >= 85) {
      return ENTRY_URGENCY_CONFIG.CONFIDENCE_ACCELERATION.EXCELLENT;
    }
    if (alphaConfidence >= 70) {
      return ENTRY_URGENCY_CONFIG.CONFIDENCE_ACCELERATION.SOLID;
    }
    return ENTRY_URGENCY_CONFIG.CONFIDENCE_ACCELERATION.ACCEPTABLE;
  }

  /**
   * Get human-readable phase description
   */
  static getPhaseDescription(phase: 1 | 2 | 3): string {
    switch (phase) {
      case 1:
        return ENTRY_URGENCY_CONFIG.PHASE_THRESHOLDS.PHASE_1.description;
      case 2:
        return ENTRY_URGENCY_CONFIG.PHASE_THRESHOLDS.PHASE_2.description;
      case 3:
        return ENTRY_URGENCY_CONFIG.PHASE_THRESHOLDS.PHASE_3.description;
    }
  }

  /**
   * Check if entry should be executed based on EQS vs time-adjusted threshold
   */
  static shouldExecuteEntry(eqs: number, urgencyResult: UrgencyPhaseResult): boolean {
    if (urgencyResult.isExpired) {
      logger.info('[EntryUrgency] Intent expired, should not execute');
      return false;
    }

    const shouldExecute = eqs >= urgencyResult.timeAdjustedThreshold;

    logger.debug('[EntryUrgency] Execution check', {
      eqs,
      threshold: urgencyResult.timeAdjustedThreshold,
      phase: urgencyResult.phase,
      shouldExecute,
    });

    return shouldExecute;
  }

  /**
   * Format time remaining for UI display
   */
  static formatTimeRemaining(minutes: number): string {
    if (minutes < 1) {
      return '< 1 min';
    }
    if (minutes < 60) {
      return `${Math.round(minutes)} min`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  }
}
