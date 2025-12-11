import { useState, useEffect } from 'react';
import { masteryCurveService, MasteryScoreData, MasteryCurveStats } from '../services/mastery-curve-service';

export interface MasteryCurveData {
  chartData: Array<{
    date: string;
    masteryScore: number;
    winRate: number;
    evScore: number;
    calibrationAccuracy: number;
    llmPassRate: number;
    avoidPatternSuccess: number;
  }>;
  currentMastery: number;
  trendPercent: number;
  trend30Day: 'up' | 'down' | 'flat';
  stats: {
    winningPatternsAdded: number;
    mistakesPrevented: number;
    confidenceAccuracy: number;
    llmSafetyActivations: number;
  };
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useMasteryCurve(userId: string | null, autoRefresh: boolean = false): MasteryCurveData {
  const [chartData, setChartData] = useState<MasteryCurveData['chartData']>([]);
  const [stats, setStats] = useState<MasteryCurveStats>({
    currentMastery: 0,
    trendPercent: 0,
    trend30Day: 'flat',
    winningPatternsAdded: 0,
    mistakesPrevented: 0,
    confidenceAccuracy: 0,
    llmSafetyActivations: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setError(null);

      const [masteryData, masteryStats] = await Promise.all([
        masteryCurveService.getMasteryCurveData(userId),
        masteryCurveService.getMasteryStats(userId)
      ]);

      const formattedChartData = masteryData.map(day => ({
        date: day.date,
        masteryScore: day.masteryScore,
        winRate: day.winRate,
        evScore: day.evScore,
        calibrationAccuracy: day.calibrationAccuracy100,
        llmPassRate: day.llmLayerPassRateAvg,
        avoidPatternSuccess: day.avoidPatternSuccessRate
      }));

      setChartData(formattedChartData);
      setStats(masteryStats);
    } catch (err) {
      console.error('[useMasteryCurve] Error loading data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load mastery data');
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    masteryCurveService.clearCache();
    setLoading(true);
    await loadData();
  };

  useEffect(() => {
    loadData();
  }, [userId]);

  useEffect(() => {
    if (!autoRefresh || !userId) return;

    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, [autoRefresh, userId]);

  return {
    chartData,
    currentMastery: stats.currentMastery,
    trendPercent: stats.trendPercent,
    trend30Day: stats.trend30Day,
    stats: {
      winningPatternsAdded: stats.winningPatternsAdded,
      mistakesPrevented: stats.mistakesPrevented,
      confidenceAccuracy: stats.confidenceAccuracy,
      llmSafetyActivations: stats.llmSafetyActivations
    },
    loading,
    error,
    refresh
  };
}
