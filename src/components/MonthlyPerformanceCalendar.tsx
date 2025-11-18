import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Check, X, ChevronLeft, ChevronRight, Calendar, TrendingUp, TrendingDown } from 'lucide-react';
import { monthlySessionService, MonthlySessionData, DailySessionResult } from '../services/monthly-session-service';
import { supabase } from '../lib/supabase';

interface MonthlyPerformanceCalendarProps {
  userId: string;
}

export default function MonthlyPerformanceCalendar({ userId }: MonthlyPerformanceCalendarProps) {
  const [monthData, setMonthData] = useState<MonthlySessionData | null>(null);
  const [currentMonthNumber, setCurrentMonthNumber] = useState(1);
  const [availableMonths, setAvailableMonths] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);

  // Track previous data to prevent unnecessary updates
  const previousMonthDataRef = useRef<MonthlySessionData | null>(null);
  const pendingUpdateRef = useRef<MonthlySessionData | null>(null);
  const isLoadingRef = useRef(false);

  // Stable function references that don't change on every render
  const loadMonthData = useCallback(async () => {
    if (!userId) return;

    // Prevent concurrent loads
    if (isLoadingRef.current) {
      console.log('[Monthly Calendar] Already loading, skipping...');
      return;
    }

    isLoadingRef.current = true;
    setLoading(true);
    try {
      const data = await monthlySessionService.getMonthData(userId, currentMonthNumber);

      // Deep equality check - only update if data actually changed
      const dataHasChanged = !previousMonthDataRef.current ||
        JSON.stringify(previousMonthDataRef.current) !== JSON.stringify(data);

      if (dataHasChanged) {
        console.log('[Monthly Calendar] Month data changed, updating...');
        setMonthData(data);
        previousMonthDataRef.current = data;
      } else {
        console.log('[Monthly Calendar] Month data unchanged, skipping update');
      }
    } catch (error) {
      console.error('[Monthly Calendar] Error loading month data:', error);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  }, [userId, currentMonthNumber]);

  // Load initial data once when component mounts
  useEffect(() => {
    const loadInitialData = async () => {
      if (!userId) return;

      try {
        const activeMonth = await monthlySessionService.getCurrentMonthNumber(userId);
        const months = await monthlySessionService.getAvailableMonths(userId);

        setAvailableMonths(months);
        setCurrentMonthNumber(activeMonth || 1);
      } catch (error) {
        console.error('[Monthly Calendar] Error loading initial data:', error);
      }
    };

    loadInitialData();
  }, [userId]);

  // Load month data when userId or currentMonthNumber changes
  useEffect(() => {
    if (userId && currentMonthNumber > 0) {
      loadMonthData();
    }
  }, [userId, currentMonthNumber, loadMonthData]);

  // Real-time subscription for current month updates with debouncing
  useEffect(() => {
    // Always return a cleanup function to maintain consistent hook execution
    if (!userId) {
      return () => {}; // Empty cleanup
    }

    let debounceTimer: NodeJS.Timeout | null = null;
    const debouncedLoadMonthData = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadMonthData();
      }, 2000); // Wait 2 seconds before updating
    };

    const channel = supabase
      .channel(`monthly-calendar-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'auto_backtest_global_state',
          filter: `user_id=eq.${userId}`
        },
        (payload) => {
          console.log('[Monthly Calendar] Auto-backtest state updated:', payload);
          // Reload current month data if it's the active month
          if (currentMonthNumber === payload.new.current_month_number) {
            debouncedLoadMonthData();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ai_session_learnings',
          filter: `user_id=eq.${userId}`
        },
        () => {
          console.log('[Monthly Calendar] New session learning created, reloading...');
          debouncedLoadMonthData();
        }
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [userId, currentMonthNumber, loadMonthData]);

  const handlePrevMonth = useCallback(() => {
    if (currentMonthNumber > 1) {
      setCurrentMonthNumber(currentMonthNumber - 1);
      previousMonthDataRef.current = null; // Clear cache when changing months
    }
  }, [currentMonthNumber]);

  const handleNextMonth = useCallback(() => {
    const maxMonth = Math.max(...availableMonths, currentMonthNumber);
    if (currentMonthNumber < maxMonth) {
      setCurrentMonthNumber(currentMonthNumber + 1);
      previousMonthDataRef.current = null; // Clear cache when changing months
    }
  }, [availableMonths, currentMonthNumber]);

  const getDayData = useCallback((dayNumber: number): DailySessionResult | null => {
    return monthData?.dailyResults.find(d => d.dayNumber === dayNumber) || null;
  }, [monthData]);

  const renderDaySquare = useCallback((dayNumber: number) => {
    const dayData = getDayData(dayNumber);
    const isHovered = hoveredDay === dayNumber;
    const hasData = dayData !== null;
    const isProfitable = dayData?.isProfitable;
    const isCompleted = hasData && dayData.totalTrades > 0;

    let bgColor = 'bg-gray-800/30';
    let borderColor = 'border-gray-700';
    let icon = null;

    if (isCompleted) {
      if (isProfitable) {
        bgColor = 'bg-green-900/20';
        borderColor = 'border-green-500/40';
        icon = <Check className="w-4 h-4 text-green-400" />;
      } else {
        bgColor = 'bg-red-900/20';
        borderColor = 'border-red-500/40';
        icon = <X className="w-4 h-4 text-red-400" />;
      }
    }

    return (
      <div
        key={dayNumber}
        className={`relative aspect-square ${bgColor} ${borderColor} border-2 rounded-lg flex flex-col items-center justify-center transition-all cursor-pointer hover:scale-105 hover:shadow-lg ${
          isHovered ? 'ring-2 ring-blue-500 z-10' : ''
        }`}
        onMouseEnter={() => setHoveredDay(dayNumber)}
        onMouseLeave={() => setHoveredDay(null)}
      >
        <div className="text-xs text-gray-400 mb-1">{dayNumber}</div>
        {icon}
        {!isCompleted && hasData && (
          <div className="text-xs text-yellow-400 mt-1">...</div>
        )}

        {/* Hover Tooltip */}
        {isHovered && dayData && (
          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64 bg-gray-900 border-2 border-gray-700 rounded-lg p-3 shadow-xl z-20 pointer-events-none">
            <div className="text-sm font-bold text-white mb-2">Day {dayNumber}</div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-400">P&L:</span>
                <span className={`font-bold ${dayData.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ${dayData.pnl.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Win Rate:</span>
                <span className="text-white font-semibold">{dayData.winRate.toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Trades:</span>
                <span className="text-white font-semibold">{dayData.totalTrades}</span>
              </div>
              {dayData.sessionCss > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">CSS:</span>
                  <span className="text-blue-400 font-semibold">{dayData.sessionCss.toFixed(1)}</span>
                </div>
              )}
              {dayData.sessionEv !== 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">EV:</span>
                  <span className={`font-semibold ${dayData.sessionEv >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {dayData.sessionEv.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
            {dayData.keyLearnings.length > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-700">
                <div className="text-xs text-gray-400 mb-1">Key Learning:</div>
                <div className="text-xs text-gray-300">{dayData.keyLearnings[0]}</div>
              </div>
            )}
            {/* Tooltip arrow */}
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1">
              <div className="border-8 border-transparent border-t-gray-700"></div>
            </div>
          </div>
        )}
      </div>
    );
  }, [hoveredDay, monthData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!monthData || availableMonths.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <Calendar className="w-12 h-12 text-gray-600 mx-auto mb-3" />
        <p className="text-sm">No monthly data yet. Start the 30-day backtest system to see results.</p>
      </div>
    );
  }

  const profitableDays = useMemo(() =>
    monthData.dailyResults.filter(d => d.isProfitable).length,
    [monthData]
  );
  const losingDays = useMemo(() =>
    monthData.dailyResults.filter(d => !d.isProfitable && d.totalTrades > 0).length,
    [monthData]
  );

  // Memoize calendar grid to prevent re-renders
  const calendarGrid = useMemo(() =>
    Array.from({ length: 30 }, (_, i) => i + 1).map(dayNumber => renderDaySquare(dayNumber)),
    [renderDaySquare]
  );

  return (
    <div className="space-y-4">
      {/* Month Header with Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={handlePrevMonth}
            disabled={currentMonthNumber <= 1}
            className="p-2 rounded-lg bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-gray-400" />
          </button>

          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-400" />
            <div>
              <div className="text-lg font-bold text-white">
                Month #{currentMonthNumber}
                {monthData.isCurrentMonth && (
                  <span className="ml-2 text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded">
                    Current
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-400">
                {monthData.startDate.toLocaleDateString()} - {monthData.isComplete ? monthData.endDate.toLocaleDateString() : 'In Progress'}
              </div>
            </div>
          </div>

          <button
            onClick={handleNextMonth}
            disabled={currentMonthNumber >= Math.max(...availableMonths)}
            className="p-2 rounded-lg bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Month Stats */}
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs text-gray-400">Month P&L</div>
            <div className={`text-lg font-bold ${monthData.monthTotalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              ${monthData.monthTotalPnl.toFixed(2)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400">Avg Win Rate</div>
            <div className="text-lg font-bold text-white">
              {monthData.monthAvgWinRate.toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-400">
            Progress: Day {monthData.daysCompleted}/{monthData.totalDays}
          </span>
          <span className="text-sm font-semibold text-white">
            {((monthData.daysCompleted / monthData.totalDays) * 100).toFixed(0)}%
          </span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
          <div
            className="h-2 bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-500 rounded-full"
            style={{ width: `${(monthData.daysCompleted / monthData.totalDays) * 100}%` }}
          ></div>
        </div>
        <div className="flex items-center justify-between mt-2 text-xs">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-3 h-3 text-green-400" />
            <span className="text-gray-400">{profitableDays} profitable days</span>
          </div>
          <div className="flex items-center gap-2">
            <TrendingDown className="w-3 h-3 text-red-400" />
            <span className="text-gray-400">{losingDays} losing days</span>
          </div>
        </div>
      </div>

      {/* 30-Day Calendar Grid */}
      <div className="grid grid-cols-6 gap-2">
        {calendarGrid}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 text-xs text-gray-400 pt-2">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-900/20 border-2 border-green-500/40 rounded flex items-center justify-center">
            <Check className="w-3 h-3 text-green-400" />
          </div>
          <span>Profitable Day</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-red-900/20 border-2 border-red-500/40 rounded flex items-center justify-center">
            <X className="w-3 h-3 text-red-400" />
          </div>
          <span>Losing Day</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-800/30 border-2 border-gray-700 rounded"></div>
          <span>Not Yet Traded</span>
        </div>
      </div>
    </div>
  );
}
