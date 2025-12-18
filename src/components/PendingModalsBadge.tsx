import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { modalQueueManager } from '@/services/modal-queue-manager';

interface PendingModalsBadgeProps {
  userId: string;
}

export const PendingModalsBadge: React.FC<PendingModalsBadgeProps> = ({ userId }) => {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!userId) return;

    const fetchPendingCount = async () => {
      const count = await modalQueueManager.getPendingModalCount(userId);
      setPendingCount(count);
    };

    // Fetch initially
    fetchPendingCount();

    // Subscribe to updates
    modalQueueManager.subscribeToModalUpdates(userId, fetchPendingCount);

    return () => {
      modalQueueManager.unsubscribeFromModalUpdates();
    };
  }, [userId]);

  if (pendingCount === 0) {
    return null;
  }

  return (
    <div className="relative">
      <Bell className="h-5 w-5 text-amber-400 animate-pulse" />
      <div className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center font-bold">
        {pendingCount > 9 ? '9+' : pendingCount}
      </div>
    </div>
  );
};
