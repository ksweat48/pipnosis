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
   * Determine if violation is a protective block (good) or actual bug (bad)
   *
   * Protective blocks = System correctly preventing bad trades
   * Actual bugs = LLM hallucinations or system errors that need fixing
   */
  private isProtectiveBlock(violationType: string): boolean {
    const protectiveBlocks = [
      'ALPHA_CONSTRAINT_VIOLATION_UNRESOLVED', // System preventing unprofessional R:R
      'EXECUTION_VALIDATION_FAILED', // ValidationGateway catching bad params
      'PRICE_FRESHNESS_BYPASS', // Freshness gate protecting against stale data
    ];
    return protectiveBlocks.includes(violationType);
  }

  private isActualBug(violationType: string): boolean {
    const actualBugs = [
      'ALPHA_TP_WRONG_SIDE', // Alpha hallucinated wrong geometry
      'ALPHA_SL_WRONG_SIDE', // Alpha hallucinated wrong geometry
      'VALIDATION_GATEWAY_BYPASSED', // Something bypassed safety
      'POSITION_SIZE_MISMATCH', // Calculation error
    ];
    return actualBugs.includes(violationType);
  }

  /**
   * Get severity for a violation type
   */
  private getSeverity(violationType: string): 'critical' | 'warning' | 'info' {
    // Actual bugs are critical (need prompt/code fixes)
    if (this.isActualBug(violationType)) {
      return 'critical';
    }

    // Protective blocks are warnings (system working correctly)
    if (this.isProtectiveBlock(violationType)) {
      return 'warning';
    }

    // Everything else is info
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
   *
   * UPDATED: Distinguishes between protective blocks (good) and actual bugs (bad)
   * - Protective blocks: Minimal penalty (system working correctly)
   * - Actual bugs: Heavy penalty (LLM hallucinations, system errors)
   */
  async getPlatformComplianceScore(): Promise<{
    score: number;
    totalViolations: number;
    criticalViolations: number;
    warningViolations: number;
    infoViolations: number;
    protectiveBlocks: number;
    actualBugs: number;
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
          infoViolations: 0,
          protectiveBlocks: 0,
          actualBugs: 0
        };
      }

      let criticalCount = 0;
      let warningCount = 0;
      let infoCount = 0;
      let protectiveBlockCount = 0;
      let actualBugCount = 0;

      data.forEach(v => {
        const severity = this.getSeverity(v.violation_type);
        if (severity === 'critical') criticalCount++;
        else if (severity === 'warning') warningCount++;
        else infoCount++;

        if (this.isProtectiveBlock(v.violation_type)) protectiveBlockCount++;
        if (this.isActualBug(v.violation_type)) actualBugCount++;
      });

      // NEW SCORING: Differentiate protective blocks from bugs
      // Actual bugs (critical): -15 points each (need fixing)
      // Protective blocks (warning): -1 point each (system working)
      // Other warnings: -3 points each
      // Info: -1 point each
      const actualBugPenalty = actualBugCount * 15;
      const protectiveBlockPenalty = protectiveBlockCount * 1;
      const otherWarningPenalty = (warningCount - protectiveBlockCount) * 3;
      const infoPenalty = infoCount * 1;

      const score = Math.max(
        0,
        100 - actualBugPenalty - protectiveBlockPenalty - otherWarningPenalty - infoPenalty
      );

      return {
        score,
        totalViolations: data.length,
        criticalViolations: criticalCount,
        warningViolations: warningCount,
        infoViolations: infoCount,
        protectiveBlocks: protectiveBlockCount,
        actualBugs: actualBugCount
      };
    } catch (error) {
      logger.error(LogCategory.SYSTEM, '[SSOT Analytics] Error in getPlatformComplianceScore', error);
      return {
        score: 100,
        totalViolations: 0,
        criticalViolations: 0,
        warningViolations: 0,
        infoViolations: 0,
        protectiveBlocks: 0,
        actualBugs: 0
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

  /**
   * Get human-readable description for violation type
   */
  getViolationDescription(violationType: string): {
    title: string;
    description: string;
    category: 'protective' | 'bug' | 'other';
  } {
    if (this.isProtectiveBlock(violationType)) {
      const descriptions: Record<string, { title: string; description: string }> = {
        'ALPHA_CONSTRAINT_VIOLATION_UNRESOLVED': {
          title: 'Professional Risk Protection',
          description: 'System prevented trade with unprofessional R:R or infeasible constraints. Alpha declined revision.'
        },
        'EXECUTION_VALIDATION_FAILED': {
          title: 'Validation Gateway Protection',
          description: 'Trade execution blocked due to missing validation. Safety net working correctly.'
        },
        'PRICE_FRESHNESS_BYPASS': {
          title: 'Stale Data Protection',
          description: 'System blocked execution using stale price data. Data integrity check working.'
        }
      };
      return {
        category: 'protective',
        ...(descriptions[violationType] || { title: 'System Protection', description: 'Protective block active' })
      };
    }

    if (this.isActualBug(violationType)) {
      const descriptions: Record<string, { title: string; description: string }> = {
        'ALPHA_TP_WRONG_SIDE': {
          title: 'Alpha Geometry Hallucination (TP)',
          description: 'Alpha placed Take Profit on wrong side of entry. Prompt engineering fix needed.'
        },
        'ALPHA_SL_WRONG_SIDE': {
          title: 'Alpha Geometry Hallucination (SL)',
          description: 'Alpha placed Stop Loss on wrong side of entry. Prompt engineering fix needed.'
        },
        'VALIDATION_GATEWAY_BYPASSED': {
          title: 'Safety Bypass Detected',
          description: 'Code bypassed ValidationGateway. Architecture violation - needs immediate fix.'
        },
        'POSITION_SIZE_MISMATCH': {
          title: 'Position Sizing Error',
          description: 'Position size calculation mismatch detected. Math error needs correction.'
        }
      };
      return {
        category: 'bug',
        ...(descriptions[violationType] || { title: 'System Error', description: 'Bug requiring fix' })
      };
    }

    return {
      category: 'other',
      title: violationType.replace(/_/g, ' '),
      description: 'Informational event'
    };
  }
}

export const ssotAnalyticsService = SSOTAnalyticsService.getInstance();
