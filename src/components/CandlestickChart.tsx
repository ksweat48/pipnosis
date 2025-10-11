import React, { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, Time, CandlestickSeries, HistogramSeries, LineSeries, HistogramData, LineData } from 'lightweight-charts';
import { AIAnalysisData } from '../types/ai-analysis';
import { ChartPreferences } from '../hooks/useChartPreferences';
import { chartOverlayService } from '../services/chart-overlays';

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
  const backgroundOverlayRef = useRef<HTMLDivElement | null>(null);
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
        borderColor: 'rgba(255, 255, 255, 0.3)',
        visible: true,
        alignLabels: true,
        scaleMargins: {
          top: 0.2,
          bottom: 0.2,
        },
        borderVisible: true,
        autoScale: true,
        mode: 0,
        invertScale: false,
        drawTicks: true,
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.2)',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 5,
        barSpacing: 12,
        minBarSpacing: 2,
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

    const precision = symbol === 'XAUUSD' ? 2 : 5;
    const minMove = symbol === 'XAUUSD' ? 0.01 : 0.00001;

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: upColor,
      downColor: downColor,
      borderUpColor: upColor,
      borderDownColor: downColor,
      wickUpColor: upColor,
      wickDownColor: downColor,
      priceScaleId: 'right',
      priceFormat: {
        type: 'price',
        precision: precision,
        minMove: minMove,
      },
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

  useEffect(() => {
    if (!isReady || !chartRef.current || !chartContainerRef.current || data.length === 0) {
      console.log('[CandlestickChart] Overlay rendering skipped:', { isReady, hasChart: !!chartRef.current, hasContainer: !!chartContainerRef.current, dataLength: data.length });
      return;
    }

    const overlayContainer = chartContainerRef.current.querySelector('.background-overlays') as HTMLDivElement;
    if (!overlayContainer) {
      console.log('[CandlestickChart] No overlay container found');
      return;
    }

    overlayContainer.innerHTML = '';

    const timestamps = data.map(d => d.time);
    console.log('[CandlestickChart] Processing overlays for', timestamps.length, 'timestamps');
    const daySeparators = chartOverlayService.getDaySeparators(timestamps);
    const marketClosedOverlays = chartOverlayService.getMarketClosedOverlays(timestamps);

    const latestTimestamp = timestamps[timestamps.length - 1];
    const nextMarketClosedOverlay = chartOverlayService.getNextMarketClosedOverlay(latestTimestamp);
    console.log('[CandlestickChart] Next market closed overlay:', nextMarketClosedOverlay);

    const timeScale = chartRef.current.timeScale();

    const renderOverlays = () => {
      if (!chartRef.current || !overlayContainer) return;

      overlayContainer.innerHTML = '';
      let dayRendered = 0;
      let marketClosedRendered = 0;

      daySeparators.forEach(separator => {
        const startCoord = timeScale.timeToCoordinate(separator.startTime as Time);
        const endCoord = timeScale.timeToCoordinate(separator.endTime as Time);

        if (startCoord !== null && endCoord !== null) {
          const rect = document.createElement('div');
          rect.style.position = 'absolute';
          rect.style.left = `${startCoord}px`;
          rect.style.width = `${Math.max(endCoord - startCoord, 1)}px`;
          rect.style.top = '0';
          rect.style.height = '100%';
          rect.style.backgroundColor = separator.color;
          rect.style.pointerEvents = 'none';
          rect.style.zIndex = '1';
          overlayContainer.appendChild(rect);
          dayRendered++;
        }
      });

      marketClosedOverlays.forEach(overlay => {
        const startCoord = timeScale.timeToCoordinate(overlay.startTime as Time);
        const endCoord = timeScale.timeToCoordinate(overlay.endTime as Time);

        if (startCoord !== null && endCoord !== null) {
          const rect = document.createElement('div');
          rect.style.position = 'absolute';
          rect.style.left = `${startCoord}px`;
          rect.style.width = `${Math.max(endCoord - startCoord, 1)}px`;
          rect.style.top = '0';
          rect.style.height = '100%';
          rect.style.backgroundColor = overlay.color;
          rect.style.pointerEvents = 'none';
          rect.style.zIndex = '2';
          overlayContainer.appendChild(rect);
          marketClosedRendered++;
        }
      });

      if (nextMarketClosedOverlay) {
        const startCoord = timeScale.timeToCoordinate(nextMarketClosedOverlay.startTime as Time);
        const endCoord = timeScale.timeToCoordinate(nextMarketClosedOverlay.endTime as Time);

        if (startCoord !== null && endCoord !== null && endCoord > startCoord) {
          const rect = document.createElement('div');
          rect.style.position = 'absolute';
          rect.style.left = `${startCoord}px`;
          rect.style.width = `${endCoord - startCoord}px`;
          rect.style.top = '0';
          rect.style.height = '100%';
          rect.style.backgroundColor = nextMarketClosedOverlay.color;
          rect.style.pointerEvents = 'none';
          rect.style.zIndex = '2';
          overlayContainer.appendChild(rect);
          marketClosedRendered++;
          console.log(`[CandlestickChart] Rendered current market closed overlay at ${startCoord}px with width ${endCoord - startCoord}px`);
        } else {
          console.log(`[CandlestickChart] Skipped rendering overlay - coordinates out of bounds: start=${startCoord}, end=${endCoord}`);
        }
      }

      console.log(`[CandlestickChart] Rendered ${dayRendered} day overlays and ${marketClosedRendered} market closed overlays`);
    };

    renderOverlays();

    const visibleLogicalRangeChangeHandler = () => {
      renderOverlays();
    };

    timeScale.subscribeVisibleLogicalRangeChange(visibleLogicalRangeChangeHandler);

    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(visibleLogicalRangeChangeHandler);
    };
  }, [data, isReady]);

  return (
    <div
      className="w-full rounded-2xl overflow-hidden border border-white/10 touch-manipulation relative"
      style={{ height: `${height}px`, touchAction: 'pan-x pan-y' }}
    >
      <div
        ref={chartContainerRef}
        style={{ position: 'relative', width: '100%', height: '100%' }}
      >
        <div
          className="background-overlays"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: 'none',
            zIndex: 1
          }}
        />
      </div>
    </div>
  );
};
