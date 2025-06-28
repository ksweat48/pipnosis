import React, { useState, useEffect } from 'react';
import { Server, Activity, DollarSign, TrendingUp, TrendingDown, Settings, RefreshCw, Wifi, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

interface MT5DashboardProps {
  isVisible?: boolean;
  onToggleVisibility?: () => void;
}

interface MT5Connection {
  status: 'connected' | 'disconnected' | 'connecting';
  server: string;
  account: string;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  lastUpdate: string;
}

interface OpenPosition {
  ticket: string;
  symbol: string;
  type: 'buy' | 'sell';
  volume: number;
  openPrice: number;
  currentPrice: number;
  sl: number;
  tp: number;
  profit: number;
  swap: number;
  commission: number;
}

export const MT5Dashboard: React.FC<MT5DashboardProps> = ({ 
  isVisible = false, // Default closed
  onToggleVisibility 
}) => {
  // CRITICAL FIX: Use real MT5 data if connected, otherwise use mock data
  const [connection, setConnection] = useState<MT5Connection>({
    status: 'disconnected',
    server: 'Not Connected',
    account: 'N/A',
    balance: 0,
    equity: 0,
    margin: 0,
    freeMargin: 0,
    marginLevel: 0,
    lastUpdate: new Date().toLocaleTimeString()
  });

  const [openPositions, setOpenPositions] = useState<OpenPosition[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  // CRITICAL FIX: Load MT5 data from localStorage and update in real-time
  useEffect(() => {
    const loadMT5Data = () => {
      const mt5Connected = localStorage.getItem('pipnosis_mt5_connected') === 'true';
      const mt5AccountData = localStorage.getItem('pipnosis_mt5_account');

      if (mt5Connected && mt5AccountData) {
        try {
          const accountData = JSON.parse(mt5AccountData);
          setIsConnected(true);
          setConnection({
            status: 'connected',
            server: accountData.server || 'Unknown Server',
            account: accountData.login || 'Unknown',
            balance: accountData.balance || 0,
            equity: accountData.equity || 0,
            margin: accountData.margin || 0,
            freeMargin: accountData.freeMargin || 0,
            marginLevel: accountData.marginLevel || 0,
            lastUpdate: new Date().toLocaleTimeString()
          });

          // Set open positions if available
          if (accountData.openPositions && Array.isArray(accountData.openPositions)) {
            setOpenPositions(accountData.openPositions);
          } else {
            setOpenPositions([]);
          }

          console.log('✅ MT5 Dashboard loaded live data:', accountData.login);
        } catch (error) {
          console.error('Error parsing MT5 account data:', error);
          setIsConnected(false);
          setConnection(prev => ({ ...prev, status: 'disconnected' }));
        }
      } else {
        // No MT5 connection - show disconnected state
        setIsConnected(false);
        setConnection({
          status: 'disconnected',
          server: 'Not Connected',
          account: 'N/A',
          balance: 0,
          equity: 0,
          margin: 0,
          freeMargin: 0,
          marginLevel: 0,
          lastUpdate: new Date().toLocaleTimeString()
        });
        setOpenPositions([]);
      }
    };

    // Load data immediately
    loadMT5Data();

    // Set up interval to check for updates every 5 seconds
    const interval = setInterval(loadMT5Data, 5000);

    // Listen for storage changes (when MT5 connection changes)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'pipnosis_mt5_connected' || e.key === 'pipnosis_mt5_account') {
        loadMT5Data();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const getConnectionStatusColor = () => {
    switch (connection.status) {
      case 'connected': return 'text-green-400';
      case 'connecting': return 'text-yellow-400';
      case 'disconnected': return 'text-red-400';
      default: return 'text-slate-400';
    }
  };

  const getConnectionIcon = () => {
    switch (connection.status) {
      case 'connected': return <Wifi className="h-4 w-4" />;
      case 'connecting': return <RefreshCw className="h-4 w-4 animate-spin" />;
      case 'disconnected': return <AlertCircle className="h-4 w-4" />;
      default: return <AlertCircle className="h-4 w-4" />;
    }
  };

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700">
      {/* Collapsible Header */}
      <div className="p-4 sm:p-6 border-b border-slate-700 cursor-pointer" onClick={onToggleVisibility}>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-lg ${
              connection.status === 'connected' ? 'bg-green-500/20' : 'bg-red-500/20'
            }`}>
              <Server className={`h-5 w-5 ${
                connection.status === 'connected' ? 'text-green-400' : 'text-red-400'
              }`} />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">MT5 Dashboard</h3>
              <p className="text-sm text-slate-400">
                {isConnected ? 'Live trading account status' : 'Connect MT5 to see live data'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <div className={`flex items-center space-x-2 px-3 py-1 rounded-lg border ${
              connection.status === 'connected' ? 'bg-green-500/20 text-green-400 border-green-500/30' :
              connection.status === 'connecting' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' :
              'bg-red-500/20 text-red-400 border-red-500/30'
            }`}>
              {getConnectionIcon()}
              <span className="text-sm font-medium capitalize">{connection.status}</span>
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
          {/* CRITICAL FIX: Show connection prompt if not connected */}
          {!isConnected ? (
            <div className="text-center py-8">
              <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-4" />
                <h4 className="text-white font-semibold mb-2">MT5 Not Connected</h4>
                <p className="text-slate-400 mb-4">
                  Connect your MetaTrader 5 account to see live trading data, account balance, and open positions.
                </p>
                <button 
                  onClick={() => {
                    // This will be handled by the parent component
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
                  <button className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors">
                    <Settings className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Account Information */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                  <div className="flex items-center space-x-2 mb-2">
                    <DollarSign className="h-4 w-4 text-green-400" />
                    <span className="text-sm text-slate-400">Balance</span>
                  </div>
                  <div className="text-xl font-bold text-green-400">
                    ${connection.balance.toLocaleString()}
                  </div>
                </div>

                <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                  <div className="flex items-center space-x-2 mb-2">
                    <TrendingUp className="h-4 w-4 text-blue-400" />
                    <span className="text-sm text-slate-400">Equity</span>
                  </div>
                  <div className="text-xl font-bold text-blue-400">
                    ${connection.equity.toLocaleString()}
                  </div>
                </div>

                <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                  <div className="flex items-center space-x-2 mb-2">
                    <Activity className="h-4 w-4 text-yellow-400" />
                    <span className="text-sm text-slate-400">Margin</span>
                  </div>
                  <div className="text-xl font-bold text-yellow-400">
                    ${connection.margin.toLocaleString()}
                  </div>
                </div>

                <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                  <div className="flex items-center space-x-2 mb-2">
                    <TrendingDown className="h-4 w-4 text-purple-400" />
                    <span className="text-sm text-slate-400">Free Margin</span>
                  </div>
                  <div className="text-xl font-bold text-purple-400">
                    ${connection.freeMargin.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* Connection Details */}
              <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                <h4 className="text-white font-semibold mb-3">Connection Details</h4>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-slate-400">Server:</span>
                    <span className="text-white ml-2 font-mono">{connection.server}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Account:</span>
                    <span className="text-white ml-2 font-mono">{connection.account}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Margin Level:</span>
                    <span className="text-white ml-2">{connection.marginLevel.toFixed(2)}%</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Last Update:</span>
                    <span className="text-white ml-2">{connection.lastUpdate}</span>
                  </div>
                </div>
              </div>

              {/* Open Positions */}
              <div className="bg-slate-900 rounded-lg p-4 border border-slate-600">
                <h4 className="text-white font-semibold mb-3">Open Positions</h4>
                {openPositions.length === 0 ? (
                  <p className="text-slate-400 text-center py-4">No open positions</p>
                ) : (
                  <div className="space-y-3">
                    {openPositions.map((position) => (
                      <div key={position.ticket} className="bg-slate-800 rounded-lg p-3 border border-slate-600">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-3">
                            <span className="text-white font-semibold">{position.symbol}</span>
                            <span className={`px-2 py-1 rounded text-xs font-medium ${
                              position.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                            }`}>
                              {position.type.toUpperCase()}
                            </span>
                            <span className="text-slate-400 text-sm">{position.volume} lots</span>
                          </div>
                          <div className={`text-lg font-bold ${position.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {position.profit >= 0 ? '+' : ''}${position.profit.toFixed(2)}
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 text-sm">
                          <div>
                            <span className="text-slate-400">Open:</span>
                            <span className="text-white ml-1 font-mono">{position.openPrice.toFixed(5)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">Current:</span>
                            <span className="text-white ml-1 font-mono">{position.currentPrice.toFixed(5)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">SL:</span>
                            <span className="text-red-400 ml-1 font-mono">{position.sl.toFixed(5)}</span>
                          </div>
                          <div>
                            <span className="text-slate-400">TP:</span>
                            <span className="text-green-400 ml-1 font-mono">{position.tp.toFixed(5)}</span>
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