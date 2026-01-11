/**
 * Zone Reachability Validator - SSOT for Reachability Gate Logic
 *
 * Validates that entry zones are reachable from current price.
 * Auto-downgrades unreachable zones: Limit → Hybrid → Momentum
 *
 * Reachability Formula:
 *   distance ≤ (k1 × ATR_15m + k2 × spread)
 *
 * SSOT Responsibility: THIS is the ONLY place that validates zone reachability.
 */

import { ADAPTIVE_ZONE_CONFIG, type ZoneType } from '../config/adaptive-zone-config';
import type { EntryZoneResult } from './adaptive-entry-zone-calculator';
import type { ZoneCalculationInputs } from './zone-calculation-input-provider';
import { logger } from '../lib/logger';

export interface ReachabilityResult {
  isPrimaryReachable: boolean;
  isSecondaryReachable: boolean;
  distanceFromPriceATR: number;
  distanceFromPricePips: number;
  reachabilityLimit: number; // Maximum allowed distance
  shouldDowngrade: boolean;
  downgradeTo?: ZoneType;
  positionSizeMultiplier: number; // 1.0 (full), 0.65 (secondary), 0.40 (chase), or 0 (wait)
  executionAdvice: 'EXECUTE_PRIMARY' | 'EXECUTE_SECONDARY' | 'CHASE_REDUCED' | 'WAIT_ONLY';
  reasoning: string;
}

export class ZoneReachabilityValidator {
  /**
   * SSOT: Validate zone reachability and determine execution advice
   */
  static validate(
    zones: EntryZoneResult,
    inputs: ZoneCalculationInputs
  ): ReachabilityResult {
    const config = ADAPTIVE_ZONE_CONFIG.reachability;
    const { currentPrice, atr15m, spread, pipValue } = inputs;

    // Calculate reachability limit
    const reachabilityLimit = (config.k1_atr_multiplier * atr15m) + (config.k2_spread_multiplier * spread);

    // Calculate distance from current price to PRIMARY zone
    const distanceToPrimaryZone = this.calculateDistanceToZone(
      currentPrice,
      zones.primary.min,
      zones.primary.max
    );

    const distanceFromPriceATR = distanceToPrimaryZone / atr15m;
    const distanceFromPricePips = distanceToPrimaryZone / pipValue;

    // Calculate distance to SECONDARY zone
    const distanceToSecondaryZone = this.calculateDistanceToZone(
      currentPrice,
      zones.secondary.min,
      zones.secondary.max
    );

    // Check reachability
    const isPrimaryReachable = distanceToPrimaryZone <= reachabilityLimit;
    const isSecondaryReachable = distanceToSecondaryZone <= reachabilityLimit;

    // Determine execution advice based on distance
    let executionAdvice: ReachabilityResult['executionAdvice'];
    let positionSizeMultiplier: number;
    let shouldDowngrade = false;
    let downgradeTo: ZoneType | undefined;
    let reasoning: string;

    if (distanceFromPriceATR <= 0.0) {
      // Already in primary zone
      executionAdvice = 'EXECUTE_PRIMARY';
      positionSizeMultiplier = ADAPTIVE_ZONE_CONFIG.positionSizing.primary_zone_multiplier;
      reasoning = 'Price is already in primary entry zone. Execute at full size.';
    } else if (distanceFromPriceATR <= config.chase_cap_momentum && isPrimaryReachable) {
      // Within chase range - execute at reduced size
      executionAdvice = 'CHASE_REDUCED';
      positionSizeMultiplier = ADAPTIVE_ZONE_CONFIG.positionSizing.momentum_chase_multiplier;
      reasoning = `Price is ${distanceFromPriceATR.toFixed(2)}x ATR from zone (chase range). Execute at ${(positionSizeMultiplier * 100).toFixed(0)}% size.`;
    } else if (distanceFromPriceATR <= config.hard_wait_threshold && isPrimaryReachable) {
      // Between chase cap and wait threshold - monitor primary zone
      executionAdvice = 'EXECUTE_PRIMARY';
      positionSizeMultiplier = ADAPTIVE_ZONE_CONFIG.positionSizing.primary_zone_multiplier;
      reasoning = `Price is ${distanceFromPriceATR.toFixed(2)}x ATR from zone. Wait for primary zone entry.`;
    } else if (distanceFromPriceATR > config.hard_wait_threshold) {
      // Beyond wait threshold - WAIT status, no execution
      executionAdvice = 'WAIT_ONLY';
      positionSizeMultiplier = 0;
      shouldDowngrade = ADAPTIVE_ZONE_CONFIG.features.auto_downgrade_enabled;
      reasoning = `Price is ${distanceFromPriceATR.toFixed(2)}x ATR from zone (>${config.hard_wait_threshold}x threshold). WAIT status - zone unreachable.`;

      // Determine downgrade target
      if (shouldDowngrade) {
        downgradeTo = this.getDowngradeTarget(zones.zoneType);
        reasoning += ` Auto-downgrade to ${downgradeTo} zone recommended.`;
      }
    } else if (isSecondaryReachable && !isPrimaryReachable) {
      // Primary unreachable but secondary is reachable
      executionAdvice = 'EXECUTE_SECONDARY';
      positionSizeMultiplier = ADAPTIVE_ZONE_CONFIG.positionSizing.secondary_zone_multiplier;
      reasoning = `Primary zone unreachable, but secondary zone is accessible. Execute at ${(positionSizeMultiplier * 100).toFixed(0)}% size.`;
    } else {
      // Both zones unreachable
      executionAdvice = 'WAIT_ONLY';
      positionSizeMultiplier = 0;
      shouldDowngrade = ADAPTIVE_ZONE_CONFIG.features.auto_downgrade_enabled;
      reasoning = `Both zones unreachable (distance: ${distanceFromPriceATR.toFixed(2)}x ATR). WAIT status.`;

      if (shouldDowngrade) {
        downgradeTo = this.getDowngradeTarget(zones.zoneType);
        reasoning += ` Auto-downgrade to ${downgradeTo} zone recommended.`;
      }
    }

    logger.info(
      `[ZoneReachability] ${inputs.symbol}: Distance ${distanceFromPriceATR.toFixed(2)}x ATR ` +
      `(${distanceFromPricePips.toFixed(1)} pips). Advice: ${executionAdvice} @ ${(positionSizeMultiplier * 100).toFixed(0)}% size`
    );

    return {
      isPrimaryReachable,
      isSecondaryReachable,
      distanceFromPriceATR,
      distanceFromPricePips,
      reachabilityLimit,
      shouldDowngrade,
      downgradeTo,
      positionSizeMultiplier,
      executionAdvice,
      reasoning
    };
  }

  /**
   * Calculate distance from price to zone
   * Returns 0 if price is inside zone
   */
  private static calculateDistanceToZone(
    currentPrice: number,
    zoneMin: number,
    zoneMax: number
  ): number {
    // If price is in zone, distance is 0
    if (currentPrice >= zoneMin && currentPrice <= zoneMax) {
      return 0;
    }

    // Calculate distance to nearest edge
    if (currentPrice < zoneMin) {
      return zoneMin - currentPrice;
    } else {
      return currentPrice - zoneMax;
    }
  }

  /**
   * Get downgrade target for zone type
   * Limit → Hybrid → Momentum (tighter zones)
   */
  private static getDowngradeTarget(currentZoneType: ZoneType): ZoneType {
    switch (currentZoneType) {
      case 'limit':
        return 'hybrid';
      case 'hybrid':
        return 'momentum';
      case 'momentum':
        return 'momentum'; // Already tightest, cannot downgrade further
      default:
        return 'hybrid';
    }
  }

  /**
   * Check if zone type can be downgraded
   */
  static canDowngrade(zoneType: ZoneType): boolean {
    return zoneType !== 'momentum'; // Momentum is the tightest, cannot downgrade
  }

  /**
   * Get position size multiplier for execution advice
   */
  static getPositionSizeMultiplier(executionAdvice: ReachabilityResult['executionAdvice']): number {
    switch (executionAdvice) {
      case 'EXECUTE_PRIMARY':
        return ADAPTIVE_ZONE_CONFIG.positionSizing.primary_zone_multiplier;
      case 'EXECUTE_SECONDARY':
        return ADAPTIVE_ZONE_CONFIG.positionSizing.secondary_zone_multiplier;
      case 'CHASE_REDUCED':
        return ADAPTIVE_ZONE_CONFIG.positionSizing.momentum_chase_multiplier;
      case 'WAIT_ONLY':
        return 0;
      default:
        return 0;
    }
  }

  /**
   * Validate reachability parameters are within safe bounds
   */
  static validateConfig(): boolean {
    const config = ADAPTIVE_ZONE_CONFIG.reachability;

    if (config.k1_atr_multiplier <= 0 || config.k1_atr_multiplier > 5) {
      logger.error('[ZoneReachability] Invalid k1_atr_multiplier, must be 0-5');
      return false;
    }

    if (config.k2_spread_multiplier < 0 || config.k2_spread_multiplier > 10) {
      logger.error('[ZoneReachability] Invalid k2_spread_multiplier, must be 0-10');
      return false;
    }

    if (config.chase_cap_momentum <= 0 || config.chase_cap_momentum >= config.hard_wait_threshold) {
      logger.error('[ZoneReachability] chase_cap_momentum must be > 0 and < hard_wait_threshold');
      return false;
    }

    return true;
  }
}
