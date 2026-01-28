import React, { useEffect, useState } from 'react';
import { modalQueueManager, PendingModal } from '@/services/modal-queue-manager';
import { simpleScanningTimer } from '@/services/simple-scanning-timer';
import { SessionContinuationModal } from './SessionContinuationModal';
import { SessionEndedDialog } from './SessionEndedDialog';
import { TradeClosedActionDialog } from './TradeClosedActionDialog';
import { supabase } from '@/lib/supabase';
import { goalSessionStateMachine } from '@/services/coordinators/goal-session-state-machine';
import { modalStateRecoveryService } from '@/services/modal-state-recovery';
import { useToast } from '@/hooks/useToast';

interface PendingContinuationModalHandlerProps {
  userId: string;
  onModalDismissed?: () => void;
}

export const PendingContinuationModalHandler: React.FC<PendingContinuationModalHandlerProps> = ({
  userId,
  onModalDismissed
}) => {
  const [pendingModal, setPendingModal] = useState<PendingModal | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { error: showError, success: showSuccess } = useToast();

  useEffect(() => {
    loadPendingModal();

    modalQueueManager.subscribeToModalUpdates(userId, () => {
      loadPendingModal();
    });

    return () => {
      modalQueueManager.unsubscribeFromModalUpdates();
    };
  }, [userId]);

  const loadPendingModal = async () => {
    try {
      const modals = await modalQueueManager.getPendingModals(userId);

      // Priority 1: Trade closed (most urgent - user needs to decide what to do)
      const tradeClosedModal = modals.find(m => m.modal_type === 'trade_closed');
      if (tradeClosedModal) {
        console.log('[PendingModalHandler] Found trade_closed modal:', tradeClosedModal.id);
        setPendingModal(tradeClosedModal);
        return;
      }

      // Priority 2: Session ended (informational)
      const sessionEndedModal = modals.find(m => m.modal_type === 'session_ended');
      if (sessionEndedModal) {
        console.log('[PendingModalHandler] Found session_ended modal:', sessionEndedModal.id);
        setPendingModal(sessionEndedModal);
        return;
      }

      // Priority 3: Continuation (15-min scan timeout)
      const continuationModal = modals.find(m => m.modal_type === 'continuation');
      if (continuationModal) {
        console.log('[PendingModalHandler] Found continuation modal:', continuationModal.id);
        setPendingModal(continuationModal);
        return;
      }

      setPendingModal(null);
    } catch (error) {
      console.error('[PendingModalHandler] Error loading modal:', error);
    }
  };

  const handleContinue = async () => {
    if (!pendingModal) return;

    const sessionId = pendingModal.goal_session_id || pendingModal.modal_data.session_id;
    if (!sessionId) {
      console.error('[PendingContinuationModal] No session_id found in modal');
      return;
    }

    setIsLoading(true);

    try {
      console.log('[PendingContinuationModal] User chose to continue scanning');

      // SSOT: Call database function to handle continuation decision
      const { data, error } = await supabase.rpc('handle_continuation_decision', {
        p_session_id: sessionId,
        p_decision: 'continue'
      });

      if (error) {
        console.error('[PendingContinuationModal] Failed to handle continuation:', error);
        // Fallback to old method if new RPC fails
        await simpleScanningTimer.handleContinuationResponse(sessionId, true);
      } else {
        console.log('[PendingContinuationModal] ✅ Session will continue scanning', data);
      }

      await modalQueueManager.dismissModal(pendingModal.id, 'continue');

      setPendingModal(null);
      onModalDismissed?.();

      // Reload page to restart scanning
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      console.error('[PendingContinuationModal] Error handling continue:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    if (!pendingModal) return;

    const sessionId = pendingModal.goal_session_id || pendingModal.modal_data.session_id;
    if (!sessionId) {
      console.error('[PendingContinuationModal] No session_id found in modal');
      return;
    }

    setIsLoading(true);

    try {
      console.log('[PendingContinuationModal] User chose to close session');

      // SSOT: Call database function to handle continuation decision
      const { data, error } = await supabase.rpc('handle_continuation_decision', {
        p_session_id: sessionId,
        p_decision: 'close'
      });

      if (error) {
        console.error('[PendingContinuationModal] Failed to handle close:', error);
        // Fallback to old method if new RPC fails
        await simpleScanningTimer.handleContinuationResponse(sessionId, false);
      } else {
        console.log('[PendingContinuationModal] ✅ Session closed', data);
      }

      await modalQueueManager.dismissModal(pendingModal.id, 'close');

      setPendingModal(null);
      onModalDismissed?.();

      // Reload page to show session completed
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      console.error('[PendingContinuationModal] Error handling stop:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSessionEndedDismiss = async () => {
    if (!pendingModal) return;

    setIsLoading(true);

    try {
      console.log('[PendingModalHandler] Dismissing session_ended modal');
      await modalQueueManager.dismissModal(pendingModal.id, 'acknowledged');
      setPendingModal(null);
      onModalDismissed?.();
    } catch (error) {
      console.error('[PendingModalHandler] Error dismissing modal:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartNewSession = () => {
    console.log('[PendingModalHandler] User starting new session');
  };

  const handleTradeClosedContinue = async () => {
    if (!pendingModal) return;

    const sessionId = pendingModal.goal_session_id || pendingModal.modal_data.session_id;
    if (!sessionId) {
      console.error('[PendingModalHandler] No session_id found in trade_closed modal');
      showError('Session ID not found');
      return;
    }

    setIsLoading(true);

    try {
      console.log('[PendingModalHandler] User chose to continue after trade close');

      // SSOT: Use modal state recovery service for atomic, recoverable state transitions
      const actionResult = await modalStateRecoveryService.handleModalAction(
        sessionId,
        pendingModal.id,
        userId,
        'continue'
      );

      if (!actionResult.success) {
        console.error('[PendingModalHandler] Modal action failed:', actionResult.errorMessage);
        showError(actionResult.errorMessage || 'Failed to continue session. Please refresh and try again.');
        return;
      }

      // Action succeeded - validate state before reload
      const isStateValid = await modalStateRecoveryService.validateStateBeforeReload(sessionId);
      if (!isStateValid) {
        console.warn('[PendingModalHandler] Session in unexpected state, but proceeding with reload');
        showError('Warning: Session may not be in expected state. Reloading...');
      }

      setPendingModal(null);
      onModalDismissed?.();
      showSuccess('Session resumed - scanning for new opportunities');

      // Reload to restart scanning with fresh state
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('[PendingModalHandler] Unexpected error handling trade closed continue:', error);
      showError('An unexpected error occurred. Please refresh the page.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTradeClosedStartNew = async () => {
    if (!pendingModal) return;

    const sessionId = pendingModal.goal_session_id || pendingModal.modal_data.session_id;
    if (!sessionId) {
      console.error('[PendingModalHandler] No session_id found in trade_closed modal');
      showError('Session ID not found');
      return;
    }

    setIsLoading(true);

    try {
      console.log('[PendingModalHandler] User chose to start new session after trade close');

      // SSOT: Use modal state recovery service for atomic, recoverable state transitions
      const actionResult = await modalStateRecoveryService.handleModalAction(
        sessionId,
        pendingModal.id,
        userId,
        'start_new'
      );

      if (!actionResult.success) {
        console.error('[PendingModalHandler] Modal action failed:', actionResult.errorMessage);
        showError(actionResult.errorMessage || 'Failed to close session. Please refresh and try again.');
        return;
      }

      // Action succeeded - validate state before reload
      const isStateValid = await modalStateRecoveryService.validateStateBeforeReload(sessionId);
      if (!isStateValid) {
        console.warn('[PendingModalHandler] Session in unexpected state, but proceeding with reload');
        showError('Warning: Session may not be in expected state. Reloading...');
      }

      setPendingModal(null);
      onModalDismissed?.();
      showSuccess('Session closed - ready to start a fresh session');

      // Reload to show closed session state
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('[PendingModalHandler] Unexpected error handling trade closed start new:', error);
      showError('An unexpected error occurred. Please refresh the page.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTradeClosedClose = async () => {
    if (!pendingModal) return;

    const sessionId = pendingModal.goal_session_id || pendingModal.modal_data.session_id;
    if (!sessionId) {
      console.error('[PendingModalHandler] No session_id found in trade_closed modal');
      showError('Session ID not found');
      return;
    }

    setIsLoading(true);

    try {
      console.log('[PendingModalHandler] User chose to close after trade close');

      // SSOT: Use modal state recovery service for atomic, recoverable state transitions
      const actionResult = await modalStateRecoveryService.handleModalAction(
        sessionId,
        pendingModal.id,
        userId,
        'close'
      );

      if (!actionResult.success) {
        console.error('[PendingModalHandler] Modal action failed:', actionResult.errorMessage);
        showError(actionResult.errorMessage || 'Failed to close session. Please refresh and try again.');
        return;
      }

      // Action succeeded - validate state before reload
      const isStateValid = await modalStateRecoveryService.validateStateBeforeReload(sessionId);
      if (!isStateValid) {
        console.warn('[PendingModalHandler] Session in unexpected state, but proceeding with reload');
        showError('Warning: Session may not be in expected state. Reloading...');
      }

      setPendingModal(null);
      onModalDismissed?.();
      showSuccess('Session closed for now');

      // Reload to show stopped state
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('[PendingModalHandler] Unexpected error handling trade closed close:', error);
      showError('An unexpected error occurred. Please refresh the page.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!pendingModal) {
    return null;
  }

  const { modal_data, modal_type } = pendingModal;

  if (modal_type === 'trade_closed') {
    return (
      <TradeClosedActionDialog
        isOpen={true}
        symbol={modal_data.symbol || 'UNKNOWN'}
        direction={modal_data.direction as 'buy' | 'sell' || 'buy'}
        entryPrice={modal_data.entry_price || 0}
        exitPrice={modal_data.exit_price || 0}
        profitLoss={modal_data.profit_loss || 0}
        closeReason={(modal_data.close_reason as 'stop_loss' | 'take_profit' | 'manual' | 'goal_met') || 'manual'}
        stopLoss={modal_data.stop_loss || 0}
        takeProfit={modal_data.take_profit || 0}
        currentProgress={modal_data.current_progress || 0}
        targetValue={modal_data.target_value || 0}
        tradesInSession={modal_data.trades_in_session || 0}
        isGoalAchieved={modal_data.isGoalAchieved || false}
        onStartNewSession={handleTradeClosedStartNew}
        onContinueSession={handleTradeClosedContinue}
        onCloseForNow={handleTradeClosedClose}
        isLoading={isLoading}
        timestamp={modal_data.timestamp}
      />
    );
  }

  if (modal_type === 'session_ended') {
    return (
      <SessionEndedDialog
        isOpen={true}
        closeReason={(modal_data.close_reason as 'timeout' | 'safety_net' | 'user_stopped') || 'timeout'}
        durationMinutes={modal_data.duration_minutes || 0}
        tradesInSession={modal_data.trades_in_session || 0}
        currentProgress={modal_data.current_progress || 0}
        targetValue={modal_data.target_value || 0}
        message={modal_data.message || 'Your session has ended.'}
        onDismiss={handleSessionEndedDismiss}
        onStartNewSession={handleStartNewSession}
      />
    );
  }

  // Use SessionContinuationModal for 15-min scan timeout continuations
  return (
    <SessionContinuationModal
      isOpen={true}
      sessionId={pendingModal.goal_session_id || modal_data.session_id || ''}
      symbol={modal_data.symbol}
      reason={modal_data.reason || 'No trades found in 15 minutes'}
      onContinue={handleContinue}
      onClose={handleStop}
      deadlineTimestamp={modal_data.deadline}
      isLoading={isLoading}
    />
  );
};
