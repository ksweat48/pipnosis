import React, { useState, useEffect } from 'react';
import { X, DollarSign, Info } from 'lucide-react';
import { adminUserService } from '../../services/admin-user-service';
import { useToast } from '../../hooks/useToast';

interface AddCreditsDialogProps {
  userId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const AddCreditsDialog: React.FC<AddCreditsDialogProps> = ({
  userId,
  onClose,
  onSuccess,
}) => {
  const [amount, setAmount] = useState<string>('');
  const [reason, setReason] = useState('');
  const [currentBalance, setCurrentBalance] = useState<number>(0);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const { showToast } = useToast();

  useEffect(() => {
    const loadUserBalance = async () => {
      try {
        setLoadingBalance(true);
        const details = await adminUserService.getUserDetails(userId);
        setCurrentBalance(details.balances.credit_balance);
        setIsAdmin(details.user.is_admin);
      } catch (error) {
        console.error('Failed to load user balance:', error);
      } finally {
        setLoadingBalance(false);
      }
    };

    loadUserBalance();
  }, [userId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      showToast('Please enter a valid amount greater than 0', 'error');
      return;
    }

    if (amountNum > 1000) {
      showToast('Maximum credit amount is 1000', 'error');
      return;
    }

    if (!reason.trim()) {
      showToast('Please provide a reason for this credit adjustment', 'error');
      return;
    }

    try {
      setLoading(true);
      const result = await adminUserService.addCredits(userId, amountNum, reason.trim());

      if (result.success) {
        showToast(
          `Successfully added ${amountNum.toFixed(2)} credits. New balance: ${result.new_balance.toFixed(2)}`,
          'success'
        );
        onSuccess();
      }
    } catch (error) {
      showToast('Failed to add credits', 'error');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const newBalance = currentBalance + (parseFloat(amount) || 0);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-md w-full">
        <div className="border-b border-gray-700 p-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <DollarSign size={24} className="text-amber-400" />
            Add Credits
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded transition-colors"
          >
            <X size={24} className="text-gray-400" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {loadingBalance ? (
            <div className="text-center py-4 text-gray-400">Loading user balance...</div>
          ) : (
            <>
              <div className="bg-gray-900 rounded-lg p-4">
                <div className="text-sm text-gray-400 mb-1">Current Balance</div>
                <div className="text-2xl font-bold font-mono text-amber-400">
                  {isAdmin ? '∞' : `${currentBalance.toFixed(2)} Credits`}
                </div>
              </div>

              {isAdmin && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 flex items-start gap-3">
                  <Info size={20} className="text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-gray-300">
                    <strong className="text-blue-400">Admin Account:</strong> This user already has unlimited credits.
                    Adding credits will update the balance display but admins bypass all credit checks.
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Credits to Add *
                </label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Enter amount (1-1000)"
                  className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Reason *
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g., Customer support credit for account issue"
                  rows={3}
                  className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 resize-none"
                  required
                />
                <div className="text-xs text-gray-500 mt-1">
                  This will be logged for audit purposes
                </div>
              </div>

              {amount && parseFloat(amount) > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                  <div className="text-sm text-gray-300 mb-2">Preview:</div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">New balance will be:</span>
                    <span className="text-xl font-bold font-mono text-amber-400">
                      {newBalance.toFixed(2)} Credits
                    </span>
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-amber-500 text-black font-semibold rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={loading || !amount || !reason.trim()}
                >
                  {loading ? 'Adding...' : 'Add Credits'}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
};
