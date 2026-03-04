import React from 'react';
import { TrendingUp, TrendingDown, Star, Target, BarChart2, Zap } from 'lucide-react';

interface ShareSummaryData {
  current_rank: string;
  current_rank_color: string;
  total_wins: number;
  total_pnl: number;
  best_trade_pnl: number;
  avg_pnl: number;
  best_symbol: string;
}

interface ShareWinData {
  trade_number: number;
  symbol: string;
  direction: string;
  pnl: number;
  close_reason: string;
  lot_size: number;
  trade_style: string;
  achieved_at: string;
  medal_rank: string;
  medal_color: string;
}

interface SummaryShareCardProps {
  summary: ShareSummaryData;
  displayName: string;
}

interface WinShareCardProps {
  achievement: ShareWinData;
  displayName: string;
}

const MEDAL_EMOJI: Record<string, string> = {
  Platinum: '👑',
  Diamond:  '💎',
  Gold:     '🥇',
  Silver:   '🥈',
  Bronze:   '🥉',
};

const formatCloseReason = (reason: string) => {
  switch (reason) {
    case 'take_profit_1': return 'TP1 Hit';
    case 'take_profit_2': return 'TP2 Hit';
    case 'take_profit':   return 'TP Hit';
    case 'manual':        return 'Manual Close';
    case 'goal_achieved': return 'Goal Hit';
    default:              return reason?.replace(/_/g, ' ') || 'Closed';
  }
};

const formatStyle = (style: string) => {
  if (!style) return null;
  return style.charAt(0).toUpperCase() + style.slice(1).replace(/_/g, ' ');
};

export const SummaryShareCard = React.forwardRef<HTMLDivElement, SummaryShareCardProps>(
  ({ summary, displayName }, ref) => {
    const rankColor = summary.current_rank_color || '#FFD700';
    const medal = MEDAL_EMOJI[summary.current_rank] || '🏆';

    return (
      <div
        ref={ref}
        style={{
          width: '600px',
          height: '600px',
          background: 'linear-gradient(135deg, #0d1117 0%, #111827 50%, #0d1117 100%)',
          position: 'relative',
          overflow: 'hidden',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          flexShrink: 0,
        }}
      >
        {/* Background mesh */}
        <div style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(ellipse 60% 50% at 50% 0%, ${rankColor}18 0%, transparent 70%)`,
        }} />
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }} />

        {/* Top border glow */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
          background: `linear-gradient(90deg, transparent, ${rankColor}, transparent)`,
        }} />

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 1, padding: '40px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>

          {/* Header — Logo + branding */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img
                src="/Pipnosis icon.png"
                alt="Pipnosis"
                style={{ width: '32px', height: '32px', objectFit: 'contain' }}
              />
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '15px', fontWeight: '600', letterSpacing: '0.05em' }}>
                PIPNOSIS AI
              </span>
            </div>
            <span style={{
              color: 'rgba(255,255,255,0.35)',
              fontSize: '13px',
              background: 'rgba(255,255,255,0.05)',
              padding: '4px 10px',
              borderRadius: '999px',
              border: '1px solid rgba(255,255,255,0.08)',
            }}>
              pipnosis.ai
            </span>
          </div>

          {/* Rank hero */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '28px' }}>
            <div style={{
              width: '80px', height: '80px', borderRadius: '50%',
              background: `linear-gradient(135deg, ${rankColor}20, ${rankColor}50)`,
              border: `2.5px solid ${rankColor}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '36px',
              boxShadow: `0 0 32px ${rankColor}40`,
              flexShrink: 0,
            }}>
              {medal}
            </div>
            <div>
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', fontWeight: '500', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '4px' }}>
                Rank Achieved
              </div>
              <div style={{ fontSize: '34px', fontWeight: '800', color: '#fff', lineHeight: 1.1, letterSpacing: '-0.02em' }}>
                {summary.current_rank} Trader
              </div>
              <div style={{ fontSize: '15px', color: 'rgba(255,255,255,0.5)', marginTop: '4px' }}>
                {displayName}
              </div>
            </div>
          </div>

          {/* Total wins hero */}
          <div style={{
            background: `linear-gradient(135deg, ${rankColor}12, ${rankColor}06)`,
            border: `1px solid ${rankColor}30`,
            borderRadius: '16px',
            padding: '20px 24px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>Winning Trades</div>
              <div style={{ fontSize: '48px', fontWeight: '800', color: rankColor, lineHeight: 1 }}>
                {summary.total_wins}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px' }}>Total Profit</div>
              <div style={{ fontSize: '32px', fontWeight: '700', color: '#34d399', lineHeight: 1 }}>
                ${summary.total_pnl.toFixed(2)}
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: 'auto' }}>
            {[
              { label: 'Best Trade', value: `$${summary.best_trade_pnl.toFixed(2)}`, color: '#facc15' },
              { label: 'Avg Per Trade', value: `$${summary.avg_pnl.toFixed(2)}`, color: '#60a5fa' },
              { label: 'Best Symbol', value: summary.best_symbol || '—', color: '#fb923c' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '12px',
                padding: '14px 16px',
              }}>
                <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {label}
                </div>
                <div style={{ fontSize: '18px', fontWeight: '700', color }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{
            marginTop: '24px',
            paddingTop: '16px',
            borderTop: '1px solid rgba(255,255,255,0.07)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)' }}>
              AI-Powered Trading Intelligence
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34d399' }} />
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)' }}>Live Results</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

SummaryShareCard.displayName = 'SummaryShareCard';

export const WinShareCard = React.forwardRef<HTMLDivElement, WinShareCardProps>(
  ({ achievement: a, displayName }, ref) => {
    const rankColor = a.medal_color || '#FFD700';
    const medal = MEDAL_EMOJI[a.medal_rank] || '🏆';
    const isTP2 = a.close_reason === 'take_profit_2';
    const isBuy = a.direction === 'BUY';

    return (
      <div
        ref={ref}
        style={{
          width: '600px',
          height: '400px',
          background: 'linear-gradient(135deg, #0d1117 0%, #111827 60%, #0d1117 100%)',
          position: 'relative',
          overflow: 'hidden',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          flexShrink: 0,
        }}
      >
        {/* Background glow */}
        <div style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(ellipse 80% 60% at 50% 0%, ${rankColor}15 0%, transparent 60%)`,
        }} />
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.025) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }} />

        {/* Top border glow */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
          background: `linear-gradient(90deg, transparent, ${rankColor}, transparent)`,
        }} />

        {/* Diagonal accent */}
        <div style={{
          position: 'absolute', top: '-60px', right: '-60px',
          width: '220px', height: '220px', borderRadius: '50%',
          background: `radial-gradient(circle, ${rankColor}20 0%, transparent 70%)`,
          filter: 'blur(20px)',
        }} />

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 1, padding: '32px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <img
                src="/Pipnosis icon.png"
                alt="Pipnosis"
                style={{ width: '24px', height: '24px', objectFit: 'contain' }}
              />
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px', fontWeight: '600', letterSpacing: '0.06em' }}>
                PIPNOSIS AI
              </span>
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: `${rankColor}15`,
              border: `1px solid ${rankColor}40`,
              borderRadius: '999px',
              padding: '4px 12px',
            }}>
              <span style={{ fontSize: '14px' }}>{medal}</span>
              <span style={{ fontSize: '13px', fontWeight: '700', color: rankColor }}>
                {a.medal_rank} · Win #{a.trade_number}
              </span>
            </div>
          </div>

          {/* Main content */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '24px', flex: 1 }}>

            {/* Left: Symbol + Direction */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {displayName}
              </div>
              <div style={{ fontSize: '36px', fontWeight: '800', color: '#fff', letterSpacing: '-0.02em', marginBottom: '8px' }}>
                {a.symbol}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <span style={{
                  fontSize: '13px', fontWeight: '700',
                  padding: '4px 10px', borderRadius: '6px',
                  background: isBuy ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)',
                  color: isBuy ? '#34d399' : '#f87171',
                  display: 'flex', alignItems: 'center', gap: '4px',
                }}>
                  {isBuy ? '↑' : '↓'} {a.direction}
                </span>
                {a.trade_style && (
                  <span style={{
                    fontSize: '12px', color: 'rgba(255,255,255,0.4)',
                    background: 'rgba(255,255,255,0.06)',
                    padding: '4px 8px', borderRadius: '6px',
                  }}>
                    {formatStyle(a.trade_style)}
                  </span>
                )}
              </div>

              {/* Stats mini-grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '10px', padding: '10px 12px',
                }}>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Close</div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: 'rgba(255,255,255,0.85)' }}>{formatCloseReason(a.close_reason)}</div>
                </div>
                <div style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '10px', padding: '10px 12px',
                }}>
                  <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Lot Size</div>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: 'rgba(255,255,255,0.85)' }}>{a.lot_size > 0 ? a.lot_size.toFixed(2) : '—'}</div>
                </div>
              </div>
            </div>

            {/* Right: Profit hero */}
            <div style={{
              textAlign: 'right',
              background: 'rgba(52,211,153,0.06)',
              border: '1px solid rgba(52,211,153,0.2)',
              borderRadius: '16px',
              padding: '20px 24px',
              flexShrink: 0,
            }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Profit</div>
              <div style={{ fontSize: '38px', fontWeight: '800', color: '#34d399', lineHeight: 1, letterSpacing: '-0.02em' }}>
                +${a.pnl.toFixed(2)}
              </div>
              {isTP2 && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px',
                  marginTop: '6px',
                  fontSize: '12px', fontWeight: '700', color: '#facc15',
                }}>
                  ⚡ Full TP
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div style={{
            marginTop: '16px',
            paddingTop: '14px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)' }}>
              {new Date(a.achieved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)' }}>pipnosis.ai</span>
          </div>
        </div>
      </div>
    );
  }
);

WinShareCard.displayName = 'WinShareCard';
