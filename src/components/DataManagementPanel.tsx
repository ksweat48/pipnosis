import React, { useState, useEffect } from 'react';
import { Database, Download, RefreshCw, CheckCircle, XCircle, Clock, AlertTriangle, Play, Pause } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { historicalDataService, type ProgressUpdate } from '@/services/historical-data-service';
import { automatedRefreshService } from '@/services/automated-refresh-service';
import { Timeframe } from '@/services/chart-preferences';

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
  const [statusData, setStatusData] = useState<DataCompletenessStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBulkImporting, setIsBulkImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ProgressUpdate[]>([]);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [selectedTimeframes, setSelectedTimeframes] = useState<Timeframe[]>([]);
  const [daysBack, setDaysBack] = useState<number>(7);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(automatedRefreshService.isEnabled());

  const FOREX_PAIRS = [
    'XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF',
    'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'
  ];

  const TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'D1', 'W1'];

  useEffect(() => {
    loadDataStatus();
  }, []);

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
    if (selectedSymbols.length === FOREX_PAIRS.length) {
      setSelectedSymbols([]);
    } else {
      setSelectedSymbols(FOREX_PAIRS);
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
                  {selectedSymbols.length === FOREX_PAIRS.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {FOREX_PAIRS.map((symbol) => (
                  <button
                    key={symbol}
                    onClick={() => toggleSymbol(symbol)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      selectedSymbols.includes(symbol)
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {symbol}
                  </button>
                ))}
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
  );
}
