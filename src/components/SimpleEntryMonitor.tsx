/**
 * Simple Entry Monitor Component - CCIP Compliant
 *
 * Simplified entry monitoring UI:
 * - Shows entry zone range and current price
 * - Displays distance to entry zone in pips
 * - Shows "Enter Trade Now" button for manual execution
 * - Auto-executes when price enters zone (no quality checks)
 * - No timeout or expiration (intents stay active until user action)
 */

import React, { useState, useEffect } from 'react';
import { Target, MapPin, ArrowUp, ArrowDown, Minus, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useActiveEntryIntent } from '../hooks/useEntryIntent';
import { EntryExecutionCoordinator } from '../services/entry-execution-coordinator';
import { globalToastManager } from '../services/global-toast-manager';
import { logger } from '../lib/logger';
import { getCurrencyPipInfo } from '../utils/currencyHelpers';
import { ScanResultsCard } from './ScanResultsCard';

interface SimpleEntryMonitorProps {
  sessionId: string;
  intentId?: string;
}

export const SimpleEntryMonitor: React.FC<SimpleEntryMonitorProps> = ({ sessionId }) => {
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [previousPrice, setPreviousPrice] = useState<number | null>(null);
  const [executing, setExecuting] = useState(false);
  const [eqsScore, setEqsScore] = useState<number | null>(null);
  const [eqsThreshold, setEqsThreshold] = useState<number | null>(null);

  const { activeIntent, loading: intentLoading } = useActiveEntryIntent(sessionId);

  // Poll for current price and EQS data
  useEffect(() => {
    if (!activeIntent) return;

    const fetchData = async () => {
      try {
        // Fetch current price
        const { data: priceData, error: priceError } = await supabase
          .from('realtime_prices')
          .select('mid')
          .eq('symbol', activeIntent.symbol)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (priceData && !priceError) {
          setPreviousPrice(currentPrice);
          setCurrentPrice(priceData.mid);
        }

        // Fetch latest EQS score from monitoring logs
        const { data: eqsData, error: eqsError } = await supabase
          .from('entry_monitoring_logs')
          .select('eqs_score, eqs_threshold')
          .eq('intent_id', activeIntent.id)
          .order('timestamp', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (eqsData && !eqsError) {
          setEqsScore(eqsData.eqs_score);
          setEqsThreshold(eqsData.eqs_threshold);
        }
      } catch (error) {
        console.error('[SimpleEntryMonitor] Error fetching data:', error);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 2000); // Update every 2 seconds

    return () => clearInterval(interval);
  }, [activeIntent, currentPrice]);

  const handleManualEntry = async () => {
    if (!activeIntent || executing) return;

    try {
      setExecuting(true);
      logger.info(`[SimpleEntryMonitor] User clicked manual entry for ${activeIntent.symbol}`);

      const result = await EntryExecutionCoordinator.executeManualEntry(activeIntent.id);

      if (result.success) {
        globalToastManager.showToast(
          'success',
          'Trade Executed',
          `Trade executed for ${activeIntent.symbol} at market price`
        );
      } else {
        globalToastManager.showToast(
          'error',
          'Trade Failed',
          `Failed to execute trade: ${result.error || 'Unknown error'}`
        );
      }
    } catch (error) {
      logger.error('[SimpleEntryMonitor] Manual entry error:', error);
      globalToastManager.showToast(
        'error',
        'Execution Error',
        `Error executing trade: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setExecuting(false);
    }
  };

  // Hide entry monitor completely when no active intent
  if (intentLoading || !activeIntent) {
    return null;
  }

  // Calculate entry zone metrics
  const inZone = currentPrice
    ? currentPrice >= activeIntent.entry_zone_min && currentPrice <= activeIntent.entry_zone_max
    : false;

  // Get correct pip multiplier for the symbol (e.g., 10000 for forex, 1 for XAUUSD)
  const pipInfo = getCurrencyPipInfo(activeIntent.symbol);
  const distancePips = !inZone && currentPrice
    ? (currentPrice < activeIntent.entry_zone_min
        ? activeIntent.entry_zone_min - currentPrice
        : currentPrice - activeIntent.entry_zone_max) * pipInfo.pipMultiplier
    : 0;

  const getPriceDirectionIcon = () => {
    if (!currentPrice || !previousPrice) return <Minus className="w-3 h-3 text-gray-400" />;
    if (currentPrice > previousPrice) return <ArrowUp className="w-3 h-3 text-green-400" />;
    if (currentPrice < previousPrice) return <ArrowDown className="w-3 h-3 text-red-400" />;
    return <Minus className="w-3 h-3 text-gray-400" />;
  };

  return (
    <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-lg p-3 sm:p-4 border border-gray-700">
      {/* ADVISORY NOTICE */}
      <div className="mb-3 p-2 rounded-lg bg-blue-900/20 border border-blue-600/30">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-blue-300">
            <span className="font-semibold">Advisory Only:</span> This monitor shows optimal entry timing for manual trades on external platforms. Alpha executes immediately at market price when ready.
          </div>
        </div>
      </div>

      {/* HEADER: Symbol, Direction */}
      <div className="mb-3 sm:mb-4 pb-2 sm:pb-3 border-b border-gray-700">
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
              <h2 className="text-xl sm:text-2xl font-bold text-white">{activeIntent.symbol}</h2>
              <span className={`px-1.5 sm:px-2 py-0.5 sm:py-1 rounded text-xs sm:text-sm font-bold ${
                activeIntent.direction === 'long'
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-red-500/20 text-red-400 border border-red-500/30'
              }`}>
                {activeIntent.direction === 'long' ? 'BUY' : 'SELL'}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-xs text-gray-400">
              <Target className="w-3 h-3 text-blue-400 animate-pulse" />
              <span className="text-blue-400">Entry Zone Advisory (Visual Only)</span>
            </div>
          </div>
        </div>
      </div>

      {/* STATUS DISPLAY */}
      <div className={`mb-3 sm:mb-4 p-2 sm:p-3 rounded-lg border ${
        inZone
          ? 'bg-green-900/30 border-green-600/50'
          : 'bg-blue-900/30 border-blue-600/50'
      }`}>
        <div className="flex items-start gap-2 sm:gap-3">
          {inZone ? (
            <Target className="w-5 h-5 sm:w-6 sm:h-6 text-green-400 mt-0.5 flex-shrink-0 animate-pulse" />
          ) : (
            <MapPin className="w-5 h-5 sm:w-6 sm:h-6 text-blue-400 mt-0.5 flex-shrink-0" />
          )}
          <div className="flex-1">
            <div className={`font-bold mb-1 text-sm sm:text-base ${
              inZone ? 'text-green-300' : 'text-blue-300'
            }`}>
              {inZone ? 'IN ENTRY ZONE - Monitoring for execution...' : 'Waiting for Entry Zone'}
            </div>
            <div className="text-xs sm:text-sm text-gray-300">
              {inZone
                ? 'Price is in entry zone. System is evaluating entry quality and timing for optimal execution.'
                : `Price needs to ${activeIntent.direction === 'long' ? 'pull back' : 'rally'} ${distancePips.toFixed(2)} pips to reach entry zone.`
              }
            </div>
          </div>
        </div>
      </div>

      {/* Note: Time-based urgency phases removed - using confidence-based static thresholds */}

      {/* EQS (ENTRY QUALITY SCORE) METER */}
      {eqsScore !== null && eqsThreshold !== null && (
        <div className="mb-3 sm:mb-4 p-3 sm:p-4 rounded-lg border-2 bg-gradient-to-br from-purple-900/20 to-blue-900/20 border-purple-600/50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-semibold text-gray-300">Entry Quality Score</span>
            </div>
            <span className={`px-2 py-1 rounded text-xs font-bold ${
              eqsScore >= eqsThreshold
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
            }`}>
              {eqsScore >= eqsThreshold ? 'READY' : 'WAITING'}
            </span>
          </div>

          {/* Progress Bar */}
          <div className="mb-2">
            <div className="flex items-baseline justify-between mb-1">
              <span className={`text-2xl font-bold font-mono ${
                eqsScore >= eqsThreshold ? 'text-green-400' : 'text-yellow-400'
              }`}>
                {eqsScore}
              </span>
              <span className="text-sm text-gray-400">
                / {eqsThreshold} required
              </span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  eqsScore >= eqsThreshold
                    ? 'bg-gradient-to-r from-green-500 to-emerald-400'
                    : 'bg-gradient-to-r from-yellow-500 to-orange-400'
                }`}
                style={{ width: `${Math.min(100, (eqsScore / eqsThreshold) * 100)}%` }}
              />
            </div>
          </div>

          {/* Explanation */}
          <div className="text-xs text-gray-300 space-y-1">
            {eqsScore >= eqsThreshold ? (
              <div className="flex items-start gap-1.5">
                <span className="text-green-400">✓</span>
                <span>Quality score meets threshold. Trade will auto-execute when conditions are met.</span>
              </div>
            ) : (
              <>
                <div className="flex items-start gap-1.5">
                  <span className="text-yellow-400">⏳</span>
                  <span>Waiting for quality score to improve. Need +{eqsThreshold - eqsScore} points.</span>
                </div>
                <div className="text-gray-400 ml-4">
                  • Score improves with time (phase progression)
                  • Better zone proximity increases score
                  • Click "Enter Trade Now" to override and execute immediately
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* PRICE ZONE STATUS */}
      {currentPrice && (
        <div className={`mb-3 sm:mb-4 p-3 sm:p-4 rounded-lg border-2 ${
          inZone
            ? 'bg-green-900/20 border-green-600 shadow-lg shadow-green-500/20'
            : 'bg-gray-900/20 border-gray-600'
        }`}>
          <div className="flex items-center justify-between mb-2 sm:mb-3">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <MapPin className={`w-4 h-4 sm:w-5 sm:h-5 ${inZone ? 'text-green-400 animate-pulse' : 'text-gray-400'}`} />
              <span className="text-xs sm:text-sm font-semibold text-gray-300">Price Zone</span>
            </div>
            <span className={`px-2 sm:px-3 py-0.5 sm:py-1 rounded-lg text-xs sm:text-sm font-bold ${
              inZone
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
            }`}>
              {inZone ? 'IN ZONE' : 'OUTSIDE'}
            </span>
          </div>

          <div className="space-y-1.5 sm:space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Current Price</span>
              <div className="flex items-center gap-1.5 sm:gap-2">
                {getPriceDirectionIcon()}
                <span className={`text-base sm:text-lg font-mono font-bold ${
                  inZone ? 'text-green-400' : 'text-blue-400'
                }`}>
                  {currentPrice.toFixed(5)}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Entry Zone</span>
              <span className="text-xs sm:text-sm font-mono text-gray-300">
                {activeIntent.entry_zone_min.toFixed(5)} - {activeIntent.entry_zone_max.toFixed(5)}
              </span>
            </div>

            {!inZone && (
              <div className="mt-1.5 sm:mt-2 pt-1.5 sm:pt-2 border-t border-gray-700">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    {activeIntent.direction === 'long' ? 'Need pullback' : 'Need rally'}
                  </span>
                  <span className="text-sm sm:text-base font-mono font-bold text-orange-400">
                    {distancePips.toFixed(2)} pips
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MANUAL ENTRY BUTTON */}
      <div className="mt-3 sm:mt-4">
        <button
          onClick={handleManualEntry}
          disabled={executing}
          className={`w-full py-3 sm:py-4 rounded-lg font-bold text-sm sm:text-base transition-all ${
            executing
              ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
              : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg hover:shadow-xl'
          }`}
        >
          {executing ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              Executing...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              {activeIntent.direction === 'long' ? (
                <TrendingUp className="w-5 h-5" />
              ) : (
                <TrendingDown className="w-5 h-5" />
              )}
              Enter Trade Now at Market Price
            </span>
          )}
        </button>
        <div className="mt-2 text-xs text-center text-gray-400">
          Click to execute trade immediately at current market price
        </div>
      </div>
    </div>
  );
};
