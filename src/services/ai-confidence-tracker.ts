import { supabase } from '../lib/supabase';

/**
 * AI Confidence Prediction Accuracy Tracker
 *
 * Measures how well the AI's confidence predictions match actual trade outcomes.
 * Tracks calibration, accuracy trends, and improvement over time.
 */

export interface ConfidenceCalibrationData {
  tradeId: string;
  tradeSource: 'synthetic' | 'live' | 'backtest';
  predictedConfidence: number;
  confidenceBucket: string;
  actualOutcome: 'win' | 'loss' | 'breakeven';
  wasAccurate: boolean;
  confidenceError: number;
  calibrationScore: number;
  symbol: string;
  entryTime: Date;
}

export interface ConfidencePerformanceWindow {
  windowType: 'last_10' | 'last_30' | 'last_100' | 'session' | 'daily' | 'all_time';
  totalTrades: number;
  accuratePredictions: number;
  accuracyPercentage: number;
  overallCalibrationScore: number;
  calibrationByBucket: Record<string, number>;
  averageConfidenceError: number;
  isImproving: boolean;
  improvementRate: number;
  trendDirection: 'improving' | 'stable' | 'declining';
  overconfidentTrades: number;
  underconfidentTrades: number;
  wellCalibratedTrades: number;
}

export interface Last10TradesData {
  trades: Array<{
    tradeId: string;
    symbol: string;
    confidence: number;
    outcome: 'win' | 'loss' | 'breakeven';
    wasAccurate: boolean;
    pnl: number;
    entryTime: Date;
    sessionId?: string;
    sessionName?: string;
  }>;
  accuracyPercentage: number;
  improvementVsPrevious10: number;
  trend: 'improving' | 'stable' | 'declining';
  mostRecentSessionName?: string;
  totalTradesInRecentSession?: number;
}

class AIConfidenceTracker {
  /**
   * Record confidence prediction for a trade
   */
  async recordConfidencePrediction(
    userId: string,
    tradeId: string,
    tradeSource: 'synthetic' | 'live' | 'backtest',
    sessionId: string | null,
    predictedConfidence: number,
    actualOutcome: 'win' | 'loss' | 'breakeven',
    pnl: number,
    symbol: string,
    timeframe: string,
    entryTime: Date,
    exitTime: Date | null
  ): Promise<void> {
    try {
      const confidenceBucket = this.getConfidenceBucket(predictedConfidence);
      const wasAccurate = this.isConfidenceAccurate(predictedConfidence, actualOutcome);
      const confidenceError = this.calculateConfidenceError(predictedConfidence, actualOutcome);
      const calibrationScore = this.calculateCalibrationScore(predictedConfidence, actualOutcome);

      const { error } = await supabase
        .from('ai_confidence_calibration')
        .insert({
          user_id: userId,
          trade_id: tradeId,
          trade_source: tradeSource,
          session_id: sessionId,
          predicted_confidence: predictedConfidence,
          confidence_bucket: confidenceBucket,
          actual_outcome: actualOutcome,
          pnl: pnl,
          was_accurate: wasAccurate,
          confidence_error: confidenceError,
          calibration_score: calibrationScore,
          symbol: symbol,
          timeframe: timeframe,
          entry_time: entryTime.toISOString(),
          exit_time: exitTime?.toISOString() || null
        });

      if (error) {
        console.error('[Confidence Tracker] Error recording prediction:', error);
      } else {
        console.log(`[Confidence Tracker] Recorded prediction: ${predictedConfidence}% confidence, ${actualOutcome}, accurate: ${wasAccurate}`);
      }

      // Update rolling windows after each new trade
      await this.updateRollingWindows(userId);
    } catch (error) {
      console.error('[Confidence Tracker] Error in recordConfidencePrediction:', error);
    }
  }

  /**
   * Get confidence bucket (0-20, 20-40, etc.)
   */
  private getConfidenceBucket(confidence: number): string {
    if (confidence >= 0 && confidence < 20) return '0-20';
    if (confidence >= 20 && confidence < 40) return '20-40';
    if (confidence >= 40 && confidence < 60) return '40-60';
    if (confidence >= 60 && confidence < 80) return '60-80';
    if (confidence >= 80 && confidence <= 100) return '80-100';
    return 'unknown';
  }

  /**
   * Determine if confidence prediction was accurate
   * NOTE: Breakeven trades are excluded from accuracy calculations (return false)
   */
  private isConfidenceAccurate(confidence: number, outcome: string): boolean {
    // Breakeven trades are NOT counted in accuracy - they provide no signal
    if (outcome === 'breakeven') return false;

    // High confidence (>= 70) should result in wins
    if (confidence >= 70 && outcome === 'win') return true;

    // Low confidence (< 50) is okay with losses
    if (confidence < 50 && outcome === 'loss') return true;

    // Medium confidence (50-70) with any outcome is considered reasonable
    if (confidence >= 50 && confidence < 70) return true;

    return false;
  }

  /**
   * Calculate confidence error (difference between predicted and actual)
   */
  private calculateConfidenceError(confidence: number, outcome: string): number {
    // Convert outcome to expected probability
    let actualProbability = 0;
    if (outcome === 'win') actualProbability = 100;
    if (outcome === 'loss') actualProbability = 0;
    if (outcome === 'breakeven') actualProbability = 50;

    return Math.abs(confidence - actualProbability);
  }

  /**
   * Calculate calibration score (0-100, higher is better)
   */
  private calculateCalibrationScore(confidence: number, outcome: string): number {
    const error = this.calculateConfidenceError(confidence, outcome);
    // Convert error to score: 0 error = 100 score, 100 error = 0 score
    return Math.max(0, 100 - error);
  }

  /**
   * Get last N trades with confidence data
   * Shows most recent completed session's trades (up to 20 trades)
   */
  async getLast10TradesConfidence(userId: string): Promise<Last10TradesData> {
    try {
      // First, get the most recent session
      const { data: recentSession } = await supabase
        .from('synthetic_backtest_sessions')
        .select('id, session_name, total_trades, completed_at')
        .eq('user_id', userId)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Fetch trades from most recent session (limit to 20 for display)
      const { data: trades, error } = await supabase
        .from('ai_confidence_calibration')
        .select('*')
        .eq('user_id', userId)
        .eq('session_id', recentSession?.id || '')
        .order('entry_time', { ascending: false })
        .limit(20);

      if (error) throw error;

      if (!trades || trades.length === 0) {
        return {
          trades: [],
          accuracyPercentage: 0,
          improvementVsPrevious10: 0,
          trend: 'stable'
        };
      }

      // Calculate accuracy for these trades (excluding breakeven trades)
      const nonBreakevenTrades = trades.filter(t => t.actual_outcome !== 'breakeven');
      const accurateTrades = nonBreakevenTrades.filter(t => t.was_accurate).length;
      const accuracyPercentage = nonBreakevenTrades.length > 0
        ? (accurateTrades / nonBreakevenTrades.length) * 100
        : 0;

      // Fetch previous session for comparison
      const { data: previousSession } = await supabase
        .from('synthetic_backtest_sessions')
        .select('id')
        .eq('user_id', userId)
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .range(1, 1)
        .maybeSingle();

      let improvementVsPrevious10 = 0;
      let trend: 'improving' | 'stable' | 'declining' = 'stable';

      if (previousSession) {
        const { data: previousTrades } = await supabase
          .from('ai_confidence_calibration')
          .select('was_accurate, actual_outcome')
          .eq('user_id', userId)
          .eq('session_id', previousSession.id);

        if (previousTrades && previousTrades.length > 0) {
          const previousNonBreakeven = previousTrades.filter(t => t.actual_outcome !== 'breakeven');
          const previousAccuracy = previousNonBreakeven.length > 0
            ? (previousNonBreakeven.filter(t => t.was_accurate).length / previousNonBreakeven.length) * 100
            : 0;
          improvementVsPrevious10 = accuracyPercentage - previousAccuracy;

          if (improvementVsPrevious10 > 5) trend = 'improving';
          else if (improvementVsPrevious10 < -5) trend = 'declining';
        }
      }

      return {
        trades: trades.map(t => ({
          tradeId: t.trade_id,
          symbol: t.symbol,
          confidence: t.predicted_confidence,
          outcome: t.actual_outcome,
          wasAccurate: t.was_accurate,
          pnl: parseFloat(t.pnl || '0'),
          entryTime: new Date(t.entry_time),
          sessionId: t.session_id,
          sessionName: recentSession?.session_name
        })),
        accuracyPercentage,
        improvementVsPrevious10,
        trend,
        mostRecentSessionName: recentSession?.session_name,
        totalTradesInRecentSession: recentSession?.total_trades || trades.length
      };
    } catch (error) {
      console.error('[Confidence Tracker] Error getting last 10 trades:', error);
      return {
        trades: [],
        accuracyPercentage: 0,
        improvementVsPrevious10: 0,
        trend: 'stable'
      };
    }
  }

  /**
   * Get confidence performance for a specific window
   */
  async getConfidencePerformance(
    userId: string,
    windowType: 'last_10' | 'last_30' | 'last_100' | 'all_time' = 'last_10'
  ): Promise<ConfidencePerformanceWindow | null> {
    try {
      const { data, error } = await supabase
        .from('ai_confidence_performance')
        .select('*')
        .eq('user_id', userId)
        .eq('window_type', windowType)
        .order('calculated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        windowType: data.window_type,
        totalTrades: data.total_trades,
        accuratePredictions: data.accurate_predictions,
        accuracyPercentage: parseFloat(data.accuracy_percentage || '0'),
        overallCalibrationScore: parseFloat(data.overall_calibration_score || '0'),
        calibrationByBucket: data.calibration_by_bucket || {},
        averageConfidenceError: parseFloat(data.average_confidence_error || '0'),
        isImproving: data.is_improving,
        improvementRate: parseFloat(data.improvement_rate || '0'),
        trendDirection: data.trend_direction,
        overconfidentTrades: data.overconfident_trades,
        underconfidentTrades: data.underconfident_trades,
        wellCalibratedTrades: data.well_calibrated_trades
      };
    } catch (error) {
      console.error('[Confidence Tracker] Error getting performance:', error);
      return null;
    }
  }

  /**
   * Update rolling window calculations
   */
  async updateRollingWindows(userId: string): Promise<void> {
    try {
      // Update last_10 window
      await this.calculateAndSaveWindow(userId, 'last_10', 10);

      // Update last_30 window
      await this.calculateAndSaveWindow(userId, 'last_30', 30);

      // Update last_100 window
      await this.calculateAndSaveWindow(userId, 'last_100', 100);
    } catch (error) {
      console.error('[Confidence Tracker] Error updating windows:', error);
    }
  }

  /**
   * Calculate and save window performance
   */
  private async calculateAndSaveWindow(
    userId: string,
    windowType: 'last_10' | 'last_30' | 'last_100',
    limit: number
  ): Promise<void> {
    try {
      // Fetch trades for window
      const { data: trades, error } = await supabase
        .from('ai_confidence_calibration')
        .select('*')
        .eq('user_id', userId)
        .order('entry_time', { ascending: false })
        .limit(limit);

      if (error || !trades || trades.length === 0) return;

      // Calculate metrics (excluding breakeven trades from accuracy)
      const totalTrades = trades.length;
      const nonBreakevenTrades = trades.filter(t => t.actual_outcome !== 'breakeven');
      const accuratePredictions = nonBreakevenTrades.filter(t => t.was_accurate).length;
      const accuracyPercentage = nonBreakevenTrades.length > 0
        ? (accuratePredictions / nonBreakevenTrades.length) * 100
        : 0;

      // Calculate calibration by bucket
      const calibrationByBucket: Record<string, number> = {};
      const buckets = ['0-20', '20-40', '40-60', '60-80', '80-100'];

      for (const bucket of buckets) {
        const bucketTrades = trades.filter(t => t.confidence_bucket === bucket);
        if (bucketTrades.length > 0) {
          const avgCalibration = bucketTrades.reduce((sum, t) => sum + parseFloat(t.calibration_score || '0'), 0) / bucketTrades.length;
          calibrationByBucket[bucket] = avgCalibration;
        }
      }

      const overallCalibrationScore = trades.reduce((sum, t) => sum + parseFloat(t.calibration_score || '0'), 0) / totalTrades;
      const averageConfidenceError = trades.reduce((sum, t) => sum + parseFloat(t.confidence_error || '0'), 0) / totalTrades;

      // Classify trades
      let overconfidentTrades = 0;
      let underconfidentTrades = 0;
      let wellCalibratedTrades = 0;

      for (const trade of trades) {
        const conf = trade.predicted_confidence;
        const outcome = trade.actual_outcome;

        if (conf >= 70 && outcome === 'loss') overconfidentTrades++;
        else if (conf < 50 && outcome === 'win') underconfidentTrades++;
        else wellCalibratedTrades++;
      }

      // Determine trend
      const { data: previousWindow } = await supabase
        .from('ai_confidence_performance')
        .select('accuracy_percentage')
        .eq('user_id', userId)
        .eq('window_type', windowType)
        .order('calculated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      let isImproving = false;
      let improvementRate = 0;
      let trendDirection: 'improving' | 'stable' | 'declining' = 'stable';

      if (previousWindow) {
        const previousAccuracy = parseFloat(previousWindow.accuracy_percentage || '0');
        improvementRate = accuracyPercentage - previousAccuracy;
        isImproving = improvementRate > 0;

        if (improvementRate > 5) trendDirection = 'improving';
        else if (improvementRate < -5) trendDirection = 'declining';
      }

      // Save to database
      await supabase
        .from('ai_confidence_performance')
        .insert({
          user_id: userId,
          window_type: windowType,
          window_start_time: trades[trades.length - 1].entry_time,
          window_end_time: trades[0].entry_time,
          total_trades: totalTrades,
          accurate_predictions: accuratePredictions,
          inaccurate_predictions: totalTrades - accuratePredictions,
          accuracy_percentage: accuracyPercentage,
          overall_calibration_score: overallCalibrationScore,
          calibration_by_bucket: calibrationByBucket,
          average_confidence_error: averageConfidenceError,
          max_confidence_error: Math.max(...trades.map(t => parseFloat(t.confidence_error || '0'))),
          min_confidence_error: Math.min(...trades.map(t => parseFloat(t.confidence_error || '0'))),
          is_improving: isImproving,
          improvement_rate: improvementRate,
          trend_direction: trendDirection,
          overconfident_trades: overconfidentTrades,
          underconfident_trades: underconfidentTrades,
          well_calibrated_trades: wellCalibratedTrades
        });

    } catch (error) {
      console.error(`[Confidence Tracker] Error calculating ${windowType} window:`, error);
    }
  }

  /**
   * Get calibration chart data (for visualization)
   */
  async getCalibrationChartData(userId: string): Promise<Array<{bucket: string, predictedWinRate: number, actualWinRate: number}>> {
    try {
      const { data: trades, error } = await supabase
        .from('ai_confidence_calibration')
        .select('confidence_bucket, actual_outcome, predicted_confidence')
        .eq('user_id', userId);

      if (error || !trades || trades.length === 0) return [];

      const buckets = ['0-20', '20-40', '40-60', '60-80', '80-100'];
      const chartData = [];

      for (const bucket of buckets) {
        const bucketTrades = trades.filter(t => t.confidence_bucket === bucket);

        if (bucketTrades.length > 0) {
          const wins = bucketTrades.filter(t => t.actual_outcome === 'win').length;
          const actualWinRate = (wins / bucketTrades.length) * 100;
          const avgPredictedConfidence = bucketTrades.reduce((sum, t) => sum + t.predicted_confidence, 0) / bucketTrades.length;

          chartData.push({
            bucket,
            predictedWinRate: avgPredictedConfidence,
            actualWinRate
          });
        }
      }

      return chartData;
    } catch (error) {
      console.error('[Confidence Tracker] Error getting calibration chart data:', error);
      return [];
    }
  }

  /**
   * Process synthetic backtest trades and record confidence
   */
  async processSyntheticBacktestTrades(userId: string, sessionId: string): Promise<void> {
    try {
      console.log(`[Confidence Tracker] Processing synthetic backtest session: ${sessionId}`);

      const { data: trades, error } = await supabase
        .from('synthetic_backtest_trades')
        .select('*')
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .not('outcome', 'is', null);

      if (error) throw error;
      if (!trades || trades.length === 0) {
        console.log('[Confidence Tracker] No completed trades found in session');
        return;
      }

      console.log(`[Confidence Tracker] Found ${trades.length} completed trades to process`);

      for (const trade of trades) {
        // Use ai_conviction if available, otherwise flow_v2_confidence
        const confidence = trade.ai_conviction || trade.flow_v2_confidence || 50;

        await this.recordConfidencePrediction(
          userId,
          trade.id,
          'synthetic',
          sessionId,
          confidence,
          trade.outcome,
          parseFloat(trade.pnl || '0'),
          trade.symbol,
          trade.timeframe,
          new Date(trade.entry_time),
          trade.exit_time ? new Date(trade.exit_time) : null
        );
      }

      console.log(`[Confidence Tracker] ✅ Processed ${trades.length} trades for confidence tracking`);
    } catch (error) {
      console.error('[Confidence Tracker] Error processing synthetic backtest trades:', error);
    }
  }
}

export const aiConfidenceTracker = new AIConfidenceTracker();
