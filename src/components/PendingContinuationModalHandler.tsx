import React, { useEffect, useState } from 'react';
import { modalQueueManager, PendingModal } from '@/services/modal-queue-manager';
import { simpleScanningTimer } from '@/services/simple-scanning-timer';
import { ContinuationDialog } from './ContinuationDialog';

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
    loadPendingContinuationModal();

    modalQueueManager.subscribeToModalUpdates(userId, () => {
      loadPendingContinuationModal();
    });

    return () => {
      modalQueueManager.unsubscribeFromModalUpdates();
    };
  }, [userId]);

  const loadPendingContinuationModal = async () => {
    try {
      const modals = await modalQueueManager.getPendingModals(userId);

      const continuationModal = modals.find(m => m.modal_type === 'continuation');

      if (continuationModal) {
        console.log('[PendingContinuationModal] Found continuation modal:', continuationModal.id);
        setPendingModal(continuationModal);
      } else {
        setPendingModal(null);
      }
    } catch (error) {
      console.error('[PendingContinuationModal] Error loading modal:', error);
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

  if (!pendingModal) {
    return null;
  }

  const { modal_data } = pendingModal;

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
