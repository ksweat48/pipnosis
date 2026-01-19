import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface AlphaIntelligenceSnapshot {
  platformPatterns: {
    topPerformingPatterns: Array<{
      patternId: string;
      winRate: number;
      avgRMultiple: number;
      sampleSize: number;
      marketConditions: string[];
    }>;
    failingPatterns: Array<{
      patternId: string;
      winRate: number;
      avgRMultiple: number;
      sampleSize: number;
      marketConditions: string[];
    }>;
  };
  symbolIntelligence: {
    [symbol: string]: {
      recentWinRate: number;
      avgSlippage: number;
      bestTimeframes: string[];
      bestSessions: string[];
      volatilityLevel: string;
    };
  };
  executionQuality: {
    avgSlippage: number;
    slHuntingSuspected: boolean;
    avgSpread: number;
    recentRejections: number;
  };
  calibrationData: {
    [confidenceBucket: number]: {
      actualWinRate: number;
      sampleSize: number;
      calibrationError: number;
    };
  };
  reasoningPatterns: Array<{
    patternId: string;
    description: string;
    effectiveness: number;
    usageCount: number;
    winRate: number;
  }>;
  overrideHistory: {
    totalOverrides: number;
    successRate: number;
    byType: {
      [type: string]: {
        successRate: number;
        totalCount: number;
      };
    };
  };
  metaInsights: Array<{
    type: string;
    description: string;
    confidence: number;
    actionableAdjustment: string;
    validated: boolean;
  }>;
}

export class AlphaIntelligenceAggregator {
  private cacheExpiryMinutes = 5;

  async getFullIntelligenceSnapshot(userId: string, symbol?: string): Promise<AlphaIntelligenceSnapshot> {
    try {
      const cacheKey = symbol ? `full_snapshot_${symbol}` : 'full_snapshot_all';

      const cached = await this.getCachedIntelligence(userId, cacheKey, 'platform_patterns');
      if (cached) {
        logger.info('🎯 Alpha: Using cached intelligence snapshot');
        return cached as AlphaIntelligenceSnapshot;
      }

      logger.info('🔍 Alpha: Building fresh intelligence snapshot');

      const [
        platformPatterns,
        symbolIntelligence,
        executionQuality,
        calibrationData,
        reasoningPatterns,
        overrideHistory,
        metaInsights
      ] = await Promise.all([
        this.getPlatformPatterns(userId),
        this.getSymbolIntelligence(userId, symbol),
        this.getExecutionQuality(userId, symbol),
        this.getCalibrationData(userId),
        this.getReasoningPatterns(userId),
        this.getOverrideHistory(userId),
        this.getMetaInsights(userId)
      ]);

      const snapshot: AlphaIntelligenceSnapshot = {
        platformPatterns,
        symbolIntelligence,
        executionQuality,
        calibrationData,
        reasoningPatterns,
        overrideHistory,
        metaInsights
      };

      await this.cacheIntelligence(userId, cacheKey, 'platform_patterns', snapshot);

      return snapshot;
    } catch (error) {
      logger.error('❌ Alpha Intelligence Aggregator error:', error);
      return this.getEmptySnapshot();
    }
  }

  private async getPlatformPatterns(userId: string) {
    try {
      const { data: patterns } = await supabase
        .from('ai_global_patterns')
        .select('*')
        .order('win_rate', { ascending: false })
        .limit(20);

      if (!patterns || patterns.length === 0) {
        return { topPerformingPatterns: [], failingPatterns: [] };
      }

      const topPerforming = patterns
        .filter(p => p.win_rate >= 60 && p.total_occurrences >= 10)
        .slice(0, 10)
        .map(p => ({
          patternId: p.pattern_id,
          winRate: p.win_rate,
          avgRMultiple: p.avg_rr || 0,
          sampleSize: p.total_occurrences,
          marketConditions: p.market_conditions || []
        }));

      const failing = patterns
        .filter(p => p.win_rate < 40 && p.total_occurrences >= 10)
        .slice(0, 5)
        .map(p => ({
          patternId: p.pattern_id,
          winRate: p.win_rate,
          avgRMultiple: p.avg_rr || 0,
          sampleSize: p.total_occurrences,
          marketConditions: p.market_conditions || []
        }));

      return { topPerformingPatterns: topPerforming, failingPatterns: failing };
    } catch (error) {
      logger.error('Error fetching platform patterns:', error);
      return { topPerformingPatterns: [], failingPatterns: [] };
    }
  }

  private async getSymbolIntelligence(userId: string, symbol?: string) {
    try {
      let query = supabase
        .from('ai_global_symbol_intelligence')
        .select('*')
        .gte('total_trades_platform_wide', 10);

      if (symbol) {
        query = query.eq('symbol', symbol);
      }

      const { data: intelligence } = await query;

      if (!intelligence || intelligence.length === 0) {
        return {};
      }

      const result: any = {};

      for (const intel of intelligence) {
        result[intel.symbol] = {
          recentWinRate: intel.platform_win_rate || 0,
          avgSlippage: 0,
          bestTimeframes: intel.best_timeframes || [],
          bestSessions: intel.best_session_times || [],
          volatilityLevel: intel.best_volatility_regime || 'medium'
        };
      }

      return result;
    } catch (error) {
      logger.error('Error fetching symbol intelligence:', error);
      return {};
    }
  }

  private async getExecutionQuality(userId: string, symbol?: string) {
    try {
      const query = supabase
        .from('execution_quality_log')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (symbol) {
        query.eq('symbol', symbol);
      }

      const { data: executions } = await query;

      if (!executions || executions.length === 0) {
        return {
          avgSlippage: 0,
          slHuntingSuspected: false,
          avgSpread: 0,
          recentRejections: 0
        };
      }

      const avgSlippage = executions.reduce((sum, e) => sum + (e.slippage_pips || 0), 0) / executions.length;
      const avgSpread = executions.reduce((sum, e) => sum + (e.spread_at_entry || 0), 0) / executions.length;
      const slHuntingSuspected = executions.filter(e => e.sl_hunting_suspected).length > executions.length * 0.2;
      const recentRejections = executions.filter(e => e.rejection_occurred).length;

      return {
        avgSlippage,
        slHuntingSuspected,
        avgSpread,
        recentRejections
      };
    } catch (error) {
      logger.error('Error fetching execution quality:', error);
      return {
        avgSlippage: 0,
        slHuntingSuspected: false,
        avgSpread: 0,
        recentRejections: 0
      };
    }
  }

  private async getCalibrationData(userId: string) {
    try {
      const { data: calibrations } = await supabase
        .from('alpha_confidence_calibration')
        .select('*')
        .eq('user_id', userId)
        .gte('sample_size', 5);

      if (!calibrations || calibrations.length === 0) {
        return {};
      }

      const result: any = {};
      for (const cal of calibrations) {
        result[cal.confidence_bucket] = {
          actualWinRate: cal.actual_win_rate,
          sampleSize: cal.sample_size,
          calibrationError: cal.calibration_error
        };
      }

      return result;
    } catch (error) {
      logger.error('Error fetching calibration data:', error);
      return {};
    }
  }

  private async getReasoningPatterns(userId: string) {
    try {
      const { data: patterns } = await supabase
        .from('alpha_reasoning_patterns')
        .select('*')
        .eq('user_id', userId)
        .gte('usage_count', 3)
        .order('effectiveness_score', { ascending: false })
        .limit(10);

      if (!patterns || patterns.length === 0) {
        return [];
      }

      return patterns.map(p => ({
        patternId: p.pattern_id,
        description: p.pattern_description,
        effectiveness: p.effectiveness_score || 0,
        usageCount: p.usage_count || 0,
        winRate: p.win_rate || 0
      }));
    } catch (error) {
      logger.error('Error fetching reasoning patterns:', error);
      return [];
    }
  }

  private async getOverrideHistory(userId: string) {
    try {
      const { data: overrides } = await supabase
        .from('alpha_authority_overrides')
        .select('*')
        .eq('user_id', userId);

      if (!overrides || overrides.length === 0) {
        return {
          totalOverrides: 0,
          successRate: 0,
          byType: {}
        };
      }

      const resolvedOverrides = overrides.filter(o => o.actual_outcome && o.actual_outcome !== 'pending');
      const correctOverrides = resolvedOverrides.filter(o => o.actual_outcome === 'correct');
      const successRate = resolvedOverrides.length > 0
        ? (correctOverrides.length / resolvedOverrides.length) * 100
        : 0;

      const byType: any = {};
      for (const override of overrides) {
        if (!byType[override.override_type]) {
          byType[override.override_type] = {
            totalCount: 0,
            successRate: 0,
            correct: 0,
            total: 0
          };
        }
        byType[override.override_type].totalCount++;

        if (override.actual_outcome && override.actual_outcome !== 'pending') {
          byType[override.override_type].total++;
          if (override.actual_outcome === 'correct') {
            byType[override.override_type].correct++;
          }
        }
      }

      for (const type in byType) {
        if (byType[type].total > 0) {
          byType[type].successRate = (byType[type].correct / byType[type].total) * 100;
        }
      }

      return {
        totalOverrides: overrides.length,
        successRate,
        byType
      };
    } catch (error) {
      logger.error('Error fetching override history:', error);
      return {
        totalOverrides: 0,
        successRate: 0,
        byType: {}
      };
    }
  }

  private async getMetaInsights(userId: string) {
    try {
      const { data: insights } = await supabase
        .from('alpha_meta_insights')
        .select('*')
        .eq('user_id', userId)
        .gte('confidence_in_insight', 60)
        .order('confidence_in_insight', { ascending: false })
        .limit(10);

      if (!insights || insights.length === 0) {
        return [];
      }

      return insights.map(i => ({
        type: i.insight_type,
        description: i.insight_description,
        confidence: i.confidence_in_insight,
        actionableAdjustment: i.actionable_adjustment,
        validated: i.validated || false
      }));
    } catch (error) {
      logger.error('Error fetching meta insights:', error);
      return [];
    }
  }

  private async getCachedIntelligence(userId: string, cacheKey: string, cacheType: string): Promise<any | null> {
    try {
      const { data, error } = await supabase
        .from('alpha_intelligence_cache')
        .select('cached_data, expires_at')
        .eq('user_id', userId)
        .eq('cache_key', cacheKey)
        .eq('cache_type', cacheType)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (error) {
        logger.warn(`[AlphaCache] Cache read error for ${cacheKey}:`, error.message);
        return null;
      }

      if (!data) {
        return null;
      }

      return data.cached_data;
    } catch (error) {
      logger.warn(`[AlphaCache] Unexpected cache error for ${cacheKey}:`, error);
      return null;
    }
  }

  private async cacheIntelligence(userId: string, cacheKey: string, cacheType: string, data: any): Promise<void> {
    try {
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + this.cacheExpiryMinutes);

      const { error } = await supabase
        .from('alpha_intelligence_cache')
        .upsert({
          user_id: userId,
          cache_key: cacheKey,
          cache_type: cacheType,
          cached_data: data,
          expires_at: expiresAt.toISOString()
        }, {
          onConflict: 'user_id,cache_key,cache_type'
        });

      if (error) {
        logger.warn(`[AlphaCache] Cache write failed for ${cacheKey}:`, error.message);
      }
    } catch (error) {
      logger.warn(`[AlphaCache] Cache write error for ${cacheKey} (system continues):`, error);
    }
  }

  private getEmptySnapshot(): AlphaIntelligenceSnapshot {
    return {
      platformPatterns: { topPerformingPatterns: [], failingPatterns: [] },
      symbolIntelligence: {},
      executionQuality: {
        avgSlippage: 0,
        slHuntingSuspected: false,
        avgSpread: 0,
        recentRejections: 0
      },
      calibrationData: {},
      reasoningPatterns: [],
      overrideHistory: {
        totalOverrides: 0,
        successRate: 0,
        byType: {}
      },
      metaInsights: []
    };
  }
}

export const alphaIntelligenceAggregator = new AlphaIntelligenceAggregator();
