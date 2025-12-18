import React, { useState, useEffect } from 'react';
import { CheckCircle2, Activity, AlertTriangle, Clock, HelpCircle, TrendingUp, TrendingDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { wellnessMessageTranslator, type TechnicalWellnessData } from '@/services/wellness-message-translator';

interface WellnessData {
  latest_status: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'CONCERNING' | 'EXIT_NOW' | null;
  latest_recommendation: string | null;
  latest_confidence: number | null;
  latest_note: string | null;
  last_checked_at: string | null;
  minutes_since_check: number | null;
  total_checks: number;
  concerning_checks: number;
  average_confidence: number | null;
  // Additional fields from metadata
  dollar_pnl?: number;
  risk_ratio?: number;
  minutes_in_trade?: number;
}

interface TradeWellnessIndicatorProps {
  tradeId: string;
  compact?: boolean;
  showTooltip?: boolean;
}

export function TradeWellnessIndicator({ tradeId, compact = false, showTooltip = true }: TradeWellnessIndicatorProps) {
  const [wellness, setWellness] = useState<WellnessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    fetchWellness();
    const interval = setInterval(fetchWellness, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [tradeId]);

  const fetchWellness = async () => {
    try {
      // Fetch wellness summary
      const { data, error } = await supabase
        .rpc('get_trade_wellness_summary', { p_trade_id: tradeId });

      if (error) throw error;

      // Also fetch latest wellness check for detailed metadata
      const { data: latestCheck } = await supabase
        .from('periodic_wellness_checks')
        .select('metadata')
        .eq('trade_id', tradeId)
        .order('checked_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Merge metadata if available
      if (data && latestCheck?.metadata) {
        const metadata = latestCheck.metadata as any;
        data.dollar_pnl = parseFloat(metadata.dollar_pnl || '0');
        data.risk_ratio = parseFloat(metadata.current_risk_ratio || '0');
        data.minutes_in_trade = parseFloat(metadata.minutes_in_trade || '0');
      }

      setWellness(data || null);
    } catch (error) {
      console.error('[TradeWellness] Error fetching wellness:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return compact ? (
      <div className="w-4 h-4 bg-gray-700 rounded-full animate-pulse" />
    ) : null;
  }

  if (!wellness || !wellness.latest_status) {
    // No wellness checks yet - show waiting indicator
    return compact ? (
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <Clock className="w-3 h-3" />
        <span>15m</span>
      </div>
    ) : (
      <div className="text-xs text-gray-400 flex items-center gap-1">
        <Clock className="w-3 h-3" />
        <span>Next check in ~15 min</span>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'EXCELLENT':
        return 'text-green-400 bg-green-500/10';
      case 'GOOD':
        return 'text-emerald-400 bg-emerald-500/10';
      case 'FAIR':
        return 'text-yellow-400 bg-yellow-500/10';
      case 'CONCERNING':
        return 'text-orange-400 bg-orange-500/10';
      case 'EXIT_NOW':
        return 'text-red-400 bg-red-500/10';
      default:
        return 'text-gray-400 bg-gray-500/10';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'EXCELLENT':
      case 'GOOD':
        return <CheckCircle2 className="w-3 h-3" />;
      case 'FAIR':
        return <Activity className="w-3 h-3" />;
      case 'CONCERNING':
      case 'EXIT_NOW':
        return <AlertTriangle className="w-3 h-3" />;
      default:
        return <Activity className="w-3 h-3" />;
    }
  };

  const minutesAgo = wellness.minutes_since_check
    ? Math.floor(wellness.minutes_since_check)
    : 0;

  const timeText = minutesAgo < 1
    ? 'just now'
    : minutesAgo === 1
    ? '1m ago'
    : `${minutesAgo}m ago`;

  const colorClass = getStatusColor(wellness.latest_status);

  if (compact) {
    return (
      <div
        className={`flex items-center gap-1 px-2 py-1 rounded-full ${colorClass} cursor-pointer transition-all hover:scale-105`}
        onClick={() => setShowDetails(!showDetails)}
        title={showTooltip ? `Alpha checked ${timeText}: ${wellness.latest_status}` : undefined}
      >
        {getStatusIcon(wellness.latest_status)}
        <span className="text-[10px] font-medium">{timeText}</span>
      </div>
    );
  }

  // Generate user-friendly message if we have enough data
  const userFriendlyMessage = wellness.dollar_pnl !== undefined && wellness.risk_ratio !== undefined && wellness.minutes_in_trade !== undefined
    ? wellnessMessageTranslator.translateWellnessCheck({
        minutesInTrade: wellness.minutes_in_trade,
        riskRatio: wellness.risk_ratio,
        dollarPnL: wellness.dollar_pnl,
        status: wellness.latest_status,
        recommendation: wellness.latest_recommendation as any,
        confidence: wellness.latest_confidence || 0,
        technicalNote: wellness.latest_note || undefined
      })
    : null;

  return (
    <div className="space-y-1">
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-lg ${colorClass} cursor-pointer transition-all hover:scale-[1.02]`}
        onClick={() => setShowDetails(!showDetails)}
      >
        <div className="flex items-center gap-1.5">
          {getStatusIcon(wellness.latest_status)}
          <span className="text-xs font-medium">
            {userFriendlyMessage ? userFriendlyMessage.statusEmoji : ''} {userFriendlyMessage?.title || `Alpha: ${wellness.latest_status}`}
          </span>
        </div>
        <div className="flex-1" />
        {wellness.dollar_pnl !== undefined && (
          <div className="flex items-center gap-1">
            {wellness.dollar_pnl >= 0 ? (
              <TrendingUp className="w-3 h-3 text-green-400" />
            ) : (
              <TrendingDown className="w-3 h-3 text-red-400" />
            )}
            <span className={`text-xs font-semibold ${wellness.dollar_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {wellness.dollar_pnl >= 0 ? '+' : ''}${wellness.dollar_pnl.toFixed(2)}
            </span>
          </div>
        )}
        <span className="text-[10px] opacity-70">{timeText}</span>
      </div>

      {showDetails && (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 text-xs space-y-3">
          {/* User-Friendly Message */}
          {userFriendlyMessage && (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="text-gray-200 leading-relaxed mb-2">
                    {userFriendlyMessage.message}
                  </div>
                  {userFriendlyMessage.priority !== 'routine' && (
                    <div className={`p-2 rounded-lg ${
                      userFriendlyMessage.priority === 'urgent'
                        ? 'bg-red-500/10 border border-red-500/30 text-red-200'
                        : 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-200'
                    }`}>
                      <div className="font-semibold mb-1">
                        {userFriendlyMessage.priority === 'urgent' ? '⚠️ Action Needed' : '💡 Suggestion'}
                      </div>
                      <div className="text-xs opacity-90">
                        {userFriendlyMessage.actionableAdvice}
                      </div>
                    </div>
                  )}
                  {userFriendlyMessage.priority === 'routine' && (
                    <div className="text-gray-400 text-xs">
                      💚 {userFriendlyMessage.actionableAdvice}
                    </div>
                  )}
                </div>
                <div className="text-gray-400 text-xs whitespace-nowrap">
                  {wellness.latest_confidence}% sure
                </div>
              </div>

              {/* Educational Tooltip */}
              {userFriendlyMessage.educationalTooltip && (
                <div className="pt-2 border-t border-gray-700">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      // Toggle tooltip visibility
                      const tooltip = e.currentTarget.nextElementSibling;
                      if (tooltip) {
                        tooltip.classList.toggle('hidden');
                      }
                    }}
                    className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <HelpCircle className="w-3 h-3" />
                    <span className="text-[10px] font-medium">What does this mean?</span>
                  </button>
                  <div className="hidden mt-2 p-2 bg-blue-500/10 border border-blue-500/30 rounded text-[10px] text-blue-100 leading-relaxed">
                    {userFriendlyMessage.educationalTooltip}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Technical Details (fallback if no user-friendly message) */}
          {!userFriendlyMessage && wellness.latest_note && (
            <div>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="font-medium text-gray-200">
                  {wellness.latest_recommendation}
                </div>
                <div className="text-gray-400">
                  {wellness.latest_confidence}% confident
                </div>
              </div>
              <div className="text-gray-400 leading-relaxed">
                {wellness.latest_note}
              </div>
            </div>
          )}

          {/* Stats Footer */}
          <div className="pt-2 border-t border-gray-700 flex items-center justify-between text-[10px] text-gray-500">
            <span>{wellness.total_checks} check{wellness.total_checks !== 1 ? 's' : ''} run</span>
            {wellness.concerning_checks > 0 && (
              <span className="text-orange-400">
                {wellness.concerning_checks} needed attention
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
