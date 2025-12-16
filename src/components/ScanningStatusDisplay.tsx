/**
 * Scanning Status Display Component
 *
 * Shows real-time scanning cycle status with countdown timers:
 * - Active: Green pulse - scanning every 5 minutes
 * - Cooldown: Yellow clock - 15-minute break
 * - Lockdown: Red lock - 12-hour pause
 *
 * Displays:
 * - Current state
 * - Session number (1/2 or 2/2)
 * - Scans remaining in current session
 * - Countdown to next state change
 * - Next scan time (if active)
 */

import { useEffect, useState } from 'react';
import { Clock, Lock, Activity, AlertTriangle } from 'lucide-react';
import { scanningStateMachine, SessionStatus } from '../services/scanning-state-machine';

interface ScanningStat usDisplayProps {
  sessionId: string;
  isAdmin?: boolean;
}

export function ScanningStatusDisplay({ sessionId, isAdmin = false }: ScanningStatusDisplayProps) {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [countdown, setCountdown] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Load initial status
  useEffect(() => {
    const loadStatus = async () => {
      const sessionStatus = await scanningStateMachine.getSessionStatus(sessionId);
      setStatus(sessionStatus);
      setCountdown(sessionStatus?.secondsUntilStateChange || 0);
      setLoading(false);
    };

    loadStatus();
  }, [sessionId]);

  // Subscribe to status changes
  useEffect(() => {
    const unsubscribe = scanningStateMachine.subscribeToSessionStatus(sessionId, (updatedStatus) => {
      setStatus(updatedStatus);
      setCountdown(updatedStatus?.secondsUntilStateChange || 0);
    });

    return unsubscribe;
  }, [sessionId]);

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return;

    const interval = setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [countdown]);

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 animate-pulse">
        <div className="h-6 bg-gray-700 rounded w-1/2 mb-2"></div>
        <div className="h-4 bg-gray-700 rounded w-3/4"></div>
      </div>
    );
  }

  if (!status) {
    return null;
  }

  // Admin bypass indicator
  if (status.unlimitedScanning) {
    return (
      <div className="bg-gradient-to-r from-purple-900/50 to-indigo-900/50 border border-purple-500/30 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Activity className="w-5 h-5 text-purple-400" />
          <span className="text-purple-300 font-semibold">Admin Mode - Unlimited Scanning</span>
        </div>
        <p className="text-sm text-purple-200">All scanning limits bypassed</p>
      </div>
    );
  }

  // Get status details
  const statusMessage = scanningStateMachine.getStatusMessage(status);
  const countdownFormatted = scanningStateMachine.formatCountdown(countdown);

  // Render based on state
  switch (status.scanningCycleStatus) {
    case 'active':
      return (
        <div className="bg-gradient-to-r from-green-900/30 to-emerald-900/30 border border-green-500/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Activity className="w-5 h-5 text-green-400 animate-pulse" />
                <div className="absolute inset-0 bg-green-400 rounded-full opacity-25 animate-ping"></div>
              </div>
              <span className="text-green-300 font-semibold">Active Scanning</span>
            </div>
            <div className="text-sm text-green-200 bg-green-900/30 px-3 py-1 rounded-full">
              Session {status.scanningSessionNumber}/2
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-green-100">
              <span>Scans completed:</span>
              <span className="font-mono">{status.scansInCurrentSession}/{status.maxScansPerSession}</span>
            </div>
            <div className="flex justify-between text-green-100">
              <span>Scans remaining:</span>
              <span className="font-mono font-semibold">{status.scansRemainingInSession}</span>
            </div>
            {status.secondsUntilNextScan > 0 && (
              <div className="flex justify-between text-green-200">
                <span>Next scan in:</span>
                <span className="font-mono">{scanningStateMachine.formatCountdown(status.secondsUntilNextScan)}</span>
              </div>
            )}
            {countdown > 0 && (
              <div className="flex justify-between text-green-200">
                <span>Session ends in:</span>
                <span className="font-mono">{countdownFormatted}</span>
              </div>
            )}
          </div>

          <div className="mt-3 pt-3 border-t border-green-500/20">
            <div className="w-full bg-green-900/30 rounded-full h-2">
              <div
                className="bg-green-500 h-2 rounded-full transition-all duration-300"
                style={{
                  width: `${(status.scansInCurrentSession / status.maxScansPerSession) * 100}%`
                }}
              ></div>
            </div>
          </div>
        </div>
      );

    case 'cooldown':
      return (
        <div className="bg-gradient-to-r from-yellow-900/30 to-amber-900/30 border border-yellow-500/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-yellow-400" />
              <span className="text-yellow-300 font-semibold">Cooldown Break</span>
            </div>
            <div className="text-sm text-yellow-200 bg-yellow-900/30 px-3 py-1 rounded-full">
              Session {status.scanningSessionNumber}/2 Complete
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <p className="text-yellow-100">
              Taking a 15-minute break. No quality trades found in this session.
            </p>
            <div className="flex justify-between text-yellow-200 font-semibold">
              <span>Resuming in:</span>
              <span className="font-mono text-lg">{countdownFormatted}</span>
            </div>
            <p className="text-yellow-200/70 text-xs">
              {status.scanningSessionNumber === 1
                ? 'After cooldown, Session 2 will begin (12 more scans)'
                : 'This was the final session before potential lockdown'}
            </p>
          </div>

          <div className="mt-3 pt-3 border-t border-yellow-500/20">
            <div className="w-full bg-yellow-900/30 rounded-full h-2">
              <div
                className="bg-yellow-500 h-2 rounded-full transition-all duration-1000"
                style={{
                  width: `${Math.max(0, 100 - (countdown / (15 * 60)) * 100)}%`
                }}
              ></div>
            </div>
          </div>
        </div>
      );

    case 'lockdown':
      return (
        <div className="bg-gradient-to-r from-red-900/30 to-orange-900/30 border border-red-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <span className="text-red-300 font-semibold">Scanning Paused</span>
          </div>

          <div className="space-y-3">
            <div className="bg-red-900/20 border border-red-500/20 rounded p-3">
              <div className="flex items-start gap-2">
                <Lock className="w-4 h-4 text-red-400 mt-0.5" />
                <div className="flex-1">
                  <p className="text-red-100 text-sm font-medium">12-Hour Market Lockdown</p>
                  <p className="text-red-200/70 text-xs mt-1">
                    No quality trades found after 2.5 hours (24 scans). Markets may be unfavorable.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-red-200">
                <span>Total scans attempted:</span>
                <span className="font-mono">{status.totalScansInCycle}</span>
              </div>
              <div className="flex justify-between text-red-200 font-semibold">
                <span>Resuming in:</span>
                <span className="font-mono text-lg">{countdownFormatted}</span>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-red-500/20">
              <p className="text-xs text-red-200/70">
                💡 Consider: Trying different trading hours (London/NY session), adjusting watchlist, or reviewing risk settings.
              </p>
            </div>

            <div className="w-full bg-red-900/30 rounded-full h-2">
              <div
                className="bg-red-500 h-2 rounded-full transition-all duration-1000"
                style={{
                  width: `${Math.max(0, 100 - (countdown / (12 * 60 * 60)) * 100)}%`
                }}
              ></div>
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}
