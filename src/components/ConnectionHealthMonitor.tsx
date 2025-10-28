import React, { useEffect, useState } from 'react';
import { Wifi, WifiOff, Activity, Zap, RefreshCw } from 'lucide-react';
import { marketDataService, ConnectionStatus } from '../services/market-data';

interface ConnectionHealthMonitorProps {
  symbol: string;
  timeframe?: string;
  className?: string;
}

export const ConnectionHealthMonitor: React.FC<ConnectionHealthMonitorProps> = ({
  symbol,
  timeframe = 'M5',
  className = ''
}) => {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const updateStatus = () => {
      const currentStatus = marketDataService.getStreamStatus(symbol, timeframe as any);
      setStatus(currentStatus);
    };

    updateStatus();
    const interval = setInterval(updateStatus, 1000);

    return () => clearInterval(interval);
  }, [symbol, timeframe]);

  if (!status) {
    return null;
  }

  const getQualityColor = () => {
    switch (status.quality) {
      case 'excellent':
        return 'text-green-400 bg-green-500/10 border-green-500/30';
      case 'good':
        return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
      case 'poor':
        return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
      case 'disconnected':
        return 'text-red-400 bg-red-500/10 border-red-500/30';
      default:
        return 'text-gray-400 bg-gray-500/10 border-gray-500/30';
    }
  };

  const getConnectionIcon = () => {
    if (!status.isConnected) {
      return <WifiOff className="h-4 w-4" />;
    }

    if (status.connectionType === 'websocket') {
      return <Zap className="h-4 w-4" />;
    }

    return <Activity className="h-4 w-4" />;
  };

  const getConnectionLabel = () => {
    if (!status.isConnected) {
      return 'Disconnected';
    }

    if (status.connectionType === 'websocket') {
      return 'WebSocket';
    }

    return 'Polling';
  };

  const getQualityLabel = () => {
    switch (status.quality) {
      case 'excellent':
        return 'Excellent';
      case 'good':
        return 'Good';
      case 'poor':
        return 'Poor';
      case 'disconnected':
        return 'No Connection';
      default:
        return 'Unknown';
    }
  };

  const getTimeSinceUpdate = () => {
    if (!status.lastUpdate) {
      return 'Never';
    }

    const seconds = Math.floor((Date.now() - status.lastUpdate.getTime()) / 1000);

    if (seconds < 5) {
      return 'Just now';
    }

    if (seconds < 60) {
      return `${seconds}s ago`;
    }

    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  return (
    <div className={`${className}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${getQualityColor()} transition-all hover:opacity-80`}
        title="Click for connection details"
      >
        {getConnectionIcon()}
        <span className="text-xs font-medium">{getConnectionLabel()}</span>
        {status.isConnected && (
          <div className={`w-2 h-2 rounded-full ${
            status.quality === 'excellent' ? 'bg-green-400 animate-pulse' :
            status.quality === 'good' ? 'bg-blue-400' :
            status.quality === 'poor' ? 'bg-yellow-400 animate-pulse' :
            'bg-red-400'
          }`}></div>
        )}
      </button>

      {isExpanded && (
        <div className="absolute right-0 mt-2 w-72 p-4 rounded-xl border bg-slate-900/95 backdrop-blur-sm border-white/10 shadow-xl z-50">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-bold text-white">Connection Status</h4>
            <button
              onClick={() => setIsExpanded(false)}
              className="text-white/50 hover:text-white"
            >
              ×
            </button>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50">Connection Type</span>
              <div className="flex items-center gap-2">
                {getConnectionIcon()}
                <span className="text-xs font-medium text-white">{getConnectionLabel()}</span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50">Quality</span>
              <span className={`text-xs font-medium ${
                status.quality === 'excellent' ? 'text-green-400' :
                status.quality === 'good' ? 'text-blue-400' :
                status.quality === 'poor' ? 'text-yellow-400' :
                'text-red-400'
              }`}>
                {getQualityLabel()}
              </span>
            </div>

            {status.connectionType === 'polling' && status.websocketAttempts > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/50">WS Attempts</span>
                <span className="text-xs font-medium text-orange-400">
                  {status.websocketAttempts}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50">Last Update</span>
              <span className="text-xs font-medium text-white/70">
                {getTimeSinceUpdate()}
              </span>
            </div>

            {status.connectionType === 'polling' && (
              <div className="mt-3 pt-3 border-t border-white/10">
                <p className="text-xs text-yellow-400 mb-2">
                  WebSocket unavailable, using polling fallback
                </p>
                <button
                  onClick={() => {
                    const streamManager = (marketDataService as any).priceStreamManagers.get(`${symbol}_${timeframe}`);
                    if (streamManager) {
                      streamManager.retryWebSocket();
                    }
                  }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-all"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry WebSocket
                </button>
              </div>
            )}

            {status.connectionType === 'websocket' && (
              <div className="mt-3 pt-3 border-t border-white/10">
                <div className="flex items-center gap-2 text-xs text-green-400">
                  <Zap className="h-3 w-3" />
                  <span>Real-time WebSocket connection active</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
