import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export interface RealtimePrice {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  time: string;
  source: string;
}

export interface RealtimePriceState {
  price: RealtimePrice | null;
  isConnected: boolean;
  lastUpdate: Date | null;
  error: string | null;
}

export function useRealtimePrice(symbol: string): RealtimePriceState {
  const [state, setState] = useState<RealtimePriceState>({
    price: null,
    isConnected: false,
    lastUpdate: null,
    error: null,
  });

  const channelRef = useRef<RealtimeChannel | null>(null);
  const isMountedRef = useRef(true);

  const updatePrice = useCallback((newPrice: RealtimePrice) => {
    if (!isMountedRef.current) return;

    setState(prev => ({
      ...prev,
      price: newPrice,
      lastUpdate: new Date(),
      isConnected: true,
      error: null,
    }));
  }, []);

  const fetchLatestPrice = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('realtime_prices')
        .select('*')
        .eq('symbol', symbol.toUpperCase())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (data && isMountedRef.current) {
        updatePrice({
          symbol: data.symbol,
          bid: parseFloat(data.bid),
          ask: parseFloat(data.ask),
          mid: parseFloat(data.mid),
          spread: parseFloat(data.spread),
          time: data.broker_time,
          source: data.source || 'supabase-cache',
        });
      }
    } catch (err) {
      console.error('[useRealtimePrice] Failed to fetch latest price:', err);
      if (isMountedRef.current) {
        setState(prev => ({
          ...prev,
          error: err instanceof Error ? err.message : 'Failed to fetch price',
        }));
      }
    }
  }, [symbol, updatePrice]);

  useEffect(() => {
    isMountedRef.current = true;
    const upperSymbol = symbol.toUpperCase();

    console.log(`[useRealtimePrice] Subscribing to ${upperSymbol}`);

    fetchLatestPrice();

    const channel = supabase
      .channel(`realtime-price-${upperSymbol}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'realtime_prices',
          filter: `symbol=eq.${upperSymbol}`,
        },
        (payload) => {
          const data = payload.new;
          updatePrice({
            symbol: data.symbol,
            bid: parseFloat(data.bid),
            ask: parseFloat(data.ask),
            mid: parseFloat(data.mid),
            spread: parseFloat(data.spread),
            time: data.broker_time,
            source: data.source || 'realtime',
          });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[useRealtimePrice] Subscribed to ${upperSymbol}`);
          if (isMountedRef.current) {
            setState(prev => ({ ...prev, isConnected: true }));
          }
        } else if (status === 'CHANNEL_ERROR') {
          console.error(`[useRealtimePrice] Subscription error for ${upperSymbol}`);
          if (isMountedRef.current) {
            setState(prev => ({
              ...prev,
              isConnected: false,
              error: 'Realtime subscription failed',
            }));
          }
        } else if (status === 'CLOSED') {
          console.log(`[useRealtimePrice] Channel closed for ${upperSymbol}`);
          if (isMountedRef.current) {
            setState(prev => ({ ...prev, isConnected: false }));
          }
        }
      });

    channelRef.current = channel;

    return () => {
      isMountedRef.current = false;
      console.log(`[useRealtimePrice] Unsubscribing from ${upperSymbol}`);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [symbol, fetchLatestPrice, updatePrice]);

  return state;
}
