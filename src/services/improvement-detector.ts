import { logger } from '../lib/logger';
import type { CouncilContext } from './council-context-service';

export interface ImprovementAnalysis {
  improvement_score: number;
  should_reconvene: boolean;
  key_changes: string[];
  reasoning: string;
  category_scores: Record<string, number>;
}

export interface SnapshotComparison {
  symbol: string;
  metric: string;
  old_value: number;
  new_value: number;
  change_percent: number;
  improved: boolean;
}

class ImprovementDetector {
  private readonly RECONVENE_THRESHOLD = 40; // Lowered from 60 to make scout more responsive

  compareSnapshots(
    lastSnapshot: Record<string, any>,
    currentSnapshot: Record<string, any>,
    requiredImprovements: Record<string, string[]>
  ): ImprovementAnalysis {
    const comparisons: SnapshotComparison[] = [];
    const keyChanges: string[] = [];
    const categoryScores: Record<string, number> = {};

    logger.info('[ImprovementDetector] Starting comparison', {
      lastSnapshotSymbols: Object.keys(lastSnapshot).length,
      currentSnapshotSymbols: Object.keys(currentSnapshot).length,
    });

    for (const symbol of Object.keys(lastSnapshot)) {
      if (!currentSnapshot[symbol]) continue;

      const oldData = lastSnapshot[symbol];
      const newData = currentSnapshot[symbol];

      const symbolComparisons = this.compareSymbolData(symbol, oldData, newData);
      comparisons.push(...symbolComparisons);

      if (symbolComparisons.length > 0) {
        logger.info(`[ImprovementDetector] ${symbol} changes`, {
          comparisons: symbolComparisons.slice(0, 3).map(c => ({
            metric: c.metric,
            change: `${c.old_value.toFixed(2)} -> ${c.new_value.toFixed(2)}`,
            change_pct: `${c.change_percent.toFixed(1)}%`,
            improved: c.improved
          }))
        });
      }
    }

    for (const [category, requirements] of Object.entries(requiredImprovements)) {
      const score = this.calculateCategoryScore(category, comparisons, requirements);
      categoryScores[category] = score;

      if (score > 0) {
        const changes = this.extractKeyChangesForCategory(category, comparisons);
        keyChanges.push(...changes);
      }
    }

    const overallScore = this.calculateOverallScore(categoryScores);
    const shouldReconvene = overallScore >= this.RECONVENE_THRESHOLD;
    const reasoning = this.buildReasoning(categoryScores, keyChanges, overallScore);

    logger.info('[ImprovementDetector] Analysis complete', {
      overall_score: overallScore,
      should_reconvene: shouldReconvene,
      category_scores: categoryScores,
      key_changes_count: keyChanges.length,
    });

    return {
      improvement_score: Math.round(overallScore),
      should_reconvene: shouldReconvene,
      key_changes: keyChanges,
      reasoning,
      category_scores: categoryScores,
    };
  }

  private compareSymbolData(
    symbol: string,
    oldData: any,
    newData: any
  ): SnapshotComparison[] {
    const comparisons: SnapshotComparison[] = [];

    const metrics = ['price', 'ema20', 'ema50', 'ema200', 'rsi', 'atr', 'volume', 'spread'];

    for (const metric of metrics) {
      if (oldData[metric] === undefined || newData[metric] === undefined) continue;

      const oldValue = Number(oldData[metric]);
      const newValue = Number(newData[metric]);

      if (oldValue === 0) continue;

      const changePercent = ((newValue - oldValue) / Math.abs(oldValue)) * 100;
      const improved = this.isImprovement(metric, oldValue, newValue);

      comparisons.push({
        symbol,
        metric,
        old_value: oldValue,
        new_value: newValue,
        change_percent: changePercent,
        improved,
      });
    }

    const emaCrossed = this.detectEMACross(oldData, newData);
    if (emaCrossed) {
      comparisons.push({
        symbol,
        metric: 'ema_cross',
        old_value: 0,
        new_value: 1,
        change_percent: 100,
        improved: true,
      });
    }

    return comparisons;
  }

  private isImprovement(metric: string, oldValue: number, newValue: number): boolean {
    switch (metric) {
      case 'price':
        // Any significant price movement (>0.05%) indicates market activity
        return Math.abs(newValue - oldValue) > oldValue * 0.0005;

      case 'atr':
        // ATR increase = more volatility = better trading opportunities
        return newValue > oldValue * 1.05; // 5% increase

      case 'volume':
        // Volume increase = better liquidity
        // Only count as improvement if both values are non-zero
        if (oldValue === 0 || newValue === 0) return false;
        return newValue > oldValue * 1.1; // 10% increase

      case 'spread':
        // Spread decrease = better execution
        // Only count if both values are non-zero
        if (oldValue === 0 || newValue === 0) return false;
        return newValue < oldValue * 0.9; // 10% decrease

      case 'rsi':
        // RSI moving toward neutral zone = better entry conditions
        return (newValue >= 40 && newValue <= 60) || (oldValue < 30 && newValue > 30) || (oldValue > 70 && newValue < 70);

      case 'ema20':
      case 'ema50':
      case 'ema200':
        // Any EMA movement > 0.1% is considered a change
        return Math.abs(newValue - oldValue) > oldValue * 0.001;

      default:
        return false;
    }
  }

  private detectEMACross(oldData: any, newData: any): boolean {
    if (!oldData.ema20 || !oldData.ema50 || !newData.ema20 || !newData.ema50) {
      return false;
    }

    const oldCross = oldData.ema20 > oldData.ema50;
    const newCross = newData.ema20 > newData.ema50;

    return oldCross !== newCross;
  }

  private calculateCategoryScore(
    category: string,
    comparisons: SnapshotComparison[],
    requirements: string[]
  ): number {
    const relevantComparisons = comparisons.filter((c) =>
      this.isRelevantToCategory(category, c.metric)
    );

    if (relevantComparisons.length === 0) return 0;

    const improvedCount = relevantComparisons.filter((c) => c.improved).length;
    const totalCount = relevantComparisons.length;

    const baseScore = (improvedCount / totalCount) * 100;

    const significantChanges = relevantComparisons.filter(
      (c) => c.improved && Math.abs(c.change_percent) > 5
    ).length;
    const significanceBonus = (significantChanges / totalCount) * 20;

    return Math.min(100, baseScore + significanceBonus);
  }

  private isRelevantToCategory(category: string, metric: string): boolean {
    const categoryMetrics: Record<string, string[]> = {
      trend: ['price', 'ema20', 'ema50', 'ema200', 'ema_cross'],
      volatility: ['atr', 'price'],
      liquidity: ['volume', 'spread'],
      momentum: ['rsi', 'price'],
      structure: ['ema_cross'],
      sentiment: [],
      other: [],
    };

    return categoryMetrics[category]?.includes(metric) || false;
  }

  private extractKeyChangesForCategory(
    category: string,
    comparisons: SnapshotComparison[]
  ): string[] {
    const changes: string[] = [];

    const relevantComparisons = comparisons.filter(
      (c) => c.improved && this.isRelevantToCategory(category, c.metric)
    );

    for (const comp of relevantComparisons.slice(0, 3)) {
      if (comp.metric === 'ema_cross') {
        changes.push(`${comp.symbol}: EMA crossover detected`);
      } else if (Math.abs(comp.change_percent) > 10) {
        changes.push(
          `${comp.symbol}: ${comp.metric.toUpperCase()} ${comp.change_percent > 0 ? 'increased' : 'decreased'} by ${Math.abs(comp.change_percent).toFixed(1)}%`
        );
      }
    }

    return changes;
  }

  private calculateOverallScore(categoryScores: Record<string, number>): number {
    const scores = Object.values(categoryScores);
    if (scores.length === 0) return 0;

    const weights: Record<string, number> = {
      trend: 0.3,
      volatility: 0.2,
      liquidity: 0.2,
      momentum: 0.15,
      structure: 0.1,
      sentiment: 0.05,
      other: 0,
    };

    let weightedSum = 0;
    let totalWeight = 0;

    for (const [category, score] of Object.entries(categoryScores)) {
      const weight = weights[category] || 0.1;
      weightedSum += score * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  private buildReasoning(
    categoryScores: Record<string, number>,
    keyChanges: string[],
    overallScore: number
  ): string {
    const lines: string[] = [];

    lines.push(`Overall Improvement: ${overallScore.toFixed(0)}%`);
    lines.push('');

    lines.push('Category Breakdown:');
    for (const [category, score] of Object.entries(categoryScores)) {
      const emoji = score >= 70 ? '✅' : score >= 40 ? '⚠️' : '❌';
      lines.push(`  ${emoji} ${category}: ${score.toFixed(0)}%`);
    }
    lines.push('');

    if (keyChanges.length > 0) {
      lines.push('Key Changes Detected:');
      for (const change of keyChanges.slice(0, 5)) {
        lines.push(`  • ${change}`);
      }
    } else {
      lines.push('No significant changes detected');
    }

    return lines.join('\n');
  }

  checkForceRefreshConditions(context: CouncilContext): {
    should_refresh: boolean;
    reason: string;
  } {
    if (!context.created_at) {
      return { should_refresh: true, reason: 'No previous context' };
    }

    const createdAt = new Date(context.created_at).getTime();
    const now = Date.now();
    const minutesSinceCreation = (now - createdAt) / 1000 / 60;

    if (minutesSinceCreation > 15) {
      return {
        should_refresh: true,
        reason: `Context stale (${minutesSinceCreation.toFixed(0)} min old)`,
      };
    }

    if (context.scout_cycles && context.scout_cycles >= 10) {
      return {
        should_refresh: true,
        reason: `Max scout cycles reached (${context.scout_cycles})`,
      };
    }

    return { should_refresh: false, reason: 'Context valid' };
  }

  formatImprovementTrend(improvementTrend: string[]): string {
    if (!improvementTrend || improvementTrend.length === 0) {
      return 'No trend data';
    }

    const trend = improvementTrend.slice(-5);
    const direction = this.detectTrendDirection(trend);

    return `${trend.join(' → ')} ${direction}`;
  }

  private detectTrendDirection(trend: string[]): string {
    if (trend.length < 2) return '';

    const values = trend.map((t) => parseFloat(t.replace('%', '')));
    const first = values[0];
    const last = values[values.length - 1];

    if (last > first + 10) return '📈 Improving';
    if (last < first - 10) return '📉 Declining';
    return '➡️ Stable';
  }
}

export const improvementDetector = new ImprovementDetector();
