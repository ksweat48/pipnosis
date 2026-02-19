import React, { useState, useMemo } from 'react';
import { Search, MoreVertical, User, DollarSign, RefreshCw, Eye, Copy, Clock, AlertTriangle, Users as UsersIcon, Activity, TrendingUp, Target, ChevronLeft, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
import { adminUserService } from '../../services/admin-user-service';
import { useAdminDashboard } from '../../hooks/useAdminDashboard';
import { useToast } from '../../hooks/useToast';
import { UserDetailsModal } from './UserDetailsModal';
import { AddCreditsDialog } from './AddCreditsDialog';
import { ResetSessionDialog } from './ResetSessionDialog';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';

export const UserManagementPanel: React.FC = () => {
  const {
    users,
    platformKPIs,
    pagination,
    loading,
    refreshing,
    error,
    refresh,
    isStale,
    lastUpdate,
    setPage,
    setPageSize,
    setSearchTerm: updateSearchTerm,
    nextPage,
    previousPage,
  } = useAdminDashboard();
  const [localSearchTerm, setLocalSearchTerm] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showCreditsDialog, setShowCreditsDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [forceClosing, setForceClosing] = useState(false);
  const [forceClosingAll, setForceClosingAll] = useState(false);
  const [searchDebounce, setSearchDebounce] = useState<NodeJS.Timeout | null>(null);
  const { showToast } = useToast();
  const { confirm: showConfirm } = useConfirmDialog();

  // Handle search with debouncing (500ms delay)
  const handleSearchChange = (value: string) => {
    setLocalSearchTerm(value);

    // Clear existing timeout
    if (searchDebounce) {
      clearTimeout(searchDebounce);
    }

    // Set new timeout
    const timeout = setTimeout(() => {
      updateSearchTerm(value);
    }, 500);

    setSearchDebounce(timeout);
  };

  // Count stuck sessions (20+ minutes = stuck, 15-min timeout + 5-min buffer)
  const stuckSessionsCount = useMemo(() => {
    return users.reduce((count, user) => {
      if (user.scanning_duration_minutes && user.scanning_duration_minutes > 20) {
        return count + user.scanning_sessions;
      }
      return count;
    }, 0);
  }, [users]);

  // Count non-trade sessions (any session + awaiting response sessions)
  const nonTradeSessionsCount = useMemo(() => {
    return users.reduce((count, user) => {
      return count + user.scanning_sessions + user.awaiting_response_sessions;
    }, 0);
  }, [users]);

  const handleAction = (action: string, userId: string, email: string) => {
    setSelectedUserId(userId);
    setOpenDropdown(null);

    switch (action) {
      case 'details':
        setShowDetailsModal(true);
        break;
      case 'credits':
        setShowCreditsDialog(true);
        break;
      case 'reset':
        setShowResetDialog(true);
        break;
      case 'recalculate':
        handleRecalculateBalance(userId);
        break;
      case 'copy':
        navigator.clipboard.writeText(email);
        showToast('Email copied to clipboard', 'success');
        break;
    }
  };

  const handleRecalculateBalance = async (userId: string) => {
    try {
      const result = await adminUserService.recalculateBalance(userId);
      if (result.success) {
        showToast(
          `Balance recalculated. Difference: $${result.balance_diff.toFixed(2)}`,
          'success'
        );
        await refresh();
      }
    } catch (error) {
      showToast('Failed to recalculate balance', 'error');
      console.error(error);
    }
  };

  const handleForceCloseStuckSessions = async () => {
    const confirmed = await showConfirm(
      'Force Close Stuck Sessions?',
      'This will automatically close all sessions that have been scanning for more than 30 minutes. This action cannot be undone. Continue?'
    );

    if (!confirmed) return;

    try {
      setForceClosing(true);
      const results = await adminUserService.forceCloseStaleScanningSessions();

      if (results.length === 0) {
        showToast('No stuck sessions found', 'info');
      } else {
        showToast(
          `Successfully closed ${results.length} stuck session${results.length > 1 ? 's' : ''}`,
          'success'
        );
        console.log('[Admin] Force-closed sessions:', results);
      }

      await refresh();
    } catch (error) {
      showToast('Failed to force-close stuck sessions', 'error');
      console.error('[Admin] Error force-closing sessions:', error);
    } finally {
      setForceClosing(false);
    }
  };

  const handleForceCloseAllNonTradeSessions = async () => {
    const confirmed = await showConfirm(
      'Force Close All Non-Trade Sessions?',
      `This will close ${nonTradeSessionsCount} scanning and paused sessions across all users. Active trades (in_trade) and awaiting continuation sessions will NOT be affected. This action cannot be undone. Continue?`
    );

    if (!confirmed) return;

    try {
      setForceClosingAll(true);
      const result = await adminUserService.forceCloseAllNonTradeSessions();

      if (result.success) {
        showToast(
          `Closed ${result.sessions_closed} session${result.sessions_closed > 1 ? 's' : ''} affecting ${result.affected_users} user${result.affected_users > 1 ? 's' : ''}`,
          'success'
        );
        console.log('[Admin] Force-closed all non-trade sessions:', result);
      } else {
        showToast(result.error || 'Failed to close sessions', 'error');
      }

      await refresh();
    } catch (error) {
      showToast('Failed to force-close all non-trade sessions', 'error');
      console.error('[Admin] Error force-closing all non-trade sessions:', error);
    } finally {
      setForceClosingAll(false);
    }
  };

  const formatBalance = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatScanDuration = (minutes: number | null): string => {
    if (!minutes) return '';

    // Display scanning duration, stuck threshold is 20 minutes (15min + 5min buffer)
    if (minutes < 60) {
      return `${Math.round(minutes)}m`;
    } else if (minutes < 1440) {
      const hours = Math.floor(minutes / 60);
      const mins = Math.round(minutes % 60);
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    } else {
      const days = Math.floor(minutes / 1440);
      const hours = Math.floor((minutes % 1440) / 60);
      return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    }
  };

  const formatPnL = (pnl: number): string => {
    const formatted = Math.abs(pnl).toFixed(2);
    return pnl >= 0 ? `+$${formatted}` : `-$${formatted}`;
  };

  return (
    <div className="space-y-4">
      {/* Platform KPIs */}
      {!loading && platformKPIs && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4 mb-6">
          <div className="bg-gradient-to-br from-blue-600/20 to-blue-800/20 backdrop-blur-sm border-2 border-blue-500/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <UsersIcon className="w-5 h-5 text-blue-400" />
              <div className="text-xs text-gray-400">Total Users</div>
            </div>
            <div className="text-2xl font-bold text-white">{Number(platformKPIs?.total_users || 0).toLocaleString()}</div>
          </div>

          <div className="bg-gradient-to-br from-green-600/20 to-green-800/20 backdrop-blur-sm border-2 border-green-500/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-5 h-5 text-green-400" />
              <div className="text-xs text-gray-400">Active Users</div>
            </div>
            <div className="text-2xl font-bold text-white">{Number(platformKPIs?.active_users || 0).toLocaleString()}</div>
            <div className="text-[10px] text-gray-500 mt-1">Last 7 days</div>
          </div>

          <div className="bg-gradient-to-br from-purple-600/20 to-purple-800/20 backdrop-blur-sm border-2 border-purple-500/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-5 h-5 text-purple-400" />
              <div className="text-xs text-gray-400">Total Trades</div>
            </div>
            <div className="text-2xl font-bold text-white">{Number(platformKPIs?.total_trades || 0).toLocaleString()}</div>
          </div>

          <div className="bg-gradient-to-br from-emerald-600/20 to-emerald-800/20 backdrop-blur-sm border-2 border-emerald-500/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-5 h-5 text-emerald-400" />
              <div className="text-xs text-gray-400">Won</div>
            </div>
            <div className="text-2xl font-bold text-emerald-300">{Number(platformKPIs?.winning_trades || 0).toLocaleString()}</div>
          </div>

          <div className="bg-gradient-to-br from-red-600/20 to-red-800/20 backdrop-blur-sm border-2 border-red-500/30 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-5 h-5 text-red-400" />
              <div className="text-xs text-gray-400">Lost</div>
            </div>
            <div className="text-2xl font-bold text-red-300">{Number(platformKPIs?.losing_trades || 0).toLocaleString()}</div>
          </div>

          <div className={`bg-gradient-to-br backdrop-blur-sm border-2 rounded-xl p-4 ${
            (platformKPIs?.overall_win_rate || 0) >= 50
              ? 'from-green-600/20 to-green-800/20 border-green-500/30'
              : 'from-amber-600/20 to-amber-800/20 border-amber-500/30'
          }`}>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className={`w-5 h-5 ${(platformKPIs?.overall_win_rate || 0) >= 50 ? 'text-green-400' : 'text-amber-400'}`} />
              <div className="text-xs text-gray-400">Win Rate</div>
            </div>
            <div className={`text-2xl font-bold ${(platformKPIs?.overall_win_rate || 0) >= 50 ? 'text-green-300' : 'text-amber-300'}`}>
              {Number(platformKPIs?.overall_win_rate || 0).toFixed(1)}%
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">User Management</h2>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
            <Clock size={12} />
            <span>Last updated: {new Date(lastUpdate).toLocaleTimeString()}</span>
            {isStale && (
              <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded">
                Data may be stale
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {stuckSessionsCount > 0 && (
            <button
              onClick={handleForceCloseStuckSessions}
              disabled={forceClosing}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center gap-2 relative"
            >
              <AlertTriangle size={16} className={forceClosing ? 'animate-pulse' : ''} />
              {forceClosing ? 'Closing...' : 'Force Close Stuck Sessions'}
              <span className="absolute -top-2 -right-2 px-2 py-0.5 bg-yellow-500 text-black text-xs font-bold rounded-full">
                {stuckSessionsCount}
              </span>
            </button>
          )}
          {nonTradeSessionsCount > 0 && (
            <button
              onClick={handleForceCloseAllNonTradeSessions}
              disabled={forceClosingAll}
              className="px-4 py-2 bg-red-700 hover:bg-red-800 disabled:bg-red-900 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center gap-2 relative"
            >
              <AlertTriangle size={16} className={forceClosingAll ? 'animate-pulse' : ''} />
              {forceClosingAll ? 'Closing...' : 'Force Close All Non-Trade'}
              <span className="absolute -top-2 -right-2 px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full">
                {nonTradeSessionsCount}
              </span>
            </button>
          )}
          <button
            onClick={async () => {
              await refresh();
              showToast('Dashboard refreshed successfully', 'success');
            }}
            disabled={refreshing}
            className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-wait transition-colors flex items-center gap-2"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
        <input
          type="text"
          placeholder="Search by email..."
          value={localSearchTerm}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-amber-500"
        />
        {localSearchTerm && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-gray-500">
            Searching...
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">
          Loading users...
        </div>
      ) : error ? (
        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-6 text-center">
          <div className="text-red-400 font-semibold mb-2">Error Loading Users</div>
          <div className="text-gray-300 text-sm mb-4">{error}</div>
          <button
            onClick={refresh}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-2 mx-auto"
          >
            <RefreshCw size={16} />
            Try Again
          </button>
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          {localSearchTerm ? 'No users match your search' : 'No users found'}
        </div>
      ) : (
        <>
          <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
              <thead className="bg-gray-900 border-b border-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Account Balance
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Credits
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                    <div className="flex flex-col items-center">
                      <span>Closed Trades</span>
                      <span className="text-[10px] text-gray-500 normal-case font-normal">(Historical)</span>
                    </div>
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-2">
                        <span>Open Trades</span>
                        <span className="px-1.5 py-0.5 bg-green-500/20 text-green-400 text-[10px] font-semibold rounded flex items-center gap-1">
                          <span className="w-1 h-1 rounded-full bg-green-400 animate-pulse"></span>
                          LIVE
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-500 normal-case font-normal">(Real-time P&L)</span>
                    </div>
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Style / Risk
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Scanning
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Risk Level
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Joined
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {users.map((user) => (
                  <tr key={user.user_id} className="hover:bg-gray-750 transition-colors">
                    <td className="px-4 py-3 text-sm text-white">
                      <div className="flex items-center gap-2">
                        <User size={16} className="text-gray-400" />
                        <span className="truncate max-w-xs">{user.email}</span>
                        {user.is_admin && (
                          <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-xs rounded">
                            Admin
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-mono">
                      <span className={user.account_balance >= 10000 ? 'text-green-400' : user.account_balance > 0 ? 'text-white' : 'text-red-400'}>
                        {formatBalance(user.account_balance)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-mono">
                      {user.is_admin ? (
                        <div className="flex items-center justify-end gap-1" title="Admin accounts have unlimited credits">
                          <span className="text-amber-400 text-lg font-bold">∞</span>
                        </div>
                      ) : (
                        <span className="text-amber-400">{user.credit_balance.toFixed(2)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-center">
                      {user.total_trades > 0 ? (
                        <div className="flex flex-col items-center gap-1">
                          <div className="flex items-center flex-wrap justify-center gap-1">
                            {(user.tp1_wins || 0) > 0 && (
                              <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded text-[10px] font-bold">
                                TP1 {user.tp1_wins}
                              </span>
                            )}
                            {(user.tp2_wins || 0) > 0 && (
                              <span className="px-1.5 py-0.5 bg-green-500/20 text-green-300 border border-green-500/30 rounded text-[10px] font-bold">
                                TP2 {user.tp2_wins}
                              </span>
                            )}
                            {(user.manual_closed || 0) > 0 && (
                              <span className="px-1.5 py-0.5 bg-sky-500/20 text-sky-300 border border-sky-500/30 rounded text-[10px] font-bold">
                                MC {user.manual_closed}
                              </span>
                            )}
                            {(() => {
                              const slLosses = (user.losing_trades || 0) - Math.min(user.manual_closed || 0, user.losing_trades || 0);
                              return slLosses > 0 ? (
                                <span className="px-1.5 py-0.5 bg-red-500/20 text-red-300 border border-red-500/30 rounded text-[10px] font-bold">
                                  L {slLosses}
                                </span>
                              ) : null;
                            })()}
                          </div>
                          <span className="text-[10px] text-gray-500">{user.total_trades} total</span>
                        </div>
                      ) : user.active_trades > 0 ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-gray-500 text-xs">0</span>
                          <span className="text-[10px] text-blue-400">(trade active)</span>
                        </div>
                      ) : (
                        <span className="text-gray-500">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {user.active_trades > 0 && user.active_trades_detail?.length > 0 ? (
                        <div className="flex flex-col gap-1.5 min-w-[120px]">
                          {user.active_trades_detail.slice(0, 3).map((trade, idx) => (
                            <div key={idx} className="flex items-center justify-between gap-2 text-xs">
                              <div className="flex items-center gap-1">
                                {trade.direction === 'buy' ? (
                                  <ArrowUp size={12} className="text-green-400 flex-shrink-0" strokeWidth={3} />
                                ) : (
                                  <ArrowDown size={12} className="text-red-400 flex-shrink-0" strokeWidth={3} />
                                )}
                                <span className="font-semibold text-gray-300">{trade.symbol}</span>
                                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" title="Live"></span>
                              </div>
                              <span className={`font-mono font-semibold transition-colors duration-300 ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {formatPnL(trade.pnl)}
                              </span>
                            </div>
                          ))}
                          {user.active_trades > 3 && (
                            <span className="text-xs text-gray-500 text-center">
                              +{user.active_trades - 3} more
                            </span>
                          )}
                        </div>
                      ) : user.active_trades > 0 ? (
                        <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded">
                          {user.active_trades}
                        </span>
                      ) : (
                        <span className="text-gray-500 text-center block">0</span>
                      )}
                    </td>
                    {/* Style / Risk column */}
                    <td className="px-4 py-3 text-sm text-center">
                      {user.trade_style ? (
                        <div className="flex flex-col items-center gap-1">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                            user.trade_style === 'scalper'
                              ? 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
                              : user.trade_style === 'swing'
                              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                              : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                          }`}>
                            {user.trade_style}
                          </span>
                          {user.dollar_risk != null && user.dollar_risk > 0 && (
                            <span className="text-[10px] text-gray-400 font-mono">
                              ${user.dollar_risk.toFixed(0)}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-center">
                      {user.scanning_sessions > 0 ? (
                        <div className="flex flex-col items-center gap-1">
                          {user.scanning_duration_minutes && user.scanning_duration_minutes > 20 ? (
                            <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded flex items-center justify-center gap-1 border border-red-500/30">
                              <AlertTriangle className="w-3 h-3 animate-pulse" />
                              {user.scanning_sessions}
                              <span className="ml-1 text-[10px] font-semibold">STUCK</span>
                            </span>
                          ) : (
                            <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded flex items-center justify-center gap-1">
                              <svg className="w-3 h-3 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                              {user.scanning_sessions}
                            </span>
                          )}
                          {user.scanning_duration_minutes && (
                            <span className={`text-xs ${user.scanning_duration_minutes > 20 ? 'text-red-400 font-semibold' : 'text-gray-400'}`}>
                              {formatScanDuration(user.scanning_duration_minutes)}
                            </span>
                          )}
                        </div>
                      ) : user.awaiting_response_sessions > 0 ? (
                        <div className="flex flex-col items-center gap-1">
                          <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-xs rounded flex items-center justify-center gap-1">
                            <Clock className="w-3 h-3" />
                            Paused
                          </span>
                          <span className="text-xs text-gray-400">Awaiting</span>
                        </div>
                      ) : (
                        <span className="text-gray-500">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-center">
                      {user.prompt_risk ? (
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          user.prompt_risk === 'low'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : user.prompt_risk === 'medium'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            : 'bg-red-500/20 text-red-300 border border-red-500/30'
                        }`}>
                          {user.prompt_risk === 'low' ? 'Low' : user.prompt_risk === 'medium' ? 'Medium' : 'High'}
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {formatDate(user.created_at)}
                    </td>
                    <td className="px-4 py-3 text-sm text-center relative">
                      <button
                        onClick={() => setOpenDropdown(openDropdown === user.user_id ? null : user.user_id)}
                        className="p-1 hover:bg-gray-700 rounded transition-colors"
                      >
                        <MoreVertical size={18} className="text-gray-400" />
                      </button>

                      {openDropdown === user.user_id && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setOpenDropdown(null)}
                          />
                          <div className="absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20">
                            <button
                              onClick={() => handleAction('details', user.user_id, user.email)}
                              className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-700 flex items-center gap-2"
                            >
                              <Eye size={16} />
                              View Details
                            </button>
                            <button
                              onClick={() => handleAction('credits', user.user_id, user.email)}
                              className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-700 flex items-center gap-2"
                            >
                              <DollarSign size={16} />
                              Add Credits
                            </button>
                            <button
                              onClick={() => handleAction('reset', user.user_id, user.email)}
                              className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-700 flex items-center gap-2"
                            >
                              <RefreshCw size={16} />
                              Reset Stuck Session
                            </button>
                            <button
                              onClick={() => handleAction('recalculate', user.user_id, user.email)}
                              className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-700 flex items-center gap-2"
                            >
                              <RefreshCw size={16} />
                              Fix Balance
                            </button>
                            <div className="border-t border-gray-700" />
                            <button
                              onClick={() => handleAction('copy', user.user_id, user.email)}
                              className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-700 flex items-center gap-2"
                            >
                              <Copy size={16} />
                              Copy Email
                            </button>
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination Controls */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border border-t-0 border-gray-700 rounded-b-lg">
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-400">
              Showing <span className="font-semibold text-white">{pagination.totalUsers === 0 ? 0 : (pagination.currentPage - 1) * pagination.pageSize + 1}</span> to{' '}
              <span className="font-semibold text-white">{Math.min(pagination.currentPage * pagination.pageSize, pagination.totalUsers)}</span> of{' '}
              <span className="font-semibold text-white">{pagination.totalUsers}</span> users
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="pageSize" className="text-sm text-gray-400">
                Per page:
              </label>
              <select
                id="pageSize"
                value={pagination.pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-amber-500"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={previousPage}
              disabled={!pagination.hasPreviousPage || refreshing}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center gap-1 text-sm"
            >
              <ChevronLeft size={16} />
              Previous
            </button>

            <div className="flex items-center gap-1">
              {pagination.totalPages > 0 && (
                <>
                  {pagination.currentPage > 2 && (
                    <>
                      <button
                        onClick={() => setPage(1)}
                        className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors text-sm"
                      >
                        1
                      </button>
                      {pagination.currentPage > 3 && (
                        <span className="px-2 text-gray-500">...</span>
                      )}
                    </>
                  )}

                  {pagination.currentPage > 1 && (
                    <button
                      onClick={() => setPage(pagination.currentPage - 1)}
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors text-sm"
                    >
                      {pagination.currentPage - 1}
                    </button>
                  )}

                  <button
                    className="px-3 py-1 bg-amber-600 text-white rounded font-semibold text-sm"
                    disabled
                  >
                    {pagination.currentPage}
                  </button>

                  {pagination.currentPage < pagination.totalPages && (
                    <button
                      onClick={() => setPage(pagination.currentPage + 1)}
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors text-sm"
                    >
                      {pagination.currentPage + 1}
                    </button>
                  )}

                  {pagination.currentPage < pagination.totalPages - 1 && (
                    <>
                      {pagination.currentPage < pagination.totalPages - 2 && (
                        <span className="px-2 text-gray-500">...</span>
                      )}
                      <button
                        onClick={() => setPage(pagination.totalPages)}
                        className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors text-sm"
                      >
                        {pagination.totalPages}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>

            <button
              onClick={nextPage}
              disabled={!pagination.hasNextPage || refreshing}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center gap-1 text-sm"
            >
              Next
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </>
      )}

      {showDetailsModal && selectedUserId && (
        <UserDetailsModal
          userId={selectedUserId}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedUserId(null);
          }}
        />
      )}

      {showCreditsDialog && selectedUserId && (
        <AddCreditsDialog
          userId={selectedUserId}
          onClose={() => {
            setShowCreditsDialog(false);
            setSelectedUserId(null);
          }}
          onSuccess={async () => {
            await refresh();
            setShowCreditsDialog(false);
            setSelectedUserId(null);
          }}
        />
      )}

      {showResetDialog && selectedUserId && (
        <ResetSessionDialog
          userId={selectedUserId}
          onClose={() => {
            setShowResetDialog(false);
            setSelectedUserId(null);
          }}
          onSuccess={async () => {
            await refresh();
            setShowResetDialog(false);
            setSelectedUserId(null);
          }}
        />
      )}
    </div>
  );
};
