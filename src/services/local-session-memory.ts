/**
 * Local Session Memory
 *
 * In-memory storage for all events during an active session
 * Avoids Supabase write limits by storing everything locally
 * Compresses to summary at session end for single database write
 */

import { SimulatedTrade } from './event-based-llm-engine';
import { TriggerEvent } from './trigger-detection-rules';

export interface SessionMemory {
  sessionId: string;
  userId: string;
  sessionName: string;
  startTime: Date;
  endTime?: Date;
  config: {
    symbol: string;
    timeframe: string;
    useLLM: boolean;
    riskMode: string;
    initialBalance: number;
  };
  statistics: {
    candlesProcessed: number;
    triggersDetected: number;
    llmCallsMade: number;
    llmTokensUsed: number;
    tradesExecuted: number;
    tradesWon: number;
    tradesLost: number;
    tradesBreakeven: number;
    totalPnL: number;
    finalBalance: number;
    maxDrawdown: number;
  };
  events: {
    triggers: TriggerEvent[];
    trades: SimulatedTrade[];
    llmDecisions: any[];
  };
}

export interface SessionSummary {
  sessionId: string;
  userId: string;
  sessionName: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  config: any;
  statistics: {
    candlesProcessed: number;
    triggersDetected: number;
    triggerTypes: { [key: string]: number };
    llmCallsMade: number;
    llmTokensUsed: number;
    llmCostEstimate: number;
    tradesExecuted: number;
    tradesWon: number;
    tradesLost: number;
    tradesBreakeven: number;
    winRate: number;
    totalPnL: number;
    finalBalance: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    maxDrawdown: number;
    avgHoldTimeMinutes: number;
    triggerToTradeRatio: number;
  };
  trades: {
    id: string;
    symbol: string;
    direction: string;
    entryTime: string;
    entryPrice: number;
    exitTime: string;
    exitPrice: number;
    exitReason: string;
    pnl: number;
    outcome: string;
    holdingMinutes: number;
    triggerType: string;
    confidence: number;
  }[];
  triggerDistribution: { type: string; count: number; avgConfidence: number }[];
}

class LocalSessionMemory {
  private sessions: Map<string, SessionMemory> = new Map();

  /**
   * Create new session memory
   */
  createSession(
    sessionId: string,
    userId: string,
    sessionName: string,
    config: {
      symbol: string;
      timeframe: string;
      useLLM: boolean;
      riskMode: string;
      initialBalance: number;
    }
  ): void {
    this.sessions.set(sessionId, {
      sessionId,
      userId,
      sessionName,
      startTime: new Date(),
      config,
      statistics: {
        candlesProcessed: 0,
        triggersDetected: 0,
        llmCallsMade: 0,
        llmTokensUsed: 0,
        tradesExecuted: 0,
        tradesWon: 0,
        tradesLost: 0,
        tradesBreakeven: 0,
        totalPnL: 0,
        finalBalance: config.initialBalance,
        maxDrawdown: 0
      },
      events: {
        triggers: [],
        trades: [],
        llmDecisions: []
      }
    });

    console.log(`[Session Memory] Created session: ${sessionId}`);
  }

  /**
   * Record candle processed
   */
  recordCandleProcessed(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.statistics.candlesProcessed++;
    }
  }

  /**
   * Record trigger detected
   */
  recordTrigger(sessionId: string, trigger: TriggerEvent): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.statistics.triggersDetected++;
      session.events.triggers.push(trigger);
    }
  }

  /**
   * Record LLM call
   */
  recordLLMCall(sessionId: string, tokensUsed: number, decision: any): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.statistics.llmCallsMade++;
      session.statistics.llmTokensUsed += tokensUsed;
      session.events.llmDecisions.push({
        timestamp: new Date(),
        tokensUsed,
        decision
      });
    }
  }

  /**
   * Record trade execution
   */
  recordTrade(sessionId: string, trade: SimulatedTrade): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.statistics.tradesExecuted++;
      session.events.trades.push(trade);
    }
  }

  /**
   * Record trade closure
   */
  recordTradeClosure(sessionId: string, trade: SimulatedTrade): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.statistics.totalPnL += trade.pnl;
    session.statistics.finalBalance += trade.pnl;

    if (trade.outcome === 'win') {
      session.statistics.tradesWon++;
    } else if (trade.outcome === 'loss') {
      session.statistics.tradesLost++;
    } else {
      session.statistics.tradesBreakeven++;
    }

    const peak = session.config.initialBalance + session.statistics.totalPnL;
    const drawdown = peak - session.statistics.finalBalance;
    if (drawdown > session.statistics.maxDrawdown) {
      session.statistics.maxDrawdown = drawdown;
    }
  }

  /**
   * Get session statistics
   */
  getSessionStatistics(sessionId: string): SessionMemory['statistics'] | null {
    const session = this.sessions.get(sessionId);
    return session ? session.statistics : null;
  }

  /**
   * Generate compressed session summary
   */
  generateSessionSummary(sessionId: string): SessionSummary | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const endTime = new Date();
    const durationSeconds = Math.floor((endTime.getTime() - session.startTime.getTime()) / 1000);

    const winRate =
      session.statistics.tradesExecuted > 0
        ? (session.statistics.tradesWon / session.statistics.tradesExecuted) * 100
        : 0;

    const wins = session.events.trades.filter(t => t.outcome === 'win');
    const losses = session.events.trades.filter(t => t.outcome === 'loss');

    const totalWins = wins.reduce((sum, t) => sum + t.pnl, 0);
    const totalLosses = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));

    const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
    const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;

    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? 999 : 0;

    const closedTrades = session.events.trades.filter(t => t.exitTime);
    const avgHoldTime =
      closedTrades.length > 0
        ? closedTrades.reduce((sum, t) => sum + (t.holdingMinutes || 0), 0) / closedTrades.length
        : 0;

    const triggerToTradeRatio =
      session.statistics.triggersDetected > 0
        ? session.statistics.tradesExecuted / session.statistics.triggersDetected
        : 0;

    const triggerTypes: { [key: string]: number } = {};
    session.events.triggers.forEach(trigger => {
      triggerTypes[trigger.type] = (triggerTypes[trigger.type] || 0) + 1;
    });

    const triggerDistribution = Object.entries(triggerTypes).map(([type, count]) => {
      const triggersOfType = session.events.triggers.filter(t => t.type === type);
      const avgConfidence =
        triggersOfType.reduce((sum, t) => sum + t.confidence, 0) / triggersOfType.length;
      return { type, count, avgConfidence };
    });

    const compactTrades = session.events.trades.map(trade => ({
      id: trade.id,
      symbol: trade.symbol,
      direction: trade.direction,
      entryTime: trade.entryTime.toISOString(),
      entryPrice: trade.entryPrice,
      exitTime: trade.exitTime?.toISOString() || '',
      exitPrice: trade.exitPrice || 0,
      exitReason: trade.exitReason || '',
      pnl: trade.pnl,
      outcome: trade.outcome,
      holdingMinutes: trade.holdingMinutes || 0,
      triggerType: trade.triggerType,
      confidence: trade.confidence
    }));

    const llmCostEstimate = session.statistics.llmTokensUsed * 0.000005;

    return {
      sessionId: session.sessionId,
      userId: session.userId,
      sessionName: session.sessionName,
      startTime: session.startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationSeconds,
      config: session.config,
      statistics: {
        candlesProcessed: session.statistics.candlesProcessed,
        triggersDetected: session.statistics.triggersDetected,
        triggerTypes,
        llmCallsMade: session.statistics.llmCallsMade,
        llmTokensUsed: session.statistics.llmTokensUsed,
        llmCostEstimate,
        tradesExecuted: session.statistics.tradesExecuted,
        tradesWon: session.statistics.tradesWon,
        tradesLost: session.statistics.tradesLost,
        tradesBreakeven: session.statistics.tradesBreakeven,
        winRate,
        totalPnL: session.statistics.totalPnL,
        finalBalance: session.statistics.finalBalance,
        avgWin,
        avgLoss,
        profitFactor,
        maxDrawdown: session.statistics.maxDrawdown,
        avgHoldTimeMinutes: avgHoldTime,
        triggerToTradeRatio
      },
      trades: compactTrades,
      triggerDistribution
    };
  }

  /**
   * Close and clear session from memory
   */
  closeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    console.log(`[Session Memory] Closed session: ${sessionId}`);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Check if session exists
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}

export const localSessionMemory = new LocalSessionMemory();
