import React, { useEffect, useState } from 'react';
import { modalQueueManager, PendingModal } from '@/services/modal-queue-manager';
import { simpleScanningTimer } from '@/services/simple-scanning-timer';
import { SessionContinuationModal } from './SessionContinuationModal';
import { SessionEndedDialog } from './SessionEndedDialog';
import { TradeClosedActionDialog } from './TradeClosedActionDialog';
import { supabase } from '@/lib/supabase';
import { goalSessionStateMachine } from '@/services/coordinators/goal-session-state-machine';

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
      return;
    }

    setIsLoading(true);

    try {
      console.log('[PendingModalHandler] User chose to continue after trade close');

      // Transition session back to scanning (SSOT: use state machine)
      const transitionResult = await goalSessionStateMachine.transition(sessionId, 'scanning', {
        reason: 'User chose to continue after trade close',
        triggeredBy: 'TradeClosedModal',
      });

      if (!transitionResult.success) {
        console.error('[PendingModalHandler] Failed to transition to scanning:', transitionResult.error);
      }

      await modalQueueManager.dismissModal(pendingModal.id, 'continue');

      setPendingModal(null);
      onModalDismissed?.();

      // Reload to restart scanning
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      console.error('[PendingModalHandler] Error handling trade closed continue:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTradeClosedStartNew = async () => {
    if (!pendingModal) return;

    const sessionId = pendingModal.goal_session_id || pendingModal.modal_data.session_id;
    if (!sessionId) {
      console.error('[PendingModalHandler] No session_id found in trade_closed modal');
      return;
    }

    setIsLoading(true);

    try {
      console.log('[PendingModalHandler] User chose to start new session after trade close');

      // Transition session to stopped (SSOT: use state machine)
      const transitionResult = await goalSessionStateMachine.transition(sessionId, 'stopped', {
        reason: 'User chose to start new session after trade close',
        triggeredBy: 'TradeClosedModal',
      });

      if (!transitionResult.success) {
        console.error('[PendingModalHandler] Failed to stop session:', transitionResult.error);
      }

      await modalQueueManager.dismissModal(pendingModal.id, 'close');

      setPendingModal(null);
      onModalDismissed?.();

      // Reload to show fresh start
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      console.error('[PendingModalHandler] Error handling trade closed start new:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTradeClosedClose = async () => {
    if (!pendingModal) return;

    const sessionId = pendingModal.goal_session_id || pendingModal.modal_data.session_id;
    if (!sessionId) {
      console.error('[PendingModalHandler] No session_id found in trade_closed modal');
      return;
    }

    setIsLoading(true);

    try {
      console.log('[PendingModalHandler] User chose to close after trade close');

      // Transition session to stopped (SSOT: use state machine)
      const transitionResult = await goalSessionStateMachine.transition(sessionId, 'stopped', {
        reason: 'User closed session after trade close',
        triggeredBy: 'TradeClosedModal',
      });

      if (!transitionResult.success) {
        console.error('[PendingModalHandler] Failed to stop session:', transitionResult.error);
      }

      await modalQueueManager.dismissModal(pendingModal.id, 'close');

      setPendingModal(null);
      onModalDismissed?.();

      // Reload to show stopped state
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (error) {
      console.error('[PendingModalHandler] Error handling trade closed close:', error);
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
