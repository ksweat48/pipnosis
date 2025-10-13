import React, { useState, useEffect } from 'react';
import { Play, Pause, Settings, AlertCircle, CheckCircle, Clock, Activity } from 'lucide-react';
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

      const updateSuccess = await autoTradingController.updateAutoTradingConfig(user.id, {
        enabled: newEnabled,
        maxDailyTrades: config.maxDailyTrades,
        minConfidence: config.minConfidence,
        symbols: config.activeSymbols,
        tradingHours: {
          start: `${config.tradingHoursStart}:00`,
          end: `${config.tradingHoursEnd}:59`
        },
        riskPercentage: config.riskPercentage
      });

      if (!updateSuccess) {
        console.error('Failed to update auto-trading configuration');
        return;
      }

      if (newEnabled) {
        await strategyService.startAutoTrading(user.id);
      } else {
        await strategyService.stopAutoTrading();
      }

      await loadConfig();
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
    <div className="glass-card overflow-hidden">
      <div className="p-6 bg-gradient-to-r from-emerald-500/10 to-green-500/10 border-b border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${config.enabled ? 'bg-emerald-500/20' : 'bg-white/5'}`}>
              {config.enabled ? (
                <Play className="w-6 h-6 text-emerald-400" />
              ) : (
                <Pause className="w-6 h-6 text-white/60" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Automatic Trading</h3>
              <p className="text-sm text-white/60">
                {config.enabled ? 'Active and monitoring' : 'Paused'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          >
            <Settings className="w-5 h-5 text-white/60 hover:text-white" />
          </button>
        </div>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="p-4 bg-white/5 rounded-lg border border-white/10">
            <p className="text-xs font-medium text-white/60 mb-1">Daily Limit</p>
            <p className="text-2xl font-bold text-white">{config.maxDailyTrades}</p>
          </div>
          <div className="p-4 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
            <p className="text-xs font-medium text-emerald-400/80 mb-1">Remaining</p>
            <p className="text-2xl font-bold text-emerald-400">{config.tradesRemainingToday}</p>
          </div>
          <div className="p-4 bg-white/5 rounded-lg border border-white/10">
            <p className="text-xs font-medium text-white/60 mb-1">Min Confidence</p>
            <p className="text-2xl font-bold text-white">{config.minConfidence}%</p>
          </div>
        </div>

        <button
          onClick={handleToggle}
          disabled={loading}
          className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold transition-colors ${
            config.enabled
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white'
          } disabled:bg-white/10 disabled:text-white/40 disabled:cursor-not-allowed`}
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
          <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
            <div className="flex items-start gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-400">Auto Trading Active</p>
                <p className="text-xs text-emerald-400/80 mt-1">
                  Monitoring {config.activeSymbols.length} symbols. Will execute up to{' '}
                  {config.tradesRemainingToday} more trades today with signals above {config.minConfidence}% confidence.
                </p>
              </div>
            </div>
          </div>
        )}

        {!config.enabled && config.tradesRemainingToday === 0 && (
          <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-yellow-400">Daily Limit Reached</p>
                <p className="text-xs text-yellow-400/80 mt-1">
                  Maximum daily trades executed. Auto trading will resume tomorrow.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {showSettings && (
        <div className="border-t border-white/10 p-6 bg-white/5">
          <h4 className="font-semibold text-white mb-4">Auto Trading Settings</h4>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Maximum Daily Trades
              </label>
              <input
                type="number"
                min="1"
                max="20"
                value={editConfig.maxDailyTrades}
                onChange={(e) => setEditConfig({ ...editConfig, maxDailyTrades: parseInt(e.target.value) })}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Minimum Confidence (%)
              </label>
              <input
                type="number"
                min="50"
                max="100"
                value={editConfig.minConfidence}
                onChange={(e) => setEditConfig({ ...editConfig, minConfidence: parseInt(e.target.value) })}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Risk Per Trade (%)
              </label>
              <input
                type="number"
                min="0.1"
                max="5"
                step="0.1"
                value={editConfig.riskPercentage}
                onChange={(e) => setEditConfig({ ...editConfig, riskPercentage: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">
                Active Symbols
              </label>
              <div className="grid grid-cols-4 gap-2">
                {availableSymbols.map((symbol) => (
                  <button
                    key={symbol}
                    onClick={() => handleSymbolToggle(symbol)}
                    className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
                      editConfig.activeSymbols.includes(symbol)
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white/5 text-white/60 hover:bg-white/10 border border-white/10'
                    }`}
                  >
                    {symbol}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Trading Hours Start
                </label>
                <input
                  type="time"
                  value={editConfig.tradingHoursStart}
                  onChange={(e) => setEditConfig({ ...editConfig, tradingHoursStart: e.target.value })}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Trading Hours End
                </label>
                <input
                  type="time"
                  value={editConfig.tradingHoursEnd}
                  onChange={(e) => setEditConfig({ ...editConfig, tradingHoursEnd: e.target.value })}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={handleSaveSettings}
                disabled={loading}
                className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:bg-white/10 disabled:text-white/40 transition-colors"
              >
                Save Settings
              </button>
              <button
                onClick={() => {
                  setEditConfig(config);
                  setShowSettings(false);
                }}
                className="px-4 py-2 bg-white/5 text-white/70 rounded-lg font-medium hover:bg-white/10 border border-white/10 transition-colors"
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
