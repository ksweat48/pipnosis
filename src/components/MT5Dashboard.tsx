import React, { useState, useEffect } from 'react';
import { Server, Activity, DollarSign, TrendingUp, TrendingDown, RefreshCw, Wifi, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

interface MT5DashboardProps {
  isVisible?: boolean;
  onToggleVisibility?: () => void;
}

export const MT5Dashboard: React.FC<MT5DashboardProps> = ({ 
  isVisible = false, // Default closed
  onToggleVisibility 
}) => {
  const [mt5Connected, setMt5Connected] = useState(false);
  const [mt5AccountData, setMt5AccountData] = useState<any>(null);
  const [openPositions, setOpenPositions] = useState<any[]>([]);

  // Monitor MT5 connection status
  useEffect(() => {
    const checkMT5Status = () => {
      const connected = localStorage.getItem('pipnosis_mt5_connected') === 'true';
      const accountData = localStorage.getItem('pipnosis_mt5_account');
      
      setMt5Connected(connected);
      
      if (connected && accountData) {
        try {
          const parsedData = JSON.parse(accountData);
          setMt5AccountData(parsedData);
          setOpenPositions(parsedData.openPositions || []);
        } catch (error) {
          console.error('Error parsing MT5 account data:', error);
          setMt5AccountData(null);
          setOpenPositions([]);
        }
      } else {
        setMt5AccountData(null);
        setOpenPositions([]);
      }
    };

    // Check immediately
    checkMT5Status();

    // Set up interval to check every 2 seconds
    const interval = setInterval(checkMT5Status, 2000);

    return () => clearInterval(interval);
  }, []);

  // Safe number formatting function
  const safeToFixed = (value: any, digits: number = 2): string => {
    if (typeof value === "number" && !isNaN(value)) {
      return value.toFixed(digits);
    }
    return "N/A";
  };

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700">
      {/* Collapsible Header */}
      <div className="p-4 sm:p-6 border-b border-slate-700 cursor-pointer" onClick={onToggleVisibility}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-lg ${
              mt5Connected ? 'bg-green-500/20' : 'bg-red-500/20'
            }`}>
              <Server className={`h-5 w-5 ${
                mt5Connected ? 'text-green-400' : 'text-red-400'
              }`} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">MT5 Dashboard</h3>
              <p className="text-sm text-slate-400">
                {mt5Connected ? 'Live trading account status' : 'Connect MT5 to see live data'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <div className={`flex items-center space-x-2 px-3 py-1 rounded-lg border ${
              mt5Connected ? 'bg-green-500/20 text-green-400 border-green-500/30' :
              'bg-red-500/20 text-red-400 border-red-500/30'
            }`}>
              {mt5Connected ? (
                <Wifi className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <span className="text-sm font-medium capitalize">
                {mt5Connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            
            {/* Toggle Button */}
            <button className="p-2 text-slate-400 hover:text-white transition-colors">
              {isVisible ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Expandable Content */}
      {isVisible && (
        <div className="p-4 sm:p-6 space-y-6">
          {!mt5Connected ? (
            <div className="text-center py-8">
              <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
                <h4 className="text-white font-semibold mb-2">MT5 Not Connected</h4>
                <p className="text-slate-400 mb-4">
                  Connect your MetaTrader 5 account to see live trading data, account balance, and open positions.
                </p>
                <button 
                  onClick={() => {
                    const event = new CustomEvent('openMT5Modal');
                    window.dispatchEvent(event);
                  }}
                  className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Connect MT5 Account
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Control Buttons */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <span className="text-sm text-green-400">Live Data</span>
                </div>
                <div className="flex items-center space-x-2">
                  <button className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors">
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Account Information */}
              {mt5AccountData && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                    <div className="flex items-center space-x-2 mb-2">
                      <DollarSign className="h-4 w-4 text-green-400" />
                      <span className="text-sm text-slate-400">Balance</span>
                    </div>
                    <div className="text-xl font-bold text-green-400">
                      ${safeToFixed(mt5AccountData.balance, 2)}
                    </div>
                  </div>

                  <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                    <div className="flex items-center space-x-2 mb-2">
                      <TrendingUp className="h-4 w-4 text-blue-400" />
                      <span className="text-sm text-slate-400">Equity</span>
                    </div>
                    <div className="text-xl font-bold text-blue-400">
                      ${safeToFixed(mt5AccountData.equity, 2)}
                    </div>
                  </div>

                  <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                    <div className="flex items-center space-x-2 mb-2">
                      <Activity className="h-4 w-4 text-yellow-400" />
                      <span className="text-sm text-slate-400">Margin</span>
                    </div>
                    <div className="text-xl font-bold text-yellow-400">
                      ${safeToFixed(mt5AccountData.margin, 2)}
                    </div>
                  </div>

                  <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                    <div className="flex items-center space-x-2 mb-2">
                      <TrendingDown className="h-4 w-4 text-purple-400" />
                      <span className="text-sm text-slate-400">Free Margin</span>
                    </div>
                    <div className="text-xl font-bold text-purple-400">
                      ${safeToFixed(mt5AccountData.freeMargin, 2)}
                    </div>
                  </div>
                </div>
              )}

              {/* Connection Details */}
              {mt5AccountData && (
                <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                  <h4 className="text-white font-semibold mb-3">Connection Details</h4>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-slate-400">Server:</span>
                      <span className="text-white ml-2 font-mono">{mt5AccountData.server || 'Unknown'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Account:</span>
                      <span className="text-white ml-2 font-mono">{mt5AccountData.login || 'Unknown'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Margin Level:</span>
                      <span className="text-white ml-2">{safeToFixed(mt5AccountData.marginLevel, 2)}%</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Last Update:</span>
                      <span className="text-white ml-2">{mt5AccountData.lastUpdate ? new Date(mt5AccountData.lastUpdate).toLocaleTimeString() : 'Unknown'}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Open Positions */}
              <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                <h4 className="text-white font-semibold mb-3">Open Positions</h4>
                {openPositions.length === 0 ? (
                  <p className="text-slate-400 text-center py-4">No open positions</p>
                ) : (
                  <div className="space-y-3">
                    {openPositions.map((position: any) => (
                      <div key={position.ticket} className="bg-slate-800 rounded-lg p-3 border border-slate-600">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-3">
                            <span className="text-white font-semibold">{position.symbol}</span>
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              position.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                            }`}>
                              {position.type.toUpperCase()}
                            </span>
                            <span className="text-slate-400 text-sm">{safeToFixed(position.volume, 2)} lots</span>
                          </div>
                          <div className={`text-lg font-bold ${
                            typeof position.profit === 'number' && position.profit >= 0 
                              ? 'text-green-400' 
                              : 'text-red-400'
                          }`}>
                            {typeof position.profit === 'number' && position.profit >= 0 ? '+' : ''}
                            {safeToFixed(position.profit, 2)}
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 text-sm">
                          <div>
                            <span className="text-slate-400">Open:</span>
                            <span className="text-white ml-1 font-mono">{safeToFixed(position.openPrice, 5)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">Current:</span>
                            <span className="text-white ml-1 font-mono">{safeToFixed(position.currentPrice, 5)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">SL:</span>
                            <span className="text-red-400 ml-1 font-mono">{safeToFixed(position.sl, 5)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">TP:</span>
                            <span className="text-green-400 ml-1 font-mono">{safeToFixed(position.tp, 5)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">Ticket:</span>
                            <span className="text-white ml-1 font-mono text-xs">{position.ticket}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Live Data Notice */}
              <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                <div className="flex items-center space-x-2">
                  <Wifi className="h-4 w-4 text-green-400" />
                  <span className="text-green-300 text-sm font-medium">
                    Live MT5 Data - Updates every 5 seconds
                  </span>
                </div>
                <p className="text-green-200 text-xs mt-1">
                  All data is pulled directly from your MetaTrader 5 account in real-time.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};