import React, { useEffect, useRef, useState, memo } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, Time, CandlestickSeries, HistogramSeries, LineSeries, HistogramData, LineData } from 'lightweight-charts';
import { AIAnalysisData } from '../types/ai-analysis';
import { ChartPreferences } from '../hooks/useChartPreferences';
import { chartOverlayService } from '../services/chart-overlays';

interface CandlestickChartProps {
  symbol: string;
  data: CandlestickData<Time>[];
  volumeData?: HistogramData<Time>[];
  aiAnalysis?: AIAnalysisData;
  emaData?: {
    ema5?: LineData<Time>[];
    ema9?: LineData<Time>[];
    ema21?: LineData<Time>[];
    ema50?: LineData<Time>[];
    ema200?: LineData<Time>[];
  };
  vwapData?: LineData<Time>[];
  tradeLines?: {
    entry?: number;
    stopLoss?: number;
    takeProfit?: number;
  };
  height?: number;
  preferences?: ChartPreferences;
  hasIncompleteCandle?: boolean;
}

interface IndicatorLegendProps {
  ema21Value?: number;
  vwapValue?: number;
  ema21Color: string;
  vwapColor: string;
  symbol: string;
}

const IndicatorLegend: React.FC<IndicatorLegendProps> = ({ ema21Value, vwapValue, ema21Color, vwapColor, symbol }) => {
  const precision = symbol === 'XAUUSD' ? 2 : 5;

  if (!ema21Value && !vwapValue) return null;

  return (
    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10 flex gap-3 pointer-events-none">
      {ema21Value && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/80 backdrop-blur-sm border border-white/10">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: ema21Color }}
          />
          <span className="text-xs font-medium text-white/90">
            EMA 21
          </span>
          <span className="text-xs font-bold" style={{ color: ema21Color }}>
            {ema21Value.toFixed(precision)}
          </span>
        </div>
      )}
      {vwapValue && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/80 backdrop-blur-sm border border-white/10">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: vwapColor }}
          />
          <span className="text-xs font-medium text-white/90">
            VWAP
          </span>
          <span className="text-xs font-bold" style={{ color: vwapColor }}>
            {vwapValue.toFixed(precision)}
          </span>
        </div>
      )}
    </div>
  );
};

const CandlestickChartComponent: React.FC<CandlestickChartProps> = ({
  symbol,
  data,
  volumeData,
  aiAnalysis,
  emaData,
  vwapData,
  tradeLines,
  height = 400,
  preferences,
  hasIncompleteCandle = false
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema5SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema9SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema21SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema50SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema200SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const backgroundOverlayRef = useRef<HTMLDivElement | null>(null);
  const priceLinesRef = useRef<any[]>([]);
  const aiPriceLinesRef = useRef<any[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [ema21CurrentValue, setEma21CurrentValue] = useState<number | undefined>();
  const [vwapCurrentValue, setVwapCurrentValue] = useState<number | undefined>();
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
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const ema21Color = preferences?.ema_21_color || '#44c0ff';
    const ema200Color = preferences?.ema_200_color || '#aa44ff';
    const ema5Color = preferences?.ema_5_color || '#00ff95';
    const ema9Color = preferences?.ema_9_color || '#facc15';
    const ema50Color = preferences?.ema_50_color || '#ff6b6b';

    const ema21Series = chart.addSeries(LineSeries, {
      color: ema21Color,
      lineWidth: 2,
      lineStyle: 0,
      priceScaleId: 'right',
      title: 'EMA 21',
      visible: true,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const ema200Series = chart.addSeries(LineSeries, {
      color: ema200Color,
      lineWidth: 2,
      lineStyle: 0,
      priceScaleId: 'right',
      title: 'EMA 200',
      visible: true,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const ema5Series = chart.addSeries(LineSeries, {
      color: ema5Color,
      lineWidth: 2,
      lineStyle: 0,
      priceScaleId: 'right',
      title: 'EMA 5',
      visible: preferences?.show_all_emas ?? false,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const ema9Series = chart.addSeries(LineSeries, {
      color: ema9Color,
      lineWidth: 2,
      lineStyle: 0,
      priceScaleId: 'right',
      title: 'EMA 9',
      visible: preferences?.show_all_emas ?? false,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const ema50Series = chart.addSeries(LineSeries, {
      color: ema50Color,
      lineWidth: 2,
      lineStyle: 0,
      priceScaleId: 'right',
      title: 'EMA 50',
      visible: preferences?.show_all_emas ?? false,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = volumeSeries;
    vwapSeriesRef.current = vwapSeries;
    ema5SeriesRef.current = ema5Series;
    ema9SeriesRef.current = ema9Series;
    ema21SeriesRef.current = ema21Series;
    ema50SeriesRef.current = ema50Series;
    ema200SeriesRef.current = ema200Series;
    setIsReady(true);
    console.log('[CandlestickChart] Chart initialized with all series including EMAs');

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
      const sortedData = [...data].sort((a, b) => (a.time as number) - (b.time as number));
      candlestickSeriesRef.current.setData(sortedData);
      lastDataLengthRef.current = data.length;
      if (chartRef.current) {
        chartRef.current.timeScale().fitContent();
        isInitialLoadRef.current = false;
      }
      console.log(`Chart: Initial load with ${sortedData.length} candles`);
      return;
    }

    if (isStructureChange) {
      if (data.length > lastDataLengthRef.current) {
        const newCandles = data.slice(lastDataLengthRef.current);
        const lastExistingTime = lastDataLengthRef.current > 0 ? (data[lastDataLengthRef.current - 1].time as number) : 0;

        const validNewCandles = newCandles.filter(candle => (candle.time as number) > lastExistingTime);

        if (validNewCandles.length > 0) {
          validNewCandles.forEach(candle => {
            candlestickSeriesRef.current?.update(candle);
          });
          console.log(`Chart: Added ${validNewCandles.length} new candle(s)`);
        } else {
          console.log('Chart: Using setData due to timestamp conflict');
          const sortedData = [...data].sort((a, b) => (a.time as number) - (b.time as number));
          candlestickSeriesRef.current.setData(sortedData);
        }
      } else {
        const sortedData = [...data].sort((a, b) => (a.time as number) - (b.time as number));
        candlestickSeriesRef.current.setData(sortedData);
        console.log('Chart: Data shrunk, using setData');
      }
      lastDataLengthRef.current = data.length;
    } else if (data.length > 0) {
      const lastCandle = data[data.length - 1];
      if (!processingRef.current) {
        processingRef.current = true;
        requestAnimationFrame(() => {
          if (candlestickSeriesRef.current) {
            try {
              candlestickSeriesRef.current.update(lastCandle);
            } catch (err) {
              console.warn('Chart update failed, using setData:', err);
              const sortedData = [...data].sort((a, b) => (a.time as number) - (b.time as number));
              candlestickSeriesRef.current?.setData(sortedData);
            }
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
      const sortedVolume = [...volumeData].sort((a, b) => (a.time as number) - (b.time as number));
      volumeSeriesRef.current.setData(sortedVolume);
      lastVolumeLengthRef.current = volumeData.length;
      return;
    }

    if (isStructureChange) {
      if (volumeData.length > lastVolumeLengthRef.current) {
        const newVolumes = volumeData.slice(lastVolumeLengthRef.current);
        const lastExistingTime = lastVolumeLengthRef.current > 0 ? (volumeData[lastVolumeLengthRef.current - 1].time as number) : 0;

        const validNewVolumes = newVolumes.filter(volume => (volume.time as number) > lastExistingTime);

        if (validNewVolumes.length > 0) {
          validNewVolumes.forEach(volume => {
            volumeSeriesRef.current?.update(volume);
          });
        } else {
          const sortedVolume = [...volumeData].sort((a, b) => (a.time as number) - (b.time as number));
          volumeSeriesRef.current.setData(sortedVolume);
        }
      } else {
        const sortedVolume = [...volumeData].sort((a, b) => (a.time as number) - (b.time as number));
        volumeSeriesRef.current.setData(sortedVolume);
      }
      lastVolumeLengthRef.current = volumeData.length;
    } else if (volumeData.length > 0) {
      const lastVolume = volumeData[volumeData.length - 1];
      try {
        volumeSeriesRef.current.update(lastVolume);
      } catch (err) {
        const sortedVolume = [...volumeData].sort((a, b) => (a.time as number) - (b.time as number));
        volumeSeriesRef.current.setData(sortedVolume);
      }
    }
  }, [volumeData, isReady]);

  useEffect(() => {
    if (!isReady || !chartRef.current || !candlestickSeriesRef.current || !aiAnalysis) return;

    aiPriceLinesRef.current.forEach(line => {
      candlestickSeriesRef.current?.removePriceLine(line);
    });
    aiPriceLinesRef.current = [];

    if (vwapData && vwapData.length > 0 && vwapSeriesRef.current) {
      vwapSeriesRef.current.setData(vwapData);
      const latestVwap = vwapData[vwapData.length - 1];
      setVwapCurrentValue(latestVwap.value);
      console.log('[Chart] VWAP line data set:', vwapData.length, 'points');
    } else if (aiAnalysis?.vwap && vwapSeriesRef.current && data.length > 0) {
      const fallbackVwapData: LineData<Time>[] = data.map(candle => ({
        time: candle.time,
        value: aiAnalysis.vwap!
      }));
      vwapSeriesRef.current.setData(fallbackVwapData);
      setVwapCurrentValue(aiAnalysis.vwap);
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
    if (!isReady || !emaData) {
      console.log('[CandlestickChart] EMA update skipped:', { isReady, hasEmaData: !!emaData });
      return;
    }

    console.log('[CandlestickChart] Updating EMA series:', {
      ema5Length: emaData.ema5?.length || 0,
      ema9Length: emaData.ema9?.length || 0,
      ema21Length: emaData.ema21?.length || 0,
      ema50Length: emaData.ema50?.length || 0,
      ema200Length: emaData.ema200?.length || 0
    });

    try {
      if (emaData.ema5 && emaData.ema5.length > 0 && ema5SeriesRef.current) {
        const sortedEma5 = [...emaData.ema5].sort((a, b) => (a.time as number) - (b.time as number));
        ema5SeriesRef.current.setData(sortedEma5);
        console.log('[CandlestickChart] EMA5 updated with', sortedEma5.length, 'points');
      }
      if (emaData.ema9 && emaData.ema9.length > 0 && ema9SeriesRef.current) {
        const sortedEma9 = [...emaData.ema9].sort((a, b) => (a.time as number) - (b.time as number));
        ema9SeriesRef.current.setData(sortedEma9);
        console.log('[CandlestickChart] EMA9 updated with', sortedEma9.length, 'points');
      }
      if (emaData.ema21 && emaData.ema21.length > 0 && ema21SeriesRef.current) {
        const sortedEma21 = [...emaData.ema21].sort((a, b) => (a.time as number) - (b.time as number));
        ema21SeriesRef.current.setData(sortedEma21);
        const latestEma21 = sortedEma21[sortedEma21.length - 1];
        setEma21CurrentValue(latestEma21.value);
        console.log('[CandlestickChart] EMA21 updated with', sortedEma21.length, 'points');
      }
      if (emaData.ema50 && emaData.ema50.length > 0 && ema50SeriesRef.current) {
        const sortedEma50 = [...emaData.ema50].sort((a, b) => (a.time as number) - (b.time as number));
        ema50SeriesRef.current.setData(sortedEma50);
        console.log('[CandlestickChart] EMA50 updated with', sortedEma50.length, 'points');
      }
      if (emaData.ema200 && emaData.ema200.length > 0 && ema200SeriesRef.current) {
        const sortedEma200 = [...emaData.ema200].sort((a, b) => (a.time as number) - (b.time as number));
        ema200SeriesRef.current.setData(sortedEma200);
        console.log('[CandlestickChart] EMA200 updated with', sortedEma200.length, 'points');
      }
    } catch (err) {
      console.error('[CandlestickChart] Error updating EMA series:', err);
    }
  }, [emaData, isReady]);

  useEffect(() => {
    if (!isReady) return;

    const showAll = preferences?.show_all_emas ?? false;

    ema5SeriesRef.current?.applyOptions({ visible: showAll });
    ema9SeriesRef.current?.applyOptions({ visible: showAll });
    ema50SeriesRef.current?.applyOptions({ visible: showAll });
  }, [preferences?.show_all_emas, isReady]);

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

  const ema21Color = preferences?.ema_21_color || '#44c0ff';
  const vwapColor = '#fbbf24';

  return (
    <div
      className="w-full rounded-2xl overflow-hidden border border-white/10 touch-manipulation relative"
      style={{ height: `${height}px`, touchAction: 'pan-x pan-y', zIndex: 0 }}
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
        <IndicatorLegend
          ema21Value={ema21CurrentValue}
          vwapValue={vwapCurrentValue}
          ema21Color={ema21Color}
          vwapColor={vwapColor}
          symbol={symbol}
        />
      </div>
    </div>
  );
};

export const CandlestickChart = memo(CandlestickChartComponent, (prevProps, nextProps) => {
  return (
    prevProps.symbol === nextProps.symbol &&
    prevProps.data.length === nextProps.data.length &&
    prevProps.data[prevProps.data.length - 1]?.time === nextProps.data[nextProps.data.length - 1]?.time &&
    prevProps.data[prevProps.data.length - 1]?.close === nextProps.data[nextProps.data.length - 1]?.close &&
    prevProps.volumeData?.length === nextProps.volumeData?.length &&
    prevProps.emaData?.ema5?.length === nextProps.emaData?.ema5?.length &&
    prevProps.emaData?.ema21?.length === nextProps.emaData?.ema21?.length &&
    prevProps.emaData?.ema200?.length === nextProps.emaData?.ema200?.length &&
    prevProps.height === nextProps.height &&
    prevProps.preferences?.theme === nextProps.preferences?.theme &&
    prevProps.preferences?.show_grid === nextProps.preferences?.show_grid &&
    prevProps.tradeLines?.entry === nextProps.tradeLines?.entry &&
    prevProps.tradeLines?.stopLoss === nextProps.tradeLines?.stopLoss &&
    prevProps.tradeLines?.takeProfit === nextProps.tradeLines?.takeProfit
  );
});
