import React, { useState, useEffect } from 'react';
import { Database, RefreshCw, AlertCircle, CheckCircle, Loader, Download, Trash2 } from 'lucide-react';
import { historicalBackfillService, type BackfillResult, type Timeframe } from '@/services/historical-backfill-service';

export function HistoricalBackfillPanel() {
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);
  const [daysBack, setDaysBack] = useState(30);
  const [selectedSymbol, setSelectedSymbol] = useState<string>('');
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('');
  const [dataQuality, setDataQuality] = useState<any>(null);
  const [continuityReport, setContinuityReport] = useState<any>(null);

  const SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
  const TIMEFRAMES: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

  useEffect(() => {
    loadDataQuality();
  }, []);

  async function loadDataQuality() {
    try {
      const stats = await historicalBackfillService.getDataQualityStats();
      setDataQuality(stats);
    } catch (error) {
      console.error('Failed to load data quality stats:', error);
    }
  }

  async function handleBackfillAll() {
    if (!confirm(`⚠️ This will OVERWRITE ALL existing candles with fresh historical data from Dukascopy.\n\nThis operation will:\n- Delete all existing candles for all symbols and timeframes\n- Fetch last ${daysBack} days of historical data\n- Save new candles to database\n\nThis may take several minutes. Continue?`)) {
      return;
    }

    setIsBackfilling(true);
    setBackfillResult(null);

    try {
      const result = await historicalBackfillService.backfillAll(daysBack);
      setBackfillResult(result);
      await loadDataQuality();
    } catch (error) {
      console.error('Backfill failed:', error);
    } finally {
      setIsBackfilling(false);
    }
  }

  async function handleBackfillSingle() {
    if (!selectedSymbol || !selectedTimeframe) {
      alert('Please select both a symbol and timeframe');
      return;
    }

    if (!confirm(`Overwrite ${selectedSymbol} ${selectedTimeframe} candles with last ${daysBack} days of historical data?`)) {
      return;
    }

    setIsBackfilling(true);
    setBackfillResult(null);

    try {
      const result = await historicalBackfillService.backfillSingle(
        selectedSymbol,
        selectedTimeframe as Timeframe,
        daysBack
      );
      setBackfillResult(result);
      await loadDataQuality();
    } catch (error) {
      console.error('Backfill failed:', error);
    } finally {
      setIsBackfilling(false);
    }
  }

  async function handleCheckContinuity() {
    if (!selectedSymbol || !selectedTimeframe) {
      alert('Please select both a symbol and timeframe');
      return;
    }

    try {
      const report = await historicalBackfillService.getCandleContinuityReport(
        selectedSymbol,
        selectedTimeframe as Timeframe
      );
      setContinuityReport(report);
    } catch (error) {
      console.error('Failed to generate continuity report:', error);
    }
  }

  async function handleCleanDuplicates(dryRun: boolean) {
    try {
      const result = await historicalBackfillService.cleanupDuplicates(
        selectedSymbol || undefined,
        selectedTimeframe || undefined,
        dryRun
      );

      if (dryRun) {
        alert(`Found ${result.length} duplicate groups.\n\nWould remove ${result.reduce((sum, r) => sum + Number(r.removed_count), 0)} duplicate candles.`);
      } else {
        alert(`Cleaned up ${result.length} duplicate groups.\n\nRemoved ${result.reduce((sum, r) => sum + Number(r.removed_count), 0)} duplicate candles.`);
        await loadDataQuality();
      }
    } catch (error) {
      console.error('Failed to clean duplicates:', error);
      alert('Failed to clean duplicates. Check console for details.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="flex items-center gap-3 mb-4">
          <Database className="text-blue-400" size={24} />
          <h2 className="text-xl font-bold text-white">Historical Data Backfill</h2>
        </div>

        <p className="text-gray-400 text-sm mb-4">
          Fetch historical candle data from Dukascopy (free) and overwrite existing candles.
          This ensures clean, non-overlapping data with proper timestamps.
        </p>

        {dataQuality && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
              <div className="text-gray-400 text-xs mb-1">Total Candles</div>
              <div className="text-2xl font-bold text-white">{dataQuality.totalCandles.toLocaleString()}</div>
            </div>
            <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
              <div className="text-gray-400 text-xs mb-1">Dukascopy (High Quality)</div>
              <div className="text-2xl font-bold text-green-400">
                {dataQuality.bySource['dukascopy'] || 0}
              </div>
            </div>
            <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
              <div className="text-gray-400 text-xs mb-1">MetaAPI (Real-time)</div>
              <div className="text-2xl font-bold text-blue-400">
                {dataQuality.bySource['metaapi'] || 0}
              </div>
            </div>
            <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
              <div className="text-gray-400 text-xs mb-1">Duplicates</div>
              <div className={`text-2xl font-bold ${dataQuality.duplicates > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {dataQuality.duplicates}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">Days Back</label>
            <input
              type="number"
              value={daysBack}
              onChange={(e) => setDaysBack(parseInt(e.target.value) || 30)}
              className="w-full bg-gray-900 text-white px-3 py-2 rounded-lg border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              min="1"
              max="365"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">Symbol (optional)</label>
            <select
              value={selectedSymbol}
              onChange={(e) => setSelectedSymbol(e.target.value)}
              className="w-full bg-gray-900 text-white px-3 py-2 rounded-lg border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Symbols</option>
              {SYMBOLS.map(symbol => (
                <option key={symbol} value={symbol}>{symbol}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">Timeframe (optional)</label>
            <select
              value={selectedTimeframe}
              onChange={(e) => setSelectedTimeframe(e.target.value)}
              className="w-full bg-gray-900 text-white px-3 py-2 rounded-lg border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Timeframes</option>
              {TIMEFRAMES.map(tf => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleBackfillAll}
            disabled={isBackfilling}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
          >
            {isBackfilling ? (
              <>
                <Loader className="animate-spin" size={18} />
                Backfilling...
              </>
            ) : (
              <>
                <Download size={18} />
                Backfill All (Complete Overwrite)
              </>
            )}
          </button>

          {selectedSymbol && selectedTimeframe && (
            <button
              onClick={handleBackfillSingle}
              disabled={isBackfilling}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              <RefreshCw size={18} />
              Backfill {selectedSymbol} {selectedTimeframe}
            </button>
          )}

          {selectedSymbol && selectedTimeframe && (
            <button
              onClick={handleCheckContinuity}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
            >
              <AlertCircle size={18} />
              Check Continuity
            </button>
          )}

          {dataQuality && dataQuality.duplicates > 0 && (
            <>
              <button
                onClick={() => handleCleanDuplicates(true)}
                className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg font-medium transition-colors"
              >
                <AlertCircle size={18} />
                Preview Cleanup
              </button>

              <button
                onClick={() => handleCleanDuplicates(false)}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
              >
                <Trash2 size={18} />
                Clean Duplicates
              </button>
            </>
          )}
        </div>
      </div>

      {backfillResult && (
        <div className={`bg-gray-800 rounded-lg p-6 border ${backfillResult.success ? 'border-green-500' : 'border-red-500'}`}>
          <div className="flex items-center gap-3 mb-4">
            {backfillResult.success ? (
              <CheckCircle className="text-green-400" size={24} />
            ) : (
              <AlertCircle className="text-red-400" size={24} />
            )}
            <h3 className="text-lg font-bold text-white">Backfill Result</h3>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div>
              <div className="text-gray-400 text-xs mb-1">Candles Fetched</div>
              <div className="text-xl font-bold text-white">{backfillResult.totalCandlesFetched.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs mb-1">Candles Saved</div>
              <div className="text-xl font-bold text-green-400">{backfillResult.totalCandlesSaved.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs mb-1">Candles Deleted</div>
              <div className="text-xl font-bold text-yellow-400">{backfillResult.totalCandlesDeleted.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs mb-1">Duration</div>
              <div className="text-xl font-bold text-white">{backfillResult.durationMinutes}m</div>
            </div>
          </div>

          {backfillResult.results && backfillResult.results.length > 0 && (
            <div className="mt-4 max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-900 sticky top-0">
                  <tr>
                    <th className="text-left p-2 text-gray-400">Symbol</th>
                    <th className="text-left p-2 text-gray-400">Timeframe</th>
                    <th className="text-left p-2 text-gray-400">Status</th>
                    <th className="text-right p-2 text-gray-400">Fetched</th>
                    <th className="text-right p-2 text-gray-400">Saved</th>
                  </tr>
                </thead>
                <tbody>
                  {backfillResult.results.map((r, i) => (
                    <tr key={i} className="border-t border-gray-700">
                      <td className="p-2 text-white">{r.symbol}</td>
                      <td className="p-2 text-white">{r.timeframe}</td>
                      <td className="p-2">
                        <span className={`px-2 py-1 rounded text-xs ${
                          r.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                          r.status === 'error' ? 'bg-red-500/20 text-red-400' :
                          'bg-yellow-500/20 text-yellow-400'
                        }`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="p-2 text-right text-white">{r.candlesFetched}</td>
                      <td className="p-2 text-right text-green-400">{r.candlesSaved}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {continuityReport && (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-bold text-white mb-4">
            Continuity Report: {selectedSymbol} {selectedTimeframe}
          </h3>

          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <div className="text-gray-400 text-xs mb-1">Total Candles</div>
              <div className="text-xl font-bold text-white">{continuityReport.totalCandles}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs mb-1">Oldest Candle</div>
              <div className="text-sm text-white">{continuityReport.oldestCandle ? new Date(continuityReport.oldestCandle).toLocaleString() : 'N/A'}</div>
            </div>
            <div>
              <div className="text-gray-400 text-xs mb-1">Newest Candle</div>
              <div className="text-sm text-white">{continuityReport.newestCandle ? new Date(continuityReport.newestCandle).toLocaleString() : 'N/A'}</div>
            </div>
          </div>

          {continuityReport.gaps.length > 0 ? (
            <div>
              <div className="text-red-400 font-medium mb-2">⚠️ {continuityReport.gaps.length} gaps detected:</div>
              <div className="max-h-48 overflow-y-auto">
                {continuityReport.gaps.map((gap: any, i: number) => (
                  <div key={i} className="bg-gray-900 rounded p-3 mb-2 border border-red-500/30">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="text-xs text-gray-400">Gap {i + 1}</div>
                        <div className="text-sm text-white">
                          {new Date(gap.startTime).toLocaleString()} → {new Date(gap.endTime).toLocaleString()}
                        </div>
                      </div>
                      <div className="text-red-400 font-bold">{gap.missingCandles} candles missing</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle size={18} />
              <span>Perfect continuity - no gaps detected!</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
