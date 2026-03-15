/**
 * LIVE TRADES TICKER
 *
 * SSOT: Reads all open trades via get_all_open_trades_for_ticker() RPC (read-only).
 *       RPC is the sole authority for cross-user ticker data — existing RLS on
 *       goal_session_trades is unchanged and unweakened.
 *       Reads live bid/ask from realtime_prices (read-only, no mutations).
 *
 * CCIP: No business logic — purely a display/social proof component.
 *       All users (not just admins) see the full platform-wide ticker.
 *       Displayed on AITradePage only (not globally mounted).
 *
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
 *   INSERT on goal_session_trades → full re-fetch via RPC
 *   UPDATE on goal_session_trades → apply only if Layer 1 price not available
 *   realtime_prices INSERT/UPDATE → recalculate P&L locally, no DB round-trip
 *
 * Emails are anonymised server-side inside the RPC — raw emails never leave DB.
 * Hides entirely when zero open trades exist — no empty UI.
 *
 * SCROLL ANIMATION — RESPONSIVE SPEED GOVERNANCE:
 *   Duration is computed from actual rendered pixel width of the scroll track,
 *   not from trade count. This guarantees all trades are visible on every
 *   viewport width (mobile, tablet, desktop).
 *
 *   Formula: duration = scrollTrackWidth / TICKER_PIXELS_PER_SECOND
 *   TICKER_PIXELS_PER_SECOND is the single source of scroll speed — any change
 *   to scroll feel must be made here and only here.
 *
 *   A ResizeObserver on the scroll track recalculates duration when the
 *   container resizes (orientation change, split-screen, etc). A unique
 *   animation key forces the browser to restart the animation cleanly after
 *   each duration change, preventing mid-scroll jumps.
 *
 *   translateX(-50%) loop: the rendered list is 2× unique trades so the
 *   half-way point is identical to the start — seamless infinite loop.
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

/**
 * SSOT scroll speed constant.
 * Governs how fast the ticker travels across any viewport width.
 * Unit: CSS pixels per second. Changing this value is the ONLY
 * permitted way to adjust perceived scroll speed — do not introduce
 * a second speed constant or per-breakpoint overrides.
 */
const TICKER_PIXELS_PER_SECOND = 80;

/** Minimum animation duration guard — prevents imperceptibly fast loops on tiny trade lists. */
const TICKER_MIN_DURATION_S = 8;

/**
 * Build the display list for the scroll animation.
 *
 * The CSS animation translates -50% to loop seamlessly, so the rendered list
 * must be exactly 2× the unique trade count. This means:
 *   - 1 unique trade  → renders [trade, trade]   (scrolls as 1 trade per loop)
 *   - 10 unique trades → renders [t1..t10, t1..t10] (scrolls as 10 per loop)
 *
 * Users see each unique trade exactly once per scroll cycle — no phantom repeats.
 */
function buildDisplayList(trades: LiveTrade[]): LiveTrade[] {
  if (trades.length === 0) return [];
  return [...trades, ...trades];
}

export const LiveTradesTicker: React.FC = () => {
  const [trades, setTrades] = useState<LiveTrade[]>([]);

  /**
   * SCROLL ANIMATION STATE — SSOT for duration.
   * Derived exclusively from the measured scrollTrackRef width.
   * Never set this directly — only the ResizeObserver callback
   * (recalcuateAnimationDuration) is permitted to update it.
   */
  const [animationDuration, setAnimationDuration] = useState<number>(TICKER_MIN_DURATION_S);
  /**
   * animationKey increments whenever duration changes so React replaces
   * the animated element, forcing the browser to restart the animation
   * from position 0. Without this, a mid-scroll duration change causes
   * an abrupt jump.
   */
  const [animationKey, setAnimationKey] = useState<number>(0);

  /** Ref to the inner scroll track div whose scrollWidth drives duration. */
  const scrollTrackRef = useRef<HTMLDivElement>(null);

  const channelTradesRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const channelPricesRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tradesRef = useRef<LiveTrade[]>([]);
  tradesRef.current = trades;

  const livePricesRef = useRef<Map<string, LivePrice>>(new Map());

  /**
   * Primary data fetch — calls the SECURITY DEFINER RPC which bypasses RLS
   * to return all open trades platform-wide with server-side anonymised emails.
   * SSOT: this is the only place ticker trade data is fetched.
   */
  const fetchOpenTrades = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_all_open_trades_for_ticker');

    if (error || !data || data.length === 0) {
      setTrades([]);
      return;
    }

    const mapped: LiveTrade[] = (data as Array<{
      id: string;
      symbol: string;
      direction: string;
      entry_price: number;
      lot_size: number;
      current_pnl: number | null;
      anon_email: string;
    }>).map((row) => {
      const livePrice = livePricesRef.current.get(row.symbol);
      const pnl = livePrice && row.entry_price && row.lot_size
        ? computeLivePnL(row.direction, row.entry_price, livePrice.bid, livePrice.ask, row.lot_size, row.symbol)
        : row.current_pnl;

      return {
        id: row.id,
        symbol: row.symbol,
        direction: row.direction,
        entry_price: row.entry_price,
        lot_size: row.lot_size,
        current_pnl: pnl,
        email: row.anon_email ?? '***',
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

  /**
   * RESPONSIVE ANIMATION DURATION — SSOT width measurement.
   *
   * Observes the scroll track's rendered scrollWidth and derives the
   * animation duration from TICKER_PIXELS_PER_SECOND. This is the only
   * place animation duration is computed — the static formula
   * `trades.length * 4` has been removed because it produces a duration
   * independent of container width, causing the ticker to appear frozen
   * on narrow viewports (mobile) where the same pixel distance takes far
   * longer relative to what is visible.
   *
   * The ResizeObserver fires on:
   *   - Initial mount (after the DOM paints the full trade list)
   *   - Trade list changes (trade count changes → content width changes)
   *   - Viewport resize / orientation change
   *
   * CCIP: This effect is read-only with respect to all data. It only
   * touches React display state (animationDuration, animationKey).
   */
  useEffect(() => {
    const node = scrollTrackRef.current;
    if (!node) return;

    const recalculateAnimationDuration = () => {
      const trackWidth = node.scrollWidth;
      if (trackWidth <= 0) return;
      const rawDuration = trackWidth / 2 / TICKER_PIXELS_PER_SECOND;
      const newDuration = Math.max(TICKER_MIN_DURATION_S, rawDuration);
      setAnimationDuration((prev) => {
        if (Math.abs(prev - newDuration) < 0.5) return prev;
        setAnimationKey((k) => k + 1);
        return newDuration;
      });
    };

    recalculateAnimationDuration();

    const observer = new ResizeObserver(recalculateAnimationDuration);
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [trades]);

  if (trades.length === 0) return null;

  const displayList = buildDisplayList(trades);

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
            key={animationKey}
            ref={scrollTrackRef}
            className="flex items-center gap-6"
            style={{
              display: 'flex',
              whiteSpace: 'nowrap',
              animation: `ticker-scroll ${animationDuration}s linear infinite`,
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
