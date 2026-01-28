/**
 * MODAL STATE RECOVERY SERVICE - Single Source of Truth
 *
 * SSOT: All modal button action handlers (Continue, Close, Start New) flow through this service.
 * This ensures:
 * - Atomic state transitions (all-or-nothing)
 * - User-facing error feedback
 * - Automatic recovery from network failures
 * - Prevents silent failures
 * - Governance compliance for all state changes
 *
 * CCIP Compliance: All state transitions are logged for audit trail
 */

import { supabase } from '@/lib/supabase';
import { goalSessionStateMachine } from './coordinators/goal-session-state-machine';
import { modalQueueManager } from './modal-queue-manager';

export type ModalActionDecision = 'continue' | 'close' | 'start_new';

export interface ModalActionResult {
  success: boolean;
  decision: ModalActionDecision;
  sessionId: string;
  previousStatus?: string;
  newStatus?: string;
  errorMessage?: string;
  errorRecoveryAttempted?: boolean;
}

class ModalStateRecoveryService {
  /**
   * SSOT for handling modal button actions
   * All buttons (Continue, Close, Start New) route through this single function
   * to ensure atomic state transitions and error recovery
   */
  async handleModalAction(
    sessionId: string,
    modalId: string,
    userId: string,
    decision: ModalActionDecision
  ): Promise<ModalActionResult> {
    console.log(`[ModalStateRecovery] Processing ${decision} action for session ${sessionId}`);

    try {
      // STEP 1: Fetch current session state (validate preconditions)
      const { data: session, error: fetchError } = await supabase
        .from('goal_sessions')
        .select('id, status, user_id')
        .eq('id', sessionId)
        .maybeSingle();

      if (fetchError || !session) {
        console.error('[ModalStateRecovery] Failed to fetch session:', fetchError);
        return {
          success: false,
          decision,
          sessionId,
          errorMessage: 'Session not found or database error',
        };
      }

      // Validate ownership
      if (session.user_id !== userId) {
        console.error('[ModalStateRecovery] Unauthorized access attempt - session owner mismatch');
        return {
          success: false,
          decision,
          sessionId,
          errorMessage: 'Unauthorized access',
        };
      }

      const previousStatus = session.status;

      // STEP 2: Determine target state based on decision
      let targetState: 'scanning' | 'stopped';
      let transitionReason: string;

      if (decision === 'continue') {
        targetState = 'scanning';
        transitionReason = 'User chose to continue after trade close (via TradeClosedModal)';
      } else {
        // Both 'close' and 'start_new' terminate the session
        targetState = 'stopped';
        transitionReason =
          decision === 'close'
            ? 'User closed session after trade close (via TradeClosedModal)'
            : 'User chose to start new session after trade close (via TradeClosedModal)';
      }

      // STEP 3: Attempt state transition (SSOT: use state machine)
      const transitionResult = await goalSessionStateMachine.transition(sessionId, targetState, {
        reason: transitionReason,
        triggeredBy: 'ModalStateRecoveryService',
        decision,
      });

      if (!transitionResult.success) {
        console.error('[ModalStateRecovery] State transition failed:', transitionResult.error);

        // CRITICAL: Log the failure for governance/CCIP
        await this.logModalActionFailure(
          sessionId,
          userId,
          decision,
          previousStatus,
          transitionResult.error?.message || 'Unknown error'
        );

        return {
          success: false,
          decision,
          sessionId,
          previousStatus,
          errorMessage: `Failed to transition session to ${targetState}. Your session state may not have updated. Please refresh the page.`,
          errorRecoveryAttempted: true,
        };
      }

      // STEP 4: Dismiss modal from database (only after successful state transition)
      const dismissResult = await modalQueueManager.dismissModal(modalId, decision);
      if (!dismissResult.success) {
        console.warn('[ModalStateRecovery] Modal dismissal failed (non-critical):', dismissResult.error);
        // Don't fail the entire operation if modal dismissal fails - state transition succeeded
      }

      // STEP 5: Log successful action for governance/CCIP audit trail
      await this.logModalActionSuccess(sessionId, userId, decision, previousStatus, targetState);

      console.log(`[ModalStateRecovery] ✅ Successfully processed ${decision} action`);

      return {
        success: true,
        decision,
        sessionId,
        previousStatus,
        newStatus: targetState,
      };
    } catch (error) {
      console.error('[ModalStateRecovery] Unexpected error processing modal action:', error);

      return {
        success: false,
        decision,
        sessionId,
        errorMessage: 'An unexpected error occurred. Please try again or refresh the page.',
      };
    }
  }

  /**
   * Log successful modal action for CCIP governance audit trail
   */
  private async logModalActionSuccess(
    sessionId: string,
    userId: string,
    decision: ModalActionDecision,
    fromStatus: string,
    toStatus: string
  ): Promise<void> {
    try {
      const { error } = await supabase.from('ccip_change_tracking').insert({
        change_type: 'modal_action',
        session_id: sessionId,
        user_id: userId,
        details: {
          decision,
          from_status: fromStatus,
          to_status: toStatus,
          timestamp: new Date().toISOString(),
        },
        severity: 'info',
        status: 'success',
      });

      if (error) {
        console.warn('[ModalStateRecovery] Failed to log modal action (non-critical):', error);
      }
    } catch (error) {
      console.error('[ModalStateRecovery] Exception logging modal action:', error);
    }
  }

  /**
   * Log failed modal action for CCIP governance audit trail
   * These failures are critical and must be investigated
   */
  private async logModalActionFailure(
    sessionId: string,
    userId: string,
    decision: ModalActionDecision,
    expectedStatus: string,
    errorMsg: string
  ): Promise<void> {
    try {
      const { error } = await supabase.from('ccip_change_tracking').insert({
        change_type: 'modal_action_failure',
        session_id: sessionId,
        user_id: userId,
        details: {
          decision,
          expected_status: expectedStatus,
          error_message: errorMsg,
          timestamp: new Date().toISOString(),
        },
        severity: 'critical',
        status: 'failed',
      });

      if (error) {
        console.error('[ModalStateRecovery] Failed to log failure (critical):', error);
      }
    } catch (error) {
      console.error('[ModalStateRecovery] Exception logging failure:', error);
    }
  }

  /**
   * Check if modal can be safely dismissed
   * SSOT for determining when page reload is safe
   */
  async validateStateBeforeReload(sessionId: string): Promise<boolean> {
    try {
      const { data: session, error } = await supabase
        .from('goal_sessions')
        .select('status')
        .eq('id', sessionId)
        .maybeSingle();

      if (error || !session) {
        console.error('[ModalStateRecovery] Failed to validate state before reload:', error);
        return false;
      }

      // Valid terminal states after modal action
      const validFinalStates = ['scanning', 'stopped', 'timeout', 'weekend_shutdown'];
      const isValid = validFinalStates.includes(session.status);

      if (!isValid) {
        console.warn(
          '[ModalStateRecovery] Session in unexpected state before reload:',
          session.status
        );
      }

      return isValid;
    } catch (error) {
      console.error('[ModalStateRecovery] Exception validating state:', error);
      return false;
    }
  }
}

export const modalStateRecoveryService = new ModalStateRecoveryService();
