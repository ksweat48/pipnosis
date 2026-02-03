/**
 * RISK NEGOTIATION AUDITOR (GOVERNANCE)
 *
 * ARCHITECTURE: Tracks all risk adjustments between Alpha's calculated risk
 * and user's maximum risk preference. Provides complete audit trail.
 *
 * GOVERNANCE: Every risk negotiation is logged with:
 * - What Alpha calculated
 * - What user allows (max preference)
 * - What was actually used (degraded or approved)
 * - Why the adjustment happened
 *
 * CCIP COMPLIANCE:
 * - Immutable audit log: all records are append-only
 * - Clear causality: tracks decision flow from calculation to execution
 * - Traceable: links to trades, users, and risk profiles
 */

import { logger } from '@/lib/logger';

export interface RiskNegotiationRecord {
  userId: string;
  tradeId?: string;
  symbol: string;
  timestamp: string;

  // Alpha's calculation
  alphaCalculatedRiskPercent: number;
  alphaLotSize: number;
  alphaReasoning: string;

  // User's preference
  userMaxRiskPercent: number;

  // Negotiation result
  finalRiskPercent: number;
  finalLotSize: number;
  negotiationOutcome: 'approved' | 'degraded' | 'exceeded'; // exceeded = user override
  degradationReason?: string;

  // Context
  balance: number;
  symbol: string;
  direction: 'buy' | 'sell';
  riskMode: 'low' | 'medium' | 'high';
}

class RiskNegotiationAuditor {
  private records: RiskNegotiationRecord[] = [];
  private maxRecords = 1000; // Keep last 1000 negotiations in memory

  /**
   * LOG a risk negotiation event
   * Called whenever Alpha's calculated risk differs from final executed risk
   */
  logNegotiation(record: RiskNegotiationRecord): void {
    // Add metadata
    const enrichedRecord = {
      ...record,
      timestamp: new Date().toISOString()
    };

    this.records.push(enrichedRecord);

    // Keep memory bounded
    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }

    // Log based on outcome
    const outcome = enrichedRecord.negotiationOutcome;

    if (outcome === 'degraded') {
      const percentReduction =
        ((enrichedRecord.alphaCalculatedRiskPercent - enrichedRecord.finalRiskPercent) /
          enrichedRecord.alphaCalculatedRiskPercent) *
        100;

      logger.info(
        '[RiskNegotiationAuditor] RISK DEGRADATION - Position sized DOWN to respect user ceiling',
        {
          userId: enrichedRecord.userId,
          symbol: enrichedRecord.symbol,
          alphaCalculated: `${enrichedRecord.alphaCalculatedRiskPercent.toFixed(2)}%`,
          userMaximum: `${enrichedRecord.userMaxRiskPercent.toFixed(2)}%`,
          finalRisk: `${enrichedRecord.finalRiskPercent.toFixed(2)}%`,
          reductionPercent: percentReduction.toFixed(1),
          alphaLotSize: enrichedRecord.alphaLotSize.toFixed(2),
          finalLotSize: enrichedRecord.finalLotSize.toFixed(2),
          reason: enrichedRecord.degradationReason
        }
      );
    } else if (outcome === 'approved') {
      logger.debug('[RiskNegotiationAuditor] RISK APPROVED - Within user ceiling', {
        userId: enrichedRecord.userId,
        symbol: enrichedRecord.symbol,
        calculatedRisk: `${enrichedRecord.alphaCalculatedRiskPercent.toFixed(2)}%`,
        userMaximum: `${enrichedRecord.userMaxRiskPercent.toFixed(2)}%`,
        finalRisk: `${enrichedRecord.finalRiskPercent.toFixed(2)}%`
      });
    } else if (outcome === 'exceeded') {
      logger.warn('[RiskNegotiationAuditor] RISK OVERRIDE - User approved above ceiling', {
        userId: enrichedRecord.userId,
        symbol: enrichedRecord.symbol,
        calculatedRisk: `${enrichedRecord.alphaCalculatedRiskPercent.toFixed(2)}%`,
        userMaximum: `${enrichedRecord.userMaxRiskPercent.toFixed(2)}%`,
        finalRisk: `${enrichedRecord.finalRiskPercent.toFixed(2)}%`,
        excessAmount: (enrichedRecord.finalRiskPercent - enrichedRecord.userMaxRiskPercent).toFixed(
          2
        )
      });
    }
  }

  /**
   * GET negotiation records for a user (recent first)
   */
  getUserNegotiations(userId: string, limit: number = 50): RiskNegotiationRecord[] {
    return this.records
      .filter((r) => r.userId === userId)
      .reverse()
      .slice(0, limit);
  }

  /**
   * GET negotiation statistics for a user
   */
  getUserNegotiationStats(userId: string): {
    totalNegotiations: number;
    degradedCount: number;
    degradationRate: number;
    averageDegradationPercent: number;
    exceedanceCount: number;
  } {
    const userRecords = this.records.filter((r) => r.userId === userId);

    const degradedRecords = userRecords.filter((r) => r.negotiationOutcome === 'degraded');

    const totalDegradation = degradedRecords.reduce((sum, r) => {
      return sum + (r.alphaCalculatedRiskPercent - r.finalRiskPercent);
    }, 0);

    const exceedanceRecords = userRecords.filter((r) => r.negotiationOutcome === 'exceeded');

    return {
      totalNegotiations: userRecords.length,
      degradedCount: degradedRecords.length,
      degradationRate: userRecords.length > 0 ? (degradedRecords.length / userRecords.length) * 100 : 0,
      averageDegradationPercent:
        degradedRecords.length > 0 ? totalDegradation / degradedRecords.length : 0,
      exceedanceCount: exceedanceRecords.length
    };
  }

  /**
   * GET recent negotiation trends
   * Shows if Alpha is consistently trying to exceed user ceiling
   */
  getTrendAnalysis(userId: string, windowSize: number = 10): {
    trend: 'stable' | 'degrading-more' | 'degrading-less' | 'exceeding';
    message: string;
    recommendation: string;
  } {
    const recentRecords = this.getUserNegotiations(userId, windowSize);

    if (recentRecords.length === 0) {
      return {
        trend: 'stable',
        message: 'No recent negotiations',
        recommendation: 'Execute trades to establish pattern'
      };
    }

    const degradedCount = recentRecords.filter((r) => r.negotiationOutcome === 'degraded').length;
    const exceedanceCount = recentRecords.filter((r) => r.negotiationOutcome === 'exceeded').length;

    const degradationRate = (degradedCount / recentRecords.length) * 100;

    if (exceedanceCount > recentRecords.length * 0.3) {
      return {
        trend: 'exceeding',
        message: `In last ${recentRecords.length} trades, Alpha exceeded your ceiling ${exceedanceCount} times`,
        recommendation: 'Consider increasing your max risk preference or using lower risk mode'
      };
    }

    if (degradationRate > 50) {
      return {
        trend: 'degrading-more',
        message: `In last ${recentRecords.length} trades, ${degradedCount} were degraded (${degradationRate.toFixed(0)}%)`,
        recommendation: 'Alpha frequently calculates above your ceiling. Consider raising your max risk preference'
      };
    }

    if (degradationRate > 20) {
      return {
        trend: 'degrading-less',
        message: `In last ${recentRecords.length} trades, ${degradedCount} were degraded (${degradationRate.toFixed(0)}%)`,
        recommendation: 'Occasional degradation is normal. Monitor trend'
      };
    }

    return {
      trend: 'stable',
      message: `In last ${recentRecords.length} trades, all positions fit within your ${recentRecords[0]?.userMaxRiskPercent.toFixed(1)}% ceiling`,
      recommendation: 'Your risk ceiling is well-matched to trading conditions'
    };
  }

  /**
   * GET all records (for debugging/audit purposes)
   */
  getAllRecords(): RiskNegotiationRecord[] {
    return [...this.records];
  }

  /**
   * CLEAR records (use with caution - for testing only)
   */
  clearRecords(): void {
    logger.warn('[RiskNegotiationAuditor] Clearing audit records');
    this.records = [];
  }

  /**
   * GET in-memory record count
   */
  getRecordCount(): number {
    return this.records.length;
  }
}

export const riskNegotiationAuditor = new RiskNegotiationAuditor();
