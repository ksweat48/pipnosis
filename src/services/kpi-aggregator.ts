import { supabase } from '../lib/supabase';

interface KPIUpdateResult {
  success: boolean;
  kpisUpdated: string[];
  errors: string[];
}

class KPIAggregator {
  async updateAllKPIs(userId: string, date?: Date): Promise<KPIUpdateResult> {
    const targetDate = date || new Date();
    const dateStr = targetDate.toISOString().split('T')[0];

    console.log(`[KPI Aggregator] Updating all KPIs for ${userId} on ${dateStr}`);

    const kpisUpdated: string[] = [];
    const errors: string[] = [];

    try {
      await this.updateLLMLayerKPIs(userId, dateStr);
      kpisUpdated.push('llm_layer_kpis');
    } catch (error) {
      errors.push(`LLM Layer KPIs: ${error}`);
    }

    try {
      await this.updateAvoidPatternKPIs(userId, dateStr);
      kpisUpdated.push('avoid_pattern_kpis');
    } catch (error) {
      errors.push(`Avoid Pattern KPIs: ${error}`);
    }

    try {
      await this.updateContinuousLearningKPIs(userId, dateStr);
      kpisUpdated.push('continuous_learning_kpis');
    } catch (error) {
      errors.push(`Continuous Learning KPIs: ${error}`);
    }

    try {
      await this.updateStrategyEvolutionKPIs(userId, dateStr);
      kpisUpdated.push('strategy_evolution_kpis');
    } catch (error) {
      errors.push(`Strategy Evolution KPIs: ${error}`);
    }

    try {
      await this.updateSmartGoalKPIs(userId, dateStr);
      kpisUpdated.push('smart_goal_kpis');
    } catch (error) {
      errors.push(`Smart Goal KPIs: ${error}`);
    }

    try {
      await this.updateAIMasteryKPIs(userId, dateStr);
      kpisUpdated.push('ai_mastery_kpis');
    } catch (error) {
      errors.push(`AI Mastery KPIs: ${error}`);
    }

    try {
      await this.detectAnomalies(userId, dateStr);
      kpisUpdated.push('anomaly_detection');
    } catch (error) {
      errors.push(`Anomaly Detection: ${error}`);
    }

    console.log(`[KPI Aggregator] Updated ${kpisUpdated.length} KPI categories`);
    if (errors.length > 0) {
      console.error(`[KPI Aggregator] ${errors.length} errors occurred:`, errors);
    }

    return {
      success: errors.length === 0,
      kpisUpdated,
      errors
    };
  }

  private async updateLLMLayerKPIs(userId: string, date: string): Promise<void> {
    const layerData = [
      { number: 0, name: 'Hard Gate (Avoid Patterns)' },
      { number: 1, name: 'Regime Validator' },
      { number: 2, name: 'Setup Quality' },
      { number: 3, name: 'Mistake Prevention' },
      { number: 4, name: 'Confidence Calibrator' },
      { number: 5, name: 'Execution Brain' }
    ];

    for (const layer of layerData) {
      const { data: layerLogs } = await supabase
        .from('llm_layer_decision_log')
        .select('*')
        .eq('user_id', userId)
        .eq('layer_number', layer.number)
        .gte('timestamp', `${date}T00:00:00`)
        .lte('timestamp', `${date}T23:59:59`);

      if (!layerLogs || layerLogs.length === 0) continue;

      const totalEvaluations = layerLogs.length;
      const passCount = layerLogs.filter(l => l.passed_to_next_layer).length;
      const rejectCount = totalEvaluations - passCount;
      const passRate = (passCount / totalEvaluations) * 100;

      const avgTokens = layerLogs.reduce((sum, l) => sum + (l.tokens_used || 0), 0) / totalEvaluations;
      const avgProcessingTime = layerLogs.reduce((sum, l) => sum + (l.processing_time_ms || 0), 0) / totalEvaluations;

      const rejectionReasons = layerLogs
        .filter(l => !l.passed_to_next_layer)
        .map(l => l.layer_output?.reasoning || 'No reason')
        .reduce((acc, reason) => {
          acc[reason] = (acc[reason] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

      await supabase
        .from('llm_layer_kpis')
        .upsert({
          user_id: userId,
          date,
          layer_number: layer.number,
          layer_name: layer.name,
          total_evaluations: totalEvaluations,
          pass_count: passCount,
          reject_count: rejectCount,
          pass_rate: passRate,
          total_tokens_used: Math.round(avgTokens * totalEvaluations),
          avg_processing_time_ms: Math.round(avgProcessingTime),
          rejection_reasons: rejectionReasons,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,date,layer_number'
        });
    }
  }

  private async updateAvoidPatternKPIs(userId: string, date: string): Promise<void> {
    const symbols = ['EURUSD', 'XAUUSD', 'GBPUSD', 'USDJPY'];

    for (const symbol of symbols) {
      const { data: enforcementLogs } = await supabase
        .from('avoid_pattern_enforcement_log')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .gte('timestamp', `${date}T00:00:00`)
        .lte('timestamp', `${date}T23:59:59`);

      if (!enforcementLogs || enforcementLogs.length === 0) continue;

      const totalChecks = enforcementLogs.length;
      const tradesAvoided = enforcementLogs.filter(l => l.was_blocked).length;
      const tradesAllowed = totalChecks - tradesAvoided;
      const blockRate = (tradesAvoided / totalChecks) * 100;

      const avgSimilarity = enforcementLogs
        .filter(l => l.highest_similarity_score > 0)
        .reduce((sum, l) => sum + (l.highest_similarity_score || 0), 0) / totalChecks;

      const patternsMatched = enforcementLogs.reduce((sum, l) => sum + (l.matched_patterns_count || 0), 0);

      await supabase
        .from('avoid_pattern_kpis')
        .upsert({
          user_id: userId,
          date,
          symbol,
          total_checks: totalChecks,
          trades_avoided: tradesAvoided,
          trades_allowed: tradesAllowed,
          block_rate: blockRate,
          avg_similarity_score: avgSimilarity,
          patterns_matched: patternsMatched,
          pattern_accuracy: 0,
          ev_of_avoided_trades: 0,
          ev_of_taken_trades: 0,
          ev_difference: 0,
          pattern_conflicts: 0,
          false_positive_rate: 0,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,date,symbol'
        });
    }
  }

  private async updateContinuousLearningKPIs(userId: string, date: string): Promise<void> {
    const { data: insights } = await supabase
      .from('ai_learning_insights')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', `${date}T00:00:00`)
      .lte('created_at', `${date}T23:59:59`);

    const insightsCreated = insights?.length || 0;

    const { data: recentInsights } = await supabase
      .from('ai_learning_insights')
      .select('confidence_score, times_applied, success_rate_when_applied')
      .eq('user_id', userId)
      .gte('updated_at', `${date}T00:00:00`)
      .lte('updated_at', `${date}T23:59:59`);

    const insightsUpdated = recentInsights?.filter(i => i.times_applied > 0).length || 0;
    const insightsValidated = recentInsights?.length || 0;
    const insightsPruned = recentInsights?.filter(i => i.confidence_score <= 0).length || 0;

    const validationAccuracy = recentInsights && recentInsights.length > 0
      ? recentInsights.reduce((sum, i) => sum + (i.success_rate_when_applied || 0), 0) / recentInsights.length
      : 0;

    const { data: dailyMetaAnalysis } = await supabase
      .from('daily_meta_analysis')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .maybeSingle();

    const metaAnalysisGenerated = dailyMetaAnalysis ? 1 : 0;
    const strategicRecommendations = dailyMetaAnalysis?.strategic_recommendations?.length || 0;
    const confidenceAdjustments = dailyMetaAnalysis?.confidence_calibration?.recommended_threshold
      ? Math.abs(dailyMetaAnalysis.confidence_calibration.recommended_threshold - 75)
      : 0;
    const performanceTrendPositive = dailyMetaAnalysis?.performance_trend === 'improving' ? 1 : 0;

    await supabase
      .from('continuous_learning_kpis')
      .upsert({
        user_id: userId,
        date,
        loop_activations: insightsValidated + metaAnalysisGenerated,
        insights_validated: insightsValidated,
        insights_updated: insightsUpdated,
        insights_pruned: insightsPruned,
        insights_created: insightsCreated,
        validation_accuracy: validationAccuracy,
        confidence_recalibrations: insightsUpdated + (confidenceAdjustments > 0 ? 1 : 0),
        avg_confidence_adjustment: confidenceAdjustments,
        rolling_css: performanceTrendPositive,
        learning_velocity: insightsCreated / Math.max(1, insightsValidated) * 100,
        system_health_score: validationAccuracy,
        daily_meta_analysis_generated: metaAnalysisGenerated,
        strategic_recommendations_count: strategicRecommendations,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,date'
      });
  }

  private async updateStrategyEvolutionKPIs(userId: string, date: string): Promise<void> {
    const symbols = ['EURUSD', 'XAUUSD', 'GBPUSD', 'USDJPY'];

    for (const symbol of symbols) {
      const { data: patterns } = await supabase
        .from('ai_pattern_discoveries')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .gte('discovered_at', `${date}T00:00:00`)
        .lte('discovered_at', `${date}T23:59:59`);

      const patternsDiscovered = patterns?.length || 0;

      const { data: allPatterns } = await supabase
        .from('ai_pattern_discoveries')
        .select('pattern_ev, is_active')
        .eq('user_id', userId)
        .eq('symbol', symbol);

      const patternsActive = allPatterns?.filter(p => p.is_active).length || 0;
      const avgEV = allPatterns && allPatterns.length > 0
        ? allPatterns.reduce((sum, p) => sum + (p.pattern_ev || 0), 0) / allPatterns.length
        : 0;

      await supabase
        .from('strategy_evolution_kpis')
        .upsert({
          user_id: userId,
          date,
          symbol,
          patterns_discovered: patternsDiscovered,
          patterns_active: patternsActive,
          patterns_deactivated: 0,
          avg_pattern_ev: avgEV,
          pattern_ev_stability: 75,
          cross_symbol_generalization: 60,
          pattern_survival_rate: patternsActive > 0 ? (patternsActive / (patternsActive + patternsDiscovered)) * 100 : 0,
          avg_pattern_lifespan_days: 30,
          top_pattern_name: null,
          top_pattern_ev: avgEV,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,date,symbol'
        });
    }
  }

  private async updateSmartGoalKPIs(userId: string, date: string): Promise<void> {
    const { data: goalSessions } = await supabase
      .from('smart_goal_sessions')
      .select('*')
      .eq('user_id', userId)
      .gte('started_at', `${date}T00:00:00`)
      .lte('started_at', `${date}T23:59:59`);

    const goalsActive = goalSessions?.filter(s => s.status === 'active').length || 0;
    const goalsCompleted = goalSessions?.filter(s => s.status === 'completed').length || 0;

    const { data: goalTrades } = await supabase
      .from('smart_goal_trades')
      .select('*')
      .eq('user_id', userId)
      .gte('executed_at', `${date}T00:00:00`)
      .lte('executed_at', `${date}T23:59:59`);

    const totalTrades = goalTrades?.length || 0;
    const llmTrades = goalTrades?.filter(t => t.decision_source === 'llm').length || 0;
    const ruleTrades = totalTrades - llmTrades;

    const llmWins = goalTrades?.filter(t => t.decision_source === 'llm' && t.profit_loss > 0).length || 0;
    const ruleWins = goalTrades?.filter(t => t.decision_source === 'rule' && t.profit_loss > 0).length || 0;

    const llmWinRate = llmTrades > 0 ? (llmWins / llmTrades) * 100 : 0;
    const ruleWinRate = ruleTrades > 0 ? (ruleWins / ruleTrades) * 100 : 0;

    await supabase
      .from('smart_goal_kpis')
      .upsert({
        user_id: userId,
        date,
        total_trades: totalTrades,
        llm_decision_trades: llmTrades,
        rule_based_trades: ruleTrades,
        llm_decision_percentage: totalTrades > 0 ? (llmTrades / totalTrades) * 100 : 0,
        llm_win_rate: llmWinRate,
        rule_win_rate: ruleWinRate,
        performance_gap: llmWinRate - ruleWinRate,
        goals_completed: goalsCompleted,
        goals_active: goalsActive,
        avg_trades_per_goal: goalsCompleted > 0 ? totalTrades / goalsCompleted : 0,
        avg_time_per_goal_minutes: 0,
        goal_completion_efficiency: goalsCompleted > 0 ? (goalsCompleted / (goalsCompleted + goalsActive)) * 100 : 0,
        risk_efficiency_score: 0,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,date'
      });
  }

  private async updateAIMasteryKPIs(userId: string, date: string): Promise<void> {
    const { data: winRate50 } = await supabase.rpc('calculate_moving_win_rate', {
      p_user_id: userId,
      p_trade_count: 50
    });

    const { data: winRate100 } = await supabase.rpc('calculate_moving_win_rate', {
      p_user_id: userId,
      p_trade_count: 100
    });

    const { data: winRate500 } = await supabase.rpc('calculate_moving_win_rate', {
      p_user_id: userId,
      p_trade_count: 500
    });

    const { data: pf50 } = await supabase.rpc('calculate_moving_profit_factor', {
      p_user_id: userId,
      p_trade_count: 50
    });

    const { data: pf100 } = await supabase.rpc('calculate_moving_profit_factor', {
      p_user_id: userId,
      p_trade_count: 100
    });

    const { data: pf500 } = await supabase.rpc('calculate_moving_profit_factor', {
      p_user_id: userId,
      p_trade_count: 500
    });

    const { data: skillData } = await supabase
      .from('ai_skill_tracking')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    await supabase
      .from('ai_mastery_kpis')
      .upsert({
        user_id: userId,
        date,
        moving_win_rate_50: winRate50 || 0,
        moving_win_rate_100: winRate100 || 0,
        moving_win_rate_500: winRate500 || 0,
        moving_profit_factor_50: pf50 || 0,
        moving_profit_factor_100: pf100 || 0,
        moving_profit_factor_500: pf500 || 0,
        mistake_reduction_rate: 0,
        confidence_accuracy: skillData?.confidence_accuracy || 0,
        pattern_generalization_index: 0,
        reaction_time_improvement: 0,
        skill_level: skillData?.skill_level || 'Beginner',
        skill_progress_percentage: skillData?.skill_progress || 0,
        trades_to_next_level: skillData?.trades_to_next_level || 100,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,date'
      });
  }

  private async detectAnomalies(userId: string, date: string): Promise<void> {
    const thresholds = {
      llm_pass_rate: { min: 40, max: 100, severity: 'high' },
      avoid_block_rate: { min: 0, max: 50, severity: 'medium' },
      learning_velocity: { min: 10, max: 200, severity: 'medium' },
      win_rate: { min: 45, max: 100, severity: 'critical' },
      profit_factor: { min: 1.0, max: 10, severity: 'critical' }
    };

    const { data: llmKPIs } = await supabase
      .from('llm_layer_kpis')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date);

    const { data: masteryKPIs } = await supabase
      .from('ai_mastery_kpis')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date)
      .maybeSingle();

    if (llmKPIs) {
      for (const kpi of llmKPIs) {
        if (kpi.pass_rate < thresholds.llm_pass_rate.min) {
          await this.logAnomaly(userId, 'llm_layer_kpis', 'pass_rate',
            thresholds.llm_pass_rate.min, thresholds.llm_pass_rate.max,
            kpi.pass_rate, thresholds.llm_pass_rate.severity as any,
            `Layer ${kpi.layer_number} pass rate is below threshold`,
            'Review rejection reasons and adjust layer thresholds'
          );
        }
      }
    }

    if (masteryKPIs) {
      if (masteryKPIs.moving_win_rate_100 < thresholds.win_rate.min) {
        await this.logAnomaly(userId, 'ai_mastery_kpis', 'moving_win_rate_100',
          thresholds.win_rate.min, thresholds.win_rate.max,
          masteryKPIs.moving_win_rate_100, thresholds.win_rate.severity as any,
          'Moving win rate (100 trades) is below target',
          'Review recent losing trades and adjust strategy'
        );
      }

      if (masteryKPIs.moving_profit_factor_100 < thresholds.profit_factor.min) {
        await this.logAnomaly(userId, 'ai_mastery_kpis', 'moving_profit_factor_100',
          thresholds.profit_factor.min, thresholds.profit_factor.max,
          masteryKPIs.moving_profit_factor_100, thresholds.profit_factor.severity as any,
          'Moving profit factor (100 trades) is below 1.0',
          'Losses are exceeding wins - review risk management'
        );
      }
    }
  }

  private async logAnomaly(
    userId: string,
    kpiTable: string,
    kpiMetric: string,
    expectedMin: number,
    expectedMax: number,
    actualValue: number,
    severity: 'low' | 'medium' | 'high' | 'critical',
    reason: string,
    suggestion: string
  ): Promise<void> {
    await supabase.from('kpi_anomalies').insert({
      user_id: userId,
      kpi_table: kpiTable,
      kpi_metric: kpiMetric,
      expected_range_min: expectedMin,
      expected_range_max: expectedMax,
      actual_value: actualValue,
      severity,
      anomaly_reason: reason,
      recovery_suggestion: suggestion,
      acknowledged: false
    });
  }

  async getCachedKPI(userId: string, cacheKey: string): Promise<any | null> {
    const { data } = await supabase
      .from('kpi_cache')
      .select('cache_value, expires_at')
      .eq('user_id', userId)
      .eq('cache_key', cacheKey)
      .maybeSingle();

    if (!data) return null;

    if (new Date(data.expires_at) < new Date()) {
      await supabase
        .from('kpi_cache')
        .delete()
        .eq('user_id', userId)
        .eq('cache_key', cacheKey);
      return null;
    }

    return data.cache_value;
  }

  async setCachedKPI(userId: string, cacheKey: string, value: any, ttlSeconds: number = 300): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    await supabase
      .from('kpi_cache')
      .upsert({
        user_id: userId,
        cache_key: cacheKey,
        cache_value: value,
        ttl_seconds: ttlSeconds,
        expires_at: expiresAt
      }, {
        onConflict: 'user_id,cache_key'
      });
  }
}

export const kpiAggregator = new KPIAggregator();
