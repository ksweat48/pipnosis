import React, { useState, useEffect } from 'react';
import { Activity, RefreshCw, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { backgroundCandleAggregator } from '@/services/background-candle-aggregator';
import { emergencyPricePoller } from '@/services/emergency-price-poller';
import { supabase } from '@/lib/supabase';

interface DiagnosticData {
  aggregatorStatus: any;
  pollerStatus: any;
  recentPriceCount: number;
  lastPriceAge: number | null;
  realtimeConnected: boolean;
}

export function ChartDiagnosticsPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticData | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const runDiagnostics = async () => {
    try {
      const aggregatorStatus = backgroundCandleAggregator.getStatus();
      const pollerStatus = emergencyPricePoller.getStatus();

      const { count } = await supabase
        .from('realtime_prices')
        .select('*', { count: 'exact', head: true });

      const { data: latestPrice } = await supabase
        .from('realtime_prices')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastPriceAge = latestPrice
        ? Math.floor((Date.now() - new Date(latestPrice.created_at).getTime()) / 1000)
        : null;

      setDiagnostics({
        aggregatorStatus,
        pollerStatus,
        recentPriceCount: count || 0,
        lastPriceAge,
        realtimeConnected: aggregatorStatus.connectionState === 'connected'
      });
    } catch (error) {
      console.error('Diagnostics failed:', error);
    }
  };

  useEffect(() => {
    if (isOpen) {
      runDiagnostics();
      const interval = setInterval(runDiagnostics, 5000);
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  const handleEmergencyRestart = async () => {
    setIsRefreshing(true);
    try {
      console.log('[Diagnostics] 🔄 Emergency restart initiated...');

      await backgroundCandleAggregator.stop();
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (!emergencyPricePoller.getStatus().isActive) {
        await emergencyPricePoller.start();
      }

      await emergencyPricePoller.forceDirectMode();
      await backgroundCandleAggregator.start();

      console.log('[Diagnostics] ✅ Emergency restart complete');
      await runDiagnostics();
    } catch (error) {
      console.error('[Diagnostics] ❌ Emergency restart failed:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const getStatusIcon = (isHealthy: boolean) => {
    return isHealthy ? (
      <CheckCircle className="text-green-500" size={16} />
    ) : (
      <XCircle className="text-red-500" size={16} />
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected':
        return 'text-green-500';
      case 'connecting':
        return 'text-yellow-500';
      case 'error':
      case 'disconnected':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg border border-gray-600 shadow-lg transition-all"
          title="Chart Diagnostics"
        >
          <Activity size={18} />
          <span className="text-sm font-medium">Diagnostics</span>
        </button>
      ) : (
        <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-2xl p-4 w-96 max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Activity className="text-emerald-500" size={20} />
              <h3 className="text-white font-semibold">Chart Diagnostics</h3>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-white transition-colors"
            >
              ×
            </button>
          </div>

          {diagnostics && (
            <div className="space-y-3 text-sm">
              <div className="p-3 bg-gray-900 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400">Realtime Connection</span>
                  {getStatusIcon(diagnostics.realtimeConnected)}
                </div>
                <div className={`font-medium ${getStatusColor(diagnostics.aggregatorStatus.connectionState)}`}>
                  {diagnostics.aggregatorStatus.connectionState.toUpperCase()}
                </div>
                {diagnostics.aggregatorStatus.lastMessageTime && (
                  <div className="text-xs text-gray-500 mt-1">
                    Last message: {Math.round(diagnostics.aggregatorStatus.timeSinceLastMessageMs / 1000)}s ago
                  </div>
                )}
              </div>

              <div className="p-3 bg-gray-900 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400">Database Status</span>
                  {getStatusIcon(diagnostics.recentPriceCount > 0 && diagnostics.lastPriceAge !== null && diagnostics.lastPriceAge < 30)}
                </div>
                <div className="text-white font-medium">
                  {diagnostics.recentPriceCount} total records
                </div>
                {diagnostics.lastPriceAge !== null && (
                  <div className={`text-xs mt-1 ${
                    diagnostics.lastPriceAge < 10 ? 'text-green-500' :
                    diagnostics.lastPriceAge < 30 ? 'text-yellow-500' :
                    'text-red-500'
                  }`}>
                    Last update: {diagnostics.lastPriceAge}s ago
                  </div>
                )}
              </div>

              <div className="p-3 bg-gray-900 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400">Emergency Poller</span>
                  {getStatusIcon(diagnostics.pollerStatus.isActive)}
                </div>
                <div className="text-white font-medium">
                  Mode: {diagnostics.pollerStatus.mode.toUpperCase()}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {diagnostics.pollerStatus.isActive ? 'Active' : 'Standby'}
                  {diagnostics.pollerStatus.errorCount > 0 && ` (${diagnostics.pollerStatus.errorCount} errors)`}
                </div>
              </div>

              <div className="p-3 bg-gray-900 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-gray-400">Candle States</span>
                  <span className="text-white font-medium">
                    {diagnostics.aggregatorStatus.activeCandleStates}
                  </span>
                </div>
                <div className="text-xs text-gray-500">
                  Save queue: {diagnostics.aggregatorStatus.saveQueueLength}
                </div>
              </div>

              {diagnostics.aggregatorStatus.circuitBreakerTripped && (
                <div className="p-3 bg-red-900/20 border border-red-500/50 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={16} />
                  <div>
                    <div className="text-red-400 font-medium">Circuit Breaker Tripped</div>
                    <div className="text-xs text-red-400/70 mt-1">
                      Max reconnection attempts reached. Manual restart required.
                    </div>
                  </div>
                </div>
              )}

              {diagnostics.lastPriceAge !== null && diagnostics.lastPriceAge > 30 && (
                <div className="p-3 bg-yellow-900/20 border border-yellow-500/50 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="text-yellow-500 flex-shrink-0 mt-0.5" size={16} />
                  <div>
                    <div className="text-yellow-400 font-medium">Stale Data Detected</div>
                    <div className="text-xs text-yellow-400/70 mt-1">
                      No new prices for {diagnostics.lastPriceAge}s. Server polling may be down.
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              onClick={handleEmergencyRestart}
              disabled={isRefreshing}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white rounded-lg transition-all"
            >
              <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
              <span className="text-sm font-medium">
                {isRefreshing ? 'Restarting...' : 'Emergency Restart'}
              </span>
            </button>
            <button
              onClick={runDiagnostics}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-all"
            >
              <RefreshCw size={16} />
            </button>
          </div>

          <div className="mt-3 text-xs text-gray-500 text-center">
            Auto-refreshes every 5 seconds
          </div>
        </div>
      )}
    </div>
  );
}
