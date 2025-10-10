import React, { useState, useEffect } from 'react';
import {
  AlertTriangle, CheckCircle, XCircle, Clock, Play, Download,
  RefreshCw, Calendar, TrendingDown, Database, Activity
} from 'lucide-react';
import { gapDetectionService, GapAnalysisResult, SymbolTimeframeHealth } from '../services/gap-detection';
import { historicalBackfillService, BackfillTask } from '../services/historical-backfill';
import { Timeframe } from '../services/metaapi';

interface DataHealthPanelProps {
  symbols?: string[];
  timeframes?: Timeframe[];
}

export const DataHealthPanel: React.FC<DataHealthPanelProps> = ({
  symbols = ['EURUSD', 'GBPUSD', 'XAUUSD'],
  timeframes = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']
}) => {
  const [loading, setLoading] = useState(false);
  const [healthData, setHealthData] = useState<Map<string, SymbolTimeframeHealth[]>>(new Map());
  const [gapAnalysis, setGapAnalysis] = useState<Map<string, GapAnalysisResult[]>>(new Map());
  const [backfillTasks, setBackfillTasks] = useState<BackfillTask[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>(symbols[0]);
  const [dateRange, setDateRange] = useState({
    start: new Date('2024-10-01'),
    end: new Date('2024-10-15')
  });

  useEffect(() => {
    loadDataHealth();
    loadBackfillTasks();
  }, []);

  const loadDataHealth = async () => {
    setLoading(true);
    try {
      const healthMap = new Map<string, SymbolTimeframeHealth[]>();

      for (const symbol of symbols) {
        const symbolHealth: SymbolTimeframeHealth[] = [];

        for (const timeframe of timeframes) {
          const health = await gapDetectionService.getSymbolTimeframeHealth(symbol, timeframe);
          symbolHealth.push(health);
        }

        healthMap.set(symbol, symbolHealth);
      }

      setHealthData(healthMap);
    } catch (error) {
      console.error('Error loading data health:', error);
    } finally {
      setLoading(false);
    }
  };

  const scanForGaps = async () => {
    setLoading(true);
    try {
      const results = await gapDetectionService.scanAllSymbolsForGaps(
        dateRange.start,
        dateRange.end,
        symbols,
        timeframes
      );

      setGapAnalysis(results);
    } catch (error) {
      console.error('Error scanning for gaps:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadBackfillTasks = async () => {
    try {
      const tasks = await historicalBackfillService.getAllBackfillTasks(20);
      setBackfillTasks(tasks);
    } catch (error) {
      console.error('Error loading backfill tasks:', error);
    }
  };

  const triggerOctoberBackfill = async () => {
    setLoading(true);
    try {
      const tasks = await historicalBackfillService.backfillOctoberEighth(symbols, timeframes);
      console.log(`🚀 Started ${tasks.length} backfill tasks for October 8th`);

      setTimeout(() => {
        loadBackfillTasks();
      }, 2000);
    } catch (error) {
      console.error('Error triggering October backfill:', error);
    } finally {
      setLoading(false);
    }
  };

  const backfillDateRange = async () => {
    setLoading(true);
    try {
      const tasks: BackfillTask[] = [];

      for (const symbol of symbols) {
        for (const timeframe of timeframes) {
          const task = await historicalBackfillService.backfillDateRange(
            symbol,
            timeframe,
            dateRange.start,
            dateRange.end,
            100
          );
          tasks.push(task);
        }
      }

      console.log(`🚀 Started ${tasks.length} backfill tasks for date range`);

      setTimeout(() => {
        loadBackfillTasks();
      }, 2000);
    } catch (error) {
      console.error('Error backfilling date range:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportGapReport = async () => {
    try {
      const report = await gapDetectionService.generateGapReport(
        dateRange.start,
        dateRange.end,
        symbols
      );

      const blob = new Blob([report], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `gap-analysis-${new Date().toISOString().split('T')[0]}.md`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting gap report:', error);
    }
  };

  const getHealthColor = (health: string) => {
    switch (health) {
      case 'excellent': return 'text-green-400';
      case 'good': return 'text-emerald-400';
      case 'fair': return 'text-yellow-400';
      case 'poor': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getHealthIcon = (health: string) => {
    switch (health) {
      case 'excellent': return <CheckCircle className="h-5 w-5" />;
      case 'good': return <CheckCircle className="h-5 w-5" />;
      case 'fair': return <AlertTriangle className="h-5 w-5" />;
      case 'poor': return <XCircle className="h-5 w-5" />;
      default: return <Activity className="h-5 w-5" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-400 bg-green-400/20';
      case 'in_progress': return 'text-blue-400 bg-blue-400/20';
      case 'failed': return 'text-red-400 bg-red-400/20';
      case 'pending': return 'text-yellow-400 bg-yellow-400/20';
      default: return 'text-gray-400 bg-gray-400/20';
    }
  };

  const selectedSymbolHealth = healthData.get(selectedSymbol) || [];
  const selectedSymbolGaps = gapAnalysis.get(selectedSymbol) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white flex items-center space-x-3">
          <Database className="h-7 w-7 text-emerald-400" />
          <span>Data Health Monitor</span>
        </h2>
        <div className="flex items-center space-x-2">
          <button
            onClick={loadDataHealth}
            disabled={loading}
            className="px-4 py-2 glass-card hover:bg-white/10 transition-colors rounded-lg flex items-center space-x-2 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 text-emerald-400 ${loading ? 'animate-spin' : ''}`} />
            <span className="text-white text-sm">Refresh</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {symbols.map(symbol => {
          const symbolHealth = healthData.get(symbol) || [];
          const excellentCount = symbolHealth.filter(h => h.overallHealth === 'excellent').length;
          const poorCount = symbolHealth.filter(h => h.overallHealth === 'poor').length;
          const totalTimeframes = symbolHealth.length;

          return (
            <div
              key={symbol}
              onClick={() => setSelectedSymbol(symbol)}
              className={`glass-card p-4 cursor-pointer transition-all ${
                selectedSymbol === symbol ? 'ring-2 ring-emerald-400' : 'hover:bg-white/5'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold text-white">{symbol}</h3>
                {poorCount > 0 ? (
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                ) : (
                  <CheckCircle className="h-5 w-5 text-green-400" />
                )}
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/60">Timeframes Monitored</span>
                  <span className="text-white font-medium">{totalTimeframes}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">Excellent Health</span>
                  <span className="text-green-400 font-medium">{excellentCount}</span>
                </div>
                {poorCount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-white/60">Needs Attention</span>
                    <span className="text-red-400 font-medium">{poorCount}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="glass-card p-6">
        <h3 className="text-xl font-bold text-white mb-4">
          {selectedSymbol} - Timeframe Health Details
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left py-3 px-4 text-white/60 font-medium text-sm">Timeframe</th>
                <th className="text-left py-3 px-4 text-white/60 font-medium text-sm">Health</th>
                <th className="text-right py-3 px-4 text-white/60 font-medium text-sm">Total Candles</th>
                <th className="text-right py-3 px-4 text-white/60 font-medium text-sm">Avg/Day</th>
                <th className="text-right py-3 px-4 text-white/60 font-medium text-sm">Problem Dates</th>
                <th className="text-right py-3 px-4 text-white/60 font-medium text-sm">Date Range</th>
              </tr>
            </thead>
            <tbody>
              {selectedSymbolHealth.map((health) => (
                <tr key={health.timeframe} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-3 px-4">
                    <span className="text-white font-mono font-medium">{health.timeframe}</span>
                  </td>
                  <td className="py-3 px-4">
                    <div className={`flex items-center space-x-2 ${getHealthColor(health.overallHealth)}`}>
                      {getHealthIcon(health.overallHealth)}
                      <span className="capitalize font-medium">{health.overallHealth}</span>
                    </div>
                  </td>
                  <td className="text-right py-3 px-4 text-white font-mono">
                    {health.totalCandles.toLocaleString()}
                  </td>
                  <td className="text-right py-3 px-4 text-white font-mono">
                    {health.avgCandlesPerDay.toFixed(0)}
                  </td>
                  <td className="text-right py-3 px-4">
                    {health.problemDates.length > 0 ? (
                      <span className="text-red-400 font-medium">{health.problemDates.length}</span>
                    ) : (
                      <span className="text-green-400">0</span>
                    )}
                  </td>
                  <td className="text-right py-3 px-4 text-white/60 text-xs">
                    {health.oldestCandle && health.newestCandle ? (
                      <>
                        {health.oldestCandle.toISOString().split('T')[0]}
                        <br />to{' '}
                        {health.newestCandle.toISOString().split('T')[0]}
                      </>
                    ) : (
                      'No data'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="glass-card p-6">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center space-x-2">
          <Calendar className="h-5 w-5 text-emerald-400" />
          <span>Gap Detection & Backfill</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-white/60 text-sm mb-2">Start Date</label>
            <input
              type="date"
              value={dateRange.start.toISOString().split('T')[0]}
              onChange={(e) => setDateRange({ ...dateRange, start: new Date(e.target.value) })}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-white/60 text-sm mb-2">End Date</label>
            <input
              type="date"
              value={dateRange.end.toISOString().split('T')[0]}
              onChange={(e) => setDateRange({ ...dateRange, end: new Date(e.target.value) })}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            onClick={scanForGaps}
            disabled={loading}
            className="px-4 py-3 bg-blue-500 hover:bg-blue-600 transition-colors rounded-lg flex items-center justify-center space-x-2 disabled:opacity-50"
          >
            <Activity className="h-4 w-4 text-white" />
            <span className="text-white text-sm font-medium">Scan for Gaps</span>
          </button>

          <button
            onClick={triggerOctoberBackfill}
            disabled={loading}
            className="px-4 py-3 bg-emerald-500 hover:bg-emerald-600 transition-colors rounded-lg flex items-center justify-center space-x-2 disabled:opacity-50"
          >
            <Play className="h-4 w-4 text-white" />
            <span className="text-white text-sm font-medium">Fix Oct 8th</span>
          </button>

          <button
            onClick={backfillDateRange}
            disabled={loading}
            className="px-4 py-3 bg-orange-500 hover:bg-orange-600 transition-colors rounded-lg flex items-center justify-center space-x-2 disabled:opacity-50"
          >
            <TrendingDown className="h-4 w-4 text-white" />
            <span className="text-white text-sm font-medium">Backfill Range</span>
          </button>

          <button
            onClick={exportGapReport}
            disabled={loading || gapAnalysis.size === 0}
            className="px-4 py-3 glass-card hover:bg-white/10 transition-colors rounded-lg flex items-center justify-center space-x-2 disabled:opacity-50"
          >
            <Download className="h-4 w-4 text-white" />
            <span className="text-white text-sm font-medium">Export Report</span>
          </button>
        </div>

        {selectedSymbolGaps.length > 0 && (
          <div className="mt-6">
            <h4 className="text-lg font-semibold text-white mb-3">Gap Analysis Results</h4>
            <div className="space-y-2">
              {selectedSymbolGaps.map((analysis) => (
                <div key={analysis.timeframe} className="border border-white/10 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-white font-mono font-medium">{analysis.timeframe}</span>
                    <span className={`text-sm font-medium ${
                      analysis.completenessPercentage >= 95 ? 'text-green-400' :
                      analysis.completenessPercentage >= 80 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {analysis.completenessPercentage.toFixed(1)}% Complete
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-sm">
                    <div>
                      <span className="text-white/60">Candles:</span>{' '}
                      <span className="text-white">{analysis.totalCandles}</span>
                    </div>
                    <div>
                      <span className="text-white/60">Missing:</span>{' '}
                      <span className="text-red-400">{analysis.missingCandles}</span>
                    </div>
                    <div>
                      <span className="text-white/60">Gaps:</span>{' '}
                      <span className="text-orange-400">{analysis.gaps.length}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-white flex items-center space-x-2">
            <Clock className="h-5 w-5 text-emerald-400" />
            <span>Recent Backfill Tasks</span>
          </h3>
          <button
            onClick={loadBackfillTasks}
            className="text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2">
          {backfillTasks.length === 0 ? (
            <p className="text-white/60 text-center py-4">No backfill tasks yet</p>
          ) : (
            backfillTasks.slice(0, 10).map((task) => (
              <div key={task.id} className="border border-white/10 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-white font-medium">
                      {task.symbol} {task.timeframe}
                    </span>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(task.status)}`}>
                      {task.status}
                    </span>
                  </div>
                  <span className="text-white/60 text-xs">
                    {task.createdAt.toLocaleString()}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <span className="text-white/60">Target:</span>{' '}
                    <span className="text-white">{task.candlesTarget}</span>
                  </div>
                  <div>
                    <span className="text-white/60">Fetched:</span>{' '}
                    <span className="text-emerald-400">{task.candlesFetched}</span>
                  </div>
                  <div>
                    <span className="text-white/60">Date:</span>{' '}
                    <span className="text-white text-xs">
                      {task.startDate.toISOString().split('T')[0]}
                    </span>
                  </div>
                </div>
                {task.error && (
                  <div className="mt-2 text-xs text-red-400">
                    Error: {task.error}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
