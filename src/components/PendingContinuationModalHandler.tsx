import React, { useEffect, useState } from 'react';
import { modalQueueManager, PendingModal } from '@/services/modal-queue-manager';
import { simpleScanningTimer } from '@/services/simple-scanning-timer';
import { SessionContinuationModal } from './SessionContinuationModal';
import { SessionEndedDialog } from './SessionEndedDialog';
import { supabase } from '@/lib/supabase';

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

      const sessionEndedModal = modals.find(m => m.modal_type === 'session_ended');
      if (sessionEndedModal) {
        console.log('[PendingModalHandler] Found session_ended modal:', sessionEndedModal.id);
        setPendingModal(sessionEndedModal);
        return;
      }

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

  if (!pendingModal) {
    return null;
  }

  const { modal_data, modal_type } = pendingModal;

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

  // Use SessionContinuationModal for entry intent timeout continuations
  return (
    <SessionContinuationModal
      isOpen={true}
      sessionId={pendingModal.goal_session_id || modal_data.session_id || ''}
      symbol={modal_data.symbol}
      reason={modal_data.reason || 'Entry intent timed out'}
      onContinue={handleContinue}
      onClose={handleStop}
      deadlineTimestamp={modal_data.deadline}
      isLoading={isLoading}
    />
  );
};
