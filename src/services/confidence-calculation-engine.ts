/**
 * Confidence Calculation Engine - SSOT (Single Source of Truth)
 *
 * ADVISORY-ONLY confidence analytics engine.
 * Alpha is the SOLE trade authority within arena walls.
 *
 * CCIP 2026-02-17: ARCHITECTURAL CORRECTION
 * All domain penalties (adversarial, regime, session, etc.) are ADVISORY ONLY.
 * They are calculated, logged, and audited for monitoring/dashboards,
 * but they do NOT reduce Alpha's execution confidence.
 * Alpha's raw confidence + rewards = final execution confidence.
 * Penalties cannot veto Alpha's trade decisions.
 *
 * Confidence Flow:
 * 1. Base Confidence (Alpha's raw decision)
 * 2. + Rewards (additive bonuses for alignment, optimal conditions)
 * 3. = Final Execution Confidence (used for threshold gating)
 * 4. Advisory penalties calculated and logged (monitoring only)
 * 5. Execute if final >= threshold (default 60%)
 *
 * Domain Authorities (ADVISORY, logged for analytics):
 * - RegimeOracle: volatility, session effects, spread risk (0-15%)
 * - EQS: entry quality signal (0-15%, soft)
 * - Narrative: coherence penalty (0-12%)
 * - AdversarialDetector: manipulation & sweep risk (0-10%)
 * - SessionAdvisor: time-based warnings + fill-time ratio (0-15%)
 * - PatternConfidence: technical setup quality (+-5%)
 */

import { supabase } from '../lib/supabase';
import type { RiskMode } from '../config/timeframe-hierarchy';
import { ADAPTIVE_FLOOR_RAILS } from '../config/alpha-identity';

export interface ConfidenceModifier {
  domain: string;
  domain_owner: string;
  penalty_type: 'additive' | 'multiplicative';
  value: number;
  reason: string;
  source_file: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

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

  /**
   * Platform streak confidence modifier (-5 to +5).
   * Source: alpha_platform_score singleton row via rewardEngine.loadPlatformScore().
   * Applied additively after rewards: afterRewards + platform_streak_modifier.
   * SSOT: ai-identity.ts getPlatformStreakModifier() owns the lookup table.
   */
  platform_streak_modifier?: number;

  // Modifiers from each domain authority
  rewards?: {
    consensus_bonus?: number;
    optimal_volatility_bonus?: number;
    clean_orderflow_bonus?: number;
    session_timing_bonus?: number;
    market_structure_bonus?: number;
  };

  modifiers?: ConfidenceModifier[];
}

export interface ConfidenceCalculationResult {
  base_confidence: number;
  total_rewards: number;
  after_rewards: number;

  // Penalty breakdown (audit trail)
  regime_oracle_penalty: number;
  eqs_penalty: number;
  narrative_penalty: number;
  adversarial_penalty: number;
  session_advisory_penalty: number;
  pattern_confidence_penalty: number;

  // Modifiers applied
  all_modifiers: ConfidenceModifier[];
  isolated_domains: string[];
  domain_violations: string[];

  // Final calculation
  pre_cap_confidence: number;
  risk_mode_floor: number;
  advisory_adjusted_confidence: number;
  final_confidence: number;
  execution_threshold: number;
  passes_threshold: boolean;

  // Degradation tracking
  degradation_reason?: string;
  is_degraded: boolean;
  audit_id?: string;
}

interface RiskModeFloor {
  HIGH: number;
  MEDIUM: number;
  LOW: number;
}

const RISK_MODE_FLOORS: RiskModeFloor = {
  HIGH: 0.5,    // -50% penalty cap for aggressive traders
  MEDIUM: 0.6,  // -40% penalty cap for balanced traders
  LOW: 0.7      // -30% penalty cap for conservative traders
};

const EXECUTION_THRESHOLD_DEFAULT = ADAPTIVE_FLOOR_RAILS.FLOOR_DEFAULT;

const DOMAIN_AUTHORITIES = {
  REGIME_ORACLE: { name: 'RegimeOracle', max_penalty: 0.15 },
  EQS: { name: 'EQS Quality Gate', max_penalty: 0.15 },
  NARRATIVE: { name: 'Narrative Validator', max_penalty: 0.12 },
  ADVERSARIAL: { name: 'Adversarial Detector', max_penalty: 0.1 },
  SESSION_ADVISOR: { name: 'Session Advisor', max_penalty: 0.15 },
  PATTERN_CONFIDENCE: { name: 'Pattern Confidence', max_penalty: 0.1 }
};

class ConfidenceCalculationEngine {
  /**
   * MAIN ENTRY POINT: Calculate final confidence with full audit trail
   *
   * This is the ONLY place confidence is adjusted in production.
   * All calls to change confidence must route through this engine.
   */
  async calculateFinalConfidence(
    input: ConfidenceCalculationInput
  ): Promise<ConfidenceCalculationResult> {
    const startTime = Date.now();
    const auditId = crypto.randomUUID();

    // Resolve adaptive floor: caller passes the session's current adaptive_confidence_floor.
    // Hard rails are enforced here as a final safeguard against misconfigured callers.
    const rawFloor = input.adaptive_floor ?? EXECUTION_THRESHOLD_DEFAULT;
    const executionThreshold = Math.max(
      ADAPTIVE_FLOOR_RAILS.FLOOR_HARD_MIN,
      Math.min(ADAPTIVE_FLOOR_RAILS.FLOOR_HARD_MAX, rawFloor)
    );

    try {
      // PHASE 1: Validate inputs
      if (input.base_confidence < 0 || input.base_confidence > 100) {
        console.error(
          `[ConfidenceEngine] 🚫 Invalid base confidence: ${input.base_confidence}. Must be 0-100.`
        );
        return this.createDegradedResult(
          input.base_confidence,
          'Invalid base confidence input',
          auditId
        );
      }

      // PHASE 2: Apply rewards (additive, clamped to 100)
      // Include platform streak modifier (-5 to +5) as an additive reward.
      // This is the ONE mechanical effect of the platform score on execution confidence.
      const platformStreakModifier = input.platform_streak_modifier ?? 0;
      const totalRewards = this.calculateTotalRewards(input.rewards || {}) + platformStreakModifier;
      const afterRewards = Math.min(100, Math.max(0, input.base_confidence + totalRewards));

      // PHASE 3: Apply penalties with domain isolation
      const penaltyResult = this.applyDomainPenalties(
        afterRewards,
        input.modifiers || [],
        input.symbol
      );

      // PHASE 4: Check for domain violations (no double-counting)
      const domainViolations = this.checkDomainIsolation(
        penaltyResult.all_modifiers,
        penaltyResult.domains_applied
      );

      if (domainViolations.length > 0) {
        console.warn(
          `[ConfidenceEngine] ⚠️ Domain isolation violations detected:`,
          domainViolations
        );
      }

      // PHASE 5: Calculate advisory-adjusted confidence (for analytics/dashboards only)
      // CCIP 2026-02-17: Penalties are ADVISORY ONLY -- they do NOT reduce Alpha's
      // execution confidence. Alpha is the sole trade authority within arena walls.
      // Advisory penalties are logged for monitoring but cannot veto Alpha's decisions.
      const riskModeFloor = RISK_MODE_FLOORS[input.risk_mode] || 0.6;
      const advisoryMultiplier = Math.max(riskModeFloor, penaltyResult.final_multiplier);
      const advisoryAdjustedConfidence = Math.max(0, Math.min(100, Math.round(afterRewards * advisoryMultiplier)));

      // PHASE 6: Final confidence = Alpha's confidence + rewards (NO penalty reduction)
      // Alpha's raw confidence is the execution-gating value. Penalties inform, not override.
      const finalConfidence = Math.max(0, Math.min(100, Math.round(afterRewards)));

      // PHASE 7: Determine if penalties WOULD HAVE degraded (for monitoring)
      const isDegraded = this.isDegraded(input.base_confidence, advisoryAdjustedConfidence);

      const result: ConfidenceCalculationResult = {
        base_confidence: input.base_confidence,
        total_rewards: totalRewards,
        after_rewards: afterRewards,

        regime_oracle_penalty: penaltyResult.regime_oracle_penalty,
        eqs_penalty: penaltyResult.eqs_penalty,
        narrative_penalty: penaltyResult.narrative_penalty,
        adversarial_penalty: penaltyResult.adversarial_penalty,
        session_advisory_penalty: penaltyResult.session_advisory_penalty,
        pattern_confidence_penalty: penaltyResult.pattern_confidence_penalty,

        all_modifiers: penaltyResult.all_modifiers,
        isolated_domains: penaltyResult.domains_applied,
        domain_violations: domainViolations,

        pre_cap_confidence: Math.round(afterRewards * advisoryMultiplier),
        risk_mode_floor: riskModeFloor,
        advisory_adjusted_confidence: advisoryAdjustedConfidence,
        final_confidence: finalConfidence,
        execution_threshold: executionThreshold,
        passes_threshold: finalConfidence >= executionThreshold,

        degradation_reason: isDegraded ? penaltyResult.degradation_reason : undefined,
        is_degraded: isDegraded,
        audit_id: auditId
      };

      // PHASE 8: Log to audit trail (async, non-blocking)
      this.logToAuditTrail(input, result).catch(err =>
        console.error('[ConfidenceEngine] Failed to log audit:', err)
      );

      console.log(
        `[ConfidenceEngine] Confidence Calculation Complete (${Date.now() - startTime}ms)`,
        {
          base: input.base_confidence,
          platform_streak_modifier: platformStreakModifier !== 0 ? platformStreakModifier : undefined,
          rewards: totalRewards,
          after_rewards: afterRewards,
          advisory_penalties: {
            regime: -penaltyResult.regime_oracle_penalty * 100,
            eqs: -penaltyResult.eqs_penalty * 100,
            narrative: -penaltyResult.narrative_penalty * 100,
            adversarial: -penaltyResult.adversarial_penalty * 100,
            session: -penaltyResult.session_advisory_penalty * 100,
            pattern: -penaltyResult.pattern_confidence_penalty * 100,
          },
          advisory_adjusted: advisoryAdjustedConfidence,
          final_execution: finalConfidence,
          passes: result.passes_threshold ? 'YES' : 'NO',
          advisory_would_degrade: isDegraded ? 'YES' : 'NO',
          audit_id: auditId.substring(0, 8)
        }
      );

      return result;
    } catch (error) {
      console.error('[ConfidenceEngine] 🚫 CRITICAL ERROR:', error);
      return this.createDegradedResult(
        input.base_confidence,
        `Critical error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        auditId
      );
    }
  }

  /**
   * Calculate total reward bonuses (additive)
   * Capped at 100 to prevent over-inflation
   */
  private calculateTotalRewards(rewards: {
    consensus_bonus?: number;
    optimal_volatility_bonus?: number;
    clean_orderflow_bonus?: number;
    session_timing_bonus?: number;
    market_structure_bonus?: number;
  }): number {
    const total =
      (rewards.consensus_bonus || 0) +
      (rewards.optimal_volatility_bonus || 0) +
      (rewards.clean_orderflow_bonus || 0) +
      (rewards.session_timing_bonus || 0) +
      (rewards.market_structure_bonus || 0);

    // Cap total rewards at 15% to prevent excessive boosts
    return Math.min(15, Math.max(0, total));
  }

  /**
   * Apply penalties from each domain authority
   * CRITICAL: Each domain applies ONLY ONE penalty (no double-counting)
   */
  private applyDomainPenalties(
    confidence: number,
    modifiers: ConfidenceModifier[],
    symbol: string
  ): {
    final_multiplier: number;
    all_modifiers: ConfidenceModifier[];
    domains_applied: string[];
    regime_oracle_penalty: number;
    eqs_penalty: number;
    narrative_penalty: number;
    adversarial_penalty: number;
    session_advisory_penalty: number;
    pattern_confidence_penalty: number;
    degradation_reason: string;
  } {
    const domainPenalties: Record<string, number> = {
      regime_oracle: 0,
      eqs: 0,
      narrative: 0,
      adversarial: 0,
      session_advisor: 0,
      pattern_confidence: 0
    };

    const appliedModifiers: ConfidenceModifier[] = [];
    const domainsApplied = new Set<string>();

    // Group modifiers by domain
    const modifiersByDomain: Record<string, ConfidenceModifier[]> = {};
    for (const modifier of modifiers) {
      const domain = modifier.domain.toLowerCase();
      if (!modifiersByDomain[domain]) {
        modifiersByDomain[domain] = [];
      }
      modifiersByDomain[domain].push(modifier);
    }

    // For each domain, take the WORST penalty (no stacking)
    for (const domain in modifiersByDomain) {
      const domainModifiers = modifiersByDomain[domain];
      if (domainModifiers.length === 0) continue;

      // Sort by absolute value (worst first)
      const sorted = domainModifiers.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      const worstModifier = sorted[0];

      // Clamp to domain max
      const authority = DOMAIN_AUTHORITIES[domain.toUpperCase() as keyof typeof DOMAIN_AUTHORITIES];
      if (!authority) {
        console.warn(`[ConfidenceEngine] Unknown domain: ${domain}`);
        continue;
      }

      const clampedPenalty = Math.min(
        Math.abs(worstModifier.value),
        authority.max_penalty
      );

      domainPenalties[domain] = clampedPenalty;
      appliedModifiers.push({
        ...worstModifier,
        value: clampedPenalty
      });
      domainsApplied.add(domain);

      // Log if multiple modifiers were proposed (only worst applied)
      if (domainModifiers.length > 1) {
        console.log(
          `[ConfidenceEngine] Domain '${domain}' had ${domainModifiers.length} modifiers, applying worst: ${clampedPenalty * 100}%`
        );
      }
    }

    // Calculate final multiplier (product of all domain multipliers)
    let finalMultiplier = 1.0;
    for (const penalty of Object.values(domainPenalties)) {
      finalMultiplier *= (1 - penalty);
    }

    // Determine degradation reason
    let degradationReason = '';
    if (confidence * finalMultiplier < confidence * 0.7) {
      // More than 30% penalty applied
      const heavyDomains = Object.entries(domainPenalties)
        .filter(([_, penalty]) => penalty > 0.08)
        .map(([domain, penalty]) => `${domain} (-${Math.round(penalty * 100)}%)`);
      degradationReason = `High penalties from: ${heavyDomains.join(', ')}`;
    }

    return {
      final_multiplier: finalMultiplier,
      all_modifiers: appliedModifiers,
      domains_applied: Array.from(domainsApplied),
      regime_oracle_penalty: domainPenalties.regime_oracle,
      eqs_penalty: domainPenalties.eqs,
      narrative_penalty: domainPenalties.narrative,
      adversarial_penalty: domainPenalties.adversarial,
      session_advisory_penalty: domainPenalties.session_advisor,
      pattern_confidence_penalty: domainPenalties.pattern_confidence,
      degradation_reason: degradationReason
    };
  }

  /**
   * Check for domain isolation violations (same domain applying multiple penalties)
   */
  private checkDomainIsolation(
    appliedModifiers: ConfidenceModifier[],
    domainsApplied: string[]
  ): string[] {
    const domainCounts: Record<string, number> = {};
    for (const modifier of appliedModifiers) {
      const domain = modifier.domain.toLowerCase();
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    }

    const violations: string[] = [];
    for (const [domain, count] of Object.entries(domainCounts)) {
      if (count > 1) {
        violations.push(
          `Domain '${domain}' applied ${count} penalties (should be 1 max)`
        );
      }
    }

    return violations;
  }

  /**
   * Determine if confidence was degraded significantly
   */
  private isDegraded(base: number, final: number): boolean {
    // Degraded if more than 20% penalty applied
    return final < base * 0.8;
  }

  /**
   * Create a degraded result (when calculation fails or inputs invalid)
   */
  private createDegradedResult(
    baseConfidence: number,
    reason: string,
    auditId: string
  ): ConfidenceCalculationResult {
    const degradedConfidence = Math.max(0, baseConfidence * 0.5);

    return {
      base_confidence: baseConfidence,
      total_rewards: 0,
      after_rewards: baseConfidence,
      regime_oracle_penalty: 0,
      eqs_penalty: 0,
      narrative_penalty: 0,
      adversarial_penalty: 0,
      session_advisory_penalty: 0,
      pattern_confidence_penalty: 0,
      all_modifiers: [],
      isolated_domains: [],
      domain_violations: [],
      pre_cap_confidence: degradedConfidence,
      risk_mode_floor: 0.5,
      advisory_adjusted_confidence: degradedConfidence,
      final_confidence: degradedConfidence,
      execution_threshold: EXECUTION_THRESHOLD_DEFAULT,
      passes_threshold: false,
      degradation_reason: reason,
      is_degraded: true,
      audit_id: auditId
    };
  }

  /**
   * Log calculation to audit trail for governance compliance
   */
  private async logToAuditTrail(
    input: ConfidenceCalculationInput,
    result: ConfidenceCalculationResult
  ): Promise<void> {
    try {
      // Only log if user_id available (required for RLS)
      if (!input.user_id) return;

      await supabase.from('confidence_calculation_audit').insert({
        trade_id: input.trade_id,
        session_id: input.session_id,
        base_confidence_value: result.base_confidence,
        omega_votes_detail: { note: 'logged separately in omega_council_votes' },
        total_reward_bonus: result.total_rewards,
        reward_sources: { note: 'captured in modifiers' },
        eqs_penalty: result.eqs_penalty,
        narrative_penalty: result.narrative_penalty,
        regime_oracle_penalty: result.regime_oracle_penalty,
        regime_oracle_ceiling: 0.15,
        adversarial_penalty: result.adversarial_penalty,
        session_advisory_penalty: result.session_advisory_penalty,
        penalty_domain_owners: Object.fromEntries(
          result.all_modifiers.map(m => [m.domain, m.domain_owner])
        ),
        penalty_isolation_check: result.domain_violations.length === 0,
        pre_cap_confidence: result.pre_cap_confidence,
        risk_mode_floor: result.risk_mode_floor,
        post_risk_mode_cap: result.advisory_adjusted_confidence,
        final_clamped_confidence: result.final_confidence,
        execution_threshold: result.execution_threshold,
        passes_threshold: result.passes_threshold,
        execution_decision: result.passes_threshold ? 'EXECUTE' : 'WAIT',
        governance_compliant: result.domain_violations.length === 0,
        ccip_phase: 'staged_deployment',
        audit_notes: input.adaptive_floor !== undefined
          ? `adaptive_floor=${input.adaptive_floor} | ${result.degradation_reason || 'No degradation'}`
          : result.degradation_reason || 'No degradation',
        user_id: input.user_id
      });
    } catch (error) {
      // Non-blocking audit failure
      console.warn('[ConfidenceEngine] Could not log to audit trail:', error);
    }
  }
}

export const confidenceCalculationEngine = new ConfidenceCalculationEngine();
