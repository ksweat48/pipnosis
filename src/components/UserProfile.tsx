import React, { useState } from 'react';
import { User, Settings, DollarSign, Shield, Mail, Calendar, Edit3, Save, X, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export const UserProfile: React.FC = () => {
  const { user, profile, updateProfile, signOut } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [editData, setEditData] = useState({
    full_name: profile?.full_name || '',
    risk_profile: profile?.risk_profile || 'auto',
  });

  // CRITICAL FIX: Check MT5 connection status
  const mt5Connected = localStorage.getItem('pipnosis_mt5_connected') === 'true';
  const mt5AccountData = localStorage.getItem('pipnosis_mt5_account');

  const handleSave = async () => {
    if (!profile) return;

    const updated = await updateProfile(editData);
    if (updated) {
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setEditData({
      full_name: profile?.full_name || '',
      risk_profile: profile?.risk_profile || 'auto',
    });
    setIsEditing(false);
  };

  const handleSignOut = async () => {
    if (isSigningOut) return; // Prevent double-clicking
    
    setIsSigningOut(true);
    
    try {
      console.log('🚪 UserProfile: Initiating sign out...');
      const result = await signOut();
      
      if (result.error) {
        console.error('❌ Sign out error:', result.error);
      } else {
        console.log('✅ Sign out successful');
      }
    } catch (error) {
      console.error('❌ Sign out failed:', error);
    } finally {
      setIsSigningOut(false);
    }
  };

  // CRITICAL FIX: Get display balance from MT5 if connected, otherwise use profile balance
  const getDisplayBalance = () => {
    if (!user || !profile) return '$0.00';
    
    // Use MT5 account balance if connected
    if (mt5Connected && mt5AccountData) {
      try {
        const accountData = JSON.parse(mt5AccountData);
        return `$${accountData.balance?.toLocaleString() || '0.00'}`;
      } catch (error) {
        console.error('Error parsing MT5 account data:', error);
      }
    }
    
    // Fallback to profile balance
    return `$${profile.account_balance?.toLocaleString() || '0.00'}`;
  };

  // CRITICAL FIX: Get equity from MT5 if connected
  const getEquity = () => {
    if (mt5Connected && mt5AccountData) {
      try {
        const accountData = JSON.parse(mt5AccountData);
        return `$${accountData.equity?.toLocaleString() || '0.00'}`;
      } catch (error) {
        console.error('Error parsing MT5 account data:', error);
      }
    }
    return getDisplayBalance(); // Fallback to balance
  };

  // CRITICAL FIX: Get floating P&L from MT5 if connected
  const getFloatingPnL = () => {
    if (mt5Connected && mt5AccountData) {
      try {
        const accountData = JSON.parse(mt5AccountData);
        if (accountData.openPositions && accountData.openPositions.length > 0) {
          const totalPnL = accountData.openPositions.reduce((sum: number, pos: any) => sum + (pos.profit || 0), 0);
          return totalPnL;
        }
      } catch (error) {
        console.error('Error parsing MT5 account data:', error);
      }
    }
    return 0;
  };

  if (!user || !profile) {
    return (
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
        <p className="text-slate-400">Loading profile...</p>
      </div>
    );
  }

  const floatingPnL = getFloatingPnL();

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700">
      <div className="p-6 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
            <User className="h-5 w-5 text-blue-400" />
            <span>User Profile</span>
          </h3>
          <div className="flex items-center space-x-2">
            {isEditing ? (
              <>
                <button
                  onClick={handleSave}
                  className="p-2 text-green-400 hover:text-green-300 hover:bg-slate-700 rounded-lg transition-colors"
                  title="Save changes"
                >
                  <Save className="h-4 w-4" />
                </button>
                <button
                  onClick={handleCancel}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                  title="Cancel editing"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
                title="Edit profile"
              >
                <Edit3 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Basic Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">
              <User className="h-4 w-4 inline mr-2" />
              Full Name
            </label>
            {isEditing ? (
              <input
                type="text"
                value={editData.full_name}
                onChange={(e) => setEditData(prev => ({ ...prev, full_name: e.target.value }))}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            ) : (
              <p className="text-white font-medium">{profile.full_name || 'Not set'}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">
              <Mail className="h-4 w-4 inline mr-2" />
              Email Address
            </label>
            <p className="text-white font-medium">{user.email}</p>
          </div>
        </div>

        {/* CRITICAL FIX: Account Info with MT5 data if connected */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
            <div className="flex items-center space-x-2 mb-2">
              <DollarSign className="h-4 w-4 text-green-400" />
              <span className="text-sm font-medium text-slate-400">
                {mt5Connected ? 'MT5 Balance' : 'Account Balance'}
              </span>
            </div>
            <p className="text-xl font-bold text-green-400">
              {getDisplayBalance()}
            </p>
            {mt5Connected && (
              <div className="mt-1">
                <p className="text-xs text-green-400">Live MT5 Data</p>
                <p className="text-xs text-slate-400">
                  Equity: {getEquity()}
                </p>
                {floatingPnL !== 0 && (
                  <p className={`text-xs font-medium ${floatingPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    Floating P&L: {floatingPnL >= 0 ? '+' : ''}${floatingPnL.toFixed(2)}
                  </p>
                )}
              </div>
            )}
            {!mt5Connected && (
              <p className="text-xs text-slate-500 mt-1">Demo Account</p>
            )}
          </div>

          <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
            <div className="flex items-center space-x-2 mb-2">
              <Shield className="h-4 w-4 text-blue-400" />
              <span className="text-sm font-medium text-slate-400">Risk Profile</span>
            </div>
            {isEditing ? (
              <select
                value={editData.risk_profile}
                onChange={(e) => setEditData(prev => ({ ...prev, risk_profile: e.target.value as any }))}
                className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="auto">Auto-Detect</option>
                <option value="low">Low Risk</option>
                <option value="medium">Medium Risk</option>
                <option value="high">High Risk</option>
              </select>
            ) : (
              <p className="text-white font-medium capitalize">
                {profile.risk_profile?.replace('_', ' ') || 'Auto'}
              </p>
            )}
          </div>

          <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
            <div className="flex items-center space-x-2 mb-2">
              <Settings className="h-4 w-4 text-purple-400" />
              <span className="text-sm font-medium text-slate-400">Plan Type</span>
            </div>
            <p className="text-white font-medium capitalize">
              {profile.plan_type || 'Free'}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {profile.plan_type === 'beta' ? 'Beta Access' : 
               profile.plan_type === 'premium' ? 'Premium Plan' : 'Standard Plan'}
            </p>
          </div>
        </div>

        {/* CRITICAL FIX: MT5 Connection Status */}
        {mt5Connected && mt5AccountData && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <div className="w-2 h-2 bg-green-400 rounded-full mt-2 animate-pulse"></div>
              <div>
                <h4 className="text-green-300 font-medium">MT5 Integration Active</h4>
                <p className="text-green-200 text-sm mt-1">
                  Your MetaTrader 5 account is connected and providing live data. All balance and equity information is pulled directly from your trading account.
                </p>
                {(() => {
                  try {
                    const accountData = JSON.parse(mt5AccountData);
                    return (
                      <div className="mt-2 text-xs text-green-300">
                        <p>Account: {accountData.login} | Server: {accountData.server} | Last Update: {new Date(accountData.lastUpdate).toLocaleTimeString()}</p>
                      </div>
                    );
                  } catch {
                    return null;
                  }
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Account Details */}
        <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
          <h4 className="text-white font-medium mb-3 flex items-center space-x-2">
            <Calendar className="h-4 w-4 text-slate-400" />
            <span>Account Details</span>
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-slate-400">Member Since:</span>
              <span className="text-white ml-2">
                {new Date(profile.created_at).toLocaleDateString()}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Last Updated:</span>
              <span className="text-white ml-2">
                {new Date(profile.updated_at).toLocaleDateString()}
              </span>
            </div>
            <div>
              <span className="text-slate-400">User ID:</span>
              <span className="text-white ml-2 font-mono text-xs">
                {user.id.substring(0, 8)}...
              </span>
            </div>
            <div>
              <span className="text-slate-400">Email Verified:</span>
              <span className={`ml-2 ${user.email_confirmed_at ? 'text-green-400' : 'text-yellow-400'}`}>
                {user.email_confirmed_at ? 'Yes' : 'Pending'}
              </span>
            </div>
            {/* CRITICAL FIX: Show MT5 connection status */}
            <div>
              <span className="text-slate-400">MT5 Status:</span>
              <span className={`ml-2 ${mt5Connected ? 'text-green-400' : 'text-red-400'}`}>
                {mt5Connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Data Source:</span>
              <span className={`ml-2 ${mt5Connected ? 'text-green-400' : 'text-blue-400'}`}>
                {mt5Connected ? 'Live MT5' : 'Demo Mode'}
              </span>
            </div>
          </div>
        </div>

        {/* Sign Out Button */}
        <div className="pt-4 border-t border-slate-700">
          <button
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="flex items-center space-x-2 px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSigningOut ? (
              <>
                <div className="h-4 w-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                <span>Signing Out...</span>
              </>
            ) : (
              <>
                <LogOut className="h-4 w-4" />
                <span>Sign Out</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};