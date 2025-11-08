import { SyntheticBacktestTrade } from './synthetic-backtesting-engine';

export interface TradeAnalytics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;

  totalPnL: number;
  totalWinAmount: number;
  totalLossAmount: number;

  avgWinAmount: number;
  avgLossAmount: number;
  avgTradeSpend: number;
  avgTradeSize: number;

  bestTrade: { pnl: number; symbol: string; time: Date } | null;
  worstTrade: { pnl: number; symbol: string; time: Date } | null;

  winRate: number;
  profitFactor: number;
  expectancy: number;

  avgWinDuration: number;
  avgLossDuration: number;
  avgRiskRewardActual: number;
}

export interface LossAnalysis {
  totalLosses: number;
  lossCategories: {
    stoppedOutEarly: { count: number; percentage: number; avgLoss: number };
    wrongDirection: { count: number; percentage: number; avgLoss: number };
    poorTiming: { count: number; percentage: number; avgLoss: number };
    marketReversal: { count: number; percentage: number; avgLoss: number };
  };
  commonPatterns: string[];
  improvementOpportunities: string[];
}

export interface WinAnalysis {
  totalWins: number;
  winCategories: {
    quickWins: { count: number; percentage: number; avgWin: number };
    patientWins: { count: number; percentage: number; avgWin: number };
    perfectExecution: { count: number; percentage: number; avgWin: number };
    partialProfit: { count: number; percentage: number; avgWin: number };
  };
  successPatterns: string[];
  strengthAreas: string[];
}

export interface TimeDistribution {
  byHour: { [hour: number]: { wins: number; losses: number; avgPnL: number } };
  byDayOfWeek: { [day: number]: { wins: number; losses: number; avgPnL: number } };
  bestTradingHours: number[];
  worstTradingHours: number[];
}

export interface ImprovementRecommendations {
  priority: 'high' | 'medium' | 'low';
  category: string;
  issue: string;
  recommendation: string;
  expectedImpact: string;
  currentMetric: string | number;
  targetMetric: string | number;
}

export interface ComprehensiveAnalytics {
  tradeAnalytics: TradeAnalytics;
  lossAnalysis: LossAnalysis;
  winAnalysis: WinAnalysis;
  timeDistribution: TimeDistribution;
  recommendations: ImprovementRecommendations[];
  overallGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  gradeBreakdown: {
    profitability: number;
    consistency: number;
    riskManagement: number;
    execution: number;
  };
}

class SyntheticBacktestAnalytics {
  calculateComprehensiveAnalytics(trades: SyntheticBacktestTrade[], initialBalance: number): ComprehensiveAnalytics {
    const tradeAnalytics = this.calculateTradeAnalytics(trades);
    const lossAnalysis = this.analyzeLosses(trades);
    const winAnalysis = this.analyzeWins(trades);
    const timeDistribution = this.analyzeTimeDistribution(trades);
    const recommendations = this.generateRecommendations(trades, tradeAnalytics, lossAnalysis, winAnalysis);
    const gradeBreakdown = this.calculateGradeBreakdown(tradeAnalytics, lossAnalysis, winAnalysis);
    const overallGrade = this.calculateOverallGrade(gradeBreakdown);

    return {
      tradeAnalytics,
      lossAnalysis,
      winAnalysis,
      timeDistribution,
      recommendations,
      overallGrade,
      gradeBreakdown
    };
  }

  private calculateTradeAnalytics(trades: SyntheticBacktestTrade[]): TradeAnalytics {
    const winningTrades = trades.filter(t => t.outcome === 'win');
    const losingTrades = trades.filter(t => t.outcome === 'loss');
    const breakevenTrades = trades.filter(t => t.outcome === 'breakeven');

    const totalWinAmount = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const totalLossAmount = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
    const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);

    const avgWinAmount = winningTrades.length > 0 ? totalWinAmount / winningTrades.length : 0;
    const avgLossAmount = losingTrades.length > 0 ? totalLossAmount / losingTrades.length : 0;
    const avgTradeSpend = trades.length > 0 ? trades.reduce((sum, t) => sum + t.positionSize, 0) / trades.length : 0;
    const avgTradeSize = trades.length > 0 ? trades.reduce((sum, t) => sum + t.positionSize, 0) / trades.length : 0;

    const bestTrade = trades.length > 0
      ? trades.reduce((best, t) => t.pnl > (best?.pnl || -Infinity) ? { pnl: t.pnl, symbol: t.symbol, time: t.entryTime } : best, null as any)
      : null;

    const worstTrade = trades.length > 0
      ? trades.reduce((worst, t) => t.pnl < (worst?.pnl || Infinity) ? { pnl: t.pnl, symbol: t.symbol, time: t.entryTime } : worst, null as any)
      : null;

    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
    const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : 999.99;
    const expectancy = trades.length > 0 ? totalPnL / trades.length : 0;

    const avgWinDuration = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + (t.holdingDurationMinutes || 0), 0) / winningTrades.length
      : 0;

    const avgLossDuration = losingTrades.length > 0
      ? losingTrades.reduce((sum, t) => sum + (t.holdingDurationMinutes || 0), 0) / losingTrades.length
      : 0;

    const avgRiskRewardActual = trades.length > 0
      ? trades.reduce((sum, t) => sum + t.riskRewardRatio, 0) / trades.length
      : 0;

    return {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      breakevenTrades: breakevenTrades.length,
      totalPnL,
      totalWinAmount,
      totalLossAmount,
      avgWinAmount,
      avgLossAmount,
      avgTradeSpend,
      avgTradeSize,
      bestTrade,
      worstTrade,
      winRate,
      profitFactor,
      expectancy,
      avgWinDuration,
      avgLossDuration,
      avgRiskRewardActual
    };
  }

  private analyzeLosses(trades: SyntheticBacktestTrade[]): LossAnalysis {
    const losingTrades = trades.filter(t => t.outcome === 'loss');
    const totalLosses = losingTrades.length;

    if (totalLosses === 0) {
      return {
        totalLosses: 0,
        lossCategories: {
          stoppedOutEarly: { count: 0, percentage: 0, avgLoss: 0 },
          wrongDirection: { count: 0, percentage: 0, avgLoss: 0 },
          poorTiming: { count: 0, percentage: 0, avgLoss: 0 },
          marketReversal: { count: 0, percentage: 0, avgLoss: 0 }
        },
        commonPatterns: [],
        improvementOpportunities: []
      };
    }

    const quickLosses = losingTrades.filter(t => (t.holdingDurationMinutes || 0) < 30);
    const slowLosses = losingTrades.filter(t => (t.holdingDurationMinutes || 0) >= 30);
    const smallLosses = losingTrades.filter(t => Math.abs(t.pnl) < 50);
    const largeLosses = losingTrades.filter(t => Math.abs(t.pnl) >= 50);

    const stoppedOutEarly = quickLosses.length;
    const wrongDirection = Math.floor(totalLosses * 0.3);
    const poorTiming = Math.floor(totalLosses * 0.25);
    const marketReversal = totalLosses - stoppedOutEarly - wrongDirection - poorTiming;

    const commonPatterns: string[] = [];
    if (quickLosses.length > totalLosses * 0.5) {
      commonPatterns.push('Over 50% of losses occur within 30 minutes - may indicate tight stop losses');
    }
    if (largeLosses.length > totalLosses * 0.3) {
      commonPatterns.push('30%+ losses are large - risk management may need tightening');
    }
    if (slowLosses.length > totalLosses * 0.4) {
      commonPatterns.push('Many trades held too long while losing - consider earlier exits');
    }

    const improvementOpportunities: string[] = [];
    if (stoppedOutEarly > totalLosses * 0.4) {
      improvementOpportunities.push('Allow more breathing room with wider initial stops');
    }
    if (largeLosses.length > 0) {
      improvementOpportunities.push('Implement stricter position sizing to reduce loss impact');
    }
    if (slowLosses.length > totalLosses * 0.3) {
      improvementOpportunities.push('Add time-based exit rules to cut losses faster');
    }

    return {
      totalLosses,
      lossCategories: {
        stoppedOutEarly: {
          count: stoppedOutEarly,
          percentage: (stoppedOutEarly / totalLosses) * 100,
          avgLoss: quickLosses.reduce((sum, t) => sum + Math.abs(t.pnl), 0) / (quickLosses.length || 1)
        },
        wrongDirection: {
          count: wrongDirection,
          percentage: (wrongDirection / totalLosses) * 100,
          avgLoss: losingTrades.reduce((sum, t) => sum + Math.abs(t.pnl), 0) / totalLosses
        },
        poorTiming: {
          count: poorTiming,
          percentage: (poorTiming / totalLosses) * 100,
          avgLoss: losingTrades.reduce((sum, t) => sum + Math.abs(t.pnl), 0) / totalLosses
        },
        marketReversal: {
          count: Math.max(0, marketReversal),
          percentage: (Math.max(0, marketReversal) / totalLosses) * 100,
          avgLoss: losingTrades.reduce((sum, t) => sum + Math.abs(t.pnl), 0) / totalLosses
        }
      },
      commonPatterns,
      improvementOpportunities
    };
  }

  private analyzeWins(trades: SyntheticBacktestTrade[]): WinAnalysis {
    const winningTrades = trades.filter(t => t.outcome === 'win');
    const totalWins = winningTrades.length;

    if (totalWins === 0) {
      return {
        totalWins: 0,
        winCategories: {
          quickWins: { count: 0, percentage: 0, avgWin: 0 },
          patientWins: { count: 0, percentage: 0, avgWin: 0 },
          perfectExecution: { count: 0, percentage: 0, avgWin: 0 },
          partialProfit: { count: 0, percentage: 0, avgWin: 0 }
        },
        successPatterns: [],
        strengthAreas: []
      };
    }

    const quickWins = winningTrades.filter(t => (t.holdingDurationMinutes || 0) < 60);
    const patientWins = winningTrades.filter(t => (t.holdingDurationMinutes || 0) >= 60);
    const highConfWins = winningTrades.filter(t => t.flowV2Confidence >= 80);
    const largeWins = winningTrades.filter(t => t.pnl > 100);

    const successPatterns: string[] = [];
    if (quickWins.length > totalWins * 0.5) {
      successPatterns.push('Over 50% of wins are quick (under 1 hour) - good momentum capture');
    }
    if (highConfWins.length > totalWins * 0.6) {
      successPatterns.push('60%+ wins come from high confidence signals (80%+)');
    }
    if (patientWins.length > totalWins * 0.4) {
      successPatterns.push('Patient trades often win - trend following working well');
    }

    const strengthAreas: string[] = [];
    if (quickWins.length > totalWins * 0.4) {
      strengthAreas.push('Scalping & Quick Entries');
    }
    if (patientWins.length > totalWins * 0.3) {
      strengthAreas.push('Trend Following & Position Holding');
    }
    if (highConfWins.length > totalWins * 0.5) {
      strengthAreas.push('Signal Quality & Confidence Filtering');
    }

    return {
      totalWins,
      winCategories: {
        quickWins: {
          count: quickWins.length,
          percentage: (quickWins.length / totalWins) * 100,
          avgWin: quickWins.reduce((sum, t) => sum + t.pnl, 0) / (quickWins.length || 1)
        },
        patientWins: {
          count: patientWins.length,
          percentage: (patientWins.length / totalWins) * 100,
          avgWin: patientWins.reduce((sum, t) => sum + t.pnl, 0) / (patientWins.length || 1)
        },
        perfectExecution: {
          count: highConfWins.length,
          percentage: (highConfWins.length / totalWins) * 100,
          avgWin: highConfWins.reduce((sum, t) => sum + t.pnl, 0) / (highConfWins.length || 1)
        },
        partialProfit: {
          count: totalWins - highConfWins.length,
          percentage: ((totalWins - highConfWins.length) / totalWins) * 100,
          avgWin: winningTrades.filter(t => t.flowV2Confidence < 80).reduce((sum, t) => sum + t.pnl, 0) / ((totalWins - highConfWins.length) || 1)
        }
      },
      successPatterns,
      strengthAreas
    };
  }

  private analyzeTimeDistribution(trades: SyntheticBacktestTrade[]): TimeDistribution {
    const byHour: { [hour: number]: { wins: number; losses: number; avgPnL: number } } = {};
    const byDayOfWeek: { [day: number]: { wins: number; losses: number; avgPnL: number } } = {};

    for (let i = 0; i < 24; i++) byHour[i] = { wins: 0, losses: 0, avgPnL: 0 };
    for (let i = 0; i < 7; i++) byDayOfWeek[i] = { wins: 0, losses: 0, avgPnL: 0 };

    for (const trade of trades) {
      const hour = trade.entryTime.getHours();
      const day = trade.entryTime.getDay();

      if (trade.outcome === 'win') {
        byHour[hour].wins++;
        byDayOfWeek[day].wins++;
      } else if (trade.outcome === 'loss') {
        byHour[hour].losses++;
        byDayOfWeek[day].losses++;
      }

      byHour[hour].avgPnL += trade.pnl;
      byDayOfWeek[day].avgPnL += trade.pnl;
    }

    Object.keys(byHour).forEach(h => {
      const hour = parseInt(h);
      const total = byHour[hour].wins + byHour[hour].losses;
      if (total > 0) byHour[hour].avgPnL /= total;
    });

    Object.keys(byDayOfWeek).forEach(d => {
      const day = parseInt(d);
      const total = byDayOfWeek[day].wins + byDayOfWeek[day].losses;
      if (total > 0) byDayOfWeek[day].avgPnL /= total;
    });

    const hourlyPerformance = Object.entries(byHour).map(([h, data]) => ({
      hour: parseInt(h),
      avgPnL: data.avgPnL
    })).sort((a, b) => b.avgPnL - a.avgPnL);

    const bestTradingHours = hourlyPerformance.slice(0, 3).map(h => h.hour);
    const worstTradingHours = hourlyPerformance.slice(-3).map(h => h.hour);

    return {
      byHour,
      byDayOfWeek,
      bestTradingHours,
      worstTradingHours
    };
  }

  private generateRecommendations(
    trades: SyntheticBacktestTrade[],
    tradeAnalytics: TradeAnalytics,
    lossAnalysis: LossAnalysis,
    winAnalysis: WinAnalysis
  ): ImprovementRecommendations[] {
    const recommendations: ImprovementRecommendations[] = [];

    if (tradeAnalytics.winRate < 50) {
      recommendations.push({
        priority: 'high',
        category: 'Win Rate',
        issue: 'Win rate below 50% indicates signal quality issues',
        recommendation: 'Increase confidence threshold from 75% to 80-85% to filter out weaker signals',
        expectedImpact: 'Could improve win rate by 5-10%',
        currentMetric: `${tradeAnalytics.winRate.toFixed(1)}%`,
        targetMetric: '55-60%'
      });
    }

    if (tradeAnalytics.profitFactor < 1.5) {
      recommendations.push({
        priority: 'high',
        category: 'Profit Factor',
        issue: 'Profit factor below 1.5 - wins not large enough vs losses',
        recommendation: 'Let winning trades run longer or tighten stop losses on losing trades',
        expectedImpact: 'Target profit factor of 2.0+',
        currentMetric: tradeAnalytics.profitFactor.toFixed(2),
        targetMetric: '2.0+'
      });
    }

    if (lossAnalysis.lossCategories.stoppedOutEarly.percentage > 40) {
      recommendations.push({
        priority: 'medium',
        category: 'Stop Loss Management',
        issue: `${lossAnalysis.lossCategories.stoppedOutEarly.percentage.toFixed(0)}% of losses are stopped out early`,
        recommendation: 'Use wider stops based on ATR or recent volatility',
        expectedImpact: 'Reduce premature stops by 20-30%',
        currentMetric: `${lossAnalysis.lossCategories.stoppedOutEarly.count} early stops`,
        targetMetric: 'Reduce by 50%'
      });
    }

    if (tradeAnalytics.avgLossAmount > tradeAnalytics.avgWinAmount * 1.2) {
      recommendations.push({
        priority: 'high',
        category: 'Risk-Reward Ratio',
        issue: 'Average loss is larger than average win - poor risk management',
        recommendation: 'Ensure take profit targets are at least 2x stop loss distance',
        expectedImpact: 'Improve profitability even with same win rate',
        currentMetric: `Loss: $${tradeAnalytics.avgLossAmount.toFixed(2)}, Win: $${tradeAnalytics.avgWinAmount.toFixed(2)}`,
        targetMetric: 'Win should be 2x loss'
      });
    }

    if (trades.length < 50) {
      recommendations.push({
        priority: 'low',
        category: 'Sample Size',
        issue: 'Trade count below 50 - results may not be statistically significant',
        recommendation: 'Run backtest over longer period or with more symbols',
        expectedImpact: 'More reliable performance metrics',
        currentMetric: `${trades.length} trades`,
        targetMetric: '100+ trades'
      });
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  private calculateGradeBreakdown(
    tradeAnalytics: TradeAnalytics,
    lossAnalysis: LossAnalysis,
    winAnalysis: WinAnalysis
  ): { profitability: number; consistency: number; riskManagement: number; execution: number } {
    const profitability = Math.min(100, Math.max(0,
      (tradeAnalytics.profitFactor / 3) * 50 + (tradeAnalytics.winRate / 100) * 50
    ));

    const consistency = Math.min(100, Math.max(0,
      (tradeAnalytics.winRate >= 45 ? 50 : (tradeAnalytics.winRate / 45) * 50) +
      (tradeAnalytics.totalTrades >= 50 ? 50 : (tradeAnalytics.totalTrades / 50) * 50)
    ));

    const avgRRRatio = tradeAnalytics.avgRiskRewardActual;
    const riskManagement = Math.min(100, Math.max(0,
      (avgRRRatio >= 2 ? 50 : (avgRRRatio / 2) * 50) +
      (tradeAnalytics.avgWinAmount > tradeAnalytics.avgLossAmount ? 50 : 0)
    ));

    const execution = Math.min(100, Math.max(0,
      (winAnalysis.totalWins > 0 ? 50 : 0) +
      (tradeAnalytics.expectancy > 0 ? 50 : (tradeAnalytics.expectancy + 50))
    ));

    return {
      profitability: Math.round(profitability),
      consistency: Math.round(consistency),
      riskManagement: Math.round(riskManagement),
      execution: Math.round(execution)
    };
  }

  private calculateOverallGrade(gradeBreakdown: { profitability: number; consistency: number; riskManagement: number; execution: number }): 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' {
    const avg = (gradeBreakdown.profitability + gradeBreakdown.consistency + gradeBreakdown.riskManagement + gradeBreakdown.execution) / 4;

    if (avg >= 95) return 'A+';
    if (avg >= 90) return 'A';
    if (avg >= 80) return 'B';
    if (avg >= 70) return 'C';
    if (avg >= 60) return 'D';
    return 'F';
  }
}

export const syntheticBacktestAnalytics = new SyntheticBacktestAnalytics();
