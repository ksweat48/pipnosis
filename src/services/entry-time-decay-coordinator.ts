/**
 * Entry Time Decay Coordinator
 *
 * ═══════════════════════════════════════════════════════════════════
 * SINGLE SOURCE OF TRUTH for entry monitoring time-decay logic
 * ═══════════════════════════════════════════════════════════════════
 *
 * RESPONSIBILITIES:
 * - Calculate urgency phases based on trade style and elapsed time
 * - Provide EQS threshold relaxation schedules
 * - Determine zone tolerance progression
 * - Detect edge loss conditions
 * - Format time displays for UI
 *
 * TRADE STYLE TIME WINDOWS:
 *
 * SCALP (Fast immediacy trades):
 *   - Optimal: 0-3 min (Phase 1)
 *   - Acceptable: 3-7 min (Phase 2)
 *   - Aggressive: 7-10 min (Phase 3)
 *   - Edge Loss: >10 min
 *
 * MICRO (Structured patience):
 *   - Optimal: 0-15 min (Phase 1)
 *   - Acceptable: 15-30 min (Phase 2)
 *   - Aggressive: 30-45 min (Phase 3)
 *   - Edge Loss: >45 min
 *
 * INTRADAY (Patient positioning):
 *   - Optimal: 0-45 min (Phase 1)
 *   - Acceptable: 45-90 min (Phase 2)
 *   - Aggressive: 90-120 min (Phase 3)
 *   - Edge Loss: >120 min
 *
 * SSOT COMPLIANCE:
 * - All time thresholds: Database function get_entry_time_thresholds()
 * - Phase calculation: THIS SERVICE
 * - EQS thresholds: Derived from database config
 * - Zone tolerance: Derived from database config
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export type UrgencyPhase = 1 | 2 | 3;

export interface EntryTimeThresholds {
  optimal_wait_min: number;
  acceptable_wait_min: number;
  max_wait_min: number;
  eqs_phase2_min: number;
  eqs_phase3_min: number;
  eqs_threshold_phase1: number;
  eqs_threshold_phase2: number;
  eqs_threshold_phase3: number;
  zone_tolerance_phase1: number;
  zone_tolerance_phase2: number;
  zone_tolerance_phase3: number;
}

export interface UrgencyPhaseResult {
  phase: UrgencyPhase;
  eqsThreshold: number;
  zoneTolerance: number;
  minutesInPhase: number;
  minutesUntilNextPhase: number | null;
  timeDescription: string;
  colorClass: string;
}

export interface EdgeLossStatus {
  shouldTriggerModal: boolean;
  minutesOverdue: number;
  edgeDecayPercent: number;
}

class EntryTimeDecayCoordinator {
  private thresholdsCache: Map<string, EntryTimeThresholds> = new Map();
  private cacheExpiry = 5 * 60 * 1000; // 5 minutes

  /**
   * Get time thresholds for a trade style (with caching)
   */
  async getThresholds(tradeStyle: string): Promise<EntryTimeThresholds> {
    const cacheKey = `thresholds_${tradeStyle}`;
    const cached = this.thresholdsCache.get(cacheKey);

    if (cached) {
      return cached;
    }

    const { data, error } = await supabase.rpc('get_entry_time_thresholds', {
      p_trade_style: tradeStyle
    });

    if (error) {
      logger.error('[EntryTimeDecay] Failed to get thresholds:', error);
      // Fallback to MICRO defaults
      return this.getFallbackThresholds(tradeStyle);
    }

    const thresholds = data[0] as EntryTimeThresholds;
    this.thresholdsCache.set(cacheKey, thresholds);

    // Clear cache after expiry
    setTimeout(() => this.thresholdsCache.delete(cacheKey), this.cacheExpiry);

    return thresholds;
  }

  /**
   * Fallback thresholds if database query fails
   */
  private getFallbackThresholds(tradeStyle: string): EntryTimeThresholds {
    const defaults: Record<string, EntryTimeThresholds> = {
      SCALP: {
        optimal_wait_min: 3,
        acceptable_wait_min: 7,
        max_wait_min: 10,
        eqs_phase2_min: 3,
        eqs_phase3_min: 7,
        eqs_threshold_phase1: 70,
        eqs_threshold_phase2: 60,
        eqs_threshold_phase3: 50,
        zone_tolerance_phase1: 0,
        zone_tolerance_phase2: 20,
        zone_tolerance_phase3: 50,
      },
      MICRO_INTRADAY: {
        optimal_wait_min: 15,
        acceptable_wait_min: 30,
        max_wait_min: 45,
        eqs_phase2_min: 15,
        eqs_phase3_min: 30,
        eqs_threshold_phase1: 65,
        eqs_threshold_phase2: 55,
        eqs_threshold_phase3: 45,
        zone_tolerance_phase1: 0,
        zone_tolerance_phase2: 30,
        zone_tolerance_phase3: 60,
      },
      INTRADAY: {
        optimal_wait_min: 45,
        acceptable_wait_min: 90,
        max_wait_min: 120,
        eqs_phase2_min: 45,
        eqs_phase3_min: 90,
        eqs_threshold_phase1: 60,
        eqs_threshold_phase2: 50,
        eqs_threshold_phase3: 40,
        zone_tolerance_phase1: 0,
        zone_tolerance_phase2: 40,
        zone_tolerance_phase3: 70,
      },
    };

    return defaults[tradeStyle] || defaults.MICRO_INTRADAY;
  }

  /**
   * Calculate current urgency phase and thresholds
   */
  async calculateUrgencyPhase(
    tradeStyle: string,
    createdAt: Date
  ): Promise<UrgencyPhaseResult> {
    const thresholds = await this.getThresholds(tradeStyle);
    const minutesElapsed = (Date.now() - createdAt.getTime()) / 60000;

    let phase: UrgencyPhase = 1;
    let eqsThreshold: number;
    let zoneTolerance: number;
    let timeDescription: string;
    let colorClass: string;
    let minutesInPhase: number;
    let minutesUntilNextPhase: number | null;

    if (minutesElapsed >= thresholds.eqs_phase3_min) {
      // Phase 3: Aggressive
      phase = 3;
      eqsThreshold = thresholds.eqs_threshold_phase3;
      zoneTolerance = thresholds.zone_tolerance_phase3;
      minutesInPhase = minutesElapsed - thresholds.eqs_phase3_min;
      minutesUntilNextPhase = thresholds.max_wait_min - minutesElapsed;
      timeDescription = 'Aggressive Window';
      colorClass = minutesUntilNextPhase < 1 ? 'text-red-600' : 'text-orange-500';
    } else if (minutesElapsed >= thresholds.eqs_phase2_min) {
      // Phase 2: Acceptable
      phase = 2;
      eqsThreshold = thresholds.eqs_threshold_phase2;
      zoneTolerance = thresholds.zone_tolerance_phase2;
      minutesInPhase = minutesElapsed - thresholds.eqs_phase2_min;
      minutesUntilNextPhase = thresholds.eqs_phase3_min - minutesElapsed;
      timeDescription = 'Acceptable Window';
      colorClass = 'text-yellow-500';
    } else {
      // Phase 1: Optimal
      phase = 1;
      eqsThreshold = thresholds.eqs_threshold_phase1;
      zoneTolerance = thresholds.zone_tolerance_phase1;
      minutesInPhase = minutesElapsed;
      minutesUntilNextPhase = thresholds.eqs_phase2_min - minutesElapsed;
      timeDescription = 'Optimal Window';
      colorClass = 'text-green-500';
    }

    return {
      phase,
      eqsThreshold,
      zoneTolerance,
      minutesInPhase,
      minutesUntilNextPhase: minutesUntilNextPhase > 0 ? minutesUntilNextPhase : null,
      timeDescription,
      colorClass,
    };
  }

  /**
   * Check if entry should trigger edge loss modal
   */
  async checkEdgeLoss(
    tradeStyle: string,
    createdAt: Date,
    isPriceInZone: boolean
  ): Promise<EdgeLossStatus> {
    const thresholds = await this.getThresholds(tradeStyle);
    const minutesElapsed = (Date.now() - createdAt.getTime()) / 60000;

    // Never trigger edge loss if price is currently in zone
    if (isPriceInZone) {
      return {
        shouldTriggerModal: false,
        minutesOverdue: 0,
        edgeDecayPercent: 0,
      };
    }

    const shouldTrigger = minutesElapsed >= thresholds.max_wait_min;
    const minutesOverdue = Math.max(0, minutesElapsed - thresholds.max_wait_min);

    // Calculate edge decay percentage (0-100%)
    const edgeDecayPercent = Math.min(
      100,
      (minutesElapsed / thresholds.max_wait_min) * 100
    );

    return {
      shouldTriggerModal: shouldTrigger,
      minutesOverdue,
      edgeDecayPercent,
    };
  }

  /**
   * Format time remaining for UI display
   */
  formatTimeRemaining(minutes: number): string {
    if (minutes < 0) {
      return 'Overdue';
    }

    const mins = Math.floor(minutes);
    const secs = Math.floor((minutes - mins) * 60);

    if (mins === 0) {
      return `${secs}s`;
    }

    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Get phase description for UI
   */
  getPhaseDescription(phase: UrgencyPhase, tradeStyle: string): string {
    const descriptions: Record<string, Record<UrgencyPhase, string>> = {
      SCALP: {
        1: 'Waiting for optimal entry with tight zone (0-3min)',
        2: 'Accepting wider entry zones as momentum builds (3-7min)',
        3: 'Executing on good-enough setups before edge fades (7-10min)',
      },
      MICRO_INTRADAY: {
        1: 'Waiting for structured entry with precision (0-15min)',
        2: 'Accepting pullbacks and retests (15-30min)',
        3: 'Taking available entries as patience expires (30-45min)',
      },
      INTRADAY: {
        1: 'Patient positioning for high-quality entry (0-45min)',
        2: 'Monitoring structural levels and VWAP retests (45-90min)',
        3: 'Final window before thesis invalidates (90-120min)',
      },
    };

    return descriptions[tradeStyle]?.[phase] || descriptions.MICRO_INTRADAY[phase];
  }

  /**
   * Get EQS threshold for specific phase (for UI display)
   */
  async getEQSThresholdForPhase(
    tradeStyle: string,
    phase: UrgencyPhase
  ): Promise<number> {
    const thresholds = await this.getThresholds(tradeStyle);

    switch (phase) {
      case 1:
        return thresholds.eqs_threshold_phase1;
      case 2:
        return thresholds.eqs_threshold_phase2;
      case 3:
        return thresholds.eqs_threshold_phase3;
    }
  }

  /**
   * Get zone tolerance for specific phase (for UI display)
   */
  async getZoneToleranceForPhase(
    tradeStyle: string,
    phase: UrgencyPhase
  ): Promise<number> {
    const thresholds = await this.getThresholds(tradeStyle);

    switch (phase) {
      case 1:
        return thresholds.zone_tolerance_phase1;
      case 2:
        return thresholds.zone_tolerance_phase2;
      case 3:
        return thresholds.zone_tolerance_phase3;
    }
  }

  /**
   * Clear cache (for testing or manual refresh)
   */
  clearCache(): void {
    this.thresholdsCache.clear();
  }
}

export const entryTimeDecayCoordinator = new EntryTimeDecayCoordinator();
