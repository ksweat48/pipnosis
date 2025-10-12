import React, { useState, useEffect } from 'react';
import { Play, Pause, Settings, AlertCircle, CheckCircle, Clock, TrendingUp } from 'lucide-react';
import { autoTradingController } from '../strategies/core/autoTradingController';
import { strategyService } from '../strategies';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';

interface AutoTradingConfig {
  enabled: boolean;
  maxDailyTrades: number;
  tradesRemainingToday: number;
  minConfidence: number;
  riskPercentage: number;
  activeSymbols: string[];
  tradingHoursStart: string;
  tradingHoursEnd: string;
}

export function AutoTradingControls() {
  const { user } = useAuth();
  const [config, setConfig] = useState<AutoTradingConfig>({
    enabled: false,
    maxDailyTrades: 6,
    tradesRemainingToday: 6,
    minConfidence: 75,
    riskPercentage: 1.0,
    activeSymbols: ['EURUSD', 'GBPUSD', 'USDJPY'],
    tradingHoursStart: '00:00',
    tradingHoursEnd: '23:59'
  });
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editConfig, setEditConfig] = useState<AutoTradingConfig>(config);

  useEffect(() => {
    if (user) {
      loadConfig();
    }
  }, [user]);

  const loadConfig = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('auto_trading_sessions')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        const tradesRemaining = Math.max(0, data.max_daily_trades - (data.trades_taken_today || 0));
        setConfig({
          enabled: data.enabled,
          maxDailyTrades: data.max_daily_trades,
          tradesRemainingToday: tradesRemaining,
          minConfidence: data.min_confidence,
          riskPercentage: parseFloat(data.risk_percentage),
          activeSymbols: data.active_symbols || ['EURUSD', 'GBPUSD', 'USDJPY'],
          tradingHoursStart: data.trading_hours_start?.substring(0, 5) || '00:00',
          tradingHoursEnd: data.trading_hours_end?.substring(0, 5) || '23:59'
        });
        setEditConfig({
          enabled: data.enabled,
          maxDailyTrades: data.max_daily_trades,
          tradesRemainingToday: tradesRemaining,
          minConfidence: data.min_confidence,
          riskPercentage: parseFloat(data.risk_percentage),
          activeSymbols: data.active_symbols || ['EURUSD', 'GBPUSD', 'USDJPY'],
          tradingHoursStart: data.trading_hours_start?.substring(0, 5) || '00:00',
          tradingHoursEnd: data.trading_hours_end?.substring(0, 5) || '23:59'
        });
      }
    } catch (error) {
      console.error('Error loading auto trading config:', error);
    }
  };

  const handleToggle = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const newEnabled = !config.enabled;

      if (newEnabled) {
        await strategyService.startAutoTrading(user.id);
      } else {
        await strategyService.stopAutoTrading();
      }

      setConfig({ ...config, enabled: newEnabled });
    } catch (error) {
      console.error('Error toggling auto trading:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!user) return;

    setLoading(true);
    try {
      await autoTradingController.updateAutoTradingConfig(user.id, {
        enabled: editConfig.enabled,
        maxDailyTrades: editConfig.maxDailyTrades,
        minConfidence: editConfig.minConfidence,
        symbols: editConfig.activeSymbols,
        tradingHours: {
          start: `${editConfig.tradingHoursStart}:00`,
          end: `${editConfig.tradingHoursEnd}:59`
        },
        riskPercentage: editConfig.riskPercentage
      });

      setConfig(editConfig);
      setShowSettings(false);
    } catch (error) {
      console.error('Error saving settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSymbolToggle = (symbol: string) => {
    const symbols = editConfig.activeSymbols.includes(symbol)
      ? editConfig.activeSymbols.filter(s => s !== symbol)
      : [...editConfig.activeSymbols, symbol];
    setEditConfig({ ...editConfig, activeSymbols: symbols });
  };

  const availableSymbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD', 'XAUUSD'];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${config.enabled ? 'bg-green-100' : 'bg-gray-100'}`}>
              {config.enabled ? (
                <Play className="w-6 h-6 text-green-600" />
              ) : (
                <Pause className="w-6 h-6 text-gray-600" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Automatic Trading</h3>
              <p className="text-sm text-gray-600">
                {config.enabled ? 'Active and monitoring' : 'Paused'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 hover:bg-white/50 rounded-lg transition-colors"
          >
            <Settings className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <p className="text-xs font-medium text-blue-900 mb-1">Daily Limit</p>
            <p className="text-2xl font-bold text-blue-900">{config.maxDailyTrades}</p>
          </div>
          <div className="p-4 bg-green-50 rounded-lg border border-green-200">
            <p className="text-xs font-medium text-green-900 mb-1">Remaining</p>
            <p className="text-2xl font-bold text-green-900">{config.tradesRemainingToday}</p>
          </div>
          <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
            <p className="text-xs font-medium text-purple-900 mb-1">Min Confidence</p>
            <p className="text-2xl font-bold text-purple-900">{config.minConfidence}%</p>
          </div>
        </div>

        <button
          onClick={handleToggle}
          disabled={loading}
          className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold transition-colors ${
            config.enabled
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-green-600 hover:bg-green-700 text-white'
          } disabled:bg-gray-400 disabled:cursor-not-allowed`}
        >
          {loading ? (
            <>
              <Clock className="w-5 h-5 animate-spin" />
              Processing...
            </>
          ) : config.enabled ? (
            <>
              <Pause className="w-5 h-5" />
              Stop Auto Trading
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              Start Auto Trading
            </>
          )}
        </button>

        {config.enabled && (
          <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-start gap-2">
              <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-green-900">Auto Trading Active</p>
                <p className="text-xs text-green-700 mt-1">
                  Monitoring {config.activeSymbols.length} symbols. Will execute up to{' '}
                  {config.tradesRemainingToday} more trades today with signals above {config.minConfidence}% confidence.
                </p>
              </div>
            </div>
          </div>
        )}

        {!config.enabled && config.tradesRemainingToday === 0 && (
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-yellow-900">Daily Limit Reached</p>
                <p className="text-xs text-yellow-700 mt-1">
                  Maximum daily trades executed. Auto trading will resume tomorrow.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {showSettings && (
        <div className="border-t border-gray-200 p-6 bg-gray-50">
          <h4 className="font-semibold text-gray-900 mb-4">Auto Trading Settings</h4>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Maximum Daily Trades
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={editConfig.maxDailyTrades}
                onChange={(e) => setEditConfig({ ...editConfig, maxDailyTrades: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Minimum Confidence (%)
              </label>
              <input
                type="number"
                min="50"
                max="100"
                value={editConfig.minConfidence}
                onChange={(e) => setEditConfig({ ...editConfig, minConfidence: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Risk Per Trade (%)
              </label>
              <input
                type="number"
                min="0.1"
                max="5"
                step="0.1"
                value={editConfig.riskPercentage}
                onChange={(e) => setEditConfig({ ...editConfig, riskPercentage: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Active Symbols
              </label>
              <div className="grid grid-cols-4 gap-2">
                {availableSymbols.map((symbol) => (
                  <button
                    key={symbol}
                    onClick={() => handleSymbolToggle(symbol)}
                    className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                      editConfig.activeSymbols.includes(symbol)
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {symbol}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Trading Hours Start
                </label>
                <input
                  type="time"
                  value={editConfig.tradingHoursStart}
                  onChange={(e) => setEditConfig({ ...editConfig, tradingHoursStart: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Trading Hours End
                </label>
                <input
                  type="time"
                  value={editConfig.tradingHoursEnd}
                  onChange={(e) => setEditConfig({ ...editConfig, tradingHoursEnd: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={handleSaveSettings}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
              >
                Save Settings
              </button>
              <button
                onClick={() => {
                  setEditConfig(config);
                  setShowSettings(false);
                }}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
