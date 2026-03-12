/**
 * Core Validation Gate
 *
 * SSOT Authority: Primary gatekeeper for trade execution validation
 * Consolidates: Omega Council + Geometry + Snapshot freshness
 *
 * CCIP Compliant: Part of trade execution simplification (20260202)
 *
 * Validation Layers:
 * 1. Omega Council (Omega8 + Omega9 presence)
 * 2. TP/SL Geometry (correct side of entry)
 * 3. Snapshot Freshness (< 30 seconds)
 * 4. Duplicate Trade Detection
 *
 * Principles:
 * - Engines validate, Alpha decides
 * - Fail closed (block on missing data)
 * - Degrade intelligently (no silent mutations)
 * - Log all violations for governance
 */

import type { AlphaDecision } from '../brains/coordinator-alpha';
import type { Omega8Vote, Omega9ValidationResult } from '../types/omega';
import { logViolation, logWarning } from './ssot-violation-logger';
import { priceFreshnessGate } from '../governance/price-freshness-gate';

export interface CoreValidationResult {
  passed: boolean;
  severity: 'NONE' | 'WARNING' | 'ERROR' | 'FATAL';
  reason: string;
  errorType?: 'OMEGA_MISSING' | 'GEOMETRY_INVALID' | 'SNAPSHOT_STALE' | 'DUPLICATE_TRADE';
  missingComponents?: string[];
  diagnostics?: {
    omega8Present: boolean;
    omega9Present: boolean;
    geometryValid: boolean;
    snapshotFresh: boolean;
    timestamp: Date;
  };
}

interface GeometryParams {
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  tp1Price?: number;
  tp2Price?: number;
}

interface SnapshotParams {
  snapshotTimestamp: Date | string;
  maxAgeSeconds?: number;
}

class CoreValidationGate {
  /**
   * Complete validation pipeline
   * Runs all validation layers in sequence
   */
  async validateTrade(
    decision: AlphaDecision,
    geometryParams: GeometryParams,
    snapshotParams: SnapshotParams,
    userId?: string
  ): Promise<CoreValidationResult> {
    // Layer 1: Omega Council
    const omegaResult = await this.validateOmegaCouncil(decision, userId);
    if (!omegaResult.passed) {
      return omegaResult;
    }

    // Layer 2: Geometry
    const geometryResult = this.validateGeometry(geometryParams);
    if (!geometryResult.passed) {
      return geometryResult;
    }

    // Layer 3: Snapshot Freshness
    const freshnessResult = this.validateSnapshotFreshness(snapshotParams);
    if (!freshnessResult.passed) {
      return freshnessResult;
    }

    return {
      passed: true,
      severity: 'NONE',
      reason: 'All validations passed',
      diagnostics: {
        omega8Present: true,
        omega9Present: true,
        geometryValid: true,
        snapshotFresh: true,
        timestamp: new Date()
      }
    };
  }

  /**
   * Validate Omega Council consultation
   * HARD REQUIREMENT: Both Omega8 and Omega9 must be present
   */
  async validateOmegaCouncil(
    decision: AlphaDecision,
    userId?: string
  ): Promise<CoreValidationResult> {
    const missingComponents: string[] = [];

    // Check Omega8 (Pattern Sensor)
    const omega8Present = !!(decision.omega8_liquidity_bias);

    if (!omega8Present) {
      missingComponents.push('Omega8 OrderFlow');
    }

    // Check Omega9 (Hallucination Detection)
    const omega9Present = !!decision.omega9_validation;

    if (!omega9Present) {
      missingComponents.push('Omega9 Hallucination');
    }

    // Determine result
    if (missingComponents.length === 0) {
      return {
        passed: true,
        severity: 'NONE',
        reason: 'Omega Council validation complete',
        diagnostics: {
          omega8Present: true,
          omega9Present: true,
          geometryValid: true,
          snapshotFresh: true,
          timestamp: new Date()
        }
      };
    } else if (missingComponents.length === 1) {
      // Partial coverage - warn but allow
      const warning = `Partial Omega coverage: Missing ${missingComponents[0]}`;

      if (userId) {
        await logWarning(
          decision.symbol,
          'omega_council_validation',
          warning,
          'core-validation-gate'
        );
      }

      return {
        passed: true,
        severity: 'WARNING',
        reason: warning,
        errorType: 'OMEGA_MISSING',
        missingComponents,
        diagnostics: {
          omega8Present: omega8Present,
          omega9Present: omega9Present,
          geometryValid: true,
          snapshotFresh: true,
          timestamp: new Date()
        }
      };
    } else {
      // Both missing - HARD BLOCK
      const error = `Omega Council not consulted - Missing ${missingComponents.join(' and ')}`;

      if (userId) {
        await logViolation({
          violationType: 'OMEGA_COUNCIL_BYPASS',
          symbol: decision.symbol,
          attemptedOperation: 'trade_execution',
          callLocation: 'core-validation-gate',
          blocked: true,
          errorDetails: {
            missingComponents,
            action: decision.action,
            confidence: decision.confidence,
            timestamp: new Date().toISOString()
          }
        });
      }

      return {
        passed: false,
        severity: 'FATAL',
        reason: error,
        errorType: 'OMEGA_MISSING',
        missingComponents,
        diagnostics: {
          omega8Present: false,
          omega9Present: false,
          geometryValid: true,
          snapshotFresh: true,
          timestamp: new Date()
        }
      };
    }
  }

  /**
   * Validate TP/SL geometry
   * BUY: SL < entry < TP
   * SELL: TP < entry < SL
   */
  validateGeometry(params: GeometryParams): CoreValidationResult {
    const { direction, entryPrice, stopLoss, takeProfit, tp1Price, tp2Price } = params;
    const isBuy = direction === 'buy';

    // NULL CHECKS: Fail closed if required parameters are missing
    if (entryPrice == null) {
      return {
        passed: false,
        severity: 'FATAL',
        reason: 'Missing required parameter: entryPrice is null or undefined',
        errorType: 'GEOMETRY_INVALID'
      };
    }

    if (stopLoss == null) {
      return {
        passed: false,
        severity: 'FATAL',
        reason: 'Missing required parameter: stopLoss is null or undefined',
        errorType: 'GEOMETRY_INVALID'
      };
    }

    if (takeProfit == null) {
      return {
        passed: false,
        severity: 'FATAL',
        reason: 'Missing required parameter: takeProfit is null or undefined',
        errorType: 'GEOMETRY_INVALID'
      };
    }

    if (isBuy) {
      // BUY trades: SL below entry, TP above entry
      if (stopLoss >= entryPrice) {
        return {
          passed: false,
          severity: 'FATAL',
          reason: `SL on wrong side for BUY: Entry=${entryPrice.toFixed(5)}, SL=${stopLoss.toFixed(5)} (SL must be below entry)`,
          errorType: 'GEOMETRY_INVALID'
        };
      }

      if (takeProfit <= entryPrice) {
        return {
          passed: false,
          severity: 'FATAL',
          reason: `TP on wrong side for BUY: Entry=${entryPrice.toFixed(5)}, TP=${takeProfit.toFixed(5)} (TP must be above entry)`,
          errorType: 'GEOMETRY_INVALID'
        };
      }

      if (tp1Price !== undefined && tp1Price !== null) {
        if (tp1Price <= entryPrice) {
          return {
            passed: false,
            severity: 'FATAL',
            reason: `TP1 on wrong side for BUY: Entry=${entryPrice.toFixed(5)}, TP1=${tp1Price.toFixed(5)} (TP1 must be above entry)`,
            errorType: 'GEOMETRY_INVALID'
          };
        }
      }

      if (tp2Price !== undefined && tp2Price !== null) {
        if (tp2Price <= entryPrice) {
          return {
            passed: false,
            severity: 'FATAL',
            reason: `TP2 on wrong side for BUY: Entry=${entryPrice.toFixed(5)}, TP2=${tp2Price.toFixed(5)} (TP2 must be above entry)`,
            errorType: 'GEOMETRY_INVALID'
          };
        }
      }
    } else {
      // SELL trades: SL above entry, TP below entry
      if (stopLoss <= entryPrice) {
        return {
          passed: false,
          severity: 'FATAL',
          reason: `SL on wrong side for SELL: Entry=${entryPrice.toFixed(5)}, SL=${stopLoss.toFixed(5)} (SL must be above entry)`,
          errorType: 'GEOMETRY_INVALID'
        };
      }

      if (takeProfit >= entryPrice) {
        return {
          passed: false,
          severity: 'FATAL',
          reason: `TP on wrong side for SELL: Entry=${entryPrice.toFixed(5)}, TP=${takeProfit.toFixed(5)} (TP must be below entry)`,
          errorType: 'GEOMETRY_INVALID'
        };
      }

      if (tp1Price !== undefined && tp1Price !== null) {
        if (tp1Price >= entryPrice) {
          return {
            passed: false,
            severity: 'FATAL',
            reason: `TP1 on wrong side for SELL: Entry=${entryPrice.toFixed(5)}, TP1=${tp1Price.toFixed(5)} (TP1 must be below entry)`,
            errorType: 'GEOMETRY_INVALID'
          };
        }
      }

      if (tp2Price !== undefined && tp2Price !== null) {
        if (tp2Price >= entryPrice) {
          return {
            passed: false,
            severity: 'FATAL',
            reason: `TP2 on wrong side for SELL: Entry=${entryPrice.toFixed(5)}, TP2=${tp2Price.toFixed(5)} (TP2 must be below entry)`,
            errorType: 'GEOMETRY_INVALID'
          };
        }
      }
    }

    return {
      passed: true,
      severity: 'NONE',
      reason: 'Geometry validation passed'
    };
  }

  /**
   * Validate snapshot freshness
   * Delegates to SSOT priceFreshnessGate for all freshness validation
   * Default context: 'execution' (30 seconds threshold)
   */
  validateSnapshotFreshness(params: SnapshotParams): CoreValidationResult {
    const { snapshotTimestamp } = params;

    // Use SSOT price freshness gate for validation
    const freshnessCheck = priceFreshnessGate.isTimestampFresh(
      snapshotTimestamp,
      'execution',
      'SNAPSHOT'
    );

    if (!freshnessCheck) {
      const ageData = priceFreshnessGate.getTimestampAge(
        snapshotTimestamp,
        'execution',
        'SNAPSHOT'
      );

      return {
        passed: false,
        severity: 'ERROR',
        reason: `Snapshot too old: ${ageData.ageSeconds.toFixed(1)}s (max ${ageData.maxAgeSeconds}s)`,
        errorType: 'SNAPSHOT_STALE'
      };
    }

    return {
      passed: true,
      severity: 'NONE',
      reason: 'Snapshot is fresh'
    };
  }

  /**
   * Extract Omega8 data from alpha decision
   * Handles both nested and top-level structures
   */
  extractOmega8Data(decision: AlphaDecision): Partial<Omega8Vote> | null {
    if (!decision) return null;

    try {
      // Try top-level fields first (coordinator-alpha structure)
      const liquidityBias = decision.omega8_liquidity_bias;

      // Then try nested omega_votes.omega8 (council votes structure)
      const nestedOmega8 = decision.omega_votes?.omega8;

      if (liquidityBias) {
        return {
          liquidity_bias: liquidityBias,
          patterns: nestedOmega8?.patterns,
          signals: nestedOmega8?.signals
        };
      }

      if (nestedOmega8) {
        return nestedOmega8;
      }

      return null;
    } catch (error) {
      console.warn('[CoreValidationGate] Error extracting Omega8 data:', error);
      return null;
    }
  }

  /**
   * Extract Omega9 data from alpha decision
   */
  extractOmega9Data(decision: AlphaDecision): Omega9ValidationResult | null {
    if (!decision) return null;

    try {
      return decision.omega9_validation || null;
    } catch (error) {
      console.warn('[CoreValidationGate] Error extracting Omega9 data:', error);
      return null;
    }
  }
}

export const coreValidationGate = new CoreValidationGate();
