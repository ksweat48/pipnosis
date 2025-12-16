import React, { useState, useEffect, useCallback } from 'react';
import { Search, MoreVertical, User, DollarSign, RefreshCw, Eye, Copy } from 'lucide-react';
import { adminUserService, AdminUser } from '../../services/admin-user-service';
import { useToast } from '../../hooks/useToast';
import { UserDetailsModal } from './UserDetailsModal';
import { AddCreditsDialog } from './AddCreditsDialog';
import { ResetSessionDialog } from './ResetSessionDialog';

export const UserManagementPanel: React.FC = () => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showCreditsDialog, setShowCreditsDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const { showToast } = useToast();

  const loadUsers = useCallback(async (search?: string) => {
    try {
      setLoading(true);
      const data = await adminUserService.getAllUsers(search, 100);
      setUsers(data);
    } catch (error) {
      showToast('Failed to load users', 'error');
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchTerm) {
        loadUsers(searchTerm);
      } else {
        loadUsers();
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm, loadUsers]);

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
        loadUsers(searchTerm || undefined);
      }
    } catch (error) {
      showToast('Failed to recalculate balance', 'error');
      console.error(error);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">User Management</h2>
        <button
          onClick={() => loadUsers(searchTerm || undefined)}
          className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 transition-colors flex items-center gap-2"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
        <input
          type="text"
          placeholder="Search by email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-amber-500"
        />
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">
          Loading users...
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No users found
        </div>
      ) : (
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
                    Total Trades
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Active Trades
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Scanning
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
                    <td className="px-4 py-3 text-sm text-right font-mono text-amber-400">
                      {user.credit_balance.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-sm text-center text-gray-300">
                      {user.total_trades}
                    </td>
                    <td className="px-4 py-3 text-sm text-center">
                      {user.active_trades > 0 ? (
                        <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded">
                          {user.active_trades}
                        </span>
                      ) : (
                        <span className="text-gray-500">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-center">
                      {user.scanning_sessions > 0 ? (
                        <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded flex items-center justify-center gap-1">
                          <svg className="w-3 h-3 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          {user.scanning_sessions}
                        </span>
                      ) : (
                        <span className="text-gray-500">0</span>
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
          onSuccess={() => {
            loadUsers(searchTerm || undefined);
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
          onSuccess={() => {
            loadUsers(searchTerm || undefined);
            setShowResetDialog(false);
            setSelectedUserId(null);
          }}
        />
      )}
    </div>
  );
};
