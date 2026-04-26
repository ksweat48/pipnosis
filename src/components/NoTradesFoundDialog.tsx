import React, { useState, useEffect, useRef } from 'react';
import { Search, XCircle, AlertTriangle, Info, ArrowRight, Clock, ChevronDown, ChevronUp, TrendingDown, Brain, TrendingUp, Minus, ShieldAlert, Eye } from 'lucide-react';
import type { NoTradeRejectionContext } from '../services/goal-session-live-engine';

interface NoTradesFoundDialogProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  isLoading?: boolean;
  rejectionContext?: NoTradeRejectionContext | null;
}

export const NoTradesFoundDialog: React.FC<NoTradesFoundDialogProps> = ({
  isOpen,
  onClose,
  isLoading = false,
  rejectionContext
}) => {
  const [countdown, setCountdown] = useState(60);
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasAutoClosedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      setCountdown(60);
      setExpandedSymbol(null);
      hasAutoClosedRef.current = false;
      return;
    }
    // Auto-expand the single symbol when there is exactly one reason — single-pair sessions
    const reasons = rejectionContext?.symbolReasons || [];
    if (reasons.length === 1) {
      setExpandedSymbol(reasons[0].symbol);
    }

    intervalRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isOpen]);

  useEffect(() => {
    if (countdown === 0 && isOpen && !hasAutoClosedRef.current) {
      hasAutoClosedRef.current = true;
      onClose();
    }
  }, [countdown, isOpen, onClose]);

  if (!isOpen) return null;

  const hasConstraintSandwich = rejectionContext?.constraintSandwichSymbols &&
    rejectionContext.constraintSandwichSymbols.length > 0;
  const suggestedStyles = rejectionContext?.suggestedStyles || [];
  const symbolReasons = rejectionContext?.symbolReasons || [];
  const summary = rejectionContext?.summary || 'Alpha scanned all pairs and found no qualifying setups this cycle.';

  const handleCloseClick = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    onClose();
  };

  const isSystemBlock = (decisionOrigin?: string): boolean => {
    if (!decisionOrigin) return false;
    return (
      decisionOrigin.startsWith('SYSTEM_') ||
      decisionOrigin.startsWith('ENGINE_') ||
      decisionOrigin.startsWith('ALPHA_BLOCKED_')
    );
  };

  const getSystemBlockLabel = (decisionOrigin: string, alphaOriginalAction?: string) => {
    const originLabels: Record<string, string> = {
      SYSTEM_DEGENERATE: 'LLM returned empty output',
      SYSTEM_TRUNCATED: 'Response was cut off (token limit)',
      SYSTEM_PARSE_FAILURE: 'Response could not be parsed',
      SYSTEM_NETWORK_FAILURE: 'Network / infrastructure error',
      SYSTEM_DATA_MISSING: 'Candle data unavailable',
      SYSTEM_PAIR_NOT_READY: 'Pair not ready',
      SYSTEM_FRESHNESS_BLOCK: 'Price data was stale',
      ALPHA_BLOCKED_GEOMETRY: 'Alpha found a trade — geometry blocked it',
      ALPHA_BLOCKED_COMPLIANCE: 'Alpha found a trade — missing required field',
      ALPHA_BLOCKED_SURVIVAL: 'Alpha found a trade — risk physics blocked it',
      ENGINE_RISK_BLOCKED: 'Risk manager blocked execution',
      ENGINE_FEASIBILITY_BLOCKED: 'Goal feasibility blocked execution',
      ENGINE_CAPACITY_BLOCKED: 'Concurrent trade limit reached',
    };
    const label = originLabels[decisionOrigin] ?? decisionOrigin;
    const wasAlphaCall =
      alphaOriginalAction &&
      (decisionOrigin.startsWith('ALPHA_BLOCKED_') || decisionOrigin.startsWith('ENGINE_'));
    const isPairNotReady = decisionOrigin === 'SYSTEM_PAIR_NOT_READY';
    return {
      state: 'NO_TRADE_SYSTEM_BLOCK' as const,
      text: label,
      expandedText: isPairNotReady
        ? 'Pre-scan readiness check found no structural phase or setup material. Alpha was not called — there was nothing to evaluate.'
        : wasAlphaCall
        ? `Alpha actually wanted to ${alphaOriginalAction} — but the system blocked execution. Reason: ${label}. This is NOT Alpha's trading judgment.`
        : `This is a system failure, not Alpha's trading judgment. Reason: ${label}.`,
      dotClass: 'bg-red-400',
      badgeClass: 'bg-red-900/40 text-red-300',
      chipClass: 'text-red-400 bg-red-900/30 border-red-700/40',
      Icon: ShieldAlert,
      iconClass: 'text-red-400',
    };
  };

  /**
   * CCIP-2026-0415 / CCIP-2026-0410A / CCIP-2026-0327C: Confidence label for Alpha's no-trade scan decisions.
   *
   * LANGUAGE RULE (SSOT — this comment is the authority):
   * - Alpha's confidence is always reported honestly, no qualifier based on threshold.
   * - BLOCKED_BY_FLOOR is permanently retired. Alpha executes any BUY/SELL he calls.
   *
   * State A — NO_TRADE_SYSTEM_BLOCK: A system failure or compliance block prevented execution.
   *   Shown in red — this is NOT Alpha's judgment.
   *
   * State B — NO_TRADE_LEAN: Alpha said NO_TRADE with a directional lean.
   *   Alpha reports his lean confidence.
   *
   * State C — NO_TRADE_GENUINE: Alpha saw no profitable structural edge.
   *   Alpha states plainly why he found no trade.
   *
   * SSOT: decision_origin is the authoritative field (execution_status is secondary).
   */
  const getDecisionLabel = (
    confidence: number,
    action: string,
    executionStatus?: string,
    directionalLean?: string,
    leanConfidence?: number,
    decisionOrigin?: string,
    alphaOriginalAction?: string,
    confidenceTier?: string,
  ) => {
    if (isSystemBlock(decisionOrigin)) {
      return getSystemBlockLabel(decisionOrigin!, alphaOriginalAction);
    }

    if (confidence === 0 && !decisionOrigin && !confidenceTier) return null;

    // Format: "Confident — 60%" or just "60%" if tier not available
    const tierDisplayNames: Record<string, string> = {
      extremely_confident: 'Extremely Confident',
      very_confident:      'Very Confident',
      confident:           'Confident',
      no_read:             'No Read',
      // Legacy tiers for historical display
      extreme:   'Extreme',
      very_high: 'Very High',
      high:      'High',
      moderate:  'Moderate',
      cautious:  'Cautious',
      low:       'Low',
    };
    const tierLabel = confidenceTier ? (tierDisplayNames[confidenceTier] ?? confidenceTier) : null;
    const confidenceLabel = tierLabel
      ? `${tierLabel} — ${confidence}%`
      : `${confidence}%`;

    // NO_TRADE_LEAN: Alpha had a directional lean but found insufficient structure to execute.
    if (executionStatus === 'NO_TRADE_LEAN' || (action === 'NO_TRADE' && directionalLean && directionalLean !== 'NEUTRAL')) {
      const lean = directionalLean || 'NEUTRAL';
      const leanStr = lean === 'BUY_LEAN' ? 'bullish' : lean === 'SELL_LEAN' ? 'bearish' : 'uncertain';
      const leanIcon = lean === 'BUY_LEAN' ? TrendingUp : lean === 'SELL_LEAN' ? TrendingDown : Minus;
      return {
        state: 'NO_TRADE_LEAN' as const,
        text: `${confidenceLabel}. ${leanStr} lean. No trade.`,
        expandedText: `Alpha's conviction: ${confidenceLabel}. ${leanStr.charAt(0).toUpperCase() + leanStr.slice(1)} lean${leanConfidence ? ` at ${leanConfidence}% directional conviction` : ''} — insufficient structure to act. Waiting for next cycle.`,
        dotClass: 'bg-yellow-400',
        badgeClass: 'bg-yellow-900/40 text-yellow-300',
        chipClass: 'text-yellow-400 bg-yellow-900/30 border-yellow-700/40',
        Icon: leanIcon,
        iconClass: 'text-yellow-400',
      };
    }

    // NO_TRADE_GENUINE: Alpha searched and found no profitable structural edge.
    if (action === 'NO_TRADE') {
      const chipText = confidence > 0 || confidenceTier
        ? `${confidenceLabel}. No structural edge found. No trade.`
        : `No structural edge found. No trade.`;
      const expandedText = `Alpha searched all instruments. No qualifying structure, directional edge, or viable path to target found this cycle.${confidence > 0 || confidenceTier ? ` Conviction: ${confidenceLabel}.` : ''} Waiting for next cycle.`;
      return {
        state: 'NO_TRADE_GENUINE' as const,
        text: chipText,
        expandedText,
        dotClass: 'bg-gray-400',
        badgeClass: 'bg-gray-700/60 text-gray-300',
        chipClass: 'text-gray-400 bg-gray-800/60 border-gray-600/40',
        Icon: Minus,
        iconClass: 'text-gray-400',
      };
    }

    // EXECUTED — should not appear in no-trade dialog but handle gracefully
    return null;
  };

  const formatStyleName = (style: string): string => {
    switch (style) {
      case 'MICRO_INTRADAY': return 'Micro Intraday';
      case 'INTRADAY': return 'Intraday';
      case 'SCALP': return 'Scalp';
      default: return style;
    }
  };

  const progressPercent = (countdown / 60) * 100;

  // CCIP-2026-0427B: Detect suppressed wait intents (Entry Monitor was off).
  const waitIntentSymbols = symbolReasons.filter(r => r.wait_intent_available_for_monitor_off);
  const hasWaitIntentBanner = waitIntentSymbols.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      style={{
        paddingTop: 'max(5rem, env(safe-area-inset-top))',
        paddingBottom: 'max(6rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))',
        alignItems: 'center',
      }}
    >
      <div className="relative max-w-lg w-full flex flex-col" style={{ maxHeight: 'calc(100dvh - 11rem)' }}>
        <div className="absolute -inset-1 bg-gradient-to-r from-amber-500/20 to-orange-500/20 rounded-2xl blur" />

        <div className="relative bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100dvh - 11rem)' }}>
          <div className="flex-1 overflow-y-auto p-6" style={{ WebkitOverflowScrolling: 'touch', minHeight: 0 }}>
            <div className="flex items-start gap-4 mb-5">
              <div className="p-3 rounded-xl bg-gradient-to-br from-amber-600 to-orange-600 shrink-0">
                <Search className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-white mb-1">
                  No Trades Found
                </h3>
                <p className="text-sm text-gray-400">
                  Full scan complete - no qualifying setups
                </p>
              </div>
            </div>

            {/* CCIP-2026-0427B: Monitor-off wait-intent notice */}
            {hasWaitIntentBanner && (
              <div className="bg-sky-900/20 border border-sky-600/40 rounded-xl p-4 mb-4">
                <div className="flex items-start gap-3">
                  <div className="p-1.5 rounded-lg bg-sky-700/30 shrink-0 mt-0.5">
                    <Eye className="w-4 h-4 text-sky-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sky-200 font-semibold text-sm mb-1">
                      Wait Entry Found — Entry Monitor Required
                    </p>
                    <p className="text-sky-300/80 text-xs leading-relaxed">
                      A wait entry was found — activate Entry Monitor to access wait options, or try again shortly for execute-now trades.
                    </p>
                    {waitIntentSymbols.some(r => r.wait_intent_metadata?.entry_zone_min) && (
                      <div className="mt-2 space-y-1">
                        {waitIntentSymbols.filter(r => r.wait_intent_metadata?.entry_zone_min).map(r => (
                          <p key={r.symbol} className="text-xs text-sky-400/70 font-mono">
                            {r.symbol}
                            {r.wait_intent_metadata!.original_entry_mode === 'wait_pullback' ? ' — Pullback Zone' : ' — Push Confirmation'}
                            {r.wait_intent_metadata!.entry_zone_min && r.wait_intent_metadata!.entry_zone_max
                              ? `: ${r.wait_intent_metadata!.entry_zone_min} – ${r.wait_intent_metadata!.entry_zone_max}`
                              : ''}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {hasConstraintSandwich ? (
              <div className="space-y-4 mb-6">
                <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl p-4">
                  <div className="flex items-start gap-3 mb-3">
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-amber-200 font-semibold text-sm mb-1">
                        Style Incompatibility Detected
                      </p>
                      {rejectionContext!.constraintSandwichSymbols.map(({ symbol, noiseFloor, slMax }) => (
                        <p key={symbol} className="text-gray-300 text-sm mb-1">
                          Your {formatStyleName(rejectionContext!.currentStyle)} style is not compatible
                          with {symbol}
                          {noiseFloor > 0 && slMax > 0
                            ? ` -- the minimum safe stop distance (${Math.round(noiseFloor)} pips) exceeds ${formatStyleName(rejectionContext!.currentStyle)}'s maximum (${Math.round(slMax)} pips).`
                            : '.'}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>

                {suggestedStyles.length > 0 && (
                  <div className="bg-gray-700/30 border border-gray-600/40 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <Info className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-gray-200 text-sm">
                          Consider starting a new session with{' '}
                          <span className="text-sky-300 font-medium">
                            {suggestedStyles.map(formatStyleName).join(' or ')}
                          </span>
                          {' '}style. These styles support the wider stop distances
                          that {rejectionContext!.constraintSandwichSymbols.map(s => s.symbol).join(', ')} requires.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-gray-700/30 border border-gray-600/40 rounded-xl p-4 mb-6">
                <p className="text-gray-300 text-sm leading-relaxed">
                  {summary}
                </p>
                {suggestedStyles.length > 0 && (
                  <div className="flex items-start gap-3 mt-3 pt-3 border-t border-gray-600/30">
                    <ArrowRight className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                    <p className="text-gray-300 text-sm">
                      A wider timeframe style ({suggestedStyles.map(formatStyleName).join(' or ')}) may find better setups in current market conditions.
                    </p>
                  </div>
                )}
              </div>
            )}

            {symbolReasons.length > 0 && (
              <div className="mb-5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Alpha's Assessment — Per Symbol
                </p>
                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1 scrollbar-thin">
                  {symbolReasons.map(({ symbol, action, reasoning, confidence, execution_status, directional_lean, lean_confidence, decision_origin, alpha_original_action, confidence_tier }) => {
                    const isExpanded = expandedSymbol === symbol;
                    const label = getDecisionLabel(confidence, action, execution_status, directional_lean, lean_confidence, decision_origin, alpha_original_action, confidence_tier);
                    const dotClass = label?.dotClass ?? 'bg-gray-500';
                    const badgeClass = label?.badgeClass ?? 'bg-gray-700/60 text-gray-300';
                    return (
                      <div
                        key={symbol}
                        className="bg-gray-800/60 border border-gray-700/50 rounded-lg overflow-hidden"
                      >
                        <button
                          onClick={() => setExpandedSymbol(isExpanded ? null : symbol)}
                          className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-700/40 transition-colors"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
                            <span className="text-sm font-semibold text-gray-200">{symbol}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${badgeClass}`}>
                              {action}
                            </span>
                            {label && (
                              <span
                                className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border ${label.chipClass}`}
                              >
                                <label.Icon className={`w-3 h-3 ${label.iconClass}`} />
                                {label.text}
                              </span>
                            )}
                          </div>
                          {isExpanded
                            ? <ChevronUp className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                            : <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                          }
                        </button>
                        {isExpanded && (
                          <div className="px-3 pb-3 pt-1 border-t border-gray-700/40">
                            {label && (
                              <p className={`text-xs italic mb-1.5 ${label.iconClass}`}>
                                {label.expandedText}
                              </p>
                            )}
                            <p className="text-xs text-gray-300 leading-relaxed">{reasoning}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>

          <div className="flex-shrink-0 px-6 pb-6 pt-4 border-t border-gray-700/50">
            <div className="mb-4 bg-gray-800/60 rounded-xl px-4 py-3 border border-gray-700/50">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2 text-gray-400 text-xs">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Auto-closing session in</span>
                </div>
                <span
                  className={`font-mono font-bold tabular-nums transition-colors ${
                    countdown <= 10
                      ? 'text-red-400 text-lg'
                      : countdown <= 20
                      ? 'text-orange-400 text-base'
                      : 'text-amber-300 text-base'
                  }`}
                >
                  {countdown}s
                </span>
              </div>
              <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ease-linear ${
                    countdown <= 10
                      ? 'bg-gradient-to-r from-red-500 to-red-400'
                      : countdown <= 20
                      ? 'bg-gradient-to-r from-orange-500 to-amber-400'
                      : 'bg-gradient-to-r from-amber-500 to-orange-500'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            <button
              onClick={handleCloseClick}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-4 bg-gradient-to-r from-gray-600 to-gray-700 hover:from-gray-500 hover:to-gray-600 disabled:from-gray-800 disabled:to-gray-800 disabled:cursor-not-allowed rounded-xl text-white font-semibold transition-all duration-300 shadow-lg hover:shadow-gray-500/15 hover:scale-[1.01] active:scale-[0.99]"
            >
              <XCircle className="w-5 h-5" />
              <span>Close Session Now</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
