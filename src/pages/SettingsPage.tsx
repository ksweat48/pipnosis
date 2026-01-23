import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { NavigationMenu } from '@/components/NavigationMenu';
import { BottomNavigation } from '@/components/BottomNavigation';
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { usePWAUpdate } from '@/hooks/usePWAUpdate';
import { supabase } from '@/lib/supabase';
import { User, Mail, Calendar, Shield, Bell, TrendingUp, Save, Eye, EyeOff, Lock, CheckCircle, AlertCircle, Activity, DollarSign, Zap, RefreshCw, Smartphone, ChevronDown, Clock, BarChart3 } from 'lucide-react';
import { validatePassword, passwordsMatch } from '@/utils/passwordValidation';
import { chartPreferencesService, type IndicatorVisibility } from '@/services/chart-preferences';
import { useToast } from '@/hooks/useToast';
import { pushSubscriptionService, type DeviceInfo } from '@/services/push-subscription-service';
import { pushNotificationDispatcher } from '@/services/push-notification-dispatcher';

export function SettingsPage() {
  const { user, updatePassword } = useAuth();
  const toast = useToast();
  const { currentVersion, checkForUpdates, isChecking, updateAvailable, applyUpdate } = usePWAUpdate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [preferences, setPreferences] = useState({
    emailNotifications: true,
    tradeNotifications: true,
    goalNotifications: true,
    weeklyReports: false,
    multiTradeMode: false,
  });

  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false,
  });
  const [passwordUpdating, setPasswordUpdating] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [indicatorVisibility, setIndicatorVisibility] = useState<IndicatorVisibility>({
    vwap: true,
    ema20: true,
    ema50: false,
    ema200: false
  });
  const [savingIndicators, setSavingIndicators] = useState(false);
  const [indicatorMessage, setIndicatorMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [monitorPreferences, setMonitorPreferences] = useState({
    entryPriceMonitorEnabled: true,
    sessionIntelligenceEnabled: true,
    vwapKissMonitorEnabled: true,
  });
  const [savingMonitors, setSavingMonitors] = useState(false);
  const [monitorMessage, setMonitorMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [accountBalance, setAccountBalance] = useState<string>('10000.00');
  const [savingBalance, setSavingBalance] = useState(false);
  const [balanceMessage, setBalanceMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showBalanceConfirmModal, setShowBalanceConfirmModal] = useState(false);

  const [pushDevices, setPushDevices] = useState<DeviceInfo[]>([]);
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default');
  const [loadingPush, setLoadingPush] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [editingDevice, setEditingDevice] = useState<{ id: string; name: string } | null>(null);

  const [collapsedSections, setCollapsedSections] = useState({
    accountInfo: true,
    accountManagement: true,
    tradingBehavior: true,
    tradingMonitors: true,
    notifications: true,
    chartDisplay: true,
    security: true,
    appInfo: true,
  });

  const toggleSection = (section: keyof typeof collapsedSections) => {
    setCollapsedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const pullToRefresh = usePullToRefresh({
    onRefresh: async () => {
      window.location.reload();
    },
    enabled: true
  });

  useEffect(() => {
    if (user) {
      loadUserData();
      loadIndicatorPreferences();
      loadMonitorPreferences();
      loadPushSettings();
    }
  }, [user]);

  const loadUserData = async () => {
    try {
      setLoading(true);

      const { data: profileData, error: profileError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', user?.id)
        .maybeSingle();

      if (profileError) {
        console.error('Error loading profile:', profileError);
      } else if (profileData) {
        setProfile(profileData);

        if (profileData.preferences) {
          setPreferences({
            emailNotifications: profileData.preferences.emailNotifications ?? true,
            tradeNotifications: profileData.preferences.tradeNotifications ?? true,
            goalNotifications: profileData.preferences.goalNotifications ?? true,
            weeklyReports: profileData.preferences.weeklyReports ?? false,
            multiTradeMode: profileData.preferences.multiTradeMode ?? false,
          });
        }

        if (profileData.account_balance !== null && profileData.account_balance !== undefined) {
          setAccountBalance(profileData.account_balance.toString());
        }
      }
    } catch (error) {
      console.error('Error loading user data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadIndicatorPreferences = async () => {
    try {
      const visibility = await chartPreferencesService.getIndicatorVisibility();
      setIndicatorVisibility(visibility);
    } catch (error) {
      console.error('Error loading indicator preferences:', error);
    }
  };


  const handleSavePreferences = async () => {
    try {
      setSaving(true);

      const { error } = await supabase
        .from('user_profiles')
        .update({
          preferences: preferences,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user?.id);

      if (error) {
        console.error('Error saving preferences:', error);
        toast.error('Save Failed', 'Failed to save preferences. Please try again.');
      } else {
        toast.success('Preferences Saved', 'Your preferences have been updated successfully');
      }
    } catch (error) {
      console.error('Error saving preferences:', error);
      toast.error('Save Failed', 'Failed to save preferences. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveIndicatorPreferences = async () => {
    try {
      setSavingIndicators(true);
      setIndicatorMessage(null);

      await chartPreferencesService.setIndicatorVisibility(indicatorVisibility);

      setIndicatorMessage({
        type: 'success',
        text: 'Chart display preferences saved globally for all trading pairs!'
      });

      setTimeout(() => {
        setIndicatorMessage(null);
      }, 3000);
    } catch (error) {
      console.error('Error saving indicator preferences:', error);
      setIndicatorMessage({
        type: 'error',
        text: 'Failed to save chart display preferences. Please try again.'
      });
    } finally {
      setSavingIndicators(false);
    }
  };

  const handleIndicatorToggle = (indicator: keyof IndicatorVisibility) => {
    setIndicatorVisibility(prev => ({
      ...prev,
      [indicator]: !prev[indicator]
    }));
  };

  const loadMonitorPreferences = async () => {
    try {
      const { data, error } = await supabase
        .from('user_monitor_preferences')
        .select('*')
        .eq('user_id', user?.id)
        .maybeSingle();

      if (error) {
        console.error('Error loading monitor preferences:', error);
      } else if (data) {
        setMonitorPreferences({
          entryPriceMonitorEnabled: data.entry_price_monitor_enabled ?? true,
          sessionIntelligenceEnabled: data.session_intelligence_enabled ?? true,
          vwapKissMonitorEnabled: data.vwap_kiss_monitor_enabled ?? true,
        });
      }
    } catch (error) {
      console.error('Error loading monitor preferences:', error);
    }
  };

  const handleSaveMonitorPreferences = async () => {
    try {
      setSavingMonitors(true);
      setMonitorMessage(null);

      const { error } = await supabase
        .from('user_monitor_preferences')
        .upsert({
          user_id: user?.id,
          entry_price_monitor_enabled: monitorPreferences.entryPriceMonitorEnabled,
          session_intelligence_enabled: monitorPreferences.sessionIntelligenceEnabled,
          vwap_kiss_monitor_enabled: monitorPreferences.vwapKissMonitorEnabled,
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;

      setMonitorMessage({
        type: 'success',
        text: 'Trading monitor preferences saved successfully!'
      });

      setTimeout(() => {
        setMonitorMessage(null);
      }, 3000);
    } catch (error) {
      console.error('Error saving monitor preferences:', error);
      setMonitorMessage({
        type: 'error',
        text: 'Failed to save monitor preferences. Please try again.'
      });
    } finally {
      setSavingMonitors(false);
    }
  };

  const handleMonitorToggle = (monitor: keyof typeof monitorPreferences) => {
    setMonitorPreferences(prev => ({
      ...prev,
      [monitor]: !prev[monitor]
    }));
  };

  const handleSaveAccountBalance = async () => {
    try {
      const balanceNum = parseFloat(accountBalance);

      if (isNaN(balanceNum) || balanceNum < 100 || balanceNum > 1000000) {
        setBalanceMessage({
          type: 'error',
          text: 'Balance must be between $100 and $1,000,000'
        });
        return;
      }

      setShowBalanceConfirmModal(true);
    } catch (error) {
      console.error('Error validating balance:', error);
      setBalanceMessage({
        type: 'error',
        text: 'Invalid balance amount'
      });
    }
  };

  const confirmBalanceUpdate = async () => {
    try {
      setSavingBalance(true);
      setBalanceMessage(null);
      setShowBalanceConfirmModal(false);

      const balanceNum = parseFloat(accountBalance);

      const { error } = await supabase
        .from('user_profiles')
        .update({
          account_balance: balanceNum,
          updated_at: new Date().toISOString()
        })
        .eq('id', user?.id);

      if (error) throw error;

      setBalanceMessage({
        type: 'success',
        text: `Account balance updated to $${balanceNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}!`
      });

      setTimeout(() => {
        setBalanceMessage(null);
      }, 3000);
    } catch (error) {
      console.error('Error saving account balance:', error);
      setBalanceMessage({
        type: 'error',
        text: 'Failed to save account balance. Please try again.'
      });
    } finally {
      setSavingBalance(false);
    }
  };

  const formatBalanceInput = (value: string) => {
    const numValue = value.replace(/[^0-9.]/g, '');
    const parts = numValue.split('.');
    if (parts.length > 2) {
      return parts[0] + '.' + parts.slice(1).join('');
    }
    if (parts[1] && parts[1].length > 2) {
      return parts[0] + '.' + parts[1].substring(0, 2);
    }
    return numValue;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage(null);

    if (!passwordData.currentPassword) {
      setPasswordMessage({ type: 'error', text: 'Please enter your current password' });
      return;
    }

    const validation = validatePassword(passwordData.newPassword);
    if (!validation.isValid) {
      setPasswordMessage({ type: 'error', text: validation.errors[0] });
      return;
    }

    if (!passwordsMatch(passwordData.newPassword, passwordData.confirmPassword)) {
      setPasswordMessage({ type: 'error', text: 'Passwords do not match' });
      return;
    }

    try {
      setPasswordUpdating(true);
      const { error } = await updatePassword(passwordData.currentPassword, passwordData.newPassword);

      if (error) {
        setPasswordMessage({ type: 'error', text: error.message || 'Failed to update password' });
      } else {
        setPasswordMessage({ type: 'success', text: 'Password updated successfully! A confirmation email has been sent.' });
        setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });

        setTimeout(() => {
          setPasswordMessage(null);
        }, 5000);
      }
    } catch (error) {
      setPasswordMessage({ type: 'error', text: 'An unexpected error occurred' });
    } finally {
      setPasswordUpdating(false);
    }
  };

  const passwordValidation = validatePassword(passwordData.newPassword);
  const passwordStrengthColor = {
    weak: 'bg-red-500',
    medium: 'bg-yellow-500',
    strong: 'bg-green-500',
  }[passwordValidation.strength];

  const handleCheckForUpdates = async () => {
    const hasUpdate = await checkForUpdates();
    if (hasUpdate) {
      toast.success('Update Available', 'A new version is ready to install!');
    } else {
      toast.success('Up to Date', 'You are running the latest version');
    }
  };

  const loadPushSettings = async () => {
    try {
      const permission = await pushSubscriptionService.getPermissionStatus();
      setPushPermission(permission);

      if (permission === 'granted') {
        const devices = await pushSubscriptionService.getDevices();
        setPushDevices(devices);
      }
    } catch (error) {
      console.error('Error loading push settings:', error);
    }
  };

  const handleEnablePush = async () => {
    try {
      setLoadingPush(true);
      console.log('[Settings] Enabling push notifications...');

      // Force re-subscribe to ensure it gets saved to database
      const subscription = await pushSubscriptionService.subscribe(undefined, true);

      if (subscription) {
        console.log('[Settings] Push enabled successfully');
        toast.success('Push Enabled', 'Push notifications have been enabled successfully');
        await loadPushSettings();
      } else {
        console.error('[Settings] Push enable returned null');
        toast.error('Failed', 'Could not enable push notifications. Check console for details.');
      }
    } catch (error) {
      console.error('[Settings] Error enabling push:', error);
      toast.error('Error', 'Failed to enable push notifications');
    } finally {
      setLoadingPush(false);
    }
  };

  const handleDisablePush = async () => {
    try {
      setLoadingPush(true);
      console.log('[Settings] Disabling push notifications...');

      const success = await pushSubscriptionService.unsubscribe();

      if (success) {
        console.log('[Settings] Push disabled successfully');
        toast.success('Push Disabled', 'Push notifications have been disabled');
        setPushPermission('default');
        setPushDevices([]);
      } else {
        console.error('[Settings] Push disable returned false');
        toast.error('Failed', 'Could not disable push notifications');
      }
    } catch (error) {
      console.error('[Settings] Error disabling push:', error);
      toast.error('Error', 'Failed to disable push notifications');
    } finally {
      setLoadingPush(false);
    }
  };

  const handleTestPush = async () => {
    try {
      setTestingPush(true);

      if (!user) return;

      console.log('[Test Push] === SERVICE WORKER DIAGNOSTICS ===');

      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        console.log('[Test Push] Service Worker State:', registration.active?.state);
        console.log('[Test Push] Service Worker Script URL:', registration.active?.scriptURL);

        const subscription = await registration.pushManager.getSubscription();
        console.log('[Test Push] Push Subscription Active:', !!subscription);

        if (subscription) {
          console.log('[Test Push] Subscription Endpoint:', subscription.endpoint.substring(0, 50) + '...');
        }
      } else {
        console.log('[Test Push] Service Worker not supported');
      }

      console.log('[Test Push] Notification Permission:', Notification.permission);
      console.log('[Test Push] Sending test notification...');

      await pushNotificationDispatcher.sendTradeSignal({
        userId: user.id,
        symbol: 'EURUSD',
        direction: 'buy',
        setupType: 'Test Signal',
        confidence: 85,
        entryPrice: 1.0850,
        stopLoss: 1.0800,
        takeProfit: 1.0950
      });

      console.log('[Test Push] Test notification sent successfully');
      console.log('[Test Push] Check your device - notification should appear in ~5 seconds');
      console.log('[Test Push] Open DevTools → Application → Service Workers to see SW logs');

      toast.success('Test Sent', 'Check console for detailed diagnostics. Notification should appear in ~5 seconds.');
    } catch (error) {
      console.error('[Test Push] Error sending test push:', error);
      toast.error('Failed', 'Could not send test notification');
    } finally {
      setTestingPush(false);
    }
  };

  const handleRemoveDevice = async (deviceId: string) => {
    try {
      const success = await pushSubscriptionService.removeDevice(deviceId);

      if (success) {
        toast.success('Device Removed', 'Device has been removed from your account');
        await loadPushSettings();
      } else {
        toast.error('Failed', 'Could not remove device');
      }
    } catch (error) {
      console.error('Error removing device:', error);
      toast.error('Error', 'Failed to remove device');
    }
  };

  const handleSaveDeviceName = async () => {
    if (!editingDevice) return;

    try {
      const success = await pushSubscriptionService.updateDeviceName(
        editingDevice.id,
        editingDevice.name
      );

      if (success) {
        toast.success('Name Updated', 'Device name has been updated');
        setEditingDevice(null);
        await loadPushSettings();
      } else {
        toast.error('Failed', 'Could not update device name');
      }
    } catch (error) {
      console.error('Error updating device name:', error);
      toast.error('Error', 'Failed to update device name');
    }
  };

  const formatDeviceDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="app-viewport bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950" ref={pullToRefresh.containerRef}>
      <PullToRefreshIndicator
        isPulling={pullToRefresh.isPulling}
        isRefreshing={pullToRefresh.isRefreshing}
        pullDistance={pullToRefresh.pullDistance}
        threshold={pullToRefresh.threshold}
      />
      <NavigationMenu />

      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
          <p className="text-gray-400">Manage your account settings and preferences</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full"></div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <button
                onClick={() => toggleSection('accountInfo')}
                className="flex items-center gap-3 mb-6 w-full text-left group"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
                  <User size={20} className="text-white" />
                </div>
                <h2 className="text-xl font-semibold text-white flex-1">Account Information</h2>
                <ChevronDown
                  size={20}
                  className={`text-gray-400 transition-transform duration-200 ${
                    collapsedSections.accountInfo ? '' : 'rotate-180'
                  }`}
                />
              </button>

              {!collapsedSections.accountInfo && (
                <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg">
                  <Mail size={18} className="text-gray-400" />
                  <div>
                    <div className="text-xs text-gray-400">Email</div>
                    <div className="text-white">{user?.email}</div>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg">
                  <Calendar size={18} className="text-gray-400" />
                  <div>
                    <div className="text-xs text-gray-400">Member Since</div>
                    <div className="text-white">
                      {user?.created_at ? formatDate(user.created_at) : 'N/A'}
                    </div>
                  </div>
                </div>

                {profile?.is_admin && (
                  <div className="flex items-center gap-3 p-3 bg-emerald-900/20 border border-emerald-700/30 rounded-lg">
                    <Shield size={18} className="text-emerald-400" />
                    <div>
                      <div className="text-xs text-emerald-400">Account Type</div>
                      <div className="text-white font-medium">Administrator</div>
                    </div>
                  </div>
                )}
              </div>
              )}
            </div>

            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <button
                onClick={() => toggleSection('accountManagement')}
                className="flex items-center gap-3 mb-6 w-full text-left group"
              >
                <DollarSign size={20} className="text-emerald-400" />
                <h2 className="text-xl font-semibold text-white flex-1">Account Balance</h2>
                <ChevronDown
                  size={20}
                  className={`text-gray-400 transition-transform duration-200 ${
                    collapsedSections.accountManagement ? '' : 'rotate-180'
                  }`}
                />
              </button>

              {!collapsedSections.accountManagement && (
                <>

              <p className="text-sm text-gray-400 mb-6">
                Configure your trading account parameters. This affects position sizing and risk calculations for all trades.
              </p>

              {balanceMessage && (
                <div
                  className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
                    balanceMessage.type === 'success'
                      ? 'bg-green-900/20 border border-green-700/30 text-green-400'
                      : 'bg-red-900/20 border border-red-700/30 text-red-400'
                  }`}
                >
                  {balanceMessage.type === 'success' ? (
                    <CheckCircle size={20} />
                  ) : (
                    <AlertCircle size={20} />
                  )}
                  <span>{balanceMessage.text}</span>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Starting Account Balance
                  </label>
                  <div className="relative">
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-medium">
                      $
                    </div>
                    <input
                      type="text"
                      value={accountBalance}
                      onChange={(e) => setAccountBalance(formatBalanceInput(e.target.value))}
                      disabled={savingBalance}
                      className="w-full pl-8 pr-4 py-3 bg-gray-800/50 border border-gray-700 rounded-lg text-white text-lg font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                      placeholder="10000.00"
                    />
                  </div>
                  <p className="mt-2 text-xs text-gray-400">
                    Enter an amount between $100 and $1,000,000. This will be used for position sizing calculations.
                  </p>
                </div>
              </div>

              <div className="mt-6 p-4 bg-blue-900/20 border border-blue-700/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertCircle size={18} className="text-blue-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-blue-300">
                    <p className="font-medium mb-1">Important Note</p>
                    <p className="text-blue-300/80">
                      This setting only affects future trade calculations. Historical trade data and KPIs will not be modified.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={handleSaveAccountBalance}
                  disabled={savingBalance}
                  className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 text-white rounded-lg transition-colors"
                >
                  {savingBalance ? (
                    <>
                      <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full"></div>
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save size={18} />
                      <span>Save Account Settings</span>
                    </>
                  )}
                </button>
              </div>
              </>
              )}
            </div>

            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <button
                onClick={() => toggleSection('tradingBehavior')}
                className="flex items-center gap-3 mb-6 w-full text-left group"
              >
                <Zap size={20} className="text-emerald-400" />
                <h2 className="text-xl font-semibold text-white flex-1">Trading Behavior</h2>
                <ChevronDown
                  size={20}
                  className={`text-gray-400 transition-transform duration-200 ${
                    collapsedSections.tradingBehavior ? '' : 'rotate-180'
                  }`}
                />
              </button>

              {!collapsedSections.tradingBehavior && (
                <>

              <p className="text-sm text-gray-400 mb-6">
                Configure how the AI executes trades during Smart Goal Mode sessions.
              </p>

              <div className="space-y-4">
                <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Zap size={18} className={preferences.multiTradeMode ? "text-emerald-400" : "text-blue-400"} />
                      <div className="text-white font-medium">Execution Mode</div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={preferences.multiTradeMode}
                        onChange={(e) =>
                          setPreferences({ ...preferences, multiTradeMode: e.target.checked })
                        }
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                    </label>
                  </div>

                  {/* Mode Explanation */}
                  {!preferences.multiTradeMode ? (
                    <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <CheckCircle size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
                        <div className="text-xs text-gray-300">
                          <strong className="text-blue-400">Single-Trade Mode (Active)</strong>
                          <p className="mt-1">
                            Alpha executes ONE trade at a time. After each trade closes, you decide whether to continue.
                            Lower risk, full control between trades.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-emerald-900/20 border border-emerald-700/50 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <Zap size={16} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                        <div className="text-xs text-gray-300">
                          <strong className="text-emerald-400">Multi-Trade Mode (Active)</strong>
                          <p className="mt-1">
                            Alpha can execute multiple trades SIMULTANEOUSLY. Faster goal achievement, higher exposure.
                            Best for experienced traders comfortable with concurrent positions.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 p-4 bg-blue-900/20 border border-blue-700/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertCircle size={18} className="text-blue-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-blue-300">
                    <p className="font-medium mb-1">Important Note</p>
                    <p className="text-blue-300/80">
                      This setting applies to all new Smart Goal Mode sessions. You can change this preference at any time.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={handleSavePreferences}
                  disabled={saving}
                  className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 text-white rounded-lg transition-colors"
                >
                  {saving ? (
                    <>
                      <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full"></div>
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save size={18} />
                      <span>Save Preferences</span>
                    </>
                  )}
                </button>
              </div>
              </>
              )}
            </div>

            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <button
                onClick={() => toggleSection('tradingMonitors')}
                className="flex items-center gap-3 mb-6 w-full text-left group"
              >
                <Activity size={20} className="text-emerald-400" />
                <h2 className="text-xl font-semibold text-white flex-1">Trading Monitors</h2>
                <ChevronDown
                  size={20}
                  className={`text-gray-400 transition-transform duration-200 ${
                    collapsedSections.tradingMonitors ? '' : 'rotate-180'
                  }`}
                />
              </button>

              {!collapsedSections.tradingMonitors && (
                <>

              <p className="text-sm text-gray-400 mb-6">
                Educational trading monitors displayed on the Smart Goal page when no active sessions are running. These are advisory-only and do not affect Alpha's autonomous trading decisions.
              </p>

              {monitorMessage && (
                <div
                  className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
                    monitorMessage.type === 'success'
                      ? 'bg-green-900/20 border border-green-700/30 text-green-400'
                      : 'bg-red-900/20 border border-red-700/30 text-red-400'
                  }`}
                >
                  {monitorMessage.type === 'success' ? (
                    <CheckCircle size={20} />
                  ) : (
                    <AlertCircle size={20} />
                  )}
                  <span>{monitorMessage.text}</span>
                </div>
              )}

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                  <div className="flex items-center gap-3">
                    <TrendingUp size={18} className="text-emerald-400" />
                    <div>
                      <div className="text-white font-medium">Entry Price Monitor</div>
                      <div className="text-xs text-gray-400">Shows optimal entry prices after Alpha executes trades</div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={monitorPreferences.entryPriceMonitorEnabled}
                      onChange={() => handleMonitorToggle('entryPriceMonitorEnabled')}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                  <div className="flex items-center gap-3">
                    <Clock size={18} className="text-blue-400" />
                    <div>
                      <div className="text-white font-medium">Session Intelligence</div>
                      <div className="text-xs text-gray-400">Best pairs for current trading session with market conditions</div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={monitorPreferences.sessionIntelligenceEnabled}
                      onChange={() => handleMonitorToggle('sessionIntelligenceEnabled')}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                  <div className="flex items-center gap-3">
                    <BarChart3 size={18} className="text-amber-400" />
                    <div>
                      <div className="text-white font-medium">VWAP Kiss Monitor</div>
                      <div className="text-xs text-gray-400">Pairs near VWAP for quick scalp opportunities</div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={monitorPreferences.vwapKissMonitorEnabled}
                      onChange={() => handleMonitorToggle('vwapKissMonitorEnabled')}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>
              </div>

              <div className="mt-6 p-4 bg-blue-900/20 border border-blue-700/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertCircle size={18} className="text-blue-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-blue-300">
                    <p className="font-medium mb-1">Advisory Only</p>
                    <p className="text-blue-300/80">
                      These monitors are educational tools for manual trading analysis. They have zero influence on Alpha's autonomous trading decisions or execution logic.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={handleSaveMonitorPreferences}
                  disabled={savingMonitors}
                  className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 text-white rounded-lg transition-colors"
                >
                  {savingMonitors ? (
                    <>
                      <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full"></div>
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save size={18} />
                      <span>Save Monitor Settings</span>
                    </>
                  )}
                </button>
              </div>
              </>
              )}
            </div>

            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <button
                onClick={() => toggleSection('notifications')}
                className="flex items-center gap-3 mb-6 w-full text-left group"
              >
                <Bell size={20} className="text-emerald-400" />
                <h2 className="text-xl font-semibold text-white flex-1">Notification Preferences</h2>
                <ChevronDown
                  size={20}
                  className={`text-gray-400 transition-transform duration-200 ${
                    collapsedSections.notifications ? '' : 'rotate-180'
                  }`}
                />
              </button>

              {!collapsedSections.notifications && (
                <>

              <p className="text-sm text-gray-400 mb-6">
                Manage push notification devices and receive real-time alerts even when the app is closed.
              </p>

              <div className="space-y-6">
                <div className="p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-white font-medium mb-1">Push Notifications</div>
                      <div className="text-xs text-gray-400">
                        {pushPermission === 'granted' && 'Enabled on this device'}
                        {pushPermission === 'denied' && 'Blocked by browser - please enable in browser settings'}
                        {pushPermission === 'default' && 'Not configured'}
                      </div>
                    </div>
                    {pushPermission === 'granted' ? (
                      <button
                        onClick={handleDisablePush}
                        disabled={loadingPush}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-700 text-white text-sm rounded-lg transition-colors"
                      >
                        {loadingPush ? 'Disabling...' : 'Disable'}
                      </button>
                    ) : pushPermission === 'default' ? (
                      <button
                        onClick={handleEnablePush}
                        disabled={loadingPush}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 text-white text-sm rounded-lg transition-colors"
                      >
                        {loadingPush ? 'Enabling...' : 'Enable Push'}
                      </button>
                    ) : null}
                  </div>

                  {pushPermission === 'granted' && (
                    <button
                      onClick={handleTestPush}
                      disabled={testingPush}
                      className="w-full mt-3 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {testingPush ? (
                        <>
                          <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full"></div>
                          <span>Sending Test...</span>
                        </>
                      ) : (
                        <>
                          <Bell size={16} />
                          <span>Send Test Notification</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {pushDevices.length > 0 && (
                  <div>
                    <h3 className="text-white font-medium mb-3">Registered Devices</h3>
                    <div className="space-y-3">
                      {pushDevices.map((device) => (
                        <div
                          key={device.id}
                          className="p-4 bg-gray-800/50 rounded-lg border border-gray-700"
                        >
                          {editingDevice?.id === device.id ? (
                            <div className="space-y-3">
                              <input
                                type="text"
                                value={editingDevice.name}
                                onChange={(e) =>
                                  setEditingDevice({ ...editingDevice, name: e.target.value })
                                }
                                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={handleSaveDeviceName}
                                  className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded-lg transition-colors"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditingDevice(null)}
                                  className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <Smartphone
                                    size={16}
                                    className={device.isActive ? 'text-emerald-400' : 'text-gray-500'}
                                  />
                                  <div className="text-white font-medium">{device.deviceName}</div>
                                  {!device.isActive && (
                                    <span className="text-xs text-gray-500">(Inactive)</span>
                                  )}
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() =>
                                      setEditingDevice({ id: device.id, name: device.deviceName })
                                    }
                                    className="text-blue-400 hover:text-blue-300 text-xs"
                                  >
                                    Rename
                                  </button>
                                  <button
                                    onClick={() => handleRemoveDevice(device.id)}
                                    className="text-red-400 hover:text-red-300 text-xs"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                              <div className="text-xs text-gray-400">
                                Last used {formatDeviceDate(device.lastUsedAt)}
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {pushPermission === 'denied' && (
                  <div className="p-4 bg-red-900/20 border border-red-700/30 rounded-lg">
                    <div className="flex items-start gap-3">
                      <AlertCircle size={18} className="text-red-400 mt-0.5 flex-shrink-0" />
                      <div className="text-sm text-red-300">
                        <p className="font-medium mb-1">Push Notifications Blocked</p>
                        <p className="text-red-300/80 mb-2">
                          You have blocked push notifications for this site. To enable them:
                        </p>
                        <ol className="text-xs list-decimal list-inside space-y-1 text-red-300/80">
                          <li>Click the lock icon in your browser address bar</li>
                          <li>Find "Notifications" in the permissions list</li>
                          <li>Change the setting to "Allow"</li>
                          <li>Refresh this page</li>
                        </ol>
                      </div>
                    </div>
                  </div>
                )}

                <div className="border-t border-gray-700 pt-6">
                  <h3 className="text-white font-medium mb-4">Notification Types</h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <Mail size={18} className="text-gray-400" />
                        <div>
                          <div className="text-white font-medium">Email Notifications</div>
                          <div className="text-xs text-gray-400">Receive general email updates</div>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferences.emailNotifications}
                          onChange={(e) =>
                            setPreferences({ ...preferences, emailNotifications: e.target.checked })
                          }
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                      </label>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <TrendingUp size={18} className="text-gray-400" />
                        <div>
                          <div className="text-white font-medium">Trade Notifications</div>
                          <div className="text-xs text-gray-400">Get notified about trade executions</div>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferences.tradeNotifications}
                          onChange={(e) =>
                            setPreferences({ ...preferences, tradeNotifications: e.target.checked })
                          }
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                      </label>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <Bell size={18} className="text-gray-400" />
                        <div>
                          <div className="text-white font-medium">Goal Notifications</div>
                          <div className="text-xs text-gray-400">Alerts for smart goal achievements</div>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferences.goalNotifications}
                          onChange={(e) =>
                            setPreferences({ ...preferences, goalNotifications: e.target.checked })
                          }
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                      </label>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <Calendar size={18} className="text-gray-400" />
                        <div>
                          <div className="text-white font-medium">Weekly Reports</div>
                          <div className="text-xs text-gray-400">Receive weekly performance summaries</div>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={preferences.weeklyReports}
                          onChange={(e) =>
                            setPreferences({ ...preferences, weeklyReports: e.target.checked })
                          }
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={handleSavePreferences}
                  disabled={saving}
                  className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 text-white rounded-lg transition-colors"
                >
                  {saving ? (
                    <>
                      <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full"></div>
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save size={18} />
                      <span>Save Preferences</span>
                    </>
                  )}
                </button>
              </div>
              </>
              )}
            </div>

            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <button
                onClick={() => toggleSection('chartDisplay')}
                className="flex items-center gap-3 mb-6 w-full text-left group"
              >
                <Activity size={20} className="text-emerald-400" />
                <h2 className="text-xl font-semibold text-white flex-1">Chart Display</h2>
                <ChevronDown
                  size={20}
                  className={`text-gray-400 transition-transform duration-200 ${
                    collapsedSections.chartDisplay ? '' : 'rotate-180'
                  }`}
                />
              </button>

              {!collapsedSections.chartDisplay && (
                <>

              <p className="text-sm text-gray-400 mb-6">
                Control which indicators are displayed on your charts across all trading pairs. Note: All indicators remain active for AI analysis regardless of visibility settings.
              </p>

              {indicatorMessage && (
                <div
                  className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
                    indicatorMessage.type === 'success'
                      ? 'bg-green-900/20 border border-green-700/30 text-green-400'
                      : 'bg-red-900/20 border border-red-700/30 text-red-400'
                  }`}
                >
                  {indicatorMessage.type === 'success' ? (
                    <CheckCircle size={20} />
                  ) : (
                    <AlertCircle size={20} />
                  )}
                  <span>{indicatorMessage.text}</span>
                </div>
              )}

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full bg-blue-500"></div>
                    <div>
                      <div className="text-white font-medium">VWAP</div>
                      <div className="text-xs text-gray-400">Volume Weighted Average Price</div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={indicatorVisibility.vwap}
                      onChange={() => handleIndicatorToggle('vwap')}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full bg-emerald-500"></div>
                    <div>
                      <div className="text-white font-medium">EMA 20</div>
                      <div className="text-xs text-gray-400">20-period Exponential Moving Average</div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={indicatorVisibility.ema20}
                      onChange={() => handleIndicatorToggle('ema20')}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full bg-amber-500"></div>
                    <div>
                      <div className="text-white font-medium">EMA 50</div>
                      <div className="text-xs text-gray-400">50-period Exponential Moving Average</div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={indicatorVisibility.ema50}
                      onChange={() => handleIndicatorToggle('ema50')}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 rounded-full bg-red-500"></div>
                    <div>
                      <div className="text-white font-medium">EMA 200</div>
                      <div className="text-xs text-gray-400">200-period Exponential Moving Average</div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={indicatorVisibility.ema200}
                      onChange={() => handleIndicatorToggle('ema200')}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-emerald-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>
              </div>

              <div className="mt-6 p-4 bg-blue-900/20 border border-blue-700/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertCircle size={18} className="text-blue-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-blue-300">
                    <p className="font-medium mb-1">Important Note</p>
                    <p className="text-blue-300/80">
                      These settings only control chart display. All technical indicators continue to be calculated and used by the AI trading system for market analysis and trade decisions.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={handleSaveIndicatorPreferences}
                  disabled={savingIndicators}
                  className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 text-white rounded-lg transition-colors"
                >
                  {savingIndicators ? (
                    <>
                      <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full"></div>
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save size={18} />
                      <span>Save Display Settings</span>
                    </>
                  )}
                </button>
              </div>
              </>
              )}
            </div>

            {showBalanceConfirmModal && (
              <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-md w-full">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-amber-900/30 flex items-center justify-center">
                      <AlertCircle size={20} className="text-amber-400" />
                    </div>
                    <h3 className="text-xl font-semibold text-white">Update Account Balance?</h3>
                  </div>

                  <p className="text-gray-400 mb-4">
                    Are you sure you want to update your account balance to:
                  </p>

                  <div className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg mb-6">
                    <div className="text-center">
                      <div className="text-3xl font-bold text-emerald-400">
                        ${parseFloat(accountBalance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>

                  <p className="text-sm text-gray-400 mb-6">
                    This will update your account balance for future trade calculations and position sizing.
                  </p>

                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowBalanceConfirmModal(false)}
                      className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={confirmBalanceUpdate}
                      className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
                    >
                      Confirm Update
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <button
                onClick={() => toggleSection('security')}
                className="flex items-center gap-3 mb-6 w-full text-left group"
              >
                <Lock size={20} className="text-emerald-400" />
                <h2 className="text-xl font-semibold text-white flex-1">Security</h2>
                <ChevronDown
                  size={20}
                  className={`text-gray-400 transition-transform duration-200 ${
                    collapsedSections.security ? '' : 'rotate-180'
                  }`}
                />
              </button>

              {!collapsedSections.security && (
                <>

              {passwordMessage && (
                <div
                  className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
                    passwordMessage.type === 'success'
                      ? 'bg-green-900/20 border border-green-700/30 text-green-400'
                      : 'bg-red-900/20 border border-red-700/30 text-red-400'
                  }`}
                >
                  {passwordMessage.type === 'success' ? (
                    <CheckCircle size={20} />
                  ) : (
                    <AlertCircle size={20} />
                  )}
                  <span>{passwordMessage.text}</span>
                </div>
              )}

              <form onSubmit={handlePasswordUpdate} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Current Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPasswords.current ? 'text' : 'password'}
                      value={passwordData.currentPassword}
                      onChange={(e) =>
                        setPasswordData({ ...passwordData, currentPassword: e.target.value })
                      }
                      disabled={passwordUpdating}
                      className="w-full px-4 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                      placeholder="Enter current password"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowPasswords({ ...showPasswords, current: !showPasswords.current })
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
                    >
                      {showPasswords.current ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPasswords.new ? 'text' : 'password'}
                      value={passwordData.newPassword}
                      onChange={(e) =>
                        setPasswordData({ ...passwordData, newPassword: e.target.value })
                      }
                      disabled={passwordUpdating}
                      className="w-full px-4 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                      placeholder="Enter new password"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowPasswords({ ...showPasswords, new: !showPasswords.new })
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
                    >
                      {showPasswords.new ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>

                  {passwordData.newPassword && (
                    <div className="mt-2">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${passwordStrengthColor}`}
                            style={{
                              width:
                                passwordValidation.strength === 'weak'
                                  ? '33%'
                                  : passwordValidation.strength === 'medium'
                                  ? '66%'
                                  : '100%',
                            }}
                          />
                        </div>
                        <span className="text-xs text-gray-400 capitalize">
                          {passwordValidation.strength}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="mt-2 text-xs text-gray-400 space-y-1">
                    <p>Password must contain:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li className={passwordData.newPassword.length >= 8 ? 'text-green-400' : ''}>
                        At least 8 characters
                      </li>
                      <li className={/[A-Z]/.test(passwordData.newPassword) ? 'text-green-400' : ''}>
                        At least one uppercase letter
                      </li>
                      <li className={/[0-9]/.test(passwordData.newPassword) ? 'text-green-400' : ''}>
                        At least one number
                      </li>
                    </ul>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPasswords.confirm ? 'text' : 'password'}
                      value={passwordData.confirmPassword}
                      onChange={(e) =>
                        setPasswordData({ ...passwordData, confirmPassword: e.target.value })
                      }
                      disabled={passwordUpdating}
                      className="w-full px-4 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                      placeholder="Confirm new password"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowPasswords({ ...showPasswords, confirm: !showPasswords.confirm })
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300"
                    >
                      {showPasswords.confirm ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div className="flex justify-end pt-4">
                  <button
                    type="submit"
                    disabled={passwordUpdating}
                    className="flex items-center gap-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-700 text-white rounded-lg transition-colors"
                  >
                    {passwordUpdating ? (
                      <>
                        <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full"></div>
                        <span>Updating...</span>
                      </>
                    ) : (
                      <>
                        <Lock size={18} />
                        <span>Update Password</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
              </>
              )}
            </div>

            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <button
                onClick={() => toggleSection('appInfo')}
                className="flex items-center gap-3 mb-6 w-full text-left group"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                  <Smartphone size={20} className="text-white" />
                </div>
                <h2 className="text-xl font-semibold text-white flex-1">App Information</h2>
                <ChevronDown
                  size={20}
                  className={`text-gray-400 transition-transform duration-200 ${
                    collapsedSections.appInfo ? '' : 'rotate-180'
                  }`}
                />
              </button>

              {!collapsedSections.appInfo && (
                <>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg">
                  <div>
                    <div className="text-sm text-gray-400 mb-1">App Version</div>
                    <div className="text-lg font-medium text-white">{currentVersion}</div>
                  </div>
                  {updateAvailable && (
                    <button
                      onClick={applyUpdate}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                    >
                      <RefreshCw size={16} />
                      Update Now
                    </button>
                  )}
                </div>

                <button
                  onClick={handleCheckForUpdates}
                  disabled={isChecking}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-800/50 hover:bg-gray-800 border border-gray-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {isChecking ? (
                    <>
                      <div className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full"></div>
                      <span>Checking for updates...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw size={18} />
                      <span>Check for Updates</span>
                    </>
                  )}
                </button>

                <div className="p-4 bg-blue-900/20 border border-blue-700/30 rounded-lg">
                  <div className="flex items-start gap-3">
                    <AlertCircle size={18} className="text-blue-400 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-blue-300">
                      <p className="font-medium mb-1">Auto-Update Behavior</p>
                      <ul className="text-blue-300/80 space-y-1 list-disc list-inside text-xs">
                        <li>Updates apply automatically when you close and reopen the app</li>
                        <li>When you resume from background, you'll be prompted to update</li>
                        <li>You can always postpone updates - they'll never be forced</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
              </>
              )}
            </div>
          </div>
        )}
      </div>
      <BottomNavigation />
    </div>
  );
}
