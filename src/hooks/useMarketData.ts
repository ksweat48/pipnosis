import { useState, useEffect, useCallback } from 'react';
import { pipnosisAPI } from '../services/api';
import { backendAPI } from '../services/backendAPI';
import { useAuth } from '../contexts/AuthContext';

export interface MarketDataPoint {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  trend: string;
  signal: string;
}

export const useMarketData = (refreshInterval: number = 5000) => {
  const [marketData, setMarketData] = useState<MarketDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const { user } = useAuth();

  const fetchMarketData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      console.log('🔄 Fetching market data...');
      
      try {
        // First try the backend API
        const data = await backendAPI.getMarketAnalysis();
        
        if (data && data.symbols) {
          const formattedData: MarketDataPoint[] = data.symbols.map(symbol => ({
            symbol: symbol.symbol,
            price: symbol.bid && symbol.ask ? (symbol.bid + symbol.ask) / 2 : 1.1425,
            change: symbol.change,
            changePercent: symbol.changePercent,
            trend: symbol.trend === 'bullish' ? 'up' : symbol.trend === 'bearish' ? 'down' : 'sideways',
            signal: symbol.signals.includes('Buy Signal') ? 'buy' : 
                   symbol.signals.includes('Sell Signal') ? 'sell' : 'hold'
          }));
          
          setMarketData(formattedData);
          setLastUpdated(new Date());
          setIsLoading(false);
          console.log('✅ Market data fetched successfully from backend API');
          return;
        }
      } catch (backendError) {
        console.warn('Backend API failed, trying pipnosisAPI:', backendError);
      }
      
      // Fallback to pipnosisAPI
      try {
        const fallbackData = await pipnosisAPI.getMarketData();
        setMarketData(fallbackData);
        console.log('✅ Market data fetched successfully from pipnosisAPI');
        setLastUpdated(new Date());
      } catch (fallbackError) {
        console.error('Both APIs failed:', fallbackError);
        setError('Failed to fetch market data from both APIs');
        
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

  useEffect(() => {
    fetchMarketData();
    const interval = setInterval(fetchMarketData, user ? 10000 : refreshInterval);
    return () => clearInterval(interval);
  }, [fetchMarketData, refreshInterval, user]);

  return {
    marketData,
    isLoading,
    error,
    lastUpdated,
    refetch: fetchMarketData
  };
};