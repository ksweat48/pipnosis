import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { GoalAchievedModal } from './GoalAchievedModal';
import { useAuth } from '../hooks/useAuth';

export function GoalNotificationListener() {
  const { user } = useAuth();
  const [activeNotification, setActiveNotification] = useState<any | null>(null);

  useEffect(() => {
    if (!user) return;

    // Check for existing unread goal achievement notifications
    const checkExistingNotifications = async () => {
      const { data } = await supabase
        .from('goal_notifications')
        .select('*')
        .eq('user_id', user.id)
        .eq('type', 'completion')
        .is('action_taken', null)
        .is('acknowledged_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        console.log('[Goal Notifications] Found unread goal achievement notification', data);
        setActiveNotification(data);
      }
    };

    checkExistingNotifications();

    // Set up real-time subscription for new notifications
    const channel = supabase
      .channel('goal_notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'goal_notifications',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          console.log('[Goal Notifications] New notification received:', payload);

          const notification = payload.new;

          // Only show completion (goal achieved) notifications
          if (notification.type === 'completion') {
            setActiveNotification(notification);

            // Play a notification sound (optional)
            try {
              const audio = new Audio('/notification-sound.mp3');
              audio.volume = 0.5;
              audio.play().catch(() => {
                // Ignore audio play errors (browser autoplay policy)
              });
            } catch (error) {
              console.log('[Goal Notifications] Could not play notification sound');
            }
          }
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [user]);

  const handleClose = () => {
    setActiveNotification(null);
  };

  const handleActionTaken = () => {
    // Refresh the page to show updated information
    setTimeout(() => {
      window.location.reload();
    }, 2000);
  };

  if (!activeNotification) {
    return null;
  }

  return (
    <GoalAchievedModal
      notification={activeNotification}
      onClose={handleClose}
      onActionTaken={handleActionTaken}
    />
  );
}
