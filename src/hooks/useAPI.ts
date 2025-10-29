import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface MarketData {
  symbol: string;
  bid: number;
  ask: number;
  timestamp: string;
}

export function usePromptAnalysis() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzePrompt = useCallback(async (prompt: string) => {
    setIsAnalyzing(true);
    setError(null);

    try {
      const response = await fetch('/.netlify/functions/analyze-market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });

      if (!response.ok) {
        throw new Error('Analysis failed');
      }

      const data = await response.json();
      return data;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Analysis failed';
      setError(errorMsg);
      throw err;
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  return { analyzePrompt, isAnalyzing, error };
}

export function useMarketData(symbol: string = 'EURUSD') {
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: dbError } = await supabase
        .from('realtime_prices')
        .select('*')
        .eq('symbol', symbol)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (dbError) throw dbError;

      if (data) {
        setMarketData({
          symbol: data.symbol,
          bid: data.bid,
          ask: data.ask,
          timestamp: data.timestamp
        });
        setLastUpdated(new Date(data.timestamp));
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch market data';
      setError(errorMsg);
      console.error('Market data fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    refetch();

    const interval = setInterval(refetch, 5000);

    return () => clearInterval(interval);
  }, [refetch]);

  return { marketData, isLoading, error, lastUpdated, refetch };
}
