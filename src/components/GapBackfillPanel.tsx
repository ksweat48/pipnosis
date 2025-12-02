import React, { useState } from 'react';
import { AlertCircle, CheckCircle, RefreshCw, TrendingUp, Database } from 'lucide-react';
import { gapBackfillCoordinator, GapAnalysis, BackfillProgress } from '@/services/gap-backfill-coordinator';
import { Timeframe } from '@/services/chart-preferences';

interface GapBackfillPanelProps {
  defaultSymbol?: string;
  defaultTimeframe?: Timeframe;
}

export function GapBackfillPanel({
  defaultSymbol = 'EURUSD',
  defaultTimeframe = 'M5'
}: GapBackfillPanelProps) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [timeframe, setTimeframe] = useState<Timeframe>(defaultTimeframe);
  const [daysBack, setDaysBack] = useState(30);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [analysis, setAnalysis] = useState<GapAnalysis | null>(null);
  const [progress, setProgress] = useState<BackfillProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30'];
  const timeframes: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setError(null);
    setAnalysis(null);
    setProgress(null);

    try {
      const result = await gapBackfillCoordinator.analyzeGaps(symbol, timeframe, daysBack);
      setAnalysis(result);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to analyze gaps';
      setError(errorMsg);
      console.error('[GapBackfillPanel] Analysis failed:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleBackfill = async (dryRun: boolean = false) => {
    if (!analysis) return;

    setIsBackfilling(true);
    setError(null);
    setProgress(null);

    try {
      const result = await gapBackfillCoordinator.backfillGaps(analysis, {
        dryRun,
        skipWeekends: true
      });
      setProgress(result);

      if (result.status === 'completed' && !dryRun) {
        // Auto-refresh analysis to show updated state
        setTimeout(() => handleAnalyze(), 2000);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to backfill gaps';
      setError(errorMsg);
      console.error('[GapBackfillPanel] Backfill failed:', err);
    } finally {
      setIsBackfilling(false);
    }
  };

  const handleSmartBackfill = async () => {
    setIsAnalyzing(true);
    setIsBackfilling(true);
    setError(null);
    setAnalysis(null);
    setProgress(null);

    try {
      const result = await gapBackfillCoordinator.smartBackfill(symbol, timeframe, daysBack);
      setAnalysis(result.analysis);
      setProgress(result.progress);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Smart backfill failed';
      setError(errorMsg);
      console.error('[GapBackfillPanel] Smart backfill failed:', err);
    } finally {
      setIsAnalyzing(false);
      setIsBackfilling(false);
    }
  };

  const renderGapSummary = () => {
    if (!analysis) return null;

    const tradingGaps = analysis.gaps.filter(g => !g.isMarketClosure);

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-700 rounded-lg p-4">
            <div className="text-sm text-gray-400">Total Candles</div>
            <div className="text-2xl font-bold text-white">{analysis.totalCandles}</div>
          </div>
          <div className="bg-gray-700 rounded-lg p-4">
            <div className="text-sm text-gray-400">Gaps Detected</div>
            <div className="text-2xl font-bold text-yellow-500">{analysis.gapsDetected}</div>
          </div>
          <div className="bg-gray-700 rounded-lg p-4">
            <div className="text-sm text-gray-400">Trading Gaps</div>
            <div className="text-2xl font-bold text-orange-500">{tradingGaps.length}</div>
          </div>
          <div className="bg-gray-700 rounded-lg p-4">
            <div className="text-sm text-gray-400">Missing Candles</div>
            <div className="text-2xl font-bold text-red-500">{analysis.totalMissingCandles}</div>
          </div>
        </div>

        {tradingGaps.length > 0 && (
          <div className="bg-gray-700 rounded-lg p-4">
            <h4 className="font-semibold text-white mb-3 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-yellow-500" />
              Trading Hours Gaps (excluding weekends)
            </h4>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {tradingGaps.slice(0, 10).map((gap, idx) => (
                <div key={idx} className="bg-gray-800 rounded p-3 text-sm">
                  <div className="flex justify-between items-center">
                    <div className="text-gray-300">
                      <div>{new Date(gap.startTime).toLocaleString()}</div>
                      <div className="text-xs text-gray-500">to {new Date(gap.endTime).toLocaleString()}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-orange-500 font-semibold">{gap.missingCandles} candles</div>
                      <div className="text-xs text-gray-500">{Math.round(gap.durationMinutes)}min gap</div>
                    </div>
                  </div>
                </div>
              ))}
              {tradingGaps.length > 10 && (
                <div className="text-center text-gray-500 text-sm py-2">
                  ... and {tradingGaps.length - 10} more gaps
                </div>
              )}
            </div>
          </div>
        )}

        {tradingGaps.length === 0 && (
          <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-4">
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle className="w-5 h-5" />
              <span className="font-semibold">No actionable gaps detected!</span>
            </div>
            <p className="text-sm text-gray-400 mt-2">
              Your data is complete for the selected time range. All detected gaps are during market closures (weekends/holidays).
            </p>
          </div>
        )}
      </div>
    );
  };

  const renderProgress = () => {
    if (!progress) return null;

    const isSuccess = progress.status === 'completed' && progress.errors.length === 0;
    const isError = progress.status === 'error' || progress.errors.length > 0;

    return (
      <div className={`rounded-lg p-4 ${
        isSuccess ? 'bg-green-900/20 border border-green-500/30' :
        isError ? 'bg-red-900/20 border border-red-500/30' :
        'bg-blue-900/20 border border-blue-500/30'
      }`}>
        <div className="flex items-center gap-2 mb-3">
          {isSuccess && <CheckCircle className="w-5 h-5 text-green-400" />}
          {isError && <AlertCircle className="w-5 h-5 text-red-400" />}
          {!isSuccess && !isError && <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />}
          <span className="font-semibold text-white capitalize">{progress.status}</span>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-gray-400">Gaps to Fill</div>
            <div className="text-white font-semibold">{progress.gapsToFill}</div>
          </div>
          <div>
            <div className="text-gray-400">Gaps Filled</div>
            <div className="text-green-400 font-semibold">{progress.gapsFilled}</div>
          </div>
          <div>
            <div className="text-gray-400">Candles Inserted</div>
            <div className="text-blue-400 font-semibold">{progress.candlesInserted}</div>
          </div>
          <div>
            <div className="text-gray-400">Duration</div>
            <div className="text-white font-semibold">
              {progress.endTime
                ? `${((progress.endTime.getTime() - progress.startTime.getTime()) / 1000).toFixed(1)}s`
                : 'In progress...'}
            </div>
          </div>
        </div>

        {progress.errors.length > 0 && (
          <div className="mt-3 bg-red-900/30 rounded p-2 text-sm text-red-300">
            <div className="font-semibold mb-1">Errors:</div>
            {progress.errors.map((err, idx) => (
              <div key={idx} className="text-xs">• {err}</div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg p-6 space-y-6">
      <div className="flex items-center gap-3 pb-4 border-b border-gray-700">
        <Database className="w-6 h-6 text-blue-400" />
        <h3 className="text-xl font-bold text-white">Historical Data Gap Backfill</h3>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">Symbol</label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isAnalyzing || isBackfilling}
            >
              {symbols.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">Timeframe</label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as Timeframe)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isAnalyzing || isBackfilling}
            >
              {timeframes.map(tf => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">Days Back</label>
            <input
              type="number"
              min="1"
              max="90"
              value={daysBack}
              onChange={(e) => setDaysBack(parseInt(e.target.value) || 30)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isAnalyzing || isBackfilling}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || isBackfilling}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAnalyzing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <TrendingUp className="w-4 h-4" />
                Analyze Gaps
              </>
            )}
          </button>

          {analysis && analysis.totalMissingCandles > 0 && (
            <>
              <button
                onClick={() => handleBackfill(true)}
                disabled={isBackfilling}
                className="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Preview Backfill
              </button>

              <button
                onClick={() => handleBackfill(false)}
                disabled={isBackfilling}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isBackfilling ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Backfilling...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Execute Backfill
                  </>
                )}
              </button>
            </>
          )}

          <button
            onClick={handleSmartBackfill}
            disabled={isAnalyzing || isBackfilling}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
          >
            {isAnalyzing || isBackfilling ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Database className="w-4 h-4" />
                Smart Backfill (Auto)
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle className="w-5 h-5" />
            <span className="font-semibold">Error</span>
          </div>
          <p className="text-sm text-gray-300 mt-2">{error}</p>
        </div>
      )}

      {renderGapSummary()}
      {renderProgress()}

      <div className="bg-gray-700/50 rounded-lg p-4 text-sm text-gray-400">
        <h4 className="font-semibold text-white mb-2">How it works:</h4>
        <ul className="list-disc list-inside space-y-1">
          <li><span className="text-blue-400">Analyze Gaps:</span> Scans your database for missing candles in the selected time range</li>
          <li><span className="text-green-400">Execute Backfill:</span> Fetches missing candles from MetaAPI and inserts them safely (no overwrites)</li>
          <li><span className="text-purple-400">Smart Backfill:</span> Automatically analyzes and fills gaps in one operation</li>
          <li><span className="text-yellow-400">Safe Operation:</span> Uses ON CONFLICT DO NOTHING - existing candles are never overwritten</li>
        </ul>
      </div>
    </div>
  );
}
