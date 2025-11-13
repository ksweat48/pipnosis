import { supabase } from '@/lib/supabase';

export interface LearningHealthStatus {
  overall: 'healthy' | 'warning' | 'error';
  checks: {
    tablesExist: boolean;
    hasLearningInsights: boolean;
    hasTradeAnalysis: boolean;
    hasPerformanceEvolution: boolean;
    hasSkillProgression: boolean;
    hasSessionLearnings: boolean;
    recentLearningActivity: boolean;
  };
  stats: {
    totalInsights: number;
    totalTradeAnalyses: number;
    totalPerformanceRecords: number;
    skillLevel: string;
    totalTradesAnalyzed: number;
    lastLearningDate: string | null;
    insightsLast24h: number;
    sessionsLast7Days: number;
  };
  issues: string[];
  recommendations: string[];
}

export interface LearningDataSummary {
  insights: {
    total: number;
    byType: Record<string, number>;
    recent: any[];
  };
  tradeAnalyses: {
    total: number;
    byOutcome: { wins: number; losses: number; breakeven: number };
    recent: any[];
  };
  skillProgression: {
    currentLevel: string;
    totalTrades: number;
    winRate: number;
    progressPercent: number;
  } | null;
  sessionLearnings: {
    total: number;
    recent: any[];
  };
  performanceEvolution: {
    total: number;
    latestMetrics: any;
  };
}

class AILearningHealthCheck {
  /**
   * Comprehensive health check of the AI learning system
   */
  async checkSystemHealth(userId: string): Promise<LearningHealthStatus> {
    console.log('[AI Learning Health Check] 🏥 Running comprehensive health check...');

    const checks = {
      tablesExist: true,
      hasLearningInsights: false,
      hasTradeAnalysis: false,
      hasPerformanceEvolution: false,
      hasSkillProgression: false,
      hasSessionLearnings: false,
      recentLearningActivity: false
    };

    const stats = {
      totalInsights: 0,
      totalTradeAnalyses: 0,
      totalPerformanceRecords: 0,
      skillLevel: 'Unknown',
      totalTradesAnalyzed: 0,
      lastLearningDate: null as string | null,
      insightsLast24h: 0,
      sessionsLast7Days: 0
    };

    const issues: string[] = [];
    const recommendations: string[] = [];

    try {
      // Check 1: AI Learning Insights
      const { data: insights, error: insightsError } = await supabase
        .from('ai_learning_insights')
        .select('id, created_at', { count: 'exact', head: false })
        .eq('user_id', userId)
        .limit(1);

      if (insightsError) {
        console.error('[Health Check] Error checking insights:', insightsError);
        checks.tablesExist = false;
        issues.push('Cannot access ai_learning_insights table');
      } else {
        checks.hasLearningInsights = (insights?.length ?? 0) > 0;

        // Get total count
        const { count } = await supabase
          .from('ai_learning_insights')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId);

        stats.totalInsights = count ?? 0;

        // Check last 24 hours
        const yesterday = new Date();
        yesterday.setHours(yesterday.getHours() - 24);
        const { count: recent24h } = await supabase
          .from('ai_learning_insights')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .gte('created_at', yesterday.toISOString());

        stats.insightsLast24h = recent24h ?? 0;
      }

      // Check 2: AI Trade Analysis
      const { data: tradeAnalysis, error: analysisError } = await supabase
        .from('ai_trade_analysis')
        .select('id, entry_time', { count: 'exact', head: false })
        .eq('user_id', userId)
        .limit(1);

      if (analysisError) {
        console.error('[Health Check] Error checking trade analysis:', analysisError);
        issues.push('Cannot access ai_trade_analysis table');
      } else {
        checks.hasTradeAnalysis = (tradeAnalysis?.length ?? 0) > 0;

        const { count } = await supabase
          .from('ai_trade_analysis')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId);

        stats.totalTradeAnalyses = count ?? 0;

        // Get most recent learning date
        if (tradeAnalysis && tradeAnalysis.length > 0) {
          const { data: latest } = await supabase
            .from('ai_trade_analysis')
            .select('entry_time')
            .eq('user_id', userId)
            .order('entry_time', { ascending: false })
            .limit(1)
            .single();

          if (latest) {
            stats.lastLearningDate = latest.entry_time;
          }
        }
      }

      // Check 3: Performance Evolution
      const { data: perfEvolution, error: perfError } = await supabase
        .from('ai_performance_evolution')
        .select('id', { count: 'exact', head: false })
        .eq('user_id', userId)
        .limit(1);

      if (perfError) {
        console.error('[Health Check] Error checking performance evolution:', perfError);
        issues.push('Cannot access ai_performance_evolution table');
      } else {
        checks.hasPerformanceEvolution = (perfEvolution?.length ?? 0) > 0;

        const { count } = await supabase
          .from('ai_performance_evolution')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId);

        stats.totalPerformanceRecords = count ?? 0;
      }

      // Check 4: Skill Progression
      const { data: skillData, error: skillError } = await supabase
        .from('ai_skill_progression')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (skillError) {
        console.error('[Health Check] Error checking skill progression:', skillError);
        issues.push('Cannot access ai_skill_progression table');
      } else if (skillData) {
        checks.hasSkillProgression = true;
        stats.skillLevel = skillData.current_skill_level;
        stats.totalTradesAnalyzed = skillData.total_trades_analyzed;
      } else {
        issues.push('No skill progression record found');
        recommendations.push('Run a backtest to initialize skill progression');
      }

      // Check 5: Session Learnings
      const { data: sessionLearnings, error: sessionError } = await supabase
        .from('ai_session_learnings')
        .select('id, session_date', { count: 'exact', head: false })
        .eq('user_id', userId)
        .limit(1);

      if (sessionError) {
        console.error('[Health Check] Error checking session learnings:', sessionError);
        issues.push('Cannot access ai_session_learnings table');
      } else {
        checks.hasSessionLearnings = (sessionLearnings?.length ?? 0) > 0;

        // Check last 7 days
        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        const { count: recentSessions } = await supabase
          .from('ai_session_learnings')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .gte('session_date', weekAgo.toISOString().split('T')[0]);

        stats.sessionsLast7Days = recentSessions ?? 0;
      }

      // Check 6: Recent Activity
      checks.recentLearningActivity = stats.insightsLast24h > 0 || stats.sessionsLast7Days > 0;

      // Analyze results and generate recommendations
      if (!checks.hasLearningInsights && !checks.hasTradeAnalysis) {
        issues.push('No learning data found - system has not learned from any trades yet');
        recommendations.push('Run a backtest or complete a live trade to start learning');
      }

      if (!checks.recentLearningActivity) {
        issues.push('No recent learning activity detected (last 7 days)');
        recommendations.push('Run auto-backtest or manual backtest to generate fresh insights');
      }

      if (stats.totalTradesAnalyzed < 10) {
        recommendations.push('More trades needed for meaningful insights (currently have ' + stats.totalTradesAnalyzed + ')');
      }

      if (stats.insightsLast24h === 0 && stats.totalInsights > 0) {
        recommendations.push('No new insights generated today - consider running more backtests');
      }

      // Determine overall health
      let overall: 'healthy' | 'warning' | 'error' = 'healthy';

      if (!checks.tablesExist) {
        overall = 'error';
      } else if (issues.length > 2 || !checks.recentLearningActivity) {
        overall = 'warning';
      } else if (issues.length > 0) {
        overall = 'warning';
      }

      console.log('[AI Learning Health Check] ✅ Health check complete');
      console.log(`[AI Learning Health Check] Overall status: ${overall.toUpperCase()}`);
      console.log(`[AI Learning Health Check] Issues found: ${issues.length}`);
      console.log(`[AI Learning Health Check] Recommendations: ${recommendations.length}`);

      return {
        overall,
        checks,
        stats,
        issues,
        recommendations
      };

    } catch (error) {
      console.error('[AI Learning Health Check] ❌ Error during health check:', error);
      return {
        overall: 'error',
        checks,
        stats,
        issues: [...issues, 'Unexpected error during health check: ' + (error as Error).message],
        recommendations: ['Check console logs for details', 'Verify database connection']
      };
    }
  }

  /**
   * Get detailed summary of all learning data
   */
  async getLearningDataSummary(userId: string): Promise<LearningDataSummary> {
    console.log('[AI Learning Health Check] 📊 Fetching learning data summary...');

    try {
      // Fetch insights
      const { data: insights, error: insightsError } = await supabase
        .from('ai_learning_insights')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (insightsError) {
        console.error('[Health Check] Error fetching insights:', insightsError);
      }

      const { count: totalInsights } = await supabase
        .from('ai_learning_insights')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      // Count by type
      const { data: insightsByType } = await supabase
        .from('ai_learning_insights')
        .select('insight_type')
        .eq('user_id', userId);

      const byType: Record<string, number> = {};
      insightsByType?.forEach(i => {
        byType[i.insight_type] = (byType[i.insight_type] || 0) + 1;
      });

      // Fetch trade analyses
      const { data: tradeAnalyses } = await supabase
        .from('ai_trade_analysis')
        .select('*')
        .eq('user_id', userId)
        .order('entry_time', { ascending: false })
        .limit(10);

      const { count: totalAnalyses } = await supabase
        .from('ai_trade_analysis')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      // Count by outcome
      const { data: analysesByOutcome } = await supabase
        .from('ai_trade_analysis')
        .select('outcome')
        .eq('user_id', userId);

      const byOutcome = { wins: 0, losses: 0, breakeven: 0 };
      analysesByOutcome?.forEach(a => {
        if (a.outcome === 'win') byOutcome.wins++;
        else if (a.outcome === 'loss') byOutcome.losses++;
        else byOutcome.breakeven++;
      });

      // Fetch skill progression
      const { data: skillData } = await supabase
        .from('ai_skill_progression')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      // Fetch session learnings
      const { data: sessionLearnings } = await supabase
        .from('ai_session_learnings')
        .select('*')
        .eq('user_id', userId)
        .order('session_date', { ascending: false })
        .limit(10);

      const { count: totalSessions } = await supabase
        .from('ai_session_learnings')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      // Fetch performance evolution
      const { data: perfData } = await supabase
        .from('ai_performance_evolution')
        .select('*')
        .eq('user_id', userId)
        .order('measurement_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { count: totalPerf } = await supabase
        .from('ai_performance_evolution')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      console.log('[AI Learning Health Check] ✅ Summary complete');

      return {
        insights: {
          total: totalInsights ?? 0,
          byType,
          recent: insights ?? []
        },
        tradeAnalyses: {
          total: totalAnalyses ?? 0,
          byOutcome,
          recent: tradeAnalyses ?? []
        },
        skillProgression: skillData ? {
          currentLevel: skillData.current_skill_level,
          totalTrades: skillData.total_trades_analyzed,
          winRate: parseFloat(skillData.current_win_rate),
          progressPercent: parseFloat(skillData.progress_to_next_level_percent)
        } : null,
        sessionLearnings: {
          total: totalSessions ?? 0,
          recent: sessionLearnings ?? []
        },
        performanceEvolution: {
          total: totalPerf ?? 0,
          latestMetrics: perfData
        }
      };

    } catch (error) {
      console.error('[AI Learning Health Check] ❌ Error fetching summary:', error);
      throw error;
    }
  }

  /**
   * Verify database triggers are active
   */
  async verifyDatabaseTriggers(): Promise<{
    triggersFound: string[];
    triggersMissing: string[];
    recommendations: string[];
  }> {
    console.log('[AI Learning Health Check] 🔍 Checking database triggers...');

    // We can't directly query pg_trigger from client, but we can test functionality
    // by checking if recent backtests have corresponding learning data

    try {
      // Check if there are any synthetic_backtest_sessions
      const { data: recentSessions, error } = await supabase
        .from('synthetic_backtest_sessions')
        .select('id, session_name, status, completed_at')
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(5);

      if (error) {
        console.error('[Health Check] Error checking sessions:', error);
        return {
          triggersFound: [],
          triggersMissing: ['Cannot verify - table access error'],
          recommendations: ['Check database permissions']
        };
      }

      if (!recentSessions || recentSessions.length === 0) {
        return {
          triggersFound: [],
          triggersMissing: [],
          recommendations: ['No completed backtests found to verify triggers', 'Run a backtest to test the system']
        };
      }

      // Check if these sessions have corresponding learning data
      const triggersFound: string[] = [];
      const triggersMissing: string[] = [];

      for (const session of recentSessions) {
        // Check if there are trade analyses for this session
        const { data: analyses } = await supabase
          .from('ai_trade_analysis')
          .select('id')
          .eq('synthetic_session_id', session.id)
          .limit(1);

        if (analyses && analyses.length > 0) {
          triggersFound.push(`Session "${session.session_name}" has learning data ✓`);
        } else {
          triggersMissing.push(`Session "${session.session_name}" missing learning data ✗`);
        }
      }

      const recommendations: string[] = [];
      if (triggersMissing.length > 0) {
        recommendations.push('Some backtests are not generating learning data');
        recommendations.push('Check if AI learning engine is being called after backtest completion');
        recommendations.push('Verify database triggers are installed');
      } else if (triggersFound.length > 0) {
        recommendations.push('Learning system is working correctly!');
      }

      console.log('[AI Learning Health Check] ✅ Trigger verification complete');

      return {
        triggersFound,
        triggersMissing,
        recommendations
      };

    } catch (error) {
      console.error('[AI Learning Health Check] ❌ Error verifying triggers:', error);
      return {
        triggersFound: [],
        triggersMissing: ['Error during verification'],
        recommendations: ['Check console logs for details']
      };
    }
  }

  /**
   * Test the learning system with a diagnostic check
   */
  async runDiagnosticTest(userId: string): Promise<{
    success: boolean;
    message: string;
    details: any;
  }> {
    console.log('[AI Learning Health Check] 🧪 Running diagnostic test...');

    try {
      // Step 1: Check if user exists
      const { data: userData, error: userError } = await supabase
        .from('user_profiles')
        .select('id, email')
        .eq('id', userId)
        .maybeSingle();

      if (userError || !userData) {
        return {
          success: false,
          message: 'User not found',
          details: { error: userError }
        };
      }

      // Step 2: Run health check
      const health = await this.checkSystemHealth(userId);

      // Step 3: Get data summary
      const summary = await this.getLearningDataSummary(userId);

      // Step 4: Verify triggers
      const triggers = await this.verifyDatabaseTriggers();

      console.log('[AI Learning Health Check] ✅ Diagnostic test complete');

      return {
        success: health.overall !== 'error',
        message: health.overall === 'healthy'
          ? 'AI Learning System is healthy and operational'
          : health.overall === 'warning'
          ? 'AI Learning System has some warnings'
          : 'AI Learning System has errors',
        details: {
          health,
          summary,
          triggers
        }
      };

    } catch (error) {
      console.error('[AI Learning Health Check] ❌ Diagnostic test failed:', error);
      return {
        success: false,
        message: 'Diagnostic test failed: ' + (error as Error).message,
        details: { error }
      };
    }
  }
}

export const aiLearningHealthCheck = new AILearningHealthCheck();
