/**
 * Local Memory Layer
 *
 * High-performance in-memory storage for trades, metrics, and session state.
 * Eliminates database writes during active trading, only flushes summaries at completion.
 */

import { PIPNOSIS_CORE_RULES } from '../lib/pipnosis-core-rules';

export interface LocalTrade {
  id: string;
  tradeNumber: number;
  symbol: string;
  timeframe: string;
  direction: 'buy' | 'sell';
  entryTime: Date;
  entryPrice: number;
  positionSize: number;
  stopLoss: number;
  takeProfit: number;
  exitTime?: Date;
  exitPrice?: number;
  exitReason?: string;
  pnl: number;
  pnlPercent: number;
  outcome: 'win' | 'loss' | 'breakeven' | 'open';
  confidence: number;
  setupType: string;
  aiReasoning?: string;
  durationMinutes?: number;
}

export interface LocalSessionMetrics {
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  currentBalance: number;
  startingBalance: number;
  totalPnL: number;
  totalTrades: number;
  openTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  largestWin: number;
  largestLoss: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  avgTradeDurationMinutes: number;
}

export interface LocalGoalProgress {
  goalId: string;
  targetAmount: number;
  currentProfit: number;
  progressPercent: number;
  remainingAmount: number;
  tradesCompleted: number;
  estimatedTradesRemaining: number;
  avgProfitPerTrade: number;
  lastTradeTime?: Date;
  nextScanTime?: Date;
}

export interface SessionSummary {
  sessionId: string;
  userId: string;
  sessionName: string;
  startTime: Date;
  endTime: Date;
  metrics: LocalSessionMetrics;
  goalProgress?: LocalGoalProgress;
  trades: LocalTrade[];
  keyInsights: string[];
  complianceReport: {
    totalTrades: number;
    durationCompliantTrades: number;
    avgTradeDuration: number;
    maxTradeDuration: number;
    overnightHolds: number;
    ruleViolations: string[];
  };
}

class LocalMemoryLayer {
  private activeSessions: Map<string, {
    metrics: LocalSessionMetrics;
    trades: LocalTrade[];
    goalProgress?: LocalGoalProgress;
    equityCurve: { time: Date; balance: number }[];
  }> = new Map();

  private tradeCounter: Map<string, number> = new Map();
  private writeQueue: SessionSummary[] = [];
  private maxMemoryTrades: number = 10000;

  createSession(
    sessionId: string,
    startingBalance: number,
    goalAmount?: number
  ): void {
    const metrics: LocalSessionMetrics = {
      sessionId,
      startTime: new Date(),
      currentBalance: startingBalance,
      startingBalance,
      totalPnL: 0,
      totalTrades: 0,
      openTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      breakevenTrades: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      largestWin: 0,
      largestLoss: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      avgTradeDurationMinutes: 0
    };

    const goalProgress = goalAmount ? {
      goalId: sessionId,
      targetAmount: goalAmount,
      currentProfit: 0,
      progressPercent: 0,
      remainingAmount: goalAmount,
      tradesCompleted: 0,
      estimatedTradesRemaining: 0,
      avgProfitPerTrade: 0
    } : undefined;

    this.activeSessions.set(sessionId, {
      metrics,
      trades: [],
      goalProgress,
      equityCurve: [{ time: new Date(), balance: startingBalance }]
    });

    this.tradeCounter.set(sessionId, 0);

    console.log(`[Local Memory] Session created: ${sessionId}`);
  }

  addTrade(sessionId: string, trade: Omit<LocalTrade, 'id' | 'tradeNumber'>): LocalTrade {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found in local memory`);
    }

    const tradeNumber = (this.tradeCounter.get(sessionId) || 0) + 1;
    this.tradeCounter.set(sessionId, tradeNumber);

    const fullTrade: LocalTrade = {
      ...trade,
      id: `${sessionId}-${tradeNumber}`,
      tradeNumber
    };

    session.trades.push(fullTrade);
    this.updateMetrics(sessionId);

    if (session.trades.length > this.maxMemoryTrades) {
      console.warn(`[Local Memory] Session ${sessionId} exceeded max trades, consider flushing`);
    }

    return fullTrade;
  }

  closeTrade(
    sessionId: string,
    tradeId: string,
    exitPrice: number,
    exitReason: string
  ): LocalTrade | null {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;

    const trade = session.trades.find(t => t.id === tradeId);
    if (!trade) return null;

    trade.exitTime = new Date();
    trade.exitPrice = exitPrice;
    trade.exitReason = exitReason;

    const multiplier = trade.direction === 'buy' ? 1 : -1;
    trade.pnl = (exitPrice - trade.entryPrice) * multiplier * trade.positionSize;
    trade.pnlPercent = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100 * multiplier;

    if (Math.abs(trade.pnlPercent) < 0.01) {
      trade.outcome = 'breakeven';
    } else if (trade.pnl > 0) {
      trade.outcome = 'win';
    } else {
      trade.outcome = 'loss';
    }

    if (trade.exitTime && trade.entryTime) {
      trade.durationMinutes = (trade.exitTime.getTime() - trade.entryTime.getTime()) / 60000;
    }

    this.updateMetrics(sessionId);

    return trade;
  }

  private updateMetrics(sessionId: string): void {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const { trades, metrics, goalProgress } = session;

    const openTrades = trades.filter(t => t.outcome === 'open');
    const closedTrades = trades.filter(t => t.outcome !== 'open');

    metrics.totalTrades = trades.length;
    metrics.openTrades = openTrades.length;

    const wins = closedTrades.filter(t => t.outcome === 'win');
    const losses = closedTrades.filter(t => t.outcome === 'loss');
    const breakevens = closedTrades.filter(t => t.outcome === 'breakeven');

    metrics.winningTrades = wins.length;
    metrics.losingTrades = losses.length;
    metrics.breakevenTrades = breakevens.length;

    metrics.winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;

    const totalWinPnL = wins.reduce((sum, t) => sum + t.pnl, 0);
    const totalLossPnL = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));

    metrics.avgWin = wins.length > 0 ? totalWinPnL / wins.length : 0;
    metrics.avgLoss = losses.length > 0 ? totalLossPnL / losses.length : 0;

    metrics.profitFactor = totalLossPnL > 0 ? totalWinPnL / totalLossPnL : totalWinPnL > 0 ? 999 : 0;

    metrics.totalPnL = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
    metrics.currentBalance = metrics.startingBalance + metrics.totalPnL;

    session.equityCurve.push({
      time: new Date(),
      balance: metrics.currentBalance
    });

    let peak = metrics.startingBalance;
    let maxDD = 0;
    for (const point of session.equityCurve) {
      if (point.balance > peak) peak = point.balance;
      const drawdown = peak - point.balance;
      if (drawdown > maxDD) maxDD = drawdown;
    }

    metrics.maxDrawdown = maxDD;
    metrics.maxDrawdownPercent = peak > 0 ? (maxDD / peak) * 100 : 0;

    if (wins.length > 0) {
      metrics.largestWin = Math.max(...wins.map(t => t.pnl));
    }
    if (losses.length > 0) {
      metrics.largestLoss = Math.min(...losses.map(t => t.pnl));
    }

    let currentStreak = 0;
    let maxWinStreak = 0;
    let maxLossStreak = 0;

    for (const trade of closedTrades) {
      if (trade.outcome === 'win') {
        currentStreak = currentStreak > 0 ? currentStreak + 1 : 1;
        if (currentStreak > maxWinStreak) maxWinStreak = currentStreak;
      } else if (trade.outcome === 'loss') {
        currentStreak = currentStreak < 0 ? currentStreak - 1 : -1;
        if (Math.abs(currentStreak) > maxLossStreak) maxLossStreak = Math.abs(currentStreak);
      } else {
        currentStreak = 0;
      }
    }

    metrics.consecutiveWins = maxWinStreak;
    metrics.consecutiveLosses = maxLossStreak;

    const tradesWithDuration = closedTrades.filter(t => t.durationMinutes !== undefined);
    if (tradesWithDuration.length > 0) {
      metrics.avgTradeDurationMinutes =
        tradesWithDuration.reduce((sum, t) => sum + (t.durationMinutes || 0), 0) / tradesWithDuration.length;
    }

    if (goalProgress) {
      goalProgress.currentProfit = metrics.totalPnL;
      goalProgress.tradesCompleted = closedTrades.length;
      goalProgress.progressPercent = (goalProgress.currentProfit / goalProgress.targetAmount) * 100;
      goalProgress.remainingAmount = goalProgress.targetAmount - goalProgress.currentProfit;

      if (closedTrades.length > 0) {
        goalProgress.avgProfitPerTrade = goalProgress.currentProfit / closedTrades.length;
        if (goalProgress.avgProfitPerTrade > 0) {
          goalProgress.estimatedTradesRemaining = Math.ceil(
            goalProgress.remainingAmount / goalProgress.avgProfitPerTrade
          );
        }
      }

      if (closedTrades.length > 0) {
        goalProgress.lastTradeTime = closedTrades[closedTrades.length - 1].exitTime;
      }
    }
  }

  getSessionMetrics(sessionId: string): LocalSessionMetrics | null {
    const session = this.activeSessions.get(sessionId);
    return session ? { ...session.metrics } : null;
  }

  getGoalProgress(sessionId: string): LocalGoalProgress | null {
    const session = this.activeSessions.get(sessionId);
    return session?.goalProgress ? { ...session.goalProgress } : null;
  }

  getOpenTrades(sessionId: string): LocalTrade[] {
    const session = this.activeSessions.get(sessionId);
    if (!session) return [];
    return session.trades.filter(t => t.outcome === 'open');
  }

  getAllTrades(sessionId: string): LocalTrade[] {
    const session = this.activeSessions.get(sessionId);
    return session ? [...session.trades] : [];
  }

  generateSessionSummary(
    sessionId: string,
    userId: string,
    sessionName: string
  ): SessionSummary | null {
    const session = this.activeSessions.get(sessionId);
    if (!session) return null;

    const trades = session.trades;
    const closedTrades = trades.filter(t => t.outcome !== 'open');

    const durationCompliantTrades = closedTrades.filter(
      t => (t.durationMinutes || 0) <= PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_MINUTES
    );

    const overnightHolds = closedTrades.filter(t => {
      if (!t.entryTime || !t.exitTime) return false;
      return t.entryTime.toDateString() !== t.exitTime.toDateString();
    });

    const durations = closedTrades
      .map(t => t.durationMinutes || 0)
      .filter(d => d > 0);

    const avgDuration = durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : 0;

    const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;

    const ruleViolations: string[] = [];
    if (overnightHolds.length > 0) {
      ruleViolations.push(`${overnightHolds.length} overnight holds detected`);
    }
    if (durationCompliantTrades.length < closedTrades.length) {
      ruleViolations.push(
        `${closedTrades.length - durationCompliantTrades.length} trades exceeded max duration`
      );
    }

    const keyInsights: string[] = [];
    if (session.metrics.winRate > 70) {
      keyInsights.push('Exceptional win rate achieved through disciplined short-term execution');
    }
    if (session.metrics.avgTradeDurationMinutes < 60) {
      keyInsights.push('Fast scalping strategy with sub-hour average trade duration');
    }
    if (session.metrics.profitFactor > 2) {
      keyInsights.push('Strong profit factor indicating effective risk-reward management');
    }

    const summary: SessionSummary = {
      sessionId,
      userId,
      sessionName,
      startTime: session.metrics.startTime,
      endTime: new Date(),
      metrics: { ...session.metrics, endTime: new Date() },
      goalProgress: session.goalProgress ? { ...session.goalProgress } : undefined,
      trades: trades.map(t => ({ ...t })),
      keyInsights,
      complianceReport: {
        totalTrades: closedTrades.length,
        durationCompliantTrades: durationCompliantTrades.length,
        avgTradeDuration: avgDuration,
        maxTradeDuration: maxDuration,
        overnightHolds: overnightHolds.length,
        ruleViolations
      }
    };

    return summary;
  }

  queueSummaryForWrite(summary: SessionSummary): void {
    this.writeQueue.push(summary);
    console.log(`[Local Memory] Summary queued for write: ${summary.sessionId}`);
  }

  getPendingWrites(): SessionSummary[] {
    return [...this.writeQueue];
  }

  clearWriteQueue(): void {
    this.writeQueue = [];
  }

  closeSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
    this.tradeCounter.delete(sessionId);
    console.log(`[Local Memory] Session closed and cleared: ${sessionId}`);
  }

  getMemoryUsage(): {
    activeSessions: number;
    totalTrades: number;
    pendingWrites: number;
    estimatedMemoryKB: number;
  } {
    let totalTrades = 0;
    for (const session of this.activeSessions.values()) {
      totalTrades += session.trades.length;
    }

    const estimatedMemoryKB = (totalTrades * 2) + (this.writeQueue.length * 50);

    return {
      activeSessions: this.activeSessions.size,
      totalTrades,
      pendingWrites: this.writeQueue.length,
      estimatedMemoryKB
    };
  }
}

export const localMemoryLayer = new LocalMemoryLayer();
