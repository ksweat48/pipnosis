import React, { useState, useEffect } from 'react';
import { User, DollarSign, Settings } from 'lucide-react';

interface UserProfileProps {
  accountBalance: number;
}
export const UserProfile: React.FC<UserProfileProps> = ({ accountBalance }) => {
  const [mt5Connected, setMt5Connected] = React.useState(false);
  const [mt5AccountData, setMt5AccountData] = React.useState<any>(null);

  // Monitor MT5 connection status
  React.useEffect(() => {
    const checkMT5Status = () => {
      try {
        const connected = localStorage.getItem('pipnosis_mt5_connected') === 'true';
        const accountData = localStorage.getItem('pipnosis_mt5_account');
        
        setMt5Connected(connected);
        
        if (connected && accountData) {
          try {
            setMt5AccountData(JSON.parse(accountData));
          } catch (error) {
            console.error('Error parsing MT5 account data:', error);
            setMt5AccountData(null);
          }
        } else {
          setMt5AccountData(null);
        }
      } catch (error) {
        console.error('Error checking MT5 status:', error);
        setMt5Connected(false);
        setMt5AccountData(null);
      }
    };

    checkMT5Status();
    const interval = setInterval(checkMT5Status, 2000);
    
    return () => {
      clearInterval(interval);
    };
  }, []);

  // Safe number formatting function
  const safeToFixed = (value: any, digits: number = 2): string => {
    if (typeof value === "number" && !isNaN(value)) {
      return value.toFixed(digits);
    }
    return "N/A";
  };

  // Get display balance from MT5 if connected
  const getDisplayBalance = () => {
    if (mt5Connected && mt5AccountData) {
      if (typeof mt5AccountData.balance === 'number') {
        return `$${mt5AccountData.balance.toLocaleString()}`;
      }
    }
    
    return `$${accountBalance.toLocaleString()}`;
  };

  // Get equity from MT5 if connected
  const getEquity = () => {
    if (mt5Connected && mt5AccountData) {
      if (typeof mt5AccountData.equity === 'number') {
        return `$${mt5AccountData.equity.toLocaleString()}`;
      }
    }
    return getDisplayBalance();
  };

  // Get floating P&L from MT5 if connected
  const getFloatingPnL = () => {
    if (mt5Connected && mt5AccountData) {
      if (mt5AccountData.openPositions && Array.isArray(mt5AccountData.openPositions)) {
        const totalPnL = mt5AccountData.openPositions.reduce((sum: number, pos: any) => {
          const profit = typeof pos.profit === 'number' ? pos.profit : 0;
          return sum + profit;
        }, 0);
        return totalPnL;
      }
    }
    return 0;
  };

  const floatingPnL = getFloatingPnL();

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700">
      <div className="p-6 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
            <User className="h-5 w-5 text-blue-400" />
            <span>Account Overview</span>
          </h3>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Account Info with MT5 data if connected */}
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
                    Floating P&L: {floatingPnL >= 0 ? '+' : ''}${safeToFixed(floatingPnL, 2)}
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
              <Settings className="h-4 w-4 text-blue-400" />
              <span className="text-sm font-medium text-slate-400">Risk Profile</span>
            </div>
            <p className="text-white font-medium capitalize">
              Auto
            </p>
          </div>

          <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
            <div className="flex items-center space-x-2 mb-2">
              <Settings className="h-4 w-4 text-purple-400" />
              <span className="text-sm font-medium text-slate-400">Plan Type</span>
            </div>
            <p className="text-white font-medium capitalize">
              Standard
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Local Development
            </p>
          </div>
        </div>

        {/* MT5 Connection Status */}
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
                    return (
                      <div className="mt-2 text-xs text-green-300">
                        <p>Account: {mt5AccountData.login || 'Unknown'} | Server: {mt5AccountData.server || 'Unknown'} | Last Update: {mt5AccountData.lastUpdate ? new Date(mt5AccountData.lastUpdate).toLocaleTimeString() : 'Unknown'}</p>
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
          <h4 className="text-white font-medium mb-3">Account Details</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-slate-400">Account Type:</span>
              <span className="text-white ml-2">
                Demo
              </span>
            </div>
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
      </div>
    </div>
  );
};