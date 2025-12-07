import React from 'react';
import { RefreshCw } from 'lucide-react';

interface PullToRefreshIndicatorProps {
  isPulling: boolean;
  isRefreshing: boolean;
  pullDistance: number;
  threshold: number;
}

export function PullToRefreshIndicator({
  isPulling,
  isRefreshing,
  pullDistance,
  threshold
}: PullToRefreshIndicatorProps) {
  if (!isPulling && !isRefreshing) return null;

  const progress = Math.min(pullDistance / threshold, 1);
  const rotation = progress * 360;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[10000] flex items-center justify-center pointer-events-none"
      style={{
        transform: `translateY(${isRefreshing ? '60px' : `${pullDistance}px`})`,
        transition: isRefreshing || !isPulling ? 'transform 0.3s ease-out' : 'none'
      }}
    >
      <div className="bg-gray-900/90 backdrop-blur-sm border border-gray-800/50 rounded-full p-3 shadow-lg">
        <RefreshCw
          size={20}
          className={`text-emerald-400 ${isRefreshing ? 'animate-spin' : ''}`}
          style={{
            transform: !isRefreshing ? `rotate(${rotation}deg)` : undefined,
            transition: !isRefreshing && isPulling ? 'none' : undefined
          }}
        />
      </div>
    </div>
  );
}
