import { supabase } from '../lib/supabase';

/**
 * AI Data Access Validator
 *
 * Validates that the AI has access to all critical data sources needed for learning.
 * When data is missing or inaccessible, the AI will generate critical warnings
 * explaining what is wrong and how to fix it.
 */

interface ValidationIssue {
  severity: 'critical' | 'warning' | 'info';
  table: string;
  issue: string;
  explanation: string;
  suggestedFix: string;
  errorDetails?: any;
}

interface ValidationResult {
  isHealthy: boolean;
  canLearn: boolean;
  issues: ValidationIssue[];
  checkedAt: Date;
  summary: string;
}

interface DataQualityCheck {
  tableName: string;
  minimumRows?: number;
  maxAgeHours?: number;
  requiredColumns?: string[];
}

class AIDataAccessValidator {
  /**
   * Comprehensive validation of all critical data sources
   */
  async validateDataAccess(userId: string): Promise<ValidationResult> {
    console.log('[AI Data Validator] 🔍 Checking AI data access...');

    const issues: ValidationIssue[] = [];
    const startTime = Date.now();

    // Check critical tables
    await this.checkTradeHistory(userId, issues);
    await this.checkPatternTracking(userId, issues);
    await this.checkPerformanceEvolution(userId, issues);
    await this.checkLearningInsights(userId, issues);
    await this.checkSessionLearnings(userId, issues);
    await this.checkKPITables(userId, issues);

    const criticalIssues = issues.filter(i => i.severity === 'critical');
    const canLearn = criticalIssues.length === 0;
    const isHealthy = issues.length === 0;

    const summary = this.generateSummary(issues, canLearn);

    console.log(`[AI Data Validator] ✓ Validation complete in ${Date.now() - startTime}ms`);
    console.log(`[AI Data Validator] Health: ${isHealthy ? '✅ Healthy' : '⚠️ Issues Found'}`);
    console.log(`[AI Data Validator] Can Learn: ${canLearn ? '✅ Yes' : '🚫 No'}`);

    if (issues.length > 0) {
      console.log(`[AI Data Validator] Issues found:`);
      issues.forEach(issue => {
        console.log(`  ${issue.severity === 'critical' ? '🚨' : '⚠️'} ${issue.table}: ${issue.issue}`);
      });
    }

    return {
      isHealthy,
      canLearn,
      issues,
      checkedAt: new Date(),
      summary
    };
  }

  /**
   * Check trade history access
   */
  private async checkTradeHistory(userId: string, issues: ValidationIssue[]): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('trade_history')
        .select('id, closed_at', { count: 'exact' })
        .eq('user_id', userId)
        .order('closed_at', { ascending: false })
        .limit(1);

      if (error) {
        issues.push({
          severity: 'critical',
          table: 'trade_history',
          issue: 'Cannot access trade history',
          explanation: `Database error: ${error.message}. I need access to trade history to learn from past trades.`,
          suggestedFix: 'Check database permissions and RLS policies for trade_history table.',
          errorDetails: error
        });
        return;
      }

      if (!data || data.length === 0) {
        issues.push({
          severity: 'warning',
          table: 'trade_history',
          issue: 'No trade history available',
          explanation: 'The trade_history table is empty. I have no trades to learn from yet.',
          suggestedFix: 'Run backtests or execute live trades to generate learning data.'
        });
      }
    } catch (error) {
      issues.push({
        severity: 'critical',
        table: 'trade_history',
        issue: 'Exception accessing trade history',
        explanation: `Unexpected error: ${error}. I cannot access the database.`,
        suggestedFix: 'Check database connection and authentication.',
        errorDetails: error
      });
    }
  }

  /**
   * Check pattern tracking access
   */
  private async checkPatternTracking(userId: string, issues: ValidationIssue[]): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('ai_pattern_ev_tracking')
        .select('id', { count: 'exact' })
        .eq('user_id', userId)
        .limit(1);

      if (error) {
        issues.push({
          severity: 'critical',
          table: 'ai_pattern_ev_tracking',
          issue: 'Cannot access pattern tracking',
          explanation: `Database error: ${error.message}. I need this to track which patterns are working.`,
          suggestedFix: 'Check database permissions for ai_pattern_ev_tracking table.',
          errorDetails: error
        });
      }
    } catch (error) {
      issues.push({
        severity: 'critical',
        table: 'ai_pattern_ev_tracking',
        issue: 'Exception accessing pattern tracking',
        explanation: `Unexpected error: ${error}. Pattern discovery will not work.`,
        suggestedFix: 'Verify ai_pattern_ev_tracking table exists and is accessible.',
        errorDetails: error
      });
    }
  }

  /**
   * Check performance evolution access
   */
  private async checkPerformanceEvolution(userId: string, issues: ValidationIssue[]): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('ai_performance_evolution')
        .select('measurement_date', { count: 'exact' })
        .eq('user_id', userId)
        .order('measurement_date', { ascending: false })
        .limit(1);

      if (error) {
        issues.push({
          severity: 'warning',
          table: 'ai_performance_evolution',
          issue: 'Cannot access performance evolution',
          explanation: `Database error: ${error.message}. I cannot track my improvement over time.`,
          suggestedFix: 'Check RLS policies for ai_performance_evolution table.',
          errorDetails: error
        });
      }
    } catch (error) {
      issues.push({
        severity: 'warning',
        table: 'ai_performance_evolution',
        issue: 'Exception accessing performance evolution',
        explanation: `Unexpected error: ${error}. Cannot monitor skill progression.`,
        suggestedFix: 'Verify ai_performance_evolution table is accessible.',
        errorDetails: error
      });
    }
  }

  /**
   * Check learning insights access
   */
  private async checkLearningInsights(userId: string, issues: ValidationIssue[]): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('ai_learning_insights')
        .select('id', { count: 'exact' })
        .eq('user_id', userId)
        .limit(1);

      if (error) {
        issues.push({
          severity: 'critical',
          table: 'ai_learning_insights',
          issue: 'Cannot access learning insights',
          explanation: `Database error: ${error.message}. I cannot store or retrieve what I have learned.`,
          suggestedFix: 'Check permissions for ai_learning_insights table.',
          errorDetails: error
        });
      }
    } catch (error) {
      issues.push({
        severity: 'critical',
        table: 'ai_learning_insights',
        issue: 'Exception accessing learning insights',
        explanation: `Unexpected error: ${error}. My learning system is broken.`,
        suggestedFix: 'Verify ai_learning_insights table exists.',
        errorDetails: error
      });
    }
  }

  /**
   * Check session learnings access
   */
  private async checkSessionLearnings(userId: string, issues: ValidationIssue[]): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('ai_session_learnings')
        .select('session_date', { count: 'exact' })
        .eq('user_id', userId)
        .order('session_date', { ascending: false })
        .limit(1);

      if (error) {
        issues.push({
          severity: 'warning',
          table: 'ai_session_learnings',
          issue: 'Cannot access session learnings',
          explanation: `Database error: ${error.message}. I cannot save daily summaries of what I learned.`,
          suggestedFix: 'Check permissions for ai_session_learnings table.',
          errorDetails: error
        });
      }
    } catch (error) {
      issues.push({
        severity: 'warning',
        table: 'ai_session_learnings',
        issue: 'Exception accessing session learnings',
        explanation: `Unexpected error: ${error}. Cannot create daily learning summaries.`,
        suggestedFix: 'Verify ai_session_learnings table is accessible.',
        errorDetails: error
      });
    }
  }

  /**
   * Check KPI tables access
   */
  private async checkKPITables(userId: string, issues: ValidationIssue[]): Promise<void> {
    const kpiTables = [
      'llm_layer_kpis',
      'continuous_learning_kpis',
      'ai_mastery_kpis'
    ];

    for (const table of kpiTables) {
      try {
        const { error } = await supabase
          .from(table)
          .select('id', { count: 'exact' })
          .eq('user_id', userId)
          .limit(1);

        if (error) {
          issues.push({
            severity: 'info',
            table,
            issue: `Cannot access ${table}`,
            explanation: `Database error: ${error.message}. Some KPI metrics may not be available.`,
            suggestedFix: `Check permissions for ${table} table.`,
            errorDetails: error
          });
        }
      } catch (error) {
        // Info level - KPIs are nice to have but not critical
      }
    }
  }

  /**
   * Check data quality (sufficient sample size)
   */
  async validateDataQuality(userId: string): Promise<ValidationResult> {
    console.log('[AI Data Validator] 📊 Checking data quality...');

    const issues: ValidationIssue[] = [];

    // Check trade count
    try {
      const { count, error } = await supabase
        .from('trade_history')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (!error && count !== null) {
        if (count < 10) {
          issues.push({
            severity: 'warning',
            table: 'trade_history',
            issue: 'Insufficient trade data',
            explanation: `Only ${count} trades available. I need at least 10 trades to make reliable conclusions about patterns.`,
            suggestedFix: 'Run more backtests or wait for more live trades to accumulate.'
          });
        } else if (count < 30) {
          issues.push({
            severity: 'info',
            table: 'trade_history',
            issue: 'Limited trade data',
            explanation: `${count} trades available. Learning will improve significantly with 30+ trades.`,
            suggestedFix: 'Continue trading to build larger sample size.'
          });
        }
      }
    } catch (error) {
      // Already caught in access validation
    }

    // Check data freshness
    try {
      const { data, error } = await supabase
        .from('trade_history')
        .select('closed_at')
        .eq('user_id', userId)
        .order('closed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        const lastTradeTime = new Date(data.closed_at);
        const hoursSinceLastTrade = (Date.now() - lastTradeTime.getTime()) / (1000 * 60 * 60);

        if (hoursSinceLastTrade > 168) { // 7 days
          issues.push({
            severity: 'warning',
            table: 'trade_history',
            issue: 'Stale data - no recent trades',
            explanation: `Last trade was ${Math.floor(hoursSinceLastTrade / 24)} days ago. Am I still running? Without new data, I cannot continue learning.`,
            suggestedFix: 'Check if auto-backtest is running or execute manual trades.'
          });
        }
      }
    } catch (error) {
      // Already caught in access validation
    }

    const summary = this.generateSummary(issues, issues.filter(i => i.severity === 'critical').length === 0);

    return {
      isHealthy: issues.length === 0,
      canLearn: issues.filter(i => i.severity === 'critical').length === 0,
      issues,
      checkedAt: new Date(),
      summary
    };
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(issues: ValidationIssue[], canLearn: boolean): string {
    if (issues.length === 0) {
      return 'All systems operational. I have full access to all data needed for learning.';
    }

    const criticalCount = issues.filter(i => i.severity === 'critical').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;

    if (criticalCount > 0) {
      return `🚨 CRITICAL: ${criticalCount} critical issue(s) preventing me from learning. I am essentially blind right now and cannot improve without fixing these.`;
    }

    if (warningCount > 0) {
      return `⚠️ WARNING: ${warningCount} issue(s) limiting my learning effectiveness. I can still function but not at full capacity.`;
    }

    return `ℹ️ INFO: ${issues.length} minor issue(s) detected. Learning is functional but could be improved.`;
  }

  /**
   * Quick health check (cached for 5 minutes)
   */
  private lastHealthCheck: { result: ValidationResult; timestamp: number } | null = null;

  async quickHealthCheck(userId: string, forceFresh: boolean = false): Promise<ValidationResult> {
    const now = Date.now();
    const cacheValidMs = 5 * 60 * 1000; // 5 minutes

    if (!forceFresh && this.lastHealthCheck && (now - this.lastHealthCheck.timestamp) < cacheValidMs) {
      return this.lastHealthCheck.result;
    }

    const result = await this.validateDataAccess(userId);
    this.lastHealthCheck = { result, timestamp: now };

    return result;
  }
}

export const aiDataAccessValidator = new AIDataAccessValidator();
export type { ValidationResult, ValidationIssue };
