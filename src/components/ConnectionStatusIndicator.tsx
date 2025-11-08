import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, AlertCircle, RefreshCw } from 'lucide-react';
import { backgroundCandleAggregator } from '../services/background-candle-aggregator';

export default function ConnectionStatusIndicator() {
  const [status, setStatus] = useState<any>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const updateStatus = () => {
      setStatus(backgroundCandleAggregator.getStatus());
    };

    updateStatus();
    const interval = setInterval(updateStatus, 5000);

    return () => clearInterval(interval);
  }, []);

  if (!status) return null;

  const getStatusColor = () => {
    if (status.circuitBreakerTripped) return 'bg-red-500';
    if (status.connectionState === 'connected' && status.connectionHealthy) return 'bg-green-500';
    if (status.connectionState === 'connecting' || status.isConnecting) return 'bg-yellow-500';
    return 'bg-gray-500';
  };

  const getStatusIcon = () => {
    if (status.circuitBreakerTripped) return <WifiOff className="w-4 h-4" />;
    if (status.connectionState === 'connected' && status.connectionHealthy) return <Wifi className="w-4 h-4" />;
    if (status.connectionState === 'connecting' || status.isConnecting) return <RefreshCw className="w-4 h-4 animate-spin" />;
    return <AlertCircle className="w-4 h-4" />;
  };

  const getStatusText = () => {
    if (status.circuitBreakerTripped) return 'Connection Failed';
    if (status.connectionState === 'connected' && status.connectionHealthy) return 'Connected';
    if (status.connectionState === 'connecting' || status.isConnecting) return 'Connecting...';
    if (status.connectionState === 'disconnected') return 'Disconnected';
    return 'Connection Error';
  };

  const handleManualReconnect = async () => {
    try {
      await backgroundCandleAggregator.manualReconnect();
    } catch (error) {
      console.error('Manual reconnect failed:', error);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="bg-white rounded-lg shadow-lg border border-gray-200">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 rounded-lg transition-colors"
        >
          <div className={`w-2 h-2 rounded-full ${getStatusColor()} animate-pulse`}></div>
          {getStatusIcon()}
          <span className="text-sm font-medium text-gray-700">{getStatusText()}</span>
        </button>

        {isExpanded && (
          <div className="border-t border-gray-200 p-4 space-y-2">
            <div className="text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-600">State:</span>
                <span className="font-medium">{status.connectionState}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Active Candles:</span>
                <span className="font-medium">{status.activeCandleStates}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Reconnect Attempts:</span>
                <span className="font-medium">{status.reconnectAttempts}/{10}</span>
              </div>
              {status.timeSinceLastMessageMs !== null && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Last Message:</span>
                  <span className="font-medium">{Math.round(status.timeSinceLastMessageMs / 1000)}s ago</span>
                </div>
              )}
            </div>

            {status.circuitBreakerTripped && (
              <div className="pt-2 border-t border-gray-200">
                <button
                  onClick={handleManualReconnect}
                  className="w-full px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Manual Reconnect
                </button>
              </div>
            )}

            {!status.connectionHealthy && !status.circuitBreakerTripped && (
              <div className="pt-2 border-t border-gray-200">
                <p className="text-xs text-orange-600">
                  Connection may be unstable. Real-time features may be affected.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
