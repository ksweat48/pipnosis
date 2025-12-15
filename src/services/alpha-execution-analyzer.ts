/**
 * Alpha Execution Quality Analyzer
 *
 * Analyzes execution quality patterns and provides intelligence to Alpha about:
 * - Stop-loss hunting patterns by symbol/session
 * - Slippage patterns and prediction
 * - Spread behavior analysis
 * - Rejection patterns
 * - Broker behavior classification
 *
 * This helps Alpha adjust entry timing, SL placement, and symbol selection
 * based on actual execution experience rather than assumptions.
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface ExecutionQualityReport {
  symbol: string;
  session?: string;
  totalExecutions: number;
  avgSlippagePips: number;
  slHuntingRate: number; // % of trades where SL hunting suspected
  avgSpreadAtEntry: number;
  avgSpreadAtExit: number;
  rejectionRate: number;
  qualityScore: number; // 0-100, higher is better
  recommendations: string[];
  brokerBehaviorClassification: 'excellent' | 'good' | 'fair' | 'poor' | 'hostile';
}

export interface SlHuntingPattern {
  symbol: string;
  sessions: string[];
  huntingRate: number;
  avgDistanceFromSL: number; // How close to SL before reversal
  confidence: number; // 0-100
  recommendation: string;
}

export interface SlippagePattern {
  symbol: string;
  session: string;
  avgSlippagePips: number;
  maxSlippagePips: number;
  volatilityAdjusted: boolean;
  recommendation: string;
}

export class AlphaExecutionAnalyzer {
  /**
   * Get execution quality report for a symbol
   */
  async getExecutionQualityReport(
    userId: string,
    symbol: string,
    session?: string
  ): Promise<ExecutionQualityReport> {
    try {
      let query = supabase
        .from('execution_quality_log')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol);

      if (session) {
        query = query.eq('session', session);
      }

      const { data: executions } = await query.limit(100);

      if (!executions || executions.length === 0) {
        return this.getDefaultReport(symbol, session);
      }

      // Calculate metrics
      const totalExecutions = executions.length;
      const avgSlippagePips = executions.reduce((sum, e) => sum + (e.slippage_pips || 0), 0) / totalExecutions;
      const slHuntingCount = executions.filter(e => e.sl_hunting_suspected).length;
      const slHuntingRate = (slHuntingCount / totalExecutions) * 100;

      const executionsWithSpread = executions.filter(e => e.spread_at_entry && e.spread_at_entry > 0);
      const avgSpreadAtEntry = executionsWithSpread.length > 0
        ? executionsWithSpread.reduce((sum, e) => sum + (e.spread_at_entry || 0), 0) / executionsWithSpread.length
        : 0;

      const exitSpreads = executions.filter(e => e.spread_at_exit && e.spread_at_exit > 0);
      const avgSpreadAtExit = exitSpreads.length > 0
        ? exitSpreads.reduce((sum, e) => sum + (e.spread_at_exit || 0), 0) / exitSpreads.length
        : 0;

      const rejectionCount = executions.filter(e => e.rejection_occurred).length;
      const rejectionRate = (rejectionCount / totalExecutions) * 100;

      // Calculate quality score (0-100)
      const qualityScore = this.calculateQualityScore(
        avgSlippagePips,
        slHuntingRate,
        rejectionRate,
        avgSpreadAtEntry
      );

      // Generate recommendations
      const recommendations = this.generateRecommendations(
        avgSlippagePips,
        slHuntingRate,
        rejectionRate,
        avgSpreadAtEntry,
        symbol
      );

      // Classify broker behavior
      const brokerBehaviorClassification = this.classifyBrokerBehavior(
        slHuntingRate,
        avgSlippagePips,
        rejectionRate
      );

      return {
        symbol,
        session,
        totalExecutions,
        avgSlippagePips,
        slHuntingRate,
        avgSpreadAtEntry,
        avgSpreadAtExit,
        rejectionRate,
        qualityScore,
        recommendations,
        brokerBehaviorClassification
      };
    } catch (error) {
      logger.error('[Alpha Execution] Failed to get execution quality report:', error);
      return this.getDefaultReport(symbol, session);
    }
  }

  /**
   * Detect stop-loss hunting patterns
   */
  async detectSLHuntingPatterns(userId: string, symbol?: string): Promise<SlHuntingPattern[]> {
    try {
      let query = supabase
        .from('execution_quality_log')
        .select('*')
        .eq('user_id', userId)
        .eq('sl_hunting_suspected', true);

      if (symbol) {
        query = query.eq('symbol', symbol);
      }

      const { data: huntingCases } = await query.limit(200);

      if (!huntingCases || huntingCases.length === 0) {
        return [];
      }

      // Group by symbol
      const bySymbol = huntingCases.reduce((acc, exec) => {
        if (!acc[exec.symbol]) {
          acc[exec.symbol] = [];
        }
        acc[exec.symbol].push(exec);
        return {};
      }, {} as Record<string, any[]>);

      const patterns: SlHuntingPattern[] = [];

      for (const [sym, cases] of Object.entries(bySymbol)) {
        const sessions = Array.from(new Set(cases.map(c => c.session)));
        const totalExecutions = cases.length;

        // Get total executions for this symbol to calculate rate
        const { count } = await supabase
          .from('execution_quality_log')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('symbol', sym);

        const huntingRate = count ? (totalExecutions / count) * 100 : 0;

        // Calculate average distance from SL when hunting occurred
        const casesWithDistance = cases.filter(c => c.actual_sl_hit && c.expected_sl);
        const avgDistance = casesWithDistance.length > 0
          ? casesWithDistance.reduce((sum, c) =>
              sum + Math.abs((c.actual_sl_hit - c.expected_sl) / c.expected_sl * 10000), 0
            ) / casesWithDistance.length
          : 0;

        // Calculate confidence (higher rate + more samples = higher confidence)
        const confidence = Math.min(95, (huntingRate * 0.5) + (Math.min(totalExecutions, 50) * 0.5));

        // Generate recommendation
        const recommendation = huntingRate > 30
          ? `High SL hunting risk on ${sym}. Consider wider stops (${avgDistance.toFixed(1)} pips buffer) or avoid during ${sessions.join(', ')}.`
          : `Moderate SL hunting detected on ${sym}. Monitor ${sessions.join(', ')} sessions.`;

        patterns.push({
          symbol: sym,
          sessions,
          huntingRate,
          avgDistanceFromSL: avgDistance,
          confidence,
          recommendation
        });
      }

      // Sort by hunting rate (descending)
      return patterns.sort((a, b) => b.huntingRate - a.huntingRate);
    } catch (error) {
      logger.error('[Alpha Execution] Failed to detect SL hunting patterns:', error);
      return [];
    }
  }

  /**
   * Analyze slippage patterns
   */
  async analyzeSlippagePatterns(
    userId: string,
    symbol?: string
  ): Promise<SlippagePattern[]> {
    try {
      let query = supabase
        .from('execution_quality_log')
        .select('*')
        .eq('user_id', userId);

      if (symbol) {
        query = query.eq('symbol', symbol);
      }

      const { data: executions } = await query.limit(200);

      if (!executions || executions.length === 0) {
        return [];
      }

      // Group by symbol and session
      const grouped = executions.reduce((acc, exec) => {
        const key = `${exec.symbol}_${exec.session}`;
        if (!acc[key]) {
          acc[key] = {
            symbol: exec.symbol,
            session: exec.session,
            slippages: []
          };
        }
        if (exec.slippage_pips) {
          acc[key].slippages.push(exec.slippage_pips);
        }
        return acc;
      }, {} as Record<string, any>);

      const patterns: SlippagePattern[] = [];

      for (const group of Object.values(grouped)) {
        if (group.slippages.length < 5) continue; // Need minimum data

        const avgSlippage = group.slippages.reduce((sum: number, s: number) => sum + s, 0) / group.slippages.length;
        const maxSlippage = Math.max(...group.slippages);

        // Generate recommendation
        let recommendation = '';
        if (avgSlippage > 2) {
          recommendation = `High avg slippage (${avgSlippage.toFixed(1)} pips) on ${group.symbol} during ${group.session}. Consider limit orders or avoid.`;
        } else if (maxSlippage > 5) {
          recommendation = `Occasional extreme slippage (up to ${maxSlippage.toFixed(1)} pips) on ${group.symbol} during ${group.session}. Monitor volatility.`;
        } else {
          recommendation = `Acceptable slippage (${avgSlippage.toFixed(1)} pips avg) on ${group.symbol} during ${group.session}.`;
        }

        patterns.push({
          symbol: group.symbol,
          session: group.session,
          avgSlippagePips: avgSlippage,
          maxSlippagePips: maxSlippage,
          volatilityAdjusted: false, // TODO: Implement volatility adjustment
          recommendation
        });
      }

      // Sort by avg slippage (descending)
      return patterns.sort((a, b) => b.avgSlippagePips - a.avgSlippagePips);
    } catch (error) {
      logger.error('[Alpha Execution] Failed to analyze slippage patterns:', error);
      return [];
    }
  }

  /**
   * Get execution intelligence for Alpha's decision-making
   */
  async getExecutionIntelligence(
    userId: string,
    symbol: string,
    session: string
  ): Promise<string> {
    try {
      const report = await this.getExecutionQualityReport(userId, symbol, session);
      const huntingPatterns = await this.detectSLHuntingPatterns(userId, symbol);
      const slippagePatterns = await this.analyzeSlippagePatterns(userId, symbol);

      const parts: string[] = [];

      // Quality overview
      parts.push(`Execution Quality: ${report.qualityScore}/100 (${report.brokerBehaviorClassification})`);

      // SL hunting warning
      if (report.slHuntingRate > 20) {
        const pattern = huntingPatterns.find(p => p.symbol === symbol);
        if (pattern) {
          parts.push(`⚠️ SL Hunting: ${report.slHuntingRate.toFixed(0)}% rate, add ${pattern.avgDistanceFromSL.toFixed(1)} pips buffer`);
        }
      }

      // Slippage warning
      if (report.avgSlippagePips > 1.5) {
        parts.push(`⚠️ Slippage: ${report.avgSlippagePips.toFixed(1)} pips avg, adjust TP expectations`);
      }

      // Rejection warning
      if (report.rejectionRate > 10) {
        parts.push(`⚠️ Rejections: ${report.rejectionRate.toFixed(0)}% rate, verify broker connection`);
      }

      // Recommendations
      if (report.recommendations.length > 0) {
        parts.push(`Recommendations: ${report.recommendations.slice(0, 2).join('; ')}`);
      }

      return parts.join(' | ');
    } catch (error) {
      logger.error('[Alpha Execution] Failed to get execution intelligence:', error);
      return 'Execution intelligence unavailable';
    }
  }

  /**
   * Calculate quality score (0-100)
   */
  private calculateQualityScore(
    avgSlippage: number,
    slHuntingRate: number,
    rejectionRate: number,
    avgSpread: number
  ): number {
    let score = 100;

    // Penalize for slippage
    score -= Math.min(30, avgSlippage * 5);

    // Penalize for SL hunting
    score -= Math.min(40, slHuntingRate);

    // Penalize for rejections
    score -= Math.min(20, rejectionRate * 2);

    // Penalize for wide spreads
    score -= Math.min(10, avgSpread * 2);

    return Math.max(0, Math.round(score));
  }

  /**
   * Generate recommendations based on execution metrics
   */
  private generateRecommendations(
    avgSlippage: number,
    slHuntingRate: number,
    rejectionRate: number,
    avgSpread: number,
    symbol: string
  ): string[] {
    const recommendations: string[] = [];

    if (avgSlippage > 2) {
      recommendations.push(`Use limit orders for ${symbol} to reduce ${avgSlippage.toFixed(1)} pip slippage`);
    }

    if (slHuntingRate > 20) {
      recommendations.push(`Add ${(slHuntingRate / 10).toFixed(1)} pip buffer to stops due to ${slHuntingRate.toFixed(0)}% hunting rate`);
    }

    if (rejectionRate > 10) {
      recommendations.push(`Check broker connection - ${rejectionRate.toFixed(0)}% rejection rate is high`);
    }

    if (avgSpread > 2) {
      recommendations.push(`Wide spread (${avgSpread.toFixed(1)} pips) - consider trading during tighter sessions`);
    }

    if (recommendations.length === 0) {
      recommendations.push(`Good execution quality on ${symbol} - no adjustments needed`);
    }

    return recommendations;
  }

  /**
   * Classify broker behavior
   */
  private classifyBrokerBehavior(
    slHuntingRate: number,
    avgSlippage: number,
    rejectionRate: number
  ): 'excellent' | 'good' | 'fair' | 'poor' | 'hostile' {
    // Hostile: High SL hunting + high slippage + high rejections
    if (slHuntingRate > 30 && avgSlippage > 2 && rejectionRate > 15) {
      return 'hostile';
    }

    // Poor: High in any two categories
    if ((slHuntingRate > 25 && avgSlippage > 2) ||
        (slHuntingRate > 25 && rejectionRate > 10) ||
        (avgSlippage > 2.5 && rejectionRate > 10)) {
      return 'poor';
    }

    // Fair: High in one category
    if (slHuntingRate > 20 || avgSlippage > 1.5 || rejectionRate > 8) {
      return 'fair';
    }

    // Good: Low in all categories
    if (slHuntingRate < 10 && avgSlippage < 1 && rejectionRate < 5) {
      return 'good';
    }

    // Excellent: Very low in all categories
    if (slHuntingRate < 5 && avgSlippage < 0.5 && rejectionRate < 2) {
      return 'excellent';
    }

    return 'good';
  }

  /**
   * Get default report when no data available
   */
  private getDefaultReport(symbol: string, session?: string): ExecutionQualityReport {
    return {
      symbol,
      session,
      totalExecutions: 0,
      avgSlippagePips: 0,
      slHuntingRate: 0,
      avgSpreadAtEntry: 0,
      avgSpreadAtExit: 0,
      rejectionRate: 0,
      qualityScore: 100,
      recommendations: ['No execution data yet - will track quality as you trade'],
      brokerBehaviorClassification: 'good'
    };
  }
}

export const alphaExecutionAnalyzer = new AlphaExecutionAnalyzer();
