/**
 * PCPE Execution Governor - SSOT for Confidence-Based Execution Viability
 *
 * PCPE v2.0 - Hardened Edition
 *
 * CRITICAL REQUIREMENTS:
 * 1. Must run AFTER zones are calculated (needs zone_type and distance)
 * 2. Must receive final effective confidence (post-penalty, not raw Alpha confidence)
 * 3. Must apply distance-to-ATR reachability gates
 * 4. Must evaluate chase zone viability with regime-specific logic
 *
 * Three-layer governance:
 * - Layer 1: Confidence band classification (FULL/REDUCED/MICRO/BLOCKED)
 * - Layer 2: Distance-to-ATR reachability gates (auto-downgrade)
 * - Layer 3: Chase zone viability (regime-specific professional logic)
 *
 * Transforms PCPE from "confidence lookup table" into real execution viability governor.
 */

import { PCPE_CONFIG } from '../config/pcpe-config';
import { logger } from '../lib/logger';
import type {
  PCPEInput,
  PCPEResult,
  PCPEAudit,
  ExecutionBand,
  ZoneType,
  ReachabilityGateResult,
  ChaseViabilityResult,
} from '../types/pcpe';

/**
 * PCPE Execution Governor - Main Entry Point
 *
 * Evaluates execution viability and returns execution band, size multiplier,
 * zone permissions, and comprehensive audit trail.
 */
export function applyPCPE(inputs: PCPEInput): PCPEResult {
  const {
    final_effective_confidence,
    zone_type,
    distance_to_zone_pips,
    atr,
    spread,
    micro_regime,
    symbol,
  } = inputs;

  // Validate inputs
  if (final_effective_confidence < 0 || final_effective_confidence > 100) {
    logger.error(`[PCPE] Invalid confidence: ${final_effective_confidence}%. Must be 0-100.`);
    return createBlockedResult(inputs, 'INVALID_CONFIDENCE', 'Confidence out of valid range (0-100)');
  }

  if (atr <= 0) {
    logger.error(`[PCPE] Invalid ATR: ${atr}. Must be > 0.`);
    return createBlockedResult(inputs, 'INVALID_ATR', 'ATR must be positive');
  }

  logger.info(
    `[PCPE] Evaluating execution viability: ` +
    `conf=${final_effective_confidence.toFixed(1)}%, ` +
    `zone=${zone_type}, ` +
    `distance=${distance_to_zone_pips.toFixed(1)} pips, ` +
    `ATR=${atr.toFixed(1)}, ` +
    `regime=${micro_regime}`
  );

  // Step 1: Determine initial band from confidence
  const initialBand = classifyConfidenceBand(final_effective_confidence);
  let currentBand = initialBand;
  const downgradePath: ExecutionBand[] = [initialBand];

  logger.info(`[PCPE] Step 1: Confidence band = ${initialBand} (${final_effective_confidence.toFixed(1)}%)`);

  // Step 2: Apply distance-to-ATR reachability gates
  const reachabilityResult = applyReachabilityGates(currentBand, distance_to_zone_pips, atr);
  currentBand = reachabilityResult.band;

  if (reachabilityResult.downgraded) {
    downgradePath.push(currentBand);
    logger.info(
      `[PCPE] Step 2: Reachability downgrade ${initialBand} → ${currentBand}. ` +
      `Distance ${reachabilityResult.distance_check.distance_to_atr_ratio.toFixed(2)}x ATR ` +
      `exceeds ${reachabilityResult.distance_check.threshold.toFixed(2)}x threshold. ` +
      `Reason: ${reachabilityResult.downgrade_reason}`
    );
  } else {
    logger.info(
      `[PCPE] Step 2: Reachability check passed. ` +
      `Distance ${reachabilityResult.distance_check.distance_to_atr_ratio.toFixed(2)}x ATR ` +
      `within ${reachabilityResult.distance_check.threshold.toFixed(2)}x threshold.`
    );
  }

  // If already blocked by reachability, return early
  if (currentBand === 'BLOCKED') {
    return createBlockedResult(
      inputs,
      'UNREACHABLE_ZONE',
      `Zone unreachable: distance ${reachabilityResult.distance_check.distance_to_atr_ratio.toFixed(2)}x ATR exceeds threshold`,
      initialBand,
      downgradePath
    );
  }

  // Step 3: Evaluate chase zone viability (if applicable)
  if (zone_type === 'CHASE') {
    logger.info(`[PCPE] Step 3: Evaluating chase zone viability...`);
    const chaseResult = evaluateChaseZone(currentBand, micro_regime, spread, atr);

    if (chaseResult.blocked) {
      logger.warn(`[PCPE] Chase zone BLOCKED: ${chaseResult.reason}`);
      return createBlockedResult(
        inputs,
        'CHASE_ZONE_INVALID',
        chaseResult.reason,
        initialBand,
        downgradePath
      );
    }

    logger.info(`[PCPE] Step 3: Chase zone ALLOWED: ${chaseResult.reason}`);
  } else {
    logger.info(`[PCPE] Step 3: Not a chase zone, skipping chase viability check.`);
  }

  // Step 4: Return final execution parameters
  const sizeMultiplier = getBandMultiplier(currentBand);
  const zonePermissions = getBandPermissions(currentBand, zone_type);
  const downgradeApplied = initialBand !== currentBand;

  const result: PCPEResult = {
    execution_band: currentBand,
    size_multiplier: sizeMultiplier,
    zone_permissions: zonePermissions,
    original_band: downgradeApplied ? initialBand : undefined,
    downgrade_applied: downgradeApplied,
    downgrade_reason: reachabilityResult.downgrade_reason,
    audit: createAudit(inputs, currentBand, sizeMultiplier, initialBand, downgradePath),
    reasoning: generateReasoning(
      currentBand,
      initialBand,
      downgradeApplied,
      zone_type,
      reachabilityResult,
      final_effective_confidence
    ),
  };

  logger.info(
    `[PCPE] ✅ EXECUTION APPROVED: ` +
    `band=${currentBand}, ` +
    `multiplier=${sizeMultiplier}x, ` +
    `zones=[${zonePermissions.join(', ')}]` +
    (downgradeApplied ? `, downgraded from ${initialBand}` : '')
  );

  return result;
}

/**
 * Step 1: Classify confidence into execution band
 *
 * FULL: ≥78% confidence = 1.0x size
 * REDUCED: 68-77% confidence = 0.5x size
 * MICRO: 58-67% confidence = 0.25x size
 * BLOCKED: <58% confidence = 0x size
 */
function classifyConfidenceBand(confidence: number): ExecutionBand {
  const { thresholds } = PCPE_CONFIG;

  if (confidence >= thresholds.full_band) {
    return 'FULL';
  } else if (confidence >= thresholds.reduced_band) {
    return 'REDUCED';
  } else if (confidence >= thresholds.micro_band) {
    return 'MICRO';
  } else {
    return 'BLOCKED';
  }
}

/**
 * Step 2: Apply distance-to-ATR reachability gates
 *
 * Auto-downgrades bands if zone is too far from current price:
 * - FULL: distance > 1.2 × ATR → downgrade to REDUCED
 * - REDUCED: distance > 1.0 × ATR → downgrade to MICRO
 * - MICRO: distance > 1.0 × ATR → downgrade to BLOCKED (WAIT)
 *
 * Prevents "perfect trade, unreachable entry" problem.
 */
function applyReachabilityGates(
  band: ExecutionBand,
  distancePips: number,
  atr: number
): ReachabilityGateResult {
  const { reachability } = PCPE_CONFIG;

  // Calculate distance-to-ATR ratio
  const distanceToATRRatio = distancePips / atr;

  // Determine threshold for current band
  let threshold: number;
  let targetBand: ExecutionBand;

  switch (band) {
    case 'FULL':
      threshold = reachability.full_max_distance_atr;
      targetBand = 'REDUCED';
      break;
    case 'REDUCED':
      threshold = reachability.reduced_max_distance_atr;
      targetBand = 'MICRO';
      break;
    case 'MICRO':
      threshold = reachability.micro_max_distance_atr;
      targetBand = 'BLOCKED';
      break;
    case 'BLOCKED':
      // Already blocked, no downgrade possible
      return {
        band: 'BLOCKED',
        downgraded: false,
        distance_check: {
          distance_to_atr_ratio: distanceToATRRatio,
          threshold: 0,
          within_threshold: false,
        },
      };
  }

  // Check if within threshold
  const withinThreshold = distanceToATRRatio <= threshold;

  if (withinThreshold) {
    // No downgrade needed
    return {
      band,
      downgraded: false,
      distance_check: {
        distance_to_atr_ratio: distanceToATRRatio,
        threshold,
        within_threshold: true,
      },
    };
  } else {
    // Downgrade required
    return {
      band: targetBand,
      downgraded: true,
      downgrade_reason: `Distance ${distanceToATRRatio.toFixed(2)}x ATR exceeds ${band} band threshold of ${threshold.toFixed(2)}x`,
      distance_check: {
        distance_to_atr_ratio: distanceToATRRatio,
        threshold,
        within_threshold: false,
      },
    };
  }
}

/**
 * Step 3: Evaluate chase zone viability
 *
 * Chase entries are legitimate in momentum regimes but require:
 * - MICRO band only (0.25x size = reduced risk)
 * - Momentum-specific regime (Trend Acceleration, Liquidity Vacuum, Post-Break Retest)
 * - Economic validation (spread ≤ 30% of ATR)
 *
 * Blocks chase in mean reversion or neutral regimes.
 */
function evaluateChaseZone(
  band: ExecutionBand,
  microRegime: string,
  spread: number,
  atr: number
): ChaseViabilityResult {
  const { chase } = PCPE_CONFIG;

  // Check 1: Band must be MICRO
  if (band !== chase.required_band) {
    return {
      allowed: false,
      blocked: true,
      reason: `Chase entries require ${chase.required_band} band. Current band: ${band}. Chase with higher bands is too aggressive.`,
    };
  }

  // Check 2: Regime must be momentum-friendly
  const isValidRegime = chase.allowed_regimes.includes(microRegime);
  if (!isValidRegime) {
    return {
      allowed: false,
      blocked: true,
      reason: `Chase entries not permitted in '${microRegime}' regime. Allowed regimes: ${chase.allowed_regimes.join(', ')}.`,
    };
  }

  // Check 3: Spread economics must pass
  const spreadRatio = spread / atr;
  if (spreadRatio > chase.max_spread_ratio) {
    return {
      allowed: false,
      blocked: true,
      reason: `Spread too wide for chase entry: ${(spreadRatio * 100).toFixed(1)}% of ATR (max ${(chase.max_spread_ratio * 100).toFixed(0)}%).`,
    };
  }

  // All checks passed - chase allowed
  return {
    allowed: true,
    blocked: false,
    reason: `Chase entry permitted: ${microRegime} regime with MICRO band (0.25x size) and tight spread (${(spreadRatio * 100).toFixed(1)}% of ATR).`,
  };
}

/**
 * Get position size multiplier for execution band
 */
function getBandMultiplier(band: ExecutionBand): number {
  return PCPE_CONFIG.multipliers[band];
}

/**
 * Get permitted zones for execution band
 * Chase zone dynamically added if regime permits
 */
function getBandPermissions(band: ExecutionBand, currentZoneType: ZoneType): ZoneType[] {
  const basePermissions = [...PCPE_CONFIG.zone_permissions[band]];

  // If current zone is CHASE and we reached here, it means chase is allowed
  if (currentZoneType === 'CHASE' && band === 'MICRO') {
    basePermissions.push('CHASE');
  }

  return basePermissions;
}

/**
 * Create audit trail for PCPE decision
 */
function createAudit(
  inputs: PCPEInput,
  finalBand: ExecutionBand,
  sizeMultiplier: number,
  originalBand?: ExecutionBand,
  downgradePath?: ExecutionBand[]
): PCPEAudit {
  const distanceToATRRatio = inputs.distance_to_zone_pips / inputs.atr;

  return {
    timestamp: new Date().toISOString(),
    final_effective_confidence: inputs.final_effective_confidence,
    zone_type: inputs.zone_type,
    distance_to_zone_pips: inputs.distance_to_zone_pips,
    distance_to_atr_ratio: distanceToATRRatio,
    micro_regime: inputs.micro_regime,
    execution_band: finalBand,
    size_multiplier: sizeMultiplier,
    original_band: originalBand,
    downgrade_path: downgradePath ? downgradePath.join(' → ') : undefined,
  };
}

/**
 * Generate human-readable reasoning for PCPE decision
 */
function generateReasoning(
  finalBand: ExecutionBand,
  originalBand: ExecutionBand,
  downgradeApplied: boolean,
  zoneType: ZoneType,
  reachabilityResult: ReachabilityGateResult,
  confidence: number
): string {
  let reasoning = `Confidence ${confidence.toFixed(1)}% classified as ${originalBand} band. `;

  if (downgradeApplied) {
    reasoning += `Downgraded to ${finalBand} band due to reachability constraints: ${reachabilityResult.downgrade_reason}. `;
  } else {
    reasoning += `Reachability check passed (${reachabilityResult.distance_check.distance_to_atr_ratio.toFixed(2)}x ATR within ${reachabilityResult.distance_check.threshold.toFixed(2)}x threshold). `;
  }

  reasoning += `Executing ${zoneType} zone at ${PCPE_CONFIG.multipliers[finalBand]}x size.`;

  return reasoning;
}

/**
 * Create blocked result for invalid/failed executions
 */
function createBlockedResult(
  inputs: PCPEInput,
  blockReason: string,
  reasoning: string,
  originalBand?: ExecutionBand,
  downgradePath?: ExecutionBand[]
): PCPEResult {
  return {
    execution_band: 'BLOCKED',
    size_multiplier: 0,
    zone_permissions: [],
    block_reason: blockReason,
    original_band: originalBand,
    downgrade_applied: originalBand !== undefined && originalBand !== 'BLOCKED',
    downgrade_reason: reasoning,
    audit: createAudit(inputs, 'BLOCKED', 0, originalBand, downgradePath),
    reasoning,
  };
}

/**
 * Check if PCPE is enabled (kill switch)
 */
export function isPCPEEnabled(): boolean {
  return PCPE_CONFIG.enabled;
}
