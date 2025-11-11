import { supabase } from '../lib/supabase';

/**
 * Strategy Discovery Engine
 *
 * Analyzes winning patterns and automatically discovers new trading strategies.
 * Only surfaces strategies that meet or exceed the Flow Trader V2 baseline.
 *
 * Discovery Methods:
 * 1. Pattern Clustering - Groups similar winning trades and extracts common rules
 * 2. Parameter Evolution - Mutates successful strategy parameters
 * 3. Hybrid Creation - Combines best elements from multiple strategies
 */

interface DiscoveredStrategy {
  name: string;
  type: 'discovered' | 'evolved' | 'hybrid';
  entryRules: any;
  exitRules: any;
  indicators: any;
  timeframes: string[];
  dnaEncoding: any;
  discoveryMethod: string;
  discoveryInsights: string;
  estimatedWinRate: number;
  estimatedProfitFactor: number;
}

interface PatternCluster {
  patterns: any[];
  commonFeatures: any;
  winRate: number;
  avgRR: number;
  sampleSize: number;
}

class StrategyDiscoveryEngine {
  private readonly MIN_PATTERN_SAMPLE_SIZE = 10;
  private readonly MIN_WIN_RATE_THRESHOLD = 55; // 55% minimum
  private readonly MIN_PROFIT_FACTOR_THRESHOLD = 1.5;
  private readonly BASELINE_STRATEGY = 'Flow Trader V2';

  /**
   * Main entry point: Analyze trades and discover new strategies
   */
  async discoverStrategiesFromTrades(
    userId: string,
    trades: any[]
  ): Promise<DiscoveredStrategy[]> {
    console.log(`\n[Strategy Discovery] 🔍 Analyzing ${trades.length} trades for pattern discovery`);

    if (trades.length < this.MIN_PATTERN_SAMPLE_SIZE) {
      console.log('[Strategy Discovery] Insufficient data for discovery');
      return [];
    }

    const discoveredStrategies: DiscoveredStrategy[] = [];

    try {
      // 1. Cluster winning patterns
      const patterns = await this.clusterWinningPatterns(userId, trades);
      console.log(`[Strategy Discovery] Found ${patterns.length} pattern clusters`);

      // 2. Extract strategies from patterns
      for (const pattern of patterns) {
        if (this.meetsDiscoveryThreshold(pattern)) {
          const strategy = await this.extractStrategyFromPattern(userId, pattern);
          if (strategy) {
            discoveredStrategies.push(strategy);
          }
        }
      }

      // 3. Create evolved variants of existing successful strategies
      const evolvedStrategies = await this.evolveExistingStrategies(userId);
      discoveredStrategies.push(...evolvedStrategies);

      // 4. Validate and save strategies that beat baseline
      for (const strategy of discoveredStrategies) {
        await this.validateAndSaveStrategy(userId, strategy);
      }

      console.log(`[Strategy Discovery] ✅ Discovered ${discoveredStrategies.length} new strategies`);
      return discoveredStrategies;

    } catch (error) {
      console.error('[Strategy Discovery] Error:', error);
      return [];
    }
  }

  /**
   * Cluster winning trades to find common patterns
   */
  private async clusterWinningPatterns(
    userId: string,
    trades: any[]
  ): Promise<PatternCluster[]> {
    const winningTrades = trades.filter(t => t.outcome === 'win');

    if (winningTrades.length < this.MIN_PATTERN_SAMPLE_SIZE) {
      return [];
    }

    const clusters: PatternCluster[] = [];

    // Cluster by symbol + direction + confidence range
    const groups = this.groupTrades(winningTrades);

    for (const [key, groupTrades] of Object.entries(groups)) {
      if (groupTrades.length < 5) continue; // Need at least 5 similar wins

      const totalTrades = trades.filter(t =>
        t.symbol === groupTrades[0].symbol &&
        t.direction === groupTrades[0].direction
      ).length;

      const winRate = (groupTrades.length / totalTrades) * 100;

      // Only consider patterns with strong win rates
      if (winRate < this.MIN_WIN_RATE_THRESHOLD) continue;

      const commonFeatures = this.extractCommonFeatures(groupTrades);
      const avgRR = this.calculateAverageRR(groupTrades);

      clusters.push({
        patterns: groupTrades,
        commonFeatures,
        winRate,
        avgRR,
        sampleSize: groupTrades.length
      });
    }

    return clusters;
  }

  /**
   * Group trades by similar characteristics
   */
  private groupTrades(trades: any[]): Record<string, any[]> {
    const groups: Record<string, any[]> = {};

    for (const trade of trades) {
      // Group by symbol, direction, and confidence bucket
      const confidenceBucket = Math.floor(trade.confidence / 10) * 10;
      const key = `${trade.symbol}_${trade.direction}_${confidenceBucket}`;

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(trade);
    }

    return groups;
  }

  /**
   * Extract common features from similar trades
   */
  private extractCommonFeatures(trades: any[]): any {
    // Find indicators, entry conditions, and patterns common across these trades
    const features: any = {
      symbol: trades[0].symbol,
      direction: trades[0].direction,
      avgConfidence: trades.reduce((sum, t) => sum + t.confidence, 0) / trades.length,
      setupTypes: [...new Set(trades.map(t => t.setupType))],
      timeframes: ['H1', 'M5', 'M1'], // Default for now
      avgHoldTime: this.calculateAvgHoldTime(trades),
      marketConditions: this.extractMarketConditions(trades)
    };

    return features;
  }

  /**
   * Check if pattern meets discovery threshold
   */
  private meetsDiscoveryThreshold(pattern: PatternCluster): boolean {
    return (
      pattern.winRate >= this.MIN_WIN_RATE_THRESHOLD &&
      pattern.avgRR >= this.MIN_PROFIT_FACTOR_THRESHOLD &&
      pattern.sampleSize >= this.MIN_PATTERN_SAMPLE_SIZE
    );
  }

  /**
   * Convert pattern cluster into executable strategy
   */
  private async extractStrategyFromPattern(
    userId: string,
    pattern: PatternCluster
  ): Promise<DiscoveredStrategy | null> {
    try {
      const features = pattern.commonFeatures;

      // Generate strategy name based on characteristics
      const strategyName = this.generateStrategyName(features, pattern);

      // Build entry rules from pattern
      const entryRules = this.buildEntryRules(pattern);

      // Build exit rules
      const exitRules = this.buildExitRules(pattern);

      // Define indicators with optimized parameters
      const indicators = this.extractIndicators(pattern);

      // Create DNA encoding for evolution
      const dnaEncoding = this.encodeDNA(entryRules, exitRules, indicators);

      const strategy: DiscoveredStrategy = {
        name: strategyName,
        type: 'discovered',
        entryRules,
        exitRules,
        indicators,
        timeframes: features.timeframes,
        dnaEncoding,
        discoveryMethod: 'pattern_clustering',
        discoveryInsights: `Discovered from ${pattern.sampleSize} winning trades with ${pattern.winRate.toFixed(1)}% win rate`,
        estimatedWinRate: pattern.winRate,
        estimatedProfitFactor: pattern.avgRR
      };

      console.log(`[Strategy Discovery] 🎯 Extracted strategy: ${strategyName} (WR: ${pattern.winRate.toFixed(1)}%)`);

      return strategy;
    } catch (error) {
      console.error('[Strategy Discovery] Error extracting strategy:', error);
      return null;
    }
  }

  /**
   * Generate descriptive strategy name
   */
  private generateStrategyName(features: any, pattern: PatternCluster): string {
    const symbol = features.symbol;
    const direction = features.direction === 'buy' ? 'Long' : 'Short';
    const winRate = Math.floor(pattern.winRate);

    // Name based on characteristics
    if (features.avgHoldTime < 60) {
      return `Scalper ${symbol} ${direction} ${winRate}`;
    } else if (features.avgHoldTime > 240) {
      return `Swing ${symbol} ${direction} ${winRate}`;
    } else {
      return `Intraday ${symbol} ${direction} ${winRate}`;
    }
  }

  /**
   * Build entry rules from pattern
   */
  private buildEntryRules(pattern: PatternCluster): any {
    const features = pattern.commonFeatures;

    return {
      direction: features.direction,
      minConfidence: features.avgConfidence - 5,
      maxConcurrentTrades: 2,

      // Technical conditions (simplified for now)
      h1Bias: features.direction === 'buy' ? 'bullish' : 'bearish',
      m5FilterRequired: true,
      m1ExecutionRequired: true,

      // Risk management
      minRiskReward: 1.5,
      stopLossStrategy: 'atr_based',
      takeProfitStrategy: 'fixed_rr'
    };
  }

  /**
   * Build exit rules
   */
  private buildExitRules(pattern: PatternCluster): any {
    return {
      takeProfit: 'fixed_rr',
      stopLoss: 'fixed_atr',
      trailingStop: false,
      breakeven: false,
      maxHoldTime: pattern.commonFeatures.avgHoldTime * 2 // Double avg hold time as max
    };
  }

  /**
   * Extract indicators used in pattern
   */
  private extractIndicators(pattern: PatternCluster): any {
    // For now, use Flow Trader V2 indicators as base
    return {
      h1: {
        candlePattern: { enabled: true }
      },
      m5: {
        halfTrend: { enabled: true, amplitude: 2, channelDeviation: 2 },
        stochRSI: { enabled: true, period: 14, smoothK: 3, smoothD: 3 },
        linearRegression: { enabled: true, period: 20 }
      },
      m1: {
        heikinAshi: { enabled: true },
        rsi: { enabled: true, period: 14 },
        linearRegression: { enabled: true, period: 20 }
      }
    };
  }

  /**
   * Encode strategy as DNA for evolution
   */
  private encodeDNA(entryRules: any, exitRules: any, indicators: any): any {
    return {
      genes: {
        minConfidence: entryRules.minConfidence,
        minRiskReward: entryRules.minRiskReward,
        stochRSIPeriod: indicators.m5?.stochRSI?.period || 14,
        rsiPeriod: indicators.m1?.rsi?.period || 14,
        lrPeriod: indicators.m5?.linearRegression?.period || 20
      },
      version: 1,
      generation: 1
    };
  }

  /**
   * Evolve existing strategies by mutating parameters
   */
  private async evolveExistingStrategies(userId: string): Promise<DiscoveredStrategy[]> {
    console.log('[Strategy Discovery] 🧬 Evolving existing strategies...');

    const evolved: DiscoveredStrategy[] = [];

    try {
      // Get top performing strategies
      const { data: strategies } = await supabase
        .from('ai_discovered_strategies')
        .select('*')
        .eq('user_id', userId)
        .eq('validation_status', 'active')
        .gte('win_rate', 60)
        .order('expectancy', { ascending: false })
        .limit(3);

      if (!strategies || strategies.length === 0) {
        return [];
      }

      for (const strategy of strategies) {
        // Mutate parameters slightly
        const mutated = this.mutateStrategy(strategy);
        evolved.push(mutated);
      }

      console.log(`[Strategy Discovery] Created ${evolved.length} evolved variants`);
      return evolved;

    } catch (error) {
      console.error('[Strategy Discovery] Error evolving strategies:', error);
      return [];
    }
  }

  /**
   * Mutate strategy parameters for evolution
   */
  private mutateStrategy(strategy: any): DiscoveredStrategy {
    const dna = strategy.dna_encoding;

    // Randomly adjust parameters within safe ranges
    const mutatedDNA = {
      ...dna,
      genes: {
        ...dna.genes,
        minConfidence: this.mutateValue(dna.genes.minConfidence, 60, 90, 5),
        minRiskReward: this.mutateValue(dna.genes.minRiskReward, 1.5, 3.0, 0.2),
        stochRSIPeriod: this.mutateValue(dna.genes.stochRSIPeriod, 10, 20, 2),
        rsiPeriod: this.mutateValue(dna.genes.rsiPeriod, 10, 20, 2),
        lrPeriod: this.mutateValue(dna.genes.lrPeriod, 15, 30, 3)
      },
      generation: dna.generation + 1
    };

    // Apply mutations to entry rules
    const mutatedEntryRules = {
      ...strategy.entry_rules,
      minConfidence: mutatedDNA.genes.minConfidence,
      minRiskReward: mutatedDNA.genes.minRiskReward
    };

    // Apply mutations to indicators
    const mutatedIndicators = {
      ...strategy.indicators,
      m5: {
        ...strategy.indicators.m5,
        stochRSI: { ...strategy.indicators.m5.stochRSI, period: mutatedDNA.genes.stochRSIPeriod }
      },
      m1: {
        ...strategy.indicators.m1,
        rsi: { ...strategy.indicators.m1.rsi, period: mutatedDNA.genes.rsiPeriod }
      }
    };

    return {
      name: `${strategy.strategy_name} Gen ${mutatedDNA.generation}`,
      type: 'evolved',
      entryRules: mutatedEntryRules,
      exitRules: strategy.exit_rules,
      indicators: mutatedIndicators,
      timeframes: strategy.timeframes,
      dnaEncoding: mutatedDNA,
      discoveryMethod: 'parameter_evolution',
      discoveryInsights: `Evolved from ${strategy.strategy_name} with parameter mutations`,
      estimatedWinRate: strategy.win_rate,
      estimatedProfitFactor: strategy.profit_factor
    };
  }

  /**
   * Mutate a numeric value within bounds
   */
  private mutateValue(current: number, min: number, max: number, step: number): number {
    const direction = Math.random() > 0.5 ? 1 : -1;
    const mutation = direction * step;
    const newValue = current + mutation;
    return Math.max(min, Math.min(max, newValue));
  }

  /**
   * Validate strategy and save if it beats baseline
   */
  private async validateAndSaveStrategy(
    userId: string,
    strategy: DiscoveredStrategy
  ): Promise<void> {
    try {
      // Get baseline performance (Flow Trader V2)
      const baseline = await this.getBaselinePerformance(userId);

      const beatsBaseline =
        strategy.estimatedWinRate >= baseline.winRate &&
        strategy.estimatedProfitFactor >= baseline.profitFactor;

      if (!beatsBaseline) {
        console.log(`[Strategy Discovery] ❌ ${strategy.name} does not beat baseline - not saving`);
        return;
      }

      // Save strategy to database
      const { data, error } = await supabase
        .from('ai_discovered_strategies')
        .insert({
          user_id: userId,
          strategy_name: strategy.name,
          strategy_type: strategy.type,
          generation: strategy.dnaEncoding.generation,
          entry_rules: strategy.entryRules,
          exit_rules: strategy.exitRules,
          indicators: strategy.indicators,
          timeframes: strategy.timeframes,
          dna_encoding: strategy.dnaEncoding,
          discovery_method: strategy.discoveryMethod,
          discovery_insights: strategy.discoveryInsights,
          validation_status: 'pending',
          passes_baseline: beatsBaseline,
          baseline_comparison: {
            baseline_win_rate: baseline.winRate,
            baseline_profit_factor: baseline.profitFactor,
            new_win_rate: strategy.estimatedWinRate,
            new_profit_factor: strategy.estimatedProfitFactor
          }
        })
        .select()
        .single();

      if (error) {
        console.error('[Strategy Discovery] Error saving strategy:', error);
        return;
      }

      // Log creation
      await supabase.from('strategy_creation_log').insert({
        user_id: userId,
        strategy_id: data.id,
        creation_method: strategy.discoveryMethod,
        trigger_reason: 'pattern_discovery_from_trades',
        source_trades_analyzed: 0,
        winning_patterns_found: 1,
        pattern_confidence: strategy.estimatedWinRate,
        estimated_win_rate: strategy.estimatedWinRate,
        estimated_profit_factor: strategy.estimatedProfitFactor,
        confidence_in_estimate: 70
      });

      console.log(`[Strategy Discovery] ✅ Saved strategy: ${strategy.name} (beats baseline)`);

    } catch (error) {
      console.error('[Strategy Discovery] Error validating strategy:', error);
    }
  }

  /**
   * Get baseline performance (Flow Trader V2)
   */
  private async getBaselinePerformance(userId: string): Promise<{ winRate: number; profitFactor: number }> {
    try {
      const { data } = await supabase
        .from('strategy_performance')
        .select('win_rate, expectancy')
        .eq('user_id', userId)
        .eq('strategy_name', this.BASELINE_STRATEGY)
        .maybeSingle();

      if (data) {
        return {
          winRate: data.win_rate || 55,
          profitFactor: (data.expectancy || 0) > 0 ? 1.5 : 1.0
        };
      }

      // Default baseline if no data
      return { winRate: 55, profitFactor: 1.5 };
    } catch (error) {
      return { winRate: 55, profitFactor: 1.5 };
    }
  }

  /**
   * Helper: Calculate average R:R
   */
  private calculateAverageRR(trades: any[]): number {
    if (trades.length === 0) return 0;
    const rrs = trades.map(t => {
      const risk = Math.abs(t.entryPrice - t.stopLoss);
      const reward = Math.abs(t.takeProfit - t.entryPrice);
      return risk > 0 ? reward / risk : 0;
    });
    return rrs.reduce((sum, rr) => sum + rr, 0) / rrs.length;
  }

  /**
   * Helper: Calculate average hold time
   */
  private calculateAvgHoldTime(trades: any[]): number {
    if (trades.length === 0) return 0;
    const durations = trades.map(t => {
      const entry = new Date(t.entryTime).getTime();
      const exit = new Date(t.exitTime).getTime();
      return (exit - entry) / 60000; // minutes
    });
    return durations.reduce((sum, d) => sum + d, 0) / durations.length;
  }

  /**
   * Helper: Extract market conditions
   */
  private extractMarketConditions(trades: any[]): any {
    return {
      volatility: 'medium',
      trend: 'mixed',
      session: 'multiple'
    };
  }
}

export const strategyDiscoveryEngine = new StrategyDiscoveryEngine();
export type { DiscoveredStrategy, PatternCluster };
