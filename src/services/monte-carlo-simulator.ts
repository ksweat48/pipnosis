import { supabase } from '../lib/supabase';

/**
 * Monte Carlo Simulator
 *
 * Runs 1000+ simulations to calculate probability distributions:
 * - Win rate variability
 * - Drawdown probability curves
 * - Win/loss streak probabilities
 * - Final balance distribution
 * - Confidence intervals (95%)
 */

export interface MonteCarloResults {
  strategyName: string;
  simulationCount: number;
  tradeCountPerSim: number;
  initialBalance: number;

  // Input Statistics
  baseWinRate: number;
  baseProfitFactor: number;
  baseAvgWin: number;
  baseAvgLoss: number;

  // Simulation Results
  meanFinalBalance: number;
  medianFinalBalance: number;
  stdDevFinalBalance: number;

  // Probability Distributions
  probProfitable: number; // % ending profitable
  probExceeds20PctGain: number;
  probExceeds50PctGain: number;
  probExceeds100PctGain: number;

  // Risk Metrics
  probExceeds10PctDrawdown: number;
  probExceeds20PctDrawdown: number;
  probExceeds30PctDrawdown: number;
  worstCaseDrawdown: number;
  bestCaseBalance: number;

  // Streak Probabilities
  maxConsecutiveWinsMean: number;
  maxConsecutiveLossesMean: number;
  prob10LossStreak: number;

  // Confidence Intervals
  balance95PctConfidenceLower: number;
  balance95PctConfidenceUpper: number;

  // Distribution Data
  finalBalanceDistribution: Array<{ balance: number; frequency: number }>;
  drawdownDistribution: Array<{ drawdown: number; frequency: number }>;
}

class MonteCarloSimulator {
  /**
   * Run Monte Carlo simulation for a strategy
   */
  async runSimulation(
    userId: string,
    strategyName: string,
    simulationCount: number = 1000,
    tradeCount: number = 100,
    initialBalance: number = 10000
  ): Promise<MonteCarloResults> {
    console.log(`[Monte Carlo] Running ${simulationCount} simulations for ${strategyName}...`);

    // Get strategy statistics
    const stats = await this.getStrategyStatistics(userId, strategyName);

    if (stats.sampleSize < 20) {
      throw new Error('Insufficient trade history for Monte Carlo simulation (need 20+ trades)');
    }

    // Run simulations
    const simulations: Array<{
      finalBalance: number;
      maxDrawdown: number;
      maxWinStreak: number;
      maxLossStreak: number;
      profitable: boolean;
    }> = [];

    for (let i = 0; i < simulationCount; i++) {
      const result = this.runSingleSimulation(
        initialBalance,
        tradeCount,
        stats.winRate,
        stats.avgWin,
        stats.avgLoss
      );
      simulations.push(result);
    }

    // Calculate statistics
    const finalBalances = simulations.map(s => s.finalBalance).sort((a, b) => a - b);
    const maxDrawdowns = simulations.map(s => s.maxDrawdown);
    const maxWinStreaks = simulations.map(s => s.maxWinStreak);
    const maxLossStreaks = simulations.map(s => s.maxLossStreak);

    const meanFinalBalance = finalBalances.reduce((sum, b) => sum + b, 0) / simulationCount;
    const medianFinalBalance = finalBalances[Math.floor(simulationCount / 2)];
    const stdDevFinalBalance = this.calculateStdDev(finalBalances, meanFinalBalance);

    // Probability calculations
    const probProfitable = (simulations.filter(s => s.profitable).length / simulationCount) * 100;
    const probExceeds20 = (finalBalances.filter(b => b > initialBalance * 1.2).length / simulationCount) * 100;
    const probExceeds50 = (finalBalances.filter(b => b > initialBalance * 1.5).length / simulationCount) * 100;
    const probExceeds100 = (finalBalances.filter(b => b > initialBalance * 2).length / simulationCount) * 100;

    const probDd10 = (maxDrawdowns.filter(d => d > 10).length / simulationCount) * 100;
    const probDd20 = (maxDrawdowns.filter(d => d > 20).length / simulationCount) * 100;
    const probDd30 = (maxDrawdowns.filter(d => d > 30).length / simulationCount) * 100;

    const prob10LossStreak = (maxLossStreaks.filter(s => s >= 10).length / simulationCount) * 100;

    // Confidence intervals (95%)
    const lowerIdx = Math.floor(simulationCount * 0.025);
    const upperIdx = Math.floor(simulationCount * 0.975);

    // Create distributions
    const balanceDistribution = this.createDistribution(finalBalances, 20);
    const drawdownDistribution = this.createDistribution(maxDrawdowns, 10);

    const results: MonteCarloResults = {
      strategyName,
      simulationCount,
      tradeCountPerSim: tradeCount,
      initialBalance,
      baseWinRate: stats.winRate,
      baseProfitFactor: stats.profitFactor,
      baseAvgWin: stats.avgWin,
      baseAvgLoss: stats.avgLoss,
      meanFinalBalance,
      medianFinalBalance,
      stdDevFinalBalance,
      probProfitable,
      probExceeds20PctGain: probExceeds20,
      probExceeds50PctGain: probExceeds50,
      probExceeds100PctGain: probExceeds100,
      probExceeds10PctDrawdown: probDd10,
      probExceeds20PctDrawdown: probDd20,
      probExceeds30PctDrawdown: probDd30,
      worstCaseDrawdown: Math.max(...maxDrawdowns),
      bestCaseBalance: Math.max(...finalBalances),
      maxConsecutiveWinsMean: maxWinStreaks.reduce((sum, s) => sum + s, 0) / simulationCount,
      maxConsecutiveLossesMean: maxLossStreaks.reduce((sum, s) => sum + s, 0) / simulationCount,
      prob10LossStreak,
      balance95PctConfidenceLower: finalBalances[lowerIdx],
      balance95PctConfidenceUpper: finalBalances[upperIdx],
      finalBalanceDistribution: balanceDistribution,
      drawdownDistribution: drawdownDistribution
    };

    // Save to database
    await this.saveResults(userId, results);

    console.log(`[Monte Carlo] Simulation complete. Mean final balance: $${meanFinalBalance.toFixed(2)}`);

    return results;
  }

  /**
   * Run single simulation
   */
  private runSingleSimulation(
    initialBalance: number,
    tradeCount: number,
    winRate: number,
    avgWin: number,
    avgLoss: number
  ): any {
    let balance = initialBalance;
    let peak = balance;
    let maxDrawdown = 0;
    let currentWinStreak = 0;
    let currentLossStreak = 0;
    let maxWinStreak = 0;
    let maxLossStreak = 0;

    for (let i = 0; i < tradeCount; i++) {
      const isWin = Math.random() < (winRate / 100);

      // Add randomness to win/loss amounts (±30%)
      const randomFactor = 0.7 + Math.random() * 0.6;

      if (isWin) {
        const win = avgWin * randomFactor;
        balance += win;
        currentWinStreak++;
        currentLossStreak = 0;
        maxWinStreak = Math.max(maxWinStreak, currentWinStreak);
      } else {
        const loss = avgLoss * randomFactor;
        balance -= loss;
        currentLossStreak++;
        currentWinStreak = 0;
        maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
      }

      // Track drawdown
      peak = Math.max(peak, balance);
      const drawdown = ((peak - balance) / peak) * 100;
      maxDrawdown = Math.max(maxDrawdown, drawdown);

      // Stop if bankrupt
      if (balance <= 0) {
        balance = 0;
        break;
      }
    }

    return {
      finalBalance: balance,
      maxDrawdown,
      maxWinStreak,
      maxLossStreak,
      profitable: balance > initialBalance
    };
  }

  /**
   * Get strategy statistics
   */
  private async getStrategyStatistics(
    userId: string,
    strategyName: string
  ): Promise<{ winRate: number; avgWin: number; avgLoss: number; profitFactor: number; sampleSize: number }> {
    const { data } = await supabase
      .from('ai_trade_analysis')
      .select('outcome, pnl')
      .eq('user_id', userId)
      .contains('matching_historical_patterns', [strategyName])
      .in('outcome', ['win', 'loss']);

    if (!data || data.length === 0) {
      return { winRate: 50, avgWin: 50, avgLoss: 50, profitFactor: 1, sampleSize: 0 };
    }

    const wins = data.filter(t => t.outcome === 'win');
    const losses = data.filter(t => t.outcome === 'loss');

    const winRate = (wins.length / data.length) * 100;
    const totalWins = wins.reduce((sum, t) => sum + Math.abs(parseFloat(t.pnl.toString())), 0);
    const totalLosses = losses.reduce((sum, t) => sum + Math.abs(parseFloat(t.pnl.toString())), 0);
    const avgWin = wins.length > 0 ? totalWins / wins.length : 50;
    const avgLoss = losses.length > 0 ? totalLosses / losses.length : 50;
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 1;

    return { winRate, avgWin, avgLoss, profitFactor, sampleSize: data.length };
  }

  /**
   * Calculate standard deviation
   */
  private calculateStdDev(values: number[], mean: number): number {
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * Create distribution histogram
   */
  private createDistribution(values: number[], buckets: number): Array<{ balance: number; frequency: number }> {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const bucketSize = (max - min) / buckets;

    const distribution: Array<{ balance: number; frequency: number }> = [];

    for (let i = 0; i < buckets; i++) {
      const bucketMin = min + i * bucketSize;
      const bucketMax = bucketMin + bucketSize;
      const count = values.filter(v => v >= bucketMin && v < bucketMax).length;

      distribution.push({
        balance: bucketMin + bucketSize / 2,
        frequency: count
      });
    }

    return distribution;
  }

  /**
   * Save results to database
   */
  private async saveResults(userId: string, results: MonteCarloResults): Promise<void> {
    await supabase.from('monte_carlo_simulations').insert({
      user_id: userId,
      simulation_time: new Date().toISOString(),
      strategy_name: results.strategyName,
      simulation_count: results.simulationCount,
      trade_count_per_sim: results.tradeCountPerSim,
      initial_balance: results.initialBalance,
      base_win_rate: results.baseWinRate,
      base_profit_factor: results.baseProfitFactor,
      base_avg_win: results.baseAvgWin,
      base_avg_loss: results.baseAvgLoss,
      mean_final_balance: results.meanFinalBalance,
      median_final_balance: results.medianFinalBalance,
      std_dev_final_balance: results.stdDevFinalBalance,
      prob_profitable: results.probProfitable,
      prob_exceeds_20pct_gain: results.probExceeds20PctGain,
      prob_exceeds_50pct_gain: results.probExceeds50PctGain,
      prob_exceeds_100pct_gain: results.probExceeds100PctGain,
      prob_exceeds_10pct_drawdown: results.probExceeds10PctDrawdown,
      prob_exceeds_20pct_drawdown: results.probExceeds20PctDrawdown,
      prob_exceeds_30pct_drawdown: results.probExceeds30PctDrawdown,
      worst_case_drawdown: results.worstCaseDrawdown,
      best_case_balance: results.bestCaseBalance,
      max_consecutive_wins_mean: results.maxConsecutiveWinsMean,
      max_consecutive_losses_mean: results.maxConsecutiveLossesMean,
      prob_10_loss_streak: results.prob10LossStreak,
      balance_95pct_confidence_lower: results.balance95PctConfidenceLower,
      balance_95pct_confidence_upper: results.balance95PctConfidenceUpper,
      final_balance_distribution: results.finalBalanceDistribution,
      drawdown_distribution: results.drawdownDistribution
    });
  }
}

export const monteCarloSimulator = new MonteCarloSimulator();
