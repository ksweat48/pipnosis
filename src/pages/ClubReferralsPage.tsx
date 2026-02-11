import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, DollarSign, TrendingUp, Clock, CheckCircle, XCircle,
  AlertCircle, Calendar, ArrowLeft, Copy, Check, Coins
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { ClubLayout } from '@/components/ClubLayout';
import { clubReferralService, type ReferralStats } from '@/services/club-referral-service';
import { FormattedTokenNumber } from '@/components/FormattedTokenNumber';

interface ReferralDetail {
  id: string;
  referee_email: string;
  referee_tier_level: number | null;
  referee_tier_name: string;
  referee_amount_paid: number | null;
  referee_purchase_date: string | null;
  status: string;
  display_status: string;
  referred_at: string;
  completed_at: string | null;
  pip_earned: number;
  cash_earned: number;
  days_to_conversion: number | null;
}

interface PayoutRequest {
  id: string;
  requested_amount_usd: number;
  available_balance_at_request: number;
  status: string;
  requested_at: string;
  reviewed_at: string | null;
  paid_at: string | null;
  admin_notes: string | null;
}

export function ClubReferralsPage() {
  const { user } = useAuth();
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const [referralDetails, setReferralDetails] = useState<ReferralDetail[]>([]);
  const [payoutHistory, setPayoutHistory] = useState<PayoutRequest[]>([]);
  const [referralCode, setReferralCode] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState<string>('');
  const [payoutError, setPayoutError] = useState<string>('');
  const [payoutSuccess, setPayoutSuccess] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('all');

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  const loadData = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const [stats, details, code, payouts] = await Promise.all([
        clubReferralService.getReferralStats(user.id),
        clubReferralService.getReferralDetails(user.id, 100, 0),
        clubReferralService.getUserReferralCode(user.id),
        clubReferralService.getPayoutHistory(user.id)
      ]);

      setReferralStats(stats);
      setReferralDetails(details);
      setReferralCode(code);
      setPayoutHistory(payouts);
    } catch (error) {
      console.error('[ClubReferralsPage] Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyReferralLink = async () => {
    const success = await clubReferralService.copyReferralLink(referralCode);
    if (success) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  const handleRequestPayout = async () => {
    if (!user) return;

    setPayoutError('');
    setPayoutSuccess(false);

    const amount = parseFloat(payoutAmount);
    if (isNaN(amount) || amount < 100) {
      setPayoutError('Minimum payout amount is $100');
      return;
    }

    const result = await clubReferralService.requestCashPayout(user.id, amount);

    if (result.success) {
      setPayoutSuccess(true);
      setPayoutAmount('');
      setShowPayoutModal(false);
      // Reload data to show new payout request
      setTimeout(() => {
        loadData();
        setPayoutSuccess(false);
      }, 2000);
    } else {
      setPayoutError(result.error || 'Failed to request payout');
    }
  };

  const getWithdrawableBalance = () => {
    if (!referralStats) return 0;

    const pendingPayouts = payoutHistory
      .filter(p => ['pending', 'approved'].includes(p.status))
      .reduce((sum, p) => sum + parseFloat(p.requested_amount_usd.toString()), 0);

    return referralStats.totalCashEarnedUsd - pendingPayouts;
  };

  const filteredReferrals = referralDetails.filter(ref => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'completed') return ref.status === 'completed';
    if (filterStatus === 'pending') return ref.status === 'pending';
    return true;
  });

  const getTierBadgeColor = (tierLevel: number | null) => {
    if (!tierLevel) return 'bg-slate-100 text-slate-600';
    if (tierLevel === 1) return 'bg-blue-100 text-blue-700';
    if (tierLevel === 2) return 'bg-purple-100 text-purple-700';
    if (tierLevel === 3) return 'bg-indigo-100 text-indigo-700';
    if (tierLevel === 4) return 'bg-emerald-100 text-emerald-700';
    if (tierLevel === 5) return 'bg-amber-100 text-amber-700';
    if (tierLevel === 6) return 'bg-rose-100 text-rose-700';
    return 'bg-slate-100 text-slate-600';
  };

  const getStatusBadge = (status: string) => {
    if (status === 'completed') return { icon: CheckCircle, color: 'text-emerald-500', bg: 'bg-emerald-50', text: 'Active' };
    if (status === 'pending') return { icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50', text: 'Pending' };
    return { icon: AlertCircle, color: 'text-slate-400', bg: 'bg-slate-50', text: status };
  };

  const getPayoutStatusBadge = (status: string) => {
    if (status === 'paid') return { icon: CheckCircle, color: 'text-emerald-500', bg: 'bg-emerald-50' };
    if (status === 'approved') return { icon: CheckCircle, color: 'text-blue-500', bg: 'bg-blue-50' };
    if (status === 'pending') return { icon: Clock, color: 'text-amber-500', bg: 'bg-amber-50' };
    if (status === 'rejected') return { icon: XCircle, color: 'text-red-500', bg: 'bg-red-50' };
    if (status === 'cancelled') return { icon: XCircle, color: 'text-slate-400', bg: 'bg-slate-50' };
    return { icon: AlertCircle, color: 'text-slate-400', bg: 'bg-slate-50' };
  };

  if (!user) return null;

  return (
    <ClubLayout>
      <div className="space-y-6 pb-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/club/home"
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <ArrowLeft size={20} className="text-slate-600" />
            </Link>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
                Referral Details
              </h1>
              <p className="text-slate-600 text-sm mt-1">
                Track your referrals and manage payouts
              </p>
            </div>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-blue-50 rounded-lg">
                <Users size={20} className="text-blue-500" />
              </div>
              <div className="text-slate-500 text-sm">Total Referrals</div>
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {referralStats?.totalReferrals || 0}
            </div>
          </div>

          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-emerald-50 rounded-lg">
                <CheckCircle size={20} className="text-emerald-500" />
              </div>
              <div className="text-slate-500 text-sm">Completed</div>
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {referralStats?.completedReferrals || 0}
            </div>
          </div>

          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-purple-50 rounded-lg">
                <Coins size={20} className="text-purple-500" />
              </div>
              <div className="text-slate-500 text-sm">PIP Earned</div>
            </div>
            <FormattedTokenNumber
              value={referralStats?.totalTokensEarned || 0}
              wholeClassName="text-2xl font-bold text-slate-900"
              decimalClassName="text-sm text-slate-600"
            />
          </div>

          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-amber-50 rounded-lg">
                <DollarSign size={20} className="text-amber-500" />
              </div>
              <div className="text-slate-500 text-sm">Cash Earned</div>
            </div>
            <div className="text-2xl font-bold text-slate-900">
              ${(referralStats?.totalCashEarnedUsd || 0).toFixed(2)}
            </div>
          </div>
        </div>

        {/* Referral Code & Payout Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Referral Code */}
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-6 shadow-lg">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Your Referral Code</h3>
            <div className="bg-gradient-to-br from-slate-50 to-blue-50 rounded-xl p-5 border border-slate-200/60">
              <div className="text-slate-500 text-sm mb-2">Share your code</div>
              <div className="text-slate-900 text-2xl font-bold font-mono mb-4">
                {referralCode || 'Loading...'}
              </div>
              <button
                onClick={handleCopyReferralLink}
                className="flex items-center justify-center gap-2 w-full px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl transition-all shadow-md hover:shadow-lg active:scale-95"
              >
                {copiedLink ? (
                  <><Check size={18} /> Copied!</>
                ) : (
                  <><Copy size={18} /> Copy Link</>
                )}
              </button>
            </div>
          </div>

          {/* Cash Payout */}
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-6 shadow-lg">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Cash Balance</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-slate-600 text-sm">Total Earned:</span>
                <span className="text-slate-900 font-semibold">
                  ${(referralStats?.totalCashEarnedUsd || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600 text-sm">Pending Payouts:</span>
                <span className="text-amber-600 font-semibold">
                  ${((referralStats?.totalCashEarnedUsd || 0) - getWithdrawableBalance()).toFixed(2)}
                </span>
              </div>
              <div className="border-t border-slate-200 pt-3 flex justify-between items-center">
                <span className="text-slate-900 font-bold">Available:</span>
                <span className="text-emerald-600 text-xl font-bold">
                  ${getWithdrawableBalance().toFixed(2)}
                </span>
              </div>
              <button
                onClick={() => setShowPayoutModal(true)}
                disabled={getWithdrawableBalance() < 100}
                className="w-full px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all shadow-md hover:shadow-lg active:scale-95"
              >
                <div className="flex items-center justify-center gap-2">
                  <TrendingUp size={18} />
                  Request Payout
                </div>
              </button>
              {getWithdrawableBalance() < 100 && (
                <p className="text-xs text-slate-500 text-center">
                  Minimum payout: $100
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Referral List */}
        <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-slate-900">Referrals</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setFilterStatus('all')}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filterStatus === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilterStatus('completed')}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filterStatus === 'completed'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Completed
              </button>
              <button
                onClick={() => setFilterStatus('pending')}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  filterStatus === 'pending'
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Pending
              </button>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-12 text-slate-400">
              Loading referrals...
            </div>
          ) : filteredReferrals.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              {filterStatus === 'all' ? 'No referrals yet. Share your code to get started!' : `No ${filterStatus} referrals`}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredReferrals.map((referral) => {
                const statusInfo = getStatusBadge(referral.status);
                const StatusIcon = statusInfo.icon;

                return (
                  <div
                    key={referral.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-white/60 backdrop-blur-sm border border-slate-200/60 rounded-xl shadow-sm hover:shadow-md transition-all"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`p-2 ${statusInfo.bg} rounded-lg flex-shrink-0`}>
                        <StatusIcon size={20} className={statusInfo.color} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-slate-900 font-medium text-sm truncate">
                          {referral.referee_email}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {referral.referee_tier_level ? (
                            <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${getTierBadgeColor(referral.referee_tier_level)}`}>
                              Tier {referral.referee_tier_level}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">No purchase yet</span>
                          )}
                          <span className="text-slate-400 text-xs">
                            {new Date(referral.referred_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 flex-shrink-0">
                      {referral.status === 'completed' && (
                        <>
                          <div className="text-right">
                            <div className="text-purple-600 font-bold text-sm">
                              {referral.pip_earned.toFixed(0)} PIP
                            </div>
                            <div className="text-emerald-600 font-bold text-sm">
                              ${referral.cash_earned.toFixed(2)}
                            </div>
                          </div>
                        </>
                      )}
                      <span className={`px-3 py-1 rounded-lg text-xs font-semibold ${statusInfo.bg} ${statusInfo.color}`}>
                        {referral.display_status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Payout History */}
        {payoutHistory.length > 0 && (
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-6 shadow-lg">
            <h2 className="text-xl font-bold text-slate-900 mb-6">Payout History</h2>
            <div className="space-y-3">
              {payoutHistory.map((payout) => {
                const statusInfo = getPayoutStatusBadge(payout.status);
                const StatusIcon = statusInfo.icon;

                return (
                  <div
                    key={payout.id}
                    className="flex items-center justify-between p-4 bg-white/60 backdrop-blur-sm border border-slate-200/60 rounded-xl shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 ${statusInfo.bg} rounded-lg`}>
                        <StatusIcon size={20} className={statusInfo.color} />
                      </div>
                      <div>
                        <div className="text-slate-900 font-semibold text-sm">
                          ${parseFloat(payout.requested_amount_usd.toString()).toFixed(2)}
                        </div>
                        <div className="text-slate-500 text-xs mt-0.5">
                          Requested {new Date(payout.requested_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <span className={`px-3 py-1 rounded-lg text-xs font-semibold ${statusInfo.bg} ${statusInfo.color} capitalize`}>
                      {payout.status}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Payout Request Modal */}
      {showPayoutModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold text-slate-900 mb-4">Request Cash Payout</h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Payout Amount (USD)
              </label>
              <input
                type="number"
                min="100"
                step="0.01"
                value={payoutAmount}
                onChange={(e) => setPayoutAmount(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="100.00"
              />
              <p className="text-xs text-slate-500 mt-1">
                Available: ${getWithdrawableBalance().toFixed(2)} (minimum $100)
              </p>
            </div>

            {payoutError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {payoutError}
              </div>
            )}

            {payoutSuccess && (
              <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
                Payout request submitted successfully!
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowPayoutModal(false);
                  setPayoutAmount('');
                  setPayoutError('');
                }}
                className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRequestPayout}
                className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-colors"
              >
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}
    </ClubLayout>
  );
}
