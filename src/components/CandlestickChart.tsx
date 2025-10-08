import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, Time, CandlestickSeries, HistogramSeries, LineSeries, HistogramData, LineData } from 'lightweight-charts';
import { AIAnalysisData } from '../types/ai-analysis';
import { ChartPreferences } from '../hooks/useChartPreferences';

interface CandlestickChartProps {
  symbol: string;
  data: CandlestickData<Time>[];
  volumeData?: HistogramData<Time>[];
  aiAnalysis?: AIAnalysisData;
  tradeLines?: {
    entry?: number;
    stopLoss?: number;
    takeProfit?: number;
  };
  height?: number;
  preferences?: ChartPreferences;
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  symbol,
  data,
  volumeData,
  aiAnalysis,
  tradeLines,
  height = 400,
  preferences
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLinesRef = useRef<any[]>([]);
  const aiPriceLinesRef = useRef<any[]>([]);
  const [isReady, setIsReady] = useState(false);
  const lastDataLengthRef = useRef(0);
  const lastVolumeLengthRef = useRef(0);
  const isInitialLoadRef = useRef(true);
  const updateQueueRef = useRef<CandlestickData<Time>[]>([]);
  const processingRef = useRef(false);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const bgColor = preferences?.background_color || 'rgba(15, 23, 42, 0.5)';
    const isLightTheme = preferences?.theme === 'light';
    const textColor = isLightTheme ? 'rgba(0, 0, 0, 0.7)' : 'rgba(255, 255, 255, 0.7)';
    const gridColor = isLightTheme ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: bgColor },
        textColor: textColor,
        fontSize: 12,
      },
      grid: {
        vertLines: { color: preferences?.show_grid !== false ? gridColor : 'transparent' },
        horzLines: { color: preferences?.show_grid !== false ? gridColor : 'transparent' },
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
        rightOffset: 5,
        barSpacing: 8,
        minBarSpacing: 0.5,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
      },
      kineticScroll: {
        touch: true,
        mouse: true,
      },
      trackingMode: {
        exitMode: 1,
      },
      height,
      width: chartContainerRef.current.clientWidth,
    });

    const upColor = preferences?.candlestick_up_color || '#10b981';
    const downColor = preferences?.candlestick_down_color || '#ef4444';

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: upColor,
      downColor: downColor,
      borderUpColor: upColor,
      borderDownColor: downColor,
      wickUpColor: upColor,
      wickDownColor: downColor,
      priceScaleId: 'right',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    const vwapSeries = chart.addSeries(LineSeries, {
      color: '#fbbf24',
      lineWidth: 2,
      lineStyle: 2,
      priceScaleId: 'right',
      title: 'VWAP',
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = volumeSeries;
    vwapSeriesRef.current = vwapSeries;
    setIsReady(true);

    const handleResize = () => {
      if (chartContainerRef.current && chart) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      updateQueueRef.current = [];
      processingRef.current = false;
      chart.remove();
    };
  }, [height]);

  useEffect(() => {
    if (!isReady || !candlestickSeriesRef.current || data.length === 0) return;

    const isStructureChange = data.length !== lastDataLengthRef.current;
    const isInitialLoad = lastDataLengthRef.current === 0;

    if (isInitialLoad) {
      candlestickSeriesRef.current.setData(data);
      lastDataLengthRef.current = data.length;
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent();
        isInitialLoadRef.current = false;
      }
      return;
    }

    if (isStructureChange) {
      if (data.length > lastDataLengthRef.current) {
        const newCandles = data.slice(lastDataLengthRef.current);
        newCandles.forEach(candle => {
          candlestickSeriesRef.current?.update(candle);
        });
        console.log(`Chart: Added ${newCandles.length} new candle(s)`);
      } else {
        candlestickSeriesRef.current.setData(data);
      }
      lastDataLengthRef.current = data.length;
    } else if (data.length > 0) {
      const lastCandle = data[data.length - 1];
      if (!processingRef.current) {
        processingRef.current = true;
        requestAnimationFrame(() => {
          if (candlestickSeriesRef.current) {
            candlestickSeriesRef.current.update(lastCandle);
          }
          processingRef.current = false;
        });
      }
    }
  }, [data, isReady]);

  useEffect(() => {
    if (!isReady || !volumeSeriesRef.current || !volumeData || volumeData.length === 0) return;

    const isStructureChange = volumeData.length !== lastVolumeLengthRef.current;
    const isInitialLoad = lastVolumeLengthRef.current === 0;

    if (isInitialLoad) {
      volumeSeriesRef.current.setData(volumeData);
      lastVolumeLengthRef.current = volumeData.length;
      return;
    }

    if (isStructureChange) {
      if (volumeData.length > lastVolumeLengthRef.current) {
        const newVolumes = volumeData.slice(lastVolumeLengthRef.current);
        newVolumes.forEach(volume => {
          volumeSeriesRef.current?.update(volume);
        });
      } else {
        volumeSeriesRef.current.setData(volumeData);
      }
      lastVolumeLengthRef.current = volumeData.length;
    } else if (volumeData.length > 0) {
      const lastVolume = volumeData[volumeData.length - 1];
      volumeSeriesRef.current.update(lastVolume);
    }
  }, [volumeData, isReady]);

  useEffect(() => {
    if (!isReady || !chartRef.current || !candlestickSeriesRef.current || !aiAnalysis) return;

    aiPriceLinesRef.current.forEach(line => {
      candlestickSeriesRef.current?.removePriceLine(line);
    });
    aiPriceLinesRef.current = [];

    if (aiAnalysis.supportResistanceLevels && aiAnalysis.supportResistanceLevels.length > 0) {
      aiAnalysis.supportResistanceLevels.forEach(level => {
        if (!candlestickSeriesRef.current) return;

        const line = candlestickSeriesRef.current.createPriceLine({
          price: level.price,
          color: level.type === 'support' ? '#3b82f680' : '#ef444480',
          lineWidth: 2,
          lineStyle: 2,
          axisLabelVisible: true,
          title: `${level.type.toUpperCase()} (${Math.round(level.confidence * 100)}%)`,
        });
        aiPriceLinesRef.current.push(line);
      });
    }

    if (aiAnalysis.vwap && vwapSeriesRef.current && data.length > 0) {
      const vwapData: LineData<Time>[] = data.map(candle => ({
        time: candle.time,
        value: aiAnalysis.vwap!
      }));
      vwapSeriesRef.current.setData(vwapData);
    }

    if (aiAnalysis.sessionMarkers && aiAnalysis.sessionMarkers.length > 0) {
      aiAnalysis.sessionMarkers.forEach(marker => {
        if (!candlestickSeriesRef.current) return;

        const color = marker.type === 'high' ? '#10b98160' : '#ef444460';
        const line = candlestickSeriesRef.current.createPriceLine({
          price: marker.price,
          color: color,
          lineWidth: 1,
          lineStyle: 3,
          axisLabelVisible: true,
          title: `${marker.session.toUpperCase()} ${marker.type.toUpperCase()}`,
        });
        aiPriceLinesRef.current.push(line);
      });
    }
  }, [aiAnalysis, isReady, data]);

  useEffect(() => {
    if (!isReady || !chartRef.current || !candlestickSeriesRef.current) return;

    priceLinesRef.current.forEach(line => {
      candlestickSeriesRef.current?.removePriceLine(line);
    });
    priceLinesRef.current = [];

    if (tradeLines?.entry) {
      const entryLine = candlestickSeriesRef.current.createPriceLine({
        price: tradeLines.entry,
        color: '#10b981',
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Entry',
      });
      priceLinesRef.current.push(entryLine);
    }

    if (tradeLines?.stopLoss) {
      const stopLossLine = candlestickSeriesRef.current.createPriceLine({
        price: tradeLines.stopLoss,
        color: '#ef4444',
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Stop Loss',
      });
      priceLinesRef.current.push(stopLossLine);
    }

    if (tradeLines?.takeProfit) {
      const takeProfitLine = candlestickSeriesRef.current.createPriceLine({
        price: tradeLines.takeProfit,
        color: '#22c55e',
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: 'Take Profit',
      });
      priceLinesRef.current.push(takeProfitLine);
    }
  }, [tradeLines, isReady]);

  return (
    <div
      ref={chartContainerRef}
      className="w-full rounded-2xl overflow-hidden border border-white/10 touch-manipulation"
      style={{ height: `${height}px`, touchAction: 'pan-x pan-y' }}
    />
  );
};
