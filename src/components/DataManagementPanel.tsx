import React, { useState, useEffect } from 'react';
import { Database, Download, RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, Play, Pause, Search, Activity, Brain, Zap, Sparkles, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { historicalDataService, type ProgressUpdate } from '@/services/historical-data-service';
import { automatedRefreshService } from '@/services/automated-refresh-service';
import { symbolValidator } from '@/services/symbol-validator';
import { Timeframe } from '@/services/chart-preferences';
import { SystemMonitoringPanel } from './SystemMonitoringPanel';
import { useAuth } from '@/hooks/useAuth';

interface DataCompletenessStatus {
  symbol: string;
  timeframe: string;
  has_data: boolean;
  oldest_candle: string | null;
  newest_candle: string | null;
  total_candles: number;
  is_stale: boolean;
  last_updated: string;
}

export function DataManagementPanel() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'historical' | 'monitoring' | 'training'>('monitoring');
  const [statusData, setStatusData] = useState<DataCompletenessStatus[]>([]);
  const [trainingData, setTrainingData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ProgressUpdate[]>([]);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [selectedTimeframes, setSelectedTimeframes] = useState<Timeframe[]>([]);
  const [daysBack, setDaysBack] = useState<number>(7);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(automatedRefreshService.isEnabled());
  const [isValidating, setIsValidating] = useState(false);
  const [symbolAvailability, setSymbolAvailability] = useState<Record<string, { available: boolean; reason?: string }>>({});
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);

  const TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'D1', 'W1'];

  useEffect(() => {
    loadDataStatus();
    loadSymbolAvailability();
    loadAvailableSymbols();
    if (user) {
      loadTrainingData();
    }
  }, [user]);

  const loadTrainingData = async () => {
    if (!user) return;

    try {
      // Get backtest sessions stats
      const { data: backtestSessions, count: backtestCount } = await supabase
        .from('backtest_sessions')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      const { data: syntheticSessions, count: syntheticCount } = await supabase
        .from('synthetic_backtest_sessions')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      // Get learning insights stats
      const { count: insightsCount } = await supabase
        .from('ai_learning_insights')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);

      // Get skill tracking stats
      const { count: skillCount } = await supabase
        .from('ai_skill_tracking')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);

      // Get pattern discoveries stats
      const { count: patternCount } = await supabase
        .from('ai_pattern_discoveries')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);

      // Get synthetic candles stats
      const { count: syntheticCandlesCount } = await supabase
        .from('synthetic_candles')
        .select('id', { count: 'exact', head: true });

      setTrainingData({
        backtestSessions: backtestSessions || [],
        syntheticSessions: syntheticSessions || [],
        totalBacktests: (backtestCount || 0) + (syntheticCount || 0),
        backtestCount: backtestCount || 0,
        syntheticCount: syntheticCount || 0,
        insightsCount: insightsCount || 0,
        skillCount: skillCount || 0,
        patternCount: patternCount || 0,
        syntheticCandlesCount: syntheticCandlesCount || 0
      });
    } catch (error) {
      console.error('[Data Management] Error loading training data:', error);
    }
  };

  const loadDataStatus = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('data_completeness_status')
        .select('*')
        .order('symbol', { ascending: true })
        .order('timeframe', { ascending: true });

      if (error) throw error;

      setStatusData(data || []);
    } catch (error) {
      console.error('Error loading data status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadAvailableSymbols = async () => {
    try {
      const symbols = await symbolValidator.getKnownWorkingSymbols();
      setAvailableSymbols(symbols);
    } catch (error) {
      console.error('Error loading available symbols:', error);
      setAvailableSymbols(['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY']);
    }
  };

  const loadSymbolAvailability = async () => {
    try {
      const { data, error } = await supabase
        .from('symbol_availability')
        .select('symbol, available_for_historical, error_message');

      if (error) throw error;

      const availability: Record<string, { available: boolean; reason?: string }> = {};
      data?.forEach((row) => {
        availability[row.symbol] = {
          available: row.available_for_historical,
          reason: row.error_message || undefined
        };
      });

      setSymbolAvailability(availability);
    } catch (error) {
      console.error('Error loading symbol availability:', error);
    }
  };

  const handleValidateSymbols = async () => {
    setIsValidating(true);
    try {
      const results = await symbolValidator.validateMultipleSymbols(availableSymbols);

      const availability: Record<string, { available: boolean; reason?: string }> = {};
      results.forEach((result) => {
        availability[result.symbol] = {
          available: result.available,
          reason: result.reason
        };
      });

      setSymbolAvailability(availability);

      const availableCount = results.filter(r => r.available).length;
      const unavailableCount = results.filter(r => !r.available).length;

      const newAvailable = results.filter(r => r.available).map(r => r.symbol);
      setAvailableSymbols(newAvailable);

      await automatedRefreshService.refreshSymbolList();

      alert(`Symbol validation complete:\n✓ ${availableCount} available\n✗ ${unavailableCount} unavailable`);
    } catch (error) {
      console.error('Symbol validation error:', error);
      alert('Symbol validation failed. Check console for details.');
    } finally {
      setIsValidating(false);
    }
  };

  const handleBulkImport = async () => {
    if (selectedSymbols.length === 0 || selectedTimeframes.length === 0) {
      alert('Please select at least one symbol and one timeframe');
      return;
    }

    setIsBulkImporting(true);
    setImportProgress([]);

    try {
      const result = await historicalDataService.bulkImportHistoricalData({
        symbols: selectedSymbols,
        timeframes: selectedTimeframes,
        daysBack,
        onProgress: (update) => {
          setImportProgress((prev) => {
            const existing = prev.findIndex(
              (p) => p.symbol === update.symbol && p.timeframe === update.timeframe
            );
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = update;
              return updated;
            }
            return [...prev, update];
          });
        },
      });

      console.log('Bulk import completed:', result);
      await loadDataStatus();
    } catch (error) {
      console.error('Bulk import error:', error);
      alert('Bulk import failed. Check console for details.');
    } finally {
      setIsBulkImporting(false);
    }
  };

  const handleSelectAllSymbols = () => {
    const available = availableSymbols.filter(s =>
      !symbolAvailability[s] || symbolAvailability[s].available !== false
    );

    if (selectedSymbols.length === available.length) {
      setSelectedSymbols([]);
    } else {
      setSelectedSymbols(available);
    }
  };

  const handleSelectAllTimeframes = () => {
    if (selectedTimeframes.length === TIMEFRAMES.length) {
      setSelectedTimeframes([]);
    } else {
      setSelectedTimeframes(TIMEFRAMES);
    }
  };

  const toggleSymbol = (symbol: string) => {
    setSelectedSymbols((prev) =>
      prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol]
    );
  };

  const toggleTimeframe = (timeframe: Timeframe) => {
    setSelectedTimeframes((prev) =>
      prev.includes(timeframe) ? prev.filter((t) => t !== timeframe) : [...prev, timeframe]
    );
  };

  const toggleAutoRefresh = () => {
    if (autoRefreshEnabled) {
      automatedRefreshService.stop();
      setAutoRefreshEnabled(false);
    } else {
      automatedRefreshService.start();
      setAutoRefreshEnabled(true);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="text-green-500" size={16} />;
      case 'failed':
        return <XCircle className="text-red-500" size={16} />;
      case 'fetching':
      case 'saving':
        return <RefreshCw className="text-blue-500 animate-spin" size={16} />;
      default:
        return <Clock className="text-gray-400" size={16} />;
    }
  };

  const completedTasks = importProgress.filter((p) => p.status === 'completed').length;
  const failedTasks = importProgress.filter((p) => p.status === 'failed').length;
  const totalTasks = selectedSymbols.length * selectedTimeframes.length;

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg border border-gray-700">
        <div className="flex border-b border-gray-700 overflow-x-auto">
          <button
            onClick={() => setActiveTab('historical')}
            className={`flex items-center gap-2 px-6 py-4 font-medium transition-all whitespace-nowrap ${
              activeTab === 'historical'
                ? 'text-emerald-500 border-b-2 border-emerald-500 bg-gray-900/50'
                : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/30'
            }`}
          >
            <Database size={20} />
            Historical Data
          </button>
          <button
            onClick={() => setActiveTab('training')}
            className={`flex items-center gap-2 px-6 py-4 font-medium transition-all whitespace-nowrap ${
              activeTab === 'training'
                ? 'text-blue-500 border-b-2 border-blue-500 bg-gray-900/50'
                : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/30'
            }`}
          >
            <Activity size={20} />
            AI Training Data
          </button>
          <button
            onClick={() => setActiveTab('monitoring')}
            className={`flex items-center gap-2 px-6 py-4 font-medium transition-all whitespace-nowrap ${
              activeTab === 'monitoring'
                ? 'text-emerald-500 border-b-2 border-emerald-500 bg-gray-900/50'
                : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/30'
            }`}
          >
            <Activity size={20} />
            System Monitoring
          </button>
        </div>
      </div>

      {activeTab === 'monitoring' ? (
        <SystemMonitoringPanel />
      ) : activeTab === 'training' ? (
        <div className="space-y-6">
          {/* AI Training Data Overview */}
          <div className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 backdrop-blur-sm border-2 border-blue-500/30 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-6">
              <Brain className="w-8 h-8 text-blue-400" />
              <div>
                <h2 className="text-2xl font-bold text-white">AI Training Data Management</h2>
                <p className="text-gray-300 text-sm">View and export AI learning data from the Training Lab</p>
              </div>
            </div>

            {trainingData && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                  <div className="text-sm text-gray-400 mb-1">Total Backtests</div>
                  <div className="text-2xl font-bold text-white">{trainingData.totalBacktests}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {trainingData.backtestCount} real / {trainingData.syntheticCount} synthetic
                  </div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                  <div className="text-sm text-gray-400 mb-1">Learning Insights</div>
                  <div className="text-2xl font-bold text-purple-400">{trainingData.insightsCount}</div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                  <div className="text-sm text-gray-400 mb-1">Pattern Discoveries</div>
                  <div className="text-2xl font-bold text-green-400">{trainingData.patternCount}</div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                  <div className="text-sm text-gray-400 mb-1">Skill Records</div>
                  <div className="text-2xl font-bold text-emerald-400">{trainingData.skillCount}</div>
                </div>
              </div>
            )}

            {/* Recent Backtest Sessions */}
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Zap className="w-5 h-5 text-green-400" />
                  Recent Training Sessions
                </h3>
                <button
                  onClick={loadTrainingData}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-all flex items-center gap-2"
                >
                  <RefreshCw size={14} />
                  Refresh
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700">
                      <th className="text-left py-2 px-3 text-gray-400 font-medium">Session Name</th>
                      <th className="text-left py-2 px-3 text-gray-400 font-medium">Type</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">Trades</th>
                      <th className="text-right py-2 px-3 text-gray-400 font-medium">Win Rate</th>
                      <th className="text-left py-2 px-3 text-gray-400 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trainingData && [...trainingData.backtestSessions, ...trainingData.syntheticSessions]
                      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                      .slice(0, 10)
                      .map((session: any, index: number) => (
                        <tr key={session.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                          <td className="py-2 px-3 text-white font-medium">{session.session_name}</td>
                          <td className="py-2 px-3">
                            {session.session_name?.startsWith('Auto-BT-') ? (
                              <span className="px-2 py-0.5 bg-green-600 text-white text-xs font-bold rounded flex items-center gap-1 w-fit">
                                <Zap className="w-3 h-3" />
                                AUTO
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-blue-600 text-white text-xs font-bold rounded w-fit">
                                MANUAL
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right text-gray-300">{session.total_trades}</td>
                          <td className={`py-2 px-3 text-right font-semibold ${
                            session.win_rate >= 55 ? 'text-green-400' : 'text-red-400'
                          }`}>
                            {session.win_rate?.toFixed(1)}%
                          </td>
                          <td className="py-2 px-3 text-gray-400 text-xs">
                            {new Date(session.created_at).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Synthetic Candles Stats */}
            {trainingData && trainingData.syntheticCandlesCount > 0 && (
              <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-5 h-5 text-purple-400" />
                  <h3 className="text-white font-semibold">Synthetic Data Storage</h3>
                </div>
                <p className="text-gray-400 text-sm">
                  <span className="text-purple-400 font-bold">{trainingData.syntheticCandlesCount.toLocaleString()}</span> synthetic candles stored
                </p>
              </div>
            )}

            {/* Export Options */}
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="w-5 h-5 text-emerald-400" />
                <h3 className="text-white font-semibold">Export Training Data</h3>
              </div>
              <p className="text-gray-400 text-sm mb-4">
                Export functionality coming soon. You can currently view all training data in the AI Learning Center and query directly from Supabase.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Database className="text-emerald-500" size={24} />
            <h2 className="text-xl font-bold text-white">Historical Data Management</h2>
          </div>
          <button
            onClick={toggleAutoRefresh}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              autoRefreshEnabled
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}
          >
            {autoRefreshEnabled ? <Pause size={18} /> : <Play size={18} />}
            <span>Auto-Refresh {autoRefreshEnabled ? 'ON' : 'OFF'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-gray-300">Symbols</label>
                <button
                  onClick={handleSelectAllSymbols}
                  className="text-xs text-emerald-500 hover:text-emerald-400"
                >
                  {selectedSymbols.length === availableSymbols.filter(s =>
                    !symbolAvailability[s] || symbolAvailability[s].available !== false
                  ).length ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {availableSymbols.map((symbol) => {
                  const availability = symbolAvailability[symbol];
                  const isUnavailable = availability && !availability.available;

                  return (
                    <button
                      key={symbol}
                      onClick={() => toggleSymbol(symbol)}
                      disabled={isUnavailable}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-all relative ${
                        isUnavailable
                          ? 'bg-gray-800 text-gray-500 cursor-not-allowed opacity-50'
                          : selectedSymbols.includes(symbol)
                          ? 'bg-emerald-600 text-white'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                      title={isUnavailable ? availability.reason : undefined}
                    >
                      {symbol}
                      {isUnavailable && (
                        <XCircle className="absolute top-1 right-1 text-red-500" size={12} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-gray-300">Timeframes</label>
                <button
                  onClick={handleSelectAllTimeframes}
                  className="text-xs text-emerald-500 hover:text-emerald-400"
                >
                  {selectedTimeframes.length === TIMEFRAMES.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {TIMEFRAMES.map((timeframe) => (
                  <button
                    key={timeframe}
                    onClick={() => toggleTimeframe(timeframe)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      selectedTimeframes.includes(timeframe)
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {timeframe}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-300 mb-2 block">Days Back</label>
              <input
                type="number"
                min="1"
                max="365"
                value={daysBack}
                onChange={(e) => setDaysBack(parseInt(e.target.value) || 7)}
                className="w-full bg-gray-700 text-white px-4 py-2 rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <button
              onClick={handleValidateSymbols}
              disabled={isValidating}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2"
            >
              {isValidating ? (
                <>
                  <RefreshCw className="animate-spin" size={18} />
                  Validating Symbols...
                </>
              ) : (
                <>
                  <Search size={18} />
                  Validate Symbol Availability
                </>
              )}
            </button>

            <button
              onClick={handleBulkImport}
              disabled={isBulkImporting || selectedSymbols.length === 0 || selectedTimeframes.length === 0}
              className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-all flex items-center justify-center gap-2"
            >
              {isBulkImporting ? (
                <>
                  <RefreshCw className="animate-spin" size={20} />
                  Importing... {completedTasks + failedTasks}/{totalTasks}
                </>
              ) : (
                <>
                  <Download size={20} />
                  Start Bulk Import
                </>
              )}
            </button>
          </div>

          <div className="bg-gray-900 rounded-lg p-4 max-h-96 overflow-y-auto">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Import Progress</h3>
            {importProgress.length === 0 ? (
              <p className="text-gray-500 text-sm">No import in progress</p>
            ) : (
              <div className="space-y-2">
                {importProgress.map((progress) => (
                  <div
                    key={`${progress.symbol}-${progress.timeframe}`}
                    className="flex items-center justify-between p-2 bg-gray-800 rounded"
                  >
                    <div className="flex items-center gap-2">
                      {getStatusIcon(progress.status)}
                      <span className="text-xs font-medium text-white">
                        {progress.symbol} {progress.timeframe}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400">
                      {progress.candlesSaved !== undefined && `${progress.candlesSaved} saved`}
                      {progress.error && <span className="text-red-400"> - Error</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Data Status</h3>
          <button
            onClick={loadDataStatus}
            disabled={isLoading}
            className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-all flex items-center gap-2"
          >
            <RefreshCw className={isLoading ? 'animate-spin' : ''} size={16} />
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-4 text-gray-300 font-medium">Symbol</th>
                <th className="text-left py-3 px-4 text-gray-300 font-medium">Timeframe</th>
                <th className="text-right py-3 px-4 text-gray-300 font-medium">Candles</th>
                <th className="text-left py-3 px-4 text-gray-300 font-medium">Oldest</th>
                <th className="text-left py-3 px-4 text-gray-300 font-medium">Newest</th>
                <th className="text-center py-3 px-4 text-gray-300 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-500">
                    Loading data status...
                  </td>
                </tr>
              ) : statusData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-500">
                    No data status available. Start a bulk import to populate data.
                  </td>
                </tr>
              ) : (
                statusData.map((status) => (
                  <tr
                    key={`${status.symbol}-${status.timeframe}`}
                    className="border-b border-gray-700/50 hover:bg-gray-700/30"
                  >
                    <td className="py-3 px-4 text-white font-medium">{status.symbol}</td>
                    <td className="py-3 px-4 text-gray-300">{status.timeframe}</td>
                    <td className="py-3 px-4 text-right text-gray-300">
                      {status.total_candles.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-400">
                      {formatDate(status.oldest_candle)}
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-400">
                      {formatDate(status.newest_candle)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      {status.is_stale ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded text-xs">
                          <AlertTriangle size={12} />
                          Stale
                        </span>
                      ) : status.has_data ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-500/20 text-green-400 rounded text-xs">
                          <CheckCircle size={12} />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-500/20 text-gray-400 rounded text-xs">
                          <XCircle size={12} />
                          No Data
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
        </div>
      )}
    </div>
  );
}
