import React, { useEffect, useRef } from 'react';
import { createChart, IChartApi, ISeriesApi, LineStyle } from 'lightweight-charts';
import { IndicatorResult, VolumeData, PatternDetection, CandlePattern } from '@/utils/technicalIndicators';
import { TrendingUp, TrendingDown, Activity, BarChart3 } from 'lucide-react';

interface RSIPanelProps {
  data: IndicatorResult[];
}

export function RSIPanel({ data }: RSIPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#1f2937' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#374151' },
        horzLines: { color: '#374151' },
      },
      width: containerRef.current.clientWidth,
      height: 120,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        visible: true,
        borderColor: '#4b5563',
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
    });

    const lineSeries = chart.addLineSeries({
      color: '#8b5cf6',
      lineWidth: 2,
      lastValueVisible: true,
      priceLineVisible: false,
    });

    lineSeries.createPriceLine({
      price: 70,
      color: '#ef4444',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'Overbought',
    });

    lineSeries.createPriceLine({
      price: 30,
      color: '#10b981',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'Oversold',
    });

    lineSeries.createPriceLine({
      price: 50,
      color: '#6b7280',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: false,
      title: '',
    });

    chartRef.current = chart;
    lineSeriesRef.current = lineSeries;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (lineSeriesRef.current && data.length > 0) {
      lineSeriesRef.current.setData(data);
    }
  }, [data]);

  const currentRSI = data.length > 0 ? data[data.length - 1].value : null;

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Activity className="text-purple-500" size={18} />
          <h3 className="text-white font-semibold text-sm">RSI (14)</h3>
        </div>
        {currentRSI !== null && (
          <div className={`text-sm font-bold ${
            currentRSI >= 70 ? 'text-red-500' : currentRSI <= 30 ? 'text-emerald-500' : 'text-gray-400'
          }`}>
            {currentRSI.toFixed(2)}
          </div>
        )}
      </div>
      <div ref={containerRef} className="rounded overflow-hidden" />
    </div>
  );
}

interface ATRPanelProps {
  data: IndicatorResult[];
}

export function ATRPanel({ data }: ATRPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#1f2937' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#374151' },
        horzLines: { color: '#374151' },
      },
      width: containerRef.current.clientWidth,
      height: 120,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        visible: true,
        borderColor: '#4b5563',
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
    });

    const lineSeries = chart.addLineSeries({
      color: '#f59e0b',
      lineWidth: 2,
      lastValueVisible: true,
      priceLineVisible: false,
    });

    chartRef.current = chart;
    lineSeriesRef.current = lineSeries;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (lineSeriesRef.current && data.length > 0) {
      lineSeriesRef.current.setData(data);
    }
  }, [data]);

  const currentATR = data.length > 0 ? data[data.length - 1].value : null;

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="text-amber-500" size={18} />
          <h3 className="text-white font-semibold text-sm">ATR (14) - Volatility</h3>
        </div>
        {currentATR !== null && (
          <div className="text-amber-500 text-sm font-bold">
            {currentATR.toFixed(5)}
          </div>
        )}
      </div>
      <div ref={containerRef} className="rounded overflow-hidden" />
    </div>
  );
}

interface VolumePanelProps {
  data: VolumeData[];
}

export function VolumePanel({ data }: VolumePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const histogramSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#1f2937' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#374151' },
        horzLines: { color: '#374151' },
      },
      width: containerRef.current.clientWidth,
      height: 120,
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        visible: true,
        borderColor: '#4b5563',
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
    });

    const histogramSeries = chart.addHistogramSeries({
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
    });

    chartRef.current = chart;
    histogramSeriesRef.current = histogramSeries;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (histogramSeriesRef.current && data.length > 0) {
      const histogramData = data.map(d => ({
        time: d.time,
        value: d.volume,
        color: d.isAboveAverage ? '#10b981' : '#6b7280'
      }));
      histogramSeriesRef.current.setData(histogramData);
    }
  }, [data]);

  const avgVolume = data.length > 0
    ? data.reduce((sum, d) => sum + d.volume, 0) / data.length
    : 0;

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="text-emerald-500" size={18} />
          <h3 className="text-white font-semibold text-sm">Volume</h3>
        </div>
        <div className="text-gray-400 text-xs">
          Avg: {avgVolume.toFixed(2)}
        </div>
      </div>
      <div ref={containerRef} className="rounded overflow-hidden" />
    </div>
  );
}

interface PatternDetectionPanelProps {
  patterns: PatternDetection[];
}

export function PatternDetectionPanel({ patterns }: PatternDetectionPanelProps) {
  const recentPatterns = patterns.slice(-5);

  const getPatternIcon = (pattern: CandlePattern) => {
    switch (pattern) {
      case CandlePattern.BULLISH_ENGULFING:
      case CandlePattern.HAMMER:
      case CandlePattern.MOMENTUM_BULLISH:
        return <TrendingUp className="text-emerald-500" size={16} />;
      case CandlePattern.BEARISH_ENGULFING:
      case CandlePattern.INVERTED_HAMMER:
      case CandlePattern.MOMENTUM_BEARISH:
        return <TrendingDown className="text-red-500" size={16} />;
      default:
        return <Activity className="text-gray-500" size={16} />;
    }
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'high':
        return 'text-emerald-500';
      case 'medium':
        return 'text-amber-500';
      case 'low':
        return 'text-gray-500';
      default:
        return 'text-gray-500';
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="text-blue-500" size={18} />
        <h3 className="text-white font-semibold text-sm">Candle Pattern Detection</h3>
      </div>

      {recentPatterns.length === 0 ? (
        <div className="text-gray-500 text-xs text-center py-4">
          No patterns detected
        </div>
      ) : (
        <div className="space-y-2">
          {recentPatterns.reverse().map((detection, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between bg-gray-900/50 rounded px-3 py-2"
            >
              <div className="flex items-center gap-2">
                {getPatternIcon(detection.pattern)}
                <span className="text-white text-xs font-medium">
                  {detection.pattern}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold ${getConfidenceColor(detection.confidence)}`}>
                  {detection.confidence.toUpperCase()}
                </span>
                <span className="text-gray-500 text-xs">
                  {new Date(detection.time * 1000).toLocaleTimeString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
