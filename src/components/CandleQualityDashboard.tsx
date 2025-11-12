import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Activity, AlertCircle, CheckCircle, TrendingUp, Database, RefreshCw } from 'lucide-react';
import { tickBufferService } from '@/services/tick-buffer-service';

interface QualityMetrics {
  symbol: string;
  timeframe: string;
  total_candles: number;
  metaapi_count: number;
  gap_fill_count: number;
  needs_repair_count: number;
  avg_completion_score: number;
  quality_percentage: number;
}

interface BufferStats {
  total: number;
  synced: number;
  unsynced: number;
  failed: number;
}

export function CandleQualityDashboard() {
  const [qualityMetrics, setQualityMetrics] = useState<QualityMetrics[]>([]);
  const [bufferStats, setBufferStats] = useState<Record<string, BufferStats>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    loadQualityMetrics();
    loadBufferStats();

    const interval = setInterval(() => {
      loadQualityMetrics();
      loadBufferStats();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  const loadQualityMetrics = async () => {
    try {
      const { data, error } = await supabase
        .from('candle_quality_summary')
        .select('*')
        .order('symbol')
        .order('timeframe');

      if (error) throw error;

      setQualityMetrics(data || []);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error loading quality metrics:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadBufferStats = () => {
    const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30'];
    const stats: Record<string, BufferStats> = {};

    symbols.forEach(symbol => {
      stats[symbol] = tickBufferService.getBufferStats(symbol);
    });

    setBufferStats(stats);
  };

  const getQualityColor = (percentage: number): string => {
    if (percentage >= 90) return 'text-green-600';
    if (percentage >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getQualityBadge = (percentage: number): string => {
    if (percentage >= 90) return 'bg-green-100 text-green-800';
    if (percentage >= 70) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-center">
          <RefreshCw className="animate-spin h-6 w-6 text-gray-400" />
          <span className="ml-2 text-gray-600">Loading quality metrics...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-2">
            <Activity className="h-6 w-6 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900">Candle Quality Dashboard</h2>
          </div>
          {lastUpdate && (
            <div className="text-sm text-gray-500">
              Last updated: {lastUpdate.toLocaleTimeString()}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {Object.entries(bufferStats).map(([symbol, stats]) => (
            <div key={symbol} className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-gray-900">{symbol}</span>
                <Database className="h-5 w-5 text-gray-400" />
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Buffered:</span>
                  <span className="font-medium">{stats.total}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Synced:</span>
                  <span className="font-medium text-green-600">{stats.synced}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Pending:</span>
                  <span className="font-medium text-yellow-600">{stats.unsynced}</span>
                </div>
                {stats.failed > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Failed:</span>
                    <span className="font-medium text-red-600">{stats.failed}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Symbol
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Timeframe
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Real Data
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Gap Fills
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Needs Repair
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Quality
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {qualityMetrics.map((metric, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                    {metric.symbol}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                    {metric.timeframe}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                    {metric.total_candles}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm">
                    <div className="flex items-center">
                      <CheckCircle className="h-4 w-4 text-green-500 mr-1" />
                      <span className="text-gray-900">{metric.metaapi_count}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm">
                    <div className="flex items-center">
                      <AlertCircle className="h-4 w-4 text-yellow-500 mr-1" />
                      <span className="text-gray-900">{metric.gap_fill_count}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm">
                    {metric.needs_repair_count > 0 ? (
                      <div className="flex items-center">
                        <AlertCircle className="h-4 w-4 text-red-500 mr-1" />
                        <span className="text-red-600">{metric.needs_repair_count}</span>
                      </div>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      <span className={`text-sm font-semibold ${getQualityColor(metric.quality_percentage)}`}>
                        {metric.quality_percentage.toFixed(1)}%
                      </span>
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${getQualityBadge(metric.quality_percentage)}`}>
                        {metric.quality_percentage >= 90 ? 'Excellent' : metric.quality_percentage >= 70 ? 'Good' : 'Poor'}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {qualityMetrics.length === 0 && (
          <div className="text-center py-8">
            <TrendingUp className="h-12 w-12 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-500">No quality metrics available</p>
          </div>
        )}
      </div>
    </div>
  );
}
