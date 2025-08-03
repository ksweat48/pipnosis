import React, { useState } from 'react';
import { User, Settings, LogOut, DollarSign, Shield, TrendingUp, Edit3, Save, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface UserProfileProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UserProfile: React.FC<UserProfileProps> = ({ isOpen, onClose }) => {
  const { user, profile, signOut, updateProfile } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    full_name: profile?.full_name || '',
    risk_profile: profile?.risk_profile || 'auto',
    account_balance: profile?.account_balance || 10000
  });
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const handleEditToggle = () => {
    if (isEditing) {
      // Reset form when canceling
      setEditForm({
        full_name: profile?.full_name || '',
        risk_profile: profile?.risk_profile || 'auto',
        account_balance: profile?.account_balance || 10000
      });
    }
    setIsEditing(!isEditing);
    setUpdateError(null);
  };

  const handleSave = async () => {
    setIsUpdating(true);
    setUpdateError(null);

    try {
      const { error } = await updateProfile(editForm);
      
      if (error) {
        setUpdateError(error.message);
      } else {
        setIsEditing(false);
      }
    } catch (err) {
      setUpdateError('Failed to update profile');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    onClose();
  };

  if (!isOpen || !user || !profile) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
              <User className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                {profile.full_name || 'Trader'}
              </h2>
              <p className="text-sm text-slate-400">{user.email}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Profile Content */}
        <div className="p-6 space-y-6">
          {/* Account Overview */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
              <div className="flex items-center space-x-2 mb-2">
                <DollarSign className="h-4 w-4 text-green-400" />
                <span className="text-sm text-slate-400">Demo Balance</span>
              </div>
              <div className="text-xl font-bold text-green-400">
                ${profile.account_balance.toLocaleString()}
              </div>
            </div>

            <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
              <div className="flex items-center space-x-2 mb-2">
                <Shield className="h-4 w-4 text-blue-400" />
                <span className="text-sm text-slate-400">Plan</span>
              </div>
              <div className="text-lg font-bold text-blue-400 capitalize">
                {profile.plan_type}
              </div>
            </div>
          </div>

          {/* Profile Settings */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-medium">Profile Settings</h3>
              <button
                onClick={handleEditToggle}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              >
                {isEditing ? <X className="h-4 w-4" /> : <Edit3 className="h-4 w-4" />}
              </button>
            </div>

            {isEditing ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={editForm.full_name}
                    onChange={(e) => setEditForm(prev => ({ ...prev, full_name: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter your full name"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Risk Profile
                  </label>
                  <select
                    value={editForm.risk_profile}
                    onChange={(e) => setEditForm(prev => ({ ...prev, risk_profile: e.target.value as any }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="auto">Auto (AI Decides)</option>
                    <option value="low">Low Risk (1-2%)</option>
                    <option value="medium">Medium Risk (3-5%)</option>
                    <option value="high">High Risk (6-10%)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Demo Balance
                  </label>
                  <input
                    type="number"
                    value={editForm.account_balance}
                    onChange={(e) => setEditForm(prev => ({ ...prev, account_balance: parseFloat(e.target.value) || 0 }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    min="1000"
                    max="100000"
                    step="1000"
                  />
                  <p className="text-xs text-slate-500 mt-1">Demo balance for simulated trading</p>
                </div>

                {updateError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <p className="text-red-400 text-sm">{updateError}</p>
                  </div>
                )}

                <div className="flex space-x-3">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={isUpdating}
                    className="flex-1 bg-green-500 text-white py-2 px-4 rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center space-x-2"
                  >
                    {isUpdating ? (
                      <>
                        <Loader className="h-4 w-4 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        <span>Save</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleEditToggle}
                    className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-slate-400">Full Name:</span>
                  <span className="text-white">{profile.full_name || 'Not set'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Risk Profile:</span>
                  <span className="text-white capitalize">{profile.risk_profile}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Member Since:</span>
                  <span className="text-white">
                    {new Date(profile.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Trading Preferences */}
          <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <h4 className="text-blue-300 font-medium mb-2">Trading Preferences</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Default Pairs:</span>
                <span className="text-blue-200">
                  {profile.trading_preferences?.default_pairs?.join(', ') || 'EURUSD, GBPUSD, USDJPY'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Max Trades/Session:</span>
                <span className="text-blue-200">
                  {profile.trading_preferences?.max_trades_per_session || 2}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Preferred Timeframe:</span>
                <span className="text-blue-200">
                  {profile.trading_preferences?.preferred_timeframe || 'H1'}
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex space-x-3">
            <button
              onClick={handleSignOut}
              className="flex-1 bg-red-500/20 text-red-400 border border-red-500/30 py-2 px-4 rounded-lg hover:bg-red-500/30 transition-colors flex items-center justify-center space-x-2"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};