/**
 * CONTINUATION DECISION COORDINATOR - SSOT Authority
 *
 * Single Source of Truth for continuation modal logic:
 * 1. When to show continuation modal (TP2 hit + gap remaining)
 * 2. What to display (remaining gap amount, progress percentage)
 * 3. How to handle user response (continue scanning vs close session)
 *
 * CCIP COMPLIANCE:
 * - Authority: calculate_goal_gap() RPC (database is SSOT)
 * - Responsibility: Coordinate continuation flow
 * - Ownership: This service owns all continuation decisions
 * - Fail-Hard: Log all decisions, no silent failures
 */

import { supabase } from '@/lib/supabase';
import { logger, LogCategory } from '@/lib/logger';

export interface ContinuationContext {
  goalSessionId: string;
  userId: string;
  goalAmount: number;
  currentPnL: number;
  remainingGap: number;
  percentageComplete: number;
  tradesCompleted: number;
  sessionStatus: string;
}

export interface ContinuationModalData {
  title: string;
  message: string;
  goalAmount: number;
  currentPnL: number;
  remainingGap: number;
  percentageComplete: number;
  showContinueOption: boolean;
}

class ContinuationDecisionCoordinator {
  /**
   * Check if session should show continuation modal
   * SSOT: Uses database function calculate_goal_gap()
   */
  async shouldShowContinuationModal(
    goalSessionId: string,
    userId: string
  ): Promise<{ should: boolean; context?: ContinuationContext; error?: string }> {
    try {
      logger.info(
        LogCategory.TRADING,
        `[Continuation] Checking if continuation modal needed for session ${goalSessionId}`
      );

      // SSOT: Call database function to get goal gap
      const { data: gapInfo, error } = await supabase.rpc('calculate_goal_gap', {
        p_goal_session_id: goalSessionId
      });

      if (error) {
        logger.error(
          LogCategory.TRADING,
          `[Continuation] Error calculating goal gap: ${error.message}`
        );
        return { should: false, error: error.message };
      }

      if (!gapInfo?.success) {
        logger.warn(
          LogCategory.TRADING,
          `[Continuation] Goal gap calculation failed: ${gapInfo?.error}`
        );
        return { should: false, error: gapInfo?.error };
      }

      const remainingGap = parseFloat(gapInfo.remaining_gap) || 0;
      const shouldShow = remainingGap > 0 && gapInfo.session_status !== 'goal_achieved';

      const context: ContinuationContext = {
        goalSessionId,
        userId,
        goalAmount: parseFloat(gapInfo.goal_amount) || 0,
        currentPnL: parseFloat(gapInfo.current_pnl) || 0,
        remainingGap,
        percentageComplete: parseFloat(gapInfo.percentage_complete) || 0,
        tradesCompleted: gapInfo.trades_completed || 0,
        sessionStatus: gapInfo.session_status || 'unknown'
      };

      logger.info(
        LogCategory.TRADING,
        `[Continuation] Continuation check: should_show=${shouldShow}, gap=$${remainingGap.toFixed(2)}, progress=${context.percentageComplete}%`
      );

      return { should: shouldShow, context };
    } catch (error) {
      logger.error(
        LogCategory.TRADING,
        '[Continuation] Exception checking continuation modal:',
        error
      );
      return { should: false, error: 'Exception checking continuation' };
    }
  }

  /**
   * Get formatted continuation modal message
   * SSOT: Uses database function get_continuation_modal_message()
   */
  async getContinuationModalMessage(
    goalSessionId: string
  ): Promise<{ message?: ContinuationModalData; error?: string }> {
    try {
      // SSOT: Call database function to get formatted message
      const { data: modalData, error } = await supabase.rpc(
        'get_continuation_modal_message',
        {
          p_goal_session_id: goalSessionId
        }
      );

      if (error) {
        logger.error(
          LogCategory.TRADING,
          `[Continuation] Error getting modal message: ${error.message}`
        );
        return { error: error.message };
      }

      if (!modalData?.success) {
        logger.warn(
          LogCategory.TRADING,
          `[Continuation] Modal message generation failed: ${modalData?.error}`
        );
        return { error: modalData?.error };
      }

      const message: ContinuationModalData = {
        title: modalData.title || 'Continue Trading?',
        message: modalData.message || 'Trade complete!',
        goalAmount: parseFloat(modalData.goal_amount) || 0,
        currentPnL: parseFloat(modalData.current_pnl) || 0,
        remainingGap: parseFloat(modalData.remaining_gap) || 0,
        percentageComplete: parseFloat(modalData.percentage_complete) || 0,
        showContinueOption: parseFloat(modalData.remaining_gap) > 0
      };

      logger.info(
        LogCategory.TRADING,
        `[Continuation] Modal message prepared: ${message.title}`
      );

      return { message };
    } catch (error) {
      logger.error(
        LogCategory.TRADING,
        '[Continuation] Exception getting continuation modal message:',
        error
      );
      return { error: 'Exception getting continuation message' };
    }
  }

  /**
   * Handle user response to continuation modal
   * SSOT: Delegates to handle_continuation_response() RPC
   */
  async handleUserResponse(
    goalSessionId: string,
    continueScanning: boolean
  ): Promise<{
    success: boolean;
    action?: 'continue_scanning' | 'close_session';
    remainingGap?: number;
    error?: string;
  }> {
    try {
      logger.info(
        LogCategory.TRADING,
        `[Continuation] Handling user response: ${continueScanning ? 'CONTINUE' : 'CLOSE'}`
      );

      // SSOT: Call database RPC to handle response
      const { data: result, error } = await supabase.rpc('handle_continuation_response', {
        p_session_id: goalSessionId,
        p_continue_scanning: continueScanning
      });

      if (error) {
        logger.error(
          LogCategory.TRADING,
          `[Continuation] Error handling response: ${error.message}`
        );
        return { success: false, error: error.message };
      }

      if (!result?.success) {
        logger.warn(
          LogCategory.TRADING,
          `[Continuation] Response handling failed: ${result?.error}`
        );
        return { success: false, error: result?.error };
      }

      const action = result.action as 'continue_scanning' | 'close_session';
      const remainingGap = parseFloat(result.remaining_gap) || 0;

      if (continueScanning) {
        logger.info(
          LogCategory.TRADING,
          `[Continuation] ✅ Session resumed - scanning for remaining $${remainingGap.toFixed(2)}`
        );
      } else {
        logger.info(
          LogCategory.TRADING,
          `[Continuation] ✅ Session closed - achieved $${parseFloat(result.achieved_profit || 0).toFixed(2)} of $${parseFloat(result.target_profit || 0).toFixed(2)} goal`
        );
      }

      return { success: true, action, remainingGap };
    } catch (error) {
      logger.error(
        LogCategory.TRADING,
        '[Continuation] Exception handling user response:',
        error
      );
      return { success: false, error: 'Exception handling continuation response' };
    }
  }

  /**
   * Create continuation modal in database
   * Called when TP2 is hit and gap remains
   */
  async createContinuationModal(
    goalSessionId: string,
    userId: string,
    context: ContinuationContext
  ): Promise<{ success: boolean; modalData?: ContinuationModalData; error?: string }> {
    try {
      // Get formatted modal message
      const messageResult = await this.getContinuationModalMessage(goalSessionId);

      if (messageResult.error) {
        logger.error(
          LogCategory.TRADING,
          `[Continuation] Failed to get modal message: ${messageResult.error}`
        );
        return { success: false, error: messageResult.error };
      }

      const modalData = messageResult.message!;

      // Create pending modal in database
      const { error: createError } = await supabase
        .from('pending_user_modals')
        .insert({
          user_id: userId,
          goal_session_id: goalSessionId,
          modal_type: 'continuation',
          modal_data: {
            title: modalData.title,
            message: modalData.message,
            goal_amount: modalData.goalAmount,
            current_pnl: modalData.currentPnL,
            remaining_gap: modalData.remainingGap,
            percentage_complete: modalData.percentageComplete,
            show_continue_option: modalData.showContinueOption
          },
          expires_at: new Date(Date.now() + 60 * 1000).toISOString() // 60 second timeout
        });

      if (createError) {
        logger.error(
          LogCategory.TRADING,
          `[Continuation] Failed to create modal: ${createError.message}`
        );
        return { success: false, error: createError.message };
      }

      logger.info(
        LogCategory.TRADING,
        `[Continuation] ✅ Continuation modal created - Gap: $${modalData.remainingGap.toFixed(2)}, Progress: ${modalData.percentageComplete}%`
      );

      return { success: true, modalData };
    } catch (error) {
      logger.error(
        LogCategory.TRADING,
        '[Continuation] Exception creating continuation modal:',
        error
      );
      return { success: false, error: 'Exception creating continuation modal' };
    }
  }

  /**
   * Detect when continuation modal should be triggered
   * This is called after a trade closes at TP2
   */
  async handleTradeClosedAtTP2(
    goalSessionId: string,
    userId: string,
    tradeId: string
  ): Promise<{
    triggered: boolean;
    modalData?: ContinuationModalData;
    error?: string;
  }> {
    try {
      logger.info(
        LogCategory.TRADING,
        `[Continuation] Trade closed at TP2 - checking if continuation needed (session: ${goalSessionId}, trade: ${tradeId})`
      );

      // Check if continuation modal should be shown
      const checkResult = await this.shouldShowContinuationModal(goalSessionId, userId);

      if (!checkResult.should || !checkResult.context) {
        logger.info(
          LogCategory.TRADING,
          '[Continuation] No continuation needed - goal complete or no gap remaining'
        );
        return { triggered: false };
      }

      // Create the continuation modal
      const createResult = await this.createContinuationModal(
        goalSessionId,
        userId,
        checkResult.context
      );

      if (!createResult.success) {
        logger.error(
          LogCategory.TRADING,
          `[Continuation] Failed to create modal: ${createResult.error}`
        );
        return { triggered: false, error: createResult.error };
      }

      return { triggered: true, modalData: createResult.modalData };
    } catch (error) {
      logger.error(
        LogCategory.TRADING,
        '[Continuation] Exception handling trade closed at TP2:',
        error
      );
      return { triggered: false, error: 'Exception in continuation flow' };
    }
  }
}

export const continuationDecisionCoordinator = new ContinuationDecisionCoordinator();
