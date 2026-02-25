/**
 * LIVE TRADES TICKER
 *
 * SSOT: Reads open trades from goal_session_trades (read-only, no mutations).
 *       Reads live bid/ask from realtime_prices (read-only, no mutations).
 * CCIP: No business logic — purely a display/social proof component.
 * Governance:
 *   P&L UPDATE STRATEGY (two-layer, defence-in-depth):
 *
 *   Layer 1 — Client-side realtime price subscription (primary, sub-second):
 *     Subscribes to INSERT/UPDATE on realtime_prices via Supabase Realtime.
 *     When a new price arrives for a symbol that has an open trade in the
 *     ticker, P&L is recalculated locally using the same pip formula as
 *     currencyHelpers.ts. This gives live, smooth movement for all viewers
 *     regardless of whether the trade owner has their browser open.
 *
 *   Layer 2 — goal_session_trades UPDATE subscription + polling fallback:
 *     The server-side pg_cron job (update-open-trade-pnl, every minute)
 *     writes current_pnl to the DB and triggers a Realtime UPDATE event.
 *     The ticker also polls every 30 seconds as a final safety net.
 *
 *   INSERT on goal_session_trades → full re-fetch (new trade needs email lookup)
 *   UPDATE on goal_session_trades → apply only if Layer 1 price not available
 *   realtime_prices INSERT/UPDATE → recalculate P&L locally, no DB round-trip
 *
 * Anonymises all user emails before display.
 * Hides entirely when zero open trades exist — no empty UI.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getCurrencyPipInfo } from '../utils/currencyHelpers';

interface LiveTrade {
  id: string;
  symbol: string;
  direction: string;
  entry_price: number;
  lot_size: number;
  current_pnl: number | null;
  email: string;
}

interface LivePrice {
  symbol: string;
  bid: number;
  ask: number;
}

function abbreviateEmail(email: string): string {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  const prefix = local.length >= 2 ? local.slice(0, 2) : local;
  const domainInitial = domain.length > 0 ? domain[0] : '?';
  return `${prefix}***@${domainInitial}`;
}

/**
 * SSOT P&L calculation — mirrors getPipInfo() + calculatePnL() in
 * update-open-trade-pnl/index.ts and getCurrencyPipInfo() in currencyHelpers.ts.
 *
 * Formula: priceDiff / pipValue * (lotSize * dollarPerPipPerLot)
 *
 * GOVERNANCE: Any change to this formula must be replicated in:
 *   - supabase/functions/update-open-trade-pnl/index.ts
 *   - src/utils/currencyHelpers.ts (getCurrencyPipInfo)
 *   - src/types/position.ts (calculatePnL)
 */
function computeLivePnL(
  direction: string,
  entryPrice: number,
  bid: number,
  ask: number,
  lotSize: number,
  symbol: string
): number {
  const currentPrice = direction === 'buy' ? bid : ask;
  const { pipValue, dollarPerPipPerLot } = getCurrencyPipInfo(symbol);
  const priceDiff = direction === 'buy'
    ? currentPrice - entryPrice
    : entryPrice - currentPrice;
  const pips = priceDiff / pipValue;
  const pnl = pips * (lotSize * dollarPerPipPerLot);
  return Math.round(pnl * 100) / 100;
}

const POLL_INTERVAL_MS = 30_000;

export const LiveTradesTicker: React.FC = () => {
  const [trades, setTrades] = useState<LiveTrade[]>([]);

  const channelTradesRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const channelPricesRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tradesRef = useRef<LiveTrade[]>([]);
  tradesRef.current = trades;

  const livePricesRef = useRef<Map<string, LivePrice>>(new Map());

  const fetchOpenTrades = useCallback(async () => {
    const { data: tradesData, error: tradesError } = await supabase
      .from('goal_session_trades')
      .select('id, symbol, direction, entry_price, lot_size, current_pnl, user_id')
      .eq('status', 'open')
      .order('opened_at', { ascending: false })
      .limit(50);

    if (tradesError || !tradesData || tradesData.length === 0) {
      setTrades([]);
      return;
    }

    const userIds = [...new Set(tradesData.map((t) => t.user_id as string).filter(Boolean))];

    const emailMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profilesData } = await supabase
        .from('user_profiles')
        .select('id, email')
        .in('id', userIds);

      (profilesData || []).forEach((p: { id: string; email?: string }) => {
        emailMap[p.id] = abbreviateEmail(p.email ?? '');
      });
    }

    const mapped: LiveTrade[] = tradesData.map((row) => {
      const tradeSymbol = row.symbol as string;
      const direction = row.direction as string;
      const entryPrice = row.entry_price as number;
      const lotSize = row.lot_size as number;

      const livePrice = livePricesRef.current.get(tradeSymbol);
      const pnl = livePrice && entryPrice && lotSize
        ? computeLivePnL(direction, entryPrice, livePrice.bid, livePrice.ask, lotSize, tradeSymbol)
        : (row.current_pnl as number | null);

      return {
        id: row.id as string,
        symbol: tradeSymbol,
        direction,
        entry_price: entryPrice,
        lot_size: lotSize,
        current_pnl: pnl,
        email: emailMap[row.user_id as string] ?? '***',
      };
    });

    setTrades(mapped);
  }, []);

  const applyLivePriceToTrades = useCallback((priceRow: LivePrice) => {
    livePricesRef.current.set(priceRow.symbol, priceRow);

    setTrades((prev) => {
      let changed = false;
      const next = prev.map((trade) => {
        if (trade.symbol !== priceRow.symbol) return trade;
        if (!trade.entry_price || !trade.lot_size || trade.lot_size <= 0) return trade;

        const newPnl = computeLivePnL(
          trade.direction,
          trade.entry_price,
          priceRow.bid,
          priceRow.ask,
          trade.lot_size,
          trade.symbol
        );

        if (trade.current_pnl === newPnl) return trade;
        changed = true;
        return { ...trade, current_pnl: newPnl };
      });
      return changed ? next : prev;
    });
  }, []);

  const handleTradeUpdate = useCallback((payload: { new: Record<string, unknown> }) => {
    const updated = payload.new;
    if (!updated || typeof updated.id !== 'string') return;

    if (updated.status !== 'open') {
      setTrades((prev) => prev.filter((t) => t.id !== updated.id));
      return;
    }

    setTrades((prev) => {
      const idx = prev.findIndex((t) => t.id === updated.id);
      if (idx === -1) {
        fetchOpenTrades();
        return prev;
      }

      const existing = prev[idx];
      const livePrice = livePricesRef.current.get(existing.symbol);

      if (livePrice && existing.entry_price && existing.lot_size > 0) {
        return prev;
      }

      const dbPnl = typeof updated.current_pnl === 'number' ? updated.current_pnl : null;
      const next = [...prev];
      next[idx] = { ...existing, current_pnl: dbPnl };
      return next;
    });
  }, [fetchOpenTrades]);

  useEffect(() => {
    fetchOpenTrades();

    channelTradesRef.current = supabase
      .channel('live-trades-ticker-trades')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'goal_session_trades' },
        () => { fetchOpenTrades(); }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'goal_session_trades' },
        handleTradeUpdate
      )
      .subscribe();

    channelPricesRef.current = supabase
      .channel('live-trades-ticker-prices')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'realtime_prices' },
        (payload: { new: Record<string, unknown> }) => {
          const row = payload.new;
          if (
            typeof row.symbol === 'string' &&
            typeof row.bid === 'number' &&
            typeof row.ask === 'number'
          ) {
            applyLivePriceToTrades({ symbol: row.symbol, bid: row.bid, ask: row.ask });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'realtime_prices' },
        (payload: { new: Record<string, unknown> }) => {
          const row = payload.new;
          if (
            typeof row.symbol === 'string' &&
            typeof row.bid === 'number' &&
            typeof row.ask === 'number'
          ) {
            applyLivePriceToTrades({ symbol: row.symbol, bid: row.bid, ask: row.ask });
          }
        }
      )
      .subscribe();

    pollTimerRef.current = setInterval(fetchOpenTrades, POLL_INTERVAL_MS);

    return () => {
      if (channelTradesRef.current) {
        supabase.removeChannel(channelTradesRef.current);
        channelTradesRef.current = null;
      }
      if (channelPricesRef.current) {
        supabase.removeChannel(channelPricesRef.current);
        channelPricesRef.current = null;
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [fetchOpenTrades, handleTradeUpdate, applyLivePriceToTrades]);

  if (trades.length === 0) return null;

  const displayList = trades.length < 4 ? [...trades, ...trades, ...trades] : [...trades, ...trades];

  return (
    <div className="w-full overflow-hidden bg-gray-900/80 border border-gray-700/60 rounded-xl mb-6 backdrop-blur-sm">
      <div className="flex items-stretch">
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 bg-emerald-600/20 border-r border-emerald-500/30">
          <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase whitespace-nowrap">
            Live Trades
          </span>
        </div>

        <div className="flex-1 overflow-hidden py-2">
          <div
            className="flex items-center gap-6 ticker-scroll"
            style={{
              display: 'flex',
              whiteSpace: 'nowrap',
              animation: `ticker-scroll ${Math.max(18, displayList.length * 4)}s linear infinite`,
              willChange: 'transform',
            }}
          >
            {displayList.map((trade, i) => {
              const pnl = trade.current_pnl ?? 0;
              const isPositive = pnl >= 0;

              return (
                <div
                  key={`${trade.id}-${i}`}
                  className="inline-flex items-center gap-2.5 px-4 py-1 bg-gray-800/60 rounded-lg border border-gray-700/40 flex-shrink-0"
                >
                  <span className="text-[11px] text-gray-400 font-mono">{trade.email}</span>

                  <span className="text-[11px] font-bold text-white tracking-wide">{trade.symbol}</span>

                  <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    trade.direction?.toLowerCase() === 'buy'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-red-500/15 text-red-400'
                  }`}>
                    {trade.direction?.toLowerCase() === 'buy'
                      ? <TrendingUp className="w-2.5 h-2.5" />
                      : <TrendingDown className="w-2.5 h-2.5" />
                    }
                    {trade.direction?.toUpperCase()}
                  </span>

                  <span className={`text-[11px] font-bold tabular-nums ${
                    isPositive ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {isPositive ? '+' : ''}{pnl.toFixed(2)}
                  </span>

                  <span className="text-gray-600 text-[10px] select-none">|</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
};
