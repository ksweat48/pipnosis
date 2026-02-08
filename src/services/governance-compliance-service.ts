/**
 * Governance Compliance Scoring Service
 *
 * Provides compliance metrics, scoring, and trend analysis.
 *
 * Features:
 * - Daily compliance score calculation
 * - Component-level health tracking
 * - Historical trend analysis
 * - Automated report generation
 * - Real-time score updates
 *
 * Part of Phase 3.4: Daily Compliance Scoring
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface ComplianceScore {
  id: string;
  score_date: string;
  platform_score: number;
  platform_grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  critical_violations: number;
  high_violations: number;
  medium_violations: number;
  low_violations: number;
  total_violations: number;
  total_components: number;
  healthy_components: number;
  warning_components: number;
  critical_components: number;
  failing_components: number;
  trend_direction: 'improving' | 'stable' | 'declining';
  trend_velocity: number;
  days_at_current_grade: number;
  calculated_at: string;
  created_at: string;
}

export interface ComponentHealth {
  id: string;
  score_date: string;
  component_name: string;
  health_score: number;
  health_status: 'healthy' | 'warning' | 'critical' | 'failing';
  critical_violations: number;
  high_violations: number;
  medium_violations: number;
  low_violations: number;
  total_violations: number;
  trend_direction: 'improving' | 'stable' | 'declining';
  previous_score: number | null;
  score_change: number | null;
  calculated_at: string;
  created_at: string;
}

export interface ComplianceReport {
  id: string;
  report_type: 'daily' | 'weekly' | 'monthly';
  report_period_start: string;
  report_period_end: string;
  average_score: number;
  highest_score: number;
  lowest_score: number;
  score_range: number;
  score_std_dev: number;
  overall_trend: 'improving' | 'stable' | 'declining';
  total_violations: number;
  resolved_violations: number;
  new_violations: number;
  top_violation_types: any[];
  top_problem_components: any[];
  most_improved_components: any[];
  critical_actions: any[];
  improvement_suggestions: any[];
  report_summary: string;
  report_details: any;
  generated_at: string;
  created_at: string;
}

export interface ComplianceTrendPoint {
  score_date: string;
  platform_score: number;
  platform_grade: string;
  total_violations: number;
  trend_direction: string;
}

export interface ComponentHealthSummary {
  component_name: string;
  current_health_score: number;
  health_status: string;
  total_violations: number;
  trend_direction: string;
  score_change: number;
}

class GovernanceComplianceService {
  /**
   * Get current compliance score (today's score)
   */
  async getCurrentScore(): Promise<ComplianceScore | null> {
    try {
      const { data, error } = await supabase
        .from('governance_compliance_scores')
        .select('*')
        .order('score_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Failed to get current compliance score:', error);
      return null;
    }
  }

  /**
   * Get compliance score for a specific date
   */
  async getScoreByDate(date: string): Promise<ComplianceScore | null> {
    try {
      const { data, error } = await supabase
        .from('governance_compliance_scores')
        .select('*')
        .eq('score_date', date)
        .maybeSingle();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Failed to get compliance score by date:', error);
      return null;
    }
  }

  /**
   * Get compliance trend data for charting
   */
  async getComplianceTrend(days: number = 30): Promise<ComplianceTrendPoint[]> {
    try {
      const { data, error } = await supabase
        .rpc('get_compliance_trend', { p_days_back: days });

      if (error) throw error;
      return data || [];
    } catch (error) {
      logger.error('Failed to get compliance trend:', error);
      return [];
    }
  }

  /**
   * Get current component health summary
   */
  async getComponentHealthSummary(): Promise<ComponentHealthSummary[]> {
    try {
      const { data, error } = await supabase
        .rpc('get_component_health_summary');

      if (error) throw error;
      return data || [];
    } catch (error) {
      logger.error('Failed to get component health summary:', error);
      return [];
    }
  }

  /**
   * Get component health for a specific date
   */
  async getComponentHealthByDate(date: string): Promise<ComponentHealth[]> {
    try {
      const { data, error } = await supabase
        .from('governance_component_health')
        .select('*')
        .eq('score_date', date)
        .order('health_score', { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (error) {
      logger.error('Failed to get component health by date:', error);
      return [];
    }
  }

  /**
   * Get component health history for a specific component
   */
  async getComponentHistory(componentName: string, days: number = 30): Promise<ComponentHealth[]> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await supabase
        .from('governance_component_health')
        .select('*')
        .eq('component_name', componentName)
        .gte('score_date', startDate.toISOString().split('T')[0])
        .order('score_date', { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (error) {
      logger.error('Failed to get component history:', error);
      return [];
    }
  }

  /**
   * Calculate daily compliance score (trigger database function)
   */
  async calculateDailyScore(date?: string): Promise<string | null> {
    try {
      const scoreDate = date || new Date().toISOString().split('T')[0];

      const { data, error } = await supabase
        .rpc('calculate_daily_compliance_score', {
          p_score_date: scoreDate
        });

      if (error) throw error;

      logger.info('Daily compliance score calculated:', { date: scoreDate, id: data });
      return data;
    } catch (error) {
      logger.error('Failed to calculate daily compliance score:', error);
      return null;
    }
  }

  /**
   * Generate weekly compliance report
   */
  async generateWeeklyReport(startDate?: string, endDate?: string): Promise<string | null> {
    try {
      const end = endDate || new Date().toISOString().split('T')[0];
      const start = startDate || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        return d.toISOString().split('T')[0];
      })();

      const { data, error } = await supabase
        .rpc('generate_weekly_compliance_report', {
          p_period_start: start,
          p_period_end: end
        });

      if (error) throw error;

      logger.info('Weekly compliance report generated:', { start, end, id: data });
      return data;
    } catch (error) {
      logger.error('Failed to generate weekly report:', error);
      return null;
    }
  }

  /**
   * Get all compliance reports
   */
  async getReports(type?: 'daily' | 'weekly' | 'monthly', limit: number = 10): Promise<ComplianceReport[]> {
    try {
      let query = supabase
        .from('governance_compliance_reports')
        .select('*')
        .order('generated_at', { ascending: false })
        .limit(limit);

      if (type) {
        query = query.eq('report_type', type);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data || [];
    } catch (error) {
      logger.error('Failed to get compliance reports:', error);
      return [];
    }
  }

  /**
   * Get report by ID
   */
  async getReportById(id: string): Promise<ComplianceReport | null> {
    try {
      const { data, error } = await supabase
        .from('governance_compliance_reports')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      return data;
    } catch (error) {
      logger.error('Failed to get report by ID:', error);
      return null;
    }
  }

  /**
   * Get grade color for UI display
   */
  getGradeColor(grade: string): string {
    switch (grade) {
      case 'A+':
      case 'A':
        return 'text-green-600 bg-green-100';
      case 'B':
        return 'text-blue-600 bg-blue-100';
      case 'C':
        return 'text-yellow-600 bg-yellow-100';
      case 'D':
        return 'text-orange-600 bg-orange-100';
      case 'F':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  }

  /**
   * Get health status color for UI display
   */
  getHealthStatusColor(status: string): string {
    switch (status) {
      case 'healthy':
        return 'text-green-600 bg-green-100';
      case 'warning':
        return 'text-yellow-600 bg-yellow-100';
      case 'critical':
        return 'text-orange-600 bg-orange-100';
      case 'failing':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  }

  /**
   * Get trend icon for UI display
   */
  getTrendIcon(direction: string): string {
    switch (direction) {
      case 'improving':
        return '📈';
      case 'declining':
        return '📉';
      case 'stable':
        return '➡️';
      default:
        return '—';
    }
  }

  /**
   * Format score for display
   */
  formatScore(score: number): string {
    return score.toFixed(1);
  }

  /**
   * Get compliance summary statistics
   */
  async getComplianceSummary(): Promise<{
    current: ComplianceScore | null;
    trend: ComplianceTrendPoint[];
    components: ComponentHealthSummary[];
    averageScore30Days: number;
    improvement30Days: number;
  }> {
    try {
      const [current, trend, components] = await Promise.all([
        this.getCurrentScore(),
        this.getComplianceTrend(30),
        this.getComponentHealthSummary()
      ]);

      // Calculate 30-day average
      const averageScore30Days = trend.length > 0
        ? trend.reduce((sum, point) => sum + point.platform_score, 0) / trend.length
        : 0;

      // Calculate improvement over 30 days
      const improvement30Days = trend.length > 1
        ? trend[trend.length - 1].platform_score - trend[0].platform_score
        : 0;

      return {
        current,
        trend,
        components,
        averageScore30Days,
        improvement30Days
      };
    } catch (error) {
      logger.error('Failed to get compliance summary:', error);
      return {
        current: null,
        trend: [],
        components: [],
        averageScore30Days: 0,
        improvement30Days: 0
      };
    }
  }

  /**
   * Subscribe to compliance score updates
   */
  subscribeToScores(callback: (score: ComplianceScore) => void) {
    return supabase
      .channel('compliance_scores_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'governance_compliance_scores'
        },
        (payload) => {
          if (payload.new) {
            callback(payload.new as ComplianceScore);
          }
        }
      )
      .subscribe();
  }

  /**
   * Subscribe to component health updates
   */
  subscribeToComponentHealth(callback: (health: ComponentHealth) => void) {
    return supabase
      .channel('component_health_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'governance_component_health'
        },
        (payload) => {
          if (payload.new) {
            callback(payload.new as ComponentHealth);
          }
        }
      )
      .subscribe();
  }

  /**
   * Backfill historical scores (for initial setup)
   */
  async backfillScores(days: number = 30): Promise<number> {
    try {
      let successCount = 0;
      const today = new Date();

      for (let i = days; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateString = date.toISOString().split('T')[0];

        const result = await this.calculateDailyScore(dateString);
        if (result) {
          successCount++;
        }

        // Small delay to avoid overwhelming the database
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      logger.info(`Backfilled ${successCount} days of compliance scores`);
      return successCount;
    } catch (error) {
      logger.error('Failed to backfill scores:', error);
      return 0;
    }
  }

  /**
   * Get compliance insights (AI-style recommendations)
   */
  async getComplianceInsights(): Promise<{
    strengths: string[];
    concerns: string[];
    recommendations: string[];
  }> {
    try {
      const summary = await this.getComplianceSummary();

      const strengths: string[] = [];
      const concerns: string[] = [];
      const recommendations: string[] = [];

      if (!summary.current) {
        return { strengths, concerns, recommendations };
      }

      // Analyze current score
      if (summary.current.platform_score >= 90) {
        strengths.push('Excellent overall compliance score');
      } else if (summary.current.platform_score >= 80) {
        strengths.push('Good compliance posture');
      } else if (summary.current.platform_score < 70) {
        concerns.push('Below-target compliance score');
        recommendations.push('Focus on reducing critical violations');
      }

      // Analyze trend
      if (summary.current.trend_direction === 'improving') {
        strengths.push('Compliance score is improving');
      } else if (summary.current.trend_direction === 'declining') {
        concerns.push('Compliance score is declining');
        recommendations.push('Review recent changes that may have introduced violations');
      }

      // Analyze violations
      if (summary.current.critical_violations > 0) {
        concerns.push(`${summary.current.critical_violations} critical violations detected`);
        recommendations.push('Address critical violations immediately');
      }

      // Analyze components
      const failingComponents = summary.components.filter(c => c.health_status === 'failing');
      if (failingComponents.length > 0) {
        concerns.push(`${failingComponents.length} components in failing status`);
        recommendations.push(`Focus on: ${failingComponents.slice(0, 3).map(c => c.component_name).join(', ')}`);
      }

      const healthyComponents = summary.components.filter(c => c.health_status === 'healthy');
      if (healthyComponents.length > 0) {
        strengths.push(`${healthyComponents.length} components are healthy`);
      }

      // 30-day improvement
      if (summary.improvement30Days > 10) {
        strengths.push('Significant improvement over last 30 days');
      } else if (summary.improvement30Days < -10) {
        concerns.push('Declining trend over last 30 days');
        recommendations.push('Conduct architectural review to identify root causes');
      }

      return { strengths, concerns, recommendations };
    } catch (error) {
      logger.error('Failed to get compliance insights:', error);
      return { strengths: [], concerns: [], recommendations: [] };
    }
  }
}

// Export singleton instance
export const governanceComplianceService = new GovernanceComplianceService();
