/**
 * Zone Meta-Learning Service - SSOT for Zone Analytics Storage
 *
 * Stores all zone calculations and outcomes for Alpha's meta-learning:
 * - Which regimes produce unreachable zones
 * - Which zone types have highest execution rates
 * - Reachability gate effectiveness
 * - Zone model performance by market condition
 *
 * SSOT Responsibility: THIS is the ONLY place that logs zone analytics.
 */

import { supabase } from '../lib/supabase';
import type { EntryZoneResult } from './adaptive-entry-zone-calculator';
import type { ReachabilityResult } from './zone-reachability-validator';
import type { MicroRegime } from './micro-regime-classifier';
import { logger } from '../lib/logger';
import { ADAPTIVE_ZONE_CONFIG } from '../config/adaptive-zone-config';

export interface ZoneAnalyticsRecord {
  entry_intent_id?: string;
  session_id: string;
  symbol: string;
  micro_regime: string;
  selected_zone_type: string;
  reachability_passed: boolean;
  distance_from_price_atr: number;
  downgrade_applied: boolean;
  original_zone_type?: string;
  price_reached_primary_zone?: boolean;
  price_reached_secondary_zone?: boolean;
  time_to_reach_zone_seconds?: number;
  executed_from_zone?: 'primary' | 'secondary' | 'none';
}

export class ZoneMetaLearningService {
  /**
   * SSOT: Log zone calculation for meta-learning
   *
   * Called immediately after zone calculation (async, non-blocking)
   */
  static async logZoneCalculation(
    sessionId: string,
    symbol: string,
    microRegime: MicroRegime | 'fallback',
    zones: EntryZoneResult,
    reachability: ReachabilityResult,
    intentId?: string
  ): Promise<void> {
    if (!ADAPTIVE_ZONE_CONFIG.features.meta_learning_enabled) {
      return; // Meta-learning disabled
    }

    try {
      const record: ZoneAnalyticsRecord = {
        entry_intent_id: intentId,
        session_id: sessionId,
        symbol,
        micro_regime: microRegime,
        selected_zone_type: zones.zoneType,
        reachability_passed: reachability.isPrimaryReachable,
        distance_from_price_atr: reachability.distanceFromPriceATR,
        downgrade_applied: reachability.shouldDowngrade,
        original_zone_type: reachability.shouldDowngrade ? zones.zoneType : undefined
      };

      const { error } = await supabase
        .from('entry_zone_analytics')
        .insert(record);

      if (error) {
        logger.error('[ZoneMetaLearning] Failed to log zone analytics:', error);
      } else {
        logger.debug(`[ZoneMetaLearning] Logged zone calculation: ${symbol} ${microRegime} → ${zones.zoneType}`);
      }
    } catch (error) {
      logger.error('[ZoneMetaLearning] Exception logging zone analytics:', error);
    }
  }

  /**
   * Update zone analytics when zone is reached
   *
   * Called from UnifiedEntryMonitor when price enters a zone
   */
  static async logZoneReached(
    intentId: string,
    zoneType: 'primary' | 'secondary',
    timeToReachSeconds: number
  ): Promise<void> {
    if (!ADAPTIVE_ZONE_CONFIG.features.meta_learning_enabled) {
      return;
    }

    try {
      const updateData: Partial<ZoneAnalyticsRecord> = {
        time_to_reach_zone_seconds: timeToReachSeconds
      };

      if (zoneType === 'primary') {
        updateData.price_reached_primary_zone = true;
      } else {
        updateData.price_reached_secondary_zone = true;
      }

      const { error } = await supabase
        .from('entry_zone_analytics')
        .update(updateData)
        .eq('entry_intent_id', intentId);

      if (error) {
        logger.error('[ZoneMetaLearning] Failed to log zone reached:', error);
      }
    } catch (error) {
      logger.error('[ZoneMetaLearning] Exception logging zone reached:', error);
    }
  }

  /**
   * Update zone analytics when trade executes
   *
   * Called from trade execution flow
   */
  static async logZoneExecution(
    intentId: string,
    executedFromZone: 'primary' | 'secondary'
  ): Promise<void> {
    if (!ADAPTIVE_ZONE_CONFIG.features.meta_learning_enabled) {
      return;
    }

    try {
      const { error } = await supabase
        .from('entry_zone_analytics')
        .update({ executed_from_zone: executedFromZone })
        .eq('entry_intent_id', intentId);

      if (error) {
        logger.error('[ZoneMetaLearning] Failed to log zone execution:', error);
      }
    } catch (error) {
      logger.error('[ZoneMetaLearning] Exception logging zone execution:', error);
    }
  }

  /**
   * Get unreachable zones by regime
   *
   * Analytics query for Alpha meta-learning
   */
  static async getUnreachableZonesByRegime(): Promise<Record<string, number>> {
    try {
      const { data, error } = await supabase
        .from('entry_zone_analytics')
        .select('micro_regime, reachability_passed');

      if (error || !data) {
        logger.error('[ZoneMetaLearning] Failed to fetch regime analytics:', error);
        return {};
      }

      // Group by regime and calculate unreachable rate
      const regimeStats: Record<string, { total: number; unreachable: number }> = {};

      for (const record of data) {
        const regime = record.micro_regime;
        if (!regimeStats[regime]) {
          regimeStats[regime] = { total: 0, unreachable: 0 };
        }
        regimeStats[regime].total++;
        if (!record.reachability_passed) {
          regimeStats[regime].unreachable++;
        }
      }

      // Calculate unreachable rate
      const unreachableRates: Record<string, number> = {};
      for (const [regime, stats] of Object.entries(regimeStats)) {
        unreachableRates[regime] = stats.unreachable / stats.total;
      }

      return unreachableRates;
    } catch (error) {
      logger.error('[ZoneMetaLearning] Exception fetching regime analytics:', error);
      return {};
    }
  }

  /**
   * Get zone type success rates
   *
   * Analytics query showing execution rate by zone type
   */
  static async getZoneTypeSuccessRates(): Promise<Record<string, number>> {
    try {
      const { data, error } = await supabase
        .from('entry_zone_analytics')
        .select('selected_zone_type, executed_from_zone');

      if (error || !data) {
        logger.error('[ZoneMetaLearning] Failed to fetch zone type analytics:', error);
        return {};
      }

      // Group by zone type and calculate execution rate
      const zoneStats: Record<string, { total: number; executed: number }> = {};

      for (const record of data) {
        const zoneType = record.selected_zone_type;
        if (!zoneStats[zoneType]) {
          zoneStats[zoneType] = { total: 0, executed: 0 };
        }
        zoneStats[zoneType].total++;
        if (record.executed_from_zone && record.executed_from_zone !== 'none') {
          zoneStats[zoneType].executed++;
        }
      }

      // Calculate execution rate
      const successRates: Record<string, number> = {};
      for (const [zoneType, stats] of Object.entries(zoneStats)) {
        successRates[zoneType] = stats.executed / stats.total;
      }

      return successRates;
    } catch (error) {
      logger.error('[ZoneMetaLearning] Exception fetching zone type analytics:', error);
      return {};
    }
  }

  /**
   * Get reachability gate metrics
   *
   * Overall effectiveness of reachability validation
   */
  static async getZoneReachabilityMetrics(): Promise<{
    totalZones: number;
    reachableZones: number;
    reachabilityRate: number;
    avgDistanceATR: number;
    downgradeRate: number;
  }> {
    try {
      const { data, error } = await supabase
        .from('entry_zone_analytics')
        .select('reachability_passed, distance_from_price_atr, downgrade_applied');

      if (error || !data) {
        logger.error('[ZoneMetaLearning] Failed to fetch reachability metrics:', error);
        return {
          totalZones: 0,
          reachableZones: 0,
          reachabilityRate: 0,
          avgDistanceATR: 0,
          downgradeRate: 0
        };
      }

      const totalZones = data.length;
      const reachableZones = data.filter(r => r.reachability_passed).length;
      const downgrades = data.filter(r => r.downgrade_applied).length;

      const totalDistance = data.reduce((sum, r) => sum + (r.distance_from_price_atr || 0), 0);
      const avgDistanceATR = totalDistance / totalZones;

      return {
        totalZones,
        reachableZones,
        reachabilityRate: reachableZones / totalZones,
        avgDistanceATR,
        downgradeRate: downgrades / totalZones
      };
    } catch (error) {
      logger.error('[ZoneMetaLearning] Exception fetching reachability metrics:', error);
      return {
        totalZones: 0,
        reachableZones: 0,
        reachabilityRate: 0,
        avgDistanceATR: 0,
        downgradeRate: 0
      };
    }
  }

  /**
   * Get secondary zone utilization
   *
   * How often secondary zones lead to execution
   */
  static async getSecondaryZoneUtilization(): Promise<{
    totalExecutions: number;
    primaryExecutions: number;
    secondaryExecutions: number;
    secondaryRate: number;
  }> {
    try {
      const { data, error } = await supabase
        .from('entry_zone_analytics')
        .select('executed_from_zone')
        .neq('executed_from_zone', 'none')
        .not('executed_from_zone', 'is', null);

      if (error || !data) {
        logger.error('[ZoneMetaLearning] Failed to fetch secondary zone utilization:', error);
        return {
          totalExecutions: 0,
          primaryExecutions: 0,
          secondaryExecutions: 0,
          secondaryRate: 0
        };
      }

      const totalExecutions = data.length;
      const primaryExecutions = data.filter(r => r.executed_from_zone === 'primary').length;
      const secondaryExecutions = data.filter(r => r.executed_from_zone === 'secondary').length;

      return {
        totalExecutions,
        primaryExecutions,
        secondaryExecutions,
        secondaryRate: secondaryExecutions / totalExecutions
      };
    } catch (error) {
      logger.error('[ZoneMetaLearning] Exception fetching secondary zone utilization:', error);
      return {
        totalExecutions: 0,
        primaryExecutions: 0,
        secondaryExecutions: 0,
        secondaryRate: 0
      };
    }
  }
}
