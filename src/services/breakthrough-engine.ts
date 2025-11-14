import { supabase } from '../lib/supabase';
import { plateauDetector } from './plateau-detector';
import { syntheticBacktestingEngine, SyntheticBacktestConfig } from './synthetic-backtesting-engine';

interface BreakthroughStrategy {
  name: string;
  type: 'confidence_sweep' | 'symbol_focus' | 'time_filter' | 'market_condition' | 'contrarian' | 'aggressive';
  description: string;
  configOverrides: Partial<SyntheticBacktestConfig>;
  expectedImpact: string;
}

interface BreakthroughResult {
  strategyName: string;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  improvement: number;
  wasSuccessful: boolean;
  shouldAdopt: boolean;
}

class BreakthroughEngine {
  private isRunningBreakthrough = false;

  async triggerBreakthroughMode(userId: string): Promise<{
    triggered: boolean;
    strategies: BreakthroughStrategy[];
    message: string;
  }> {
    console.log('\n[Breakthrough Engine] 🚀 INITIATING BREAKTHROUGH MODE');

    if (this.isRunningBreakthrough) {
      return {
        triggered: false,
        strategies: [],
        message: 'Breakthrough mode already running'
      };
    }

    const plateau = await plateauDetector.detectPlateau(userId);

    if (!plateau?.isPlateaued) {
      return {
        triggered: false,
        strategies: [],
        message: 'No plateau detected - breakthrough not needed'
      };
    }

    this.isRunningBreakthrough = true;

    const strategies = this.generateBreakthroughStrategies(plateau.currentWinRate);

    console.log(`[Breakthrough Engine] Generated ${strategies.length} breakthrough strategies`);
    console.log(`[Breakthrough Engine] Current baseline: ${plateau.currentWinRate.toFixed(1)}%`);

    await this.logBreakthroughTrigger(userId, plateau, strategies);

    return {
      triggered: true,
      strategies,
      message: `Breakthrough mode activated - testing ${strategies.length} experimental strategies`
    };
  }

  private generateBreakthroughStrategies(currentWinRate: number): BreakthroughStrategy[] {
    const strategies: BreakthroughStrategy[] = [];
    const baseSymbols = ['EURUSD', 'XAUUSD', 'GBPUSD', 'USDJPY', 'US30'];

    if (currentWinRate < 60) {
      strategies.push({
        name: 'Ultra Conservative (95% Confidence)',
        type: 'confidence_sweep',
        description: 'Only take highest confidence trades to rebuild win rate',
        configOverrides: {
          confidenceThreshold: 95,
          riskMode: 'low',
          maxConcurrentTrades: 1
        },
        expectedImpact: 'Fewer trades but much higher win rate'
      });

      strategies.push({
        name: 'Focus Best Pair Only',
        type: 'symbol_focus',
        description: 'Trade only the historically best performing symbol',
        configOverrides: {
          symbols: ['EURUSD'],
          confidenceThreshold: 85
        },
        expectedImpact: 'Specialization on proven strength'
      });
    } else if (currentWinRate >= 60 && currentWinRate < 80) {
      strategies.push({
        name: 'Moderate Confidence Boost (85%)',
        type: 'confidence_sweep',
        description: 'Increase confidence threshold to filter weak signals',
        configOverrides: {
          confidenceThreshold: 85,
          riskMode: 'medium'
        },
        expectedImpact: 'Reduce false positives'
      });

      strategies.push({
        name: 'Gold and Indices Focus',
        type: 'symbol_focus',
        description: 'Focus on trending assets (XAUUSD, US30)',
        configOverrides: {
          symbols: ['XAUUSD', 'US30'],
          confidenceThreshold: 75
        },
        expectedImpact: 'Leverage trending market momentum'
      });

      strategies.push({
        name: 'Aggressive Exploration (65%)',
        type: 'aggressive',
        description: 'Lower threshold to explore more opportunities',
        configOverrides: {
          confidenceThreshold: 65,
          riskMode: 'high',
          maxConcurrentTrades: 3
        },
        expectedImpact: 'Find hidden patterns in lower confidence setups'
      });
    } else {
      strategies.push({
        name: 'Elite Threshold (90%)',
        type: 'confidence_sweep',
        description: 'Push toward elite-level selectivity',
        configOverrides: {
          confidenceThreshold: 90,
          riskMode: 'low'
        },
        expectedImpact: 'Achieve 90%+ win rate through extreme selectivity'
      });

      strategies.push({
        name: 'Multi-Pair Diversification',
        type: 'symbol_focus',
        description: 'Trade all major pairs for diversification',
        configOverrides: {
          symbols: baseSymbols,
          confidenceThreshold: 82
        },
        expectedImpact: 'Reduce symbol-specific risk'
      });

      strategies.push({
        name: 'Contrarian Lower Threshold (70%)',
        type: 'contrarian',
        description: 'Test if lower threshold finds better opportunities',
        configOverrides: {
          confidenceThreshold: 70,
          riskMode: 'medium',
          maxConcurrentTrades: 2
        },
        expectedImpact: 'Discover if being too selective is limiting growth'
      });
    }

    strategies.push({
      name: 'London Session Only',
      type: 'time_filter',
      description: 'Trade only during high-liquidity London hours',
      configOverrides: {
        confidenceThreshold: currentWinRate >= 75 ? 80 : 75
      },
      expectedImpact: 'Optimize for best market hours'
    });

    return strategies;
  }

  async executeBreakthroughStrategy(
    userId: string,
    strategy: BreakthroughStrategy,
    baselineWinRate: number
  ): Promise<BreakthroughResult> {
    console.log(`\n[Breakthrough Engine] 🧪 Testing: ${strategy.name}`);

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 2 * 24 * 60 * 60 * 1000);

    const config: SyntheticBacktestConfig = {
      sessionName: `Breakthrough-${strategy.type}-${Date.now()}`,
      description: `Breakthrough Test: ${strategy.description}`,
      symbols: strategy.configOverrides.symbols || ['EURUSD', 'XAUUSD', 'GBPUSD'],
      startDate,
      endDate,
      timeframes: ['H1', 'M5', 'M1'],
      useGPT4Reasoning: false,
      confidenceThreshold: strategy.configOverrides.confidenceThreshold || 75,
      riskMode: strategy.configOverrides.riskMode || 'medium',
      maxConcurrentTrades: strategy.configOverrides.maxConcurrentTrades || 2,
      initialBalance: 10000,
      positionSizePercent: 2,
      commissionPerTrade: 0,
      slippagePips: 1,
      marketScenario: 'mixed'
    };

    try {
      const result = await syntheticBacktestingEngine.runSyntheticBacktest(
        userId,
        config,
        (progress) => {
          if (progress.percentComplete % 25 === 0) {
            console.log(`[Breakthrough Engine]   Progress: ${progress.percentComplete.toFixed(0)}%`);
          }
        }
      );

      const improvement = result.winRate - baselineWinRate;
      const wasSuccessful = improvement > 2;
      const shouldAdopt = improvement > 5;

      console.log(`[Breakthrough Engine] ✅ Result: ${result.winRate.toFixed(1)}% (${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}%)`);

      const breakthroughResult: BreakthroughResult = {
        strategyName: strategy.name,
        winRate: result.winRate,
        profitFactor: result.profitFactor,
        totalTrades: result.totalTrades,
        improvement,
        wasSuccessful,
        shouldAdopt
      };

      await this.logBreakthroughResult(userId, strategy, breakthroughResult);

      return breakthroughResult;

    } catch (error) {
      console.error(`[Breakthrough Engine] Error testing strategy:`, error);
      return {
        strategyName: strategy.name,
        winRate: 0,
        profitFactor: 0,
        totalTrades: 0,
        improvement: 0,
        wasSuccessful: false,
        shouldAdopt: false
      };
    }
  }

  async runFullBreakthroughCycle(userId: string): Promise<{
    success: boolean;
    bestStrategy: BreakthroughResult | null;
    allResults: BreakthroughResult[];
    recommendation: string;
  }> {
    console.log('\n[Breakthrough Engine] 🎯 STARTING FULL BREAKTHROUGH CYCLE');

    const plateau = await plateauDetector.detectPlateau(userId);

    if (!plateau?.isPlateaued) {
      return {
        success: false,
        bestStrategy: null,
        allResults: [],
        recommendation: 'No plateau detected - not running breakthrough cycle'
      };
    }

    const strategies = this.generateBreakthroughStrategies(plateau.currentWinRate);
    const results: BreakthroughResult[] = [];

    for (const strategy of strategies) {
      const result = await this.executeBreakthroughStrategy(userId, strategy, plateau.currentWinRate);
      results.push(result);

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    const sortedResults = results.sort((a, b) => b.improvement - a.improvement);
    const bestStrategy = sortedResults[0];

    let recommendation = '';

    if (bestStrategy.shouldAdopt) {
      recommendation = `BREAKTHROUGH FOUND! Adopt "${bestStrategy.strategyName}" - improves win rate by ${bestStrategy.improvement.toFixed(1)}% to ${bestStrategy.winRate.toFixed(1)}%`;

      await supabase.from('ai_learning_milestones').insert({
        user_id: userId,
        milestone_type: 'breakthrough',
        milestone_title: 'Breakthrough Strategy Discovered!',
        milestone_description: `Found strategy that improves win rate by ${bestStrategy.improvement.toFixed(1)}%: ${bestStrategy.strategyName}`,
        skill_level_at_achievement: 'Intermediate',
        total_trades_at_achievement: 0,
        win_rate_at_achievement: bestStrategy.winRate
      });
    } else if (bestStrategy.wasSuccessful) {
      recommendation = `Minor improvement found with "${bestStrategy.strategyName}" (+${bestStrategy.improvement.toFixed(1)}%). Continue testing variations.`;
    } else {
      recommendation = `No breakthrough found. All strategies performed at or below baseline. Consider fundamental strategy review.`;
    }

    console.log(`\n[Breakthrough Engine] 🏁 CYCLE COMPLETE`);
    console.log(`[Breakthrough Engine] Best: ${bestStrategy.strategyName} (+${bestStrategy.improvement.toFixed(1)}%)`);
    console.log(`[Breakthrough Engine] ${recommendation}`);

    this.isRunningBreakthrough = false;

    return {
      success: true,
      bestStrategy,
      allResults: results,
      recommendation
    };
  }

  private async logBreakthroughTrigger(
    userId: string,
    plateau: any,
    strategies: BreakthroughStrategy[]
  ): Promise<void> {
    try {
      await supabase.from('breakthrough_sessions').insert({
        user_id: userId,
        trigger_reason: 'plateau_detected',
        baseline_win_rate: plateau.currentWinRate,
        plateau_duration: plateau.plateauDuration,
        strategies_planned: strategies.length,
        status: 'running',
        started_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('[Breakthrough Engine] Error logging trigger:', error);
    }
  }

  private async logBreakthroughResult(
    userId: string,
    strategy: BreakthroughStrategy,
    result: BreakthroughResult
  ): Promise<void> {
    try {
      await supabase.from('breakthrough_results').insert({
        user_id: userId,
        strategy_name: strategy.name,
        strategy_type: strategy.type,
        strategy_description: strategy.description,
        win_rate: result.winRate,
        profit_factor: result.profitFactor,
        total_trades: result.totalTrades,
        improvement: result.improvement,
        was_successful: result.wasSuccessful,
        should_adopt: result.shouldAdopt,
        tested_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('[Breakthrough Engine] Error logging result:', error);
    }
  }

  isBreakthroughRunning(): boolean {
    return this.isRunningBreakthrough;
  }
}

export const breakthroughEngine = new BreakthroughEngine();
export type { BreakthroughStrategy, BreakthroughResult };
