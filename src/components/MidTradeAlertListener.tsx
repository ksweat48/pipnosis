import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { MidTradeAlertModal } from './MidTradeAlertModal';
import { audioAlertService } from '../services/audio-alert-service';
import { logger } from '../lib/logger';

interface MidTradeAlertListenerProps {
  userId: string;
}

export function MidTradeAlertListener({ userId }: MidTradeAlertListenerProps) {
  const [activeAlert, setActiveAlert] = useState<any | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  useEffect(() => {
    if (!userId) return;

    // Fetch any existing unexecuted alerts
    const fetchPendingAlerts = async () => {
      try {
        const { data: pendingAlerts } = await supabase
          .from('goal_notifications')
          .select('*')
          .eq('user_id', userId)
          .eq('requires_user_alert', true)
          .eq('executed', false)
          .eq('viewed', false)
          .order('created_at', { ascending: false })
          .limit(1);

        if (pendingAlerts && pendingAlerts.length > 0) {
          const alert = pendingAlerts[0];
          setActiveAlert(alert);

          // Play alert sound
          audioAlertService.playWithContext({ type: 'critical', context: 'mid_trade_alert' });

          logger.info('[MidTradeAlert] Loaded pending alert:', {
            notification_id: alert.id,
            recommendation: alert.recommendation_data?.recommendation
          });
        }
      } catch (error) {
        logger.error('[MidTradeAlert] Error fetching pending alerts:', error);
      }
    };

    fetchPendingAlerts();

    // Subscribe to new alert notifications
    const channel = supabase
      .channel(`mid_trade_alerts_${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'goal_notifications',
          filter: `user_id=eq.${userId}`
        },
        async (payload) => {
          const notification = payload.new as any;

          // Only show if requires user alert and not yet executed
          if (notification.requires_user_alert && !notification.executed && !notification.viewed) {
            logger.info('[MidTradeAlert] New alert received:', {
              notification_id: notification.id,
              recommendation: notification.recommendation_data?.recommendation,
              auto_execute_at: notification.auto_execute_at
            });

            setActiveAlert(notification);

            // Play alert sound
            audioAlertService.playWithContext({ type: 'critical', context: 'mid_trade_alert' });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const handleExecuted = async () => {
    if (!activeAlert || isExecuting) return;

    setIsExecuting(true);

    try {
      logger.info('[MidTradeAlert] Auto-executing recommendation:', {
        notification_id: activeAlert.id,
        recommendation: activeAlert.recommendation_data?.recommendation
      });

      // Call execution service
      const { data, error } = await supabase.functions.invoke('execute-mid-trade-alert', {
        body: {
          notification_id: activeAlert.id
        }
      });

      if (error) {
        logger.error('[MidTradeAlert] Error executing alert:', error);
      } else {
        logger.info('[MidTradeAlert] Alert executed successfully:', data);
      }

      // Close modal and reset
      setActiveAlert(null);
      setIsExecuting(false);
    } catch (error) {
      logger.error('[MidTradeAlert] Exception during execution:', error);
      setIsExecuting(false);
    }
  };

  const handleClose = () => {
    // User dismissed modal but execution will still happen
    logger.info('[MidTradeAlert] User dismissed modal (execution continues)');
    setActiveAlert(null);
  };

  if (!activeAlert) return null;

  return (
    <MidTradeAlertModal
      notification={activeAlert}
      onClose={handleClose}
      onExecuted={handleExecuted}
    />
  );
}
