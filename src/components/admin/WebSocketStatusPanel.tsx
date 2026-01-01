/**
 * WebSocket Status Panel
 *
 * Admin-only component displaying WebSocket connection status and metrics.
 * Shows real-time tick rates, connection status, and persistence stats.
 */

import { useState, useEffect } from 'react';
import { Wifi, WifiOff, Activity, Database, Zap, RefreshCw } from 'lucide-react';
import { webSocketPriceManager, WebSocketManagerStatus } from '@/services/websocket-price-manager';
import { krakenWebSocketClient, KrakenConnectionStatus } from '@/services/kraken-websocket-client';
import { metaApiWebSocketClient, MetaApiConnectionStatus } from '@/services/metaapi-websocket-client';
import { isWebSocketEnabled } from '@/config/websocket-config';

export function WebSocketStatusPanel() {
  const [managerStatus, setManagerStatus] = useState<WebSocketManagerStatus | null>(null);
  const [krakenStatus, setKrakenStatus] = useState<KrakenConnectionStatus | null>(null);
  const [metaapiStatus, setMetaapiStatus] = useState<MetaApiConnectionStatus | null>(null);

  useEffect(() => {
    if (!isWebSocketEnabled()) return;

    const unsubManager = webSocketPriceManager.onStatusChange(setManagerStatus);
    const unsubKraken = krakenWebSocketClient.onStatusChange(setKrakenStatus);
    const unsubMetaapi = metaApiWebSocketClient.onStatusChange(setMetaapiStatus);

    return () => {
      unsubManager();
      unsubKraken();
      unsubMetaapi();
    };
  }, []);

  if (!isWebSocketEnabled()) {
    return (
      <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
        <div className="flex items-center gap-2 mb-3">
          <WifiOff className="w-5 h-5 text-zinc-500" />
          <h3 className="text-white font-medium">WebSocket Price Feeds</h3>
        </div>
        <p className="text-zinc-500 text-sm">
          WebSocket feeds are disabled. Set VITE_ENABLE_BROWSER_WEBSOCKET=true to enable.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wifi className={`w-5 h-5 ${managerStatus?.krakenConnected || managerStatus?.metaapiConnected ? 'text-emerald-400' : 'text-zinc-500'}`} />
          <h3 className="text-white font-medium">WebSocket Price Feeds</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
            managerStatus?.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-700 text-zinc-400'
          }`}>
            {managerStatus?.enabled ? 'ACTIVE' : 'INACTIVE'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-zinc-800/50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Zap className={`w-4 h-4 ${krakenStatus?.connected ? 'text-amber-400' : 'text-zinc-600'}`} />
            <span className="text-sm text-zinc-300">Kraken (Crypto)</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Status:</span>
              <span className={krakenStatus?.connected ? 'text-emerald-400' : 'text-red-400'}>
                {krakenStatus?.connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Symbols:</span>
              <span className="text-zinc-300">{krakenStatus?.subscribedSymbols.join(', ') || 'None'}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Ticks:</span>
              <span className="text-zinc-300">{krakenStatus?.tickCount.toLocaleString() || 0}</span>
            </div>
            {krakenStatus?.reconnectAttempts ? (
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Reconnects:</span>
                <span className="text-amber-400">{krakenStatus.reconnectAttempts}</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="bg-zinc-800/50 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Activity className={`w-4 h-4 ${metaapiStatus?.connected ? 'text-blue-400' : 'text-zinc-600'}`} />
            <span className="text-sm text-zinc-300">MetaAPI (Forex)</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Status:</span>
              <span className={metaapiStatus?.connected ? 'text-emerald-400' : 'text-red-400'}>
                {metaapiStatus?.synchronized ? 'Synchronized' : metaapiStatus?.connected ? 'Connecting...' : 'Disconnected'}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Symbols:</span>
              <span className="text-zinc-300 truncate max-w-[100px]" title={metaapiStatus?.subscribedSymbols.join(', ')}>
                {metaapiStatus?.subscribedSymbols.length || 0} subscribed
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Ticks:</span>
              <span className="text-zinc-300">{metaapiStatus?.tickCount.toLocaleString() || 0}</span>
            </div>
            {metaapiStatus?.reconnectAttempts ? (
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Reconnects:</span>
                <span className="text-amber-400">{metaapiStatus.reconnectAttempts}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="bg-zinc-800/30 rounded-lg p-3">
        <div className="flex items-center gap-2 mb-2">
          <Database className="w-4 h-4 text-cyan-400" />
          <span className="text-sm text-zinc-300">Aggregate Stats</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <div className="text-center">
            <div className="text-lg font-bold text-white">{managerStatus?.ticksPerSecond || 0}</div>
            <div className="text-xs text-zinc-500">ticks/sec</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-white">{managerStatus?.totalTicksReceived.toLocaleString() || 0}</div>
            <div className="text-xs text-zinc-500">received</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-emerald-400">{managerStatus?.totalTicksPersisted.toLocaleString() || 0}</div>
            <div className="text-xs text-zinc-500">persisted</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-amber-400">{managerStatus?.persistenceQueueSize || 0}</div>
            <div className="text-xs text-zinc-500">queued</div>
          </div>
        </div>
      </div>

      {managerStatus?.lastTickTime && (
        <div className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
          <RefreshCw className="w-3 h-3" />
          <span>Last tick: {new Date(managerStatus.lastTickTime).toLocaleTimeString()}</span>
        </div>
      )}
    </div>
  );
}
