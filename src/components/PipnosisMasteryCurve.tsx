import React, { useEffect, useRef, useState } from 'react';
import { createChart, LineSeries, IChartApi, ISeriesApi, LineData } from 'lightweight-charts';
import { useMasteryCurve } from '../hooks/useMasteryCurve';
import { Brain, RefreshCw, TrendingUp, TrendingDown, Minus, AlertCircle } from 'lucide-react';

interface PipnosisMasteryCurveProps {
  userId: string | null;
}

export function PipnosisMasteryCurve({ userId }: PipnosisMasteryCurveProps) {
  const { chartData, currentMastery, trendPercent, trend30Day, stats, loading, error, refresh } = useMasteryCurve(userId, true);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const seriesRefs = useRef<{
    mastery: ISeriesApi<'Line'> | null;
    winRate: ISeriesApi<'Line'> | null;
    evScore: ISeriesApi<'Line'> | null;
    calibration: ISeriesApi<'Line'> | null;
    llmPassRate: ISeriesApi<'Line'> | null;
    avoidPattern: ISeriesApi<'Line'> | null;
  }>({
    mastery: null,
    winRate: null,
    evScore: null,
    calibration: null,
    llmPassRate: null,
    avoidPattern: null
  });

  // Handle resize
  useEffect(() => {
    if (!chartRef.current || !chartContainerRef.current) return;

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        const newWidth = chartContainerRef.current.clientWidth;
        if (newWidth > 100) {
          chartRef.current.applyOptions({ width: newWidth });
        }
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [chartRef.current]);

  useEffect(() => {
    if (!chartContainerRef.current || loading || chartData.length === 0) return;

    // Use a small delay to ensure DOM is fully rendered and stable
    const timeoutId = setTimeout(() => {
      if (!chartContainerRef.current) {
        console.warn('[Mastery Curve] Container ref lost during timeout');
        return;
      }

      // Ensure container has valid dimensions before creating chart
      const containerWidth = chartContainerRef.current.clientWidth;
      const containerHeight = chartContainerRef.current.clientHeight;

      console.log('[Mastery Curve] Attempting chart creation:', {
        width: containerWidth,
        height: containerHeight,
        parentWidth: chartContainerRef.current.parentElement?.clientWidth,
        offsetWidth: chartContainerRef.current.offsetWidth,
        dataPoints: chartData.length
      });

      if (!containerWidth || containerWidth < 100) {
        console.warn('[Mastery Curve] Container not ready, dimensions:', { containerWidth, containerHeight });
        return;
      }

      // Clean up existing chart first
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch (e) {
          console.warn('[Mastery Curve] Error removing old chart:', e);
        }
        chartRef.current = null;
      }

      try {
        console.log('[Mastery Curve] Calling createChart with width:', containerWidth);
        const chart = createChart(chartContainerRef.current, {
          width: containerWidth,
          height: 400,
          layout: {
            background: { color: 'transparent' },
            textColor: '#9ca3af'
          },
          grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
            horzLines: { color: 'rgba(255, 255, 255, 0.05)' }
          },
          timeScale: {
            borderColor: '#374151',
            timeVisible: true
          },
          rightPriceScale: {
            borderColor: '#374151',
            scaleMargins: {
              top: 0.1,
              bottom: 0.1
            }
          },
          crosshair: {
            vertLine: {
              color: '#9ca3af',
              width: 1,
              style: 1,
              labelBackgroundColor: '#1f2937'
            },
            horzLine: {
              color: '#9ca3af',
              width: 1,
              style: 1,
              labelBackgroundColor: '#1f2937'
            }
          }
        });

        // Verify chart was created successfully
        if (!chart) {
          console.error('[Mastery Curve] Chart creation failed - chart is null/undefined');
          return;
        }

      chartRef.current = chart;

      seriesRefs.current.mastery = chart.addSeries(LineSeries, {
        color: '#f59e0b',
        lineWidth: 3
      });

      seriesRefs.current.winRate = chart.addSeries(LineSeries, {
        color: '#3b82f6',
        lineWidth: 2
      });

      seriesRefs.current.evScore = chart.addSeries(LineSeries, {
        color: '#14b8a6',
        lineWidth: 2
      });

      seriesRefs.current.calibration = chart.addSeries(LineSeries, {
        color: '#a855f7',
        lineWidth: 2
      });

      seriesRefs.current.llmPassRate = chart.addSeries(LineSeries, {
        color: '#22c55e',
        lineWidth: 2
      });

      seriesRefs.current.avoidPattern = chart.addSeries(LineSeries, {
        color: '#ef4444',
        lineWidth: 2
      });

    } catch (error) {
      console.error('[Mastery Curve] Error initializing chart:', error);
    }
    }, 100); // 100ms delay to ensure DOM is ready

    return () => {
      clearTimeout(timeoutId);
      if (chartRef.current) {
        try {
          chartRef.current.remove();
        } catch (e) {
          console.warn('[Mastery Curve] Error cleaning up chart:', e);
        }
        chartRef.current = null;
      }
    };
  }, [loading, chartData.length]);

  useEffect(() => {
    if (!chartRef.current || chartData.length === 0) {
      console.log('[Mastery Curve] Skipping data update:', { hasChart: !!chartRef.current, dataLength: chartData.length });
      return;
    }

    try {
      console.log('[Mastery Curve] Setting chart data:', { dataPoints: chartData.length, sampleData: chartData[0] });

      const masteryData: LineData[] = chartData.map(d => ({
        time: d.date as any,
        value: d.masteryScore
      }));

      const winRateData: LineData[] = chartData.map(d => ({
        time: d.date as any,
        value: d.winRate
      }));

      const evData: LineData[] = chartData.map(d => ({
        time: d.date as any,
        value: d.evScore
      }));

      const calibrationData: LineData[] = chartData.map(d => ({
        time: d.date as any,
        value: d.calibrationAccuracy
      }));

      const llmData: LineData[] = chartData.map(d => ({
        time: d.date as any,
        value: d.llmPassRate
      }));

      const avoidData: LineData[] = chartData.map(d => ({
        time: d.date as any,
        value: d.avoidPatternSuccess
      }));

      console.log('[Mastery Curve] Data prepared:', {
        masteryPoints: masteryData.length,
        winRatePoints: winRateData.length,
        sampleMastery: masteryData[0],
        sampleWinRate: winRateData[0]
      });

      if (seriesRefs.current.mastery) {
        seriesRefs.current.mastery.setData(masteryData);
        console.log('[Mastery Curve] Set mastery data');
      }
      if (seriesRefs.current.winRate) {
        seriesRefs.current.winRate.setData(winRateData);
        console.log('[Mastery Curve] Set win rate data');
      }
      if (seriesRefs.current.evScore) {
        seriesRefs.current.evScore.setData(evData);
      }
      if (seriesRefs.current.calibration) {
        seriesRefs.current.calibration.setData(calibrationData);
      }
      if (seriesRefs.current.llmPassRate) {
        seriesRefs.current.llmPassRate.setData(llmData);
      }
      if (seriesRefs.current.avoidPattern) {
        seriesRefs.current.avoidPattern.setData(avoidData);
      }

      chartRef.current.timeScale().fitContent();
      console.log('[Mastery Curve] Chart data set and fitted');
    } catch (error) {
      console.error('[Mastery Curve] Error updating chart data:', error);
    }
  }, [chartData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setTimeout(() => setRefreshing(false), 500);
  };

  if (loading) {
    return (
      <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Brain className="w-6 h-6 text-amber-400" />
            <h2 className="text-xl font-bold text-white">Pipnosis Mastery Curve (AI Evolution Score)</h2>
          </div>
        </div>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-400"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 backdrop-blur-sm border border-red-500/30 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <AlertCircle className="w-6 h-6 text-red-400" />
          <h2 className="text-xl font-bold text-white">Pipnosis Mastery Curve</h2>
        </div>
        <div className="text-red-300">
          <p className="mb-2">Failed to load mastery data: {error}</p>
          <button
            onClick={handleRefresh}
            className="text-red-400 underline hover:text-red-300"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-12 text-center">
        <Brain className="w-16 h-16 text-gray-600 mx-auto mb-4" />
        <h3 className="text-xl text-white font-semibold mb-2">
          No Mastery Data Yet
        </h3>
        <p className="text-gray-400">
          {userId ? 'Start running goal sessions to build your AI mastery curve.' : 'Waiting for users to run goal sessions to build platform-wide mastery data.'}
        </p>
      </div>
    );
  }

  const badgeColor =
    currentMastery >= 80 ? 'bg-green-600' :
    currentMastery >= 60 ? 'bg-yellow-600' :
    'bg-red-600';

  const trendIcon =
    trend30Day === 'up' ? <TrendingUp className="w-4 h-4" /> :
    trend30Day === 'down' ? <TrendingDown className="w-4 h-4" /> :
    <Minus className="w-4 h-4" />;

  return (
    <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Brain className="w-6 h-6 text-amber-400" />
          <h2 className="text-xl font-bold text-white">
            {userId ? 'Pipnosis Mastery Curve (AI Evolution Score)' : 'Platform-Wide Pipnosis Evolution (All Users)'}
          </h2>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-2 hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
          title="Refresh mastery data"
        >
          <RefreshCw className={`w-5 h-5 text-gray-400 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
        <div className="lg:col-span-3">
          <div ref={chartContainerRef} className="w-full" style={{ minHeight: '400px' }} />

          <div className="mt-4 flex flex-wrap gap-4 items-center justify-center text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-amber-500"></div>
              <span className="text-gray-300">Mastery Score</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500"></div>
              <span className="text-gray-300">Win Rate</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-teal-500"></div>
              <span className="text-gray-300">EV Score</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-purple-500"></div>
              <span className="text-gray-300">Confidence</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500"></div>
              <span className="text-gray-300">LLM Pass Rate</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500"></div>
              <span className="text-gray-300">Avoid Pattern</span>
            </div>
          </div>
        </div>

        <div className={`${badgeColor} rounded-lg p-6 text-white flex flex-col justify-center`}>
          <div className="text-sm opacity-80 mb-2">🔥 Mastery Level</div>
          <div className="text-5xl font-bold mb-3">{currentMastery.toFixed(1)}%</div>
          <div className="flex items-center gap-2 text-sm">
            {trendIcon}
            <span className="capitalize">{trend30Day}</span>
            <span className="font-semibold">
              {trendPercent > 0 ? '+' : ''}{trendPercent.toFixed(1)}%
            </span>
          </div>
        </div>
      </div>

      <div className="border-t border-gray-800 pt-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
          <div className="bg-gray-800/30 rounded-lg p-3">
            <div className="text-2xl mb-1">📈</div>
            <div className="text-xs text-gray-400 mb-1">30-day Trend</div>
            <div className="text-sm font-semibold text-white capitalize">{trend30Day}</div>
          </div>
          <div className="bg-gray-800/30 rounded-lg p-3">
            <div className="text-2xl mb-1">🧩</div>
            <div className="text-xs text-gray-400 mb-1">Patterns Added</div>
            <div className="text-sm font-semibold text-white">{stats.winningPatternsAdded}</div>
          </div>
          <div className="bg-gray-800/30 rounded-lg p-3">
            <div className="text-2xl mb-1">🛑</div>
            <div className="text-xs text-gray-400 mb-1">Mistakes Prevented</div>
            <div className="text-sm font-semibold text-white">{stats.mistakesPrevented}</div>
          </div>
          <div className="bg-gray-800/30 rounded-lg p-3">
            <div className="text-2xl mb-1">🎯</div>
            <div className="text-xs text-gray-400 mb-1">Confidence Accuracy</div>
            <div className="text-sm font-semibold text-white">{stats.confidenceAccuracy.toFixed(1)}%</div>
          </div>
          <div className="bg-gray-800/30 rounded-lg p-3">
            <div className="text-2xl mb-1">🔍</div>
            <div className="text-xs text-gray-400 mb-1">LLM Safety</div>
            <div className="text-sm font-semibold text-white">{stats.llmSafetyActivations}/day</div>
          </div>
        </div>
      </div>
    </div>
  );
}
