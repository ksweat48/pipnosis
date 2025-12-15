/**
 * Alpha Meta-Learning Engine
 *
 * Analyzes Alpha's own performance to discover patterns about its decision-making.
 * This is "learning about learning" - understanding WHEN and WHY Alpha succeeds or fails.
 *
 * Key Questions:
 * - Which market conditions does Alpha excel in?
 * - Which reasoning patterns are most effective?
 * - When should Alpha be more/less confident?
 * - What are Alpha's blind spots?
 * - How is Alpha improving over time?
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface MetaLearningReport {
  performanceTrends: {
    winRateTrend: 'improving' | 'declining' | 'stable';
    confidenceTrend: 'improving' | 'declining' | 'stable';
    profitFactorTrend: 'improving' | 'declining' | 'stable';
  };
  strengthAreas: Array<{
    area: string;
    winRate: number;
    sampleSize: number;
    confidence: number;
  }>;
  weaknessAreas: Array<{
    area: string;
    winRate: number;
    sampleSize: number;
    confidence: number;
  }>;
  calibrationQuality: {
    overallError: number; // Average calibration error across buckets
    overconfidentBuckets: number[]; // Buckets where predicted > actual
    underconfidentBuckets: number[]; // Buckets where predicted < actual
    wellCalibratedBuckets: number[];
  };
  learningVelocity: {
    recentWinRate: number; // Last 20 trades
    historicalWinRate: number; // All trades
    improvement: number; // Percentage points improvement
    tradesAnalyzed: number;
  };
  insights: string[];
}

export class AlphaMetaLearningEngine {
  /**
   * Generate comprehensive meta-learning report
   */
  async generateMetaLearningReport(userId: string): Promise<MetaLearningReport> {
    logger.info('[Alpha Meta] Generating meta-learning report');

    try {
      const [
        performanceTrends,
        strengthAreas,
        weaknessAreas,
        calibrationQuality,
        learningVelocity
      ] = await Promise.all([
        this.analyzePerformanceTrends(userId),
        this.identifyStrengthAreas(userId),
        this.identifyWeaknessAreas(userId),
        this.analyzeCalibrationQuality(userId),
        this.calculateLearningVelocity(userId)
      ]);

      const insights = this.generateInsights(
        performanceTrends,
        strengthAreas,
        weaknessAreas,
        calibrationQuality,
        learningVelocity
      );

      return {
        performanceTrends,
        strengthAreas,
        weaknessAreas,
        calibrationQuality,
        learningVelocity,
        insights
      };
    } catch (error) {
      logger.error('[Alpha Meta] Failed to generate meta-learning report:', error);
      return this.getEmptyReport();
    }
  }

  /**
   * Analyze performance trends over time
   */
  private async analyzePerformanceTrends(userId: string) {
    try {
      const { data: trades } = await supabase
        .from('goal_trades')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(100);

      if (!trades || trades.length < 20) {
        return {
          winRateTrend: 'stable' as const,
          confidenceTrend: 'stable' as const,
          profitFactorTrend: 'stable' as const
        };
      }

      // Split into first half and second half
      const midpoint = Math.floor(trades.length / 2);
      const firstHalf = trades.slice(0, midpoint);
      const secondHalf = trades.slice(midpoint);

      // Win rate trend
      const firstWinRate = this.calculateWinRate(firstHalf);
      const secondWinRate = this.calculateWinRate(secondHalf);
      const winRateDiff = secondWinRate - firstWinRate;

      // Confidence calibration trend
      const firstCalError = this.calculateCalibrationError(firstHalf);
      const secondCalError = this.calculateCalibrationError(secondHalf);
      const confidenceDiff = firstCalError - secondCalError; // Lower error = improvement

      // Profit factor trend
      const firstPF = this.calculateProfitFactor(firstHalf);
      const secondPF = this.calculateProfitFactor(secondHalf);
      const pfDiff = secondPF - firstPF;

      return {
        winRateTrend: winRateDiff > 5 ? 'improving' : winRateDiff < -5 ? 'declining' : 'stable',
        confidenceTrend: confidenceDiff > 5 ? 'improving' : confidenceDiff < -5 ? 'declining' : 'stable',
        profitFactorTrend: pfDiff > 0.2 ? 'improving' : pfDiff < -0.2 ? 'declining' : 'stable'
      };
    } catch (error) {
      logger.error('[Alpha Meta] Failed to analyze performance trends:', error);
      return {
        winRateTrend: 'stable' as const,
        confidenceTrend: 'stable' as const,
        profitFactorTrend: 'stable' as const
      };
    }
  }

  /**
   * Identify strength areas from meta-insights
   */
  private async identifyStrengthAreas(userId: string) {
    try {
      const { data: insights } = await supabase
        .from('alpha_meta_insights')
        .select('*')
        .eq('user_id', userId)
        .eq('insight_type', 'strength')
        .eq('validated', true)
        .order('confidence_in_insight', { ascending: false })
        .limit(5);

      if (!insights || insights.length === 0) {
        return [];
      }

      return insights.map(i => ({
        area: i.insight_description,
        winRate: i.improvement_seen || 0,
        sampleSize: (i.supporting_evidence as any)?.sample_size || 0,
        confidence: i.confidence_in_insight
      }));
    } catch (error) {
      logger.error('[Alpha Meta] Failed to identify strength areas:', error);
      return [];
    }
  }

  /**
   * Identify weakness areas from meta-insights
   */
  private async identifyWeaknessAreas(userId: string) {
    try {
      const { data: insights } = await supabase
        .from('alpha_meta_insights')
        .select('*')
        .eq('user_id', userId)
        .eq('insight_type', 'weakness')
        .eq('validated', true)
        .order('confidence_in_insight', { ascending: false })
        .limit(5);

      if (!insights || insights.length === 0) {
        return [];
      }

      return insights.map(i => ({
        area: i.insight_description,
        winRate: i.improvement_seen || 0,
        sampleSize: (i.supporting_evidence as any)?.sample_size || 0,
        confidence: i.confidence_in_insight
      }));
    } catch (error) {
      logger.error('[Alpha Meta] Failed to identify weakness areas:', error);
      return [];
    }
  }

  /**
   * Analyze calibration quality across confidence buckets
   */
  private async analyzeCalibrationQuality(userId: string) {
    try {
      const { data: calibrations } = await supabase
        .from('alpha_confidence_calibration')
        .select('*')
        .eq('user_id', userId)
        .gte('sample_size', 5);

      if (!calibrations || calibrations.length === 0) {
        return {
          overallError: 0,
          overconfidentBuckets: [],
          underconfidentBuckets: [],
          wellCalibratedBuckets: []
        };
      }

      const overallError = calibrations.reduce((sum, c) => sum + c.calibration_error, 0) / calibrations.length;
      const overconfident = calibrations.filter(c => c.predicted_win_rate > c.actual_win_rate + 10).map(c => c.confidence_bucket);
      const underconfident = calibrations.filter(c => c.predicted_win_rate < c.actual_win_rate - 10).map(c => c.confidence_bucket);
      const wellCalibrated = calibrations.filter(c => Math.abs(c.predicted_win_rate - c.actual_win_rate) <= 10).map(c => c.confidence_bucket);

      return {
        overallError,
        overconfidentBuckets: overconfident,
        underconfidentBuckets: underconfident,
        wellCalibratedBuckets: wellCalibrated
      };
    } catch (error) {
      logger.error('[Alpha Meta] Failed to analyze calibration quality:', error);
      return {
        overallError: 0,
        overconfidentBuckets: [],
        underconfidentBuckets: [],
        wellCalibratedBuckets: []
      };
    }
  }

  /**
   * Calculate learning velocity (rate of improvement)
   */
  private async calculateLearningVelocity(userId: string) {
    try {
      const { data: trades } = await supabase
        .from('goal_trades')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (!trades || trades.length < 10) {
        return {
          recentWinRate: 0,
          historicalWinRate: 0,
          improvement: 0,
          tradesAnalyzed: 0
        };
      }

      const recent20 = trades.slice(0, Math.min(20, trades.length));
      const recentWinRate = this.calculateWinRate(recent20);
      const historicalWinRate = this.calculateWinRate(trades);
      const improvement = recentWinRate - historicalWinRate;

      return {
        recentWinRate,
        historicalWinRate,
        improvement,
        tradesAnalyzed: trades.length
      };
    } catch (error) {
      logger.error('[Alpha Meta] Failed to calculate learning velocity:', error);
      return {
        recentWinRate: 0,
        historicalWinRate: 0,
        improvement: 0,
        tradesAnalyzed: 0
      };
    }
  }

  /**
   * Generate actionable insights from meta-analysis
   */
  private generateInsights(
    trends: any,
    strengths: any[],
    weaknesses: any[],
    calibration: any,
    velocity: any
  ): string[] {
    const insights: string[] = [];

    // Trend insights
    if (trends.winRateTrend === 'improving') {
      insights.push(`✅ Win rate improving over time (+${velocity.improvement.toFixed(1)}pp in recent trades)`);
    } else if (trends.winRateTrend === 'declining') {
      insights.push(`⚠️ Win rate declining - review recent pattern changes`);
    }

    // Calibration insights
    if (calibration.overallError < 10) {
      insights.push(`✅ Well-calibrated confidence (${calibration.overallError.toFixed(1)}% avg error)`);
    } else if (calibration.overconfidentBuckets.length > 2) {
      insights.push(`⚠️ Overconfident in ${calibration.overconfidentBuckets.join(', ')}% buckets - reduce confidence`);
    }

    // Strength insights
    if (strengths.length > 0) {
      const topStrength = strengths[0];
      insights.push(`💪 Strong performance: ${topStrength.area} (${topStrength.winRate.toFixed(1)}% WR)`);
    }

    // Weakness insights
    if (weaknesses.length > 0) {
      const topWeakness = weaknesses[0];
      insights.push(`⚠️ Weakness detected: ${topWeakness.area} (${topWeakness.winRate.toFixed(1)}% WR) - avoid or improve`);
    }

    // Learning velocity insights
    if (velocity.improvement > 10) {
      insights.push(`🚀 Rapid improvement detected (+${velocity.improvement.toFixed(1)}pp in last 20 trades)`);
    } else if (velocity.improvement < -10) {
      insights.push(`⚠️ Performance regression detected (-${Math.abs(velocity.improvement).toFixed(1)}pp) - analyze recent changes`);
    }

    if (insights.length === 0) {
      insights.push('📊 Stable performance - continue current strategy');
    }

    return insights;
  }

  // Helper methods
  private calculateWinRate(trades: any[]): number {
    if (trades.length === 0) return 0;
    const wins = trades.filter(t =>
      t.close_reason === 'tp_hit' || (t.close_reason === 'manual_close' && (t.realized_pnl || 0) > 0)
    ).length;
    return (wins / trades.length) * 100;
  }

  private calculateCalibrationError(trades: any[]): number {
    if (trades.length === 0) return 0;
    const withConfidence = trades.filter(t => t.ai_confidence);
    if (withConfidence.length === 0) return 0;

    const errors = withConfidence.map(t => {
      const wasCorrect = t.close_reason === 'tp_hit' || (t.close_reason === 'manual_close' && (t.realized_pnl || 0) > 0);
      const predicted = t.ai_confidence;
      const actual = wasCorrect ? 100 : 0;
      return Math.abs(predicted - actual);
    });

    return errors.reduce((sum, e) => sum + e, 0) / errors.length;
  }

  private calculateProfitFactor(trades: any[]): number {
    const wins = trades.filter(t => (t.realized_pnl || 0) > 0);
    const losses = trades.filter(t => (t.realized_pnl || 0) < 0);

    if (losses.length === 0) return wins.length > 0 ? 999 : 1;

    const totalWins = wins.reduce((sum, t) => sum + (t.realized_pnl || 0), 0);
    const totalLosses = Math.abs(losses.reduce((sum, t) => sum + (t.realized_pnl || 0), 0));

    return totalLosses > 0 ? totalWins / totalLosses : 1;
  }

  private getEmptyReport(): MetaLearningReport {
    return {
      performanceTrends: {
        winRateTrend: 'stable',
        confidenceTrend: 'stable',
        profitFactorTrend: 'stable'
      },
      strengthAreas: [],
      weaknessAreas: [],
      calibrationQuality: {
        overallError: 0,
        overconfidentBuckets: [],
        underconfidentBuckets: [],
        wellCalibratedBuckets: []
      },
      learningVelocity: {
        recentWinRate: 0,
        historicalWinRate: 0,
        improvement: 0,
        tradesAnalyzed: 0
      },
      insights: ['Not enough data yet - need at least 20 trades for meta-analysis']
    };
  }
}

export const alphaMetaLearning = new AlphaMetaLearningEngine();
