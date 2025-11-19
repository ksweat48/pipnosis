import { supabase } from '../lib/supabase';

interface BayesianUpdate {
  priorConfidence: number;
  posteriorConfidence: number;
  evidenceStrength: number;
  updateReason: string;
  confidenceChange: number;
}

interface ConfidenceBucket {
  range: string;
  predictedWinRate: number;
  actualWinRate: number;
  trades: number;
  calibrationError: number;
}

class BayesianConfidenceUpdater {
  private readonly LEARNING_RATE = 0.15;
  private readonly MIN_SAMPLE_SIZE = 10;

  async updateConfidenceBasedOnOutcome(
    userId: string,
    symbol: string,
    predictedConfidence: number,
    actualOutcome: 'win' | 'loss' | 'breakeven',
    patternName?: string
  ): Promise<BayesianUpdate> {
    console.log(`[Bayesian Updater] Updating confidence based on ${actualOutcome} outcome`);

    const priorConfidence = predictedConfidence;

    const evidence = actualOutcome === 'win' ? 1.0 : 0.0;

    const historicalAccuracy = await this.getHistoricalAccuracy(
      userId,
      symbol,
      predictedConfidence,
      patternName
    );

    const posteriorConfidence = this.bayesianUpdate(
      priorConfidence / 100,
      evidence,
      historicalAccuracy
    ) * 100;

    const confidenceChange = posteriorConfidence - priorConfidence;

    const updateReason = this.generateUpdateReason(
      actualOutcome,
      predictedConfidence,
      historicalAccuracy,
      confidenceChange
    );

    await this.saveConfidenceUpdate(userId, symbol, {
      priorConfidence,
      posteriorConfidence,
      actualOutcome,
      patternName,
      evidenceStrength: Math.abs(confidenceChange),
      updateReason
    });

    return {
      priorConfidence,
      posteriorConfidence,
      evidenceStrength: Math.abs(confidenceChange),
      updateReason,
      confidenceChange
    };
  }

  private bayesianUpdate(prior: number, evidence: number, historicalAccuracy: number): number {
    const likelihood = evidence === 1.0 ? historicalAccuracy : (1 - historicalAccuracy);

    const marginalLikelihood =
      (historicalAccuracy * prior) +
      ((1 - historicalAccuracy) * (1 - prior));

    if (marginalLikelihood === 0) return prior;

    const posterior = (likelihood * prior) / marginalLikelihood;

    const blendedPosterior = (prior * (1 - this.LEARNING_RATE)) + (posterior * this.LEARNING_RATE);

    return Math.max(0.1, Math.min(0.95, blendedPosterior));
  }

  private async getHistoricalAccuracy(
    userId: string,
    symbol: string,
    confidence: number,
    patternName?: string
  ): Promise<number> {
    try {
      const confidenceRange = this.getConfidenceRange(confidence);

      let query = supabase
        .from('ai_trade_analysis')
        .select('outcome, entry_confidence')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .gte('entry_confidence', confidenceRange.min)
        .lte('entry_confidence', confidenceRange.max)
        .order('entry_time', { ascending: false })
        .limit(50);

      if (patternName) {
        query = query.contains('matching_historical_patterns', [patternName]);
      }

      const { data: trades } = await query;

      if (!trades || trades.length < this.MIN_SAMPLE_SIZE) {
        return confidence / 100;
      }

      const wins = trades.filter(t => t.outcome === 'win').length;
      const accuracy = wins / trades.length;

      return Math.max(0.3, Math.min(0.9, accuracy));
    } catch (error) {
      console.error('[Bayesian Updater] Error getting historical accuracy:', error);
      return confidence / 100;
    }
  }

  private getConfidenceRange(confidence: number): { min: number; max: number } {
    const bucket = Math.floor(confidence / 10) * 10;
    return {
      min: bucket - 5,
      max: bucket + 14
    };
  }

  private generateUpdateReason(
    outcome: string,
    predicted: number,
    historical: number,
    change: number
  ): string {
    const historicalPercent = (historical * 100).toFixed(1);

    if (outcome === 'win' && change > 0) {
      return `Correct prediction (${predicted}%) reinforced. Historical accuracy: ${historicalPercent}%. Increasing confidence by ${change.toFixed(1)} points.`;
    } else if (outcome === 'win' && change < 0) {
      return `Win outcome but lower than historical (${historicalPercent}%). Adjusting confidence down by ${Math.abs(change).toFixed(1)} points.`;
    } else if (outcome === 'loss' && change < 0) {
      return `Incorrect prediction (${predicted}%). Historical accuracy: ${historicalPercent}%. Decreasing confidence by ${Math.abs(change).toFixed(1)} points.`;
    } else if (outcome === 'loss' && change > 0) {
      return `Loss outcome but higher than historical expectation. Minor confidence increase of ${change.toFixed(1)} points.`;
    }

    return `Confidence adjustment: ${change >= 0 ? '+' : ''}${change.toFixed(1)} points`;
  }

  private async saveConfidenceUpdate(userId: string, symbol: string, update: any): Promise<void> {
    try {
      await supabase.from('confidence_updates').insert({
        user_id: userId,
        symbol,
        prior_confidence: update.priorConfidence,
        posterior_confidence: update.posteriorConfidence,
        actual_outcome: update.actualOutcome,
        pattern_name: update.patternName,
        evidence_strength: update.evidenceStrength,
        update_reason: update.updateReason,
        created_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('[Bayesian Updater] Error saving update:', error);
    }
  }

  async analyzeConfidenceCalibration(userId: string, symbol: string): Promise<ConfidenceBucket[]> {
    console.log(`[Bayesian Updater] Analyzing confidence calibration for ${symbol}`);

    try {
      const { data: trades } = await supabase
        .from('ai_trade_analysis')
        .select('entry_confidence, outcome')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .order('entry_time', { ascending: false })
        .limit(200);

      if (!trades || trades.length < 20) {
        return [];
      }

      const buckets = this.createConfidenceBuckets(trades);

      await this.saveCalibrationAnalysis(userId, symbol, buckets);

      return buckets;
    } catch (error) {
      console.error('[Bayesian Updater] Error analyzing calibration:', error);
      return [];
    }
  }

  private createConfidenceBuckets(trades: any[]): ConfidenceBucket[] {
    const bucketRanges = [
      { min: 50, max: 59, label: '50-59%' },
      { min: 60, max: 69, label: '60-69%' },
      { min: 70, max: 79, label: '70-79%' },
      { min: 80, max: 89, label: '80-89%' },
      { min: 90, max: 100, label: '90-100%' }
    ];

    const buckets: ConfidenceBucket[] = [];

    for (const range of bucketRanges) {
      const bucketTrades = trades.filter(t =>
        t.entry_confidence >= range.min && t.entry_confidence <= range.max
      );

      if (bucketTrades.length < 5) continue;

      const wins = bucketTrades.filter(t => t.outcome === 'win').length;
      const actualWinRate = (wins / bucketTrades.length) * 100;

      const predictedWinRate = (range.min + range.max) / 2;

      const calibrationError = Math.abs(actualWinRate - predictedWinRate);

      buckets.push({
        range: range.label,
        predictedWinRate,
        actualWinRate,
        trades: bucketTrades.length,
        calibrationError
      });
    }

    return buckets;
  }

  private async saveCalibrationAnalysis(
    userId: string,
    symbol: string,
    buckets: ConfidenceBucket[]
  ): Promise<void> {
    try {
      await supabase
        .from('confidence_calibration_analysis')
        .upsert({
          user_id: userId,
          symbol,
          calibration_buckets: buckets,
          analysis_date: new Date().toISOString(),
          total_trades: buckets.reduce((sum, b) => sum + b.trades, 0),
          avg_calibration_error: buckets.reduce((sum, b) => sum + b.calibrationError, 0) / buckets.length,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,symbol'
        });
    } catch (error) {
      console.error('[Bayesian Updater] Error saving calibration analysis:', error);
    }
  }

  async getCalibrationRecommendations(userId: string, symbol: string): Promise<string[]> {
    try {
      const { data } = await supabase
        .from('confidence_calibration_analysis')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .maybeSingle();

      if (!data || !data.calibration_buckets) {
        return ['Insufficient data for calibration recommendations'];
      }

      const recommendations: string[] = [];
      const buckets = data.calibration_buckets as ConfidenceBucket[];

      for (const bucket of buckets) {
        if (bucket.calibrationError > 15) {
          if (bucket.actualWinRate < bucket.predictedWinRate) {
            recommendations.push(
              `${bucket.range} confidence range is overconfident by ${bucket.calibrationError.toFixed(1)}%. ` +
              `Predicted ${bucket.predictedWinRate.toFixed(0)}% but actual is ${bucket.actualWinRate.toFixed(0)}%. ` +
              `Consider reducing confidence or avoiding trades in this range.`
            );
          } else {
            recommendations.push(
              `${bucket.range} confidence range is underconfident by ${bucket.calibrationError.toFixed(1)}%. ` +
              `Predicted ${bucket.predictedWinRate.toFixed(0)}% but actual is ${bucket.actualWinRate.toFixed(0)}%. ` +
              `You can be more aggressive in this range.`
            );
          }
        }
      }

      if (recommendations.length === 0) {
        recommendations.push('Confidence calibration is well-balanced across all ranges.');
      }

      return recommendations;
    } catch (error) {
      console.error('[Bayesian Updater] Error getting recommendations:', error);
      return ['Error analyzing calibration'];
    }
  }

  async getOverallCalibrationScore(userId: string, symbol: string): Promise<number> {
    try {
      const { data } = await supabase
        .from('confidence_calibration_analysis')
        .select('avg_calibration_error, total_trades')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .maybeSingle();

      if (!data || data.total_trades < 20) {
        return 50;
      }

      const error = data.avg_calibration_error;

      let score = 100;
      if (error > 20) score = 40;
      else if (error > 15) score = 60;
      else if (error > 10) score = 75;
      else if (error > 5) score = 85;
      else score = 95;

      return score;
    } catch (error) {
      console.error('[Bayesian Updater] Error calculating calibration score:', error);
      return 50;
    }
  }
}

export const bayesianConfidenceUpdater = new BayesianConfidenceUpdater();
export type { BayesianUpdate, ConfidenceBucket };
