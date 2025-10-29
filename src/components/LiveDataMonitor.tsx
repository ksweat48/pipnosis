import React, { useEffect, useState } from 'react';
import { Activity, Clock, Wifi, WifiOff } from 'lucide-react';

interface LiveDataMonitorProps {
  connectionType: 'websocket' | 'polling' | 'none';
  lastUpdate: Date | null;
  isConnected: boolean;
}

export const LiveDataMonitor: React.FC<LiveDataMonitorProps> = ({
  connectionType,
  lastUpdate,
  isConnected
}) => {
  const [timeSinceUpdate, setTimeSinceUpdate] = useState<string>('--');
  const [ticksPerMinute, setTicksPerMinute] = useState<number>(0);
  const [recentTicks, setRecentTicks] = useState<Date[]>([]);

  useEffect(() => {
    if (lastUpdate) {
      const newTicks = [...recentTicks, lastUpdate].slice(-60);
      setRecentTicks(newTicks);

      const oneMinuteAgo = Date.now() - 60000;
      const recentTickCount = newTicks.filter(t => t.getTime() > oneMinuteAgo).length;
      setTicksPerMinute(recentTickCount);
    }
  }, [lastUpdate]);

  useEffect(() => {
    const updateTimer = setInterval(() => {
      if (lastUpdate) {
        const seconds = Math.floor((Date.now() - lastUpdate.getTime()) / 1000);
        if (seconds < 60) {
          setTimeSinceUpdate(`${seconds}s ago`);
        } else if (seconds < 3600) {
          setTimeSinceUpdate(`${Math.floor(seconds / 60)}m ago`);
        } else {
          setTimeSinceUpdate(`${Math.floor(seconds / 3600)}h ago`);
        }
      } else {
        setTimeSinceUpdate('Never');
      }
    }, 1000);

    return () => clearInterval(updateTimer);
  }, [lastUpdate]);

  const getStatusColor = () => {
    if (!isConnected) return 'text-red-500';
    if (connectionType === 'websocket') return 'text-green-500';
    if (connectionType === 'polling') return 'text-yellow-500';
    return 'text-gray-500';
  };

  const getConnectionLabel = () => {
    if (!isConnected) return 'Disconnected';
    if (connectionType === 'websocket') return 'WebSocket';
    if (connectionType === 'polling') return 'HTTP Polling (1.5s)';
    return 'Unknown';
  };

  return (
    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Wifi className={`w-4 h-4 ${getStatusColor()}`} />
          ) : (
            <WifiOff className="w-4 h-4 text-red-500" />
          )}
          <span className="text-sm font-medium text-gray-200">
            {getConnectionLabel()}
          </span>
        </div>
        <div className={`px-2 py-0.5 rounded text-xs font-medium ${
          isConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
        }`}>
          {isConnected ? 'LIVE' : 'OFFLINE'}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div className="flex items-center gap-2">
          <Clock className="w-3 h-3 text-gray-400" />
          <span className="text-gray-400">Last Update:</span>
          <span className="text-gray-200 font-medium">{timeSinceUpdate}</span>
        </div>
        <div className="flex items-center gap-2">
          <Activity className="w-3 h-3 text-gray-400" />
          <span className="text-gray-400">Ticks/min:</span>
          <span className="text-gray-200 font-medium">{ticksPerMinute}</span>
        </div>
      </div>

      {connectionType === 'polling' && (
        <div className="mt-2 text-xs text-yellow-400 bg-yellow-500/10 rounded px-2 py-1">
          ℹ️ Using HTTP polling for maximum reliability
        </div>
      )}

      {!isConnected && (
        <div className="mt-2 text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">
          ⚠️ No connection - check network or MetaAPI status
        </div>
      )}
    </div>
  );
};
