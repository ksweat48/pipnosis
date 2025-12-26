import React, { useState, useEffect } from 'react';
import { Coins, CreditCard, History, Users, Copy, Check, Package, Zap, TrendingUp, AlertCircle, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTokenBalance } from '@/hooks/useTokenBalance';
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { tokenMeterService } from '@/services/token-meter-service';
import { supabase } from '@/lib/supabase';
import { NavigationMenu } from '@/components/NavigationMenu';
import { BottomNavigation } from '@/components/BottomNavigation';

interface TokenPackage {
  id: string;
  packageType: 'onetime' | 'subscription';
  name: string;
  description: string;
  priceUsd: number;
  tokenAmount: number;
  costPerToken: number;
  badge?: string;
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

export function CreditsPage() {
  const { user } = useAuth();
  const { balance, isLoading } = useTokenBalance(user?.id || null);
  const [activeTab, setActiveTab] = useState<'purchase' | 'history' | 'referral'>('purchase');
  const [packages, setPackages] = useState<TokenPackage[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [referralData, setReferralData] = useState<ReferralData | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const pullToRefresh = usePullToRefresh({
    onRefresh: async () => {
      window.location.reload();
    },
    enabled: true
  });

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
        costPerToken: parseFloat(pkg.cost_per_token),
        badge: pkg.badge || undefined
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
    <div className="app-viewport bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950" ref={pullToRefresh.containerRef}>
      <PullToRefreshIndicator
        isPulling={pullToRefresh.isPulling}
        isRefreshing={pullToRefresh.isRefreshing}
        pullDistance={pullToRefresh.pullDistance}
        threshold={pullToRefresh.threshold}
      />
      <NavigationMenu />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          <button
            onClick={() => setActiveTab('purchase')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all whitespace-nowrap ${
              activeTab === 'purchase'
                ? 'bg-gradient-to-r from-emerald-600 to-blue-600 text-white shadow-lg shadow-emerald-500/25'
                : 'bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 text-gray-400 hover:text-white hover:border-emerald-500/50'
            }`}
          >
            <CreditCard size={18} />
            Purchase
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all whitespace-nowrap ${
              activeTab === 'history'
                ? 'bg-gradient-to-r from-emerald-600 to-blue-600 text-white shadow-lg shadow-emerald-500/25'
                : 'bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 text-gray-400 hover:text-white hover:border-emerald-500/50'
            }`}
          >
            <History size={18} />
            History
          </button>
          <button
            onClick={() => setActiveTab('referral')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all whitespace-nowrap ${
              activeTab === 'referral'
                ? 'bg-gradient-to-r from-emerald-600 to-blue-600 text-white shadow-lg shadow-emerald-500/25'
                : 'bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 text-gray-400 hover:text-white hover:border-emerald-500/50'
            }`}
          >
            <Users size={18} />
            Referrals
          </button>
        </div>

        {activeTab === 'purchase' && (
          <div className="space-y-8">
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-green-500 rounded-xl opacity-20 group-hover:opacity-30 transition duration-300 blur" />

              <div className="relative bg-gradient-to-br from-emerald-900/40 to-green-900/40 backdrop-blur-xl border-2 border-emerald-500/40 rounded-xl p-6 shadow-2xl">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <div className="absolute inset-0 bg-emerald-500 rounded-full blur opacity-50 animate-pulse" />
                      <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-emerald-600 to-green-600 flex items-center justify-center shadow-lg">
                        <Coins size={32} className="text-white" />
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-300 text-sm flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-emerald-400 animate-pulse" />
                        Current Balance
                      </div>
                      <div className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-green-400">
                        {isLoading ? '...' : balance?.isAdmin ? '∞' : balance?.balance.toFixed(0) || '0'}
                      </div>
                      {balance?.isAdmin && (
                        <div className="text-emerald-400 text-sm font-medium mt-1">Unlimited (Admin)</div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 md:border-l md:border-emerald-500/30 md:pl-6">
                    <div className="text-center md:text-left">
                      <div className="text-gray-300 text-sm mb-1 flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-emerald-400" />
                        Credit Usage
                      </div>
                      <p className="text-gray-300 text-lg font-medium">1 credit per trade</p>
                    </div>
                  </div>
                </div>

                {!balance?.isAdmin && (
                  <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-emerald-500/30">
                    <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-gray-700/50 hover:border-emerald-500/30 transition-all">
                      <div className="text-gray-400 text-sm mb-1">Lifetime Earned</div>
                      <div className="text-2xl font-bold text-emerald-400">
                        {balance?.lifetimeEarned.toFixed(0) || '0'}
                      </div>
                    </div>
                    <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-gray-700/50 hover:border-red-500/30 transition-all">
                      <div className="text-gray-400 text-sm mb-1">Lifetime Spent</div>
                      <div className="text-2xl font-bold text-red-400">
                        {balance?.lifetimeSpent.toFixed(0) || '0'}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div>
              <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-green-400 mb-2">One-Time Packages</h2>
              <p className="text-gray-400 mb-4 flex items-center gap-2">
                <Package className="w-4 h-4 text-emerald-400" />
                Premium pricing: $0.25 per credit
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {onetimePackages.map(pkg => (
                  <div key={pkg.id} className="relative group">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-green-500 rounded-xl opacity-10 group-hover:opacity-30 transition duration-300 blur" />

                    <div className="relative bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-xl p-6 border border-gray-700/50 hover:border-emerald-500/50 transition-all shadow-xl">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-emerald-500/10 rounded-lg">
                          <Package size={24} className="text-emerald-400" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-xl font-bold text-white">{pkg.tokenAmount} Credits</h3>
                            {pkg.tokenAmount > 60 && (
                              <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-500/20 border border-emerald-500/40 rounded-full text-emerald-400 text-xs font-semibold">
                                <Sparkles className="w-3 h-3" />
                                +{pkg.tokenAmount - (pkg.priceUsd === 25 ? 100 : 200)} Bonus
                              </span>
                            )}
                          </div>
                          <p className="text-gray-400 text-sm">{pkg.description}</p>
                        </div>
                      </div>
                      <div className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-green-400 mb-4">${pkg.priceUsd.toFixed(2)}</div>
                      <button className="w-full px-4 py-3 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-white font-semibold rounded-lg transition-all shadow-lg hover:shadow-emerald-500/25 hover:scale-105 active:scale-95">
                        Buy Now
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400 mb-2">Subscription Packages</h2>
              <p className="text-gray-400 mb-4 flex items-center gap-2">
                <Zap className="w-4 h-4 text-blue-400 animate-pulse" />
                Best value: $0.20 per credit (20% savings!)
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {subscriptionPackages.map(pkg => (
                  <div key={pkg.id} className="relative group">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl opacity-20 group-hover:opacity-40 transition duration-300 blur" />

                    <div className="relative bg-gradient-to-br from-blue-900/40 to-purple-900/40 backdrop-blur-xl rounded-xl p-6 border-2 border-blue-500/30 hover:border-blue-500/60 transition-all shadow-2xl">
                      {pkg.badge && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full text-white text-xs font-bold shadow-lg flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          {pkg.badge}
                        </div>
                      )}
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-blue-500/20 rounded-lg">
                          <Zap size={24} className="text-blue-400" />
                        </div>
                        <div>
                          <h3 className="text-xl font-bold text-white">{pkg.tokenAmount} Credits</h3>
                          <p className="text-gray-300 text-sm">Monthly</p>
                        </div>
                      </div>
                      <div className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400 mb-1">${pkg.priceUsd.toFixed(2)}</div>
                      <div className="text-gray-400 text-sm mb-4">/month</div>
                      <button className="w-full px-4 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold rounded-lg transition-all shadow-lg hover:shadow-blue-500/25 hover:scale-105 active:scale-95">
                        Subscribe
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-xl opacity-10 group-hover:opacity-20 transition duration-300 blur" />

            <div className="relative bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-xl border border-gray-700/50 overflow-hidden shadow-2xl">
              <div className="p-6 border-b border-gray-700/50">
                <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-blue-400 flex items-center gap-2">
                  <History className="w-5 h-5 text-emerald-400" />
                  Transaction History
                </h2>
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
                        <td colSpan={4} className="text-center py-12">
                          <div className="flex flex-col items-center gap-3">
                            <div className="p-4 bg-gray-700/30 rounded-full">
                              <History className="w-8 h-8 text-gray-500" />
                            </div>
                            <p className="text-gray-500">No transactions yet</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      transactions.map(txn => (
                        <tr key={txn.id} className="border-t border-gray-700/50 hover:bg-gray-700/20 transition-colors">
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
          </div>
        )}

        {activeTab === 'referral' && referralData && (
          <div className="space-y-6">
            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl opacity-20 group-hover:opacity-30 transition duration-300 blur" />

              <div className="relative bg-gradient-to-br from-purple-900/40 to-pink-900/40 backdrop-blur-xl border-2 border-purple-500/30 rounded-xl p-6 shadow-2xl">
                <h2 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400 mb-4 flex items-center gap-2">
                  <Users className="w-6 h-6 text-purple-400" />
                  Share & Earn 5 Credits
                </h2>
                <p className="text-gray-300 mb-6 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  Invite friends and you both get 5 credits! Monthly limit: 5 referrals
                </p>

                <div className="bg-gray-800/70 backdrop-blur-sm rounded-xl p-4 mb-4 border border-gray-700/50">
                  <div className="text-gray-400 text-sm mb-2">Your Referral Code</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-900/80 backdrop-blur-sm rounded-lg px-4 py-3 font-mono text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 border border-purple-500/30">
                      {referralData.referralCode}
                    </div>
                    <button
                      onClick={copyReferralCode}
                      className="px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 rounded-lg transition-all shadow-lg hover:shadow-purple-500/25 hover:scale-105 active:scale-95"
                    >
                      {copiedCode ? <Check size={20} className="text-white" /> : <Copy size={20} className="text-white" />}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-gray-700/50 hover:border-purple-500/30 transition-all">
                    <div className="text-gray-400 text-sm mb-1">Total Referrals</div>
                    <div className="text-2xl font-bold text-white">{referralData.totalReferrals}</div>
                  </div>
                  <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-purple-500/30 hover:border-purple-500/50 transition-all">
                    <div className="text-gray-400 text-sm mb-1">This Month</div>
                    <div className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400">{referralData.monthlyReferrals} / 5</div>
                  </div>
                  <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-emerald-500/30 hover:border-emerald-500/50 transition-all">
                    <div className="text-gray-400 text-sm mb-1">Total Earned</div>
                    <div className="text-2xl font-bold text-emerald-400">{referralData.totalRewardsEarned.toFixed(0)}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl opacity-10 group-hover:opacity-20 transition duration-300 blur" />

              <div className="relative bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-xl border border-gray-700/50 overflow-hidden shadow-2xl">
                <div className="p-6 border-b border-gray-700/50">
                  <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400 flex items-center gap-2">
                    <Users className="w-5 h-5 text-purple-400" />
                    Recent Referrals
                  </h2>
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
                          <td colSpan={4} className="text-center py-12">
                            <div className="flex flex-col items-center gap-3">
                              <div className="p-4 bg-purple-500/10 rounded-full">
                                <Users className="w-8 h-8 text-purple-400" />
                              </div>
                              <p className="text-gray-500">No referrals yet. Share your code to get started!</p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        referralData.recentReferrals.map(ref => (
                          <tr key={ref.id} className="border-t border-gray-700/50 hover:bg-gray-700/20 transition-colors">
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
            </div>

            <div className="relative group">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-xl opacity-10 transition duration-300 blur" />

              <div className="relative bg-yellow-900/20 backdrop-blur-sm border border-yellow-500/30 rounded-xl p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle size={20} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-gray-300">
                    <strong className="text-white">Fair Referral Policy:</strong> Family members on the same WiFi are welcome!
                    Our anti-fraud system uses multiple factors. Self-referrals and suspicious activity are automatically blocked.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <BottomNavigation />
    </div>
  );
}
