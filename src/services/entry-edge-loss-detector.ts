/**
 * Entry Edge Loss Detector
 *
 * ═══════════════════════════════════════════════════════════════════
 * SINGLE SOURCE OF TRUTH for entry edge loss detection
 * ═══════════════════════════════════════════════════════════════════
 *
 * RESPONSIBILITIES:
 * - Detect when entry intent has exceeded max wait time for style
 * - Determine if edge loss modal should be triggered
 * - Calculate edge decay percentage
 * - Format time displays for UI
 *
 * REMOVED RESPONSIBILITIES (Time-Based Urgency System):
 * - ❌ Phase calculation (Phase 1/2/3) - REMOVED
 * - ❌ EQS threshold decay - REMOVED
 * - ❌ Zone tolerance progression - REMOVED
 * - ❌ Time-based threshold relaxation - REMOVED
 *
 * NEW SIMPLIFIED MODEL:
 * - Static thresholds based on confidence only
 * - Exact zone matching only (no tolerance)
 * - Absolute time limits per style (no phases)
 * - Edge loss modal at style-specific max time
 *
 * EDGE LOSS TIME LIMITS:
 * - SCALP: 10 minutes max wait
 * - MICRO_INTRADAY: 45 minutes max wait
 * - INTRADAY: 120 minutes max wait
 *
 * SSOT COMPLIANCE:
 * - Edge loss limits: EDGE_LOSS_TIME_LIMITS (alpha-identity.ts)
 * - Edge loss detection: THIS SERVICE
 * - Time formatting: THIS SERVICE
 */

import { EDGE_LOSS_TIME_LIMITS } from '../config/alpha-identity';
import { logger } from '../lib/logger';

export type TradeStyle = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';

export interface EdgeLossStatus {
  shouldTriggerModal: boolean;
  minutesOverdue: number;
  edgeDecayPercent: number;
  maxWaitMinutes: number;
  minutesElapsed: number;
}

class EntryEdgeLossDetector {
  /**
   * Check if entry should trigger edge loss modal
   *
   * Edge loss is triggered when:
   * 1. Intent has exceeded style-specific max wait time
   * 2. Price is NOT currently in entry zone
   *
   * If price is in zone, no edge loss (execution is imminent)
   */
  checkEdgeLoss(
    tradeStyle: TradeStyle,
    createdAt: Date,
    isPriceInZone: boolean
  ): EdgeLossStatus {
    const maxWaitMinutes = this.getMaxWaitMinutes(tradeStyle);
    const minutesElapsed = (Date.now() - createdAt.getTime()) / 60000;

    // Never trigger edge loss if price is currently in zone
    if (isPriceInZone) {
      return {
        shouldTriggerModal: false,
        minutesOverdue: 0,
        edgeDecayPercent: 0,
        maxWaitMinutes,
        minutesElapsed,
      };
    }

    const shouldTrigger = minutesElapsed >= maxWaitMinutes;
    const minutesOverdue = Math.max(0, minutesElapsed - maxWaitMinutes);

    // Calculate edge decay percentage (0-100%)
    const edgeDecayPercent = Math.min(
      100,
      (minutesElapsed / maxWaitMinutes) * 100
    );

    if (shouldTrigger) {
      logger.info('[EdgeLoss] Edge loss detected', {
        tradeStyle,
        minutesElapsed: minutesElapsed.toFixed(1),
        maxWaitMinutes,
        minutesOverdue: minutesOverdue.toFixed(1),
        edgeDecayPercent: edgeDecayPercent.toFixed(1),
      });
    }

    return {
      shouldTriggerModal: shouldTrigger,
      minutesOverdue,
      edgeDecayPercent,
      maxWaitMinutes,
      minutesElapsed,
    };
  }

  /**
   * Get max wait time for trade style (SSOT)
   * These are absolute limits from alpha-identity.ts
   */
  private getMaxWaitMinutes(tradeStyle: TradeStyle): number {
    return EDGE_LOSS_TIME_LIMITS[tradeStyle];
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
   * Format elapsed time for display
   */
  formatElapsedTime(minutes: number): string {
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

  /**
   * Get style-specific max wait time for display
   */
  getMaxWaitDisplay(tradeStyle: TradeStyle): string {
    const maxMinutes = this.getMaxWaitMinutes(tradeStyle);
    return this.formatElapsedTime(maxMinutes);
  }

  /**
   * Calculate minutes remaining before edge loss
   */
  getMinutesRemaining(tradeStyle: TradeStyle, createdAt: Date): number {
    const maxWaitMinutes = this.getMaxWaitMinutes(tradeStyle);
    const minutesElapsed = (Date.now() - createdAt.getTime()) / 60000;
    return Math.max(0, maxWaitMinutes - minutesElapsed);
  }
}

export const entryEdgeLossDetector = new EntryEdgeLossDetector();
