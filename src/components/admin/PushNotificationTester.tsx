import { useState, useEffect } from 'react';
import { Bell, Send, Users, CheckCircle, AlertCircle, Smartphone } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { pushNotificationDispatcher, type NotificationType, type NotificationPriority } from '@/services/push-notification-dispatcher';

interface UserWithDevices {
  id: string;
  email: string;
  deviceCount: number;
}

export function PushNotificationTester() {
  const [users, setUsers] = useState<UserWithDevices[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [notificationType, setNotificationType] = useState<NotificationType>('trade-signal');
  const [priority, setPriority] = useState<NotificationPriority>('high');
  const [customTitle, setCustomTitle] = useState('');
  const [customBody, setCustomBody] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [deliveryStats, setDeliveryStats] = useState<any>(null);

  useEffect(() => {
    loadUsers();
    loadDeliveryStats();
  }, []);

  const loadUsers = async () => {
    try {
      const { data: profiles, error } = await supabase
        .from('user_profiles')
        .select('id, email')
        .order('email');

      if (error) throw error;

      const usersWithDeviceCounts = await Promise.all(
        (profiles || []).map(async (profile) => {
          const { count } = await supabase
            .from('push_subscriptions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', profile.id)
            .eq('is_active', true);

          return {
            id: profile.id,
            email: profile.email,
            deviceCount: count || 0
          };
        })
      );

      setUsers(usersWithDeviceCounts.filter(u => u.deviceCount > 0));
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const loadDeliveryStats = async () => {
    try {
      const { data, error } = await supabase
        .from('goal_notifications')
        .select('push_sent, push_delivery_status, push_devices_sent_count, push_devices_delivered_count')
        .eq('push_sent', true)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      if (data && data.length > 0) {
        const totalSent = data.reduce((sum, n) => sum + (n.push_devices_sent_count || 0), 0);
        const totalDelivered = data.reduce((sum, n) => sum + (n.push_devices_delivered_count || 0), 0);
        const deliveryRate = totalSent > 0 ? ((totalDelivered / totalSent) * 100).toFixed(1) : '0';

        setDeliveryStats({
          totalNotifications: data.length,
          totalDevicesSent: totalSent,
          totalDevicesDelivered: totalDelivered,
          deliveryRate
        });
      }
    } catch (error) {
      console.error('Error loading delivery stats:', error);
    }
  };

  const handleSendTest = async () => {
    if (!selectedUser) {
      setResult({ type: 'error', message: 'Please select a user' });
      return;
    }

    try {
      setSending(true);
      setResult(null);

      let success = false;

      switch (notificationType) {
        case 'trade-signal':
          success = await pushNotificationDispatcher.sendTradeSignal({
            userId: selectedUser,
            symbol: customTitle || 'EURUSD',
            direction: 'buy',
            setupType: customBody || 'Test Signal',
            confidence: 85,
            entryPrice: 1.0850,
            stopLoss: 1.0800,
            takeProfit: 1.0950
          });
          break;

        case 'trade-entry':
          success = await pushNotificationDispatcher.sendTradeEntry({
            userId: selectedUser,
            tradeId: 'test-' + Date.now(),
            symbol: customTitle || 'EURUSD',
            direction: 'buy',
            entryPrice: 1.0850,
            lotSize: 0.1,
            stopLoss: 1.0800,
            takeProfit: 1.0950
          });
          break;

        case 'trade-closed':
          success = await pushNotificationDispatcher.sendTradeClosed({
            userId: selectedUser,
            tradeId: 'test-' + Date.now(),
            symbol: customTitle || 'EURUSD',
            direction: 'buy',
            profit: 50,
            closeReason: customBody || 'Test Close',
            duration: '15m'
          });
          break;

        case 'mid-trade-alert':
          success = await pushNotificationDispatcher.sendMidTradeAlert({
            userId: selectedUser,
            tradeId: 'test-' + Date.now(),
            symbol: customTitle || 'EURUSD',
            triggerReason: customBody || 'Test Alert',
            llmRecommendation: 'Hold position',
            priority
          });
          break;

        case 'goal-achieved':
          success = await pushNotificationDispatcher.sendGoalAchieved({
            userId: selectedUser,
            goalSessionId: 'test-' + Date.now(),
            goalAmount: 100,
            actualAmount: 150,
            tradesCount: 5
          });
          break;

        case 'goal-progress':
          success = await pushNotificationDispatcher.sendGoalProgress({
            userId: selectedUser,
            goalSessionId: 'test-' + Date.now(),
            currentProgress: 75,
            targetAmount: 100,
            progressPercentage: 75
          });
          break;
      }

      if (success) {
        setResult({
          type: 'success',
          message: `Test notification sent successfully to user's devices`
        });
        await loadDeliveryStats();
      } else {
        setResult({
          type: 'error',
          message: 'Failed to send notification - check logs for details'
        });
      }
    } catch (error) {
      console.error('Error sending test notification:', error);
      setResult({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <Bell size={20} className="text-emerald-400" />
        <h2 className="text-xl font-semibold text-white">Push Notification Tester</h2>
      </div>

      {deliveryStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
            <div className="text-xs text-gray-400 mb-1">Total Sent</div>
            <div className="text-2xl font-bold text-white">{deliveryStats.totalNotifications}</div>
          </div>
          <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
            <div className="text-xs text-gray-400 mb-1">Devices Sent</div>
            <div className="text-2xl font-bold text-white">{deliveryStats.totalDevicesSent}</div>
          </div>
          <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
            <div className="text-xs text-gray-400 mb-1">Delivered</div>
            <div className="text-2xl font-bold text-emerald-400">{deliveryStats.totalDevicesDelivered}</div>
          </div>
          <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
            <div className="text-xs text-gray-400 mb-1">Delivery Rate</div>
            <div className="text-2xl font-bold text-blue-400">{deliveryStats.deliveryRate}%</div>
          </div>
        </div>
      )}

      {result && (
        <div
          className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
            result.type === 'success'
              ? 'bg-green-900/20 border border-green-700/30 text-green-400'
              : 'bg-red-900/20 border border-red-700/30 text-red-400'
          }`}
        >
          {result.type === 'success' ? (
            <CheckCircle size={20} />
          ) : (
            <AlertCircle size={20} />
          )}
          <span>{result.message}</span>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Select User
          </label>
          <select
            value={selectedUser}
            onChange={(e) => setSelectedUser(e.target.value)}
            className="w-full px-4 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="">Choose a user...</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.email} ({user.deviceCount} {user.deviceCount === 1 ? 'device' : 'devices'})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Notification Type
          </label>
          <select
            value={notificationType}
            onChange={(e) => setNotificationType(e.target.value as NotificationType)}
            className="w-full px-4 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="trade-signal">Trade Signal</option>
            <option value="trade-entry">Trade Entry</option>
            <option value="trade-closed">Trade Closed</option>
            <option value="mid-trade-alert">Mid-Trade Alert</option>
            <option value="goal-achieved">Goal Achieved</option>
            <option value="goal-progress">Goal Progress</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Priority
          </label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as NotificationPriority)}
            className="w-full px-4 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Custom Title (optional)
          </label>
          <input
            type="text"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            placeholder="e.g., XAUUSD or Custom Title"
            className="w-full px-4 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Custom Body (optional)
          </label>
          <input
            type="text"
            value={customBody}
            onChange={(e) => setCustomBody(e.target.value)}
            placeholder="e.g., Custom message text"
            className="w-full px-4 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <button
          onClick={handleSendTest}
          disabled={sending || !selectedUser}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
        >
          {sending ? (
            <>
              <div className="animate-spin h-5 w-5 border-2 border-white/30 border-t-white rounded-full"></div>
              <span>Sending...</span>
            </>
          ) : (
            <>
              <Send size={18} />
              <span>Send Test Notification</span>
            </>
          )}
        </button>
      </div>

      <div className="mt-6 p-4 bg-blue-900/20 border border-blue-700/30 rounded-lg">
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-300">
            <p className="font-medium mb-1">Testing Notes</p>
            <ul className="text-xs text-blue-300/80 space-y-1 list-disc list-inside">
              <li>Test notifications are sent to all active devices for the selected user</li>
              <li>Delivery status is tracked in the goal_notifications table</li>
              <li>Failed deliveries automatically mark subscriptions as inactive</li>
              <li>Rate limiting applies: max 10 notifications per user per minute</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
