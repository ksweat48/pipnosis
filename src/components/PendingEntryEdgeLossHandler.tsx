import React, { useEffect, useState } from 'react';
import { modalQueueManager, PendingModal } from '@/services/modal-queue-manager';
import { EntryEdgeLossModal } from './EntryEdgeLossModal';

interface PendingEntryEdgeLossHandlerProps {
  userId: string;
  onModalDismissed?: () => void;
}

export const PendingEntryEdgeLossHandler: React.FC<PendingEntryEdgeLossHandlerProps> = ({
  userId,
  onModalDismissed
}) => {
  const [pendingModal, setPendingModal] = useState<PendingModal | null>(null);

  useEffect(() => {
    loadPendingModal();

    // Subscribe to modal updates
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

      // Look for entry_edge_loss modal
      const edgeLossModal = modals.find(m => m.modal_type === 'entry_edge_loss');

      if (edgeLossModal) {
        console.log('[PendingEntryEdgeLoss] Found edge loss modal:', edgeLossModal.id);
        setPendingModal(edgeLossModal);
        return;
      }

      setPendingModal(null);
    } catch (error) {
      console.error('[PendingEntryEdgeLoss] Error loading modal:', error);
    }
  };

  const handleModalClose = () => {
    setPendingModal(null);
    onModalDismissed?.();
  };

  if (!pendingModal || pendingModal.modal_type !== 'entry_edge_loss') {
    return null;
  }

  return (
    <EntryEdgeLossModal
      modalId={pendingModal.modal_data.modal_id}
      intentData={{
        symbol: pendingModal.modal_data.symbol || 'UNKNOWN',
        direction: (pendingModal.modal_data.direction as 'long' | 'short') || 'long',
        style: pendingModal.modal_data.style || 'MICRO_INTRADAY',
        entry_zone_min: pendingModal.modal_data.entry_zone_min || 0,
        entry_zone_max: pendingModal.modal_data.entry_zone_max || 0,
        created_at: pendingModal.modal_data.created_at || new Date().toISOString(),
        timeout_minutes: pendingModal.modal_data.timeout_minutes || 45
      }}
      onClose={handleModalClose}
    />
  );
};
