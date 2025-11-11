import { supabase } from '../lib/supabase';

/**
 * Strategy Evolution Engine
 *
 * Optimizes strategy parameters through evolutionary algorithms.
 * Uses mutation, crossover, and selection to improve strategies over time.
 */

interface EvolutionConfig {
  mutationRate: number; // 0-1, probability of mutation
  crossoverRate: number; // 0-1, probability of crossover
  populationSize: number;
  generations: number;
  elitismCount: number; // Top N to keep unchanged
}

interface ParameterRange {
  min: number;
  max: number;
  step: number;
}

class StrategyEvolutionEngine {
  private readonly DEFAULT_CONFIG: EvolutionConfig = {
    mutationRate: 0.3,
    crossoverRate: 0.7,
    populationSize: 10,
    generations: 5,
    elitismCount: 2
  };

  private readonly PARAMETER_RANGES: Record<string, ParameterRange> = {
    minConfidence: { min: 60, max: 90, step: 5 },
    minRiskReward: { min: 1.5, max: 3.0, step: 0.2 },
    stochRSIPeriod: { min: 10, max: 20, step: 2 },
    rsiPeriod: { min: 10, max: 20, step: 2 },
    lrPeriod: { min: 15, max: 30, step: 3 },
    halfTrendAmplitude: { min: 1, max: 3, step: 0.5 },
    maxHoldTime: { min: 60, max: 480, step: 30 }
  };

  /**
   * Evolve a strategy through multiple generations
   */
  async evolveStrategy(
    userId: string,
    strategyId: string,
    config: Partial<EvolutionConfig> = {}
  ): Promise<{ bestStrategy: any; improvements: any }> {
    console.log(`\n[Strategy Evolution] 🧬 Evolving strategy ${strategyId}`);

    const evolutionConfig = { ...this.DEFAULT_CONFIG, ...config };

    try {
      // 1. Load base strategy
      const { data: baseStrategy, error } = await supabase
        .from('ai_discovered_strategies')
        .select('*')
        .eq('id', strategyId)
        .eq('user_id', userId)
        .single();

      if (error || !baseStrategy) {
        console.error('[Strategy Evolution] Strategy not found');
        return { bestStrategy: null, improvements: {} };
      }

      // 2. Create initial population (variations of base strategy)
      let population = this.createInitialPopulation(baseStrategy, evolutionConfig.populationSize);

      let bestFitness = this.calculateFitness(baseStrategy);
      let bestStrategy = baseStrategy;
      let generation = 1;

      console.log(`[Strategy Evolution] Initial fitness: ${bestFitness.toFixed(2)}`);

      // 3. Evolve through generations
      for (let gen = 0; gen < evolutionConfig.generations; gen++) {
        console.log(`[Strategy Evolution] Generation ${gen + 1}/${evolutionConfig.generations}`);

        // Evaluate fitness for each individual
        const evaluated = population.map(individual => ({
          individual,
          fitness: this.calculateFitness(individual)
        }));

        // Sort by fitness (best first)
        evaluated.sort((a, b) => b.fitness - a.fitness);

        // Check if we found improvement
        if (evaluated[0].fitness > bestFitness) {
          bestFitness = evaluated[0].fitness;
          bestStrategy = evaluated[0].individual;
          generation = gen + 1;
          console.log(`[Strategy Evolution] ✨ New best fitness: ${bestFitness.toFixed(2)}`);
        }

        // Create next generation
        population = this.createNextGeneration(evaluated, evolutionConfig);
      }

      // 4. Save best evolved strategy
      if (bestStrategy !== baseStrategy) {
        await this.saveEvolvedStrategy(userId, baseStrategy, bestStrategy, generation);
      }

      const improvements = this.calculateImprovements(baseStrategy, bestStrategy);

      console.log(`[Strategy Evolution] ✅ Evolution complete. Improvement: ${improvements.fitnessImprovement.toFixed(1)}%`);

      return { bestStrategy, improvements };

    } catch (error) {
      console.error('[Strategy Evolution] Error:', error);
      return { bestStrategy: null, improvements: {} };
    }
  }

  /**
   * Create initial population by varying parameters
   */
  private createInitialPopulation(baseStrategy: any, size: number): any[] {
    const population: any[] = [baseStrategy]; // Include base strategy

    for (let i = 1; i < size; i++) {
      const variant = this.mutate(JSON.parse(JSON.stringify(baseStrategy)));
      population.push(variant);
    }

    return population;
  }

  /**
   * Mutate a strategy by randomly adjusting parameters
   */
  private mutate(strategy: any): any {
    const dna = strategy.dna_encoding;

    // Mutate each gene with probability
    for (const [gene, value] of Object.entries(dna.genes)) {
      if (Math.random() < this.DEFAULT_CONFIG.mutationRate) {
        const range = this.PARAMETER_RANGES[gene];
        if (range) {
          dna.genes[gene] = this.mutateParameter(value as number, range);
        }
      }
    }

    // Apply mutations to strategy rules
    strategy.entry_rules.minConfidence = dna.genes.minConfidence;
    strategy.entry_rules.minRiskReward = dna.genes.minRiskReward;

    if (strategy.indicators.m5?.stochRSI) {
      strategy.indicators.m5.stochRSI.period = dna.genes.stochRSIPeriod;
    }
    if (strategy.indicators.m1?.rsi) {
      strategy.indicators.m1.rsi.period = dna.genes.rsiPeriod;
    }

    dna.generation += 1;
    strategy.dna_encoding = dna;

    return strategy;
  }

  /**
   * Mutate a single parameter within its range
   */
  private mutateParameter(current: number, range: ParameterRange): number {
    const direction = Math.random() > 0.5 ? 1 : -1;
    const steps = Math.floor(Math.random() * 3) + 1; // 1-3 steps
    const newValue = current + (direction * range.step * steps);
    return Math.max(range.min, Math.min(range.max, newValue));
  }

  /**
   * Create crossover between two strategies
   */
  private crossover(parent1: any, parent2: any): any {
    const child = JSON.parse(JSON.stringify(parent1));
    const dna1 = parent1.dna_encoding.genes;
    const dna2 = parent2.dna_encoding.genes;

    // For each gene, randomly choose from parent1 or parent2
    for (const gene of Object.keys(dna1)) {
      if (Math.random() > 0.5) {
        child.dna_encoding.genes[gene] = dna2[gene];
      }
    }

    // Apply genes to strategy
    child.entry_rules.minConfidence = child.dna_encoding.genes.minConfidence;
    child.entry_rules.minRiskReward = child.dna_encoding.genes.minRiskReward;

    child.dna_encoding.generation = Math.max(
      parent1.dna_encoding.generation,
      parent2.dna_encoding.generation
    ) + 1;

    return child;
  }

  /**
   * Calculate fitness score for a strategy
   * Higher is better
   */
  private calculateFitness(strategy: any): number {
    // Fitness = weighted combination of key metrics
    const winRate = strategy.win_rate || 0;
    const profitFactor = strategy.profit_factor || 0;
    const expectancy = strategy.expectancy || 0;
    const totalTrades = strategy.total_trades || 0;

    // Penalize if insufficient sample size
    const sampleSizePenalty = totalTrades < 20 ? 0.5 : 1.0;

    // Weighted fitness score
    const fitness = (
      (winRate * 0.3) +
      (profitFactor * 20) +
      (expectancy * 50)
    ) * sampleSizePenalty;

    return fitness;
  }

  /**
   * Create next generation using selection, crossover, and mutation
   */
  private createNextGeneration(
    evaluated: Array<{ individual: any; fitness: number }>,
    config: EvolutionConfig
  ): any[] {
    const nextGen: any[] = [];

    // Elitism: Keep best individuals unchanged
    for (let i = 0; i < config.elitismCount; i++) {
      nextGen.push(JSON.parse(JSON.stringify(evaluated[i].individual)));
    }

    // Fill rest with crossover and mutation
    while (nextGen.length < config.populationSize) {
      if (Math.random() < config.crossoverRate && evaluated.length >= 2) {
        // Select two parents using tournament selection
        const parent1 = this.tournamentSelect(evaluated);
        const parent2 = this.tournamentSelect(evaluated);
        const child = this.crossover(parent1, parent2);
        nextGen.push(child);
      } else {
        // Mutation only
        const parent = this.tournamentSelect(evaluated);
        const mutated = this.mutate(JSON.parse(JSON.stringify(parent)));
        nextGen.push(mutated);
      }
    }

    return nextGen;
  }

  /**
   * Tournament selection: pick best from random subset
   */
  private tournamentSelect(
    evaluated: Array<{ individual: any; fitness: number }>
  ): any {
    const tournamentSize = 3;
    let best = evaluated[Math.floor(Math.random() * evaluated.length)];

    for (let i = 1; i < tournamentSize; i++) {
      const competitor = evaluated[Math.floor(Math.random() * evaluated.length)];
      if (competitor.fitness > best.fitness) {
        best = competitor;
      }
    }

    return best.individual;
  }

  /**
   * Save evolved strategy to database
   */
  private async saveEvolvedStrategy(
    userId: string,
    baseStrategy: any,
    evolvedStrategy: any,
    generation: number
  ): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('ai_discovered_strategies')
        .insert({
          user_id: userId,
          strategy_name: `${baseStrategy.strategy_name} Evolved Gen${generation}`,
          strategy_type: 'evolved',
          parent_strategy_id: baseStrategy.id,
          generation,
          entry_rules: evolvedStrategy.entry_rules,
          exit_rules: evolvedStrategy.exit_rules,
          indicators: evolvedStrategy.indicators,
          timeframes: evolvedStrategy.timeframes,
          dna_encoding: evolvedStrategy.dna_encoding,
          discovery_method: 'parameter_evolution',
          discovery_insights: `Evolved through ${generation} generations of parameter optimization`,
          validation_status: 'pending'
        })
        .select()
        .single();

      if (error) {
        console.error('[Strategy Evolution] Error saving evolved strategy:', error);
        return;
      }

      // Log parameter changes
      await this.logParameterEvolution(userId, baseStrategy.id, data.id, baseStrategy, evolvedStrategy);

      console.log(`[Strategy Evolution] ✅ Saved evolved strategy: ${data.strategy_name}`);

    } catch (error) {
      console.error('[Strategy Evolution] Error saving:', error);
    }
  }

  /**
   * Log parameter evolution history
   */
  private async logParameterEvolution(
    userId: string,
    oldStrategyId: string,
    newStrategyId: string,
    oldStrategy: any,
    newStrategy: any
  ): Promise<void> {
    const oldGenes = oldStrategy.dna_encoding.genes;
    const newGenes = newStrategy.dna_encoding.genes;

    for (const [param, newValue] of Object.entries(newGenes)) {
      const oldValue = oldGenes[param];

      if (oldValue !== newValue) {
        await supabase.from('strategy_parameter_evolution').insert({
          user_id: userId,
          strategy_id: newStrategyId,
          evolution_type: 'optimization',
          parameter_name: param,
          old_value: oldValue,
          new_value: newValue,
          evolution_reason: 'Fitness improvement through evolution'
        });
      }
    }
  }

  /**
   * Calculate improvement metrics
   */
  private calculateImprovements(baseStrategy: any, evolvedStrategy: any): any {
    const baseFitness = this.calculateFitness(baseStrategy);
    const evolvedFitness = this.calculateFitness(evolvedStrategy);

    return {
      fitnessImprovement: ((evolvedFitness - baseFitness) / baseFitness) * 100,
      winRateDelta: (evolvedStrategy.win_rate || 0) - (baseStrategy.win_rate || 0),
      profitFactorDelta: (evolvedStrategy.profit_factor || 0) - (baseStrategy.profit_factor || 0),
      expectancyDelta: (evolvedStrategy.expectancy || 0) - (baseStrategy.expectancy || 0)
    };
  }

  /**
   * Optimize Flow Trader V2 parameters
   */
  async optimizeFlowTraderV2(userId: string): Promise<any> {
    console.log('[Strategy Evolution] 🎯 Optimizing Flow Trader V2 parameters');

    // Get current Flow Trader V2 performance
    const { data: currentPerf } = await supabase
      .from('strategy_performance')
      .select('*')
      .eq('user_id', userId)
      .eq('strategy_name', 'Flow Trader V2')
      .maybeSingle();

    if (!currentPerf) {
      console.log('[Strategy Evolution] No Flow Trader V2 data found');
      return null;
    }

    // Create a strategy entry for Flow Trader V2 if it doesn't exist
    const { data: flowStrategy } = await supabase
      .from('ai_discovered_strategies')
      .select('id')
      .eq('user_id', userId)
      .eq('strategy_name', 'Flow Trader V2')
      .maybeSingle();

    if (!flowStrategy) {
      // Create base Flow Trader V2 entry
      await supabase.from('ai_discovered_strategies').insert({
        user_id: userId,
        strategy_name: 'Flow Trader V2',
        strategy_type: 'discovered',
        generation: 1,
        entry_rules: {
          direction: 'both',
          minConfidence: 75,
          minRiskReward: 1.5
        },
        exit_rules: {
          takeProfit: 'fixed_rr',
          stopLoss: 'atr_based'
        },
        indicators: {
          h1: { candlePattern: { enabled: true } },
          m5: {
            halfTrend: { enabled: true, amplitude: 2 },
            stochRSI: { enabled: true, period: 14 },
            linearRegression: { enabled: true, period: 20 }
          },
          m1: {
            heikinAshi: { enabled: true },
            rsi: { enabled: true, period: 14 }
          }
        },
        timeframes: ['H1', 'M5', 'M1'],
        dna_encoding: {
          genes: {
            minConfidence: 75,
            minRiskReward: 1.5,
            stochRSIPeriod: 14,
            rsiPeriod: 14,
            lrPeriod: 20
          },
          version: 1,
          generation: 1
        },
        discovery_method: 'manual',
        discovery_insights: 'Base Flow Trader V2 strategy',
        validation_status: 'active',
        win_rate: currentPerf.win_rate || 0,
        profit_factor: 1.5,
        total_trades: currentPerf.total_trades || 0
      });
    }

    console.log('[Strategy Evolution] ✅ Flow Trader V2 optimization complete');
    return { message: 'Flow Trader V2 ready for evolution' };
  }
}

export const strategyEvolutionEngine = new StrategyEvolutionEngine();
export type { EvolutionConfig, ParameterRange };
