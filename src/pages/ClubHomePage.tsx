import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Coins, TrendingUp, Users, Copy, Check, ExternalLink, History, Gift, Crown, MessageSquare, Flame } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { ClubLayout } from '@/components/ClubLayout';
import { clubTokenLedgerService, type ClubTokenBalance, type TokenTransaction } from '@/services/club-token-ledger-service';
import { clubReferralService, type ReferralStats } from '@/services/club-referral-service';
import { clubMembershipService, type UserMembership, type UserCreditDiscount } from '@/services/club-membership-service';
import { getDisplayTradeCost, TOKENOMICS } from '@/config/tokenomics-constants';

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ClubHomePage() {
  const { user } = useAuth();
  const [tokenBalance, setTokenBalance] = useState<ClubTokenBalance | null>(null);
  const [membership, setMembership] = useState<UserMembership | null>(null);
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const [discount, setDiscount] = useState<UserCreditDiscount | null>(null);
  const [referralCode, setReferralCode] = useState<string>('');
  const [transactions, setTransactions] = useState<TokenTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (!user) return;

    loadDashboardData();

    const unsubscribe = clubTokenLedgerService.subscribeToBalance(user.id, (balance) => {
      setTokenBalance(balance);
    });

    return () => {
      unsubscribe();
    };
  }, [user]);

  const loadDashboardData = async () => {
    if (!user) return;

    try {
      const [balance, membershipData, stats, code, txHistory, discountData] = await Promise.all([
        clubTokenLedgerService.getBalance(user.id),
        clubMembershipService.getUserMembership(user.id),
        clubReferralService.getReferralStats(user.id),
        clubReferralService.getUserReferralCode(user.id),
        clubTokenLedgerService.getTransactionHistory(user.id, 10),
        clubMembershipService.getUserCreditDiscount(user.id)
      ]);

      setTokenBalance(balance);
      setMembership(membershipData);
      setReferralStats(stats);
      setReferralCode(code);
      setTransactions(txHistory);
      setDiscount(discountData);
    } catch (error) {
      console.error('[ClubHome] Error loading dashboard:', error);
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

  if (!user) return null;

  return (
    <ClubLayout>
      <div className="space-y-4 sm:space-y-8 pb-8">
        {/* Welcome Banner */}
        <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl sm:rounded-2xl p-4 sm:p-8 shadow-lg">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-3xl font-bold text-slate-900 mb-1">
                Welcome to Pipnosis Club
              </h1>
              <p className="text-slate-600 text-sm sm:text-base">
                {membership ? `${membership.tierName} Member` : 'Member Dashboard'}
              </p>
            </div>

            {membership && (
              <div className="hidden sm:flex items-center gap-3 px-6 py-3 bg-white/80 backdrop-blur-sm border border-slate-200/60 rounded-xl shadow-sm flex-shrink-0">
                <Crown size={28} className="text-amber-500" />
                <div>
                  <div className="text-slate-500 text-sm">Tier Level</div>
                  <div className="text-slate-900 font-bold text-2xl">{membership.tierLevel}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* PIP Balance Cards */}
        <div className="grid grid-cols-3 sm:grid-cols-3 gap-2 sm:gap-6">
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-3 sm:p-6 shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2 sm:mb-4">
              <div className="p-2 sm:p-3 bg-amber-50 rounded-lg w-fit">
                <Coins size={18} className="text-amber-500 sm:w-6 sm:h-6" />
              </div>
              <div>
                <div className="text-slate-500 text-[11px] sm:text-sm">PIP Balance</div>
                <div className="text-slate-900 text-lg sm:text-2xl font-bold">
                  {fmt(tokenBalance?.availableTokens || 0)}
                </div>
              </div>
            </div>
            <div className="text-slate-400 text-[10px] sm:text-xs">
              {fmt(tokenBalance?.lockedTokens || 0)} locked
            </div>
          </div>

          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-3 sm:p-6 shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2 sm:mb-4">
              <div className="p-2 sm:p-3 bg-emerald-50 rounded-lg w-fit">
                <TrendingUp size={18} className="text-emerald-500 sm:w-6 sm:h-6" />
              </div>
              <div>
                <div className="text-slate-500 text-[11px] sm:text-sm">Earned</div>
                <div className="text-slate-900 text-lg sm:text-2xl font-bold">
                  {fmt(tokenBalance?.lifetimeEarned || 0)}
                </div>
              </div>
            </div>
            <div className="text-slate-400 text-[10px] sm:text-xs">
              {fmt(tokenBalance?.lifetimeSpent || 0)} spent
            </div>
          </div>

          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-3 sm:p-6 shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-2 sm:mb-4">
              <div className="p-2 sm:p-3 bg-blue-50 rounded-lg w-fit">
                <Users size={18} className="text-blue-500 sm:w-6 sm:h-6" />
              </div>
              <div>
                <div className="text-slate-500 text-[11px] sm:text-sm">Referrals</div>
                <div className="text-slate-900 text-lg sm:text-2xl font-bold">
                  {referralStats?.completedReferrals || 0}
                </div>
              </div>
            </div>
            <div className="text-slate-400 text-[10px] sm:text-xs">
              {referralStats?.pendingReferrals || 0} pending
            </div>
          </div>
        </div>

        {/* Trade Discount Card */}
        {discount && discount.discountPct > 0 && (
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-lg">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 bg-emerald-50 rounded-xl">
                <Flame size={22} className="text-emerald-500" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900">Trade Discount Active</h3>
                <p className="text-slate-500 text-xs sm:text-sm">{discount.tierName} tier benefit</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-emerald-50/60 border border-emerald-100 rounded-xl p-3 text-center">
                <div className="text-emerald-600 text-xl sm:text-2xl font-bold">
                  {Math.round(discount.discountPct * 100)}%
                </div>
                <div className="text-slate-500 text-[10px] sm:text-xs mt-0.5">Discount</div>
              </div>
              <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-center">
                <div className="text-slate-900 text-xl sm:text-2xl font-bold">
                  {getDisplayTradeCost(discount.discountPct)}
                </div>
                <div className="text-slate-500 text-[10px] sm:text-xs mt-0.5">Credits/Trade</div>
              </div>
              <div className="bg-amber-50/60 border border-amber-100 rounded-xl p-3 text-center">
                <div className="text-amber-600 text-xl sm:text-2xl font-bold">
                  {(TOKENOMICS.CREDITS.BASE_TRADE_COST - Number(getDisplayTradeCost(discount.discountPct))).toFixed(1)}
                </div>
                <div className="text-slate-500 text-[10px] sm:text-xs mt-0.5">PIP Burn/Trade</div>
              </div>
            </div>
          </div>
        )}

        {/* Referral Section */}
        <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl sm:rounded-2xl p-4 sm:p-8 shadow-lg">
          <h2 className="text-lg sm:text-2xl font-bold text-slate-900 mb-4 sm:mb-6 flex items-center gap-2 sm:gap-3">
            <Users size={22} className="text-slate-700 sm:w-7 sm:h-7" />
            Your Referral Code
          </h2>

          <div className="bg-gradient-to-br from-slate-50 to-blue-50 rounded-xl p-4 sm:p-6 mb-4 sm:mb-6 border border-slate-200/60 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mb-3 sm:mb-4">
              <div>
                <div className="text-slate-500 text-xs sm:text-sm mb-1">Share your code</div>
                <div className="text-slate-900 text-2xl sm:text-3xl font-bold font-mono">{referralCode || 'Loading...'}</div>
              </div>

              <button
                onClick={handleCopyReferralLink}
                className="flex items-center justify-center gap-2 px-5 py-2.5 sm:px-6 sm:py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl transition-all shadow-md hover:shadow-lg active:scale-95 w-full sm:w-auto"
              >
                {copiedLink ? (
                  <>
                    <Check size={18} />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy size={18} />
                    Copy Link
                  </>
                )}
              </button>
            </div>

            <div className="text-slate-600 text-xs sm:text-sm">
              Invite friends and earn rewards when they join the Club
            </div>
          </div>

          {/* Referral Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
            <div className="bg-white/60 backdrop-blur-sm border border-slate-200/60 rounded-xl p-3 sm:p-4 shadow-sm">
              <div className="text-slate-500 text-[10px] sm:text-xs mb-1">Total Referrals</div>
              <div className="text-slate-900 text-lg sm:text-xl font-bold">{referralStats?.totalReferrals || 0}</div>
            </div>
            <div className="bg-white/60 backdrop-blur-sm border border-slate-200/60 rounded-xl p-3 sm:p-4 shadow-sm">
              <div className="text-slate-500 text-[10px] sm:text-xs mb-1">Completed</div>
              <div className="text-slate-900 text-lg sm:text-xl font-bold">{referralStats?.completedReferrals || 0}</div>
            </div>
            <div className="bg-white/60 backdrop-blur-sm border border-slate-200/60 rounded-xl p-3 sm:p-4 shadow-sm">
              <div className="text-slate-500 text-[10px] sm:text-xs mb-1">PIP Earned</div>
              <div className="text-slate-900 text-lg sm:text-xl font-bold">{fmt(referralStats?.totalTokensEarned || 0)}</div>
            </div>
            <div className="bg-white/60 backdrop-blur-sm border border-slate-200/60 rounded-xl p-3 sm:p-4 shadow-sm">
              <div className="text-slate-500 text-[10px] sm:text-xs mb-1">Cash Earned</div>
              <div className="text-slate-900 text-lg sm:text-xl font-bold">${(referralStats?.totalCashEarnedUsd || 0).toFixed(2)}</div>
            </div>
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl sm:rounded-2xl p-4 sm:p-8 shadow-lg">
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <h2 className="text-lg sm:text-2xl font-bold text-slate-900 flex items-center gap-2 sm:gap-3">
              <History size={22} className="text-slate-700 sm:w-7 sm:h-7" />
              Recent Transactions
            </h2>
            <Link
              to="/club/transactions"
              className="text-slate-600 hover:text-slate-900 text-xs sm:text-sm flex items-center gap-1"
            >
              View All
              <ExternalLink size={14} />
            </Link>
          </div>

          {transactions.length === 0 ? (
            <div className="text-center py-8 sm:py-12 text-slate-400 text-sm">
              No transactions yet
            </div>
          ) : (
            <div className="space-y-2 sm:space-y-3">
              {transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between p-3 sm:p-4 bg-white/60 backdrop-blur-sm border border-slate-200/60 rounded-xl shadow-sm">
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                    <div className="p-1.5 sm:p-2 bg-slate-100 rounded-lg flex-shrink-0">
                      <Coins size={16} className="text-slate-600 sm:w-5 sm:h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-slate-900 font-medium text-sm sm:text-base truncate">
                        {clubTokenLedgerService.formatTransactionType(tx.transactionType)}
                      </div>
                      <div className="text-slate-400 text-[10px] sm:text-xs">
                        {new Date(tx.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  <div className={`font-bold text-base sm:text-lg flex-shrink-0 ml-2 ${tx.amount > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {tx.amount > 0 ? '+' : ''}{fmt(tx.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3 sm:gap-6">
          <Link
            to="/club/chat"
            className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-4 sm:p-6 shadow-md hover:shadow-lg transition-all active:scale-[0.98] group"
          >
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
              <div className="p-3 sm:p-4 bg-blue-50 rounded-xl group-hover:bg-blue-100 transition-colors">
                <MessageSquare size={24} className="text-blue-500 sm:w-8 sm:h-8" />
              </div>
              <div>
                <h3 className="text-base sm:text-xl font-bold text-slate-900 mb-0.5">Chat</h3>
                <p className="text-slate-600 text-xs sm:text-sm">Connect with members</p>
              </div>
            </div>
          </Link>

          <Link
            to="/club/rewards"
            className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-4 sm:p-6 shadow-md hover:shadow-lg transition-all active:scale-[0.98] group"
          >
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
              <div className="p-3 sm:p-4 bg-amber-50 rounded-xl group-hover:bg-amber-100 transition-colors">
                <Gift size={24} className="text-amber-500 sm:w-8 sm:h-8" />
              </div>
              <div>
                <h3 className="text-base sm:text-xl font-bold text-slate-900 mb-0.5">Rewards</h3>
                <p className="text-slate-600 text-xs sm:text-sm">Staking & rewards</p>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </ClubLayout>
  );
}
