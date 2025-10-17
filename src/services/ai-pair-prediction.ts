import { supabase } from '@/lib/supabase';
import { Candle } from '@/lib/indicators';
import { AiMarketSummary } from '@/lib/aiMarketEngine';

export interface PairConditionRequirement {
  indicator: string;
  required: string;
  current: string;
  isMet: boolean;
  proximityPercent: number;
  weight: number;
}

export interface PairPrediction {
  id: string;
  userId: string;
  sessionId?: string;
  scanCycleId: string;
  symbol: string;
  timeframe: string;
  predictedEntryTime?: Date;
  predictionConfidence: number;
  estimatedMinutesToEntry: number;
  nextScanScheduledAt?: Date;
  conditionsRequired: PairConditionRequirement[];
  conditionsMet: string[];
  conditionsPending: string[];
  readinessStatus: 'ready' | 'close' | 'far' | 'not_viable';
  readinessPercentage: number;
  currentPrice: number;
  targetEntryPrice?: number;
  predictedDirection?: 'BUY' | 'SELL' | 'NEUTRAL';
  createdAt: Date;
  updatedAt: Date;
}

export interface PairAnalysisSnapshot {
  id?: string;
  userId: string;
  sessionId?: string;
  predictionId?: string;
  symbol: string;
  timeframe: string;
  currentPrice: number;
  spreadFromVwap?: number;
  spreadFromEma9?: number;
  rsiValue?: number;
  rsiStatus?: 'OVERBOUGHT' | 'OVERSOLD' | 'NEUTRAL';
  vwapValue?: number;
  vwapPosition?: 'ABOVE' | 'BELOW' | 'NEAR';
  vwapSpread?: number;
  volumeChangePercent?: number;
  volumeStatus?: 'LOW' | 'STABLE' | 'HIGH';
  volume20barAvg?: number;
  atrValue?: number;
  atrStatus?: 'LOW' | 'NORMAL' | 'HIGH';
  ema9Value?: number;
  ema21Value?: number;
  emaCrossoverStatus?: string;
  emaSlopeDirection?: 'UP' | 'DOWN' | 'FLAT';
  trendStrengthPercent?: number;
  priceStructureTag?: string;
  structureConfidence?: 'HIGH' | 'MODERATE' | 'LOW';
  candlePatternName?: string;
  candlePatternDirection?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  candlePatternConfidence?: 'HIGH' | 'MODERATE' | 'LOW';
  marketSentiment?: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  sentimentConfidence?: number;
  combinedScore?: number;
  lastSignalAccurate?: boolean;
  lastThreeOutcomes?: any[];
  fullAnalysis?: any;
  createdAt?: Date;
}

class AIPairPredictionService {
  private async checkTableExists(): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('ai_pair_predictions')
        .select('id')
        .limit(1);

      return !error || error.code !== 'PGRST200';
    } catch (error) {
      console.error('[AIPairPrediction] Table check failed:', error);
      return false;
    }
  }

  async createPrediction(
    userId: string,
    symbol: string,
    analysis: PairAnalysisSnapshot,
    marketSummary: AiMarketSummary,
    sessionId?: string,
    scanCycleId?: string
  ): Promise<PairPrediction> {
    const requirements = this.determineRequirements(analysis, marketSummary);
    const prediction = this.calculatePrediction(analysis, requirements);

    const { data, error } = await supabase
      .from('ai_pair_predictions')
      .insert({
        user_id: userId,
        session_id: sessionId,
        scan_cycle_id: scanCycleId || `scan-${Date.now()}`,
        symbol,
        timeframe: analysis.timeframe || 'M15',
        predicted_entry_time: prediction.predictedEntryTime?.toISOString(),
        prediction_confidence: prediction.confidence,
        estimated_minutes_to_entry: prediction.minutesToEntry,
        next_scan_scheduled_at: prediction.nextScanTime?.toISOString(),
        conditions_required: requirements.map(r => ({
          indicator: r.indicator,
          required: r.required,
          weight: r.weight
        })),
        conditions_met: requirements.filter(r => r.isMet).map(r => r.indicator),
        conditions_pending: requirements.filter(r => !r.isMet).map(r => r.indicator),
        condition_proximity: requirements.reduce((acc, r) => {
          acc[r.indicator] = r.proximityPercent;
          return acc;
        }, {} as Record<string, number>),
        readiness_status: prediction.readinessStatus,
        readiness_percentage: prediction.readinessPercentage,
        current_price: analysis.currentPrice,
        target_entry_price: prediction.targetEntryPrice,
        predicted_direction: prediction.direction,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('[AIPairPrediction] Error creating prediction:', {
        error,
        symbol,
        code: error.code,
        message: error.message,
        hint: error.hint,
        details: error.details
      });

      if (error.message?.includes('schema cache') || error.code === 'PGRST200') {
        throw new Error(
          `Database table 'ai_pair_predictions' not found. Please:\n` +
          `1. Go to your Supabase Dashboard\n` +
          `2. Navigate to SQL Editor\n` +
          `3. Run the migration: supabase/migrations/20251017_140000_add_ai_prediction_system.sql\n` +
          `4. Go to Settings > API and click "Refresh" to update the schema cache\n\n` +
          `Original error: ${error.message}`
        );
      }

      throw error;
    }

    await this.saveAnalysisSnapshot(userId, data.id, analysis, sessionId);

    return this.mapPredictionFromDB(data, requirements);
  }

  async updatePrediction(
    predictionId: string,
    analysis: PairAnalysisSnapshot,
    marketSummary: AiMarketSummary
  ): Promise<PairPrediction> {
    const requirements = this.determineRequirements(analysis, marketSummary);
    const prediction = this.calculatePrediction(analysis, requirements);

    const { data, error } = await supabase
      .from('ai_pair_predictions')
      .update({
        predicted_entry_time: prediction.predictedEntryTime?.toISOString(),
        prediction_confidence: prediction.confidence,
        estimated_minutes_to_entry: prediction.minutesToEntry,
        next_scan_scheduled_at: prediction.nextScanTime?.toISOString(),
        conditions_met: requirements.filter(r => r.isMet).map(r => r.indicator),
        conditions_pending: requirements.filter(r => !r.isMet).map(r => r.indicator),
        condition_proximity: requirements.reduce((acc, r) => {
          acc[r.indicator] = r.proximityPercent;
          return acc;
        }, {} as Record<string, number>),
        readiness_status: prediction.readinessStatus,
        readiness_percentage: prediction.readinessPercentage,
        current_price: analysis.currentPrice,
        target_entry_price: prediction.targetEntryPrice,
        predicted_direction: prediction.direction,
        updated_at: new Date().toISOString()
      })
      .eq('id', predictionId)
      .select()
      .single();

    if (error) throw error;

    await this.saveAnalysisSnapshot(analysis.userId, predictionId, analysis, analysis.sessionId);

    return this.mapPredictionFromDB(data, requirements);
  }

  private determineRequirements(
    analysis: PairAnalysisSnapshot,
    marketSummary: AiMarketSummary
  ): PairConditionRequirement[] {
    const requirements: PairConditionRequirement[] = [];

    if (analysis.rsiValue !== undefined) {
      const isOversold = analysis.rsiValue < 30;
      const isOverbought = analysis.rsiValue > 70;
      requirements.push({
        indicator: 'RSI',
        required: isOversold ? 'Oversold (<30) + Reversal' : isOverbought ? 'Overbought (>70) + Reversal' : 'Neutral (30-70)',
        current: `${analysis.rsiValue.toFixed(1)} (${analysis.rsiStatus})`,
        isMet: analysis.rsiStatus === 'OVERSOLD' || analysis.rsiStatus === 'OVERBOUGHT',
        proximityPercent: this.calculateRSIProximity(analysis.rsiValue, analysis.rsiStatus),
        weight: 0.25
      });
    }

    if (analysis.vwapPosition) {
      const targetPosition = analysis.vwapPosition === 'ABOVE' ? 'Touch VWAP from above' : 'Touch VWAP from below';
      requirements.push({
        indicator: 'VWAP',
        required: targetPosition,
        current: `${analysis.vwapPosition} VWAP (spread: ${analysis.vwapSpread?.toFixed(5) || 'N/A'})`,
        isMet: analysis.vwapPosition === 'NEAR',
        proximityPercent: this.calculateVWAPProximity(analysis.spreadFromVwap || 0),
        weight: 0.20
      });
    }

    if (analysis.volumeStatus) {
      requirements.push({
        indicator: 'Volume',
        required: 'High volume confirmation',
        current: `${analysis.volumeStatus} (${analysis.volumeChangePercent?.toFixed(1) || 0}% vs 20-bar avg)`,
        isMet: analysis.volumeStatus === 'HIGH',
        proximityPercent: this.calculateVolumeProximity(analysis.volumeChangePercent || 0),
        weight: 0.15
      });
    }

    if (analysis.ema9Value && analysis.ema21Value) {
      const emaCrossed = analysis.emaCrossoverStatus?.includes('Crossover') || false;
      requirements.push({
        indicator: 'EMA Crossover',
        required: 'EMA9 crosses EMA21 with momentum',
        current: analysis.emaCrossoverStatus || 'No crossover',
        isMet: emaCrossed,
        proximityPercent: this.calculateEMAProximity(analysis.ema9Value, analysis.ema21Value),
        weight: 0.20
      });
    }

    if (analysis.candlePatternName) {
      requirements.push({
        indicator: 'Candle Pattern',
        required: 'Bullish or Bearish pattern with high confidence',
        current: `${analysis.candlePatternName} (${analysis.candlePatternDirection}, ${analysis.candlePatternConfidence})`,
        isMet: analysis.candlePatternConfidence === 'HIGH',
        proximityPercent: analysis.candlePatternConfidence === 'HIGH' ? 100 : analysis.candlePatternConfidence === 'MODERATE' ? 60 : 30,
        weight: 0.10
      });
    }

    if (marketSummary.sentiment) {
      const sentimentStrong = (marketSummary.sentiment.confidence || 0) > 70;
      requirements.push({
        indicator: 'Market Sentiment',
        required: 'Strong directional sentiment (>70% confidence)',
        current: `${marketSummary.sentiment.status} (${marketSummary.sentiment.confidence}%)`,
        isMet: sentimentStrong,
        proximityPercent: marketSummary.sentiment.confidence || 0,
        weight: 0.10
      });
    }

    return requirements;
  }

  private calculatePrediction(
    analysis: PairAnalysisSnapshot,
    requirements: PairConditionRequirement[]
  ): {
    predictedEntryTime?: Date;
    confidence: number;
    minutesToEntry: number;
    readinessStatus: 'ready' | 'close' | 'far' | 'not_viable';
    readinessPercentage: number;
    nextScanTime?: Date;
    targetEntryPrice?: number;
    direction?: 'BUY' | 'SELL' | 'NEUTRAL';
  } {
    const metConditions = requirements.filter(r => r.isMet);
    const readinessPercentage = requirements.reduce((sum, r) => sum + (r.isMet ? r.weight : 0), 0) * 100;

    const avgProximity = requirements.reduce((sum, r) => sum + r.proximityPercent * r.weight, 0);

    let minutesToEntry = this.estimateTimeToEntry(requirements, analysis);
    let readinessStatus: 'ready' | 'close' | 'far' | 'not_viable' = 'far';

    if (readinessPercentage >= 90) {
      readinessStatus = 'ready';
      minutesToEntry = Math.min(minutesToEntry, 5);
    } else if (readinessPercentage >= 70) {
      readinessStatus = 'close';
      minutesToEntry = Math.min(minutesToEntry, 15);
    } else if (readinessPercentage < 40) {
      readinessStatus = 'not_viable';
      minutesToEntry = 999;
    }

    const predictedEntryTime = minutesToEntry < 999 ? new Date(Date.now() + minutesToEntry * 60 * 1000) : undefined;

    let nextScanTime: Date;
    if (readinessStatus === 'ready') {
      nextScanTime = new Date(Date.now() + 60 * 1000);
    } else if (readinessStatus === 'close') {
      nextScanTime = new Date(Date.now() + 5 * 60 * 1000);
    } else if (minutesToEntry > 30) {
      nextScanTime = new Date(Date.now() + 20 * 60 * 1000);
    } else {
      nextScanTime = new Date(Date.now() + Math.max(2, minutesToEntry - 2) * 60 * 1000);
    }

    const direction = this.determineDirection(analysis);

    return {
      predictedEntryTime,
      confidence: Math.min(avgProximity, 95),
      minutesToEntry,
      readinessStatus,
      readinessPercentage,
      nextScanTime,
      targetEntryPrice: analysis.currentPrice,
      direction
    };
  }

  private estimateTimeToEntry(requirements: PairConditionRequirement[], analysis: PairAnalysisSnapshot): number {
    const pendingRequirements = requirements.filter(r => !r.isMet);

    if (pendingRequirements.length === 0) return 2;

    let totalWeightedTime = 0;
    let totalWeight = 0;

    pendingRequirements.forEach(req => {
      let timeEstimate = 30;

      if (req.indicator === 'RSI') {
        const rsiDistance = req.proximityPercent;
        timeEstimate = Math.max(5, (100 - rsiDistance) * 0.5);
      } else if (req.indicator === 'VWAP') {
        timeEstimate = Math.max(3, (100 - req.proximityPercent) * 0.3);
      } else if (req.indicator === 'Volume') {
        timeEstimate = Math.random() < 0.3 ? 5 : 20;
      } else if (req.indicator === 'EMA Crossover') {
        timeEstimate = Math.max(10, (100 - req.proximityPercent) * 0.4);
      } else if (req.indicator === 'Candle Pattern') {
        timeEstimate = Math.random() < 0.2 ? 2 : 15;
      }

      if (analysis.atrStatus === 'HIGH') {
        timeEstimate *= 0.7;
      } else if (analysis.atrStatus === 'LOW') {
        timeEstimate *= 1.5;
      }

      totalWeightedTime += timeEstimate * req.weight;
      totalWeight += req.weight;
    });

    const avgTime = totalWeight > 0 ? totalWeightedTime / totalWeight : 30;
    return Math.round(Math.min(avgTime, 120));
  }

  private calculateRSIProximity(rsiValue: number, status?: string): number {
    if (status === 'OVERSOLD' || status === 'OVERBOUGHT') return 100;
    if (rsiValue < 35) return 70 + (35 - rsiValue) * 6;
    if (rsiValue > 65) return 70 + (rsiValue - 65) * 6;
    return Math.max(0, 100 - Math.abs(rsiValue - 50) * 2);
  }

  private calculateVWAPProximity(spread: number): number {
    const absSpread = Math.abs(spread);
    if (absSpread < 0.0001) return 100;
    if (absSpread < 0.0005) return 80;
    if (absSpread < 0.001) return 60;
    return Math.max(0, 100 - absSpread * 10000);
  }

  private calculateVolumeProximity(changePercent: number): number {
    if (changePercent >= 50) return 100;
    if (changePercent >= 30) return 80;
    if (changePercent >= 10) return 60;
    return Math.max(0, changePercent * 2);
  }

  private calculateEMAProximity(ema9: number, ema21: number): number {
    const diff = Math.abs(ema9 - ema21);
    const percentDiff = (diff / ema21) * 100;
    if (percentDiff < 0.05) return 100;
    if (percentDiff < 0.1) return 80;
    if (percentDiff < 0.2) return 60;
    return Math.max(0, 100 - percentDiff * 100);
  }

  private determineDirection(analysis: PairAnalysisSnapshot): 'BUY' | 'SELL' | 'NEUTRAL' {
    let bullishSignals = 0;
    let bearishSignals = 0;

    if (analysis.rsiStatus === 'OVERSOLD') bullishSignals++;
    if (analysis.rsiStatus === 'OVERBOUGHT') bearishSignals++;

    if (analysis.emaSlopeDirection === 'UP') bullishSignals++;
    if (analysis.emaSlopeDirection === 'DOWN') bearishSignals++;

    if (analysis.candlePatternDirection === 'BULLISH') bullishSignals++;
    if (analysis.candlePatternDirection === 'BEARISH') bearishSignals++;

    if (analysis.marketSentiment === 'BULLISH') bullishSignals++;
    if (analysis.marketSentiment === 'BEARISH') bearishSignals++;

    if (bullishSignals > bearishSignals) return 'BUY';
    if (bearishSignals > bullishSignals) return 'SELL';
    return 'NEUTRAL';
  }

  private async saveAnalysisSnapshot(
    userId: string,
    predictionId: string,
    analysis: PairAnalysisSnapshot,
    sessionId?: string
  ): Promise<void> {
    await supabase.from('ai_pair_analysis_snapshots').insert({
      user_id: userId,
      session_id: sessionId,
      prediction_id: predictionId,
      ...analysis
    });
  }

  private mapPredictionFromDB(data: any, requirements: PairConditionRequirement[]): PairPrediction {
    return {
      id: data.id,
      userId: data.user_id,
      sessionId: data.session_id,
      scanCycleId: data.scan_cycle_id,
      symbol: data.symbol,
      timeframe: data.timeframe,
      predictedEntryTime: data.predicted_entry_time ? new Date(data.predicted_entry_time) : undefined,
      predictionConfidence: parseFloat(data.prediction_confidence || 0),
      estimatedMinutesToEntry: data.estimated_minutes_to_entry || 0,
      nextScanScheduledAt: data.next_scan_scheduled_at ? new Date(data.next_scan_scheduled_at) : undefined,
      conditionsRequired: requirements,
      conditionsMet: data.conditions_met || [],
      conditionsPending: data.conditions_pending || [],
      readinessStatus: data.readiness_status,
      readinessPercentage: parseFloat(data.readiness_percentage || 0),
      currentPrice: parseFloat(data.current_price),
      targetEntryPrice: data.target_entry_price ? parseFloat(data.target_entry_price) : undefined,
      predictedDirection: data.predicted_direction,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at)
    };
  }

  async getLatestPrediction(userId: string, symbol: string, sessionId?: string): Promise<PairPrediction | null> {
    let query = supabase
      .from('ai_pair_predictions')
      .select('*')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .order('created_at', { ascending: false })
      .limit(1);

    if (sessionId) {
      query = query.eq('session_id', sessionId);
    }

    const { data, error } = await query.maybeSingle();

    if (error || !data) return null;

    // Ensure conditions_required is always an array
    let conditionsData = data.conditions_required;
    if (!Array.isArray(conditionsData)) {
      console.warn('[AIPairPrediction] conditions_required is not an array:', typeof conditionsData);
      conditionsData = [];
    }

    const requirements = conditionsData.map((req: any) => ({
      ...req,
      current: '',
      isMet: data.conditions_met?.includes(req.indicator) || false,
      proximityPercent: data.condition_proximity?.[req.indicator] || 0
    }));

    return this.mapPredictionFromDB(data, requirements);
  }

  async recordPredictionAccuracy(
    userId: string,
    predictionId: string,
    actualEntryTime: Date,
    conditionsAtEntry: any
  ): Promise<void> {
    const { data: prediction } = await supabase
      .from('ai_pair_predictions')
      .select('*')
      .eq('id', predictionId)
      .single();

    if (!prediction) return;

    const predictedTime = prediction.predicted_entry_time ? new Date(prediction.predicted_entry_time) : null;
    const errorMinutes = predictedTime ? Math.abs((actualEntryTime.getTime() - predictedTime.getTime()) / 60000) : null;

    await supabase.from('ai_prediction_accuracy').insert({
      user_id: userId,
      prediction_id: predictionId,
      symbol: prediction.symbol,
      predicted_entry_time: predictedTime?.toISOString(),
      actual_entry_time: actualEntryTime.toISOString(),
      prediction_error_minutes: errorMinutes,
      prediction_was_accurate: errorMinutes ? errorMinutes < 10 : false,
      conditions_at_prediction: prediction.conditions_required,
      conditions_at_entry: conditionsAtEntry
    });
  }
}

export const aiPairPredictionService = new AIPairPredictionService();
