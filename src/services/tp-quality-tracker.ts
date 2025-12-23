import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import type { TPCalculationResult, LiquidityZone } from './profit-target-calculator';

export interface TPQualityLog {
  user_id: string;
  trade_id?: string;
  symbol: string;
  direction: 'long' | 'short';

  entry_price: number;
  stop_loss: number;
  take_profit: number;

  rr_ratio: number;
  placement_type: 'single' | 'partial';

  liquidity_zones_detected: number;
  liquidity_override_used: boolean;
  primary_liquidity_type?: string;
  primary_liquidity_strength?: string;

  tp_distance_pips: number;
  sl_distance_pips: number;

  recommendation_quality: 'excellent' | 'good' | 'acceptable' | 'poor';
  warnings: string[];

  session_id?: string;
  timestamp: Date;
}

export interface TPPerformanceStats {
  total_trades: number;
  avg_rr_ratio: number;
  quality_distribution: {
    excellent: number;
    good: number;
    acceptable: number;
    poor: number;
  };
  liquidity_override_success_rate: number;
  single_vs_partial: {
    single: number;
    partial: number;
  };
}

class TPQualityTracker {
  async logTPDecision(log: TPQualityLog): Promise<void> {
    try {
      const { error } = await supabase
        .from('tp_quality_logs')
        .insert({
          user_id: log.user_id,
          trade_id: log.trade_id,
          symbol: log.symbol,
          direction: log.direction,
          entry_price: log.entry_price,
          stop_loss: log.stop_loss,
          take_profit: log.take_profit,
          rr_ratio: log.rr_ratio,
          placement_type: log.placement_type,
          liquidity_zones_detected: log.liquidity_zones_detected,
          liquidity_override_used: log.liquidity_override_used,
          primary_liquidity_type: log.primary_liquidity_type,
          primary_liquidity_strength: log.primary_liquidity_strength,
          tp_distance_pips: log.tp_distance_pips,
          sl_distance_pips: log.sl_distance_pips,
          recommendation_quality: log.recommendation_quality,
          warnings: log.warnings,
          session_id: log.session_id,
          created_at: log.timestamp.toISOString()
        });

      if (error) {
        logger.error('[TP Quality Tracker] Failed to log TP decision', { error });
      } else {
        logger.info('[TP Quality Tracker] Logged TP decision', {
          symbol: log.symbol,
          rr: log.rr_ratio,
          quality: log.recommendation_quality,
          liquidity_override: log.liquidity_override_used
        });
      }
    } catch (error) {
      logger.error('[TP Quality Tracker] Exception logging TP decision', { error });
    }
  }

  async updateTPOutcome(
    tradeId: string,
    outcome: 'hit' | 'stopped_out' | 'partial_hit' | 'manual_close' | 'timeout',
    actualRR?: number,
    timeToFillMinutes?: number
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('tp_quality_logs')
        .update({
          tp_outcome: outcome,
          actual_rr: actualRR,
          time_to_fill_minutes: timeToFillMinutes,
          outcome_recorded_at: new Date().toISOString()
        })
        .eq('trade_id', tradeId);

      if (error) {
        logger.error('[TP Quality Tracker] Failed to update TP outcome', { error, tradeId });
      } else {
        logger.info('[TP Quality Tracker] Updated TP outcome', {
          tradeId,
          outcome,
          actualRR
        });
      }
    } catch (error) {
      logger.error('[TP Quality Tracker] Exception updating TP outcome', { error });
    }
  }

  async getTPPerformanceStats(userId: string, days: number = 30): Promise<TPPerformanceStats | null> {
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);

      const { data, error } = await supabase
        .from('tp_quality_logs')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', since.toISOString())
        .not('tp_outcome', 'is', null);

      if (error || !data || data.length === 0) {
        logger.warn('[TP Quality Tracker] No TP performance data found', { userId, days });
        return null;
      }

      const total = data.length;
      const avgRR = data.reduce((sum, row) => sum + (row.actual_rr || 0), 0) / total;

      const qualityDist = {
        excellent: data.filter(r => r.recommendation_quality === 'excellent').length,
        good: data.filter(r => r.recommendation_quality === 'good').length,
        acceptable: data.filter(r => r.recommendation_quality === 'acceptable').length,
        poor: data.filter(r => r.recommendation_quality === 'poor').length
      };

      const overrideTrades = data.filter(r => r.liquidity_override_used);
      const overrideHits = overrideTrades.filter(r => r.tp_outcome === 'hit' || r.tp_outcome === 'partial_hit');
      const overrideSuccessRate = overrideTrades.length > 0
        ? overrideHits.length / overrideTrades.length
        : 0;

      const singleVsPartial = {
        single: data.filter(r => r.placement_type === 'single').length,
        partial: data.filter(r => r.placement_type === 'partial').length
      };

      return {
        total_trades: total,
        avg_rr_ratio: avgRR,
        quality_distribution: qualityDist,
        liquidity_override_success_rate: overrideSuccessRate,
        single_vs_partial: singleVsPartial
      };
    } catch (error) {
      logger.error('[TP Quality Tracker] Failed to fetch TP performance stats', { error });
      return null;
    }
  }

  async getRecentTPDecisions(userId: string, limit: number = 10): Promise<TPQualityLog[]> {
    try {
      const { data, error } = await supabase
        .from('tp_quality_logs')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error || !data) {
        logger.warn('[TP Quality Tracker] No recent TP decisions found', { userId });
        return [];
      }

      return data.map(row => ({
        user_id: row.user_id,
        trade_id: row.trade_id,
        symbol: row.symbol,
        direction: row.direction,
        entry_price: row.entry_price,
        stop_loss: row.stop_loss,
        take_profit: row.take_profit,
        rr_ratio: row.rr_ratio,
        placement_type: row.placement_type,
        liquidity_zones_detected: row.liquidity_zones_detected,
        liquidity_override_used: row.liquidity_override_used,
        primary_liquidity_type: row.primary_liquidity_type,
        primary_liquidity_strength: row.primary_liquidity_strength,
        tp_distance_pips: row.tp_distance_pips,
        sl_distance_pips: row.sl_distance_pips,
        recommendation_quality: row.recommendation_quality,
        warnings: row.warnings || [],
        session_id: row.session_id,
        timestamp: new Date(row.created_at)
      }));
    } catch (error) {
      logger.error('[TP Quality Tracker] Failed to fetch recent TP decisions', { error });
      return [];
    }
  }

  extractTPMetrics(
    symbol: string,
    direction: 'long' | 'short',
    entry: number,
    sl: number,
    tp: number,
    tpCalculation?: TPCalculationResult,
    liquidityZones?: LiquidityZone[]
  ): Partial<TPQualityLog> {
    const pipValue = symbol.includes('JPY') ? 0.01 : 0.0001;
    const slDistance = Math.abs(entry - sl);
    const tpDistance = Math.abs(tp - entry);
    const rrRatio = slDistance > 0 ? tpDistance / slDistance : 0;

    const slPips = slDistance / pipValue;
    const tpPips = tpDistance / pipValue;

    let primaryLiquidityType: string | undefined;
    let primaryLiquidityStrength: string | undefined;

    if (liquidityZones && liquidityZones.length > 0) {
      const closestZone = liquidityZones.reduce((closest, zone) => {
        const zoneDistance = Math.abs(zone.price - tp);
        const closestDistance = Math.abs(closest.price - tp);
        return zoneDistance < closestDistance ? zone : closest;
      });

      primaryLiquidityType = closestZone.type;
      primaryLiquidityStrength = closestZone.strength;
    }

    return {
      symbol,
      direction,
      entry_price: entry,
      stop_loss: sl,
      take_profit: tp,
      rr_ratio: rrRatio,
      placement_type: tpCalculation?.placement_type || 'single',
      liquidity_zones_detected: liquidityZones?.length || 0,
      liquidity_override_used: tpCalculation?.liquidity_override_used || false,
      primary_liquidity_type: primaryLiquidityType,
      primary_liquidity_strength: primaryLiquidityStrength,
      tp_distance_pips: tpPips,
      sl_distance_pips: slPips,
      recommendation_quality: tpCalculation?.recommendation_quality || 'acceptable',
      warnings: tpCalculation?.warnings || []
    };
  }
}

export const tpQualityTracker = new TPQualityTracker();
