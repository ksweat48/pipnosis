import React from 'react';
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';

interface KPIMetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  isAnomaly?: boolean;
  anomalyReason?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
}

export function KPIMetricCard({
  title,
  value,
  subtitle,
  trend,
  trendValue,
  isAnomaly,
  anomalyReason,
  icon,
  onClick
}: KPIMetricCardProps) {
  const getTrendColor = () => {
    if (isAnomaly) return 'text-red-400';
    if (trend === 'up') return 'text-green-400';
    if (trend === 'down') return 'text-red-400';
    return 'text-gray-400';
  };

  const getTrendIcon = () => {
    if (trend === 'up') return <TrendingUp className="w-4 h-4" />;
    if (trend === 'down') return <TrendingDown className="w-4 h-4" />;
    return <Minus className="w-4 h-4" />;
  };

  return (
    <div
      className={`bg-gray-800/50 backdrop-blur-sm border rounded-lg p-4 transition-all ${
        isAnomaly
          ? 'border-red-500/50 shadow-lg shadow-red-500/20'
          : 'border-gray-700 hover:border-gray-600'
      } ${onClick ? 'cursor-pointer hover:bg-gray-800/70' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon && <div className="text-blue-400">{icon}</div>}
          <h3 className="text-sm font-medium text-gray-300">{title}</h3>
        </div>
        {isAnomaly && (
          <AlertTriangle className="w-5 h-5 text-red-400 animate-pulse" />
        )}
      </div>

      <div className="space-y-2">
        <div className="text-3xl font-bold text-white">
          {value}
        </div>

        {subtitle && (
          <div className="text-xs text-gray-400">
            {subtitle}
          </div>
        )}

        {(trend || trendValue) && (
          <div className={`flex items-center gap-1 text-sm ${getTrendColor()}`}>
            {trend && getTrendIcon()}
            {trendValue && <span>{trendValue}</span>}
          </div>
        )}

        {isAnomaly && anomalyReason && (
          <div className="mt-3 p-2 bg-red-900/20 border border-red-500/30 rounded text-xs text-red-300">
            {anomalyReason}
          </div>
        )}
      </div>
    </div>
  );
}
