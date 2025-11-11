import React from 'react';
import { TrendingUp, TrendingDown, Minus, Zap, Clock, Brain, Target } from 'lucide-react';

interface ConfidenceAdjustment {
  factor: string;
  originalValue: number;
  adjustment: number;
  finalValue: number;
  reasoning: string;
  icon: 'ev' | 'decay' | 'meta' | 'exploration' | 'pattern' | 'scenario';
}

interface ConfidenceDeltaMeterProps {
  originalConfidence: number;
  adjustedConfidence: number;
  adjustments: ConfidenceAdjustment[];
  threshold?: number;
  showBreakdown?: boolean;
}

/**
 * Confidence Delta Meter Component
 *
 * Visualizes how the AI adjusts confidence from the original signal
 * to the final decision. Shows transparency in AI decision-making.
 *
 * Features:
 * - Original vs adjusted confidence comparison
 * - Breakdown of each adjustment factor
 * - Visual indicators for positive/negative adjustments
 * - Threshold comparison
 */

export const ConfidenceDeltaMeter: React.FC<ConfidenceDeltaMeterProps> = ({
  originalConfidence,
  adjustedConfidence,
  adjustments,
  threshold = 75,
  showBreakdown = true
}) => {
  const delta = adjustedConfidence - originalConfidence;
  const deltaPercentage = originalConfidence > 0 ? (delta / originalConfidence) * 100 : 0;

  const getFactorIcon = (icon: string) => {
    const iconProps = { size: 16, className: "flex-shrink-0" };
    switch (icon) {
      case 'ev':
        return <Target {...iconProps} className="text-blue-500" />;
      case 'decay':
        return <Clock {...iconProps} className="text-orange-500" />;
      case 'meta':
        return <Brain {...iconProps} className="text-purple-500" />;
      case 'exploration':
        return <Zap {...iconProps} className="text-yellow-500" />;
      case 'pattern':
        return <TrendingUp {...iconProps} className="text-green-500" />;
      case 'scenario':
        return <Target {...iconProps} className="text-indigo-500" />;
      default:
        return <Minus {...iconProps} className="text-gray-500" />;
    }
  };

  const getDeltaColor = () => {
    if (delta > 10) return 'text-green-600';
    if (delta > 0) return 'text-green-500';
    if (delta < -10) return 'text-red-600';
    if (delta < 0) return 'text-red-500';
    return 'text-gray-600';
  };

  const getDeltaIcon = () => {
    if (delta > 5) return <TrendingUp className="text-green-600" size={20} />;
    if (delta < -5) return <TrendingDown className="text-red-600" size={20} />;
    return <Minus className="text-gray-600" size={20} />;
  };

  const getConfidenceBarColor = (conf: number) => {
    if (conf >= threshold + 10) return 'bg-green-500';
    if (conf >= threshold) return 'bg-blue-500';
    if (conf >= threshold - 10) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const meetsThreshold = adjustedConfidence >= threshold;

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900">
          AI Confidence Adjustment
        </h3>
        <div className={`flex items-center gap-1 ${getDeltaColor()}`}>
          {getDeltaIcon()}
          <span className="text-sm font-bold">
            {delta > 0 ? '+' : ''}{delta.toFixed(0)}%
          </span>
          <span className="text-xs text-gray-500">
            ({deltaPercentage > 0 ? '+' : ''}{deltaPercentage.toFixed(1)}%)
          </span>
        </div>
      </div>

      {/* Visual Comparison */}
      <div className="space-y-3 mb-4">
        {/* Original Confidence */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-gray-600">Original Signal</span>
            <span className="text-xs font-semibold text-gray-900">
              {originalConfidence.toFixed(0)}%
            </span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-gray-400 transition-all duration-300"
              style={{ width: `${originalConfidence}%` }}
            />
          </div>
        </div>

        {/* Adjusted Confidence */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-gray-600">AI Adjusted</span>
            <span className="text-xs font-bold text-gray-900">
              {adjustedConfidence.toFixed(0)}%
            </span>
          </div>
          <div className="h-3 bg-gray-200 rounded-full overflow-hidden relative">
            <div
              className={`h-full ${getConfidenceBarColor(adjustedConfidence)} transition-all duration-300`}
              style={{ width: `${adjustedConfidence}%` }}
            />
            {/* Threshold marker */}
            <div
              className="absolute top-0 w-0.5 h-full bg-gray-800"
              style={{ left: `${threshold}%` }}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 text-xs text-gray-800 whitespace-nowrap">
                ↑
              </div>
            </div>
          </div>
          <div className="flex justify-between items-center mt-1">
            <span className="text-xs text-gray-500">Threshold: {threshold}%</span>
            <span className={`text-xs font-semibold ${meetsThreshold ? 'text-green-600' : 'text-red-600'}`}>
              {meetsThreshold ? '✓ PASS' : '✗ BELOW'}
            </span>
          </div>
        </div>
      </div>

      {/* Adjustment Breakdown */}
      {showBreakdown && adjustments.length > 0 && (
        <div className="border-t border-gray-200 pt-3">
          <div className="text-xs font-semibold text-gray-700 mb-2">
            Adjustment Breakdown:
          </div>
          <div className="space-y-2">
            {adjustments.map((adj, index) => (
              <div
                key={index}
                className="flex items-start gap-2 text-xs"
              >
                <div className="mt-0.5">
                  {getFactorIcon(adj.icon)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-gray-700 truncate">
                      {adj.factor}
                    </span>
                    <span
                      className={`font-semibold flex-shrink-0 ${
                        adj.adjustment > 0
                          ? 'text-green-600'
                          : adj.adjustment < 0
                          ? 'text-red-600'
                          : 'text-gray-600'
                      }`}
                    >
                      {adj.adjustment > 0 ? '+' : ''}{adj.adjustment.toFixed(0)}%
                    </span>
                  </div>
                  {adj.reasoning && (
                    <div className="text-gray-500 text-xs mt-0.5 leading-tight">
                      {adj.reasoning}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="mt-4 pt-3 border-t border-gray-200">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-600">
            {adjustments.length} adjustment{adjustments.length !== 1 ? 's' : ''} applied
          </span>
          <span className={`font-semibold ${getDeltaColor()}`}>
            Final: {adjustedConfidence.toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * Compact version for inline display
 */
export const ConfidenceDeltaBadge: React.FC<{
  originalConfidence: number;
  adjustedConfidence: number;
  size?: 'sm' | 'md' | 'lg';
}> = ({ originalConfidence, adjustedConfidence, size = 'md' }) => {
  const delta = adjustedConfidence - originalConfidence;

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-3 py-1',
    lg: 'text-base px-4 py-1.5'
  };

  const getDeltaColor = () => {
    if (delta > 5) return 'bg-green-100 text-green-700 border-green-300';
    if (delta > 0) return 'bg-green-50 text-green-600 border-green-200';
    if (delta < -5) return 'bg-red-100 text-red-700 border-red-300';
    if (delta < 0) return 'bg-red-50 text-red-600 border-red-200';
    return 'bg-gray-100 text-gray-700 border-gray-300';
  };

  return (
    <div className={`inline-flex items-center gap-1 rounded-full border font-semibold ${getDeltaColor()} ${sizeClasses[size]}`}>
      <span className="opacity-75">{originalConfidence.toFixed(0)}%</span>
      <span className="opacity-50">→</span>
      <span>{adjustedConfidence.toFixed(0)}%</span>
      {delta !== 0 && (
        <span className="ml-0.5">
          ({delta > 0 ? '+' : ''}{delta.toFixed(0)})
        </span>
      )}
    </div>
  );
};

export default ConfidenceDeltaMeter;
