/**
 * PIP Utility Value Display Component
 *
 * Displays the current PIP Utility Value with:
 * - Current value (display-only USD units)
 * - 30-day change percentage
 * - Utility pressure gauge
 * - 30-day sparkline chart
 * - Required disclaimer
 *
 * Phase 3B: Token Treasury & Dynamic Utility Index
 */

import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Activity, Info } from 'lucide-react';
import { pipUtilityIndexEngine } from '@/services/pip-utility-index-engine';
import { logger } from '@/lib/logger';

export function PipUtilityValueDisplay() {
  const [loading, setLoading] = useState(true);
  const [currentValue, setCurrentValue] = useState<any>(null);
  const [indexChange, setIndexChange] = useState<any>(null);
  const [utilityPressure, setUtilityPressure] = useState<string>('Medium');
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    loadUtilityData();

    // Refresh every 5 minutes
    const interval = setInterval(loadUtilityData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  async function loadUtilityData() {
    try {
      const [value, change, pressure, hist] = await Promise.all([
        pipUtilityIndexEngine.getCurrentUtilityValue(),
        pipUtilityIndexEngine.getIndexChange(30),
        pipUtilityIndexEngine.getUtilityPressure(),
        pipUtilityIndexEngine.getIndexHistory(30)
      ]);

      setCurrentValue(value);
      setIndexChange(change);
      setUtilityPressure(pressure);
      setHistory(hist);
    } catch (error: any) {
      logger.error('Failed to load PIP utility value', { error });
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg p-6 text-white">
        <div className="flex items-center justify-center">
          <Activity className="h-6 w-6 animate-spin mr-2" />
          <span>Loading utility value...</span>
        </div>
      </div>
    );
  }

  if (!currentValue) {
    return null;
  }

  const pressureColor = {
    Low: 'text-green-600',
    Medium: 'text-yellow-600',
    High: 'text-red-600'
  }[utilityPressure] || 'text-gray-600';

  const pressureBgColor = {
    Low: 'bg-green-50',
    Medium: 'bg-yellow-50',
    High: 'bg-red-50'
  }[utilityPressure] || 'bg-gray-50';

  return (
    <div className="bg-white rounded-lg shadow-lg overflow-hidden">
      <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-6 text-white">
        <div className="flex items-center mb-2">
          <TrendingUp className="h-6 w-6 mr-2" />
          <h3 className="text-lg font-semibold">PIP Utility Ecosystem</h3>
        </div>
        <p className="text-sm opacity-90">
          Track platform activity and token usage dynamics
        </p>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          {/* Current Value */}
          <div className="text-center">
            <p className="text-sm text-gray-600 mb-2">PIP Utility Value</p>
            <p className="text-4xl font-bold text-purple-900">
              ${currentValue.display_value_usd.toFixed(4)}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Last updated: {new Date(currentValue.date).toLocaleDateString()}
            </p>
          </div>

          {/* 30-Day Change */}
          {indexChange && (
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-2">30-Day Change</p>
              <div className="flex items-center justify-center">
                {indexChange.change_percentage >= 0 ? (
                  <TrendingUp className="h-6 w-6 text-green-600 mr-2" />
                ) : (
                  <TrendingDown className="h-6 w-6 text-red-600 mr-2" />
                )}
                <p className={`text-3xl font-bold ${
                  indexChange.change_percentage >= 0 ? 'text-green-900' : 'text-red-900'
                }`}>
                  {indexChange.change_percentage >= 0 ? '+' : ''}
                  {indexChange.change_percentage.toFixed(2)}%
                </p>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                ${Math.abs(indexChange.change_amount).toFixed(4)} change
              </p>
            </div>
          )}

          {/* Utility Pressure */}
          <div className="text-center">
            <p className="text-sm text-gray-600 mb-2">Utility Pressure</p>
            <div className={`inline-block px-6 py-3 rounded-lg ${pressureBgColor}`}>
              <p className={`text-3xl font-bold ${pressureColor}`}>
                {utilityPressure}
              </p>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Based on 90-day activity
            </p>
          </div>
        </div>

        {/* 30-Day Sparkline */}
        {history.length > 0 && (
          <div className="mb-6">
            <p className="text-sm font-medium text-gray-700 mb-3">30-Day Trend</p>
            <div className="h-24 flex items-end space-x-1 bg-gray-50 rounded-lg p-2">
              {history.map((point, index) => {
                const maxValue = Math.max(...history.map(p => Number(p.display_value_usd)));
                const height = (Number(point.display_value_usd) / maxValue) * 100;
                return (
                  <div
                    key={index}
                    className="flex-1 bg-purple-500 rounded-t hover:bg-purple-600 transition-colors"
                    style={{ height: `${height}%`, minHeight: '2px' }}
                    title={`${new Date(point.date).toLocaleDateString()}: $${Number(point.display_value_usd).toFixed(4)}`}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Required Disclaimer */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start">
            <Info className="h-5 w-5 text-blue-600 mr-3 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">Important Notice</p>
              <p>
                Utility value reflects platform activity and token usage. This is not a cash value or redemption guarantee.
                The index is calculated daily using platform metrics: credits spent, PIP burned, staking participation,
                active users, and liquid supply.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
