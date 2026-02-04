/**
 * THESIS-AWARE POSITION MONITOR COORDINATOR
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * INTEGRATION POINT: Combines position monitoring with thesis evaluation
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ROLE:
 * - Fetches position context from positionMonitoringAuthority
 * - Evaluates thesis conditions via thesisMonitoringAuthority
 * - Combines both insights for closure decisions
 * - Reports integrated status to MidTradeMonitor
 *
 * DELEGATION PATTERN:
 * - Position logic → positionMonitoringAuthority
 * - Thesis logic → thesisMonitoringAuthority
 * - Integration → This coordinator
 *
 * CCIP COMPLIANCE:
 * - Coordinates existing authorities
 * - No duplication of position or thesis logic
 * - Clear delegation boundaries
 */

import { positionMonitoringAuthority, type MonitoredPosition, type ClosureDecision } from '@/services/monitoring/position-monitoring-authority';
import { thesisMonitoringAuthority, type ThesisEvaluationResult, type ThesisStatus } from '@/services/thesis-monitoring-authority';
import { supabase } from '@/lib/supabase';
import type { PriceData } from '@/services/monitoring/position-monitoring-authority';

/**
 * Combined position + thesis evaluation result
 */
export interface ThesisAwareMonitoringResult {
  position: MonitoredPosition;
  closure_decision: ClosureDecision | null;
  thesis_evaluation: ThesisEvaluationResult;
  integrated_guidance: string;
  should_close: boolean;
  close_reasons: string[];
  trading_status: 'thesis_valid' | 'thesis_weakening' | 'thesis_broken' | 'position_sl_tp_triggered';
}

class ThesisAwarePositionMonitor {
  /**
   * Monitor position with thesis-aware context
   *
   * Evaluates both:
   * 1. Position mechanics (SL/TP proximity)
   * 2. Thesis validity (conditions met/broken)
   * 3. Combined decision (when to exit)
   *
   * @param userId - User owning position
   * @param tradeId - Trade to monitor
   * @param currentPrice - Current market price
   */
  async monitorPositionWithThesis(
    userId: string,
    tradeId: string,
    currentPrice: PriceData
  ): Promise<ThesisAwareMonitoringResult | null> {
    try {
      // 1. Get position context
      const positionResult = await positionMonitoringAuthority.getMonitorablePositions(userId, false);
      if (!positionResult.success) {
        return null;
      }

      const position = positionResult.positions.find((p) => p.id === tradeId);
      if (!position) {
        return null;
      }

      // 2. Get thesis context
      const thesisContext = await thesisMonitoringAuthority.getThesisContext(tradeId, userId);
      if (!thesisContext) {
        // Trade exists but no thesis - treat as non-thesis trade
        // Fall back to position-only monitoring
        return await this.monitorPositionOnlyLegacy(position, currentPrice);
      }

      // 3. Evaluate position (SL/TP mechanics)
      const positionClosureDecision = positionMonitoringAuthority.checkSLTP(position, currentPrice);

      // 4. Evaluate thesis
      const thesisEvaluation = await thesisMonitoringAuthority.evaluateThesisStatus(thesisContext, currentPrice.bid);

      // 5. Integrate insights
      return this.integrateMonitoringResults(
        position,
        positionClosureDecision,
        thesisEvaluation,
        currentPrice
      );
    } catch (error) {
      console.error(`[ThesisAwarePositionMonitor] Error monitoring position:`, error);
      return null;
    }
  }

  /**
   * Integrate position and thesis insights
   */
  private integrateMonitoringResults(
    position: MonitoredPosition,
    positionDecision: any,
    thesisEvaluation: ThesisEvaluationResult,
    currentPrice: PriceData
  ): ThesisAwareMonitoringResult {
    const closeReasons: string[] = [];
    let shouldClose = false;
    let tradingStatus: 'thesis_valid' | 'thesis_weakening' | 'thesis_broken' | 'position_sl_tp_triggered' = 'thesis_valid';

    // Check position mechanics
    if (positionDecision?.shouldClose) {
      shouldClose = true;
      closeReasons.push(`Position ${positionDecision.reason}`);
      tradingStatus = 'position_sl_tp_triggered';
    }

    // Check thesis validity
    if (thesisEvaluation.thesis_status === 'broken') {
      shouldClose = true;
      closeReasons.push('Thesis invalidated');
      tradingStatus = 'thesis_broken';
    } else if (thesisEvaluation.thesis_status === 'deteriorating') {
      closeReasons.push('Thesis weakening');
      tradingStatus = 'thesis_weakening';
    }

    // Generate integrated guidance
    const integratedGuidance = this.generateIntegratedGuidance(
      position,
      positionDecision,
      thesisEvaluation,
      tradingStatus
    );

    return {
      position,
      closure_decision: positionDecision || null,
      thesis_evaluation: thesisEvaluation,
      integrated_guidance: integratedGuidance,
      should_close: shouldClose,
      close_reasons: closeReasons,
      trading_status: tradingStatus,
    };
  }

  /**
   * Fallback for positions without thesis data
   */
  private async monitorPositionOnlyLegacy(
    position: MonitoredPosition,
    currentPrice: PriceData
  ): Promise<ThesisAwareMonitoringResult> {
    const positionClosureDecision = positionMonitoringAuthority.checkSLTP(position, currentPrice);
    const shouldClose = positionClosureDecision?.shouldClose || false;
    const closeReasons: string[] = [];

    if (shouldClose) {
      closeReasons.push(`Position ${positionClosureDecision?.reason}`);
    }

    return {
      position,
      closure_decision: positionClosureDecision || null,
      thesis_evaluation: {
        thesis_status: 'new',
        confidence_before: 0.5,
        confidence_after: 0.5,
        conditions_evaluated: [],
        invalidations_triggered: false,
        confirmations_valid: true,
        guidance: 'Position monitoring (no thesis data)',
        should_close: shouldClose,
      },
      integrated_guidance: `Position mechanics: ${positionClosureDecision?.reason || 'monitoring'}. No thesis data available.`,
      should_close: shouldClose,
      close_reasons: closeReasons,
      trading_status: shouldClose ? 'position_sl_tp_triggered' : 'thesis_valid',
    };
  }

  /**
   * Generate integrated guidance combining position + thesis insights
   */
  private generateIntegratedGuidance(
    position: MonitoredPosition,
    positionDecision: any,
    thesisEvaluation: ThesisEvaluationResult,
    tradingStatus: string
  ): string {
    const parts: string[] = [];

    // Thesis status
    parts.push(`Thesis Status: ${thesisEvaluation.thesis_status} (confidence: ${(thesisEvaluation.confidence_after * 100).toFixed(0)}%)`);

    // Position status
    if (position.direction === 'buy') {
      const distanceToSL = ((position.entry_price - position.stop_loss) / position.entry_price) * 100;
      const distanceToTP = ((position.take_profit - position.entry_price) / position.entry_price) * 100;
      parts.push(`Position: ${distanceToSL.toFixed(2)}% risk / ${distanceToTP.toFixed(2)}% target`);
    } else {
      const distanceToSL = ((position.stop_loss - position.entry_price) / position.entry_price) * 100;
      const distanceToTP = ((position.entry_price - position.take_profit) / position.entry_price) * 100;
      parts.push(`Position: ${distanceToSL.toFixed(2)}% risk / ${distanceToTP.toFixed(2)}% target`);
    }

    // Thesis guidance
    parts.push(`Thesis Analysis: ${thesisEvaluation.guidance}`);

    // Action if needed
    if (tradingStatus === 'thesis_broken') {
      parts.push(`ACTION: Thesis is broken. Exit position to protect capital.`);
    } else if (tradingStatus === 'thesis_weakening') {
      parts.push(`WARNING: Thesis is weakening. Consider exit if further deterioration.`);
    }

    return parts.join(' | ');
  }

  /**
   * Update thesis status on trade based on evaluation
   */
  async updateThesisStatus(tradeId: string, status: ThesisStatus, confidence: number): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('update_thesis_status', {
        p_trade_id: tradeId,
        p_thesis_status: status,
        p_thesis_confidence_current: confidence,
      });

      if (error) {
        console.error(`[ThesisAwarePositionMonitor] Failed to update thesis status:`, error);
        return false;
      }

      return data?.success || false;
    } catch (error) {
      console.error(`[ThesisAwarePositionMonitor] Error updating thesis status:`, error);
      return false;
    }
  }
}

export const thesisAwarePositionMonitor = new ThesisAwarePositionMonitor();
