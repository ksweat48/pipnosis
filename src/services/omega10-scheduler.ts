/**
 * Omega-10 Scheduler Service
 *
 * Manages the scheduling and execution of Omega-10 meta-reasoning analyses.
 * Handles both scheduled and triggered executions.
 */

import { supabase } from '../lib/supabase';
import { runOmega10MetaReasoning } from '../brains/omega10-meta-reasoning';
import type {
  Omega10Input,
  Omega10Result,
  TradeRecord,
  PatternPerformance,
  PerformanceMetrics
} from '../types/omega10';
import type { AlphaDecision, OmegaCouncilVotes } from '../brains/coordinator-alpha';

class Omega10Scheduler {
  private scheduledIntervalId: NodeJS.Timeout | null = null;
  private userId: string | null = null;
  private isRunning: boolean = false;

  private readonly SCHEDULED_INTERVAL_HOURS = 4;
  private readonly MIN_TRADES_FOR_ANALYSIS = 10;

  async initialize(userId: string): Promise<void> {
    this.userId = userId;
    console.log(`[Omega-10 Scheduler] Initialized for user ${userId}`);
  }

  async start(): Promise<void> {
    if (!this.userId) {
      console.error('[Omega-10 Scheduler] Cannot start - no user ID set');
      return;
    }

    if (this.scheduledIntervalId) {
      console.warn('[Omega-10 Scheduler] Already running');
      return;
    }

    console.log(`[Omega-10 Scheduler] Starting scheduled analysis (every ${this.SCHEDULED_INTERVAL_HOURS}h)`);

    this.scheduledIntervalId = setInterval(
      () => this.runScheduledAnalysis(),
      this.SCHEDULED_INTERVAL_HOURS * 60 * 60 * 1000
    );

    await this.runScheduledAnalysis();
  }

  stop(): void {
    if (this.scheduledIntervalId) {
      clearInterval(this.scheduledIntervalId);
      this.scheduledIntervalId = null;
      console.log('[Omega-10 Scheduler] Stopped');
    }
  }

  async runScheduledAnalysis(): Promise<Omega10Result | null> {
    if (!this.userId) {
      console.error('[Omega-10 Scheduler] No user ID set');
      return null;
    }

    if (this.isRunning) {
      console.warn('[Omega-10 Scheduler] Analysis already in progress, skipping');
      return null;
    }

    this.isRunning = true;

    try {
      console.log('[Omega-10 Scheduler] 🧠 Starting scheduled meta-reasoning analysis...');

      const input = await this.gatherAnalysisInput(this.userId);

      if (!this.hasMinimumData(input)) {
        console.log('[Omega-10 Scheduler] Insufficient data for analysis');
        this.isRunning = false;
        return null;
      }

      const result = await runOmega10MetaReasoning(input);

      await this.saveAnalysisResult(result, input.userId);

      await this.applyInterventions(result);

      console.log('[Omega-10 Scheduler] ✅ Scheduled analysis completed');

      return result;
    } catch (error) {
      console.error('[Omega-10 Scheduler] Error during scheduled analysis:', error);
      return null;
    } finally {
      this.isRunning = false;
    }
  }

  async runTriggeredAnalysis(trigger: 'drift' | 'variance' | 'manual'): Promise<Omega10Result | null> {
    if (!this.userId) {
      console.error('[Omega-10 Scheduler] No user ID set');
      return null;
    }

    console.log(`[Omega-10 Scheduler] 🚨 Triggered analysis: ${trigger}`);

    try {
      const input = await this.gatherAnalysisInput(this.userId);

      if (!this.hasMinimumData(input)) {
        console.log('[Omega-10 Scheduler] Insufficient data for triggered analysis');
        return null;
      }

      const result = await runOmega10MetaReasoning(input);
      result.analysisType = 'triggered';

      await this.saveAnalysisResult(result, input.userId, trigger);

      await this.applyInterventions(result);

      console.log('[Omega-10 Scheduler] ✅ Triggered analysis completed');

      return result;
    } catch (error) {
      console.error('[Omega-10 Scheduler] Error during triggered analysis:', error);
      return null;
    }
  }

  async gatherAnalysisInput(userId: string): Promise<Omega10Input> {
    const recentAlphaDecisions = await this.getRecentAlphaDecisions(userId);
    const recentOmegaVotes = await this.getRecentOmegaVotes(userId);
    const tradeHistory = await this.getTradeHistory(userId);
    const performanceStats = this.calculatePerformanceStats(tradeHistory);
    const marketSnapshot = await this.getMarketSnapshot(userId);

    return {
      userId,
      recentAlphaDecisions,
      recentOmegaVotes,
      tradeHistory,
      performanceStats,
      marketSnapshot
    };
  }

  private async getRecentAlphaDecisions(userId: string): Promise<AlphaDecision[]> {
    try {
      const { data, error } = await supabase
        .from('alpha_decisions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      return (data || []).map(d => ({
        decision: d.decision as 'BUY' | 'SELL' | 'NO_TRADE',
        confidence: d.confidence,
        reasoning: d.reasoning || '',
        symbol: d.symbol,
        timestamp: new Date(d.created_at)
      }));
    } catch (error) {
      console.error('[Omega-10 Scheduler] Error fetching Alpha decisions:', error);
      return [];
    }
  }

  private async getRecentOmegaVotes(userId: string): Promise<OmegaCouncilVotes[]> {
    try {
      const { data, error } = await supabase
        .from('omega_votes')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;

      const groupedVotes: Record<string, any> = {};

      for (const vote of data || []) {
        const key = vote.trade_id || vote.session_id || vote.created_at;
        if (!groupedVotes[key]) {
          groupedVotes[key] = {};
        }
        groupedVotes[key][vote.omega_specialist] = {
          vote: vote.vote,
          confidence: vote.confidence,
          reasoning: vote.reasoning
        };
      }

      return Object.values(groupedVotes);
    } catch (error) {
      console.error('[Omega-10 Scheduler] Error fetching Omega votes:', error);
      return [];
    }
  }

  private async getTradeHistory(userId: string): Promise<TradeRecord[]> {
    try {
      const { data, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'closed')
        .order('close_time', { ascending: false })
        .limit(100);

      if (error) throw error;

      return (data || []).map(t => ({
        id: t.id,
        symbol: t.symbol,
        direction: t.direction as 'buy' | 'sell',
        entryPrice: t.entry_price,
        exitPrice: t.exit_price,
        pnl: t.profit_loss,
        outcome: t.profit_loss > 0 ? 'win' : t.profit_loss < 0 ? 'loss' : 'breakeven',
        stopLossType: t.close_reason,
        pattern: t.pattern,
        alphaConfidence: t.alpha_confidence,
        marketRegime: t.market_regime,
        timestamp: new Date(t.close_time)
      }));
    } catch (error) {
      console.error('[Omega-10 Scheduler] Error fetching trade history:', error);
      return [];
    }
  }

  private calculatePerformanceStats(trades: TradeRecord[]): Omega10Input['performanceStats'] {
    const wins = trades.filter(t => t.outcome === 'win').length;
    const losses = trades.filter(t => t.outcome === 'loss').length;
    const winRate = trades.length > 0 ? wins / trades.length : 0;
    const avgPnl = trades.length > 0
      ? trades.reduce((sum, t) => sum + t.pnl, 0) / trades.length
      : 0;

    let currentStreak = 0;
    let streakType: 'win' | 'loss' = 'win';

    for (const trade of trades) {
      if (currentStreak === 0) {
        streakType = trade.outcome === 'win' ? 'win' : 'loss';
        currentStreak = 1;
      } else if ((streakType === 'win' && trade.outcome === 'win') ||
                 (streakType === 'loss' && trade.outcome === 'loss')) {
        currentStreak++;
      } else {
        break;
      }
    }

    const byPattern: Record<string, PatternPerformance> = {};
    for (const trade of trades) {
      const pattern = trade.pattern || 'unknown';
      if (!byPattern[pattern]) {
        byPattern[pattern] = {
          pattern,
          wins: 0,
          losses: 0,
          breakeven: 0,
          winRate: 0,
          avgPnl: 0,
          lastUsed: trade.timestamp
        };
      }

      if (trade.outcome === 'win') byPattern[pattern].wins++;
      else if (trade.outcome === 'loss') byPattern[pattern].losses++;
      else byPattern[pattern].breakeven++;
    }

    for (const pattern in byPattern) {
      const p = byPattern[pattern];
      const total = p.wins + p.losses + p.breakeven;
      p.winRate = total > 0 ? p.wins / total : 0;
      const patternTrades = trades.filter(t => (t.pattern || 'unknown') === pattern);
      p.avgPnl = patternTrades.length > 0
        ? patternTrades.reduce((sum, t) => sum + t.pnl, 0) / patternTrades.length
        : 0;
    }

    const grossWins = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
    const grossLosses = Math.abs(trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
    const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? 999 : 0;

    const overall: PerformanceMetrics = {
      winRate,
      avgPnl,
      totalTrades: trades.length,
      consecutiveLosses: streakType === 'loss' ? currentStreak : 0,
      consecutiveWins: streakType === 'win' ? currentStreak : 0,
      maxDrawdown: Math.min(...trades.map(t => t.pnl)),
      profitFactor
    };

    return {
      overall,
      byPattern,
      recentStreak: {
        type: streakType,
        count: currentStreak
      }
    };
  }

  private async getMarketSnapshot(userId: string): Promise<Omega10Input['marketSnapshot']> {
    try {
      const { data, error } = await supabase
        .from('realtime_prices')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return {
          symbol: 'EURUSD',
          price: 1.0,
          regime: 'sideways',
          volatility: 'medium',
          session: 'london',
          timeOfDay: new Date().getHours().toString()
        };
      }

      return {
        symbol: data.symbol,
        price: data.bid,
        regime: data.market_regime || 'sideways',
        volatility: data.volatility_state || 'medium',
        session: data.session || 'london',
        timeOfDay: new Date().getHours().toString()
      };
    } catch (error) {
      console.error('[Omega-10 Scheduler] Error fetching market snapshot:', error);
      return {
        symbol: 'EURUSD',
        price: 1.0,
        regime: 'sideways',
        volatility: 'medium',
        session: 'london',
        timeOfDay: new Date().getHours().toString()
      };
    }
  }

  private hasMinimumData(input: Omega10Input): boolean {
    return input.tradeHistory.length >= this.MIN_TRADES_FOR_ANALYSIS;
  }

  private async saveAnalysisResult(
    result: Omega10Result,
    userId: string,
    triggerReason?: string
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('omega10_analysis')
        .insert({
          user_id: userId,
          timestamp: result.timestamp.toISOString(),
          analysis_type: result.analysisType,
          trigger_reason: triggerReason,
          contradictions: result.contradictions,
          drift_warnings: result.driftWarnings,
          confidence_issues: result.confidenceIssues,
          risk_horizon: result.riskHorizon.level,
          risk_reasons: result.riskHorizon.reasons,
          risk_recommended_actions: result.riskHorizon.recommendedActions,
          strategy_adjustments: result.strategyAdjustments,
          omega_weight_overrides: result.omegaWeightOverrides,
          recommended_strategy_mode: result.recommendedStrategyMode,
          memory_update: result.memoryUpdate,
          used_llm: result.usedLLM,
          llm_reasoning: result.llmReasoning,
          meta_confidence: result.metaConfidence,
          next_review_at: result.nextReviewAt.toISOString()
        });

      if (error) throw error;

      console.log('[Omega-10 Scheduler] ✅ Analysis result saved to database');
    } catch (error) {
      console.error('[Omega-10 Scheduler] Error saving analysis result:', error);
    }
  }

  private async applyInterventions(result: Omega10Result): Promise<void> {
    if (!this.userId) return;

    for (const adjustment of result.strategyAdjustments) {
      try {
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

        const { error } = await supabase
          .from('omega10_intervention_log')
          .insert({
            user_id: this.userId,
            intervention_type: adjustment.type,
            target: adjustment.target,
            action: adjustment.action,
            reason: adjustment.reason,
            priority: adjustment.priority,
            active_until: expiresAt.toISOString()
          });

        if (error) throw error;

        console.log(`[Omega-10 Scheduler] ✅ Applied intervention: ${adjustment.action}`);
      } catch (error) {
        console.error('[Omega-10 Scheduler] Error applying intervention:', error);
      }
    }

    if (result.memoryUpdate) {
      await this.updateStrategyMemory(result.memoryUpdate);
    }
  }

  private async updateStrategyMemory(memoryUpdate: any): Promise<void> {
    if (!this.userId) return;

    try {
      const { error } = await supabase
        .from('alpha_strategy_memory')
        .insert({
          user_id: this.userId,
          strategy_mode: 'system_adjustment',
          conditions: [memoryUpdate.pattern],
          entry_logic: memoryUpdate.recommendation,
          sl_calculation: 'adaptive',
          tp_calculation: 'adaptive',
          risk_pct: 1,
          planned_confidence: memoryUpdate.confidence,
          rationale: memoryUpdate.recommendation,
          symbol: 'SYSTEM',
          timeframe: '1H',
          market_regime: 'all',
          volatility: 'all',
          omega10_recommended: true
        });

      if (error) throw error;

      console.log('[Omega-10 Scheduler] ✅ Strategy memory updated');
    } catch (error) {
      console.error('[Omega-10 Scheduler] Error updating strategy memory:', error);
    }
  }

  async getLatestAnalysis(userId: string): Promise<Omega10Result | null> {
    try {
      const { data, error } = await supabase
        .from('omega10_analysis')
        .select('*')
        .eq('user_id', userId)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) return null;

      return {
        omega: 'meta_reasoning',
        timestamp: new Date(data.timestamp),
        analysisType: data.analysis_type as 'scheduled' | 'triggered' | 'manual',
        contradictions: data.contradictions || [],
        driftWarnings: data.drift_warnings || [],
        confidenceIssues: data.confidence_issues || [],
        riskHorizon: {
          level: data.risk_horizon as 'low' | 'medium' | 'high',
          reasons: data.risk_reasons || [],
          recommendedActions: data.risk_recommended_actions || [],
          validForHours: 4
        },
        strategyAdjustments: data.strategy_adjustments || [],
        omegaWeightOverrides: data.omega_weight_overrides || {},
        recommendedStrategyMode: data.recommended_strategy_mode,
        memoryUpdate: data.memory_update,
        usedLLM: data.used_llm,
        llmReasoning: data.llm_reasoning,
        metaConfidence: data.meta_confidence,
        nextReviewAt: new Date(data.next_review_at)
      };
    } catch (error) {
      console.error('[Omega-10 Scheduler] Error fetching latest analysis:', error);
      return null;
    }
  }

  async getActiveOverrides(userId: string): Promise<Record<string, number>> {
    try {
      const { data, error } = await supabase
        .from('omega10_analysis')
        .select('omega_weight_overrides')
        .eq('user_id', userId)
        .gte('next_review_at', new Date().toISOString())
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) return {};

      return data.omega_weight_overrides || {};
    } catch (error) {
      console.error('[Omega-10 Scheduler] Error fetching active overrides:', error);
      return {};
    }
  }

  async getActiveInterventions(userId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .rpc('get_active_omega10_interventions', { p_user_id: userId });

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('[Omega-10 Scheduler] Error fetching active interventions:', error);
      return [];
    }
  }
}

export const omega10Scheduler = new Omega10Scheduler();
export default omega10Scheduler;
