/**
 * Entry Monitor Status Card
 *
 * Real-time UI component showing entry monitoring status.
 * Displays:
 * - Current EQS score and grade
 * - Required threshold
 * - Progress bar
 * - Time remaining
 * - Entry zone status
 *
 * ARCHITECTURE: Uses SSOT hook (useActiveEntryIntent) instead of direct database queries
 */

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useActiveEntryIntent } from '../hooks/useEntryIntent';
import {
  calculateEQSGrade,
  getEQSGradeColor,
  getEQSGradeBgColor,
  getEQSGradeBorderColor,
  calculateEQSProgress,
  formatTimeRemaining,
  getEQSGradeEmoji,
  type EQSGrade
} from '../utils/eqsHelpers';
import { Target, TrendingUp, Clock, MapPin, X } from 'lucide-react';

interface EntryIntent {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  entry_zone_min: number;
  entry_zone_max: number;
  style: string;
  max_wait_seconds: number;
  created_at: string;
  market_context: {
    current_eqs?: number;
    confidence?: number;
    required_eqs?: number;
    current_price?: number;
  };
}

export function EntryMonitorStatusCard() {
  const { user } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [isVisible, setIsVisible] = useState(false);

  const { activeIntent, refresh } = useActiveEntryIntent(sessionId);

  useEffect(() => {
    if (!user?.id) return;

    loadSessionId();
  }, [user?.id]);

  useEffect(() => {
    if (!sessionId) return;

    const channel = supabase
      .channel('entry_intents_monitor')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'entry_intents',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          refresh();
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [sessionId, user?.id, refresh]);

  useEffect(() => {
    if (activeIntent) {
      setIsVisible(true);
    } else {
      setIsVisible(false);
    }
  }, [activeIntent]);

  useEffect(() => {
    if (!activeIntent) return;

    const interval = setInterval(() => {
      const createdAt = new Date(activeIntent.created_at).getTime();
      const now = Date.now();
      const elapsedSeconds = Math.floor((now - createdAt) / 1000);
      const remaining = Math.max(0, activeIntent.max_wait_seconds - elapsedSeconds);
      setTimeRemaining(remaining);

      if (remaining === 0) {
        setIsVisible(false);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [activeIntent]);

  async function loadSessionId() {
    if (!user?.id) return;

    const { data: session } = await supabase
      .from('goal_sessions')
      .select('id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();

    setSessionId(session?.id || null);
  }

  if (!isVisible || !activeIntent) {
    return null;
  }

  const currentEQS = activeIntent.market_context?.current_eqs || 0;
  const requiredEQS = activeIntent.market_context?.required_eqs || 65;
  const confidence = activeIntent.market_context?.confidence || 70;
  const currentPrice = activeIntent.market_context?.current_price || 0;

  const currentGrade = calculateEQSGrade(currentEQS);
  const requiredGrade = calculateEQSGrade(requiredEQS);
  const progress = calculateEQSProgress(currentEQS, requiredEQS);

  const inEntryZone = currentPrice >= activeIntent.entry_zone_min &&
                      currentPrice <= activeIntent.entry_zone_max;

  const gap = Math.max(0, requiredEQS - currentEQS);

  return (
    <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-4 md:w-96 z-40 animate-slide-up">
      <div
        className={`bg-gray-900/95 backdrop-blur-sm rounded-lg border-2 ${getEQSGradeBorderColor(currentGrade)} shadow-2xl`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-400" />
            <span className="font-semibold text-white">Entry Monitor Active</span>
          </div>
          <button
            onClick={() => setIsVisible(false)}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          {/* Symbol and Direction */}
          <div className="flex items-center justify-between">
            <div>
              <span className="text-white font-bold text-lg">{activeIntent.symbol}</span>
              <span className={`ml-2 px-2 py-1 rounded text-xs font-semibold ${
                activeIntent.direction === 'long'
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-red-500/20 text-red-400'
              }`}>
                {activeIntent.direction === 'long' ? 'BUY' : 'SELL'}
              </span>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-400">Confidence</div>
              <div className="text-white font-semibold">{confidence}%</div>
            </div>
          </div>

          {/* EQS Score Display */}
          <div className={`${getEQSGradeBgColor(currentGrade)} rounded-lg p-3 border ${getEQSGradeBorderColor(currentGrade)}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <TrendingUp className={`w-4 h-4 ${getEQSGradeColor(currentGrade)}`} />
                <span className="text-sm text-gray-300">Entry Quality Score</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xl">{getEQSGradeEmoji(currentGrade)}</span>
                <span className={`text-2xl font-bold ${getEQSGradeColor(currentGrade)}`}>
                  {currentGrade}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-gray-400">Current</span>
              <span className={`font-semibold ${getEQSGradeColor(currentGrade)}`}>
                {Math.round(currentEQS)}/100
              </span>
            </div>

            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-gray-400">Required</span>
              <span className="text-gray-300 font-semibold">
                {requiredGrade} ({requiredEQS}/100)
              </span>
            </div>

            {gap > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Gap</span>
                <span className="text-yellow-400 font-semibold">
                  {gap} points
                </span>
              </div>
            )}

            {/* Progress Bar */}
            <div className="mt-3 bg-gray-800 rounded-full h-2 overflow-hidden">
              <div
                className={`h-full ${
                  progress >= 100
                    ? 'bg-green-500'
                    : progress >= 80
                      ? 'bg-blue-500'
                      : 'bg-yellow-500'
                } transition-all duration-500`}
                style={{ width: `${Math.min(100, progress)}%` }}
              />
            </div>
          </div>

          {/* Entry Zone Status */}
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <MapPin className={`w-4 h-4 ${inEntryZone ? 'text-green-400' : 'text-gray-400'}`} />
              <span className="text-gray-400">Entry Zone</span>
            </div>
            <span className={`font-semibold ${inEntryZone ? 'text-green-400' : 'text-gray-400'}`}>
              {inEntryZone ? '✓ In Zone' : '⏳ Waiting'}
            </span>
          </div>

          {/* Time Remaining */}
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-400" />
              <span className="text-gray-400">Time Remaining</span>
            </div>
            <span className={`font-semibold ${
              timeRemaining < 60 ? 'text-red-400' : 'text-gray-300'
            }`}>
              {formatTimeRemaining(timeRemaining)}
            </span>
          </div>

          {/* Status Message */}
          <div className="text-xs text-gray-400 text-center pt-2 border-t border-gray-800">
            {currentEQS >= requiredEQS
              ? '✅ Ready to execute when price enters zone'
              : gap <= 10
                ? `⏳ Almost there! ${gap} points away...`
                : '🔍 Monitoring for optimal entry conditions...'}
          </div>
        </div>
      </div>
    </div>
  );
}
