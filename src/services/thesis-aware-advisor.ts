/**
 * THESIS-AWARE ADVISOR
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Generates intelligent, thesis-aware guidance for mid-trade monitoring
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ROLE:
 * - Transform thesis evaluation results into actionable advice
 * - Explain thesis status changes in plain language
 * - Provide specific guidance based on condition violations
 * - Reference key levels and their significance
 * - Track confidence erosion and its implications
 *
 * SSOT COMPLIANCE:
 * - Uses thesis evaluation from ThesisMonitoringAuthority
 * - No independent thesis logic
 * - Pure translation to user-facing language
 */

import type { ThesisEvaluationResult, ThesisStatus, ConditionEvaluationResult } from '@/services/thesis-monitoring-authority';
import type { MonitoredPosition } from '@/services/monitoring/position-monitoring-authority';

/**
 * Complete advisory guidance with context
 */
export interface ThesisAdvisoryGuidance {
  // Summary
  short_message: string;
  long_message: string;

  // Status and confidence
  thesis_status: ThesisStatus;
  confidence_percent: number;
  confidence_trend: 'improving' | 'stable' | 'declining' | 'critical';

  // Key observations
  what_changed: string[];
  what_validates_thesis: string[];
  what_threatens_thesis: string[];

  // Price levels to watch
  critical_levels: Array<{
    price: number;
    type: string;
    action: string;
    proximity_percent: number;
  }>;

  // Action items
  recommended_actions: string[];
  avoid_actions: string[];

  // Risk assessment
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  risk_description: string;
}

class ThesisAwareAdvisor {
  /**
   * Generate complete advisory based on thesis evaluation
   */
  generateAdvisory(
    position: MonitoredPosition,
    thesisEvaluation: ThesisEvaluationResult,
    previousStatus?: ThesisStatus
  ): ThesisAdvisoryGuidance {
    const status = thesisEvaluation.thesis_status;
    const confidencePercent = Math.round(thesisEvaluation.confidence_after * 100);

    // Determine confidence trend
    const confidenceTrend = this.calculateConfidenceTrend(
      thesisEvaluation.confidence_before,
      thesisEvaluation.confidence_after,
      status
    );

    // Extract what changed
    const whatChanged = this.extractWhatChanged(thesisEvaluation.conditions_evaluated);
    const whatValidates = this.extractValidatingConditions(thesisEvaluation.conditions_evaluated);
    const whatThreats = this.extractThreateningConditions(thesisEvaluation.conditions_evaluated);

    // Generate messages
    const shortMessage = this.generateShortMessage(status, confidencePercent, confidenceTrend);
    const longMessage = this.generateLongMessage(status, position, thesisEvaluation, confidencePercent);

    // Extract key levels from conditions
    const criticalLevels = this.extractCriticalLevels(thesisEvaluation.conditions_evaluated, position.current_price);

    // Generate recommendations
    const { recommendedActions, avoidActions } = this.generateActions(status, thesisEvaluation);

    // Assess risk
    const { riskLevel, riskDescription } = this.assessRisk(status, thesisEvaluation, position);

    return {
      short_message: shortMessage,
      long_message: longMessage,
      thesis_status: status,
      confidence_percent: confidencePercent,
      confidence_trend: confidenceTrend,
      what_changed: whatChanged,
      what_validates_thesis: whatValidates,
      what_threatens_thesis: whatThreats,
      critical_levels: criticalLevels,
      recommended_actions: recommendedActions,
      avoid_actions: avoidActions,
      risk_level: riskLevel,
      risk_description: riskDescription,
    };
  }

  /**
   * Generate short summary message (for notifications)
   */
  private generateShortMessage(status: ThesisStatus, confidencePercent: number, trend: string): string {
    switch (status) {
      case 'intact':
        return `Thesis intact (${confidencePercent}% confidence). Trade remains valid.`;

      case 'strengthening':
        return `Thesis strengthening (${confidencePercent}% confidence). Market conditions favor position.`;

      case 'partially_valid':
        return `Thesis partially valid (${confidencePercent}% confidence). Some confirmations weakening.`;

      case 'deteriorating':
        return `Thesis deteriorating (${confidencePercent}% confidence). Watch for invalidation.`;

      case 'broken':
        return `Thesis broken. Position should be closed immediately.`;

      case 'momentum_loss':
        return `Momentum loss detected (${confidencePercent}% confidence). Entry setup not confirmed.`;

      default:
        return `Trade status: ${status} (${confidencePercent}% confidence).`;
    }
  }

  /**
   * Generate detailed message (for UI display)
   */
  private generateLongMessage(
    status: ThesisStatus,
    position: MonitoredPosition,
    thesisEvaluation: ThesisEvaluationResult,
    confidencePercent: number
  ): string {
    const parts: string[] = [];
    parts.push(`Thesis Status: ${status.toUpperCase()} (${confidencePercent}% confidence)`);

    switch (status) {
      case 'intact':
        parts.push(`Your ${position.direction === 'buy' ? 'LONG' : 'SHORT'} thesis remains intact.`);
        parts.push('All key confirmations are holding.');
        parts.push(`Keep monitoring key levels. Consider taking profits if thesis weakens.`);
        break;

      case 'strengthening':
        parts.push('Market conditions are improving your setup.');
        parts.push('Price action confirms your thesis.');
        parts.push('Stay with the position. Look for confirmation targets.');
        break;

      case 'partially_valid':
        parts.push('Some aspects of your thesis are confirmed, but others are weakening.');
        parts.push('Identify which conditions are most critical and monitor them closely.');
        parts.push('Be prepared to exit if critical conditions fail.');
        break;

      case 'deteriorating':
        parts.push('Your thesis is losing validity.');
        const threats = thesisEvaluation.conditions_evaluated
          .filter((c) => c.condition_status === 'violated')
          .map((c) => c.condition_description);
        if (threats.length > 0) {
          parts.push(`Failing conditions: ${threats.join(', ')}`);
        }
        parts.push('Exit on next signal or break of critical support/resistance.');
        break;

      case 'broken':
        parts.push('A critical invalidation condition has been triggered.');
        parts.push('Your trade premise is no longer valid.');
        parts.push('EXIT NOW to protect capital. Recover this loss by better execution on next trade.');
        break;

      case 'momentum_loss':
        parts.push('Expected momentum is not present.');
        parts.push('The setup you entered on is not playing out as expected.');
        parts.push('Wait for clear confirmation or exit if patience wears thin.');
        break;

      default:
        parts.push(thesisEvaluation.guidance);
    }

    return parts.join(' | ');
  }

  /**
   * Calculate confidence trend
   */
  private calculateConfidenceTrend(before: number, after: number, status: ThesisStatus): 'improving' | 'stable' | 'declining' | 'critical' {
    if (status === 'broken') return 'critical';
    if (after > before + 0.1) return 'improving';
    if (after < before - 0.1) return 'declining';
    return 'stable';
  }

  /**
   * Extract conditions that changed status
   */
  private extractWhatChanged(conditions: ConditionEvaluationResult[]): string[] {
    return conditions
      .filter((c) => c.condition_status === 'triggered' || c.condition_status === 'violated')
      .map((c) => `${c.condition_description}: ${c.reasoning}`);
  }

  /**
   * Extract conditions validating thesis
   */
  private extractValidatingConditions(conditions: ConditionEvaluationResult[]): string[] {
    return conditions
      .filter((c) => c.condition_status === 'met' && c.confidence_impact > 0)
      .map((c) => c.condition_description);
  }

  /**
   * Extract conditions threatening thesis
   */
  private extractThreateningConditions(conditions: ConditionEvaluationResult[]): string[] {
    return conditions
      .filter((c) => c.condition_status === 'violated' || c.condition_status === 'triggered')
      .map((c) => c.condition_description);
  }

  /**
   * Extract critical price levels from conditions
   */
  private extractCriticalLevels(
    conditions: ConditionEvaluationResult[],
    currentPrice: number
  ): Array<{ price: number; type: string; action: string; proximity_percent: number }> {
    // Filter conditions that reference price levels
    const levelConditions = conditions.filter((c) => c.condition_type === 'invalidation' || c.condition_type === 'key_level');

    return levelConditions
      .map((c) => {
        const levelMatch = c.condition_description.match(/(\d+\.\d+)/);
        if (!levelMatch) return null;

        const price = parseFloat(levelMatch[1]);
        const proximity = Math.abs(currentPrice - price) / currentPrice;

        return {
          price,
          type: c.condition_type === 'invalidation' ? 'INVALIDATION' : 'KEY_LEVEL',
          action: c.condition_status === 'violated' ? 'MONITOR' : 'WATCH',
          proximity_percent: Math.round(proximity * 100),
        };
      })
      .filter((l) => l !== null) as Array<{ price: number; type: string; action: string; proximity_percent: number }>;
  }

  /**
   * Generate action recommendations
   */
  private generateActions(
    status: ThesisStatus,
    thesisEvaluation: ThesisEvaluationResult
  ): { recommendedActions: string[]; avoidActions: string[] } {
    const recommended: string[] = [];
    const avoid: string[] = [];

    switch (status) {
      case 'intact':
        recommended.push('Hold position - thesis validates');
        recommended.push('Monitor key levels');
        avoid.push('Close too early');
        avoid.push('Add to position without confirmation');
        break;

      case 'strengthening':
        recommended.push('Stay with trade');
        recommended.push('Scale up if momentum strengthens');
        avoid.push('Exit prematurely');
        break;

      case 'partially_valid':
        recommended.push('Reduce position size');
        recommended.push('Move stop loss closer to breakeven');
        avoid.push('Add to position');
        avoid.push('Ignore warning signs');
        break;

      case 'deteriorating':
        recommended.push('Prepare to exit');
        recommended.push('Reduce risk - tighten stop loss');
        avoid.push('Add to position');
        avoid.push('Ignore deterioration');
        break;

      case 'broken':
        recommended.push('Exit position immediately');
        recommended.push('Protect remaining capital');
        recommended.push('Review setup for next opportunity');
        avoid.push('Hold hoping for reversal');
        avoid.push('Increase position size');
        break;

      case 'momentum_loss':
        recommended.push('Wait for momentum confirmation');
        recommended.push('Exit if setup breaks down');
        avoid.push('Force the trade');
        avoid.push('Hold indefinitely');
        break;
    }

    return { recommendedActions: recommended, avoidActions: avoid };
  }

  /**
   * Assess overall risk level
   */
  private assessRisk(
    status: ThesisStatus,
    thesisEvaluation: ThesisEvaluationResult,
    position: MonitoredPosition
  ): { riskLevel: 'low' | 'medium' | 'high' | 'critical'; riskDescription: string } {
    if (status === 'broken') {
      return {
        riskLevel: 'critical',
        riskDescription: 'Thesis invalidated. Immediate exit required to protect capital.',
      };
    }

    if (status === 'deteriorating' || (status === 'momentum_loss' && thesisEvaluation.confidence_after < 0.3)) {
      return {
        riskLevel: 'high',
        riskDescription: 'Thesis weakening rapidly. Risk of larger loss if trend reverses.',
      };
    }

    if (status === 'partially_valid' || (status === 'momentum_loss' && thesisEvaluation.confidence_after >= 0.3)) {
      return {
        riskLevel: 'medium',
        riskDescription: 'Some confirmation issues. Monitor closely for deterioration.',
      };
    }

    return {
      riskLevel: 'low',
      riskDescription: 'Thesis valid. Normal position risk.',
    };
  }
}

export const thesisAwareAdvisor = new ThesisAwareAdvisor();
