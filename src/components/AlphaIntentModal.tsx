/**
 * AlphaIntentModal
 *
 * SSOT Authority: Displays Alpha's advisory intent when a monitoring entry is created.
 * Triggered via goal_notifications type 'entry_monitoring_started'.
 *
 * CCIP COMPLIANCE (2026-02-22):
 * - Advisory only — never blocks or executes trades
 * - Three entry modes mirror the entry_mode field in entry_intents (SSOT: alpha-identity.ts EntryMode)
 * - Execution continues autonomously; this is purely informational
 *
 * Three entry modes (canonical values from EntryMode type):
 *   execute_now       — Trigger confirmed; trade executes immediately
 *   wait_pullback     — Alpha waiting for price to retrace into zone
 *   push_confirmation — Alpha waiting for M5 candle close inside zone
 */

import React from 'react';
import {
  Zap, Clock, TrendingUp, TrendingDown,
  Target, CheckCircle, AlertCircle, X
} from 'lucide-react';

export type AlphaEntryMode = 'execute_now' | 'wait_pullback' | 'push_confirmation';

export interface AlphaIntentModalProps {
  isOpen: boolean;
  symbol: string;
  direction: 'long' | 'short';
  entryMode: AlphaEntryMode;
  pullbackZoneMin?: number | null;
  pullbackZoneMax?: number | null;
  confidence?: number | null;
  setupType?: string | null;
  reasoning?: string | null;
  onDismiss: () => void;
}

const DIRECTION_LABELS: Record<string, string> = {
  long: 'BUY',
  short: 'SELL',
};

function formatPrice(price: number): string {
  if (price >= 100) return price.toFixed(2);
  if (price >= 10) return price.toFixed(3);
  if (price >= 1) return price.toFixed(4);
  return price.toFixed(5);
}

interface ModeConfig {
  badge: string;
  badgeClass: string;
  headerClass: string;
  iconBgClass: string;
  Icon: React.FC<{ className?: string }>;
  title: string;
  borderClass: string;
}

function getModeConfig(entryMode: AlphaEntryMode): ModeConfig {
  switch (entryMode) {
    case 'execute_now':
      return {
        badge: 'EXECUTING NOW',
        badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        headerClass: 'from-emerald-900/40 to-gray-900/60',
        iconBgClass: 'bg-emerald-500/15',
        Icon: Zap,
        title: 'Trade Found',
        borderClass: 'border-emerald-500/30',
      };
    case 'push_confirmation':
      return {
        badge: 'WAIT — ZONE CONFIRMATION',
        badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        headerClass: 'from-amber-900/30 to-gray-900/60',
        iconBgClass: 'bg-amber-500/15',
        Icon: AlertCircle,
        title: 'Trade Found',
        borderClass: 'border-amber-500/30',
      };
    case 'wait_pullback':
    default:
      return {
        badge: 'WAIT — PULLBACK',
        badgeClass: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
        headerClass: 'from-blue-900/30 to-gray-900/60',
        iconBgClass: 'bg-blue-500/15',
        Icon: Clock,
        title: 'Trade Found',
        borderClass: 'border-blue-500/30',
      };
  }
}

export const AlphaIntentModal: React.FC<AlphaIntentModalProps> = ({
  isOpen,
  symbol,
  direction,
  entryMode,
  pullbackZoneMin,
  pullbackZoneMax,
  confidence,
  setupType,
  reasoning,
  onDismiss,
}) => {
  if (!isOpen) return null;

  const config = getModeConfig(entryMode);
  const dirLabel = DIRECTION_LABELS[direction] || direction.toUpperCase();
  const hasPullbackZone = entryMode === 'wait_pullback' && pullbackZoneMin != null && pullbackZoneMax != null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Alpha Intent Advisory"
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onDismiss}
      />

      <div className={`relative w-full max-w-sm rounded-2xl border ${config.borderClass} bg-gray-900 shadow-2xl overflow-hidden`}>
        <div className={`bg-gradient-to-br ${config.headerClass} p-5 pb-4`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${config.iconBgClass}`}>
                <config.Icon className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-bold text-white leading-tight">{config.title}</h2>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${config.badgeClass}`}>
                    {config.badge}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">Alpha Advisory — trade executes automatically</p>
              </div>
            </div>
            <button
              onClick={onDismiss}
              className="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0 mt-0.5"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-5 pb-5 pt-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold border ${
              direction === 'long'
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                : 'bg-red-500/15 text-red-300 border-red-500/30'
            }`}>
              {direction === 'long'
                ? <TrendingUp className="w-3.5 h-3.5" />
                : <TrendingDown className="w-3.5 h-3.5" />
              }
              {dirLabel}
            </div>
            <span className="text-base font-bold text-white">{symbol}</span>
            {confidence != null && (
              <span className={`ml-auto text-sm font-bold ${
                confidence >= 85 ? 'text-emerald-400'
                : confidence >= 70 ? 'text-yellow-400'
                : 'text-blue-400'
              }`}>
                {confidence}% confidence
              </span>
            )}
          </div>

          {entryMode === 'execute_now' && (
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-emerald-900/20 border border-emerald-500/25">
              <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <p className="text-sm text-emerald-200 leading-snug">
                Alpha found a good entry. The trade is being placed now.
              </p>
            </div>
          )}

          {entryMode === 'wait_pullback' && (
            <div className="space-y-2.5">
              <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-blue-900/15 border border-blue-500/25">
                <Clock className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-blue-200 leading-snug">
                  Alpha recommends waiting for a pullback before entering.
                </p>
              </div>

              {hasPullbackZone && (
                <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-800/60 border border-gray-700/50">
                  <div className="flex items-center gap-2">
                    <Target className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs text-gray-400">Pullback zone</span>
                  </div>
                  <span className="text-sm font-bold font-mono text-blue-300">
                    {formatPrice(pullbackZoneMin!)} – {formatPrice(pullbackZoneMax!)}
                  </span>
                </div>
              )}
            </div>
          )}

          {entryMode === 'push_confirmation' && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-amber-900/15 border border-amber-500/25">
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-200 leading-snug">
                Alpha requires price to push into the zone and an M5 candle close inside it to confirm.
              </p>
            </div>
          )}

          {setupType && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Setup:</span>
              <span className="text-xs font-medium text-gray-300 truncate">{setupType}</span>
            </div>
          )}

          {reasoning && (
            <p className="text-xs text-gray-400 leading-relaxed line-clamp-3 border-t border-gray-700/50 pt-3">
              {reasoning}
            </p>
          )}

          <button
            onClick={onDismiss}
            className="w-full mt-1 py-2.5 rounded-lg bg-gray-700/60 hover:bg-gray-700 text-sm font-semibold text-white transition-colors border border-gray-600/40"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
};
