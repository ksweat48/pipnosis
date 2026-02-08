/**
 * CLUB HOME PAGE
 *
 * Main dashboard for Club members featuring:
 * - Token balance and stats display
 * - Referral code generator and stats
 * - Recent transactions history
 * - Quick access to all Club features
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Coins, TrendingUp, Users, Copy, Check, ExternalLink, History, Gift, Crown } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { ClubLayout } from '@/components/ClubLayout';
import { clubTokenLedgerService, type ClubTokenBalance, type TokenTransaction } from '@/services/club-token-ledger-service';
import { clubReferralService, type ReferralStats } from '@/services/club-referral-service';
import { clubMembershipService, type UserMembership } from '@/services/club-membership-service';

export function ClubHomePage() {
  const { user } = useAuth();
  const [tokenBalance, setTokenBalance] = useState<ClubTokenBalance | null>(null);
  const [membership, setMembership] = useState<UserMembership | null>(null);
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const [referralCode, setReferralCode] = useState<string>('');
  const [transactions, setTransactions] = useState<TokenTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (!user) return;

    loadDashboardData();

    // Subscribe to token balance updates
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
      const [balance, membershipData, stats, code, txHistory] = await Promise.all([
        clubTokenLedgerService.getBalance(user.id),
        clubMembershipService.getUserMembership(user.id),
        clubReferralService.getReferralStats(user.id),
        clubReferralService.getUserReferralCode(user.id),
        clubTokenLedgerService.getTransactionHistory(user.id, 10)
      ]);

      setTokenBalance(balance);
      setMembership(membershipData);
      setReferralStats(stats);
      setReferralCode(code);
      setTransactions(txHistory);
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
      <div className="space-y-8">
        {/* Welcome Banner */}
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl opacity-20 group-hover:opacity-30 transition blur-lg" />

          <div className="relative bg-gradient-to-br from-gray-900/95 to-slate-900/95 backdrop-blur-xl border-2 border-purple-500/30 rounded-2xl p-8">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400 mb-2">
                  Welcome to Pipnosis Club
                </h1>
                <p className="text-purple-300">
                  {membership ? `${membership.tierName} Member` : 'Member Dashboard'}
                </p>
              </div>

              {membership && (
                <div className="flex items-center gap-3 px-6 py-3 bg-purple-900/30 border border-purple-500/30 rounded-xl">
                  <Crown size={28} className="text-purple-400" />
                  <div>
                    <div className="text-purple-300 text-sm">Tier Level</div>
                    <div className="text-purple-400 font-bold text-2xl">{membership.tierLevel}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Token Balance Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl opacity-20 group-hover:opacity-30 transition blur" />
            <div className="relative bg-gray-900/95 border border-purple-500/30 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-purple-900/30 rounded-lg">
                  <Coins size={24} className="text-purple-400" />
                </div>
                <div>
                  <div className="text-purple-300 text-sm">Available Tokens</div>
                  <div className="text-white text-2xl font-bold">
                    {tokenBalance?.availableTokens.toLocaleString() || '0'}
                  </div>
                </div>
              </div>
              <div className="text-purple-400 text-xs">
                {tokenBalance?.lockedTokens || 0} locked for membership
              </div>
            </div>
          </div>

          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-600 to-green-600 rounded-xl opacity-20 group-hover:opacity-30 transition blur" />
            <div className="relative bg-gray-900/95 border border-emerald-500/30 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-emerald-900/30 rounded-lg">
                  <TrendingUp size={24} className="text-emerald-400" />
                </div>
                <div>
                  <div className="text-emerald-300 text-sm">Lifetime Earned</div>
                  <div className="text-white text-2xl font-bold">
                    {tokenBalance?.lifetimeEarned.toLocaleString() || '0'}
                  </div>
                </div>
              </div>
              <div className="text-emerald-400 text-xs">
                {tokenBalance?.lifetimeSpent || 0} spent
              </div>
            </div>
          </div>

          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-xl opacity-20 group-hover:opacity-30 transition blur" />
            <div className="relative bg-gray-900/95 border border-blue-500/30 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-blue-900/30 rounded-lg">
                  <Users size={24} className="text-blue-400" />
                </div>
                <div>
                  <div className="text-blue-300 text-sm">Referrals</div>
                  <div className="text-white text-2xl font-bold">
                    {referralStats?.completedReferrals || 0}
                  </div>
                </div>
              </div>
              <div className="text-blue-400 text-xs">
                {referralStats?.pendingReferrals || 0} pending
              </div>
            </div>
          </div>
        </div>

        {/* Referral Section */}
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl opacity-20 group-hover:opacity-30 transition blur-lg" />

          <div className="relative bg-gradient-to-br from-gray-900/95 to-slate-900/95 backdrop-blur-xl border-2 border-purple-500/30 rounded-2xl p-8">
            <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
              <Users size={28} className="text-purple-400" />
              Your Referral Code
            </h2>

            <div className="bg-gray-800/50 rounded-xl p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-purple-300 text-sm mb-2">Share your code</div>
                  <div className="text-white text-3xl font-bold font-mono">{referralCode || 'Loading...'}</div>
                </div>

                <button
                  onClick={handleCopyReferralLink}
                  className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-semibold rounded-xl transition-all shadow-lg hover:shadow-purple-500/25 hover:scale-105 active:scale-95"
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

              <div className="text-purple-400 text-sm">
                Invite friends and earn rewards when they join the Club
              </div>
            </div>

            {/* Referral Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-800/30 rounded-xl p-4">
                <div className="text-purple-300 text-xs mb-1">Total Referrals</div>
                <div className="text-white text-xl font-bold">{referralStats?.totalReferrals || 0}</div>
              </div>
              <div className="bg-gray-800/30 rounded-xl p-4">
                <div className="text-emerald-300 text-xs mb-1">Completed</div>
                <div className="text-white text-xl font-bold">{referralStats?.completedReferrals || 0}</div>
              </div>
              <div className="bg-gray-800/30 rounded-xl p-4">
                <div className="text-purple-300 text-xs mb-1">Tokens Earned</div>
                <div className="text-white text-xl font-bold">{referralStats?.totalTokensEarned || 0}</div>
              </div>
              <div className="bg-gray-800/30 rounded-xl p-4">
                <div className="text-purple-300 text-xs mb-1">Cash Earned</div>
                <div className="text-white text-xl font-bold">${referralStats?.totalCashEarnedUsd.toFixed(2) || '0.00'}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl opacity-20 group-hover:opacity-30 transition blur-lg" />

          <div className="relative bg-gradient-to-br from-gray-900/95 to-slate-900/95 backdrop-blur-xl border-2 border-purple-500/30 rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                <History size={28} className="text-purple-400" />
                Recent Transactions
              </h2>
              <Link
                to="/club/transactions"
                className="text-purple-400 hover:text-purple-300 text-sm flex items-center gap-2"
              >
                View All
                <ExternalLink size={16} />
              </Link>
            </div>

            {transactions.length === 0 ? (
              <div className="text-center py-12 text-purple-300">
                No transactions yet
              </div>
            ) : (
              <div className="space-y-3">
                {transactions.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between p-4 bg-gray-800/30 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-purple-900/30 rounded-lg">
                        <Coins size={20} className="text-purple-400" />
                      </div>
                      <div>
                        <div className="text-white font-medium">
                          {clubTokenLedgerService.formatTransactionType(tx.transactionType)}
                        </div>
                        <div className="text-purple-300 text-xs">
                          {new Date(tx.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    <div className={`font-bold text-lg ${tx.amount > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link
            to="/club/chat"
            className="relative group block"
          >
            <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl opacity-20 group-hover:opacity-40 transition blur" />
            <div className="relative bg-gray-900/95 border border-purple-500/30 rounded-xl p-6 hover:border-purple-500/50 transition-all">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-purple-900/30 rounded-xl">
                  <Gift size={32} className="text-purple-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white mb-1">Member Chat</h3>
                  <p className="text-purple-300 text-sm">Connect with other members</p>
                </div>
              </div>
            </div>
          </Link>

          <Link
            to="/club/rewards"
            className="relative group block"
          >
            <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl opacity-20 group-hover:opacity-40 transition blur" />
            <div className="relative bg-gray-900/95 border border-purple-500/30 rounded-xl p-6 hover:border-purple-500/50 transition-all">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-purple-900/30 rounded-xl">
                  <Gift size={32} className="text-purple-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white mb-1">Rewards</h3>
                  <p className="text-purple-300 text-sm">View staking and rewards</p>
                </div>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </ClubLayout>
  );
}
