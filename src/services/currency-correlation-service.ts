import { supabase } from '../lib/supabase';

/**
 * Currency Correlation Service
 *
 * Real-time correlation analysis for currency pairs to:
 * - Identify correlated and inverse correlated pairs
 * - Detect divergence opportunities (mean reversion setups)
 * - Calculate risk exposure when holding multiple positions
 * - Suggest basket trading opportunities
 * - Adjust position sizing based on correlation
 */

export interface CorrelationData {
  pair1: string;
  pair2: string;
  correlationCoefficient: number; // -1 to 1
  correlationStrength: 'very_weak' | 'weak' | 'moderate' | 'strong' | 'very_strong';
  pValue?: number;
  sampleSize: number;
  riskMultiplier: number;
  divergenceOpportunity: boolean;
  meanReversionSetup: boolean;
}

export interface CorrelationMatrix {
  calculatedAt: Date;
  timeframe: string;
  lookbackHours: number;
  correlations: CorrelationData[];
}

interface PriceData {
  timestamp: Date;
  close: number;
}

class CurrencyCorrelationService {
  private readonly MAJOR_PAIRS = [
    'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF',
    'AUDUSD', 'NZDUSD', 'USDCAD'
  ];

  private readonly LOOKBACK_PERIODS = {
    '1H': 168, // 1 week
    '4H': 168, // 4 weeks
    '1D': 90   // 90 days
  };

  /**
   * Calculate correlation matrix for all major pairs
   */
  async calculateCorrelationMatrix(
    timeframe: string = '1H',
    lookbackHours: number = 168
  ): Promise<CorrelationMatrix> {
    console.log(`[Correlation] Calculating matrix for ${timeframe} timeframe, ${lookbackHours}h lookback`);

    const correlations: CorrelationData[] = [];
    const calculatedAt = new Date();

    // Calculate correlation for all pair combinations
    for (let i = 0; i < this.MAJOR_PAIRS.length; i++) {
      for (let j = i + 1; j < this.MAJOR_PAIRS.length; j++) {
        const pair1 = this.MAJOR_PAIRS[i];
        const pair2 = this.MAJOR_PAIRS[j];

        const correlation = await this.calculatePairCorrelation(
          pair1,
          pair2,
          timeframe,
          lookbackHours
        );

        if (correlation) {
          correlations.push(correlation);
          await this.saveCorrelation(correlation, timeframe, lookbackHours);
        }
      }
    }

    console.log(`[Correlation] Matrix complete: ${correlations.length} pair correlations calculated`);

    return {
      calculatedAt,
      timeframe,
      lookbackHours,
      correlations
    };
  }

  /**
   * Calculate correlation between two specific pairs
   */
  async calculatePairCorrelation(
    pair1: string,
    pair2: string,
    timeframe: string,
    lookbackHours: number
  ): Promise<CorrelationData | null> {
    try {
      // Fetch price data for both pairs
      const [data1, data2] = await Promise.all([
        this.fetchPriceData(pair1, timeframe, lookbackHours),
        this.fetchPriceData(pair2, timeframe, lookbackHours)
      ]);

      if (data1.length < 20 || data2.length < 20) {
        console.log(`[Correlation] Insufficient data for ${pair1}/${pair2}`);
        return null;
      }

      // Align timestamps (only use common timestamps)
      const aligned = this.alignPriceData(data1, data2);

      if (aligned.prices1.length < 20) {
        console.log(`[Correlation] Insufficient aligned data for ${pair1}/${pair2}`);
        return null;
      }

      // Calculate Pearson correlation coefficient
      const correlationCoefficient = this.calculatePearsonCorrelation(
        aligned.prices1,
        aligned.prices2
      );

      // Classify correlation strength
      const correlationStrength = this.classifyCorrelationStrength(correlationCoefficient);

      // Calculate risk multiplier (higher correlation = higher risk)
      const riskMultiplier = this.calculateRiskMultiplier(correlationCoefficient);

      // Detect divergence opportunity
      const { divergenceOpportunity, meanReversionSetup } = this.detectDivergence(
        aligned.prices1,
        aligned.prices2,
        correlationCoefficient
      );

      return {
        pair1,
        pair2,
        correlationCoefficient,
        correlationStrength,
        sampleSize: aligned.prices1.length,
        riskMultiplier,
        divergenceOpportunity,
        meanReversionSetup
      };

    } catch (error) {
      console.error(`[Correlation] Error calculating correlation for ${pair1}/${pair2}:`, error);
      return null;
    }
  }

  /**
   * Get current correlation between two pairs from database
   */
  async getCorrelation(pair1: string, pair2: string): Promise<CorrelationData | null> {
    // Query most recent correlation
    const { data, error } = await supabase
      .from('currency_correlation_matrix')
      .select('*')
      .or(`and(pair_1.eq.${pair1},pair_2.eq.${pair2}),and(pair_1.eq.${pair2},pair_2.eq.${pair1})`)
      .order('calculated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      pair1: data.pair_1,
      pair2: data.pair_2,
      correlationCoefficient: parseFloat(data.correlation_coefficient.toString()),
      correlationStrength: data.correlation_strength,
      sampleSize: data.sample_size,
      riskMultiplier: parseFloat(data.risk_multiplier.toString()),
      divergenceOpportunity: data.divergence_opportunity,
      meanReversionSetup: data.mean_reversion_setup
    };
  }

  /**
   * Calculate total correlated risk exposure for open positions
   */
  async calculatePortfolioRisk(positions: Array<{ symbol: string; direction: 'buy' | 'sell'; size: number }>): Promise<number> {
    if (positions.length <= 1) return 1.0;

    let totalCorrelationRisk = 0;
    let comparisons = 0;

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const correlation = await this.getCorrelation(
          positions[i].symbol,
          positions[j].symbol
        );

        if (correlation) {
          // If both positions are same direction and pairs are correlated, risk increases
          // If opposite direction and pairs are inversely correlated, risk increases
          const directionMultiplier = positions[i].direction === positions[j].direction ? 1 : -1;
          const effectiveCorrelation = correlation.correlationCoefficient * directionMultiplier;

          totalCorrelationRisk += Math.abs(effectiveCorrelation);
          comparisons++;
        }
      }
    }

    if (comparisons === 0) return 1.0;

    const avgCorrelation = totalCorrelationRisk / comparisons;

    // Risk multiplier: 1.0 (no correlation) to 2.0 (perfect correlation)
    return 1.0 + avgCorrelation;
  }

  /**
   * Identify divergence trading opportunities
   */
  async findDivergenceOpportunities(): Promise<Array<{
    pair1: string;
    pair2: string;
    expectedCorrelation: number;
    currentDivergence: number;
    opportunity: string;
  }>> {
    const { data, error } = await supabase
      .from('currency_correlation_matrix')
      .select('*')
      .eq('divergence_opportunity', true)
      .order('calculated_at', { ascending: false })
      .limit(10);

    if (error || !data) {
      return [];
    }

    const opportunities = data.map(row => ({
      pair1: row.pair_1,
      pair2: row.pair_2,
      expectedCorrelation: parseFloat(row.correlation_coefficient.toString()),
      currentDivergence: 0, // Would need recent price action
      opportunity: row.mean_reversion_setup
        ? `${row.pair_1} and ${row.pair_2} typically move together (${(row.correlation_coefficient * 100).toFixed(0)}% correlation) but are currently diverging. Mean reversion opportunity.`
        : 'Potential divergence detected'
    }));

    return opportunities;
  }

  /**
   * Fetch price data from database
   */
  private async fetchPriceData(
    symbol: string,
    timeframe: string,
    lookbackHours: number
  ): Promise<PriceData[]> {
    const startTime = new Date();
    startTime.setHours(startTime.getHours() - lookbackHours);

    const { data, error } = await supabase
      .from('forex_candles')
      .select('open_time, close')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('open_time', startTime.toISOString())
      .order('open_time', { ascending: true });

    if (error || !data) {
      return [];
    }

    return data.map(row => ({
      timestamp: new Date(row.open_time),
      close: parseFloat(row.close.toString())
    }));
  }

  /**
   * Align price data by timestamp (only common timestamps)
   */
  private alignPriceData(
    data1: PriceData[],
    data2: PriceData[]
  ): { prices1: number[]; prices2: number[]; timestamps: Date[] } {
    const prices1: number[] = [];
    const prices2: number[] = [];
    const timestamps: Date[] = [];

    // Create timestamp map for data2
    const data2Map = new Map<string, number>();
    data2.forEach(d => {
      data2Map.set(d.timestamp.toISOString(), d.close);
    });

    // Match timestamps
    data1.forEach(d => {
      const timestamp = d.timestamp.toISOString();
      if (data2Map.has(timestamp)) {
        prices1.push(d.close);
        prices2.push(data2Map.get(timestamp)!);
        timestamps.push(d.timestamp);
      }
    });

    return { prices1, prices2, timestamps };
  }

  /**
   * Calculate Pearson correlation coefficient
   */
  private calculatePearsonCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    if (n !== y.length || n === 0) return 0;

    // Calculate percentage returns instead of raw prices
    const returns1 = [];
    const returns2 = [];

    for (let i = 1; i < n; i++) {
      returns1.push((x[i] - x[i - 1]) / x[i - 1]);
      returns2.push((y[i] - y[i - 1]) / y[i - 1]);
    }

    const mean1 = returns1.reduce((sum, val) => sum + val, 0) / returns1.length;
    const mean2 = returns2.reduce((sum, val) => sum + val, 0) / returns2.length;

    let numerator = 0;
    let sumSq1 = 0;
    let sumSq2 = 0;

    for (let i = 0; i < returns1.length; i++) {
      const diff1 = returns1[i] - mean1;
      const diff2 = returns2[i] - mean2;
      numerator += diff1 * diff2;
      sumSq1 += diff1 * diff1;
      sumSq2 += diff2 * diff2;
    }

    const denominator = Math.sqrt(sumSq1 * sumSq2);

    if (denominator === 0) return 0;

    return numerator / denominator;
  }

  /**
   * Classify correlation strength
   */
  private classifyCorrelationStrength(coefficient: number): 'very_weak' | 'weak' | 'moderate' | 'strong' | 'very_strong' {
    const abs = Math.abs(coefficient);

    if (abs < 0.2) return 'very_weak';
    if (abs < 0.4) return 'weak';
    if (abs < 0.6) return 'moderate';
    if (abs < 0.8) return 'strong';
    return 'very_strong';
  }

  /**
   * Calculate risk multiplier based on correlation
   */
  private calculateRiskMultiplier(coefficient: number): number {
    const abs = Math.abs(coefficient);

    // Risk increases exponentially with correlation
    // 0 correlation = 1.0 (no additional risk)
    // 0.5 correlation = 1.25 (25% more risk)
    // 0.9 correlation = 1.81 (81% more risk)
    return 1.0 + (abs * abs);
  }

  /**
   * Detect divergence opportunities
   */
  private detectDivergence(
    prices1: number[],
    prices2: number[],
    historicalCorrelation: number
  ): { divergenceOpportunity: boolean; meanReversionSetup: boolean } {
    if (prices1.length < 10) {
      return { divergenceOpportunity: false, meanReversionSetup: false };
    }

    // Calculate recent correlation (last 10 periods)
    const recentPrices1 = prices1.slice(-10);
    const recentPrices2 = prices2.slice(-10);
    const recentCorrelation = this.calculatePearsonCorrelation(recentPrices1, recentPrices2);

    // Significant divergence from historical correlation
    const correlationDelta = Math.abs(recentCorrelation - historicalCorrelation);
    const isDiverging = correlationDelta > 0.3;

    // Mean reversion setup: historically correlated pairs currently diverging
    const meanReversionSetup = Math.abs(historicalCorrelation) > 0.6 && isDiverging;

    return {
      divergenceOpportunity: isDiverging,
      meanReversionSetup
    };
  }

  /**
   * Save correlation to database
   */
  private async saveCorrelation(
    correlation: CorrelationData,
    timeframe: string,
    lookbackPeriod: number
  ): Promise<void> {
    const { error } = await supabase
      .from('currency_correlation_matrix')
      .insert({
        calculated_at: new Date().toISOString(),
        timeframe,
        lookback_period: lookbackPeriod,
        pair_1: correlation.pair1,
        pair_2: correlation.pair2,
        correlation_coefficient: correlation.correlationCoefficient,
        sample_size: correlation.sampleSize,
        correlation_strength: correlation.correlationStrength,
        risk_multiplier: correlation.riskMultiplier,
        divergence_opportunity: correlation.divergenceOpportunity,
        mean_reversion_setup: correlation.meanReversionSetup
      });

    if (error) {
      console.error('[Correlation] Error saving correlation:', error);
    }
  }
}

export const currencyCorrelationService = new CurrencyCorrelationService();
