import React, { useState, useEffect } from 'react';
import { Lock, AlertTriangle, CreditCard, Clock, CheckCircle, XCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useCreditBalance } from '@/hooks/useCreditBalance';
import { supabase } from '@/lib/supabase';
import { creditValidationService } from '@/services/credit-validation-service';

interface BlockedSessionData {
  sessionId: string;
  creditBlocked: boolean;
  pendingIntentId: string | null;
  pendingMetadata: any;
  symbol?: string;
  targetValue?: number;
  currentProgress?: number;
  createdAt?: string;
}

export function BlockedSessionStatus() {
  const { user } = useAuth();
  const { balance } = useCreditBalance(user?.id || null);
  const [blockedSession, setBlockedSession] = useState<BlockedSessionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryResult, setRetryResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (user?.id) {
      loadBlockedSession();

      const channel = supabase
        .channel('blocked-session-updates')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'goal_sessions',
            filter: `user_id=eq.${user.id}`
          },
          () => {
            loadBlockedSession();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user?.id]);

  const loadBlockedSession = async () => {
    if (!user?.id) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('goal_sessions')
        .select('id, credit_blocked, pending_credit_intent_id, pending_credit_metadata, target_value, cumulative_profit, created_at')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .eq('credit_blocked', true)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const metadata = data.pending_credit_metadata || {};
        setBlockedSession({
          sessionId: data.id,
          creditBlocked: data.credit_blocked,
          pendingIntentId: data.pending_credit_intent_id,
          pendingMetadata: metadata,
          symbol: metadata.symbol,
          targetValue: data.target_value,
          currentProgress: data.cumulative_profit,
          createdAt: data.created_at
        });
      } else {
        setBlockedSession(null);
      }
    } catch (error) {
      console.error('[BlockedSessionStatus] Error loading blocked session:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetry = async () => {
    if (!user?.id || !blockedSession) return;

    setIsRetrying(true);
    setRetryResult(null);

    try {
      const result = await creditValidationService.retryPendingDeduction(
        user.id,
        blockedSession.sessionId
      );

      if (result.success) {
        setRetryResult({
          success: true,
          message: `Successfully deducted credits! Your session is now active. New balance: ${result.newBalance?.toFixed(0) || 0} credits.`
        });
        setTimeout(() => {
          loadBlockedSession();
          setRetryResult(null);
        }, 3000);
      } else {
        setRetryResult({
          success: false,
          message: result.error || 'Failed to retry deduction. Please check your balance and try again.'
        });
      }
    } catch (error) {
      console.error('[BlockedSessionStatus] Error retrying:', error);
      setRetryResult({
        success: false,
        message: 'An unexpected error occurred. Please try again.'
      });
    } finally {
      setIsRetrying(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (isLoading) {
    return (
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6">
        <div className="flex items-center gap-3">
          <div className="animate-spin h-5 w-5 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full" />
          <span className="text-gray-400">Checking session status...</span>
        </div>
      </div>
    );
  }

  if (!blockedSession) {
    return null;
  }

  const signalCost = creditValidationService.getSignalCost();
  const hasEnoughCredits = balance && balance.balance >= signalCost;

  return (
    <div className="relative group animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="absolute -inset-0.5 bg-gradient-to-r from-red-500 to-orange-500 rounded-xl opacity-50 blur animate-pulse" />

      <div className="relative bg-gradient-to-br from-red-900/90 to-orange-900/90 backdrop-blur-xl border-2 border-red-500/50 rounded-xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-red-600/50 to-orange-600/50 px-6 py-4 border-b border-red-500/30">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 bg-red-500 rounded-full blur opacity-50 animate-pulse" />
              <div className="relative w-10 h-10 rounded-full bg-gradient-to-br from-red-600 to-orange-600 flex items-center justify-center shadow-lg">
                <Lock size={20} className="text-white" />
              </div>
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-white">Session Blocked</h2>
              <p className="text-red-200 text-sm">Credit deduction required to continue</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-black/20 backdrop-blur-sm rounded-lg p-4">
              <div className="text-xs text-gray-300 mb-1">Session Started</div>
              <div className="text-lg font-bold text-white flex items-center gap-2">
                <Clock size={18} className="text-blue-400" />
                {blockedSession.createdAt && formatDate(blockedSession.createdAt)}
              </div>
            </div>

            {blockedSession.symbol && (
              <div className="bg-black/20 backdrop-blur-sm rounded-lg p-4">
                <div className="text-xs text-gray-300 mb-1">Pending Signal</div>
                <div className="text-lg font-bold text-white">{blockedSession.symbol}</div>
              </div>
            )}

            <div className="bg-black/20 backdrop-blur-sm rounded-lg p-4">
              <div className="text-xs text-gray-300 mb-1">Current Progress</div>
              <div className={`text-lg font-bold ${
                (blockedSession.currentProgress || 0) >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                ${(blockedSession.currentProgress || 0).toFixed(2)}
              </div>
            </div>

            <div className="bg-black/20 backdrop-blur-sm rounded-lg p-4">
              <div className="text-xs text-gray-300 mb-1">Target Goal</div>
              <div className="text-lg font-bold text-emerald-400">
                ${(blockedSession.targetValue || 0).toFixed(2)}
              </div>
            </div>
          </div>

          <div className="bg-red-800/30 border border-red-500/30 rounded-lg p-4">
            <div className="flex items-start gap-3 mb-3">
              <AlertTriangle size={20} className="text-red-300 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-white font-semibold mb-1">Why is this blocked?</h3>
                <p className="text-red-200 text-sm">
                  A trading signal was detected that requires {signalCost} credits, but the credit deduction failed.
                  Your session is paused until the pending deduction is resolved.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 bg-black/20 rounded-lg">
              <div className="flex-1">
                <div className="text-xs text-gray-300 mb-1">Your Current Balance</div>
                <div className="text-2xl font-bold text-white">
                  {balance?.balance.toFixed(0) || 0} credits
                </div>
              </div>
              <div className="h-10 w-px bg-gray-600"></div>
              <div className="flex-1">
                <div className="text-xs text-gray-300 mb-1">Required</div>
                <div className="text-2xl font-bold text-yellow-400">
                  {signalCost} credits
                </div>
              </div>
              <div className="h-10 w-px bg-gray-600"></div>
              <div className="flex-1">
                <div className="text-xs text-gray-300 mb-1">Status</div>
                <div className={`text-sm font-bold ${hasEnoughCredits ? 'text-green-400' : 'text-red-400'}`}>
                  {hasEnoughCredits ? 'Ready' : 'Insufficient'}
                </div>
              </div>
            </div>
          </div>

          {retryResult && (
            <div className={`p-4 rounded-lg border ${
              retryResult.success
                ? 'bg-green-800/30 border-green-500/30'
                : 'bg-red-800/30 border-red-500/30'
            }`}>
              <div className="flex items-start gap-3">
                {retryResult.success ? (
                  <CheckCircle size={20} className="text-green-400 flex-shrink-0 mt-0.5" />
                ) : (
                  <XCircle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
                )}
                <p className={`text-sm ${
                  retryResult.success ? 'text-green-200' : 'text-red-200'
                }`}>
                  {retryResult.message}
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              onClick={handleRetry}
              disabled={isRetrying || !hasEnoughCredits}
              className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 disabled:from-gray-600 disabled:to-gray-600 text-white font-semibold rounded-lg transition-all shadow-lg hover:shadow-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRetrying ? (
                <>
                  <div className="animate-spin h-5 w-5 border-2 border-white/30 border-t-white rounded-full" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <CheckCircle size={20} />
                  <span>Retry Deduction</span>
                </>
              )}
            </button>

            {!hasEnoughCredits && (
              <a
                href="/credits"
                className="flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold rounded-lg transition-all shadow-lg hover:shadow-blue-500/25"
              >
                <CreditCard size={20} />
                <span>Buy Credits</span>
              </a>
            )}
          </div>

          <p className="text-xs text-gray-300 text-center flex items-center justify-center gap-1">
            <AlertTriangle size={12} />
            Your session will automatically resume once the deduction succeeds
          </p>
        </div>
      </div>
    </div>
  );
}
