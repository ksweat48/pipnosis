import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw, Server, AlertCircle } from 'lucide-react';
import { mt5Client } from '../services/mt5WebSocketClient';

interface MT5ConnectionStatusProps {
  showDetails?: boolean;
  className?: string;
}

export const MT5ConnectionStatus: React.FC<MT5ConnectionStatusProps> = ({ 
  showDetails = false, 
  className = "" 
}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [accountInfo, setAccountInfo] = useState<any>(null);

  const checkConnection = async () => {
    setIsChecking(true);
    try {
      // Check if MT5 is connected via localStorage
      const connected = localStorage.getItem('pipnosis_mt5_connected') === 'true';
      setIsConnected(connected);
      setLastChecked(new Date());
      
      // Get account info from localStorage
      const accountData = localStorage.getItem('pipnosis_mt5_account');
      if (accountData) {
        setAccountInfo(JSON.parse(accountData));
      }
    } catch (error) {
      setIsConnected(false);
      console.error('MT5 connection check failed:', error);
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    // Check connection on mount
    checkConnection();
    
    // Check connection status periodically
    const interval = setInterval(() => {
      // Just check localStorage status instead of full connection test
      const connected = localStorage.getItem('pipnosis_mt5_connected') === 'true';
      setIsConnected(connected);
      
      // Get account info from localStorage
      const accountData = localStorage.getItem('pipnosis_mt5_account');
      if (accountData) {
        try {
          setAccountInfo(JSON.parse(accountData));
        } catch (error) {
          console.error('Error parsing MT5 account data:', error);
        }
      }
    }, 5000);
    
    return () => {
      clearInterval(interval);
    };
  }, []);

  const getStatusColor = () => {
    if (isChecking) return 'text-yellow-400';
    return isConnected ? 'text-green-400' : 'text-red-400';
  };

  const getStatusIcon = () => {
    if (isChecking) return <RefreshCw className="h-4 w-4 animate-spin" />;
    return isConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />;
  };

  const getStatusText = () => {
    if (isChecking) return 'Checking...';
    return isConnected ? 'MT5 Connected' : 'MT5 Disconnected';
  };

  if (!showDetails) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <div className={getStatusColor()}>{getStatusIcon()}</div>
        <span className={`text-xs ${getStatusColor()}`}>{getStatusText()}</span>
      </div>
    );
  }

  return (
    <div className={`bg-slate-800 rounded-lg border border-slate-700 p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Server className="h-5 w-5 text-blue-400" />
          <h4 className="text-white font-medium">MT5 Connection Status</h4>
        </div>
        <button
          onClick={checkConnection}
          disabled={isChecking}
          className="p-1 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          title="Check connection"
        >
          <RefreshCw className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-400">Status:</span>
          <div className={`flex items-center space-x-1 ${getStatusColor()}`}>
            {getStatusIcon()}
            <span className="text-sm font-medium">{getStatusText()}</span>
          </div>
        </div>

        {lastChecked && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Last checked:</span>
            <span className="text-sm text-slate-300">{lastChecked.toLocaleTimeString()}</span>
          </div>
        )}

        {accountInfo && isConnected && (
          <>
            <div className="border-t border-slate-700 my-2 pt-2">
              <h5 className="text-sm font-medium text-white mb-2">Account Information</h5>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Login:</span>
                  <span className="text-white">{accountInfo.login || 'Unknown'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Server:</span>
                  <span className="text-white">{accountInfo.server || 'Unknown'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Balance:</span>
                  <span className="text-green-400">${accountInfo.balance?.toLocaleString() || '0.00'}</span>
                </div>
                {accountInfo.equity && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Equity:</span>
                    <span className="text-blue-400">${accountInfo.equity?.toLocaleString() || '0.00'}</span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {!isConnected && !isChecking && (
        <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-300">
          <div className="flex items-start space-x-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">MT5 bridge not connected</p>
              <p className="mt-1">Make sure the MT5 bridge is running on your local machine and MetaTrader 5 is open.</p>
            </div>
          </div>
        </div>
      )}

      {isConnected && (
        <div className="mt-3 p-2 bg-green-500/10 border border-green-500/30 rounded text-xs text-green-300">
          <div className="flex items-start space-x-2">
            <Wifi className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">MT5 bridge connected</p>
              <p className="mt-1">Your MetaTrader 5 terminal is connected and ready for trading.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};