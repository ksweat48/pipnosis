import React from 'react';

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
          height: '750px',
          background: 'linear-gradient(160deg, #0a0e17 0%, #0d1421 40%, #080c14 100%)',
          position: 'relative',
          overflow: 'hidden',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          flexShrink: 0,
        }}
      >
        {/* Background dot grid */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.025) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }} />

        {/* Top bloom */}
        <div style={{
          position: 'absolute', top: '-80px', left: '50%', transform: 'translateX(-50%)',
          width: '500px', height: '400px', borderRadius: '50%',
          background: `radial-gradient(ellipse, ${rankColor}22 0%, transparent 65%)`,
          filter: 'blur(10px)',
        }} />

        {/* Bottom bloom */}
        <div style={{
          position: 'absolute', bottom: '-60px', left: '50%', transform: 'translateX(-50%)',
          width: '400px', height: '250px', borderRadius: '50%',
          background: `radial-gradient(ellipse, ${rankColor}10 0%, transparent 70%)`,
          filter: 'blur(8px)',
        }} />

        {/* Top border glow */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
          background: `linear-gradient(90deg, transparent 5%, ${rankColor} 50%, transparent 95%)`,
        }} />

        {/* Bottom border glow */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '2px',
          background: `linear-gradient(90deg, transparent 20%, ${rankColor}60 50%, transparent 80%)`,
        }} />

        {/* Left / right vignette */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(90deg, rgba(0,0,0,0.3) 0%, transparent 15%, transparent 85%, rgba(0,0,0,0.3) 100%)',
        }} />

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 1, padding: '44px 44px 36px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '44px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <img
                src="/Pipnosis icon.png"
                alt="Pipnosis"
                style={{ width: '30px', height: '30px', objectFit: 'contain' }}
              />
              <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '14px', fontWeight: '700', letterSpacing: '0.1em' }}>
                PIPNOSIS AI
              </span>
            </div>
            <span style={{
              color: 'rgba(255,255,255,0.3)',
              fontSize: '12px',
              background: 'rgba(255,255,255,0.05)',
              padding: '5px 12px',
              borderRadius: '999px',
              border: '1px solid rgba(255,255,255,0.08)',
              letterSpacing: '0.04em',
            }}>
              pipnosis.ai
            </span>
          </div>

          {/* Medal hero — centered */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '36px' }}>
            <div style={{
              width: '120px', height: '120px', borderRadius: '50%',
              background: `radial-gradient(circle, ${rankColor}30 0%, ${rankColor}10 60%, transparent 100%)`,
              border: `2px solid ${rankColor}80`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '56px',
              boxShadow: `0 0 60px ${rankColor}50, 0 0 100px ${rankColor}20`,
              marginBottom: '20px',
            }}>
              {medal}
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', fontWeight: '600', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: '8px' }}>
              Rank Achieved
            </div>
            <div style={{ fontSize: '40px', fontWeight: '800', color: '#fff', lineHeight: 1, letterSpacing: '-0.03em', textAlign: 'center' }}>
              {summary.current_rank} Trader
            </div>
            <div style={{ fontSize: '16px', color: 'rgba(255,255,255,0.45)', marginTop: '8px', letterSpacing: '0.02em' }}>
              {displayName}
            </div>
          </div>

          {/* Wins + Profit hero panel */}
          <div style={{
            background: `linear-gradient(135deg, ${rankColor}14 0%, ${rankColor}06 100%)`,
            border: `1px solid ${rankColor}35`,
            borderRadius: '20px',
            padding: '28px 32px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.38)', marginBottom: '6px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Winning Trades
              </div>
              <div style={{ fontSize: '64px', fontWeight: '900', color: rankColor, lineHeight: 1, letterSpacing: '-0.04em' }}>
                {summary.total_wins}
              </div>
            </div>
            <div style={{
              width: '1px', height: '70px',
              background: `linear-gradient(180deg, transparent, ${rankColor}40, transparent)`,
            }} />
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.38)', marginBottom: '6px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Total Profit
              </div>
              <div style={{ fontSize: '44px', fontWeight: '800', color: '#34d399', lineHeight: 1, letterSpacing: '-0.03em' }}>
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
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: '14px',
                padding: '16px 18px',
              }}>
                <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {label}
                </div>
                <div style={{ fontSize: '20px', fontWeight: '700', color }}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{
            marginTop: '28px',
            paddingTop: '18px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.04em' }}>
              AI-Powered Trading Intelligence
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#34d399', boxShadow: '0 0 6px #34d399' }} />
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)' }}>Live Results</span>
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
          height: '750px',
          background: 'linear-gradient(160deg, #0a0e17 0%, #0d1421 50%, #080c14 100%)',
          position: 'relative',
          overflow: 'hidden',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          flexShrink: 0,
        }}
      >
        {/* Dot grid */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.025) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }} />

        {/* Top bloom */}
        <div style={{
          position: 'absolute', top: '-100px', left: '50%', transform: 'translateX(-50%)',
          width: '480px', height: '380px', borderRadius: '50%',
          background: `radial-gradient(ellipse, ${rankColor}25 0%, transparent 60%)`,
          filter: 'blur(12px)',
        }} />

        {/* Center profit bloom */}
        <div style={{
          position: 'absolute', top: '55%', left: '50%', transform: 'translate(-50%, -50%)',
          width: '500px', height: '300px', borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(52,211,153,0.08) 0%, transparent 65%)',
          filter: 'blur(8px)',
        }} />

        {/* Ghosted symbol watermark */}
        <div style={{
          position: 'absolute', bottom: '120px', left: '50%', transform: 'translateX(-50%)',
          fontSize: '140px', fontWeight: '900', color: 'rgba(255,255,255,0.025)',
          letterSpacing: '-0.04em', whiteSpace: 'nowrap', userSelect: 'none',
          lineHeight: 1,
        }}>
          {a.symbol}
        </div>

        {/* Top border glow */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
          background: `linear-gradient(90deg, transparent 5%, ${rankColor} 50%, transparent 95%)`,
        }} />

        {/* Bottom border glow */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '2px',
          background: `linear-gradient(90deg, transparent 20%, ${rankColor}60 50%, transparent 80%)`,
        }} />

        {/* Left / right vignette */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(90deg, rgba(0,0,0,0.3) 0%, transparent 12%, transparent 88%, rgba(0,0,0,0.3) 100%)',
        }} />

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 1, padding: '36px 40px 30px', height: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <img
                src="/Pipnosis icon.png"
                alt="Pipnosis"
                style={{ width: '26px', height: '26px', objectFit: 'contain' }}
              />
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px', fontWeight: '700', letterSpacing: '0.1em' }}>
                PIPNOSIS AI
              </span>
            </div>
            {/* Medal + rank badge */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: `${rankColor}14`,
              border: `1px solid ${rankColor}45`,
              borderRadius: '999px',
              padding: '5px 14px',
            }}>
              <span style={{ fontSize: '14px' }}>{medal}</span>
              <span style={{ fontSize: '13px', fontWeight: '700', color: rankColor, letterSpacing: '0.02em' }}>
                {a.medal_rank} · Win #{a.trade_number}
              </span>
            </div>
          </div>

          {/* Symbol hero — centered */}
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.35)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {displayName}
            </div>
            <div style={{ fontSize: '72px', fontWeight: '900', color: '#fff', letterSpacing: '-0.04em', lineHeight: 1 }}>
              {a.symbol}
            </div>
          </div>

          {/* Direction + style — centered */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '28px' }}>
            <span style={{
              fontSize: '14px', fontWeight: '800',
              padding: '6px 16px', borderRadius: '8px',
              background: isBuy ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)',
              color: isBuy ? '#34d399' : '#f87171',
              border: `1px solid ${isBuy ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)'}`,
              letterSpacing: '0.06em',
            }}>
              {isBuy ? '↑' : '↓'} {a.direction}
            </span>
            {a.trade_style && (
              <span style={{
                fontSize: '13px', color: 'rgba(255,255,255,0.45)',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                padding: '6px 14px', borderRadius: '8px',
                letterSpacing: '0.04em',
              }}>
                {formatStyle(a.trade_style)}
              </span>
            )}
          </div>

          {/* Profit hero block — full width, dominant */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(52,211,153,0.12) 0%, rgba(52,211,153,0.05) 100%)',
            border: '1px solid rgba(52,211,153,0.3)',
            borderRadius: '20px',
            padding: '28px 32px',
            marginBottom: '16px',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Inner glow */}
            <div style={{
              position: 'absolute', top: '-20px', left: '50%', transform: 'translateX(-50%)',
              width: '300px', height: '100px',
              background: 'radial-gradient(ellipse, rgba(52,211,153,0.15) 0%, transparent 70%)',
              filter: 'blur(6px)',
            }} />
            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                Profit Earned
              </div>
              <div style={{ fontSize: '72px', fontWeight: '900', color: '#34d399', lineHeight: 1, letterSpacing: '-0.04em' }}>
                +${a.pnl.toFixed(2)}
              </div>
              {isTP2 && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  marginTop: '10px',
                  fontSize: '13px', fontWeight: '700', color: '#facc15',
                  background: 'rgba(250,204,21,0.1)',
                  border: '1px solid rgba(250,204,21,0.25)',
                  padding: '4px 12px', borderRadius: '999px',
                }}>
                  ⚡ Full Take Profit
                </div>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: 'auto' }}>
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '14px', padding: '14px 18px',
            }}>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.32)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Close Type
              </div>
              <div style={{ fontSize: '15px', fontWeight: '700', color: 'rgba(255,255,255,0.88)' }}>
                {formatCloseReason(a.close_reason)}
              </div>
            </div>
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '14px', padding: '14px 18px',
            }}>
              <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.32)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Lot Size
              </div>
              <div style={{ fontSize: '15px', fontWeight: '700', color: 'rgba(255,255,255,0.88)' }}>
                {a.lot_size > 0 ? a.lot_size.toFixed(2) : '—'}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{
            marginTop: '20px',
            paddingTop: '16px',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.22)' }}>
              {new Date(a.achieved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
            <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.22)', letterSpacing: '0.04em' }}>pipnosis.ai</span>
          </div>
        </div>
      </div>
    );
  }
);

WinShareCard.displayName = 'WinShareCard';
