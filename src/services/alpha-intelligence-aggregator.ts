import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { ZoneMetaLearningService } from './zone-meta-learning-service';
import { tpMetaLearning } from './tp-meta-learning';
import { sessionPhasePerformanceService, SessionPhasePerformanceRow, SetupTypeContextPerformanceRow } from './session-phase-performance-service';

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
  metaInsights: Array<{
    type: string;
    description: string;
    confidence: number;
    validated: boolean;
  }>;
  counterfactualInsights: {
    bestSlMultiplier: number | null;
    bestTpMultiplier: number | null;
    earlyExitCount: number;
    holdLongerCount: number;
    totalSampled: number;
    avgImprovementPct: number;
    sampleSize: number;
  };
  zoneMetaLearning: {
    unreachableByRegime: Record<string, number>;
    zoneTypeSuccessRates: Record<string, number>;
    reachabilityRate: number;
    downgradeRate: number;
    secondaryZoneRate: number;
  };
  tpCalibration: string;
  decisionMetrics: {
    totalDecisions: number;
    consensusResolved: number;
    consensusSuccessful: number;
    totalWins: number;
    totalLosses: number;
    totalProfitR: number;
    totalLossR: number;
  };
  tp1Learning: {
    totalTP1Events: number;
    closeEarlyWins: number;
    closeEarlyTotal: number;
    holdToTP2Wins: number;
    holdToTP2Total: number;
    avgPnlCloseEarly: number;
    avgPnlHoldToTP2: number;
  };
  validatedInsights: Array<{
    title: string;
    description: string;
    confidence: number;
    applyWhen: string[];
    avoidWhen: string[];
    winRate: number;
    sampleSize: number;
  }>;
  patternWeights: Array<{
    patternId: string;
    advisoryWeight: number;
    winRate: number;
    totalTrades: number;
  }>;
  slHuntCorrections: {
    [symbol: string]: {
      huntRate: number;
      recommendedWidenPct: number;
      confidence: number;
      totalSlHits: number;
    };
  };
  sessionStreakState: {
    sessionTrades: number;
    sessionWins: number;
    sessionLosses: number;
    currentStreak: number;
    streakType: 'win' | 'loss' | 'neutral';
    sessionPnlR: number;
  } | null;
  tpDistributionStats: {
    [symbol: string]: {
      [style: string]: {
        totalTrades: number;
        tpFullRate: number;
        tp1OnlyRate: number;
        slRate: number;
      };
    };
  };
  counterThesisAccuracy: {
    [symbol: string]: {
      avgPredictedFailureRate: number;
      actualFailureRate: number;
      calibrationError: number;
      totalTrades: number;
    };
  };
  sessionPhasePerformance: SessionPhasePerformanceRow[];
  setupTypeContextPerformance: SetupTypeContextPerformanceRow[];
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
        metaInsights,
        counterfactualInsights,
        zoneMetaLearning,
        tpCalibration,
        decisionMetrics,
        tp1Learning,
        validatedInsights,
        patternWeights,
        slHuntCorrections,
        sessionStreakState,
        tpDistributionStats,
        counterThesisAccuracy,
        sessionPhasePerformance,
        setupTypeContextPerformance
      ] = await Promise.all([
        this.getPlatformPatterns(userId),
        this.getSymbolIntelligence(userId, symbol),
        this.getExecutionQuality(userId, symbol),
        this.getCalibrationData(userId),
        this.getReasoningPatterns(userId),
        this.getMetaInsights(userId),
        this.getCounterfactualInsights(userId),
        this.getZoneMetaLearning(),
        this.getTPCalibration(userId),
        this.getDecisionMetrics(userId),
        this.getTP1Learning(userId),
        this.getValidatedInsights(userId),
        this.getPatternWeights(userId),
        this.getSlHuntCorrections(userId, symbol),
        this.getSessionStreakState(userId),
        this.getTpDistributionStats(userId, symbol),
        this.getCounterThesisAccuracy(userId, symbol),
        sessionPhasePerformanceService.getSessionPhasePerformance(userId),
        sessionPhasePerformanceService.getSetupTypePerformance(userId)
      ]);

      const snapshot: AlphaIntelligenceSnapshot = {
        platformPatterns,
        symbolIntelligence,
        executionQuality,
        calibrationData,
        reasoningPatterns,
        metaInsights,
        counterfactualInsights,
        zoneMetaLearning,
        tpCalibration,
        decisionMetrics,
        tp1Learning,
        validatedInsights,
        patternWeights,
        slHuntCorrections,
        sessionStreakState,
        tpDistributionStats,
        counterThesisAccuracy,
        sessionPhasePerformance,
        setupTypeContextPerformance
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
      metaInsights: [],
      counterfactualInsights: {
        bestSlMultiplier: null,
        bestTpMultiplier: null,
        earlyExitCount: 0,
        holdLongerCount: 0,
        totalSampled: 0,
        avgImprovementPct: 0,
        sampleSize: 0
      },
      zoneMetaLearning: {
        unreachableByRegime: {},
        zoneTypeSuccessRates: {},
        reachabilityRate: 0,
        downgradeRate: 0,
        secondaryZoneRate: 0
      },
      tpCalibration: '',
      decisionMetrics: {
        totalDecisions: 0,
        consensusResolved: 0,
        consensusSuccessful: 0,
        totalWins: 0,
        totalLosses: 0,
        totalProfitR: 0,
        totalLossR: 0
      },
      tp1Learning: {
        totalTP1Events: 0,
        closeEarlyWins: 0,
        closeEarlyTotal: 0,
        holdToTP2Wins: 0,
        holdToTP2Total: 0,
        avgPnlCloseEarly: 0,
        avgPnlHoldToTP2: 0
      },
      validatedInsights: [],
      patternWeights: [],
      slHuntCorrections: {},
      sessionStreakState: null,
      tpDistributionStats: {},
      counterThesisAccuracy: {},
      sessionPhasePerformance: [],
      setupTypeContextPerformance: []
    };
  }

  private async getCounterfactualInsights(userId: string): Promise<AlphaIntelligenceSnapshot['counterfactualInsights']> {
    const empty: AlphaIntelligenceSnapshot['counterfactualInsights'] = {
      bestSlMultiplier: null,
      bestTpMultiplier: null,
      earlyExitCount: 0,
      holdLongerCount: 0,
      totalSampled: 0,
      avgImprovementPct: 0,
      sampleSize: 0
    };

    try {
      const { data: insights, error } = await supabase
        .from('ai_counterfactual_insights')
        .select('best_sl_multiplier, best_tp_multiplier, early_exit_recommended, hold_longer_recommended, estimated_improvement_pct')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error || !insights || insights.length === 0) return empty;

      const slMultipliers = insights.filter(i => i.best_sl_multiplier).map(i => i.best_sl_multiplier as number);
      const tpMultipliers = insights.filter(i => i.best_tp_multiplier).map(i => i.best_tp_multiplier as number);
      const avgImprovement = insights.reduce((sum, i) => sum + (i.estimated_improvement_pct || 0), 0) / insights.length;
      const earlyExitCount = insights.filter(i => i.early_exit_recommended).length;
      const holdLongerCount = insights.filter(i => i.hold_longer_recommended).length;

      return {
        bestSlMultiplier: slMultipliers.length > 0 ? slMultipliers.reduce((a, b) => a + b, 0) / slMultipliers.length : null,
        bestTpMultiplier: tpMultipliers.length > 0 ? tpMultipliers.reduce((a, b) => a + b, 0) / tpMultipliers.length : null,
        earlyExitCount,
        holdLongerCount,
        totalSampled: insights.length,
        avgImprovementPct: avgImprovement,
        sampleSize: insights.length
      };
    } catch (error) {
      logger.warn('[AlphaIntelligence] Counterfactual insights fetch failed (non-blocking):', error);
      return empty;
    }
  }

  private async getZoneMetaLearning(): Promise<AlphaIntelligenceSnapshot['zoneMetaLearning']> {
    const empty: AlphaIntelligenceSnapshot['zoneMetaLearning'] = {
      unreachableByRegime: {},
      zoneTypeSuccessRates: {},
      reachabilityRate: 0,
      downgradeRate: 0,
      secondaryZoneRate: 0
    };

    try {
      const [unreachableByRegime, zoneTypeSuccessRates, reachabilityMetrics, secondaryUtil] = await Promise.all([
        ZoneMetaLearningService.getUnreachableZonesByRegime(),
        ZoneMetaLearningService.getZoneTypeSuccessRates(),
        ZoneMetaLearningService.getZoneReachabilityMetrics(),
        ZoneMetaLearningService.getSecondaryZoneUtilization()
      ]);

      return {
        unreachableByRegime,
        zoneTypeSuccessRates,
        reachabilityRate: reachabilityMetrics.reachabilityRate,
        downgradeRate: reachabilityMetrics.downgradeRate,
        secondaryZoneRate: secondaryUtil.secondaryRate
      };
    } catch (error) {
      logger.warn('[AlphaIntelligence] Zone meta learning fetch failed (non-blocking):', error);
      return empty;
    }
  }

  private async getTPCalibration(userId: string): Promise<string> {
    try {
      return await tpMetaLearning.getTPCalibrationForAlpha(userId);
    } catch (error) {
      logger.warn('[AlphaIntelligence] TP calibration fetch failed (non-blocking):', error);
      return '';
    }
  }

  private async getDecisionMetrics(userId: string): Promise<AlphaIntelligenceSnapshot['decisionMetrics']> {
    const empty: AlphaIntelligenceSnapshot['decisionMetrics'] = {
      totalDecisions: 0,
      consensusResolved: 0,
      consensusSuccessful: 0,
      totalWins: 0,
      totalLosses: 0,
      totalProfitR: 0,
      totalLossR: 0
    };

    try {
      const { data } = await supabase
        .from('alpha_learning_metrics')
        .select('total_decisions, consensus_success_rate, win_rate, profit_factor')
        .eq('user_id', userId)
        .order('period_start', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data || data.total_decisions < 5) return empty;

      const total = data.total_decisions;
      const winRateDecimal = (Number(data.win_rate) || 0) / 100;
      const totalWins = Math.round(total * winRateDecimal);
      const totalLosses = total - totalWins;
      const profitFactor = Number(data.profit_factor) || 0;
      const consensusSuccessRate = (Number(data.consensus_success_rate) || 0) / 100;

      return {
        totalDecisions: total,
        consensusResolved: total,
        consensusSuccessful: Math.round(total * consensusSuccessRate),
        totalWins,
        totalLosses,
        totalProfitR: profitFactor > 0 ? totalWins * profitFactor : 0,
        totalLossR: totalLosses
      };
    } catch (error) {
      logger.warn('[AlphaIntelligence] Decision metrics fetch failed (non-blocking):', error);
      return empty;
    }
  }

  private async getTP1Learning(userId: string): Promise<AlphaIntelligenceSnapshot['tp1Learning']> {
    const empty: AlphaIntelligenceSnapshot['tp1Learning'] = {
      totalTP1Events: 0,
      closeEarlyWins: 0,
      closeEarlyTotal: 0,
      holdToTP2Wins: 0,
      holdToTP2Total: 0,
      avgPnlCloseEarly: 0,
      avgPnlHoldToTP2: 0
    };

    try {
      const { data: tp1Events } = await supabase
        .from('tp1_learning_log')
        .select('user_decision, final_outcome, final_pnl, max_profit_after_tp1, pnl_at_tp1')
        .eq('user_id', userId)
        .not('final_outcome', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50);

      if (!tp1Events || tp1Events.length < 3) return empty;

      const closeEarly = tp1Events.filter(e => e.user_decision === 'close');
      const holdToTP2 = tp1Events.filter(e => e.user_decision === 'hold' || e.user_decision === 'continue');

      const closeEarlyWins = closeEarly.filter(e => Number(e.final_pnl) > 0).length;
      const holdToTP2Wins = holdToTP2.filter(e => Number(e.final_pnl) > 0).length;

      const avgPnlClose = closeEarly.length > 0
        ? closeEarly.reduce((sum, e) => sum + Number(e.final_pnl || 0), 0) / closeEarly.length
        : 0;
      const avgPnlHold = holdToTP2.length > 0
        ? holdToTP2.reduce((sum, e) => sum + Number(e.final_pnl || 0), 0) / holdToTP2.length
        : 0;

      return {
        totalTP1Events: tp1Events.length,
        closeEarlyWins,
        closeEarlyTotal: closeEarly.length,
        holdToTP2Wins,
        holdToTP2Total: holdToTP2.length,
        avgPnlCloseEarly: avgPnlClose,
        avgPnlHoldToTP2: avgPnlHold
      };
    } catch (error) {
      logger.warn('[AlphaIntelligence] TP1 learning fetch failed (non-blocking):', error);
      return empty;
    }
  }

  private async getValidatedInsights(userId: string): Promise<AlphaIntelligenceSnapshot['validatedInsights']> {
    try {
      const { data: insights } = await supabase
        .from('ai_learning_insights')
        .select('insight_title, insight_description, confidence_score, apply_when_conditions, avoid_when_conditions, win_rate, sample_size')
        .eq('user_id', userId)
        .gte('confidence_score', 60)
        .gte('sample_size', 5)
        .order('confidence_score', { ascending: false })
        .limit(5);

      if (!insights || insights.length === 0) return [];

      return insights.map(i => ({
        title: i.insight_title || '',
        description: i.insight_description || '',
        confidence: Number(i.confidence_score) || 0,
        applyWhen: Array.isArray(i.apply_when_conditions) ? i.apply_when_conditions : [],
        avoidWhen: Array.isArray(i.avoid_when_conditions) ? i.avoid_when_conditions : [],
        winRate: Number(i.win_rate) || 0,
        sampleSize: i.sample_size || 0
      }));
    } catch (error) {
      logger.warn('[AlphaIntelligence] Validated insights fetch failed (non-blocking):', error);
      return [];
    }
  }

  private async getPatternWeights(userId: string): Promise<AlphaIntelligenceSnapshot['patternWeights']> {
    try {
      const { data: weights } = await supabase
        .from('alpha_pattern_performance_weights')
        .select('pattern_id, advisory_weight, win_rate, total_trades')
        .eq('user_id', userId)
        .gte('total_trades', 5)
        .order('total_trades', { ascending: false })
        .limit(20);

      if (!weights || weights.length === 0) return [];

      return weights.map(w => ({
        patternId: w.pattern_id,
        advisoryWeight: Number(w.advisory_weight),
        winRate: Number(w.win_rate),
        totalTrades: w.total_trades
      }));
    } catch (error) {
      logger.warn('[AlphaIntelligence] Pattern weights fetch failed (non-blocking):', error);
      return [];
    }
  }

  private async getSlHuntCorrections(userId: string, symbol?: string): Promise<AlphaIntelligenceSnapshot['slHuntCorrections']> {
    try {
      let query = supabase
        .from('alpha_sl_hunt_bias_corrections')
        .select('symbol, hunt_rate, recommended_sl_widen_pct, confidence, total_sl_hits')
        .eq('user_id', userId)
        .gte('total_sl_hits', 3);

      if (symbol) {
        query = query.eq('symbol', symbol);
      }

      const { data: corrections } = await query;

      if (!corrections || corrections.length === 0) return {};

      const result: AlphaIntelligenceSnapshot['slHuntCorrections'] = {};
      for (const c of corrections) {
        result[c.symbol] = {
          huntRate: Number(c.hunt_rate),
          recommendedWidenPct: Number(c.recommended_sl_widen_pct),
          confidence: Number(c.confidence),
          totalSlHits: c.total_sl_hits
        };
      }
      return result;
    } catch (error) {
      logger.warn('[AlphaIntelligence] SL hunt corrections fetch failed (non-blocking):', error);
      return {};
    }
  }

  private async getSessionStreakState(userId: string): Promise<AlphaIntelligenceSnapshot['sessionStreakState']> {
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('alpha_session_streak_state')
        .select('session_trades, session_wins, session_losses, current_streak, streak_type, session_pnl_r')
        .eq('user_id', userId)
        .eq('trade_date', today)
        .maybeSingle();

      if (!data || data.session_trades === 0) return null;

      return {
        sessionTrades: data.session_trades,
        sessionWins: data.session_wins,
        sessionLosses: data.session_losses,
        currentStreak: data.current_streak,
        streakType: data.streak_type as 'win' | 'loss' | 'neutral',
        sessionPnlR: Number(data.session_pnl_r)
      };
    } catch (error) {
      logger.warn('[AlphaIntelligence] Session streak state fetch failed (non-blocking):', error);
      return null;
    }
  }

  private async getTpDistributionStats(userId: string, symbol?: string): Promise<AlphaIntelligenceSnapshot['tpDistributionStats']> {
    try {
      let query = supabase
        .from('alpha_tp_distribution_stats')
        .select('symbol, style, total_trades, tp_full_rate, tp1_only_rate, sl_rate')
        .eq('user_id', userId)
        .gte('total_trades', 5);

      if (symbol) {
        query = query.eq('symbol', symbol);
      }

      const { data: stats } = await query;

      if (!stats || stats.length === 0) return {};

      const result: AlphaIntelligenceSnapshot['tpDistributionStats'] = {};
      for (const s of stats) {
        if (!result[s.symbol]) result[s.symbol] = {};
        result[s.symbol][s.style] = {
          totalTrades: s.total_trades,
          tpFullRate: Number(s.tp_full_rate),
          tp1OnlyRate: Number(s.tp1_only_rate),
          slRate: Number(s.sl_rate)
        };
      }
      return result;
    } catch (error) {
      logger.warn('[AlphaIntelligence] TP distribution stats fetch failed (non-blocking):', error);
      return {};
    }
  }

  private async getCounterThesisAccuracy(userId: string, symbol?: string): Promise<AlphaIntelligenceSnapshot['counterThesisAccuracy']> {
    try {
      let query = supabase
        .from('alpha_counter_thesis_accuracy')
        .select('symbol, avg_predicted_failure_rate, actual_failure_rate, calibration_error, total_trades')
        .eq('user_id', userId)
        .gte('total_trades', 5);

      if (symbol) {
        query = query.eq('symbol', symbol);
      }

      const { data: records } = await query;

      if (!records || records.length === 0) return {};

      const result: AlphaIntelligenceSnapshot['counterThesisAccuracy'] = {};
      for (const r of records) {
        result[r.symbol] = {
          avgPredictedFailureRate: Number(r.avg_predicted_failure_rate),
          actualFailureRate: Number(r.actual_failure_rate),
          calibrationError: Number(r.calibration_error),
          totalTrades: r.total_trades
        };
      }
      return result;
    } catch (error) {
      logger.warn('[AlphaIntelligence] Counter-thesis accuracy fetch failed (non-blocking):', error);
      return {};
    }
  }
}

export const alphaIntelligenceAggregator = new AlphaIntelligenceAggregator();
