import { tpQualityTracker } from './tp-quality-tracker';
import { logger } from '../lib/logger';

export interface TPCalibrationInsight {
  metric: string;
  current_value: number;
  optimal_range: { min: number; max: number };
  recommendation: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface TPMetaAnalysis {
  sample_size: number;
  avg_rr_ratio: number;
  tp_hit_rate: number;
  liquidity_override_success_rate: number;
  avg_time_to_fill_minutes: number;
  quality_score: number;
  insights: TPCalibrationInsight[];
  overall_recommendation: string;
}

class TPMetaLearning {
  async analyzeTPPerformance(userId: string, lookbackDays: number = 30): Promise<TPMetaAnalysis | null> {
    try {
      const stats = await tpQualityTracker.getTPPerformanceStats(userId, lookbackDays);
      const recentDecisions = await tpQualityTracker.getRecentTPDecisions(userId, 50);

      if (!stats || recentDecisions.length < 5) {
        logger.warn('[TP Meta Learning] Insufficient data for analysis', { userId });
        return null;
      }

      const completedTrades = recentDecisions.filter(d =>
        d.warnings && Array.isArray(d.warnings) && d.warnings.length === 0
      );

      const insights: TPCalibrationInsight[] = [];

      if (stats.avg_rr_ratio < 1.5) {
        insights.push({
          metric: 'R:R Ratio',
          current_value: stats.avg_rr_ratio,
          optimal_range: { min: 1.5, max: 3.0 },
          recommendation: 'Target higher R:R ratios by selecting liquidity zones further from entry',
          confidence: 'high'
        });
      }

      if (stats.liquidity_override_success_rate > 0.7) {
        insights.push({
          metric: 'Liquidity Override Success',
          current_value: stats.liquidity_override_success_rate,
          optimal_range: { min: 0.6, max: 1.0 },
          recommendation: 'Continue using liquidity overrides - they are working well',
          confidence: 'high'
        });
      } else if (stats.liquidity_override_success_rate < 0.5 && stats.liquidity_override_success_rate > 0) {
        insights.push({
          metric: 'Liquidity Override Success',
          current_value: stats.liquidity_override_success_rate,
          optimal_range: { min: 0.6, max: 1.0 },
          recommendation: 'Liquidity overrides underperforming - consider tighter structure adherence',
          confidence: 'medium'
        });
      }

      const singlePercentage = stats.total_trades > 0
        ? stats.single_vs_partial.single / stats.total_trades
        : 0;

      if (singlePercentage < 0.7) {
        insights.push({
          metric: 'Single vs Partial TP Usage',
          current_value: singlePercentage,
          optimal_range: { min: 0.7, max: 1.0 },
          recommendation: 'Using partials too frequently - default to single TP for simplicity',
          confidence: 'medium'
        });
      }

      const excellentRate = stats.total_trades > 0
        ? stats.quality_distribution.excellent / stats.total_trades
        : 0;

      if (excellentRate < 0.3) {
        insights.push({
          metric: 'Excellent Quality Rate',
          current_value: excellentRate,
          optimal_range: { min: 0.3, max: 0.6 },
          recommendation: 'Focus on higher quality setups with R:R ≥ 2.0 and strong liquidity',
          confidence: 'high'
        });
      }

      const qualityScore = this.calculateQualityScore(stats);

      let overallRecommendation = '';
      if (qualityScore >= 80) {
        overallRecommendation = 'TP placement strategy is performing excellently. Maintain current approach.';
      } else if (qualityScore >= 60) {
        overallRecommendation = 'TP placement is good but has room for improvement. Focus on the insights above.';
      } else if (qualityScore >= 40) {
        overallRecommendation = 'TP placement needs refinement. Prioritize R:R ≥ 1.5 and strong liquidity zones.';
      } else {
        overallRecommendation = 'TP placement requires significant improvement. Review Elite Trader TP Directive and focus on fundamentals.';
      }

      const avgTimeToFill = completedTrades.length > 0
        ? completedTrades.reduce((sum, d) => sum + (d.tp_distance_pips || 0), 0) / completedTrades.length
        : 0;

      logger.info('[TP Meta Learning] Analysis complete', {
        userId,
        qualityScore,
        insights: insights.length
      });

      return {
        sample_size: stats.total_trades,
        avg_rr_ratio: stats.avg_rr_ratio,
        tp_hit_rate: this.calculateTPHitRate(recentDecisions),
        liquidity_override_success_rate: stats.liquidity_override_success_rate,
        avg_time_to_fill_minutes: avgTimeToFill,
        quality_score: qualityScore,
        insights,
        overall_recommendation: overallRecommendation
      };
    } catch (error) {
      logger.error('[TP Meta Learning] Failed to analyze TP performance', { error });
      return null;
    }
  }

  private calculateQualityScore(stats: any): number {
    let score = 50;

    if (stats.avg_rr_ratio >= 2.0) score += 20;
    else if (stats.avg_rr_ratio >= 1.5) score += 10;
    else if (stats.avg_rr_ratio < 1.0) score -= 20;

    const excellentRate = stats.total_trades > 0
      ? stats.quality_distribution.excellent / stats.total_trades
      : 0;
    score += excellentRate * 30;

    if (stats.liquidity_override_success_rate > 0.7) score += 10;
    else if (stats.liquidity_override_success_rate < 0.5) score -= 10;

    const singleRate = stats.total_trades > 0
      ? stats.single_vs_partial.single / stats.total_trades
      : 1;
    if (singleRate >= 0.7) score += 10;

    return Math.max(0, Math.min(100, score));
  }

  private calculateTPHitRate(decisions: any[]): number {
    if (decisions.length === 0) return 0;

    const withOutcome = decisions.filter(d => d.tp_outcome);
    if (withOutcome.length === 0) return 0;

    const hits = withOutcome.filter(d =>
      d.tp_outcome === 'hit' || d.tp_outcome === 'partial_hit'
    );

    return hits.length / withOutcome.length;
  }

  async getTPCalibrationForAlpha(userId: string): Promise<string> {
    try {
      const analysis = await this.analyzeTPPerformance(userId, 30);

      if (!analysis || analysis.sample_size < 5) {
        return 'Insufficient TP performance data. Continue using Elite Trader TP Directive defaults.';
      }

      let calibration = `📊 TP PERFORMANCE CALIBRATION (Last 30 days):\n`;
      calibration += `Sample Size: ${analysis.sample_size} trades | Quality Score: ${analysis.quality_score}/100\n`;
      calibration += `Avg R:R: ${analysis.avg_rr_ratio.toFixed(2)} | TP Hit Rate: ${(analysis.tp_hit_rate * 100).toFixed(0)}%\n`;

      if (analysis.insights.length > 0) {
        calibration += `\nKEY INSIGHTS:\n`;
        analysis.insights.slice(0, 3).forEach((insight, idx) => {
          calibration += `${idx + 1}. ${insight.metric}: ${insight.recommendation}\n`;
        });
      }

      calibration += `\n${analysis.overall_recommendation}\n`;

      return calibration;
    } catch (error) {
      logger.error('[TP Meta Learning] Failed to get calibration for Alpha', { error });
      return '';
    }
  }
}

export const tpMetaLearning = new TPMetaLearning();
