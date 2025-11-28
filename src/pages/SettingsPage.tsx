import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { NavigationMenu } from '@/components/NavigationMenu';
import { supabase } from '@/lib/supabase';
import { User, Mail, Calendar, Shield, Bell, TrendingUp, Save, Eye, EyeOff, Lock, CheckCircle, AlertCircle, Activity, DollarSign } from 'lucide-react';
import { validatePassword, passwordsMatch } from '@/utils/passwordValidation';
import { chartPreferencesService, type IndicatorVisibility } from '@/services/chart-preferences';
import { DataResetPanel } from '@/components/DataResetPanel';

export function SettingsPage() {
  const { user, updatePassword } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [preferences, setPreferences] = useState({
    emailNotifications: true,
    tradeNotifications: true,
    goalNotifications: true,
    weeklyReports: false,
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

  const [accountBalance, setAccountBalance] = useState<string>('10000.00');
  const [savingBalance, setSavingBalance] = useState(false);
  const [balanceMessage, setBalanceMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showBalanceConfirmModal, setShowBalanceConfirmModal] = useState(false);

  useEffect(() => {
    if (user) {
      loadUserData();
      loadIndicatorPreferences();
    }
  }, [user]);

  const loadUserData = async () => {
    try {
      setLoading(true);

      const { data: profileData, error: profileError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', user?.id)
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
          });
        }

        if (profileData.account_balance !== null && profileData.account_balance !== undefined) {
          setAccountBalance(profileData.account_balance.toString());
        } else if (profileData.demo_balance !== null && profileData.demo_balance !== undefined) {
          setAccountBalance(profileData.demo_balance.toString());
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
        .eq('user_id', user?.id);

      if (error) {
        console.error('Error saving preferences:', error);
        alert('Failed to save preferences. Please try again.');
      } else {
        alert('Preferences saved successfully!');
      }
    } catch (error) {
      console.error('Error saving preferences:', error);
      alert('Failed to save preferences. Please try again.');
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
          demo_balance: balanceNum,
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
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
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
                  <User size={20} className="text-white" />
                </div>
                <h2 className="text-xl font-semibold text-white">Account Information</h2>
              </div>

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
            </div>

            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <Bell size={20} className="text-emerald-400" />
                <h2 className="text-xl font-semibold text-white">Notification Preferences</h2>
              </div>

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
            </div>

            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <Activity size={20} className="text-emerald-400" />
                <h2 className="text-xl font-semibold text-white">Chart Display</h2>
              </div>

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
            </div>

            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <DollarSign size={20} className="text-emerald-400" />
                <h2 className="text-xl font-semibold text-white">Account Management</h2>
              </div>

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
              <div className="flex items-center gap-3 mb-6">
                <Lock size={20} className="text-emerald-400" />
                <h2 className="text-xl font-semibold text-white">Security</h2>
              </div>

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
            </div>

            <DataResetPanel />
          </div>
        )}
      </div>
    </div>
  );
}
