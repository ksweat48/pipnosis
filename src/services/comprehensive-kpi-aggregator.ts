import { supabase } from '@/lib/supabase';

interface LLMLayerKPI {
  layer_number: number;
  layer_name: string;
  total_evaluations: number;
  pass_count: number;
  reject_count: number;
  skip_count: number;
  pass_rate: number;
  avg_confidence: number;
  total_tokens_used: number;
  avg_processing_time_ms: number;
  rejection_reasons: any[];
}

interface AvoidPatternKPI {
  symbol: string;
  total_checks: number;
  trades_avoided: number;
  trades_allowed: number;
  block_rate: number;
  avg_similarity_score: number;
  patterns_matched: number;
  pattern_accuracy: number;
  ev_of_avoided_trades: number;
  ev_of_taken_trades: number;
  ev_difference: number;
  pattern_conflicts: number;
  false_positive_rate: number;
}

interface ContinuousLearningKPI {
  loop_activations: number;
  insights_validated: number;
  insights_updated: number;
  insights_pruned: number;
  insights_created: number;
  validation_accuracy: number;
  confidence_recalibrations: number;
  avg_confidence_adjustment: number;
  rolling_css: number;
  learning_velocity: number;
  system_health_score: number;
}

interface StrategyEvolutionKPI {
  symbol: string;
  patterns_discovered: number;
  patterns_active: number;
  patterns_deactivated: number;
  avg_pattern_ev: number;
  pattern_ev_stability: number;
  cross_symbol_generalization: number;
  pattern_survival_rate: number;
  avg_pattern_lifespan_days: number;
  top_pattern_name: string | null;
  top_pattern_ev: number;
}

interface SmartGoalKPI {
  total_trades: number;
  llm_decision_trades: number;
  rule_based_trades: number;
  llm_decision_percentage: number;
  llm_win_rate: number;
  rule_win_rate: number;
  performance_gap: number;
  goals_completed: number;
  goals_active: number;
  avg_trades_per_goal: number;
  avg_time_per_goal_minutes: number;
  goal_completion_efficiency: number;
  risk_efficiency_score: number;
}

interface AIMasteryKPI {
  moving_win_rate_50: number;
  moving_win_rate_100: number;
  moving_win_rate_500: number;
  moving_profit_factor_50: number;
  moving_profit_factor_100: number;
  moving_profit_factor_500: number;
  mistake_reduction_rate: number;
  confidence_accuracy: number;
  pattern_generalization_index: number;
  reaction_time_improvement: number;
  skill_level: string;
  skill_progress_percentage: number;
  trades_to_next_level: number;
}

export class ComprehensiveKPIAggregator {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  async aggregateAllKPIs(date: Date = new Date()): Promise<void> {
    const dateStr = date.toISOString().split('T')[0];

    try {
      await Promise.all([
        this.aggregateLLMLayerKPIs(dateStr),
        this.aggregateAvoidPatternKPIs(dateStr),
        this.aggregateContinuousLearningKPIs(dateStr),
        this.aggregateStrategyEvolutionKPIs(dateStr),
        this.aggregateSmartGoalKPIs(dateStr),
        this.aggregateAIMasteryKPIs(dateStr),
      ]);

      console.log('✅ All KPIs aggregated successfully');
    } catch (error) {
      console.error('Error aggregating KPIs:', error);
      throw error;
    }
  }

  private async aggregateLLMLayerKPIs(date: string): Promise<void> {
    const layers = [
      { number: 0, name: 'Input Validation' },
      { number: 1, name: 'Market Regime' },
      { number: 2, name: 'Setup Quality' },
      { number: 3, name: 'Risk Assessment' },
      { number: 4, name: 'Timing Optimization' },
      { number: 5, name: 'Final Decision' },
    ];

    for (const layer of layers) {
      const { data: decisions } = await supabase
        .from('llm_layer_decisions')
        .select('*')
        .eq('user_id', this.userId)
        .eq('layer_number', layer.number)
        .gte('created_at', `${date}T00:00:00`)
        .lt('created_at', `${date}T23:59:59`);

      if (!decisions || decisions.length === 0) continue;

      const totalEvaluations = decisions.length;
      const passCount = decisions.filter(d => d.decision === 'pass').length;
      const rejectCount = decisions.filter(d => d.decision === 'reject').length;
      const skipCount = decisions.filter(d => d.decision === 'skip').length;
      const passRate = (passCount / totalEvaluations) * 100;
      const avgConfidence = decisions.reduce((sum, d) => sum + (d.confidence || 0), 0) / totalEvaluations;
      const totalTokens = decisions.reduce((sum, d) => sum + (d.tokens_used || 0), 0);
      const avgProcessingTime = decisions.reduce((sum, d) => sum + (d.processing_time_ms || 0), 0) / totalEvaluations;

      const rejectionReasons = decisions
        .filter(d => d.decision === 'reject' && d.rejection_reason)
        .map(d => d.rejection_reason);

      await supabase
        .from('llm_layer_kpis')
        .upsert({
          user_id: this.userId,
          date,
          layer_number: layer.number,
          layer_name: layer.name,
          total_evaluations: totalEvaluations,
          pass_count: passCount,
          reject_count: rejectCount,
          skip_count: skipCount,
          pass_rate: parseFloat(passRate.toFixed(2)),
          avg_confidence: parseFloat(avgConfidence.toFixed(2)),
          total_tokens_used: totalTokens,
          avg_processing_time_ms: Math.round(avgProcessingTime),
          rejection_reasons: rejectionReasons,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id,date,layer_number'
        });
    }
  }

  private async aggregateAvoidPatternKPIs(date: string): Promise<void> {
    const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD'];

    for (const symbol of symbols) {
      const { data: checks } = await supabase
        .from('avoid_pattern_checks')
        .select('*')
        .eq('user_id', this.userId)
        .eq('symbol', symbol)
        .gte('checked_at', `${date}T00:00:00`)
        .lt('checked_at', `${date}T23:59:59`);

      if (!checks || checks.length === 0) continue;

      const totalChecks = checks.length;
      const tradesAvoided = checks.filter(c => c.should_avoid).length;
      const tradesAllowed = totalChecks - tradesAvoided;
      const blockRate = (tradesAvoided / totalChecks) * 100;
      const avgSimilarity = checks.reduce((sum, c) => sum + (c.similarity_score || 0), 0) / totalChecks;
      const patternsMatched = checks.filter(c => c.pattern_matched).length;
      const patternAccuracy = checks.filter(c => c.pattern_matched && c.was_correct).length / Math.max(patternsMatched, 1) * 100;
      const evAvoided = checks.filter(c => c.should_avoid).reduce((sum, c) => sum + (c.ev_impact || 0), 0);
      const evTaken = checks.filter(c => !c.should_avoid).reduce((sum, c) => sum + (c.ev_impact || 0), 0);

      await supabase
        .from('avoid_pattern_kpis')
        .upsert({
          user_id: this.userId,
          date,
          symbol,
          total_checks: totalChecks,
          trades_avoided: tradesAvoided,
          trades_allowed: tradesAllowed,
          block_rate: parseFloat(blockRate.toFixed(2)),
          avg_similarity_score: parseFloat(avgSimilarity.toFixed(2)),
          patterns_matched: patternsMatched,
          pattern_accuracy: parseFloat(patternAccuracy.toFixed(2)),
          ev_of_avoided_trades: parseFloat(evAvoided.toFixed(2)),
          ev_of_taken_trades: parseFloat(evTaken.toFixed(2)),
          ev_difference: parseFloat((evTaken - evAvoided).toFixed(2)),
          pattern_conflicts: checks.filter(c => c.has_conflict).length,
          false_positive_rate: parseFloat(((1 - patternAccuracy / 100) * 100).toFixed(2)),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id,date,symbol'
        });
    }
  }

  private async aggregateContinuousLearningKPIs(date: string): Promise<void> {
    const { data: insights } = await supabase
      .from('ai_learning_insights')
      .select('*')
      .eq('user_id', this.userId)
      .gte('created_at', `${date}T00:00:00`)
      .lt('created_at', `${date}T23:59:59`);

    const { data: validations } = await supabase
      .from('insight_validations')
      .select('*')
      .eq('user_id', this.userId)
      .gte('validated_at', `${date}T00:00:00`)
      .lt('validated_at', `${date}T23:59:59`);

    const { data: recalibrations } = await supabase
      .from('confidence_calibrations')
      .select('*')
      .eq('user_id', this.userId)
      .gte('calibrated_at', `${date}T00:00:00`)
      .lt('calibrated_at', `${date}T23:59:59`);

    const loopActivations = (insights?.length || 0) + (validations?.length || 0);
    const insightsValidated = validations?.filter(v => v.was_validated).length || 0;
    const insightsUpdated = insights?.filter(i => i.was_updated).length || 0;
    const insightsPruned = insights?.filter(i => i.was_pruned).length || 0;
    const insightsCreated = insights?.length || 0;
    const validationAccuracy = validations && validations.length > 0
      ? (insightsValidated / validations.length) * 100
      : 0;
    const confidenceRecalibrations = recalibrations?.length || 0;
    const avgConfidenceAdj = recalibrations && recalibrations.length > 0
      ? recalibrations.reduce((sum, r) => sum + Math.abs(r.adjustment), 0) / recalibrations.length
      : 0;

    const { data: skillData } = await supabase
      .from('ai_skill_tracking')
      .select('css_score')
      .eq('user_id', this.userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const rollingCSS = skillData?.css_score || 0;

    await supabase
      .from('continuous_learning_kpis')
      .upsert({
        user_id: this.userId,
        date,
        loop_activations: loopActivations,
        insights_validated: insightsValidated,
        insights_updated: insightsUpdated,
        insights_pruned: insightsPruned,
        insights_created: insightsCreated,
        validation_accuracy: parseFloat(validationAccuracy.toFixed(2)),
        confidence_recalibrations: confidenceRecalibrations,
        avg_confidence_adjustment: parseFloat(avgConfidenceAdj.toFixed(2)),
        rolling_css: parseFloat(rollingCSS.toFixed(2)),
        learning_velocity: parseFloat((insightsCreated / Math.max(loopActivations, 1)).toFixed(2)),
        system_health_score: parseFloat(((validationAccuracy + rollingCSS) / 2).toFixed(2)),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,date'
      });
  }

  private async aggregateStrategyEvolutionKPIs(date: string): Promise<void> {
    const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD'];

    for (const symbol of symbols) {
      const { data: patterns } = await supabase
        .from('ai_pattern_discoveries')
        .select('*')
        .eq('user_id', this.userId)
        .eq('symbol', symbol);

      if (!patterns || patterns.length === 0) continue;

      const patternsDiscovered = patterns.filter(p =>
        p.discovered_at >= `${date}T00:00:00` && p.discovered_at < `${date}T23:59:59`
      ).length;
      const patternsActive = patterns.filter(p => p.is_active).length;
      const patternsDeactivated = patterns.filter(p => !p.is_active).length;
      const avgPatternEV = patterns.reduce((sum, p) => sum + (p.expected_value || 0), 0) / patterns.length;
      const evStability = this.calculateEVStability(patterns);
      const crossSymbolGen = await this.calculateCrossSymbolGeneralization(symbol);
      const survivalRate = (patternsActive / patterns.length) * 100;
      const avgLifespan = patterns
        .filter(p => p.deactivated_at)
        .reduce((sum, p) => {
          const lifespan = (new Date(p.deactivated_at!).getTime() - new Date(p.discovered_at).getTime()) / (1000 * 60 * 60 * 24);
          return sum + lifespan;
        }, 0) / Math.max(patternsDeactivated, 1);

      const topPattern = patterns.sort((a, b) => (b.expected_value || 0) - (a.expected_value || 0))[0];

      await supabase
        .from('strategy_evolution_kpis')
        .upsert({
          user_id: this.userId,
          date,
          symbol,
          patterns_discovered: patternsDiscovered,
          patterns_active: patternsActive,
          patterns_deactivated: patternsDeactivated,
          avg_pattern_ev: parseFloat(avgPatternEV.toFixed(2)),
          pattern_ev_stability: parseFloat(evStability.toFixed(2)),
          cross_symbol_generalization: parseFloat(crossSymbolGen.toFixed(2)),
          pattern_survival_rate: parseFloat(survivalRate.toFixed(2)),
          avg_pattern_lifespan_days: Math.round(avgLifespan),
          top_pattern_name: topPattern?.pattern_name || null,
          top_pattern_ev: parseFloat((topPattern?.expected_value || 0).toFixed(2)),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id,date,symbol'
        });
    }
  }

  private calculateEVStability(patterns: any[]): number {
    if (patterns.length < 2) return 100;

    const evValues = patterns.map(p => p.expected_value || 0);
    const mean = evValues.reduce((sum, v) => sum + v, 0) / evValues.length;
    const variance = evValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / evValues.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = mean !== 0 ? (stdDev / Math.abs(mean)) : 0;

    return Math.max(0, 100 - (coefficientOfVariation * 100));
  }

  private async calculateCrossSymbolGeneralization(symbol: string): Promise<number> {
    const { data: patterns } = await supabase
      .from('ai_pattern_discoveries')
      .select('pattern_name, symbol')
      .eq('user_id', this.userId);

    if (!patterns || patterns.length === 0) return 0;

    const currentSymbolPatterns = patterns.filter(p => p.symbol === symbol).map(p => p.pattern_name);
    const otherSymbolPatterns = patterns.filter(p => p.symbol !== symbol).map(p => p.pattern_name);

    const sharedPatterns = currentSymbolPatterns.filter(p => otherSymbolPatterns.includes(p));

    return currentSymbolPatterns.length > 0
      ? (sharedPatterns.length / currentSymbolPatterns.length) * 100
      : 0;
  }

  private async aggregateSmartGoalKPIs(date: string): Promise<void> {
    const { data: trades } = await supabase
      .from('goal_trades')
      .select('*, goal_sessions(*)')
      .eq('user_id', this.userId)
      .gte('created_at', `${date}T00:00:00`)
      .lt('created_at', `${date}T23:59:59`);

    const { data: goals } = await supabase
      .from('goal_sessions')
      .select('*')
      .eq('user_id', this.userId)
      .gte('created_at', `${date}T00:00:00`)
      .lt('created_at', `${date}T23:59:59`);

    if (!trades || trades.length === 0) return;

    const totalTrades = trades.length;
    const llmDecisionTrades = trades.filter(t => t.decision_source === 'llm').length;
    const ruleBasedTrades = totalTrades - llmDecisionTrades;
    const llmDecisionPercentage = (llmDecisionTrades / totalTrades) * 100;

    const llmWins = trades.filter(t => t.decision_source === 'llm' && t.outcome === 'win').length;
    const llmWinRate = llmDecisionTrades > 0 ? (llmWins / llmDecisionTrades) * 100 : 0;

    const ruleWins = trades.filter(t => t.decision_source !== 'llm' && t.outcome === 'win').length;
    const ruleWinRate = ruleBasedTrades > 0 ? (ruleWins / ruleBasedTrades) * 100 : 0;

    const goalsCompleted = goals?.filter(g => g.status === 'completed').length || 0;
    const goalsActive = goals?.filter(g => g.status === 'active').length || 0;

    const completedGoals = goals?.filter(g => g.status === 'completed') || [];
    const avgTradesPerGoal = completedGoals.length > 0
      ? completedGoals.reduce((sum, g) => sum + (g.trades_taken || 0), 0) / completedGoals.length
      : 0;

    const avgTimePerGoal = completedGoals.length > 0
      ? completedGoals.reduce((sum, g) => {
          if (g.completed_at && g.created_at) {
            return sum + (new Date(g.completed_at).getTime() - new Date(g.created_at).getTime()) / (1000 * 60);
          }
          return sum;
        }, 0) / completedGoals.length
      : 0;

    await supabase
      .from('smart_goal_kpis')
      .upsert({
        user_id: this.userId,
        date,
        total_trades: totalTrades,
        llm_decision_trades: llmDecisionTrades,
        rule_based_trades: ruleBasedTrades,
        llm_decision_percentage: parseFloat(llmDecisionPercentage.toFixed(2)),
        llm_win_rate: parseFloat(llmWinRate.toFixed(2)),
        rule_win_rate: parseFloat(ruleWinRate.toFixed(2)),
        performance_gap: parseFloat((llmWinRate - ruleWinRate).toFixed(2)),
        goals_completed: goalsCompleted,
        goals_active: goalsActive,
        avg_trades_per_goal: parseFloat(avgTradesPerGoal.toFixed(2)),
        avg_time_per_goal_minutes: Math.round(avgTimePerGoal),
        goal_completion_efficiency: parseFloat(((goalsCompleted / Math.max(goalsCompleted + goalsActive, 1)) * 100).toFixed(2)),
        risk_efficiency_score: parseFloat(llmWinRate.toFixed(2)),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,date'
      });
  }

  private async aggregateAIMasteryKPIs(date: string): Promise<void> {
    const { data: recentTrades } = await supabase
      .from('ai_trade_analysis')
      .select('*')
      .eq('user_id', this.userId)
      .order('entry_time', { ascending: false })
      .limit(500);

    if (!recentTrades || recentTrades.length === 0) return;

    const calculateMovingWinRate = (count: number) => {
      const trades = recentTrades.slice(0, count);
      if (trades.length === 0) return 0;
      const wins = trades.filter(t => t.outcome === 'win').length;
      return (wins / trades.length) * 100;
    };

    const calculateMovingProfitFactor = (count: number) => {
      const trades = recentTrades.slice(0, count);
      const totalWins = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
      const totalLosses = Math.abs(trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
      return totalLosses > 0 ? totalWins / totalLosses : totalWins;
    };

    const { data: skillData } = await supabase
      .from('ai_skill_tracking')
      .select('*')
      .eq('user_id', this.userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    await supabase
      .from('ai_mastery_kpis')
      .upsert({
        user_id: this.userId,
        date,
        moving_win_rate_50: parseFloat(calculateMovingWinRate(50).toFixed(2)),
        moving_win_rate_100: parseFloat(calculateMovingWinRate(100).toFixed(2)),
        moving_win_rate_500: parseFloat(calculateMovingWinRate(500).toFixed(2)),
        moving_profit_factor_50: parseFloat(calculateMovingProfitFactor(50).toFixed(2)),
        moving_profit_factor_100: parseFloat(calculateMovingProfitFactor(100).toFixed(2)),
        moving_profit_factor_500: parseFloat(calculateMovingProfitFactor(500).toFixed(2)),
        mistake_reduction_rate: skillData?.mistake_reduction_rate || 0,
        confidence_accuracy: skillData?.confidence_accuracy || 0,
        pattern_generalization_index: skillData?.pattern_generalization_index || 0,
        reaction_time_improvement: skillData?.reaction_time_improvement || 0,
        skill_level: skillData?.current_level || 'Novice',
        skill_progress_percentage: skillData?.skill_level || 0,
        trades_to_next_level: skillData?.trades_to_next_level || 0,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,date'
      });
  }

  async detectAnomalies(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];

    const { data: llmKPIs } = await supabase
      .from('llm_layer_kpis')
      .select('*')
      .eq('user_id', this.userId)
      .eq('date', today);

    if (llmKPIs) {
      for (const kpi of llmKPIs) {
        if (kpi.pass_rate < 30) {
          await this.logAnomaly(
            'llm_layer_kpis',
            'pass_rate',
            30,
            100,
            kpi.pass_rate,
            'critical',
            `Layer ${kpi.layer_number} (${kpi.layer_name}) has unusually low pass rate`,
            'Review layer criteria and consider adjusting thresholds'
          );
        }
      }
    }

    const { data: learningKPIs } = await supabase
      .from('continuous_learning_kpis')
      .select('*')
      .eq('user_id', this.userId)
      .eq('date', today)
      .maybeSingle();

    if (learningKPIs && learningKPIs.system_health_score < 50) {
      await this.logAnomaly(
        'continuous_learning_kpis',
        'system_health_score',
        50,
        100,
        learningKPIs.system_health_score,
        'high',
        'Learning system health is below optimal',
        'Review recent insights and validation accuracy'
      );
    }
  }

  private async logAnomaly(
    kpiTable: string,
    kpiMetric: string,
    expectedMin: number,
    expectedMax: number,
    actualValue: number,
    severity: 'low' | 'medium' | 'high' | 'critical',
    reason: string,
    suggestion: string
  ): Promise<void> {
    await supabase
      .from('kpi_anomalies')
      .insert({
        user_id: this.userId,
        kpi_table: kpiTable,
        kpi_metric: kpiMetric,
        expected_range_min: expectedMin,
        expected_range_max: expectedMax,
        actual_value: actualValue,
        severity,
        anomaly_reason: reason,
        recovery_suggestion: suggestion,
      });
  }
}

export async function aggregateUserKPIs(userId: string): Promise<void> {
  const aggregator = new ComprehensiveKPIAggregator(userId);
  await aggregator.aggregateAllKPIs();
  await aggregator.detectAnomalies();
}
