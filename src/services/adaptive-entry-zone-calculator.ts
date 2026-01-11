/**
 * Adaptive Entry Zone Calculator - SSOT for All Entry Zone Calculations
 *
 * Three zone models matched to market regimes:
 * 1. LIMIT ZONES - Mean reversion setups (exhaustion, stretch from levels)
 * 2. HYBRID ZONES - Structured setups (compression, retest, neutral)
 * 3. MOMENTUM ZONES - Continuation setups (acceleration, stop-hunt expansion)
 *
 * SSOT Responsibility: THIS is the ONLY place that calculates entry zones.
 * All zone calculations must go through this service.
 */

import { ADAPTIVE_ZONE_CONFIG, type ZoneType } from '../config/adaptive-zone-config';
import type { ZoneCalculationInputs } from './zone-calculation-input-provider';
import { logger } from '../lib/logger';

export interface EntryZoneResult {
  primary: {
    min: number;
    max: number;
    center: number;
  };
  secondary: {
    min: number;
    max: number;
    center: number;
  };
  zoneType: ZoneType;
  model: 'limit' | 'hybrid' | 'momentum';
  reasoning: string;
  metadata: {
    primaryWidthPips: number;
    secondaryWidthPips: number;
    distanceFromPrice: number;
    anchorPrice?: number; // VWAP, EMA, or current price
    anchorType?: 'vwap' | 'ema20' | 'ema50' | 'current_price' | 'swing_level';
  };
}

export class AdaptiveEntryZoneCalculator {
  /**
   * SSOT: Calculate primary and secondary entry zones
   */
  static calculateZones(
    inputs: ZoneCalculationInputs,
    zoneType: ZoneType,
    direction: 'BUY' | 'SELL',
    confidence: number
  ): EntryZoneResult {
    logger.info(`[AdaptiveZoneCalc] Calculating ${zoneType} zones for ${direction} with ${confidence}% confidence`);

    // Select appropriate model
    switch (zoneType) {
      case 'limit':
        return this.calculateLimitZones(inputs, direction, confidence);
      case 'hybrid':
        return this.calculateHybridZones(inputs, direction, confidence);
      case 'momentum':
        return this.calculateMomentumZones(inputs, direction, confidence);
      default:
        logger.warn(`[AdaptiveZoneCalc] Unknown zone type '${zoneType}', using Hybrid`);
        return this.calculateHybridZones(inputs, direction, confidence);
    }
  }

  /**
   * LIMIT ZONES - Mean Reversion Model
   *
   * Used for: Trend Exhaustion, Mean Reversion Pocket
   * Strategy: Wait for pullback to value anchors (VWAP, EMA50)
   * Zone placement: Asymmetric around anchor (wider below for BUY, above for SELL)
   */
  private static calculateLimitZones(
    inputs: ZoneCalculationInputs,
    direction: 'BUY' | 'SELL',
    confidence: number
  ): EntryZoneResult {
    const config = ADAPTIVE_ZONE_CONFIG.zoneModels.limit;
    const { currentPrice, atr15m, vwap, ema20, ema50, pipValue, recentSwingHigh, recentSwingLow } = inputs;

    // Determine anchor price (prefer VWAP, fallback to EMA50, then EMA20)
    let anchorPrice: number;
    let anchorType: 'vwap' | 'ema50' | 'ema20' | 'current_price';

    if (vwap && ema50 && config.vwap_ema_priority === 'max') {
      // Use the farther level from price (max pullback)
      anchorPrice = direction === 'BUY' ? Math.max(vwap, ema50) : Math.min(vwap, ema50);
      anchorType = anchorPrice === vwap ? 'vwap' : 'ema50';
    } else if (vwap) {
      anchorPrice = vwap;
      anchorType = 'vwap';
    } else if (ema50) {
      anchorPrice = ema50;
      anchorType = 'ema50';
    } else if (ema20) {
      anchorPrice = ema20;
      anchorType = 'ema20';
    } else {
      // No anchor available, use current price with wider zones
      anchorPrice = currentPrice;
      anchorType = 'current_price';
      logger.warn('[AdaptiveZoneCalc] No mean reversion anchor available for LIMIT zone');
    }

    // Calculate asymmetric zone width
    const baseWidth = atr15m * config.tightness_multiplier;
    const belowWidth = atr15m * config.asymmetric_below_multiplier;
    const aboveWidth = atr15m * config.asymmetric_above_multiplier;

    // Apply confidence scaling (higher confidence = tighter zones)
    const confidenceMultiplier = this.getConfidenceMultiplier(confidence);

    let primaryMin: number, primaryMax: number;

    if (direction === 'BUY') {
      // BUY: Wider zone below anchor (expect to buy the dip)
      primaryMin = anchorPrice - (belowWidth * confidenceMultiplier);
      primaryMax = anchorPrice + (aboveWidth * confidenceMultiplier);
    } else {
      // SELL: Wider zone above anchor (expect to sell the rally)
      primaryMin = anchorPrice - (aboveWidth * confidenceMultiplier);
      primaryMax = anchorPrice + (belowWidth * confidenceMultiplier);
    }

    // Incorporate swing levels if available and use_swing_levels enabled
    if (config.use_swing_levels) {
      if (direction === 'BUY' && recentSwingLow) {
        // BUY: Don't go below recent swing low
        primaryMin = Math.max(primaryMin, recentSwingLow);
      } else if (direction === 'SELL' && recentSwingHigh) {
        // SELL: Don't go above recent swing high
        primaryMax = Math.min(primaryMax, recentSwingHigh);
      }
    }

    const primaryCenter = (primaryMin + primaryMax) / 2;

    // Calculate secondary zone (further from price, same width)
    const secondaryOffset = atr15m * ADAPTIVE_ZONE_CONFIG.secondaryZone.offset_multiplier;
    const secondaryWidth = (primaryMax - primaryMin) * ADAPTIVE_ZONE_CONFIG.secondaryZone.width_multiplier;

    let secondaryMin: number, secondaryMax: number;

    if (direction === 'BUY') {
      // Secondary zone is BELOW primary (even better entry)
      const secondaryCenter = primaryCenter - secondaryOffset;
      secondaryMin = secondaryCenter - secondaryWidth / 2;
      secondaryMax = secondaryCenter + secondaryWidth / 2;
    } else {
      // Secondary zone is ABOVE primary (even better entry)
      const secondaryCenter = primaryCenter + secondaryOffset;
      secondaryMin = secondaryCenter - secondaryWidth / 2;
      secondaryMax = secondaryCenter + secondaryWidth / 2;
    }

    const primaryWidthPips = Math.abs(primaryMax - primaryMin) / pipValue;
    const secondaryWidthPips = Math.abs(secondaryMax - secondaryMin) / pipValue;
    const distanceFromPrice = Math.abs(currentPrice - primaryCenter);

    return {
      primary: {
        min: primaryMin,
        max: primaryMax,
        center: primaryCenter
      },
      secondary: {
        min: secondaryMin,
        max: secondaryMax,
        center: (secondaryMin + secondaryMax) / 2
      },
      zoneType: 'limit',
      model: 'limit',
      reasoning: `Mean reversion zone anchored at ${anchorType} (${anchorPrice.toFixed(5)}). Waiting for pullback to value.`,
      metadata: {
        primaryWidthPips,
        secondaryWidthPips,
        distanceFromPrice,
        anchorPrice,
        anchorType
      }
    };
  }

  /**
   * HYBRID ZONES - Balanced Trigger Model
   *
   * Used for: Compression, Retest, Neutral Ranging, Liquidity Vacuum
   * Strategy: Balanced zones around ideal entry with structured triggers
   * Zone placement: Symmetric but slightly biased toward entry direction
   */
  private static calculateHybridZones(
    inputs: ZoneCalculationInputs,
    direction: 'BUY' | 'SELL',
    confidence: number
  ): EntryZoneResult {
    const config = ADAPTIVE_ZONE_CONFIG.zoneModels.hybrid;
    const { currentPrice, atr15m, vwap, pipValue } = inputs;

    // Use current price as base (or VWAP if very close)
    const basePrice = (vwap && Math.abs(currentPrice - vwap) < atr15m * 0.5)
      ? vwap
      : currentPrice;

    // Calculate zone width with slight asymmetry
    const belowWidth = atr15m * config.trigger_below_multiplier;
    const aboveWidth = atr15m * config.trigger_above_multiplier;

    // Apply confidence scaling
    const confidenceMultiplier = this.getConfidenceMultiplier(confidence);

    let primaryMin: number, primaryMax: number;

    if (direction === 'BUY') {
      // BUY: Slightly wider below for limit order fills
      primaryMin = basePrice - (belowWidth * confidenceMultiplier);
      primaryMax = basePrice + (aboveWidth * confidenceMultiplier);
    } else {
      // SELL: Slightly wider above for limit order fills
      primaryMin = basePrice - (aboveWidth * confidenceMultiplier);
      primaryMax = basePrice + (belowWidth * confidenceMultiplier);
    }

    const primaryCenter = (primaryMin + primaryMax) / 2;

    // Calculate secondary zone
    const secondaryOffset = atr15m * ADAPTIVE_ZONE_CONFIG.secondaryZone.offset_multiplier;
    const secondaryWidth = (primaryMax - primaryMin) * ADAPTIVE_ZONE_CONFIG.secondaryZone.width_multiplier;

    let secondaryMin: number, secondaryMax: number;

    if (direction === 'BUY') {
      const secondaryCenter = primaryCenter - secondaryOffset;
      secondaryMin = secondaryCenter - secondaryWidth / 2;
      secondaryMax = secondaryCenter + secondaryWidth / 2;
    } else {
      const secondaryCenter = primaryCenter + secondaryOffset;
      secondaryMin = secondaryCenter - secondaryWidth / 2;
      secondaryMax = secondaryCenter + secondaryWidth / 2;
    }

    const primaryWidthPips = Math.abs(primaryMax - primaryMin) / pipValue;
    const secondaryWidthPips = Math.abs(secondaryMax - secondaryMin) / pipValue;
    const distanceFromPrice = Math.abs(currentPrice - primaryCenter);

    return {
      primary: {
        min: primaryMin,
        max: primaryMax,
        center: primaryCenter
      },
      secondary: {
        min: secondaryMin,
        max: secondaryMax,
        center: (secondaryMin + secondaryMax) / 2
      },
      zoneType: 'hybrid',
      model: 'hybrid',
      reasoning: `Balanced trigger zone around current price with structured entry conditions.`,
      metadata: {
        primaryWidthPips,
        secondaryWidthPips,
        distanceFromPrice,
        anchorPrice: basePrice,
        anchorType: vwap ? 'vwap' : 'current_price'
      }
    };
  }

  /**
   * MOMENTUM ZONES - Tight Continuation Model
   *
   * Used for: Trend Acceleration, Stop-Hunt Expansion
   * Strategy: Very tight zones near current price for immediate execution
   * Zone placement: Minimal width, allow small pullback only
   */
  private static calculateMomentumZones(
    inputs: ZoneCalculationInputs,
    direction: 'BUY' | 'SELL',
    confidence: number
  ): EntryZoneResult {
    const config = ADAPTIVE_ZONE_CONFIG.zoneModels.momentum;
    const { currentPrice, atr15m, pipValue, symbol } = inputs;

    // Very tight zones for momentum
    const baseWidth = atr15m * config.pullback_allowance_multiplier;

    // Apply confidence scaling (even tighter for high confidence)
    const confidenceMultiplier = this.getConfidenceMultiplier(confidence);
    const scaledWidth = baseWidth * confidenceMultiplier * config.tightness_multiplier;

    // Apply hard cap for momentum zones
    const isJPY = symbol.includes('JPY');
    const maxWidth = isJPY ? 0.05 : config.max_zone_width_pips * pipValue;
    const finalWidth = Math.min(scaledWidth, maxWidth);

    // Symmetric zone around current price
    const primaryMin = currentPrice - finalWidth;
    const primaryMax = currentPrice + finalWidth;
    const primaryCenter = currentPrice;

    // Secondary zone is very close (half the offset of other models)
    const secondaryOffset = atr15m * ADAPTIVE_ZONE_CONFIG.secondaryZone.offset_multiplier * 0.5;
    const secondaryWidth = finalWidth * ADAPTIVE_ZONE_CONFIG.secondaryZone.width_multiplier;

    let secondaryMin: number, secondaryMax: number;

    if (direction === 'BUY') {
      const secondaryCenter = primaryCenter - secondaryOffset;
      secondaryMin = secondaryCenter - secondaryWidth / 2;
      secondaryMax = secondaryCenter + secondaryWidth / 2;
    } else {
      const secondaryCenter = primaryCenter + secondaryOffset;
      secondaryMin = secondaryCenter - secondaryWidth / 2;
      secondaryMax = secondaryCenter + secondaryWidth / 2;
    }

    const primaryWidthPips = Math.abs(primaryMax - primaryMin) / pipValue;
    const secondaryWidthPips = Math.abs(secondaryMax - secondaryMin) / pipValue;
    const distanceFromPrice = 0; // By definition, momentum zones are at current price

    return {
      primary: {
        min: primaryMin,
        max: primaryMax,
        center: primaryCenter
      },
      secondary: {
        min: secondaryMin,
        max: secondaryMax,
        center: (secondaryMin + secondaryMax) / 2
      },
      zoneType: 'momentum',
      model: 'momentum',
      reasoning: `Tight momentum zone near current price for immediate execution on continuation.`,
      metadata: {
        primaryWidthPips,
        secondaryWidthPips,
        distanceFromPrice,
        anchorPrice: currentPrice,
        anchorType: 'current_price'
      }
    };
  }

  /**
   * Calculate confidence multiplier for zone width
   * Higher confidence = tighter zones (more precise entry required)
   */
  private static getConfidenceMultiplier(confidence: number): number {
    if (confidence >= 80) return 0.80; // Very tight for high confidence
    if (confidence >= 70) return 0.90; // Tight for good confidence
    if (confidence >= 60) return 1.00; // Standard for medium confidence
    return 1.15; // Wider for lower confidence (more flexibility)
  }

  /**
   * Calculate distance from price to zone in ATR units
   * Used for reachability validation
   */
  static calculateDistanceInATR(
    currentPrice: number,
    zoneMin: number,
    zoneMax: number,
    atr: number
  ): number {
    // If price is in zone, distance is 0
    if (currentPrice >= zoneMin && currentPrice <= zoneMax) {
      return 0;
    }

    // Calculate distance to nearest edge
    const distanceToMin = Math.abs(currentPrice - zoneMin);
    const distanceToMax = Math.abs(currentPrice - zoneMax);
    const minDistance = Math.min(distanceToMin, distanceToMax);

    return minDistance / atr;
  }
}
