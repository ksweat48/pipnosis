/**
 * Supabase Summary Writer
 *
 * Batch writes session summaries to Supabase at trade completion or session end.
 * Prevents high-frequency database writes during active trading.
 */

import { supabase } from '../lib/supabase';
import { SessionSummary, LocalTrade } from './local-memory-layer';

export interface WrittenSummary {
  sessionId: string;
  writtenAt: Date;
  tradesWritten: number;
  insightsGenerated: number;
}

class SupabaseSummaryWriter {
  private writeInProgress: Set<string> = new Set();
  private lastWriteTime: Map<string, Date> = new Map();
  private minWriteIntervalSeconds: number = 60;

  async writeSessionSummary(
    summary: SessionSummary,
    skipThrottleCheck: boolean = false
  ): Promise<WrittenSummary> {
    if (this.writeInProgress.has(summary.sessionId)) {
      console.log(`[Summary Writer] Write already in progress for session ${summary.sessionId}`);
      throw new Error('Write already in progress for this session');
    }

    if (!skipThrottleCheck && !this.canWrite(summary.sessionId)) {
      const lastWrite = this.lastWriteTime.get(summary.sessionId);
      const waitTime = lastWrite
        ? this.minWriteIntervalSeconds - Math.floor((Date.now() - lastWrite.getTime()) / 1000)
        : 0;
      throw new Error(`Write throttled. Wait ${waitTime} seconds before next write.`);
    }

    this.writeInProgress.add(summary.sessionId);

    try {
      console.log(`[Summary Writer] Writing summary for session: ${summary.sessionId}`);

      const sessionRecord = await this.writeGoalSessionRecord(summary);

      const closedTrades = summary.trades.filter(t => t.outcome !== 'open');
      const tradeRecords = await this.writeTradeRecords(summary.sessionId, summary.userId, closedTrades);

      const insights = await this.generateInsights(summary);
      const insightRecords = await this.writeInsights(summary.sessionId, summary.userId, insights);

      await this.writePerformanceMetrics(summary);

      this.lastWriteTime.set(summary.sessionId, new Date());

      console.log(`[Summary Writer] Successfully wrote summary: ${closedTrades.length} trades, ${insights.length} insights`);

      return {
        sessionId: summary.sessionId,
        writtenAt: new Date(),
        tradesWritten: closedTrades.length,
        insightsGenerated: insights.length
      };

    } catch (error) {
      console.error('[Summary Writer] Error writing summary:', error);
      throw error;
    } finally {
      this.writeInProgress.delete(summary.sessionId);
    }
  }

  private canWrite(sessionId: string): boolean {
    const lastWrite = this.lastWriteTime.get(sessionId);
    if (!lastWrite) return true;

    const secondsSinceLastWrite = (Date.now() - lastWrite.getTime()) / 1000;
    return secondsSinceLastWrite >= this.minWriteIntervalSeconds;
  }

  private async writeGoalSessionRecord(summary: SessionSummary): Promise<any> {
    const { data: existingSession, error: fetchError } = await supabase
      .from('goal_sessions')
      .select('id')
      .eq('id', summary.sessionId)
      .maybeSingle();

    if (fetchError) {
      console.error('[Summary Writer] Error checking existing session:', fetchError);
    }

    const sessionData = {
      id: summary.sessionId,
      user_id: summary.userId,
      session_name: summary.sessionName,
      status: summary.goalProgress && summary.goalProgress.progressPercent >= 100 ? 'completed' : 'active',
      goal_type: summary.goalProgress ? 'profit_target' : 'general',
      target_value: summary.goalProgress?.targetAmount || 0,
      current_progress: summary.goalProgress?.currentProfit || summary.metrics.totalPnL,
      progress_percent: summary.goalProgress?.progressPercent || 0,
      trades_completed: summary.metrics.totalTrades,
      win_rate: summary.metrics.winRate,
      total_pnl: summary.metrics.totalPnL,
      started_at: summary.startTime,
      last_scan_at: summary.endTime,
      updated_at: new Date()
    };

    if (existingSession) {
      const { error: updateError } = await supabase
        .from('goal_sessions')
        .update(sessionData)
        .eq('id', summary.sessionId);

      if (updateError) {
        console.error('[Summary Writer] Error updating session:', updateError);
        throw updateError;
      }

      console.log('[Summary Writer] Updated existing goal session');
    } else {
      const { error: insertError } = await supabase
        .from('goal_sessions')
        .insert(sessionData);

      if (insertError) {
        console.error('[Summary Writer] Error inserting session:', insertError);
        throw insertError;
      }

      console.log('[Summary Writer] Created new goal session record');
    }

    return sessionData;
  }

  private async writeTradeRecords(
    sessionId: string,
    userId: string,
    trades: LocalTrade[]
  ): Promise<any[]> {
    if (trades.length === 0) {
      return [];
    }

    const tradeRecords = trades.map(trade => ({
      user_id: userId,
      session_id: sessionId,
      symbol: trade.symbol,
      timeframe: trade.timeframe,
      direction: trade.direction,
      entry_price: trade.entryPrice,
      exit_price: trade.exitPrice,
      position_size: trade.positionSize,
      stop_loss: trade.stopLoss,
      take_profit: trade.takeProfit,
      pnl: trade.pnl,
      pnl_percent: trade.pnlPercent,
      outcome: trade.outcome,
      entry_time: trade.entryTime,
      exit_time: trade.exitTime,
      exit_reason: trade.exitReason,
      setup_type: trade.setupType,
      confidence: trade.confidence,
      ai_reasoning: trade.aiReasoning,
      duration_minutes: trade.durationMinutes
    }));

    const { data, error } = await supabase
      .from('trade_history')
      .insert(tradeRecords)
      .select();

    if (error) {
      console.error('[Summary Writer] Error inserting trades:', error);
      throw error;
    }

    console.log(`[Summary Writer] Wrote ${tradeRecords.length} trade records`);
    return data || [];
  }

  private async generateInsights(summary: SessionSummary): Promise<string[]> {
    const insights: string[] = [...summary.keyInsights];

    if (summary.complianceReport.ruleViolations.length === 0) {
      insights.push('Perfect compliance with short-term trading rules');
    }

    if (summary.metrics.winRate > 60 && summary.metrics.totalTrades >= 5) {
      insights.push(`Strong ${summary.metrics.winRate.toFixed(1)}% win rate across ${summary.metrics.totalTrades} trades`);
    }

    if (summary.metrics.avgTradeDurationMinutes < 60) {
      insights.push('Excellent execution speed with sub-hour average trade duration');
    }

    if (summary.metrics.profitFactor > 1.5) {
      insights.push(`Healthy profit factor of ${summary.metrics.profitFactor.toFixed(2)} demonstrates effective risk management`);
    }

    const winningSetups = summary.trades
      .filter(t => t.outcome === 'win')
      .map(t => t.setupType);

    const setupCounts = winningSetups.reduce((acc, setup) => {
      acc[setup] = (acc[setup] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const bestSetup = Object.entries(setupCounts).sort((a, b) => b[1] - a[1])[0];
    if (bestSetup && bestSetup[1] >= 2) {
      insights.push(`${bestSetup[0]} setup proved most effective with ${bestSetup[1]} wins`);
    }

    if (summary.goalProgress) {
      const efficiency = summary.goalProgress.tradesCompleted > 0
        ? summary.goalProgress.currentProfit / summary.goalProgress.tradesCompleted
        : 0;

      if (efficiency > 0) {
        insights.push(`Goal progress efficiency: $${efficiency.toFixed(2)} average profit per trade`);
      }
    }

    return insights.slice(0, 5);
  }

  private async writeInsights(
    sessionId: string,
    userId: string,
    insights: string[]
  ): Promise<any[]> {
    if (insights.length === 0) {
      return [];
    }

    const insightRecords = insights.map((insight, index) => ({
      user_id: userId,
      goal_session_id: sessionId,
      insight_text: insight,
      insight_type: 'session_summary',
      confidence_score: 85,
      created_at: new Date(),
      priority: index + 1
    }));

    const { data, error } = await supabase
      .from('ai_learning_insights')
      .insert(insightRecords)
      .select();

    if (error) {
      console.error('[Summary Writer] Error inserting insights:', error);
    } else {
      console.log(`[Summary Writer] Wrote ${insightRecords.length} insights`);
    }

    return data || [];
  }

  private async writePerformanceMetrics(summary: SessionSummary): Promise<void> {
    const metricsRecord = {
      user_id: summary.userId,
      session_id: summary.sessionId,
      timestamp: summary.endTime,
      total_trades: summary.metrics.totalTrades,
      winning_trades: summary.metrics.winningTrades,
      losing_trades: summary.metrics.losingTrades,
      win_rate: summary.metrics.winRate,
      total_pnl: summary.metrics.totalPnL,
      profit_factor: summary.metrics.profitFactor,
      max_drawdown: summary.metrics.maxDrawdown,
      max_drawdown_percent: summary.metrics.maxDrawdownPercent,
      avg_trade_duration_minutes: summary.metrics.avgTradeDurationMinutes,
      compliance_score: this.calculateComplianceScore(summary.complianceReport)
    };

    const { error } = await supabase
      .from('session_performance_metrics')
      .insert(metricsRecord);

    if (error) {
      console.error('[Summary Writer] Error inserting performance metrics:', error);
    } else {
      console.log('[Summary Writer] Wrote performance metrics');
    }
  }

  private calculateComplianceScore(complianceReport: any): number {
    if (complianceReport.totalTrades === 0) return 100;

    const durationCompliance = complianceReport.durationCompliantTrades / complianceReport.totalTrades;
    const overnightPenalty = complianceReport.overnightHolds * 10;

    const score = Math.max(0, Math.min(100, durationCompliance * 100 - overnightPenalty));
    return score;
  }

  async writeTradeCompletionSummary(
    sessionId: string,
    userId: string,
    trade: LocalTrade
  ): Promise<void> {
    const tradeRecord = {
      user_id: userId,
      session_id: sessionId,
      symbol: trade.symbol,
      timeframe: trade.timeframe,
      direction: trade.direction,
      entry_price: trade.entryPrice,
      exit_price: trade.exitPrice,
      position_size: trade.positionSize,
      stop_loss: trade.stopLoss,
      take_profit: trade.takeProfit,
      pnl: trade.pnl,
      pnl_percent: trade.pnlPercent,
      outcome: trade.outcome,
      entry_time: trade.entryTime,
      exit_time: trade.exitTime,
      exit_reason: trade.exitReason,
      setup_type: trade.setupType,
      confidence: trade.confidence,
      ai_reasoning: trade.aiReasoning,
      duration_minutes: trade.durationMinutes
    };

    const { error } = await supabase
      .from('trade_history')
      .insert(tradeRecord);

    if (error) {
      console.error('[Summary Writer] Error writing single trade:', error);
      throw error;
    }

    console.log(`[Summary Writer] Wrote trade ${trade.tradeNumber} for session ${sessionId}`);
  }

  getWriteStats(): {
    activeWrites: number;
    sessionsTracked: number;
  } {
    return {
      activeWrites: this.writeInProgress.size,
      sessionsTracked: this.lastWriteTime.size
    };
  }
}

export const supabaseSummaryWriter = new SupabaseSummaryWriter();
