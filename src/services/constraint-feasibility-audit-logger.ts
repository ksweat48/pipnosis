/**
 * Constraint Feasibility Audit Logger
 *
 * RESPONSIBILITY: Log constraint feasibility conflicts for governance and audit trail
 *
 * CRITICAL PRINCIPLE:
 * This service creates a governance record when Omega-9 detects infeasible constraints.
 * It tracks:
 * 1. What the constraint conflict was
 * 2. Why it happened (SESSION_TIME or MARKET_ATR)
 * 3. What Alpha decided to do about it
 *
 * This ensures CCIP compliance: Authority is documented and respected.
 * Alpha's decision (accept reduced R:R, change style, skip trade) is recorded.
 *
 * ARCHITECTURE:
 * 1. Omega-9 detects infeasible constraints → logConstraintConflict()
 * 2. Conflict is recorded in database with status 'pending_alpha_decision'
 * 3. Alpha makes decision (accept, skip, change style)
 * 4. recordAlphaDecision() updates the audit record
 * 5. Governance can track all conflicts and decisions
 */

import { supabase } from '../lib/supabase';
import type { ConstraintFeasibilityStatus } from '../types/omega9-constraints';

interface ConstraintConflictInput {
  userId: string;
  sessionId?: string;
  symbol: string;
  tradeStyle: string;
  entryPrice: number;
  direction: 'BUY' | 'SELL';
  minTPRequired: number;
  maxTPAvailable: number;
  minRRRequired: number;
  maxRRAchievable: number;
  conflictSource: 'SESSION_TIME' | 'MARKET_ATR' | 'NONE';
}

interface AlphaDecision {
  auditId: string;
  acceptedReducedRR?: boolean;
  changedStyle?: boolean;
  skippedTrade?: boolean;
  rationale: string;
}

class ConstraintFeasibilityAuditLogger {
  /**
   * Log a constraint feasibility conflict when detected by Omega-9
   * This creates a governance record that can be tracked and audited
   */
  async logConstraintConflict(input: ConstraintConflictInput): Promise<string | null> {
    try {
      const gap = input.minTPRequired - input.maxTPAvailable;
      const rrReductionPercent =
        ((input.minRRRequired - input.maxRRAchievable) / input.minRRRequired) * 100;

      // Determine severity
      let severity: 'MINOR' | 'MODERATE' | 'SEVERE';
      if (rrReductionPercent > 50) {
        severity = 'SEVERE';
      } else if (rrReductionPercent > 25) {
        severity = 'MODERATE';
      } else {
        severity = 'MINOR';
      }

      const { data, error } = await supabase
        .from('constraint_feasibility_audit')
        .insert({
          user_id: input.userId,
          session_id: input.sessionId,
          symbol: input.symbol,
          trade_style: input.tradeStyle,
          entry_price: input.entryPrice,
          direction: input.direction,
          min_tp_required: input.minTPRequired,
          max_tp_available: input.maxTPAvailable,
          min_rr_required: input.minRRRequired,
          max_rr_achievable: input.maxRRAchievable,
          conflict_source: input.conflictSource,
          gap_pips: gap,
          rr_reduction_needed: rrReductionPercent,
          severity,
          alpha_decision_made: false
        })
        .select('id')
        .single();

      if (error) {
        console.error('[ConstraintAudit] Failed to log constraint conflict:', error);
        return null;
      }

      console.log(
        `[ConstraintAudit] Logged constraint conflict: ${input.symbol} ${input.direction} (severity: ${severity}) - Audit ID: ${data.id}`
      );
      return data.id;
    } catch (err) {
      console.error('[ConstraintAudit] Exception logging constraint conflict:', err);
      return null;
    }
  }

  /**
   * Record Alpha's decision on a constraint feasibility conflict
   * Updates the audit record with the decision and reasoning
   */
  async recordAlphaDecision(decision: AlphaDecision): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('constraint_feasibility_audit')
        .update({
          alpha_decision_made: true,
          alpha_accepted_reduced_rr: decision.acceptedReducedRR ?? null,
          alpha_changed_style: decision.changedStyle ?? null,
          alpha_skipped_trade: decision.skippedTrade ?? null,
          alpha_rationale: decision.rationale,
          updated_at: new Date().toISOString()
        })
        .eq('id', decision.auditId);

      if (error) {
        console.error('[ConstraintAudit] Failed to record Alpha decision:', error);
        return false;
      }

      console.log('[ConstraintAudit] Recorded Alpha decision for audit:', decision.auditId);
      return true;
    } catch (err) {
      console.error('[ConstraintAudit] Exception recording Alpha decision:', err);
      return false;
    }
  }

  /**
   * Query constraint conflicts for a user (for analytics/dashboard)
   */
  async getUserConstraintConflicts(userId: string, limit: number = 50) {
    try {
      const { data, error } = await supabase
        .from('constraint_feasibility_audit')
        .select(
          'id, symbol, trade_style, entry_price, direction, min_rr_required, max_rr_achievable, severity, conflict_source, alpha_decision_made, created_at'
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[ConstraintAudit] Failed to query conflicts:', error);
        return [];
      }

      return data || [];
    } catch (err) {
      console.error('[ConstraintAudit] Exception querying conflicts:', err);
      return [];
    }
  }

  /**
   * Get statistics on constraint conflicts
   */
  async getConstraintStatistics(userId: string) {
    try {
      const { data, error } = await supabase
        .from('constraint_feasibility_audit')
        .select('severity, conflict_source, alpha_decision_made, alpha_accepted_reduced_rr')
        .eq('user_id', userId);

      if (error) {
        console.error('[ConstraintAudit] Failed to get statistics:', error);
        return null;
      }

      const records = data || [];

      return {
        totalConflicts: records.length,
        bySource: {
          sessionTime: records.filter((r) => r.conflict_source === 'SESSION_TIME').length,
          marketATR: records.filter((r) => r.conflict_source === 'MARKET_ATR').length
        },
        bySeverity: {
          minor: records.filter((r) => r.severity === 'MINOR').length,
          moderate: records.filter((r) => r.severity === 'MODERATE').length,
          severe: records.filter((r) => r.severity === 'SEVERE').length
        },
        alphaDecisions: {
          totalWithDecision: records.filter((r) => r.alpha_decision_made).length,
          acceptedReducedRR: records.filter((r) => r.alpha_accepted_reduced_rr === true).length,
          undecided: records.filter((r) => !r.alpha_decision_made).length
        }
      };
    } catch (err) {
      console.error('[ConstraintAudit] Exception getting statistics:', err);
      return null;
    }
  }
}

export const constraintFeasibilityAuditLogger = new ConstraintFeasibilityAuditLogger();
