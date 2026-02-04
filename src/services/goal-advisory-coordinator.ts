import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

/**
 * CCIP GOVERNANCE: Goal Advisory Coordinator
 *
 * AUTHORITY: Single source of truth for goal advisory management
 *
 * RESPONSIBILITY:
 * - Creates advisories from market assessments (stored SEPARATELY)
 * - Tracks user acceptance/rejection decisions
 * - Enforces immutable original goals
 * - Maintains full governance audit trail
 * - NEVER silently applies advisories to goal_sessions.target_value
 *
 * ARCHITECTURAL GUARANTEE:
 * - Advisories are RECOMMENDATIONS only, logged to goal_target_advisories table
 * - goal_sessions.target_value only changes when user explicitly accepts advisory
 * - All changes logged to goal_modification_audit with full chain of custody
 * - No silent mutations - every change is explicit and auditable
 *
 * @see goal_modification_audit - Immutable audit trail
 * @see goal_target_advisories - Advisory recommendation tracking
 * @see goal_sessions.original_target_value - IMMUTABLE original goal
 */

interface MarketAssessment {
  predictedProfitMin: number;
  predictedProfitMax: number;
  confidence: number;
  reasoning: string;
  isAchievableWithCurrentAccount: boolean;
}

interface GoalAdvisory {
  id: string;
  goal_session_id: string;
  user_id: string;
  original_requested: number;
  advisory_recommended: number;
  reason: string;
  authority: string;
  confidence_level: number;
  status: 'pending_review' | 'accepted' | 'rejected' | 'expired';
  created_at: string;
}

class GoalAdvisoryCoordinator {
  /**
   * CCIP GATE: Create advisory from market assessment
   *
   * AUTHORITY: Only this service creates advisories
   * CONSEQUENCE: Advisories are logged but NOT applied to goal_sessions.target_value
   *
   * WHY THIS MATTERS:
   * - Separates advisory recommendations from actual goals
   * - Prevents the $300 → $125 silent mutation bug
   * - Creates full audit trail of what was recommended vs. what was accepted
   * - User retains control - advisory is just guidance
   *
   * @param goalSessionId - The goal session to create advisory for
   * @param userId - The user who owns the goal
   * @param originalRequested - User's original requested goal ($300)
   * @param assessment - Market assessment with predicted profit limits
   * @returns Advisory ID or error
   */
  async createMarketAssessmentAdvisory(
    goalSessionId: string,
    userId: string,
    originalRequested: number,
    assessment: MarketAssessment
  ): Promise<{ advisoryId: string; message: string } | null> {
    try {
      // GOVERNANCE CHECK: Verify goal session exists and is owned by user
      const { data: session, error: sessionError } = await supabase
        .from('goal_sessions')
        .select('id, user_id, original_target_value, target_value')
        .eq('id', goalSessionId)
        .maybeSingle();

      if (sessionError || !session) {
        logger.error('[Goal Advisory] Goal session not found', { goalSessionId, sessionError });
        return null;
      }

      if (session.user_id !== userId) {
        logger.error('[Goal Advisory] Unauthorized advisory creation', { goalSessionId, userId });
        return null;
      }

      // GOVERNANCE CHECK: original_target_value must be set (immutable)
      if (!session.original_target_value) {
        logger.error('[Goal Advisory] original_target_value not set - cannot create advisory', {
          goalSessionId,
        });
        return null;
      }

      // ADVISORY LOGIC: Only create advisory if market assessment suggests goal may not be achievable
      if (originalRequested > assessment.predictedProfitMax && assessment.confidence > 0.6) {
        const advisoryRecommended = Math.max(assessment.predictedProfitMin, assessment.predictedProfitMax);

        // INSERT TO ADVISORY TABLE (NOT to goal_sessions.target_value!)
        const { data: advisory, error: advisoryError } = await supabase
          .from('goal_target_advisories')
          .insert({
            goal_session_id: goalSessionId,
            user_id: userId,
            original_requested: originalRequested,
            advisory_recommended: advisoryRecommended,
            reason: `Market assessment indicates max achievable profit: $${advisoryRecommended}.
              Conservative estimate: $${assessment.predictedProfitMin}.
              Confidence: ${(assessment.confidence * 100).toFixed(0)}%`,
            authority: 'market-assessment',
            confidence_level: assessment.confidence,
            status: 'pending_review',
            metadata: {
              market_assessment_reasoning: assessment.reasoning,
              is_achievable: assessment.isAchievableWithCurrentAccount,
              predicted_profit_min: assessment.predictedProfitMin,
              predicted_profit_max: assessment.predictedProfitMax,
            },
          })
          .select()
          .single();

        if (advisoryError) {
          logger.error('[Goal Advisory] Failed to create advisory', {
            goalSessionId,
            advisoryError,
          });
          return null;
        }

        logger.info('[Goal Advisory] Advisory created (NOT applied yet)', {
          advisoryId: advisory.id,
          goalSessionId,
          originalRequested,
          advisoryRecommended,
          reason: 'Market assessment suggests goal may be optimistic',
          userAction: 'User must explicitly accept or reject',
        });

        return {
          advisoryId: advisory.id,
          message: `Market analysis suggests max profit: $${advisoryRecommended}.
            Accept this recommendation or proceed with $${originalRequested}?`,
        };
      }

      // Goal is achievable - no advisory needed
      logger.info('[Goal Advisory] Goal is achievable, no advisory needed', {
        goalSessionId,
        originalRequested,
        predictedMax: assessment.predictedProfitMax,
      });

      return null;
    } catch (error) {
      logger.error('[Goal Advisory] Error creating advisory', { error, goalSessionId });
      return null;
    }
  }

  /**
   * GOVERNANCE GATE: Accept or reject advisory
   *
   * AUTHORITY: Only explicit user action changes goal_sessions.target_value
   * CONSEQUENCE: Change is logged to goal_modification_audit with full chain of custody
   *
   * @param advisoryId - The advisory to act on
   * @param userId - User making the decision
   * @param accept - true to accept advisory, false to reject
   * @returns Success confirmation with new target value
   */
  async userActionOnAdvisory(
    advisoryId: string,
    userId: string,
    accept: boolean
  ): Promise<{
    success: boolean;
    action: 'accepted' | 'rejected';
    newTargetValue?: number;
    complianceStatus?: string;
  } | null> {
    try {
      // Call the RPC function which handles all the complexity
      const { data, error } = await supabase.rpc('accept_goal_advisory', {
        p_goal_session_id: null, // Will be fetched from advisory
        p_advisory_id: advisoryId,
        p_accept: accept,
      });

      if (error) {
        logger.error('[Goal Advisory] Error processing user action', { error, advisoryId });
        return null;
      }

      logger.info('[Goal Advisory] User action processed', {
        advisoryId,
        action: accept ? 'accepted' : 'rejected',
        result: data,
      });

      return {
        success: data.success,
        action: data.action,
        newTargetValue: data.new_target_value,
        complianceStatus: data.compliance_check?.compliance_status,
      };
    } catch (error) {
      logger.error('[Goal Advisory] Exception in userActionOnAdvisory', { error, advisoryId });
      return null;
    }
  }

  /**
   * GOVERNANCE QUERY: Get pending advisories for user
   *
   * @param userId - User to fetch advisories for
   * @returns List of pending advisories
   */
  async getPendingAdvisories(userId: string): Promise<GoalAdvisory[]> {
    try {
      const { data: advisories, error } = await supabase
        .from('goal_target_advisories')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending_review')
        .order('created_at', { ascending: false });

      if (error) {
        logger.error('[Goal Advisory] Error fetching advisories', { error, userId });
        return [];
      }

      return advisories || [];
    } catch (error) {
      logger.error('[Goal Advisory] Exception fetching advisories', { error });
      return [];
    }
  }

  /**
   * GOVERNANCE VERIFICATION: Check CCIP compliance for goal
   *
   * Verifies:
   * - original_target_value is set (immutable tracking)
   * - no silent reductions occurred
   * - all changes are audited
   * - user acceptance timestamp exists if advisory was accepted
   *
   * @param goalSessionId - Session to verify
   * @returns Compliance status
   */
  async verifyCCIPCompliance(goalSessionId: string): Promise<{
    valid: boolean;
    violations: string[];
    status: string;
  } | null> {
    try {
      const { data, error } = await supabase.rpc('verify_goal_ssot_compliance', {
        p_goal_session_id: goalSessionId,
      });

      if (error) {
        logger.error('[Goal Advisory] Error verifying compliance', { error, goalSessionId });
        return null;
      }

      if (data.compliance_status !== 'COMPLIANT') {
        logger.warn('[Goal Advisory] CCIP Compliance violation detected', {
          goalSessionId,
          violations: data.violations,
        });
      }

      return {
        valid: data.valid,
        violations: data.violations,
        status: data.compliance_status,
      };
    } catch (error) {
      logger.error('[Goal Advisory] Exception verifying compliance', { error, goalSessionId });
      return null;
    }
  }

  /**
   * GOVERNANCE AUDIT: Get modification history for goal
   *
   * @param goalSessionId - Session to get history for
   * @returns Complete modification history
   */
  async getModificationHistory(goalSessionId: string): Promise<
    {
      modification_type: string;
      original_value: number;
      new_value: number | null;
      authority: string;
      reason: string;
      created_at: string;
    }[]
  > {
    try {
      const { data, error } = await supabase
        .from('goal_modification_audit')
        .select(
          'modification_type, original_value, new_value, authority, reason, created_at'
        )
        .eq('goal_session_id', goalSessionId)
        .order('created_at', { ascending: true });

      if (error) {
        logger.error('[Goal Advisory] Error fetching modification history', { error });
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('[Goal Advisory] Exception fetching history', { error });
      return [];
    }
  }
}

export const goalAdvisoryCoordinator = new GoalAdvisoryCoordinator();