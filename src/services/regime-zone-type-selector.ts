/**
 * Regime Zone Type Selector - SSOT for Regime → Zone Type Mapping
 *
 * Maps 8 micro-regimes to appropriate zone types (Limit/Hybrid/Momentum).
 * Ensures zones match market regime behavior for higher execution rates.
 *
 * SSOT Responsibility: THIS is the ONLY place that determines zone type from regime.
 */

import type { MicroRegime } from './micro-regime-classifier';
import type { ZoneType } from '../config/adaptive-zone-config';
import { ADAPTIVE_ZONE_CONFIG } from '../config/adaptive-zone-config';
import { logger } from '../lib/logger';

export interface ZoneTypeSelection {
  zoneType: ZoneType;
  confidence: number;
  reasoning: string;
  regimeUsed: MicroRegime | 'fallback';
}

export class RegimeZoneTypeSelector {
  /**
   * SSOT: Select zone type based on micro-regime
   *
   * Mapping Logic:
   * - Acceleration/Expansion → Momentum (price moving fast)
   * - Exhaustion/Mean Reversion → Limit (expect pullback to levels)
   * - Compression/Retest → Hybrid (structured setups)
   * - Neutral/Vacuum → Hybrid (balanced approach)
   */
  static selectZoneType(microRegime?: MicroRegime, fallbackAllowed = true): ZoneTypeSelection {
    // Check for override in config
    if (microRegime && ADAPTIVE_ZONE_CONFIG.regimeOverrides[microRegime]) {
      const overrideType = ADAPTIVE_ZONE_CONFIG.regimeOverrides[microRegime] as ZoneType;
      logger.info(`[ZoneTypeSelector] Using config override: ${microRegime} → ${overrideType}`);
      return {
        zoneType: overrideType,
        confidence: 100,
        reasoning: `Config override for ${microRegime}`,
        regimeUsed: microRegime
      };
    }

    // If no regime provided, use fallback
    if (!microRegime) {
      if (fallbackAllowed && ADAPTIVE_ZONE_CONFIG.features.fallback_to_hybrid) {
        logger.warn('[ZoneTypeSelector] No micro-regime provided, falling back to Hybrid zone');
        return {
          zoneType: 'hybrid',
          confidence: 60,
          reasoning: 'No regime data available, using balanced Hybrid approach',
          regimeUsed: 'fallback'
        };
      } else {
        throw new Error('[ZoneTypeSelector] No micro-regime provided and fallback disabled');
      }
    }

    // Primary mapping logic
    switch (microRegime) {
      case 'trend_acceleration':
        return {
          zoneType: 'momentum',
          confidence: 90,
          reasoning: 'Strong momentum - use tight zones near current price for quick entry',
          regimeUsed: microRegime
        };

      case 'stop_hunt_expansion':
        return {
          zoneType: 'momentum',
          confidence: 95,
          reasoning: 'Post-sweep expansion - enter on momentum before cascade completes',
          regimeUsed: microRegime
        };

      case 'trend_exhaustion':
        return {
          zoneType: 'limit',
          confidence: 85,
          reasoning: 'Weakening momentum - wait for pullback to VWAP or key levels',
          regimeUsed: microRegime
        };

      case 'mean_reversion_pocket':
        return {
          zoneType: 'limit',
          confidence: 90,
          reasoning: 'Extreme stretch - enter at mean reversion levels (VWAP, EMA50)',
          regimeUsed: microRegime
        };

      case 'pre_break_compression':
        return {
          zoneType: 'hybrid',
          confidence: 80,
          reasoning: 'Compression before break - balanced zone for breakout entry',
          regimeUsed: microRegime
        };

      case 'post_break_retest':
        return {
          zoneType: 'hybrid',
          confidence: 85,
          reasoning: 'Retest of broken level - structured entry at support/resistance',
          regimeUsed: microRegime
        };

      case 'liquidity_vacuum':
        return {
          zoneType: 'hybrid',
          confidence: 75,
          reasoning: 'Low volume compression - balanced approach until direction confirmed',
          regimeUsed: microRegime
        };

      case 'neutral_ranging':
        return {
          zoneType: 'hybrid',
          confidence: 70,
          reasoning: 'No clear pattern - use balanced Hybrid zones for flexibility',
          regimeUsed: microRegime
        };

      default:
        logger.warn(`[ZoneTypeSelector] Unknown micro-regime: ${microRegime}, using Hybrid`);
        return {
          zoneType: 'hybrid',
          confidence: 65,
          reasoning: `Unknown regime '${microRegime}', defaulting to balanced Hybrid approach`,
          regimeUsed: microRegime
        };
    }
  }

  /**
   * Validate that a zone type is appropriate for a regime
   * Used for debugging and testing
   */
  static validateZoneTypeForRegime(zoneType: ZoneType, regime: MicroRegime): boolean {
    const selection = this.selectZoneType(regime, false);
    return selection.zoneType === zoneType;
  }

  /**
   * Get all valid regime-zone combinations
   * Used for meta-learning and analytics
   */
  static getAllRegimeZoneMappings(): Record<MicroRegime, ZoneType> {
    const regimes: MicroRegime[] = [
      'trend_acceleration',
      'trend_exhaustion',
      'mean_reversion_pocket',
      'liquidity_vacuum',
      'stop_hunt_expansion',
      'pre_break_compression',
      'post_break_retest',
      'neutral_ranging'
    ];

    const mappings: Record<string, ZoneType> = {};
    for (const regime of regimes) {
      const selection = this.selectZoneType(regime, false);
      mappings[regime] = selection.zoneType;
    }

    return mappings as Record<MicroRegime, ZoneType>;
  }
}
