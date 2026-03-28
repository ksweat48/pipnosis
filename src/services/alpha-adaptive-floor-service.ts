/**
 * Alpha Adaptive Confidence Floor Service — SSOT (ADVISORY ONLY)
 *
 * CCIP-2026-0318A-ADVISORY: Threshold Advisory — No Hard Gates
 *
 * This service computes Alpha's ADVISORY confidence suggestion based on
 * historical calibration data. It is NOT an execution gate.
 *
 * ARCHITECTURE:
 * - Reads calibration data from alpha_confidence_calibration (per user, per bucket)
 * - Computes whether the advisory suggestion should move up OR down
 * - Enforces advisory suggestion rails from ADAPTIVE_FLOOR_RAILS (alpha-identity.ts SSOT)
 * - Persists every suggestion update to alpha_confidence_floor_adjustments (audit trail)
 * - Updates goal_sessions.adaptive_confidence_floor (stored for display/context only)
 *
 * GOVERNANCE:
 * We are in the experimentation phase. We do not know Alpha's true quality threshold
 * yet. The advisory suggestion is passed to Alpha as self-knowledge context in the
 * prompt: "Based on N trades, your win rate at X%+ confidence is Y%."
 * Alpha reads this as one data point and self-calibrates. Code never enforces it.
 *
 * BIDIRECTIONAL ADVISORY LOGIC:
 * - DOWN suggestion: Bucket actual_win_rate > predicted → Alpha can be less selective
 * - UP suggestion: Bucket actual_win_rate < predicted → Alpha should be more selective
 * Both are suggestions passed as prompt context. Neither blocks trade execution.
 *
 * ADVISORY RAILS (from alpha-identity.ts ADAPTIVE_FLOOR_RAILS):
 * - Advisory min: 50% — suggestion never goes below structural minimum
 * - Advisory max: 75% — suggestion never goes above this (prevents lockout advice)
 * - Step: 5 points per suggestion update
 *
 * NO CODE PATH may use the output of this service as a hard block condition.
 * getAdvisoryContext() is the primary method for callers — it returns a prompt
 * context string, never a numeric gate.
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { ADAPTIVE_FLOOR_RAILS } from '../config/alpha-identity';

export interface FloorAdjustmentResult {
  previous_floor: number;
  new_floor: number;
  direction: 'up' | 'down' | 'none';
  reason: string;
  hard_rail_applied: boolean;
  trigger_bucket?: number;
  calibration_error?: number;
  bucket_actual_win_rate?: number;
  bucket_predicted_win_rate?: number;
  bucket_sample_size?: number;
}

export interface CalibrationBucket {
  confidence_bucket: number;
  actual_win_rate: number;
  predicted_win_rate: number;
  sample_size: number;
  calibration_error: number;
}

class AlphaAdaptiveFloorService {
  /**
   * Get the current adaptive floor for a session.
   * Falls back to FLOOR_DEFAULT if the session has no floor set yet.
   * Hard rails are always enforced on read.
   */
  async getSessionFloor(sessionId: string): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('goal_sessions')
        .select('adaptive_confidence_floor')
        .eq('id', sessionId)
        .maybeSingle();

      if (error || !data) {
        return ADAPTIVE_FLOOR_RAILS.FLOOR_DEFAULT;
      }

      const raw = data.adaptive_confidence_floor ?? ADAPTIVE_FLOOR_RAILS.FLOOR_DEFAULT;
      return this.clampToRails(raw);
    } catch {
      return ADAPTIVE_FLOOR_RAILS.FLOOR_DEFAULT;
    }
  }

  /**
   * Evaluate calibration data and compute the appropriate floor adjustment.
   * This does NOT persist — call applyAdjustment() to persist.
   * Separation allows dry-run evaluation before committing.
   *
   * Returns 'none' direction when no adjustment is warranted.
   */
  async evaluateFloorAdjustment(
    userId: string,
    currentFloor: number
  ): Promise<FloorAdjustmentResult> {
    try {
      const buckets = await this.getCalibrationBuckets(userId);

      if (buckets.length === 0) {
        return {
          previous_floor: currentFloor,
          new_floor: currentFloor,
          direction: 'none',
          reason: 'No calibration data available yet',
          hard_rail_applied: false,
        };
      }

      // Find the bucket nearest to the current floor that has sufficient data
      // and meaningful miscalibration.
      const candidates = buckets
        .filter(b => b.calibration_error >= ADAPTIVE_FLOOR_RAILS.CALIBRATION_ERROR_THRESHOLD)
        .sort((a, b) => Math.abs(a.confidence_bucket - currentFloor) - Math.abs(b.confidence_bucket - currentFloor));

      if (candidates.length === 0) {
        return {
          previous_floor: currentFloor,
          new_floor: currentFloor,
          direction: 'none',
          reason: `No bucket exceeds calibration error threshold (${ADAPTIVE_FLOOR_RAILS.CALIBRATION_ERROR_THRESHOLD}pp)`,
          hard_rail_applied: false,
        };
      }

      const trigger = candidates[0];

      const isActuallyBetter = trigger.actual_win_rate > trigger.predicted_win_rate + ADAPTIVE_FLOOR_RAILS.CALIBRATION_ERROR_THRESHOLD;
      const isActuallyWorse = trigger.actual_win_rate < trigger.predicted_win_rate - ADAPTIVE_FLOOR_RAILS.CALIBRATION_ERROR_THRESHOLD;

      if (isActuallyBetter && trigger.sample_size >= ADAPTIVE_FLOOR_RAILS.SAMPLE_SIZE_THRESHOLD_DOWN) {
        const rawNew = currentFloor - ADAPTIVE_FLOOR_RAILS.FLOOR_STEP;
        const newFloor = this.clampToRails(rawNew);
        const hardRailApplied = newFloor !== rawNew;

        return {
          previous_floor: currentFloor,
          new_floor: newFloor,
          direction: newFloor < currentFloor ? 'down' : 'none',
          reason: `Bucket ${trigger.confidence_bucket}% actual WR (${trigger.actual_win_rate.toFixed(1)}%) exceeded predicted (${trigger.predicted_win_rate.toFixed(1)}%) by ${trigger.calibration_error.toFixed(1)}pp over ${trigger.sample_size} trades. Floor relaxed.`,
          hard_rail_applied: hardRailApplied,
          trigger_bucket: trigger.confidence_bucket,
          calibration_error: trigger.calibration_error,
          bucket_actual_win_rate: trigger.actual_win_rate,
          bucket_predicted_win_rate: trigger.predicted_win_rate,
          bucket_sample_size: trigger.sample_size,
        };
      }

      if (isActuallyWorse && trigger.sample_size >= ADAPTIVE_FLOOR_RAILS.SAMPLE_SIZE_THRESHOLD_UP) {
        const rawNew = currentFloor + ADAPTIVE_FLOOR_RAILS.FLOOR_STEP;
        const newFloor = this.clampToRails(rawNew);
        const hardRailApplied = newFloor !== rawNew;

        return {
          previous_floor: currentFloor,
          new_floor: newFloor,
          direction: newFloor > currentFloor ? 'up' : 'none',
          reason: `Bucket ${trigger.confidence_bucket}% actual WR (${trigger.actual_win_rate.toFixed(1)}%) fell below predicted (${trigger.predicted_win_rate.toFixed(1)}%) by ${trigger.calibration_error.toFixed(1)}pp over ${trigger.sample_size} trades. Floor tightened. Required ${ADAPTIVE_FLOOR_RAILS.SAMPLE_SIZE_THRESHOLD_UP} samples (upward protection).`,
          hard_rail_applied: hardRailApplied,
          trigger_bucket: trigger.confidence_bucket,
          calibration_error: trigger.calibration_error,
          bucket_actual_win_rate: trigger.actual_win_rate,
          bucket_predicted_win_rate: trigger.predicted_win_rate,
          bucket_sample_size: trigger.sample_size,
        };
      }

      // Insufficient sample size for the direction warranted
      const neededSamples = isActuallyWorse
        ? ADAPTIVE_FLOOR_RAILS.SAMPLE_SIZE_THRESHOLD_UP
        : ADAPTIVE_FLOOR_RAILS.SAMPLE_SIZE_THRESHOLD_DOWN;

      return {
        previous_floor: currentFloor,
        new_floor: currentFloor,
        direction: 'none',
        reason: `Miscalibration detected in bucket ${trigger.confidence_bucket}% but sample size ${trigger.sample_size} < required ${neededSamples}. No adjustment.`,
        hard_rail_applied: false,
        trigger_bucket: trigger.confidence_bucket,
        calibration_error: trigger.calibration_error,
      };
    } catch (err) {
      logger.warn('[AdaptiveFloor] evaluateFloorAdjustment failed (safe-fail)', { err });
      return {
        previous_floor: currentFloor,
        new_floor: currentFloor,
        direction: 'none',
        reason: 'Evaluation error — floor unchanged',
        hard_rail_applied: false,
      };
    }
  }

  /**
   * Evaluate AND persist a floor adjustment for a session.
   * Writes to:
   *   1. goal_sessions.adaptive_confidence_floor (live value)
   *   2. alpha_confidence_floor_adjustments (audit trail)
   *
   * Only persists when direction !== 'none'.
   * Always returns the resolved floor (new or unchanged).
   */
  async applyAdjustment(
    userId: string,
    sessionId: string,
    currentFloor: number
  ): Promise<number> {
    const evaluation = await this.evaluateFloorAdjustment(userId, currentFloor);

    if (evaluation.direction === 'none') {
      logger.info('[AdaptiveFloor] No adjustment warranted', {
        sessionId,
        currentFloor,
        reason: evaluation.reason,
      });
      return currentFloor;
    }

    try {
      // 1. Persist audit record
      await supabase.from('alpha_confidence_floor_adjustments').insert({
        user_id: userId,
        session_id: sessionId,
        previous_floor: evaluation.previous_floor,
        new_floor: evaluation.new_floor,
        direction: evaluation.direction,
        trigger_bucket: evaluation.trigger_bucket ?? currentFloor,
        bucket_actual_win_rate: evaluation.bucket_actual_win_rate ?? 0,
        bucket_predicted_win_rate: evaluation.bucket_predicted_win_rate ?? 0,
        bucket_sample_size: evaluation.bucket_sample_size ?? 0,
        calibration_error: evaluation.calibration_error ?? 0,
        adjustment_reason: evaluation.reason,
        sample_size_threshold_used: evaluation.direction === 'up'
          ? ADAPTIVE_FLOOR_RAILS.SAMPLE_SIZE_THRESHOLD_UP
          : ADAPTIVE_FLOOR_RAILS.SAMPLE_SIZE_THRESHOLD_DOWN,
        hard_rail_applied: evaluation.hard_rail_applied,
        governance_approved: true,
      });

      // 2. Read current count then write all floor fields atomically
      const { data: currentSession } = await supabase
        .from('goal_sessions')
        .select('confidence_floor_adjustment_count')
        .eq('id', sessionId)
        .maybeSingle();

      await supabase
        .from('goal_sessions')
        .update({
          adaptive_confidence_floor: evaluation.new_floor,
          confidence_floor_adjusted_at: new Date().toISOString(),
          confidence_floor_adjustment_reason: evaluation.reason,
          confidence_floor_direction: evaluation.direction,
          confidence_floor_adjustment_count: (currentSession?.confidence_floor_adjustment_count ?? 0) + 1,
        })
        .eq('id', sessionId)
        .eq('user_id', userId);

      logger.info('[AdaptiveFloor] Floor adjusted', {
        sessionId,
        direction: evaluation.direction,
        previous: evaluation.previous_floor,
        new: evaluation.new_floor,
        reason: evaluation.reason,
        hardRailApplied: evaluation.hard_rail_applied,
      });

      return evaluation.new_floor;
    } catch (err) {
      logger.warn('[AdaptiveFloor] Persist failed (safe-fail) — using in-memory floor', {
        sessionId,
        newFloor: evaluation.new_floor,
        err,
      });
      return evaluation.new_floor;
    }
  }

  /**
   * Get the advisory floor for a session, trigger evaluation, and return the
   * resolved advisory suggestion.
   *
   * CCIP-2026-0318A-ADVISORY: This returns an advisory suggestion value only.
   * The returned number MUST NOT be used as a hard execution gate.
   * Callers should use getAdvisoryContext() to get the prompt context string.
   * This method is retained for backward compatibility with display/logging callers.
   */
  async getResolvedFloor(userId: string, sessionId: string): Promise<number> {
    const currentFloor = await this.getSessionFloor(sessionId);
    return this.applyAdjustment(userId, sessionId, currentFloor);
  }

  /**
   * PRIMARY ENTRY POINT — CCIP-2026-0318A-ADVISORY
   *
   * Returns a prompt context string describing Alpha's advisory confidence
   * suggestion based on calibration data. This is passed to Alpha as
   * self-knowledge, not as a gate.
   *
   * Returns null if insufficient calibration data exists (< SAMPLE_SIZE_THRESHOLD_DOWN trades).
   * Callers should only include this in the prompt when it is non-null.
   */
  async getAdvisoryContext(userId: string, sessionId: string): Promise<string | null> {
    try {
      const buckets = await this.getCalibrationBuckets(userId);

      // Include buckets with at least 5 trades for early-stage awareness
      const sufficientBuckets = buckets.filter(b => b.sample_size >= 5);

      if (sufficientBuckets.length === 0) {
        return null;
      }

      const currentFloor = await this.getSessionFloor(sessionId);
      const evaluation = await this.evaluateFloorAdjustment(userId, currentFloor);

      const totalTrades = sufficientBuckets.reduce((sum, b) => sum + b.sample_size, 0);
      const suggestedThreshold = evaluation.new_floor;

      // Build per-bucket breakdown — each line shows actual WR, expected WR, and calibration error
      const bucketLines = sufficientBuckets
        .sort((a, b) => a.confidence_bucket - b.confidence_bucket)
        .map(b => {
          const errorSign = b.calibration_error >= 0 ? '+' : '';
          const calibNote = Math.abs(b.calibration_error) >= ADAPTIVE_FLOOR_RAILS.CALIBRATION_ERROR_THRESHOLD
            ? ` [${errorSign}${b.calibration_error.toFixed(1)}pp vs predicted]`
            : '';
          return `  ${b.confidence_bucket}%: ${b.actual_win_rate.toFixed(1)}% WR (n=${b.sample_size})${calibNote}`;
        })
        .join('\n');

      // Describe floor movement direction and trigger
      let floorNote = `Suggested quality reference: ${suggestedThreshold}% (advisory, never a gate).`;
      if (evaluation.direction !== 'none' && evaluation.trigger_bucket != null) {
        const dirWord = evaluation.direction === 'up' ? 'raised' : 'relaxed';
        floorNote = `Suggested quality reference: ${suggestedThreshold}% (${dirWord} — ${evaluation.reason}).`;
      }

      return [
        `ALPHA SELF-CALIBRATION (advisory only — your minimum structural floor remains 50%):`,
        `Total completed trades: ${totalTrades}`,
        `Win rate by confidence band:`,
        bucketLines,
        floorNote,
        `An ACCEPTABLE setup (50-69%) with named structure and correct RR is always a valid trade.`
      ].join('\n');
    } catch {
      return null;
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private clampToRails(value: number): number {
    return Math.max(
      ADAPTIVE_FLOOR_RAILS.FLOOR_HARD_MIN,
      Math.min(ADAPTIVE_FLOOR_RAILS.FLOOR_HARD_MAX, value)
    );
  }

  private async getCalibrationBuckets(userId: string): Promise<CalibrationBucket[]> {
    const { data, error } = await supabase
      .from('alpha_confidence_calibration')
      .select('confidence_bucket, actual_win_rate, predicted_win_rate, sample_size, calibration_error')
      .eq('user_id', userId)
      .gte('sample_size', 1)
      .order('confidence_bucket', { ascending: true });

    if (error || !data) {
      return [];
    }

    return data.map(row => ({
      confidence_bucket: row.confidence_bucket,
      actual_win_rate: Number(row.actual_win_rate),
      predicted_win_rate: Number(row.predicted_win_rate),
      sample_size: row.sample_size,
      calibration_error: Number(row.calibration_error),
    }));
  }
}

export const alphaAdaptiveFloorService = new AlphaAdaptiveFloorService();
