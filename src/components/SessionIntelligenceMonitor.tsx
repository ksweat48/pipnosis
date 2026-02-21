import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Clock,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Sun,
  Moon,
  Sunrise,
  Zap,
  Timer,
  Activity,
  MapPin,
  Target,
  ChevronRight,
  Bitcoin,
} from 'lucide-react';
import { calculateSessionContext, getForexMarketStatus, isSymbolMarketOpen } from '@/utils/marketHours';
import { alphaPreviewScanner, type AlphaPreviewCard, type AlphaPreviewScanResult } from '@/services/alpha-preview-scanner';

type TradeStyle = 'scalper' | 'micro' | 'intraday';
type TimeQuality = 'prime' | 'good' | 'slow';

interface SessionTimeQualityInfo {
  quality: TimeQuality;
  label: string;
  description: string;
  windowEndUtcMinutes: number;
  sessionLabel: string;
  sessionIcon: 'sun' | 'sunrise' | 'moon' | 'clock';
  sessionStartUtc: number;
  sessionEndUtc: number;
  currentUtcMinutes: number;
}

interface TimelineZone {
  startUtc: number;
  endUtc: number;
  quality: TimeQuality;
  label: string;
}

const STYLE_CONFIG: Record<TradeStyle, {
  label: string;
  border: string;
  bg: string;
  badgeBg: string;
  badgeText: string;
  icon: React.ReactNode;
  glow: string;
  holdTime: string;
}> = {
  scalper: {
    label: 'Scalp',
    border: 'border-amber-500/40',
    bg: 'bg-gradient-to-br from-amber-950/30 to-amber-900/10',
    badgeBg: 'bg-amber-500/20 border-amber-500/50',
    badgeText: 'text-amber-400',
    icon: <Zap className="w-3.5 h-3.5" />,
    glow: 'from-amber-500 to-yellow-500',
    holdTime: '5-30 min',
  },
  micro: {
    label: 'Micro',
    border: 'border-cyan-500/40',
    bg: 'bg-gradient-to-br from-cyan-950/30 to-cyan-900/10',
    badgeBg: 'bg-cyan-500/20 border-cyan-500/50',
    badgeText: 'text-cyan-400',
    icon: <Timer className="w-3.5 h-3.5" />,
    glow: 'from-cyan-500 to-teal-500',
    holdTime: '30 min - 2 hr',
  },
  intraday: {
    label: 'Intraday',
    border: 'border-emerald-500/40',
    bg: 'bg-gradient-to-br from-emerald-950/30 to-emerald-900/10',
    badgeBg: 'bg-emerald-500/20 border-emerald-500/50',
    badgeText: 'text-emerald-400',
    icon: <Activity className="w-3.5 h-3.5" />,
    glow: 'from-emerald-500 to-green-500',
    holdTime: '2-10 hr',
  },
};

/**
 * SSOT: Session time quality windows defined in UTC hours.
 * Authority: SessionIntelligenceMonitor is the sole owner of UI-layer session quality display.
 */
const TIMELINE_ZONES: TimelineZone[] = [
  { startUtc: 0,  endUtc: 3,  quality: 'slow',  label: 'Asian / Dead Zone' },
  { startUtc: 3,  endUtc: 8,  quality: 'good',  label: 'Asian' },
  { startUtc: 8,  endUtc: 10, quality: 'good',  label: 'London Open' },
  { startUtc: 10, endUtc: 13, quality: 'prime', label: 'London Prime' },
  { startUtc: 13, endUtc: 17, quality: 'prime', label: 'London/NY Overlap' },
  { startUtc: 17, endUtc: 19, quality: 'good',  label: 'NY Afternoon' },
  { startUtc: 19, endUtc: 22, quality: 'slow',  label: 'NY Late / Pre-Asia' },
  { startUtc: 22, endUtc: 24, quality: 'slow',  label: 'Sydney / Dead Zone' },
];

function getQualityColors(quality: TimeQuality): {
  dot: string;
  border: string;
  bg: string;
  text: string;
  badge: string;
  badgeText: string;
  timelineBar: string;
} {
  switch (quality) {
    case 'prime':
      return {
        dot: 'bg-green-400',
        border: 'border-green-500/50',
        bg: 'bg-green-500/10',
        text: 'text-green-400',
        badge: 'bg-green-500/20 border-green-500/40',
        badgeText: 'text-green-300',
        timelineBar: 'bg-green-500/70',
      };
    case 'good':
      return {
        dot: 'bg-yellow-400',
        border: 'border-yellow-500/50',
        bg: 'bg-yellow-500/10',
        text: 'text-yellow-400',
        badge: 'bg-yellow-500/20 border-yellow-500/40',
        badgeText: 'text-yellow-300',
        timelineBar: 'bg-yellow-500/70',
      };
    case 'slow':
      return {
        dot: 'bg-red-400',
        border: 'border-red-500/40',
        bg: 'bg-red-500/8',
        text: 'text-red-400',
        badge: 'bg-red-500/20 border-red-500/40',
        badgeText: 'text-red-300',
        timelineBar: 'bg-red-500/50',
      };
  }
}

function computeSessionTimeQuality(): SessionTimeQualityInfo {
  const now = new Date();
  const utcHours = now.getUTCHours();
  const utcMinutes = now.getUTCMinutes();
  const currentUtcMinutes = utcHours * 60 + utcMinutes;

  const zone = TIMELINE_ZONES.find(
    (z) => utcHours >= z.startUtc && utcHours < z.endUtc
  ) ?? TIMELINE_ZONES[0];

  const windowEndUtcMinutes = zone.endUtc * 60;

  let sessionLabel: string;
  let sessionIcon: SessionTimeQualityInfo['sessionIcon'];
  let sessionStartUtc: number;
  let sessionEndUtc: number;

  if (utcHours >= 8 && utcHours < 17) {
    sessionLabel = 'London Session';
    sessionIcon = 'sun';
    sessionStartUtc = 8;
    sessionEndUtc = 17;
  } else if (utcHours >= 13 && utcHours < 22) {
    sessionLabel = 'New York Session';
    sessionIcon = 'sunrise';
    sessionStartUtc = 13;
    sessionEndUtc = 22;
  } else if (utcHours >= 0 && utcHours < 8) {
    sessionLabel = 'Asian Session';
    sessionIcon = 'moon';
    sessionStartUtc = 0;
    sessionEndUtc = 8;
  } else {
    sessionLabel = 'Sydney / Pre-Asia';
    sessionIcon = 'clock';
    sessionStartUtc = 22;
    sessionEndUtc = 24;
  }

  if (utcHours >= 13 && utcHours < 17) {
    sessionLabel = 'London / NY Overlap';
    sessionIcon = 'sunrise';
    sessionStartUtc = 13;
    sessionEndUtc = 17;
  }

  const qualityLabels: Record<TimeQuality, string> = {
    prime: 'Prime Time',
    good: 'Good Window',
    slow: 'Slow Period',
  };

  const qualityDescriptions: Record<TimeQuality, string> = {
    prime: 'Optimal trading window. Highest volume, tightest spreads, best probability.',
    good: 'Decent liquidity. Valid setups possible — expect slightly wider spreads.',
    slow: 'Low liquidity. Alpha continues scanning. Manual trades carry elevated risk.',
  };

  return {
    quality: zone.quality,
    label: qualityLabels[zone.quality],
    description: qualityDescriptions[zone.quality],
    windowEndUtcMinutes,
    sessionLabel,
    sessionIcon,
    sessionStartUtc,
    sessionEndUtc,
    currentUtcMinutes,
  };
}

function formatMinutesAsCountdown(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function utcHourToLocalDisplay(utcHour: number): string {
  const date = new Date();
  date.setUTCHours(utcHour, 0, 0, 0);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

const SessionTimeline: React.FC<{ currentUtcMinutes: number }> = ({ currentUtcMinutes }) => {
  const totalMinutesInDay = 24 * 60;
  const cursorPct = (currentUtcMinutes / totalMinutesInDay) * 100;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">24h Trading Quality</span>
        <span className="text-[10px] text-gray-600">UTC-based</span>
      </div>
      <div className="relative h-5 rounded-lg overflow-hidden bg-slate-800/60 border border-slate-700/40">
        {TIMELINE_ZONES.map((zone, i) => {
          const leftPct = (zone.startUtc / 24) * 100;
          const widthPct = ((zone.endUtc - zone.startUtc) / 24) * 100;
          const colors = getQualityColors(zone.quality);
          return (
            <div
              key={i}
              className={`absolute top-0 bottom-0 ${colors.timelineBar}`}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              title={`${zone.label} (${zone.startUtc}:00-${zone.endUtc}:00 UTC)`}
            />
          );
        })}

        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white z-10 shadow-lg"
          style={{ left: `${cursorPct}%` }}
        >
          <div className="absolute -top-0.5 -left-1 w-2.5 h-2.5 bg-white rounded-full shadow-md" />
        </div>

        <div className="absolute inset-0 flex">
          {[0, 4, 8, 12, 16, 20].map((h) => (
            <div
              key={h}
              className="absolute top-0 bottom-0 w-px bg-slate-700/30"
              style={{ left: `${(h / 24) * 100}%` }}
            />
          ))}
        </div>
      </div>

      <div className="flex justify-between mt-1">
        {[0, 4, 8, 12, 16, 20].map((h) => (
          <span key={h} className="text-[9px] text-gray-600 font-mono">{String(h).padStart(2, '0')}:00</span>
        ))}
        <span className="text-[9px] text-gray-600 font-mono">24:00</span>
      </div>

      <div className="flex items-center gap-3 mt-1.5">
        {(['prime', 'good', 'slow'] as TimeQuality[]).map((q) => {
          const c = getQualityColors(q);
          const labels: Record<TimeQuality, string> = { prime: 'Prime', good: 'Good', slow: 'Slow' };
          return (
            <div key={q} className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-sm ${c.timelineBar}`} />
              <span className={`text-[9px] ${c.text}`}>{labels[q]}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const SessionQualityBanner: React.FC = () => {
  const [info, setInfo] = useState<SessionTimeQualityInfo>(computeSessionTimeQuality);
  const [countdown, setCountdown] = useState<number>(0);

  useEffect(() => {
    const tick = () => {
      const fresh = computeSessionTimeQuality();
      setInfo(fresh);
      const now = new Date();
      const currentMins = now.getUTCHours() * 60 + now.getUTCMinutes();
      setCountdown(Math.max(0, fresh.windowEndUtcMinutes - currentMins));
    };
    tick();
    const interval = setInterval(tick, 30000);
    return () => clearInterval(interval);
  }, []);

  const colors = getQualityColors(info.quality);
  const sessionCtx = calculateSessionContext();

  const sessionStartLocalStr = utcHourToLocalDisplay(info.sessionStartUtc);
  const sessionEndLocalStr = utcHourToLocalDisplay(info.sessionEndUtc);

  const sessionDurationMinutes = (info.sessionEndUtc - info.sessionStartUtc) * 60;
  const elapsedMinutes = info.currentUtcMinutes - info.sessionStartUtc * 60;
  const sessionProgressPct = Math.min(100, Math.max(0, (elapsedMinutes / sessionDurationMinutes) * 100));

  const SessionIconComp = () => {
    switch (info.sessionIcon) {
      case 'sun': return <Sun className="w-4 h-4 text-yellow-400" />;
      case 'sunrise': return <Sunrise className="w-4 h-4 text-orange-400" />;
      case 'moon': return <Moon className="w-4 h-4 text-blue-400" />;
      default: return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  return (
    <div className={`rounded-xl border p-3.5 mb-4 ${colors.border} ${colors.bg}`}>
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <SessionIconComp />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">{info.sessionLabel}</span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${colors.badge} ${colors.badgeText}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${colors.dot} animate-pulse`} />
                {info.label}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <MapPin className="w-3 h-3 text-gray-500" />
              <span className="text-[10px] text-gray-500">
                {sessionStartLocalStr} – {sessionEndLocalStr} local
              </span>
              <span className="text-[10px] text-gray-600">·</span>
              <span className="text-[10px] text-gray-500">
                {sessionCtx.sessionTimeRemainingMinutes > 0
                  ? `${formatMinutesAsCountdown(sessionCtx.sessionTimeRemainingMinutes)} left in session`
                  : 'Session ending'}
              </span>
            </div>
          </div>
        </div>

        <div className="text-right flex-shrink-0 ml-3">
          <div className={`text-xs font-semibold ${colors.text}`}>
            {countdown > 0 ? `${formatMinutesAsCountdown(countdown)} left` : 'Window ending'}
          </div>
          <div className="text-[10px] text-gray-500">in this window</div>
        </div>
      </div>

      <div className="mb-2.5">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-gray-500">Session progress</span>
          <span className="text-[10px] text-gray-500">{Math.round(sessionProgressPct)}%</span>
        </div>
        <div className="h-1.5 bg-slate-800/60 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${colors.dot}`}
            style={{ width: `${sessionProgressPct}%` }}
          />
        </div>
      </div>

      <p className={`text-[11px] leading-relaxed ${colors.text}`}>
        {info.description}
      </p>

      <SessionTimeline currentUtcMinutes={info.currentUtcMinutes} />
    </div>
  );
};

function computeMinutesToForexReopen(): number {
  const now = new Date();
  const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = estTime.getDay();
  const h = estTime.getHours();
  const m = estTime.getMinutes();
  const totalMins = h * 60 + m;
  const sundayOpenMins = 17 * 60;

  if (day === 6) {
    const minsUntilSundayMidnight = (24 * 60) - totalMins;
    return minsUntilSundayMidnight + sundayOpenMins;
  }
  if (day === 0) {
    if (totalMins < sundayOpenMins) {
      return sundayOpenMins - totalMins;
    }
    return 0;
  }
  if (day === 5) {
    const fridayCloseMins = 17 * 60;
    if (totalMins >= fridayCloseMins) {
      const minsUntilSatMidnight = (24 * 60) - totalMins;
      const satMins = 24 * 60;
      return minsUntilSatMidnight + satMins + sundayOpenMins;
    }
  }
  return 0;
}

const MarketClosedBanner: React.FC = () => {
  const [minsToReopen, setMinsToReopen] = useState(computeMinutesToForexReopen);

  useEffect(() => {
    const interval = setInterval(() => {
      setMinsToReopen(computeMinutesToForexReopen());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const h = Math.floor(minsToReopen / 60);
  const m = minsToReopen % 60;
  const reopenLabel = h > 0 ? `${h}h ${m}m` : `${m}m`;

  return (
    <div className="rounded-xl border border-slate-600/40 bg-gradient-to-br from-slate-800/60 to-slate-900/40 p-3.5 mb-4">
      <div className="flex items-center gap-3 mb-2.5">
        <div className="p-2 bg-slate-700/50 rounded-lg flex-shrink-0">
          <Moon className="w-4 h-4 text-slate-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-white">Forex Markets Closed</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold bg-slate-700/50 border-slate-600/40 text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
              Weekend
            </span>
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Fri 5:00 PM – Sun 5:00 PM EST &nbsp;·&nbsp; Reopens in{' '}
            <span className="text-slate-300 font-semibold">{reopenLabel}</span>
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-xs font-semibold text-slate-400">{reopenLabel}</div>
          <div className="text-[10px] text-slate-600">to reopen</div>
        </div>
      </div>

      <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-700/30 border border-slate-600/30">
        <Bitcoin className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <p className="text-[11px] text-slate-300 leading-snug">
          <span className="font-semibold text-white">Crypto only</span> — BTCUSD and ETHUSD trade 24/7.
          Forex, Gold, and Index pairs are hidden until Sunday 5:00 PM EST.
        </p>
      </div>
    </div>
  );
};

type ScanState = 'idle' | 'scanning' | 'done' | 'cooldown' | 'error';

interface SessionIntelligenceMonitorProps {
  sessionId?: string;
  userId?: string;
}

const STYLE_NORMALISE: Record<string, TradeStyle> = {
  scalper: 'scalper',
  scalp: 'scalper',
  SCALP: 'scalper',
  micro: 'micro',
  micro_intraday: 'micro',
  MICRO_INTRADAY: 'micro',
  intraday: 'intraday',
  INTRADAY: 'intraday',
};

export const SessionIntelligenceMonitor: React.FC<SessionIntelligenceMonitorProps> = ({
  sessionId,
  userId,
}) => {
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const [activeFilter, setActiveFilter] = useState<TradeStyle | 'all'>('all');
  const [previewResult, setPreviewResult] = useState<AlphaPreviewScanResult | null>(null);
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [scanError, setScanError] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const [isForexMarketClosed, setIsForexMarketClosed] = useState(
    () => !getForexMarketStatus().isOpen
  );

  useEffect(() => {
    const checkMarket = () => setIsForexMarketClosed(!getForexMarketStatus().isOpen);
    const interval = setInterval(checkMarket, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleScanNow = useCallback(async () => {
    if (scanState === 'scanning' || scanState === 'cooldown') return;

    setScanState('scanning');
    setScanError(null);

    try {
      const result = await alphaPreviewScanner.scan();
      setPreviewResult(result);
      setScanState('done');

      setTimeout(() => {
        setScanState('cooldown');
        setCooldownSeconds(60);
      }, 2500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Scan failed';
      if (msg.startsWith('Cooldown active')) {
        setScanState('cooldown');
        setCooldownSeconds(alphaPreviewScanner.cooldownSecondsRemaining);
      } else {
        setScanState('error');
        setScanError(msg);
        setTimeout(() => setScanState('idle'), 5000);
      }
    }
  }, [scanState]);

  useEffect(() => {
    if (scanState !== 'cooldown' || cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((s) => {
        if (s <= 1) {
          clearInterval(timer);
          setScanState('idle');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [scanState, cooldownSeconds]);

  const resolveStyle = (card: AlphaPreviewCard): TradeStyle => {
    return STYLE_NORMALISE[card.tradeStyle] ?? 'micro';
  };

  const getReadyCards = (): AlphaPreviewCard[] => {
    if (!previewResult) return [];
    const filtered = isForexMarketClosed
      ? previewResult.ready.filter((c) => isSymbolMarketOpen(c.symbol))
      : previewResult.ready;
    if (activeFilter === 'all') return filtered;
    return filtered.filter((c) => resolveStyle(c) === activeFilter);
  };

  const getHeatingCount = (): number => {
    if (!previewResult) return 0;
    return previewResult.heatingCount;
  };

  const getStyleCounts = (): Record<TradeStyle, number> => {
    const counts: Record<TradeStyle, number> = { scalper: 0, micro: 0, intraday: 0 };
    const cards = isForexMarketClosed
      ? (previewResult?.ready ?? []).filter((c) => isSymbolMarketOpen(c.symbol))
      : (previewResult?.ready ?? []);
    for (const card of cards) {
      const style = resolveStyle(card);
      counts[style]++;
    }
    return counts;
  };

  const handleAnalyzeWithAlpha = (card: AlphaPreviewCard) => {
    const style = resolveStyle(card);
    sessionStorage.setItem('im_card_signal', JSON.stringify({
      symbol: card.symbol,
      direction: card.direction,
      confidence: card.confidence,
      tradeStyle: card.tradeStyle,
    }));
    navigate('/ai-trade', { replace: false });
    setSearchParams({ style, symbol: card.symbol });
  };

  const renderPairCard = (card: AlphaPreviewCard) => {
    const style = resolveStyle(card);
    const config = STYLE_CONFIG[style];
    const confidence = card.confidence;
    const isBuy = card.direction === 'buy';

    const scoreColor = confidence >= 85
      ? 'text-green-400'
      : confidence >= 70
        ? 'text-yellow-400'
        : 'text-gray-400';

    const tradeableLabel = confidence >= 85
      ? 'Trade It'
      : confidence >= 70
        ? 'Worth a Look'
        : 'Monitor';

    const tradeableBg = confidence >= 85
      ? 'bg-green-500/15 border-green-500/40 text-green-300'
      : confidence >= 70
        ? 'bg-yellow-500/15 border-yellow-500/40 text-yellow-300'
        : 'bg-gray-700/30 border-gray-600/30 text-gray-500';

    return (
      <div
        key={`${card.symbol}-${style}-${card.timeframe}`}
        className={`relative rounded-xl border transition-all duration-300 hover:scale-[1.01] overflow-hidden ${config.border} ${config.bg}`}
      >
        <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r ${config.glow}`} />

        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-base font-bold text-white">{card.symbol}</span>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${
                      isBuy
                        ? 'bg-green-500/15 border-green-500/40 text-green-400'
                        : 'bg-red-500/15 border-red-500/40 text-red-400'
                    }`}
                  >
                    {isBuy ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {isBuy ? 'Buy' : 'Sell'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0 rounded text-[10px] font-semibold ${config.badgeBg} ${config.badgeText}`}>
                    {config.icon}
                    {config.label}
                  </span>
                  <span className="text-[10px] text-gray-600 font-mono">{card.timeframe}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-3">
              <span className={`text-2xl font-bold tabular-nums leading-none ${scoreColor}`}>
                {confidence}%
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${tradeableBg}`}>
                {tradeableLabel}
              </span>
            </div>
          </div>

          {card.reasoning && (
            <p className="mt-2 text-[11px] text-gray-400 leading-relaxed line-clamp-2">
              {card.reasoning}
            </p>
          )}

          <button
            onClick={() => handleAnalyzeWithAlpha(card)}
            className={`mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] ${config.badgeBg} ${config.badgeText} hover:opacity-90`}
          >
            <Target className="w-3.5 h-3.5" />
            Analyze with Alpha
            <ChevronRight className="w-3.5 h-3.5 ml-auto" />
          </button>
        </div>
      </div>
    );
  };

  const readyCards = getReadyCards();
  const heatingCount = getHeatingCount();
  const styleCounts = getStyleCounts();
  const hasResults = previewResult !== null;

  return (
    <div className="relative group">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-xl opacity-20 group-hover:opacity-30 transition duration-300 blur" />

      <div className="relative bg-gradient-to-br from-slate-900/50 to-blue-900/40 rounded-xl p-5 border border-blue-500/50">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-500/20 rounded-lg">
              <Activity className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Real-Time Intelligence</h3>
              <p className="text-sm text-blue-300">
                {isForexMarketClosed
                  ? 'Crypto Only (Weekend)'
                  : 'Alpha Pipeline Preview'}
                {hasResults && previewResult && (
                  <span className="text-blue-400/70 ml-1">
                    · Last: {previewResult.scannedAt.toLocaleTimeString()}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleScanNow}
              disabled={scanState === 'scanning' || scanState === 'cooldown'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all duration-200 ${
                scanState === 'scanning'
                  ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300 opacity-75 cursor-not-allowed'
                  : scanState === 'done'
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : scanState === 'error'
                  ? 'bg-red-500/20 border-red-500/50 text-red-300'
                  : scanState === 'cooldown'
                  ? 'bg-gray-700/40 border-gray-600/30 text-gray-500 cursor-not-allowed'
                  : 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/25'
              }`}
              title={
                scanState === 'cooldown'
                  ? `Cooldown: ${cooldownSeconds}s`
                  : 'Run Alpha pipeline scan across all pairs'
              }
            >
              {scanState === 'scanning' ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Scanning...
                </>
              ) : scanState === 'done' && previewResult ? (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  {previewResult.ready.length} ready
                </>
              ) : scanState === 'error' ? (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  {scanError ?? 'Error'}
                </>
              ) : scanState === 'cooldown' ? (
                <>
                  <Timer className="w-3.5 h-3.5" />
                  {cooldownSeconds}s
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  Scan Now
                </>
              )}
            </button>
          </div>
        </div>

        {isForexMarketClosed ? <MarketClosedBanner /> : <SessionQualityBanner />}

        {!hasResults && scanState === 'idle' && (
          <div className="rounded-lg p-5 border border-blue-500/20 bg-blue-900/10 text-center mb-4">
            <div className="flex flex-col items-center gap-3">
              <div className="p-3 bg-blue-500/15 rounded-full">
                <Zap className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-200 mb-1">
                  Preview Alpha's current market assessment
                </p>
                <p className="text-xs text-blue-300/70 max-w-xs mx-auto">
                  Tap Scan Now to run the full Alpha pipeline across all pairs and see exactly what's ready to trade — using Alpha's real confidence scores.
                </p>
              </div>
            </div>
          </div>
        )}

        {hasResults && (
          <>
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {readyCards.length > 0 ? (
                <div className="px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/20">
                  <p className="text-sm font-semibold text-emerald-400">
                    {readyCards.length} Setup{readyCards.length !== 1 ? 's' : ''} Ready
                  </p>
                </div>
              ) : (
                <div className="px-3 py-1.5 rounded-lg border border-slate-600/30 bg-slate-700/20">
                  <p className="text-sm font-semibold text-slate-400">No setups ready</p>
                </div>
              )}
              {heatingCount > 0 && (
                <div className="px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10">
                  <p className="text-sm font-semibold text-amber-400">
                    {heatingCount} heating up
                  </p>
                </div>
              )}
              {previewResult && (
                <div className="px-3 py-1.5 rounded-lg border border-slate-700/30 bg-slate-800/20 ml-auto">
                  <p className="text-xs text-slate-500">
                    {previewResult.scannedCount} scanned · {Math.round(previewResult.scanDurationMs / 1000)}s
                  </p>
                </div>
              )}
            </div>

            {readyCards.length > 0 && (
              <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1">
                <button
                  onClick={() => setActiveFilter('all')}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors flex-shrink-0 ${
                    activeFilter === 'all'
                      ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                      : 'bg-gray-800/30 border-gray-700/30 text-gray-500 hover:text-gray-300'
                  }`}
                >
                  All
                </button>
                {(['scalper', 'micro', 'intraday'] as TradeStyle[]).map((style) => {
                  const cfg = STYLE_CONFIG[style];
                  const count = styleCounts[style];
                  return (
                    <button
                      key={style}
                      onClick={() => setActiveFilter(style)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors flex-shrink-0 ${
                        activeFilter === style
                          ? `${cfg.badgeBg} ${cfg.badgeText}`
                          : 'bg-gray-800/30 border-gray-700/30 text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {cfg.icon}
                      {cfg.label}
                      {count > 0 && (
                        <span
                          className={`ml-0.5 px-1.5 py-0 rounded-full text-[10px] ${
                            activeFilter === style ? cfg.badgeText : 'text-gray-500'
                          } ${activeFilter === style ? 'bg-white/10' : 'bg-gray-700/50'}`}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {readyCards.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-semibold text-blue-200 mb-3">
                  Ready to Trade
                </p>
                <div className="space-y-3">
                  {readyCards.map((card) => renderPairCard(card))}
                </div>
              </div>
            )}

            {heatingCount > 0 && (
              <div className="mb-4">
                <div className="bg-amber-900/20 rounded-lg p-4 border border-amber-500/30">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-amber-500/20 rounded-lg flex-shrink-0">
                      <Activity className="w-4 h-4 text-amber-400" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-amber-300 mb-1">
                        {heatingCount} {heatingCount === 1 ? 'pair' : 'pairs'} heating up
                      </p>
                      <p className="text-sm text-amber-200/70">
                        Alpha sees a directional bias but these setups didn't pass all eligibility gates yet. Conditions are developing — scan again shortly.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {readyCards.length === 0 && heatingCount === 0 && (
              <div className={`rounded-lg p-4 border mb-4 ${isForexMarketClosed ? 'bg-slate-800/30 border-slate-600/30' : 'bg-blue-900/20 border-blue-500/30'}`}>
                <div className="flex items-start gap-3">
                  {isForexMarketClosed
                    ? <Bitcoin className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    : <Clock className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                  }
                  <div>
                    <p className={`text-sm font-semibold mb-1 ${isForexMarketClosed ? 'text-slate-300' : 'text-blue-300'}`}>
                      {isForexMarketClosed ? 'No Crypto Setups Right Now' : 'No Ready Setups Found'}
                    </p>
                    <p className={`text-sm ${isForexMarketClosed ? 'text-slate-400' : 'text-blue-200/80'}`}>
                      {isForexMarketClosed
                        ? 'Alpha scanned BTCUSD and ETHUSD. Neither pair meets the full eligibility criteria right now.'
                        : 'Alpha completed a full scan. No pairs passed all eligibility gates at this time. Market conditions may improve — try again in a few minutes.'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
