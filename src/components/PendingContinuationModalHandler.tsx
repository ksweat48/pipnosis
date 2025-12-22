import React, { useEffect, useState } from 'react';
import { modalQueueManager, PendingModal } from '@/services/modal-queue-manager';
import { simpleScanningTimer } from '@/services/simple-scanning-timer';
import { ContinuationDialog } from './ContinuationDialog';
import { SessionEndedDialog } from './SessionEndedDialog';

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
    if (!pendingModal || !pendingModal.modal_data.session_id) return;

    setIsLoading(true);

    try {
      console.log('[PendingContinuationModal] User chose to continue scanning');

      await simpleScanningTimer.handleContinuationResponse(
        pendingModal.modal_data.session_id,
        true
      );

      await modalQueueManager.dismissModal(pendingModal.id, 'continue');

      setPendingModal(null);
      onModalDismissed?.();
    } catch (error) {
      console.error('[PendingContinuationModal] Error handling continue:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    if (!pendingModal || !pendingModal.modal_data.session_id) return;

    setIsLoading(true);

    try {
      console.log('[PendingContinuationModal] User chose to stop scanning');

      await simpleScanningTimer.handleContinuationResponse(
        pendingModal.modal_data.session_id,
        false
      );

      await modalQueueManager.dismissModal(pendingModal.id, 'close');

      setPendingModal(null);
      onModalDismissed?.();
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

  return (
    <ContinuationDialog
      isOpen={true}
      continuationPrompt={
        modal_data.continuation_prompt ||
        'No trade opportunities found in the last 15 minutes. Would you like to continue scanning or close this session?'
      }
      tradesInSession={modal_data.trades_in_session || 0}
      currentProgress={modal_data.current_progress || 0}
      targetValue={modal_data.target_value || 0}
      onContinue={handleContinue}
      onStop={handleStop}
      isLoading={isLoading}
    />
  );
};
