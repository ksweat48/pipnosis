import { supabase } from '../lib/supabase';

export interface DailyMasteryData {
  date: string;
  winRate: number;
  profitFactor: number;
  evScore: number;
  calibrationAccuracy100: number;
  llmLayerPassRateAvg: number;
  avoidPatternSuccessRate: number;
  totalTrades: number;
  insightsValidated: number;
  mistakesPrevented: number;
  winningPatternsAdded: number;
}

export interface MasteryScoreData extends DailyMasteryData {
  masteryScore: number;
}

export interface MasteryCurveStats {
  currentMastery: number;
  trendPercent: number;
  trend30Day: 'up' | 'down' | 'flat';
  winningPatternsAdded: number;
  mistakesPrevented: number;
  confidenceAccuracy: number;
  llmSafetyActivations: number;
}

class MasteryCurveService {
  private cache = new Map<string, { data: any; timestamp: number }>();
  private readonly CACHE_TTL = 30000;
  private readonly MAX_DAYS = 365;

  private getCachedData(key: string): any | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }
    return null;
  }

  private setCachedData(key: string, data: any): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  async getMasteryCurveData(userId: string): Promise<MasteryScoreData[]> {
    const cacheKey = `mastery-curve-${userId}`;
    const cached = this.getCachedData(cacheKey);
    if (cached) return cached;

    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - this.MAX_DAYS);

      const [
        performanceData,
        calibrationData,
        insightsData,
        avoidPatternsData,
        llmLayerData,
        evData
      ] = await Promise.all([
        this.fetchPerformanceEvolution(userId, startDate),
        this.fetchCalibrationData(userId, startDate),
        this.fetchInsightsData(userId, startDate),
        this.fetchAvoidPatternsData(userId, startDate),
        this.fetchLLMLayerData(userId, startDate),
        this.fetchEVData(userId, startDate)
      ]);

      const mergedData = this.mergeDataByDate(
        performanceData,
        calibrationData,
        insightsData,
        avoidPatternsData,
        llmLayerData,
        evData
      );

      const masteryData = mergedData.map(day => ({
        ...day,
        masteryScore: this.calculateMasteryScore(day)
      }));

      this.setCachedData(cacheKey, masteryData);
      return masteryData;
    } catch (error) {
      console.error('[Mastery Curve] Error fetching data:', error);
      throw error;
    }
  }

  private async fetchPerformanceEvolution(userId: string, startDate: Date) {
    const { data, error } = await supabase
      .from('ai_performance_evolution')
      .select('measurement_date, win_rate, profit_factor, total_trades, insights_applied')
      .eq('user_id', userId)
      .eq('period_type', 'daily')
      .gte('measurement_date', startDate.toISOString().split('T')[0])
      .order('measurement_date', { ascending: true });

    if (error) {
      console.warn('[Mastery Curve] Performance Evolution not available:', error.message);
      return [];
    }
    return data || [];
  }

  private async fetchCalibrationData(userId: string, startDate: Date) {
    const { data, error } = await supabase
      .from('ai_confidence_performance')
      .select('window_end_time, accuracy_percentage, calibration_score_avg')
      .eq('user_id', userId)
      .in('window_type', ['last_100', 'daily'])
      .gte('window_end_time', startDate.toISOString())
      .order('window_end_time', { ascending: true });

    if (error) {
      console.warn('[Mastery Curve] Confidence Performance not available:', error.message);
      return [];
    }
    return data || [];
  }

  private async fetchInsightsData(userId: string, startDate: Date) {
    const { data, error } = await supabase
      .from('ai_learning_insights')
      .select('created_at, insight_type, times_applied, confidence_score')
      .eq('user_id', userId)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('[Mastery Curve] AI Learning Insights not available:', error.message);
      return [];
    }

    const aggregated = new Map<string, any>();
    (data || []).forEach(insight => {
      const date = insight.created_at.split('T')[0];
      if (!aggregated.has(date)) {
        aggregated.set(date, {
          date,
          positiveCount: 0,
          negativeCount: 0,
          validatedCount: 0,
          prunedCount: 0
        });
      }
      const agg = aggregated.get(date);
      if (insight.insight_type === 'positive') agg.positiveCount++;
      if (insight.insight_type === 'negative') agg.negativeCount++;
      if (insight.times_applied > 0) agg.validatedCount++;
      if (insight.confidence_score < 50) agg.prunedCount++;
    });

    return Array.from(aggregated.values());
  }

  private async fetchAvoidPatternsData(userId: string, startDate: Date) {
    const { data, error } = await supabase
      .from('avoid_pattern_enforcement_log')
      .select('timestamp, was_blocked, highest_similarity_score')
      .eq('user_id', userId)
      .gte('timestamp', startDate.toISOString())
      .order('timestamp', { ascending: true });

    if (error) {
      console.warn('[Mastery Curve] Avoid Pattern Log not available:', error.message);
      return [];
    }

    const aggregated = new Map<string, any>();
    (data || []).forEach(log => {
      const date = log.timestamp.split('T')[0];
      if (!aggregated.has(date)) {
        aggregated.set(date, {
          date,
          blockedCount: 0,
          allowedCount: 0,
          totalSimilarity: 0,
          count: 0
        });
      }
      const agg = aggregated.get(date);
      if (log.was_blocked) {
        agg.blockedCount++;
      } else {
        agg.allowedCount++;
      }
      agg.totalSimilarity += log.highest_similarity_score || 0;
      agg.count++;
    });

    return Array.from(aggregated.values());
  }

  private async fetchLLMLayerData(userId: string, startDate: Date) {
    const { data, error } = await supabase
      .from('llm_layer_kpis')
      .select('date, pass_rate, pass_count, reject_count')
      .eq('user_id', userId)
      .gte('date', startDate.toISOString().split('T')[0])
      .order('date', { ascending: true });

    if (error) {
      console.warn('[Mastery Curve] LLM Layer KPIs not available:', error.message);
      return [];
    }

    const aggregated = new Map<string, any>();
    (data || []).forEach(kpi => {
      const date = kpi.date;
      if (!aggregated.has(date)) {
        aggregated.set(date, {
          date,
          totalPassRate: 0,
          count: 0,
          totalPasses: 0,
          totalRejects: 0
        });
      }
      const agg = aggregated.get(date);
      agg.totalPassRate += kpi.pass_rate || 0;
      agg.totalPasses += kpi.pass_count || 0;
      agg.totalRejects += kpi.reject_count || 0;
      agg.count++;
    });

    return Array.from(aggregated.values()).map(agg => ({
      date: agg.date,
      avgPassRate: agg.count > 0 ? agg.totalPassRate / agg.count : 0,
      totalPasses: agg.totalPasses,
      totalRejects: agg.totalRejects
    }));
  }

  private async fetchEVData(userId: string, startDate: Date) {
    const { data, error } = await supabase
      .from('synthetic_backtest_trades')
      .select('entry_time, outcome, pnl')
      .eq('user_id', userId)
      .gte('entry_time', startDate.toISOString())
      .order('entry_time', { ascending: true });

    if (error) {
      const { data: liveData } = await supabase
        .from('trade_history')
        .select('created_at, outcome, pnl')
        .eq('user_id', userId)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: true });

      if (!liveData) return [];

      const aggregated = new Map<string, any>();
      liveData.forEach(trade => {
        const date = trade.created_at.split('T')[0];
        if (!aggregated.has(date)) {
          aggregated.set(date, { date, totalEV: 0, count: 0 });
        }
        const agg = aggregated.get(date);
        agg.totalEV += trade.pnl || 0;
        agg.count++;
      });

      return Array.from(aggregated.values()).map(agg => ({
        date: agg.date,
        dailyEV: agg.count > 0 ? agg.totalEV / agg.count : 0
      }));
    }

    const aggregated = new Map<string, any>();
    (data || []).forEach(trade => {
      const date = trade.entry_time.split('T')[0];
      if (!aggregated.has(date)) {
        aggregated.set(date, { date, totalEV: 0, count: 0 });
      }
      const agg = aggregated.get(date);
      agg.totalEV += trade.pnl || 0;
      agg.count++;
    });

    return Array.from(aggregated.values()).map(agg => ({
      date: agg.date,
      dailyEV: agg.count > 0 ? agg.totalEV / agg.count : 0
    }));
  }

  private mergeDataByDate(
    performance: any[],
    calibration: any[],
    insights: any[],
    avoidPatterns: any[],
    llmLayers: any[],
    evData: any[]
  ): DailyMasteryData[] {
    const dateMap = new Map<string, DailyMasteryData>();

    performance.forEach(p => {
      dateMap.set(p.measurement_date, {
        date: p.measurement_date,
        winRate: p.win_rate || 50,
        profitFactor: p.profit_factor || 1.0,
        evScore: 0,
        calibrationAccuracy100: 70,
        llmLayerPassRateAvg: 80,
        avoidPatternSuccessRate: 0,
        totalTrades: p.total_trades || 0,
        insightsValidated: p.insights_applied || 0,
        mistakesPrevented: 0,
        winningPatternsAdded: 0
      });
    });

    calibration.forEach(c => {
      const date = c.window_end_time.split('T')[0];
      const existing = dateMap.get(date);
      if (existing) {
        existing.calibrationAccuracy100 = c.accuracy_percentage || 70;
      }
    });

    insights.forEach(i => {
      const existing = dateMap.get(i.date);
      if (existing) {
        existing.insightsValidated = i.validatedCount || 0;
        existing.winningPatternsAdded = i.positiveCount || 0;
      }
    });

    avoidPatterns.forEach(a => {
      const existing = dateMap.get(a.date);
      if (existing) {
        existing.mistakesPrevented = a.blockedCount || 0;
        const total = a.blockedCount + a.allowedCount;
        existing.avoidPatternSuccessRate = total > 0 ? (a.blockedCount / total) * 100 : 0;
      }
    });

    llmLayers.forEach(l => {
      const existing = dateMap.get(l.date);
      if (existing) {
        existing.llmLayerPassRateAvg = l.avgPassRate || 80;
      }
    });

    evData.forEach(e => {
      const existing = dateMap.get(e.date);
      if (existing) {
        existing.evScore = this.normalizeEV(e.dailyEV);
      }
    });

    return Array.from(dateMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date)
    );
  }

  calculateMasteryScore(data: DailyMasteryData): number {
    const winRateScore = data.winRate;

    const profitFactorNormalized = Math.min(data.profitFactor / 3, 1) * 100;

    const evScore = data.evScore;

    const calibrationScore = data.calibrationAccuracy100;

    const avoidPatternSuccess = data.avoidPatternSuccessRate;

    const llmLayerScore = data.llmLayerPassRateAvg;

    const masteryScore =
      (winRateScore * 0.25) +
      (profitFactorNormalized * 0.20) +
      (evScore * 0.20) +
      (calibrationScore * 0.15) +
      (avoidPatternSuccess * 0.10) +
      (llmLayerScore * 0.10);

    return Math.round(masteryScore * 10) / 10;
  }

  private normalizeEV(evValue: number): number {
    if (evValue >= 100) return 100;
    if (evValue <= -50) return 0;
    return ((evValue + 50) / 150) * 100;
  }

  async getMasteryStats(userId: string): Promise<MasteryCurveStats> {
    try {
      const data = await this.getMasteryCurveData(userId);

      if (data.length === 0) {
        return {
          currentMastery: 0,
          trendPercent: 0,
          trend30Day: 'flat',
          winningPatternsAdded: 0,
          mistakesPrevented: 0,
          confidenceAccuracy: 0,
          llmSafetyActivations: 0
        };
      }

      const currentMastery = data[data.length - 1].masteryScore;

      const thirtyDaysAgo = data.length > 30 ? data[data.length - 30] : data[0];
      const trendPercent = currentMastery - thirtyDaysAgo.masteryScore;

      const trend30Day =
        trendPercent > 1 ? 'up' :
        trendPercent < -1 ? 'down' :
        'flat';

      const last30Days = data.slice(-30);
      const winningPatternsAdded = last30Days.reduce((sum, d) => sum + d.winningPatternsAdded, 0);
      const mistakesPrevented = last30Days.reduce((sum, d) => sum + d.mistakesPrevented, 0);
      const avgConfidence = last30Days.reduce((sum, d) => sum + d.calibrationAccuracy100, 0) / last30Days.length;

      const llmActivations = last30Days.reduce((sum, d) => sum + d.mistakesPrevented, 0);
      const llmSafetyActivations = Math.round(llmActivations / 30 * 10) / 10;

      return {
        currentMastery,
        trendPercent,
        trend30Day,
        winningPatternsAdded,
        mistakesPrevented,
        confidenceAccuracy: avgConfidence,
        llmSafetyActivations
      };
    } catch (error) {
      console.error('[Mastery Curve] Error calculating stats:', error);
      return {
        currentMastery: 0,
        trendPercent: 0,
        trend30Day: 'flat',
        winningPatternsAdded: 0,
        mistakesPrevented: 0,
        confidenceAccuracy: 0,
        llmSafetyActivations: 0
      };
    }
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const masteryCurveService = new MasteryCurveService();
