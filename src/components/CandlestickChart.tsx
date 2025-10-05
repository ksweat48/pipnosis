import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, Time, CandlestickSeries } from 'lightweight-charts';

interface CandlestickChartProps {
  symbol: string;
  data: CandlestickData<Time>[];
  tradeLines?: {
    entry?: number;
    stopLoss?: number;
    takeProfit?: number;
  };
  height?: number;
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  symbol,
  data,
  tradeLines,
  height = 400
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'rgba(15, 23, 42, 0.5)' },
        textColor: 'rgba(255, 255, 255, 0.7)',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.1)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.1)' },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: 'rgba(16, 185, 129, 0.5)',
          width: 1,
          style: 0,
        },
        horzLine: {
          color: 'rgba(16, 185, 129, 0.5)',
          width: 1,
          style: 0,
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.2)',
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.2)',
        timeVisible: true,
        secondsVisible: false,
      },
      height,
      width: chartContainerRef.current.clientWidth,
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    setIsReady(true);

    const handleResize = () => {
      if (chartContainerRef.current && chart) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [height]);

  useEffect(() => {
    if (!isReady || !candlestickSeriesRef.current || data.length === 0) return;

    candlestickSeriesRef.current.setData(data);

    if (chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [data, isReady]);

  useEffect(() => {
    if (!isReady || !chartRef.current || !candlestickSeriesRef.current) return;

    candlestickSeriesRef.current.setMarkers([]);

    if (tradeLines?.entry) {
      candlestickSeriesRef.current.createPriceLine({
        price: tradeLines.entry,
        color: '#10b981',
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Entry',
      });
    }

    if (tradeLines?.stopLoss) {
      candlestickSeriesRef.current.createPriceLine({
        price: tradeLines.stopLoss,
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Stop Loss',
      });
    }

    if (tradeLines?.takeProfit) {
      candlestickSeriesRef.current.createPriceLine({
        price: tradeLines.takeProfit,
        color: '#22c55e',
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Take Profit',
      });
    }
  }, [tradeLines, isReady]);

  return (
    <div
      ref={chartContainerRef}
      className="w-full rounded-2xl overflow-hidden border border-white/10"
      style={{ height: `${height}px` }}
    />
  );
};
