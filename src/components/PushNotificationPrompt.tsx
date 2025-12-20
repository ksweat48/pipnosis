import { useState, useEffect } from 'react';
import { X, Bell } from 'lucide-react';
import { pushSubscriptionService } from '@/services/push-subscription-service';

interface PushNotificationPromptProps {
  trigger: 'first-trade' | 'milestone' | 'manual';
  onClose?: () => void;
}

export function PushNotificationPrompt({ trigger, onClose }: PushNotificationPromptProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    checkPermissionStatus();
  }, []);

  const checkPermissionStatus = async () => {
    const permission = await pushSubscriptionService.getPermissionStatus();
    const dismissed = localStorage.getItem('push-prompt-dismissed');

    if (permission === 'granted') {
      setIsVisible(false);
      return;
    }

    if (permission === 'denied') {
      setIsVisible(false);
      return;
    }

    if (dismissed === 'true') {
      const dismissTime = localStorage.getItem('push-prompt-dismiss-time');
      if (dismissTime) {
        const daysSinceDismiss = (Date.now() - parseInt(dismissTime)) / (1000 * 60 * 60 * 24);
        if (daysSinceDismiss < 3) {
          setIsVisible(false);
          return;
        }
      }
    }

    setIsVisible(true);
  };

  const handleEnable = async () => {
    setIsLoading(true);
    try {
      const subscription = await pushSubscriptionService.subscribe();
      if (subscription) {
        setIsVisible(false);
        onClose?.();
      }
    } catch (error) {
      console.error('[Push Prompt] Error enabling notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMaybeLater = () => {
    localStorage.setItem('push-prompt-dismissed', 'true');
    localStorage.setItem('push-prompt-dismiss-time', Date.now().toString());
    setIsVisible(false);
    onClose?.();
  };

  if (!isVisible) return null;

  const getTriggerContent = () => {
    switch (trigger) {
      case 'first-trade':
        return {
          title: 'Never miss a trade opportunity',
          description: 'Get instant alerts when high-confidence trade signals are detected, even when the app is closed.'
        };
      case 'milestone':
        return {
          title: 'Stay updated on your progress',
          description: 'Receive notifications about your trading milestones, trade completions, and goal achievements.'
        };
      case 'manual':
        return {
          title: 'Enable push notifications',
          description: 'Get real-time alerts for trade signals, entries, exits, and important updates.'
        };
      default:
        return {
          title: 'Enable push notifications',
          description: 'Stay informed about your trading activity with real-time push notifications.'
        };
    }
  };

  const content = getTriggerContent();

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-lg shadow-xl max-w-md w-full p-6 relative">
        <button
          onClick={handleMaybeLater}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-4 mb-4">
          <div className="w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center">
            <Bell className="w-6 h-6 text-blue-400" />
          </div>
          <h3 className="text-xl font-semibold text-slate-100">{content.title}</h3>
        </div>

        <p className="text-slate-300 mb-4">{content.description}</p>

        <div className="space-y-3 mb-6">
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 mt-0.5 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0">
              <div className="w-2 h-2 bg-green-400 rounded-full"></div>
            </div>
            <p className="text-sm text-slate-300">Trade signal alerts when high-confidence setups are detected</p>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 mt-0.5 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0">
              <div className="w-2 h-2 bg-green-400 rounded-full"></div>
            </div>
            <p className="text-sm text-slate-300">Position entry and exit confirmations</p>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 mt-0.5 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0">
              <div className="w-2 h-2 bg-green-400 rounded-full"></div>
            </div>
            <p className="text-sm text-slate-300">Goal achievement celebrations and progress updates</p>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-5 h-5 mt-0.5 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0">
              <div className="w-2 h-2 bg-green-400 rounded-full"></div>
            </div>
            <p className="text-sm text-slate-300">Works even when app is closed or phone is locked</p>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleEnable}
            disabled={isLoading}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Enabling...' : 'Enable Notifications'}
          </button>
          <button
            onClick={handleMaybeLater}
            className="px-4 py-3 text-slate-400 hover:text-slate-200 font-medium transition-colors"
          >
            Maybe Later
          </button>
        </div>

        <p className="text-xs text-slate-500 text-center mt-4">
          You can change this setting anytime in your account settings
        </p>
      </div>
    </div>
  );
}
