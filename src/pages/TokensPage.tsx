import React, { useState, useEffect } from 'react';
import { Coins, CreditCard, History, Users, Copy, Check, Package, Zap, TrendingUp, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTokenBalance } from '@/hooks/useTokenBalance';
import { tokenMeterService } from '@/services/token-meter-service';
import { supabase } from '@/lib/supabase';
import { NavigationMenu } from '@/components/NavigationMenu';

interface TokenPackage {
  id: string;
  packageType: 'onetime' | 'subscription';
  name: string;
  description: string;
  priceUsd: number;
  tokenAmount: number;
  costPerToken: number;
}

interface ReferralData {
  referralCode: string;
  totalReferrals: number;
  totalRewardsEarned: number;
  monthlyReferrals: number;
  recentReferrals: Array<{
    id: string;
    status: string;
    riskScore: number;
    rewardGranted: boolean;
    createdAt: string;
  }>;
}

export function TokensPage() {
  const { user } = useAuth();
  const { balance, isLoading } = useTokenBalance(user?.id || null);
  const [activeTab, setActiveTab] = useState<'balance' | 'purchase' | 'history' | 'referral'>('balance');
  const [packages, setPackages] = useState<TokenPackage[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [referralData, setReferralData] = useState<ReferralData | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    if (user) {
      loadPackages();
      loadTransactions();
      loadReferralData();
    }
  }, [user]);

  const loadPackages = async () => {
    const { data } = await supabase
      .from('token_packages')
      .select('*')
      .eq('is_active', true)
      .order('display_order');

    if (data) {
      setPackages(data.map(pkg => ({
        id: pkg.id,
        packageType: pkg.package_type,
        name: pkg.name,
        description: pkg.description || '',
        priceUsd: parseFloat(pkg.price_usd),
        tokenAmount: pkg.token_amount,
        costPerToken: parseFloat(pkg.cost_per_token)
      })));
    }
  };

  const loadTransactions = async () => {
    if (!user) return;
    const txns = await tokenMeterService.getTransactionHistory(user.id, 50);
    setTransactions(txns);
  };

  const loadReferralData = async () => {
    if (!user) return;

    const { data: refCode } = await supabase
      .from('referral_codes')
      .select('*')
      .eq('user_id', user.id)
      .single();

    const { data: refTracking } = await supabase
      .from('referral_tracking')
      .select('*')
      .eq('referrer_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (refCode) {
      setReferralData({
        referralCode: refCode.referral_code,
        totalReferrals: refCode.total_referrals || 0,
        totalRewardsEarned: parseFloat(refCode.total_rewards_earned || 0),
        monthlyReferrals: refCode.monthly_referrals || 0,
        recentReferrals: (refTracking || []).map(ref => ({
          id: ref.id,
          status: ref.status,
          riskScore: ref.risk_score || 0,
          rewardGranted: ref.reward_granted || false,
          createdAt: ref.created_at
        }))
      });
    }
  };

  const copyReferralCode = () => {
    if (referralData) {
      const url = `${window.location.origin}/auth?ref=${referralData.referralCode}`;
      navigator.clipboard.writeText(url);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const formatTransactionType = (type: string) => {
    return type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const onetimePackages = packages.filter(p => p.packageType === 'onetime');
  const subscriptionPackages = packages.filter(p => p.packageType === 'subscription');

  return (
    <div className="app-viewport bg-gray-950">
      <NavigationMenu />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Tokens</h1>
          <p className="text-gray-400">Manage your tokens, subscriptions, and referrals</p>
        </div>

        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          <button
            onClick={() => setActiveTab('balance')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'balance'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            <Coins size={18} />
            Balance
          </button>
          <button
            onClick={() => setActiveTab('purchase')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'purchase'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            <CreditCard size={18} />
            Purchase
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'history'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            <History size={18} />
            History
          </button>
          <button
            onClick={() => setActiveTab('referral')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'referral'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            <Users size={18} />
            Referrals
          </button>
        </div>

        {activeTab === 'balance' && (
          <div className="space-y-6">
            <div className="bg-gradient-to-br from-emerald-900/30 to-green-900/30 backdrop-blur-sm border-2 border-emerald-500/30 rounded-lg p-8">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-full bg-emerald-600 flex items-center justify-center">
                  <Coins size={32} className="text-white" />
                </div>
                <div>
                  <div className="text-gray-400 text-sm">Current Balance</div>
                  <div className="text-5xl font-bold text-white">
                    {isLoading ? '...' : balance?.isAdmin ? '∞' : balance?.balance.toFixed(0) || '0'}
                  </div>
                  {balance?.isAdmin && (
                    <div className="text-emerald-400 text-sm font-medium mt-1">Unlimited (Admin)</div>
                  )}
                </div>
              </div>

              {!balance?.isAdmin && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                    <div className="text-gray-400 text-sm mb-1">Lifetime Earned</div>
                    <div className="text-2xl font-bold text-emerald-400">
                      {balance?.lifetimeEarned.toFixed(0) || '0'}
                    </div>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                    <div className="text-gray-400 text-sm mb-1">Lifetime Spent</div>
                    <div className="text-2xl font-bold text-red-400">
                      {balance?.lifetimeSpent.toFixed(0) || '0'}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-4">Token Usage</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Zap size={18} className="text-yellow-400" />
                    <span className="text-gray-300">Trade Evaluation</span>
                  </div>
                  <span className="text-white font-semibold">1 token</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <TrendingUp size={18} className="text-blue-400" />
                    <span className="text-gray-300">Position Analysis</span>
                  </div>
                  <span className="text-white font-semibold">0.5 tokens</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <AlertCircle size={18} className="text-purple-400" />
                    <span className="text-gray-300">Mid-Trade Check</span>
                  </div>
                  <span className="text-white font-semibold">0.25 tokens</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'purchase' && (
          <div className="space-y-8">
            <div>
              <h2 className="text-2xl font-bold text-white mb-2">One-Time Packages</h2>
              <p className="text-gray-400 mb-4">Premium pricing: $0.15 per token</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {onetimePackages.map(pkg => (
                  <div key={pkg.id} className="bg-gray-800 rounded-lg p-6 border border-gray-700 hover:border-emerald-500 transition-all">
                    <div className="flex items-center gap-3 mb-4">
                      <Package size={24} className="text-emerald-400" />
                      <div>
                        <h3 className="text-xl font-bold text-white">{pkg.tokenAmount} Tokens</h3>
                        <p className="text-gray-400 text-sm">{pkg.description}</p>
                      </div>
                    </div>
                    <div className="text-3xl font-bold text-white mb-4">${pkg.priceUsd.toFixed(2)}</div>
                    <button className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg transition-all">
                      Buy Now
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-white mb-2">Subscription Packages</h2>
              <p className="text-gray-400 mb-4">Best value: $0.10 per token (33% savings!)</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {subscriptionPackages.map(pkg => (
                  <div key={pkg.id} className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 backdrop-blur-sm rounded-lg p-6 border-2 border-blue-500/30 hover:border-blue-500 transition-all">
                    <div className="flex items-center gap-3 mb-4">
                      <Zap size={24} className="text-blue-400" />
                      <div>
                        <h3 className="text-xl font-bold text-white">{pkg.tokenAmount} Tokens</h3>
                        <p className="text-gray-400 text-sm">Monthly</p>
                      </div>
                    </div>
                    <div className="text-3xl font-bold text-white mb-1">${pkg.priceUsd.toFixed(2)}</div>
                    <div className="text-gray-400 text-sm mb-4">/month</div>
                    <button className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-all">
                      Subscribe
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <div className="p-6 border-b border-gray-700">
              <h2 className="text-xl font-bold text-white">Transaction History</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-900/50">
                  <tr>
                    <th className="text-left py-3 px-4 text-gray-400 font-medium">Date</th>
                    <th className="text-left py-3 px-4 text-gray-400 font-medium">Type</th>
                    <th className="text-right py-3 px-4 text-gray-400 font-medium">Amount</th>
                    <th className="text-right py-3 px-4 text-gray-400 font-medium">Balance After</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-8 text-gray-500">
                        No transactions yet
                      </td>
                    </tr>
                  ) : (
                    transactions.map(txn => (
                      <tr key={txn.id} className="border-t border-gray-700 hover:bg-gray-700/30">
                        <td className="py-3 px-4 text-gray-300 text-sm">
                          {formatDate(txn.createdAt)}
                        </td>
                        <td className="py-3 px-4 text-white font-medium">
                          {formatTransactionType(txn.transactionType)}
                        </td>
                        <td className={`py-3 px-4 text-right font-semibold ${
                          txn.amount >= 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {txn.amount >= 0 ? '+' : ''}{txn.amount.toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-right text-gray-300">
                          {txn.balanceAfter.toFixed(2)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'referral' && referralData && (
          <div className="space-y-6">
            <div className="bg-gradient-to-br from-purple-900/30 to-pink-900/30 backdrop-blur-sm border-2 border-purple-500/30 rounded-lg p-6">
              <h2 className="text-2xl font-bold text-white mb-4">Share & Earn 5 Tokens</h2>
              <p className="text-gray-300 mb-6">
                Invite friends and you both get 5 tokens! Monthly limit: 5 referrals
              </p>

              <div className="bg-gray-800/50 rounded-lg p-4 mb-4">
                <div className="text-gray-400 text-sm mb-2">Your Referral Code</div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-900 rounded-lg px-4 py-3 font-mono text-2xl font-bold text-emerald-400">
                    {referralData.referralCode}
                  </div>
                  <button
                    onClick={copyReferralCode}
                    className="px-4 py-3 bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-all"
                  >
                    {copiedCode ? <Check size={20} className="text-white" /> : <Copy size={20} className="text-white" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                  <div className="text-gray-400 text-sm mb-1">Total Referrals</div>
                  <div className="text-2xl font-bold text-white">{referralData.totalReferrals}</div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                  <div className="text-gray-400 text-sm mb-1">This Month</div>
                  <div className="text-2xl font-bold text-purple-400">{referralData.monthlyReferrals} / 5</div>
                </div>
                <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                  <div className="text-gray-400 text-sm mb-1">Total Earned</div>
                  <div className="text-2xl font-bold text-emerald-400">{referralData.totalRewardsEarned.toFixed(0)}</div>
                </div>
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
              <div className="p-6 border-b border-gray-700">
                <h2 className="text-xl font-bold text-white">Recent Referrals</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-900/50">
                    <tr>
                      <th className="text-left py-3 px-4 text-gray-400 font-medium">Date</th>
                      <th className="text-left py-3 px-4 text-gray-400 font-medium">Status</th>
                      <th className="text-center py-3 px-4 text-gray-400 font-medium">Risk Score</th>
                      <th className="text-center py-3 px-4 text-gray-400 font-medium">Reward</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referralData.recentReferrals.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center py-8 text-gray-500">
                          No referrals yet. Share your code to get started!
                        </td>
                      </tr>
                    ) : (
                      referralData.recentReferrals.map(ref => (
                        <tr key={ref.id} className="border-t border-gray-700 hover:bg-gray-700/30">
                          <td className="py-3 px-4 text-gray-300 text-sm">
                            {formatDate(ref.createdAt)}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`px-2 py-1 rounded text-xs font-semibold ${
                              ref.status === 'approved' ? 'bg-green-500/20 text-green-400' :
                              ref.status === 'blocked' ? 'bg-red-500/20 text-red-400' :
                              'bg-yellow-500/20 text-yellow-400'
                            }`}>
                              {ref.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center text-white">
                            {ref.riskScore}
                          </td>
                          <td className="py-3 px-4 text-center">
                            {ref.rewardGranted ? (
                              <Check size={18} className="text-green-400 mx-auto" />
                            ) : (
                              <span className="text-gray-500">—</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-gray-300">
                  <strong className="text-white">Fair Referral Policy:</strong> Family members on the same WiFi are welcome!
                  Our anti-fraud system uses multiple factors. Self-referrals and suspicious activity are automatically blocked.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
