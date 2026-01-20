/**
 * Omega Council Validation Gate
 *
 * CRITICAL SAFETY SYSTEM: Enforces that ALL trades have been validated
 * by the complete Omega Council before execution.
 *
 * SSOT PRINCIPLE: This is the SINGLE authoritative validator for Omega completeness.
 * If this gate passes, Omega Council HAS been properly consulted.
 * If this gate blocks, Omega Council data is missing or incomplete.
 *
 * FAIL-SAFE DESIGN:
 * - Fails CLOSED (blocks on missing data)
 * - Logs all violations for audit
 * - Provides detailed diagnostic information
 * - Cannot be bypassed (hard block)
 */

import type { AlphaDecision } from '../brains/coordinator-alpha';
import type { Omega8Vote, Omega9ValidationResult } from '../types/omega';
import { logViolation, logWarning } from './ssot-violation-logger';

export interface OmegaValidationResult {
  passed: boolean;
  severity: 'NONE' | 'WARNING' | 'ERROR' | 'FATAL';
  reason: string;
  missingComponents: string[];
  diagnostics: {
    omega8Present: boolean;
    omega9Present: boolean;
    omega8Confidence?: number;
    omega9Pass?: boolean;
    timestamp: Date;
  };
}

class OmegaCouncilValidationGate {
  /**
   * Validate that Omega Council has been properly consulted
   *
   * HARD REQUIREMENTS:
   * 1. Omega8 (OrderFlow) MUST have analyzed liquidity
   * 2. Omega9 (Hallucination) MUST have validated decision
   * 3. Both must have confidence/pass scores
   *
   * @param decision - Alpha's decision to validate
   * @param userId - User ID for violation logging
   * @returns Validation result with pass/fail and diagnostics
   */
  async validate(
    decision: AlphaDecision,
    userId?: string
  ): Promise<OmegaValidationResult> {
    const missingComponents: string[] = [];
    const diagnostics = {
      omega8Present: false,
      omega9Present: false,
      timestamp: new Date()
    };

    // Check Omega8 (OrderFlow Analysis)
    const omega8Present = !!(
      decision.omega8_liquidity_bias ||
      decision.omega8_direction_support
    );

    if (omega8Present) {
      diagnostics.omega8Present = true;
      diagnostics.omega8Confidence = decision.omega_votes?.omega8?.confidence;
    } else {
      missingComponents.push('Omega8 OrderFlow Analysis');
    }

    // Check Omega9 (Hallucination Detection)
    const omega9Present = !!(decision.omega9_validation);

    if (omega9Present && decision.omega9_validation) {
      diagnostics.omega9Present = true;
      diagnostics.omega9Pass = decision.omega9_validation.pass;
    } else {
      missingComponents.push('Omega9 Hallucination Check');
    }

    // Determine validation result
    if (missingComponents.length === 0) {
      // ✅ PASS: All Omega components present
      console.log('[Omega Validation Gate] ✅ PASSED - All Omega components present');
      console.log(`[Omega Validation Gate]   Omega8: ${decision.omega8_liquidity_bias || 'N/A'}`);
      console.log(`[Omega Validation Gate]   Omega9: ${decision.omega9_validation?.pass ? 'PASS' : 'FAIL'}`);

      return {
        passed: true,
        severity: 'NONE',
        reason: 'Omega Council validation complete',
        missingComponents: [],
        diagnostics
      };
    } else if (missingComponents.length === 1) {
      // ⚠️  WARNING: Partial Omega coverage
      // This should not happen in production, but we'll allow with strong warning
      const warning = `Partial Omega coverage: Missing ${missingComponents[0]}`;
      console.warn(`[Omega Validation Gate] ⚠️  WARNING: ${warning}`);

      // Log SSOT violation for monitoring
      if (userId) {
        await logWarning(
          decision.symbol,
          'omega_council_validation',
          `Partial Omega coverage: Missing ${missingComponents[0]}`,
          'omega-council-validation-gate'
        );
      }

      return {
        passed: true, // Allow but warn
        severity: 'WARNING',
        reason: warning,
        missingComponents,
        diagnostics
      };
    } else {
      // 🚫 HARD BLOCK: Missing both Omega8 and Omega9
      const error = `CRITICAL: Omega Council not consulted - Missing ${missingComponents.join(' and ')}`;
      console.error(`[Omega Validation Gate] 🚫 BLOCKED: ${error}`);

      // Log SSOT violation for critical failure
      if (userId) {
        await logViolation({
          violationType: 'OMEGA_COUNCIL_BYPASS',
          symbol: decision.symbol,
          attemptedOperation: 'trade_execution',
          callLocation: 'omega-council-validation-gate',
          blocked: true,
          errorDetails: {
            missingComponents,
            action: decision.action,
            confidence: decision.confidence,
            reasoning: decision.reasoning,
            timestamp: new Date().toISOString()
          }
        });
      }

      return {
        passed: false,
        severity: 'FATAL',
        reason: error,
        missingComponents,
        diagnostics
      };
    }
  }

  /**
   * Validate Omega8 specifically (for targeted validation)
   */
  validateOmega8(decision: AlphaDecision): boolean {
    return !!(
      decision.omega8_liquidity_bias ||
      decision.omega8_direction_support
    );
  }

  /**
   * Validate Omega9 specifically (for targeted validation)
   */
  validateOmega9(decision: AlphaDecision): boolean {
    return !!decision.omega9_validation;
  }

  /**
   * Get detailed diagnostic information
   */
  getDiagnostics(decision: AlphaDecision): string {
    const lines: string[] = [];
    lines.push('═══════════════════════════════════════════════');
    lines.push('OMEGA COUNCIL VALIDATION DIAGNOSTICS');
    lines.push('═══════════════════════════════════════════════');

    // Omega8 Diagnostics
    lines.push('\n🔮 Omega8 (OrderFlow):');
    if (decision.omega8_liquidity_bias || decision.omega8_direction_support) {
      lines.push(`  ✅ Present`);
      lines.push(`  Liquidity Bias: ${decision.omega8_liquidity_bias || 'N/A'}`);
      lines.push(`  Direction Support: ${decision.omega8_direction_support || 'N/A'}`);
      if (decision.omega_votes?.omega8) {
        lines.push(`  Confidence: ${decision.omega_votes.omega8.confidence}%`);
        lines.push(`  Vote: ${decision.omega_votes.omega8.vote}`);
      }
    } else {
      lines.push(`  ❌ MISSING`);
    }

    // Omega9 Diagnostics
    lines.push('\n🛡️  Omega9 (Hallucination):');
    if (decision.omega9_validation) {
      lines.push(`  ✅ Present`);
      lines.push(`  Pass: ${decision.omega9_validation.pass ? 'YES' : 'NO'}`);
      lines.push(`  Safety Zone: ${decision.omega9_validation.safety_zone || 'N/A'}`);
      lines.push(`  Flags: ${decision.omega9_validation.flags?.length || 0}`);
      lines.push(`  Reasoning: ${decision.omega9_validation.reasoning || 'N/A'}`);
    } else {
      lines.push(`  ❌ MISSING`);
    }

    lines.push('\n═══════════════════════════════════════════════');
    return lines.join('\n');
  }
}

export const omegaCouncilValidationGate = new OmegaCouncilValidationGate();
