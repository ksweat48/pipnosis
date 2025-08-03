import { useState, useEffect, useCallback } from 'react';
import { pipnosisAPI } from '../services/api';

export interface MarketDataPoint {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  trend: string;
  signal: string;
}

export interface ChartData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export const useMarketData = (refreshInterval: number = 5000) => {
  const [marketData, setMarketData] = useState<MarketDataPoint[]>([]);
  const [chartData, setChartData] = useState<ChartData[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchMarketData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      console.log('🔄 Fetching market data...');
      try {
        const data = await pipnosisAPI.getMarketData();
        setMarketData(data);
        console.log('✅ Market data fetched successfully');
        setLastUpdated(new Date());
      } catch (error) {
        console.warn('❌ Failed to fetch market data:', error);
        // Generate fallback data
        const generatedData = generateFallbackData();
        setMarketData(generatedData);
        console.log('⚠️ Using generated fallback market data');
        setLastUpdated(new Date());
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch chart data for a specific symbol
  const fetchChartData = useCallback(async (symbol: string): Promise<ChartData[]> => {
    try {
      // In a real implementation, this would fetch OHLCV data from your backend
      // For now, we'll generate mock data
      const chartData = generateMockChartData(symbol);
      setChartData(chartData);
      return chartData;
    } catch (error) {
      console.error('Failed to fetch chart data:', error);
      return [];
    }
  }, []);

  // Generate fallback market data
  const generateFallbackData = (): MarketDataPoint[] => {
    console.log('📊 Generating fallback market data');
    const pairs = [
      { symbol: 'EURUSD', basePrice: 1.1425 },
      { symbol: 'GBPUSD', basePrice: 1.2735 },
      { symbol: 'USDJPY', basePrice: 149.85 },
      { symbol: 'USDCHF', basePrice: 0.8945 },
      { symbol: 'AUDUSD', basePrice: 0.6785 },
      { symbol: 'USDCAD', basePrice: 1.3625 },
      { symbol: 'NZDUSD', basePrice: 0.6245 }
    ];

    return pairs.map(({ symbol, basePrice }) => {
      const isJPY = symbol.includes('JPY');
      const priceVariation = isJPY 
        ? (Math.random() - 0.5) * 2.0 
        : (Math.random() - 0.5) * 0.02;
      const changeVariation = isJPY 
        ? (Math.random() - 0.5) * 1.0 
        : (Math.random() - 0.5) * 0.01;

      return {
        symbol,
        price: basePrice + priceVariation,
        change: changeVariation,
        changePercent: (changeVariation / basePrice) * 100,
        trend: Math.random() > 0.5 ? 'up' : 'down',
        signal: ['buy', 'sell', 'hold'][Math.floor(Math.random() * 3)]
      };
    });
  };

  // Generate mock chart data
  const generateMockChartData = (symbol: string): ChartData[] => {
    const data: ChartData[] = [];
    const now = new Date();
    const isJPY = symbol.includes('JPY');
    const isGold = symbol === 'XAUUSD';
    
    let basePrice = isGold ? 2045 : isJPY ? 149.85 : 1.1425;
    
    // Generate 100 candles
    for (let i = 99; i >= 0; i--) {
      const time = new Date(now.getTime() - i * 15 * 60 * 1000);
      const volatility = isGold ? 5 : isJPY ? 0.5 : 0.002;
      const change = (Math.random() - 0.5) * volatility;
      
      const open = basePrice;
      const close = basePrice + change;
      const high = Math.max(open, close) + Math.random() * volatility * 0.3;
      const low = Math.min(open, close) - Math.random() * volatility * 0.3;
      
      data.push({
        time: time.toISOString(),
        open: parseFloat(open.toFixed(isJPY ? 2 : isGold ? 2 : 5)),
        high: parseFloat(high.toFixed(isJPY ? 2 : isGold ? 2 : 5)),
        low: parseFloat(low.toFixed(isJPY ? 2 : isGold ? 2 : 5)),
        close: parseFloat(close.toFixed(isJPY ? 2 : isGold ? 2 : 5)),
        volume: Math.floor(Math.random() * 1000) + 100
      });
      
      basePrice = close;
    }
    
    return data;
  };

  useEffect(() => {
    fetchMarketData();
    const interval = setInterval(fetchMarketData, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchMarketData, refreshInterval]);

  return {
    marketData,
    chartData,
    isLoading,
    error,
    lastUpdated,
    refetch: fetchMarketData,
    fetchChartData
  };
};