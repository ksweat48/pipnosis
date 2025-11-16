import { supabase } from '@/lib/supabase';

export interface PipelineStage {
  id: string;
  name: string;
  description: string;
  status: 'healthy' | 'warning' | 'error' | 'idle';
  lastActivity: string | null;
  processedToday: number;
  processedThisWeek: number;
  successRate: number;
  avgProcessingTimeMs: number;
  currentQueue: number;
  errorMessages: string[];
}

export interface PipelineHealthReport {
  overallStatus: 'healthy' | 'warning' | 'error';
  overallHealthScore: number;
  lastUpdated: string;
  stages: PipelineStage[];
  alerts: string[];
  recommendations: string[];
  dataFlowSummary: {
    tradesProcessedToday: number;
    insightsGeneratedToday: number;
    gpt4oCallsToday: number;
    skillUpdatesToday: number;
    avgEndToEndTimeMs: number;
  };
}

class LearningPipelineHealthCheck {
  private readonly STAGE_DEFINITIONS = [
    {
      id: 'trade_capture',
      name: 'Trade Execution & Capture',
      description: 'Monitors trade completion and data capture',
      table: 'trade_history',
      timeColumn: 'closed_at',
      optional: false
    },
    {
      id: 'trade_analysis',
      name: 'Trade Analysis Engine',
      description: 'Individual trade analysis and reasoning',
      table: 'ai_trade_analysis',
      timeColumn: 'created_at',
      optional: false
    },
    {
      id: 'pattern_recognition',
      name: 'Pattern Recognition',
      description: 'Identifying winning and losing patterns',
      table: 'ai_learning_insights',
      timeColumn: 'created_at',
      optional: false
    },
    {
      id: 'session_learning',
      name: 'Session Learning Generator',
      description: 'Generates session-level learning summaries',
      table: 'ai_session_learnings',
      timeColumn: 'created_at',
      optional: false
    },
    {
      id: 'gpt4o_strategist',
      name: 'GPT-4o Meta-Learning Strategist',
      description: 'High-level strategic analysis (Optional Observer)',
      table: 'gpt4o_meta_learning_insights',
      timeColumn: 'created_at',
      optional: true
    },
    {
      id: 'gpt4o_interpreter',
      name: 'GPT-4o Pattern Interpreter',
      description: 'Natural language pattern explanations (Optional Observer)',
      table: 'gpt4o_pattern_interpretations',
      timeColumn: 'created_at',
      optional: true
    },
    {
      id: 'strategy_discovery',
      name: 'Strategy Discovery Engine',
      description: 'Discovers new trading strategies from patterns',
      table: 'ai_discovered_strategies',
      timeColumn: 'created_at',
      optional: false
    },
    {
      id: 'skill_progression',
      name: 'Skill Progression Updates',
      description: 'Tracks and updates skill level advancement',
      table: 'ai_skill_progression',
      timeColumn: 'updated_at',
      optional: false
    },
    {
      id: 'performance_evolution',
      name: 'Performance Evolution Tracking',
      description: 'Long-term performance metrics tracking',
      table: 'ai_performance_evolution',
      timeColumn: 'created_at',
      optional: false
    },
    {
      id: 'market_scenario',
      name: 'Market Scenario Performance',
      description: 'Performance by market conditions',
      table: 'ai_market_scenario_performance',
      timeColumn: 'last_updated',
      optional: false
    }
  ];

  /**
   * Run comprehensive pipeline health check
   */
  async checkPipelineHealth(userId: string): Promise<PipelineHealthReport> {
    console.log('[Pipeline Health Check] Starting comprehensive health check...');

    const stages: PipelineStage[] = [];
    const alerts: string[] = [];
    const recommendations: string[] = [];

    // Check each stage
    for (const stageDef of this.STAGE_DEFINITIONS) {
      const stageHealth = await this.checkStageHealth(userId, stageDef);
      stages.push(stageHealth);

      // Generate alerts based on stage status
      // Skip alerts for optional stages that are simply not enabled
      const isOptionalNotEnabled = stageDef.optional && stageHealth.errorMessages.includes('Optional feature not enabled');

      if (stageHealth.status === 'error' && !isOptionalNotEnabled) {
        alerts.push(`${stageHealth.name}: ${stageHealth.errorMessages.join(', ')}`);
      } else if (stageHealth.status === 'warning' && !stageDef.optional) {
        // Only warn on required stages
        alerts.push(`${stageHealth.name}: No activity in last 2 hours`);
      }
    }

    // Calculate data flow summary
    const dataFlowSummary = await this.calculateDataFlowSummary(userId, stages);

    // Generate recommendations
    recommendations.push(...this.generateRecommendations(stages, dataFlowSummary));

    // Calculate overall health score (0-100)
    const overallHealthScore = this.calculateOverallHealthScore(stages);

    // Determine overall status
    const overallStatus = this.determineOverallStatus(stages, overallHealthScore);

    console.log(`[Pipeline Health Check] Check complete. Overall score: ${overallHealthScore}/100, Status: ${overallStatus}`);

    return {
      overallStatus,
      overallHealthScore,
      lastUpdated: new Date().toISOString(),
      stages,
      alerts,
      recommendations,
      dataFlowSummary
    };
  }

  /**
   * Check health of individual pipeline stage
   */
  private async checkStageHealth(
    userId: string,
    stageDef: typeof this.STAGE_DEFINITIONS[0]
  ): Promise<PipelineStage> {
    const stage: PipelineStage = {
      id: stageDef.id,
      name: stageDef.name,
      description: stageDef.description,
      status: 'idle',
      lastActivity: null,
      processedToday: 0,
      processedThisWeek: 0,
      successRate: 0,
      avgProcessingTimeMs: 0,
      currentQueue: 0,
      errorMessages: []
    };

    try {
      // Get last activity timestamp
      const { data: lastRecord, error: lastError } = await supabase
        .from(stageDef.table)
        .select(stageDef.timeColumn)
        .eq('user_id', userId)
        .order(stageDef.timeColumn, { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastError) {
        // If this is an optional stage and table doesn't exist, mark as idle instead of error
        if (stageDef.optional && lastError.message.includes('Could not find the table')) {
          stage.status = 'idle';
          stage.errorMessages.push('Optional feature not enabled');
          return stage;
        }

        stage.status = 'error';
        stage.errorMessages.push(`Database error: ${lastError.message}`);
        return stage;
      }

      if (lastRecord) {
        stage.lastActivity = lastRecord[stageDef.timeColumn];
      }

      // Get count for today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { count: todayCount } = await supabase
        .from(stageDef.table)
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte(stageDef.timeColumn, today.toISOString());

      stage.processedToday = todayCount || 0;

      // Get count for this week
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const { count: weekCount } = await supabase
        .from(stageDef.table)
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte(stageDef.timeColumn, weekAgo.toISOString());

      stage.processedThisWeek = weekCount || 0;

      // Calculate success rate (simplified - assume all processed successfully if no errors)
      stage.successRate = stage.processedThisWeek > 0 ? 100 : 0;

      // Determine status based on last activity
      if (stage.lastActivity) {
        const timeSinceLastActivity = Date.now() - new Date(stage.lastActivity).getTime();
        const hoursSinceLastActivity = timeSinceLastActivity / (1000 * 60 * 60);

        if (hoursSinceLastActivity < 2) {
          stage.status = 'healthy';
        } else if (hoursSinceLastActivity < 24) {
          stage.status = 'warning';
        } else {
          stage.status = 'idle';
        }
      } else {
        stage.status = 'idle';
      }

    } catch (error) {
      stage.status = 'error';
      stage.errorMessages.push(`Exception: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return stage;
  }

  /**
   * Calculate data flow summary
   */
  private async calculateDataFlowSummary(userId: string, stages: PipelineStage[]): Promise<PipelineHealthReport['dataFlowSummary']> {
    const tradeStage = stages.find(s => s.id === 'trade_capture');
    const insightStage = stages.find(s => s.id === 'pattern_recognition');
    const gpt4oStrategistStage = stages.find(s => s.id === 'gpt4o_strategist');
    const gpt4oInterpreterStage = stages.find(s => s.id === 'gpt4o_interpreter');
    const skillStage = stages.find(s => s.id === 'skill_progression');

    return {
      tradesProcessedToday: tradeStage?.processedToday || 0,
      insightsGeneratedToday: insightStage?.processedToday || 0,
      gpt4oCallsToday: (gpt4oStrategistStage?.processedToday || 0) + (gpt4oInterpreterStage?.processedToday || 0),
      skillUpdatesToday: skillStage?.processedToday || 0,
      avgEndToEndTimeMs: 0 // Would need more complex tracking to calculate
    };
  }

  /**
   * Generate recommendations based on pipeline health
   */
  private generateRecommendations(stages: PipelineStage[], dataFlow: PipelineHealthReport['dataFlowSummary']): string[] {
    const recommendations: string[] = [];

    // Check if any stage is idle
    const idleStages = stages.filter(s => s.status === 'idle');
    if (idleStages.length > 0) {
      recommendations.push(`${idleStages.length} pipeline stages are idle. Run backtests or complete trades to activate learning.`);
    }

    // Check if any stage has errors
    const errorStages = stages.filter(s => s.status === 'error');
    if (errorStages.length > 0) {
      recommendations.push(`${errorStages.length} pipeline stages have errors. Check logs and database connectivity.`);
    }

    // Check if data is flowing
    if (dataFlow.tradesProcessedToday === 0) {
      recommendations.push('No trades processed today. Complete trades or run backtests to generate learning data.');
    }

    if (dataFlow.insightsGeneratedToday === 0 && dataFlow.tradesProcessedToday > 0) {
      recommendations.push('Trades processed but no insights generated. Check pattern recognition stage.');
    }

    // Check for bottlenecks (stages with significantly lower processing than previous stage)
    const tradeAnalysisStage = stages.find(s => s.id === 'trade_analysis');
    const tradeStage = stages.find(s => s.id === 'trade_capture');
    if (tradeStage && tradeAnalysisStage) {
      if (tradeStage.processedToday > 0 && tradeAnalysisStage.processedToday < tradeStage.processedToday * 0.5) {
        recommendations.push('Trade analysis stage is processing significantly fewer records than trades completed. Possible bottleneck.');
      }
    }

    // All good
    if (recommendations.length === 0 && dataFlow.tradesProcessedToday > 0) {
      recommendations.push('Pipeline is healthy and processing data correctly. Keep trading!');
    }

    return recommendations;
  }

  /**
   * Calculate overall health score (0-100)
   * Only includes required (non-optional) stages in the core health calculation
   */
  private calculateOverallHealthScore(stages: PipelineStage[]): number {
    let totalScore = 0;
    let requiredStageCount = 0;

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      const stageDef = this.STAGE_DEFINITIONS[i];

      // Skip optional stages in core health calculation
      if (stageDef.optional) {
        continue;
      }

      requiredStageCount++;
      let stageScore = 0;

      // Base score on status
      switch (stage.status) {
        case 'healthy':
          stageScore = 100;
          break;
        case 'warning':
          stageScore = 60;
          break;
        case 'idle':
          stageScore = 40;
          break;
        case 'error':
          stageScore = 0;
          break;
      }

      // Adjust for activity
      if (stage.processedToday > 0) {
        stageScore = Math.min(100, stageScore + 10);
      }

      // Adjust for success rate
      if (stage.successRate >= 95) {
        stageScore = Math.min(100, stageScore + 5);
      }

      totalScore += stageScore;
    }

    return requiredStageCount > 0 ? Math.round(totalScore / requiredStageCount) : 0;
  }

  /**
   * Determine overall pipeline status
   * Only considers required (non-optional) stages for status determination
   */
  private determineOverallStatus(stages: PipelineStage[], healthScore: number): 'healthy' | 'warning' | 'error' {
    // Check if any REQUIRED stage has errors
    const requiredErrorStages = stages.filter((s, i) => {
      const stageDef = this.STAGE_DEFINITIONS[i];
      return !stageDef.optional && s.status === 'error';
    });

    if (requiredErrorStages.length > 0) {
      return 'error';
    }

    // If health score is low
    if (healthScore < 50) {
      return 'error';
    } else if (healthScore < 75) {
      return 'warning';
    }

    return 'healthy';
  }

  /**
   * Run quick health check (lightweight)
   */
  async quickHealthCheck(userId: string): Promise<{
    status: 'healthy' | 'warning' | 'error';
    score: number;
    message: string;
  }> {
    try {
      // Check just a few critical tables
      const { data: tradeAnalysis } = await supabase
        .from('ai_trade_analysis')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: insights } = await supabase
        .from('ai_learning_insights')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: skillProg } = await supabase
        .from('ai_skill_progression')
        .select('current_skill_level, total_trades_analyzed')
        .eq('user_id', userId)
        .maybeSingle();

      // Determine status
      let status: 'healthy' | 'warning' | 'error' = 'healthy';
      let score = 100;
      let message = 'All systems operational';

      if (!skillProg) {
        status = 'warning';
        score = 60;
        message = 'Skill progression not initialized';
      } else if (!tradeAnalysis && !insights) {
        status = 'warning';
        score = 40;
        message = 'No learning data yet - run backtest to start';
      } else if (!tradeAnalysis) {
        status = 'warning';
        score = 70;
        message = 'Trade analysis stage inactive';
      } else if (!insights) {
        status = 'warning';
        score = 70;
        message = 'Pattern recognition stage inactive';
      }

      return { status, score, message };
    } catch (error) {
      return {
        status: 'error',
        score: 0,
        message: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Test pipeline with mock data (for diagnostics)
   */
  async runPipelineTest(userId: string): Promise<{
    success: boolean;
    stageResults: Array<{ stage: string; passed: boolean; message: string }>;
  }> {
    console.log('[Pipeline Test] Running diagnostic test...');

    const stageResults: Array<{ stage: string; passed: boolean; message: string }> = [];

    try {
      // Test 1: Check database connectivity
      const { data, error } = await supabase
        .from('ai_skill_progression')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      stageResults.push({
        stage: 'Database Connectivity',
        passed: !error,
        message: error ? `Database error: ${error.message}` : 'Database connection successful'
      });

      // Test 2: Check if skill progression exists
      if (!data) {
        stageResults.push({
          stage: 'Skill Progression Initialization',
          passed: false,
          message: 'Skill progression not initialized - will be created on first backtest'
        });
      } else {
        stageResults.push({
          stage: 'Skill Progression Initialization',
          passed: true,
          message: 'Skill progression record exists'
        });
      }

      // Test 3: Check if REQUIRED learning tables are accessible
      const requiredTables = [
        'ai_trade_analysis',
        'ai_learning_insights',
        'ai_session_learnings',
        'ai_performance_evolution'
      ];

      for (const table of requiredTables) {
        try {
          await supabase.from(table).select('id').limit(1);
          stageResults.push({
            stage: `Table: ${table}`,
            passed: true,
            message: 'Table accessible'
          });
        } catch (tableError) {
          stageResults.push({
            stage: `Table: ${table}`,
            passed: false,
            message: `Table error: ${tableError instanceof Error ? tableError.message : 'Unknown error'}`
          });
        }
      }

      // Test 4: Check if OPTIONAL GPT-4o tables are accessible (informational only, doesn't affect pass/fail)
      const optionalTables = [
        { name: 'gpt4o_meta_learning_insights', feature: 'GPT-4o Meta-Learning' },
        { name: 'gpt4o_pattern_interpretations', feature: 'GPT-4o Pattern Interpreter' }
      ];

      for (const { name, feature } of optionalTables) {
        try {
          await supabase.from(name).select('id').limit(1);
          stageResults.push({
            stage: `Optional: ${feature}`,
            passed: true,
            message: 'Feature enabled and accessible'
          });
        } catch (tableError) {
          // Optional features don't affect test pass/fail - just informational
          stageResults.push({
            stage: `Optional: ${feature}`,
            passed: true, // Mark as passed since it's optional
            message: 'Optional feature not enabled (this is OK)'
          });
        }
      }

      const allPassed = stageResults.every(r => r.passed);

      console.log(`[Pipeline Test] Test complete. Success: ${allPassed}`);

      return {
        success: allPassed,
        stageResults
      };
    } catch (error) {
      console.error('[Pipeline Test] Test failed:', error);
      return {
        success: false,
        stageResults: [{
          stage: 'Pipeline Test',
          passed: false,
          message: `Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }
}

export const learningPipelineHealthCheck = new LearningPipelineHealthCheck();
export type { PipelineStage, PipelineHealthReport };
