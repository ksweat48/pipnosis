import React from 'react';
import type { ProgressBarSegment } from '@/services/session-report-generator';

interface SPCProgressBarProps {
  segments: ProgressBarSegment[];
  cumulativeSPC: number;
  targetSPC: number;
  progressPercent: number;
  nextTier: string;
}

export function SPCProgressBar({
  segments,
  cumulativeSPC,
  targetSPC,
  progressPercent,
  nextTier
}: SPCProgressBarProps) {
  // Calculate max value for scaling
  const totalValue = segments.reduce((sum, seg) => sum + Math.abs(seg.value), 0);

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      {/* Header */}
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-sm font-semibold text-gray-200">Session SPC Breakdown</h3>
        <div className="text-xs text-gray-400">
          {cumulativeSPC.toFixed(1)} / {targetSPC} to {nextTier}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="relative h-10 bg-gray-900 rounded-lg overflow-hidden mb-3">
        <div className="flex h-full">
          {segments.map((segment, index) => {
            const widthPercent = totalValue > 0 ? (Math.abs(segment.value) / totalValue) * 100 : 0;

            return (
              <div
                key={index}
                className="flex items-center justify-center text-xs font-semibold text-white transition-all duration-300 hover:opacity-80 cursor-pointer"
                style={{
                  width: `${widthPercent}%`,
                  backgroundColor: segment.color,
                  minWidth: widthPercent > 0 ? '40px' : '0'
                }}
                title={segment.label}
              >
                {widthPercent > 10 && (
                  <span className="truncate px-1">
                    {segment.value >= 0 ? '+' : ''}{segment.value.toFixed(1)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {segments.map((segment, index) => (
          <div key={index} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded"
              style={{ backgroundColor: segment.color }}
            />
            <span className="text-gray-300">{segment.label}</span>
          </div>
        ))}
      </div>

      {/* Overall Progress to Next Tier */}
      <div className="mt-4 pt-3 border-t border-gray-700">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs text-gray-400">Progress to {nextTier}</span>
          <span className="text-xs font-semibold text-gray-200">
            {progressPercent.toFixed(1)}%
          </span>
        </div>
        <div className="h-2 bg-gray-900 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500"
            style={{ width: `${Math.min(100, progressPercent)}%` }}
          />
        </div>
        <div className="mt-1 text-xs text-gray-500 text-right">
          {(targetSPC - cumulativeSPC).toFixed(1)} SPC needed
        </div>
      </div>
    </div>
  );
}
