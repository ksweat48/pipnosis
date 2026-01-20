/**
 * SSOT Analytics Service
 *
 * Aggregates and analyzes SSOT violation data for dashboard and monitoring.
 * Part of Phase 3: Governance Enforcement
 */

import { supabase } from '../lib/supabase';
import { logger, LogCategory } from '../lib/logger';

export interface SSOTViolation {
  id: string;
  violation_type: string;
  severity: 'critical' | 'warning' | 'info';
  component: string;
  details: Record<string, any>;
  user_id: string | null;
  session_id: string | null;
  created_at: string;
}

export interface ViolationSummary {
  type: string;
  count: number;
  lastSeen: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface ViolationTrend {
  date: string;
  count: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}

export interface ComponentHealth {
  component: string;
  violationCount: number;
  healthScore: number; // 0-100
  lastViolation: string | null;
}

class SSOTAnalyticsService {
  private static instance: SSOTAnalyticsService;

  private constructor() {}

  static getInstance(): SSOTAnalyticsService {
    if (!SSOTAnalyticsService.instance) {
      SSOTAnalyticsService.instance = new SSOTAnalyticsService();
    }
    return SSOTAnalyticsService.instance;
  }

  /**
   * Get severity for a violation type
   */
  private getSeverity(violationType: string): 'critical' | 'warning' | 'info' {
    const criticalViolations = [
      'POSITION_SIZE_MISMATCH',
      'ALPHA_CONSTRAINT_VIOLATION_UNRESOLVED',
      'VALIDATION_GATEWAY_BYPASSED',
      'PRICE_FRESHNESS_BYPASS',
      'ALPHA_TP_WRONG_SIDE',
      'ALPHA_SL_WRONG_SIDE'
    ];

    const warningViolations = [
      'EXECUTION_VALIDATION_FAILED',
      'DUPLICATE_LOGIC_DETECTED',
      'DEPRECATED_PATTERN_USED'
    ];

    if (criticalViolations.includes(violationType)) {
      return 'critical';
    } else if (warningViolations.includes(violationType)) {
      return 'warning';
    }
    return 'info';
  }

  /**
   * Get recent violations (last 24 hours)
   */
  async getRecentViolations(limit: number = 50): Promise<SSOTViolation[]> {
    try {
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      const { data, error } = await supabase
        .from('ssot_violations')
        .select('*')
        .gte('created_at', twentyFourHoursAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        logger.error(LogCategory.SYSTEM, '[SSOT Analytics] Failed to fetch recent violations', error);
        return [];
      }

      return (data || []).map(v => ({
        ...v,
        severity: this.getSeverity(v.violation_type)
      }));
    } catch (error) {
      logger.error(LogCategory.SYSTEM, '[SSOT Analytics] Error in getRecentViolations', error);
      return [];
    }
  }

  /**
   * Get violation summary by type (last 7 days)
   */
  async getViolationSummary(): Promise<ViolationSummary[]> {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data, error } = await supabase
        .from('ssot_violations')
        .select('violation_type, created_at')
        .gte('created_at', sevenDaysAgo.toISOString());

      if (error || !data) {
        logger.error(LogCategory.SYSTEM, '[SSOT Analytics] Failed to fetch violation summary', error);
        return [];
      }

      const summary = new Map<string, { count: number; lastSeen: string }>();

      data.forEach(v => {
        const existing = summary.get(v.violation_type);
        if (!existing) {
          summary.set(v.violation_type, { count: 1, lastSeen: v.created_at });
        } else {
          existing.count++;
          if (new Date(v.created_at) > new Date(existing.lastSeen)) {
            existing.lastSeen = v.created_at;
          }
        }
      });

      return Array.from(summary.entries())
        .map(([type, stats]) => ({
          type,
          count: stats.count,
          lastSeen: stats.lastSeen,
          severity: this.getSeverity(type)
        }))
        .sort((a, b) => b.count - a.count);
    } catch (error) {
      logger.error(LogCategory.SYSTEM, '[SSOT Analytics] Error in getViolationSummary', error);
      return [];
    }
  }

  /**
   * Get violation trends (daily counts for last 30 days)
   */
  async getViolationTrends(): Promise<ViolationTrend[]> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data, error } = await supabase
        .from('ssot_violations')
        .select('violation_type, created_at')
        .gte('created_at', thirtyDaysAgo.toISOString())
        .order('created_at', { ascending: true });

      if (error || !data) {
        logger.error(LogCategory.SYSTEM, '[SSOT Analytics] Failed to fetch violation trends', error);
        return [];
      }

      const dailyCounts = new Map<string, ViolationTrend>();

      data.forEach(v => {
        const date = new Date(v.created_at).toISOString().split('T')[0];
        const severity = this.getSeverity(v.violation_type);

        if (!dailyCounts.has(date)) {
          dailyCounts.set(date, {
            date,
            count: 0,
            criticalCount: 0,
            warningCount: 0,
            infoCount: 0
          });
        }

        const dayData = dailyCounts.get(date)!;
        dayData.count++;
        if (severity === 'critical') dayData.criticalCount++;
        else if (severity === 'warning') dayData.warningCount++;
        else dayData.infoCount++;
      });

      return Array.from(dailyCounts.values()).sort((a, b) =>
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
    } catch (error) {
      logger.error(LogCategory.SYSTEM, '[SSOT Analytics] Error in getViolationTrends', error);
      return [];
    }
  }

  /**
   * Get component health scores
   */
  async getComponentHealth(): Promise<ComponentHealth[]> {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data, error } = await supabase
        .from('ssot_violations')
        .select('component, violation_type, created_at')
        .gte('created_at', sevenDaysAgo.toISOString());

      if (error || !data) {
        logger.error(LogCategory.SYSTEM, '[SSOT Analytics] Failed to fetch component health', error);
        return [];
      }

      const componentStats = new Map<string, { violations: number; lastViolation: string; criticalCount: number }>();

      data.forEach(v => {
        const component = v.component || 'unknown';
        const existing = componentStats.get(component);
        const severity = this.getSeverity(v.violation_type);

        if (!existing) {
          componentStats.set(component, {
            violations: 1,
            lastViolation: v.created_at,
            criticalCount: severity === 'critical' ? 1 : 0
          });
        } else {
          existing.violations++;
          if (severity === 'critical') existing.criticalCount++;
          if (new Date(v.created_at) > new Date(existing.lastViolation)) {
            existing.lastViolation = v.created_at;
          }
        }
      });

      return Array.from(componentStats.entries())
        .map(([component, stats]) => {
          // Health score formula:
          // Start with 100, deduct 10 per critical violation, 3 per other violation
          // Minimum 0, maximum 100
          const score = Math.max(
            0,
            Math.min(
              100,
              100 - (stats.criticalCount * 10) - ((stats.violations - stats.criticalCount) * 3)
            )
          );

          return {
            component,
            violationCount: stats.violations,
            healthScore: score,
            lastViolation: stats.lastViolation
          };
        })
        .sort((a, b) => a.healthScore - b.healthScore); // Worst health first
    } catch (error) {
      logger.error(LogCategory.SYSTEM, '[SSOT Analytics] Error in getComponentHealth', error);
      return [];
    }
  }

  /**
   * Get overall platform compliance score (0-100)
   */
  async getPlatformComplianceScore(): Promise<{
    score: number;
    totalViolations: number;
    criticalViolations: number;
    warningViolations: number;
    infoViolations: number;
  }> {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data, error } = await supabase
        .from('ssot_violations')
        .select('violation_type')
        .gte('created_at', sevenDaysAgo.toISOString());

      if (error || !data) {
        return {
          score: 100,
          totalViolations: 0,
          criticalViolations: 0,
          warningViolations: 0,
          infoViolations: 0
        };
      }

      let criticalCount = 0;
      let warningCount = 0;
      let infoCount = 0;

      data.forEach(v => {
        const severity = this.getSeverity(v.violation_type);
        if (severity === 'critical') criticalCount++;
        else if (severity === 'warning') warningCount++;
        else infoCount++;
      });

      // Score calculation: Start with 100, deduct for violations
      // Critical: -10 points each
      // Warning: -3 points each
      // Info: -1 point each
      const score = Math.max(
        0,
        100 - (criticalCount * 10) - (warningCount * 3) - infoCount
      );

      return {
        score,
        totalViolations: data.length,
        criticalViolations: criticalCount,
        warningViolations: warningCount,
        infoViolations: infoCount
      };
    } catch (error) {
      logger.error(LogCategory.SYSTEM, '[SSOT Analytics] Error in getPlatformComplianceScore', error);
      return {
        score: 100,
        totalViolations: 0,
        criticalViolations: 0,
        warningViolations: 0,
        infoViolations: 0
      };
    }
  }

  /**
   * Subscribe to real-time violation updates
   */
  subscribeToViolations(callback: (violation: SSOTViolation) => void) {
    const channel = supabase
      .channel('ssot_violations_realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ssot_violations'
        },
        (payload) => {
          const violation = payload.new as any;
          callback({
            ...violation,
            severity: this.getSeverity(violation.violation_type)
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  /**
   * Get violation details by ID
   */
  async getViolationDetails(id: string): Promise<SSOTViolation | null> {
    try {
      const { data, error } = await supabase
        .from('ssot_violations')
        .select('*')
        .eq('id', id)
        .single();

      if (error || !data) {
        logger.error(LogCategory.SYSTEM, `[SSOT Analytics] Failed to fetch violation ${id}`, error);
        return null;
      }

      return {
        ...data,
        severity: this.getSeverity(data.violation_type)
      };
    } catch (error) {
      logger.error(LogCategory.SYSTEM, '[SSOT Analytics] Error in getViolationDetails', error);
      return null;
    }
  }
}

export const ssotAnalyticsService = SSOTAnalyticsService.getInstance();
