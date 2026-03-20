/**
 * Confidence Calculation Engine - SSOT (Single Source of Truth)
 *
 * CCIP-GOVERNANCE-2026-03-20: PENALTY SYSTEM PERMANENTLY REMOVED
 *
 * Alpha's stated confidence IS the execution value. Period.
 * No domain authority may add to, subtract from, or multiply Alpha's confidence.
 * No penalties, no advisory adjustments, no reward bonuses that alter the number.
 *
 * This engine now exists solely to:
 * 1. Validate that Alpha's confidence is in the valid range (0-100)
 * 2. Apply the adaptive floor gate (pass/fail against session threshold)
 * 3. Write an audit trail row for governance dashboards
 *
 * What has been permanently removed:
 * - Domain penalty multipliers (RegimeOracle, EQS, Narrative, Adversarial, Session, Pattern)
 * - Reward bonuses (consensus, volatility, orderflow, session timing, structure)
 * - Platform streak modifiers
 * - Risk mode floors (HIGH/MEDIUM/LOW penalty caps)
 * - advisory_adjusted_confidence calculation
 * - applyDomainPenalties() method
 * - checkDomainIsolation() method
 * - ConfidenceModifier type exported for external use
 *
 * SSOT AUTHORITY CHAIN:
 * Alpha LLM → states confidence (0-100)
 * This engine → validates range, checks floor, logs audit row
 * Orchestrator → uses Alpha's confidence as-is for execution gating
 */

import { supabase } from '../lib/supabase';
import type { RiskMode } from '../config/timeframe-hierarchy';
import { ADAPTIVE_FLOOR_RAILS } from '../config/alpha-identity';

export interface ConfidenceCalculationInput {
  base_confidence: number;
  symbol: string;
  risk_mode: RiskMode;
  session_id?: string;
  trade_id?: string;
  user_id?: string;

  /**
   * Alpha's adaptive execution floor for this session.
   * Provided by alpha-adaptive-floor-service.ts after reading
   * goal_sessions.adaptive_confidence_floor.
   * Falls back to ADAPTIVE_FLOOR_RAILS.FLOOR_DEFAULT (60) when absent.
   * SSOT: alpha-identity.ts ADAPTIVE_FLOOR_RAILS defines the valid range.
   */
  adaptive_floor?: number;
}

export interface ConfidenceCalculationResult {
  base_confidence: number;
  final_confidence: number;
  execution_threshold: number;
  passes_threshold: boolean;
  is_degraded: boolean;
  degradation_reason?: string;
  audit_id?: string;
}

const EXECUTION_THRESHOLD_DEFAULT = ADAPTIVE_FLOOR_RAILS.FLOOR_DEFAULT;

class ConfidenceCalculationEngine {
  /**
   * MAIN ENTRY POINT: Validate Alpha's confidence and gate against adaptive floor.
   *
   * Alpha's base_confidence is returned unchanged as final_confidence.
   * No arithmetic is applied. No modifiers. No penalties. No rewards.
   */
  async calculateFinalConfidence(
    input: ConfidenceCalculationInput
  ): Promise<ConfidenceCalculationResult> {
    const auditId = crypto.randomUUID();

    const rawFloor = input.adaptive_floor ?? EXECUTION_THRESHOLD_DEFAULT;
    const executionThreshold = Math.max(
      ADAPTIVE_FLOOR_RAILS.FLOOR_HARD_MIN,
      Math.min(ADAPTIVE_FLOOR_RAILS.FLOOR_HARD_MAX, rawFloor)
    );

    if (input.base_confidence < 0 || input.base_confidence > 100) {
      console.error(
        `[ConfidenceEngine] Invalid base confidence: ${input.base_confidence}. Must be 0-100.`
      );
      return {
        base_confidence: input.base_confidence,
        final_confidence: 0,
        execution_threshold: executionThreshold,
        passes_threshold: false,
        is_degraded: true,
        degradation_reason: 'Invalid base confidence input — must be 0-100',
        audit_id: auditId
      };
    }

    const finalConfidence = input.base_confidence;
    const passesThreshold = finalConfidence >= executionThreshold;

    const result: ConfidenceCalculationResult = {
      base_confidence: input.base_confidence,
      final_confidence: finalConfidence,
      execution_threshold: executionThreshold,
      passes_threshold: passesThreshold,
      is_degraded: false,
      audit_id: auditId
    };

    this.logToAuditTrail(input, result).catch(err =>
      console.warn('[ConfidenceEngine] Audit log failed (non-blocking):', err)
    );

    console.log(
      `[ConfidenceEngine] Alpha confidence=${finalConfidence} | floor=${executionThreshold} | ${passesThreshold ? 'PASS' : 'BLOCK'}`
    );

    return result;
  }

  /**
   * Log calculation to audit trail for governance compliance.
   * Non-blocking. Failure does not affect execution.
   */
  private async logToAuditTrail(
    input: ConfidenceCalculationInput,
    result: ConfidenceCalculationResult
  ): Promise<void> {
    try {
      if (!input.user_id) return;

      await supabase.from('confidence_calculation_audit').insert({
        trade_id: input.trade_id,
        session_id: input.session_id,
        base_confidence_value: result.base_confidence,
        total_reward_bonus: 0,
        eqs_penalty: 0,
        narrative_penalty: 0,
        regime_oracle_penalty: 0,
        regime_oracle_ceiling: 0,
        adversarial_penalty: 0,
        session_advisory_penalty: 0,
        penalty_isolation_check: true,
        pre_cap_confidence: result.final_confidence,
        risk_mode_floor: 0,
        post_risk_mode_cap: result.final_confidence,
        final_clamped_confidence: result.final_confidence,
        execution_threshold: result.execution_threshold,
        passes_threshold: result.passes_threshold,
        execution_decision: result.passes_threshold ? 'EXECUTE' : 'WAIT',
        governance_compliant: true,
        ccip_phase: 'alpha_sovereignty_complete_2026_03_20',
        audit_notes: 'No penalties applied. Alpha confidence is execution value.',
        user_id: input.user_id
      });
    } catch {
      // Non-blocking
    }
  }
}

export const confidenceCalculationEngine = new ConfidenceCalculationEngine();
