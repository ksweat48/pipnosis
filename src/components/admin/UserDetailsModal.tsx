import React, { useState, useEffect } from 'react';
import { X, Copy, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { adminUserService, UserDetails } from '../../services/admin-user-service';
import { useToast } from '../../hooks/useToast';

interface UserDetailsModalProps {
  userId: string;
  onClose: () => void;
}

export const UserDetailsModal: React.FC<UserDetailsModalProps> = ({ userId, onClose }) => {
  const [details, setDetails] = useState<UserDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  useEffect(() => {
    const loadDetails = async () => {
      try {
        setLoading(true);
        const data = await adminUserService.getUserDetails(userId);
        setDetails(data);
      } catch (error) {
        showToast('Failed to load user details', 'error');
        console.error(error);
        onClose();
      } finally {
        setLoading(false);
      }
    };

    loadDetails();
  }, [userId, showToast, onClose]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`${label} copied to clipboard`, 'success');
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading || !details) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
        <div className="bg-gray-800 rounded-lg p-8 text-white">
          Loading user details...
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gray-800 border-b border-gray-700 p-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">User Details</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded transition-colors"
          >
            <X size={24} className="text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-gray-900 rounded-lg p-4 space-y-2">
            <h3 className="text-lg font-semibold text-white mb-3">Profile</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-gray-400">Email</div>
                <div className="text-white flex items-center gap-2">
                  <span className="truncate">{details.user.email}</span>
                  <button
                    onClick={() => copyToClipboard(details.user.email, 'Email')}
                    className="p-1 hover:bg-gray-700 rounded"
                  >
                    <Copy size={14} className="text-gray-400" />
                  </button>
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-400">User ID</div>
                <div className="text-white flex items-center gap-2 font-mono text-sm">
                  <span className="truncate">{details.user.user_id}</span>
                  <button
                    onClick={() => copyToClipboard(details.user.user_id, 'User ID')}
                    className="p-1 hover:bg-gray-700 rounded"
                  >
                    <Copy size={14} className="text-gray-400" />
                  </button>
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-400">Created</div>
                <div className="text-white">{formatDate(details.user.created_at)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-400">Role</div>
                <div>
                  {details.user.is_admin ? (
                    <span className="px-2 py-1 bg-amber-500/20 text-amber-400 text-sm rounded">
                      Admin
                    </span>
                  ) : (
                    <span className="text-white">User</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg p-4 space-y-2">
            <h3 className="text-lg font-semibold text-white mb-3">Balances</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-gray-400">Account Balance</div>
                <div className={`text-xl font-bold font-mono ${
                  details.balances.account_balance >= 10000 ? 'text-green-400' :
                  details.balances.account_balance > 0 ? 'text-white' : 'text-red-400'
                }`}>
                  {formatCurrency(details.balances.account_balance)}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-400">Credits</div>
                <div className="text-xl font-bold font-mono text-amber-400">
                  {details.balances.credit_balance.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-400">Lifetime Credits Earned</div>
                <div className="text-xl font-bold font-mono text-amber-400">
                  {details.balances.lifetime_credits_earned.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-900 rounded-lg p-4 space-y-2">
            <h3 className="text-lg font-semibold text-white mb-3">Trading Stats</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-sm text-gray-400">Total Trades</div>
                <div className="text-xl font-bold text-white">{details.trade_stats.total_trades}</div>
              </div>
              <div>
                <div className="text-sm text-gray-400">Win Rate</div>
                <div className="text-xl font-bold text-white">{details.trade_stats.win_rate.toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-sm text-gray-400">Net P&L</div>
                <div className={`text-xl font-bold font-mono ${
                  details.trade_stats.net_pnl > 0 ? 'text-green-400' :
                  details.trade_stats.net_pnl < 0 ? 'text-red-400' : 'text-white'
                }`}>
                  {formatCurrency(details.trade_stats.net_pnl)}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-400">Winning Trades</div>
                <div className="text-white flex items-center gap-2">
                  <TrendingUp size={16} className="text-green-400" />
                  {details.trade_stats.winning_trades}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-400">Losing Trades</div>
                <div className="text-white flex items-center gap-2">
                  <TrendingDown size={16} className="text-red-400" />
                  {details.trade_stats.losing_trades}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-400">Active Trades</div>
                <div className="text-white flex items-center gap-2">
                  <Activity size={16} className="text-blue-400" />
                  {details.active.active_trades_count}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-400">Avg Win</div>
                <div className="text-green-400 font-mono">{formatCurrency(details.trade_stats.avg_win)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-400">Avg Loss</div>
                <div className="text-red-400 font-mono">{formatCurrency(details.trade_stats.avg_loss)}</div>
              </div>
            </div>
          </div>

          {details.goal_sessions.stuck_sessions > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-red-400 mb-2">Stuck Sessions</h3>
              <div className="text-sm text-gray-300">
                This user has {details.goal_sessions.stuck_sessions} stuck goal session(s) that may need admin attention.
              </div>
            </div>
          )}

          <div className="bg-gray-900 rounded-lg p-4 space-y-2">
            <h3 className="text-lg font-semibold text-white mb-3">Goal Sessions</h3>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <div className="text-sm text-gray-400">Active</div>
                <div className="text-xl font-bold text-blue-400">{details.goal_sessions.active_sessions}</div>
              </div>
              <div>
                <div className="text-sm text-gray-400">Completed</div>
                <div className="text-xl font-bold text-green-400">{details.goal_sessions.completed_sessions}</div>
              </div>
              <div>
                <div className="text-sm text-gray-400">Stuck</div>
                <div className="text-xl font-bold text-red-400">{details.goal_sessions.stuck_sessions}</div>
              </div>
            </div>

            {details.goal_sessions.sessions.length > 0 && (
              <div className="space-y-2">
                <div className="text-sm font-medium text-gray-400">Active Sessions:</div>
                {details.goal_sessions.sessions.map((session) => (
                  <div key={session.id} className="bg-gray-800 rounded p-3 flex items-center justify-between">
                    <div>
                      <div className="text-white font-medium">Target: {formatCurrency(session.target_value)}</div>
                      <div className="text-sm text-gray-400">
                        Progress: {formatCurrency(session.current_progress)} ({((session.current_progress / session.target_value) * 100).toFixed(1)}%)
                      </div>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded ${
                      session.status === 'scanning' ? 'bg-blue-500/20 text-blue-400' :
                      session.status === 'trading' ? 'bg-green-500/20 text-green-400' :
                      session.status === 'awaiting_user_action' ? 'bg-red-500/20 text-red-400' :
                      'bg-gray-700 text-gray-300'
                    }`}>
                      {session.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {details.recent_trades.length > 0 && (
            <div className="bg-gray-900 rounded-lg p-4 space-y-2">
              <h3 className="text-lg font-semibold text-white mb-3">Recent Trades</h3>
              <div className="space-y-2">
                {details.recent_trades.map((trade) => (
                  <div key={trade.id} className="bg-gray-800 rounded p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-white">{trade.symbol}</span>
                      <span className={`px-2 py-0.5 text-xs rounded ${
                        trade.direction === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {trade.direction.toUpperCase()}
                      </span>
                      <span className="text-xs text-gray-400">{formatDate(trade.closed_at)}</span>
                    </div>
                    <span className={`font-mono font-bold ${
                      trade.pnl > 0 ? 'text-green-400' : trade.pnl < 0 ? 'text-red-400' : 'text-gray-400'
                    }`}>
                      {formatCurrency(trade.pnl)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-gray-800 border-t border-gray-700 p-4">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
