/**
 * Data Availability Monitor Component
 *
 * Displays real-time information about historical candle data availability
 * across all symbols and timeframes. Helps identify backfill needs.
 */

import React, { useState, useEffect } from 'react';
import { RefreshCw, Database, AlertCircle, CheckCircle, Info } from 'lucide-react';
import {
  checkAllDataAvailability,
  getStorageStats,
  identifyBackfillNeeds,
  getSummary,
  type DataAvailability,
  type StorageStats
} from '@/services/historical-data-monitor';
import { Timeframe } from '@/services/chart-preferences';

const MONITORED_SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
const ALL_TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];

export function DataAvailabilityMonitor() {
  const [loading, setLoading] = useState(true);
  const [availabilities, setAvailabilities] = useState<DataAvailability[]>([]);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | 'all'>('all');

  useEffect(() => {
    loadDataAvailability();
  }, []);

  async function loadDataAvailability() {
    setLoading(true);
    try {
      const [avail, storage] = await Promise.all([
        checkAllDataAvailability(MONITORED_SYMBOLS, ALL_TIMEFRAMES),
        getStorageStats()
      ]);
      setAvailabilities(avail);
      setStorageStats(storage);
    } catch (error) {
      console.error('Error loading data availability:', error);
    } finally {
      setLoading(false);
    }
  }

  const filteredAvailabilities = selectedSymbol === 'all'
    ? availabilities
    : availabilities.filter(a => a.symbol === selectedSymbol);

  const summary = getSummary(availabilities);
  const backfillNeeds = identifyBackfillNeeds(availabilities);

  function getCompletenessColor(completeness: number): string {
    if (completeness >= 75) return 'text-green-400';
    if (completeness >= 25) return 'text-yellow-400';
    return 'text-red-400';
  }

  function getCompletenessIcon(completeness: number) {
    if (completeness >= 75) return <CheckCircle className="w-4 h-4 text-green-400" />;
    if (completeness >= 25) return <Info className="w-4 h-4 text-yellow-400" />;
    return <AlertCircle className="w-4 h-4 text-red-400" />;
  }

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-center space-x-3">
          <RefreshCw className="w-5 h-5 animate-spin text-blue-400" />
          <span className="text-gray-300">Loading data availability...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Database className="w-6 h-6 text-blue-400" />
          <h2 className="text-xl font-bold text-white">Historical Data Monitor</h2>
        </div>
        <button
          onClick={loadDataAvailability}
          className="flex items-center space-x-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Total Pairs × Timeframes</div>
          <div className="text-2xl font-bold text-white mt-1">{summary.total}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Average Completeness</div>
          <div className={`text-2xl font-bold mt-1 ${getCompletenessColor(summary.averageCompleteness)}`}>
            {summary.averageCompleteness}%
          </div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Storage Used</div>
          <div className="text-2xl font-bold text-white mt-1">
            {storageStats?.storageMB || 0} MB
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {storageStats?.percentUsed || 0}% of 500 MB
          </div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-sm text-gray-400">Status</div>
          <div className="flex items-center space-x-2 mt-1">
            <div className="flex items-center space-x-1">
              <div className="w-2 h-2 bg-green-400 rounded-full"></div>
              <span className="text-sm text-gray-300">{summary.good}</span>
            </div>
            <div className="flex items-center space-x-1">
              <div className="w-2 h-2 bg-yellow-400 rounded-full"></div>
              <span className="text-sm text-gray-300">{summary.warning}</span>
            </div>
            <div className="flex items-center space-x-1">
              <div className="w-2 h-2 bg-red-400 rounded-full"></div>
              <span className="text-sm text-gray-300">{summary.critical}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Backfill Needs Alert */}
      {backfillNeeds.length > 0 && (
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-yellow-400 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-yellow-400 mb-2">
                {backfillNeeds.length} Symbol/Timeframe pairs need attention
              </h3>
              <div className="space-y-1 text-sm text-gray-300">
                {backfillNeeds.slice(0, 5).map((need, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <span>{need.symbol} {need.timeframe}</span>
                    <span className="text-gray-500 text-xs">{need.reason}</span>
                  </div>
                ))}
                {backfillNeeds.length > 5 && (
                  <div className="text-gray-500 text-xs mt-2">
                    ...and {backfillNeeds.length - 5} more
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Symbol Filter */}
      <div className="flex items-center space-x-2">
        <label className="text-sm text-gray-400">Filter:</label>
        <select
          value={selectedSymbol}
          onChange={(e) => setSelectedSymbol(e.target.value)}
          className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm border border-gray-600 focus:outline-none focus:border-blue-500"
        >
          <option value="all">All Symbols</option>
          {MONITORED_SYMBOLS.map(symbol => (
            <option key={symbol} value={symbol}>{symbol}</option>
          ))}
        </select>
      </div>

      {/* Data Availability Table */}
      <div className="bg-gray-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/50">
              <tr>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Symbol</th>
                <th className="text-left px-4 py-3 text-gray-400 font-medium">Timeframe</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Candles</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Target</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Complete</th>
                <th className="text-right px-4 py-3 text-gray-400 font-medium">Oldest</th>
                <th className="text-center px-4 py-3 text-gray-400 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {filteredAvailabilities.map((availability, idx) => (
                <tr key={idx} className="hover:bg-gray-700/30 transition-colors">
                  <td className="px-4 py-3 text-white font-medium">{availability.symbol}</td>
                  <td className="px-4 py-3 text-gray-300">{availability.timeframe}</td>
                  <td className="px-4 py-3 text-right text-gray-300">
                    {availability.candleCount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {availability.historicalTarget.toLocaleString()}
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold ${getCompletenessColor(availability.completeness)}`}>
                    {availability.completeness}%
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500 text-xs">
                    {availability.oldestCandle
                      ? availability.oldestCandle.toLocaleDateString()
                      : 'N/A'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {getCompletenessIcon(availability.completeness)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info Footer */}
      <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-4">
        <div className="flex items-start space-x-3">
          <Info className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-gray-300 space-y-1">
            <p><strong className="text-white">Dynamic Loading:</strong> Charts automatically request optimal amounts of data per timeframe for fast performance.</p>
            <p><strong className="text-white">Historical Backfill:</strong> Scheduled functions continuously backfill missing historical data in the background.</p>
            <p><strong className="text-white">Storage Safe:</strong> Full historical data for 5 symbols uses only ~22 MB (4% of free tier limit).</p>
          </div>
        </div>
      </div>
    </div>
  );
}
