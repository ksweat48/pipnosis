import React, { useState, useEffect } from 'react';
import { Coins, CreditCard, History, Package, Zap, TrendingUp, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useCreditBalance } from '@/hooks/useCreditBalance';
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { creditMeterService } from '@/services/credit-meter-service';
import { supabase } from '@/lib/supabase';
import { NavigationMenu } from '@/components/NavigationMenu';
import { BottomNavigation } from '@/components/BottomNavigation';
import { CreditUsageAnalytics } from '@/components/CreditUsageAnalytics';

interface CreditPackage {
  id: string;
  packageType: 'onetime' | 'subscription';
  name: string;
  description: string;
  priceUsd: number;
  creditAmount: number;
  costPerToken: number;
  badge?: string;
}

export function CreditsPage() {
  const { user } = useAuth();
  const { balance, isLoading } = useCreditBalance(user?.id || null);
  const [activeTab, setActiveTab] = useState<'purchase' | 'history'>('purchase');
  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [processingPayment, setProcessingPayment] = useState<string | null>(null);

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
        creditAmount: pkg.token_amount,
        costPerToken: parseFloat(pkg.cost_per_token),
        badge: pkg.badge || undefined
      })));
    }
  };

  const loadTransactions = async () => {
    if (!user) return;
    const txns = await creditMeterService.getTransactionHistory(user.id, 50);
    setTransactions(txns);
  };

  const handlePurchaseClick = async (pkg: CreditPackage) => {
    if (!user || !pkg.id) {
      alert('Please log in to purchase credits');
      return;
    }

    const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
    if (!stripePublishableKey) {
      alert('Payment system not configured. Please contact support.');
      return;
    }

    setProcessingPayment(pkg.id);

    try {
      const response = await fetch('/.netlify/functions/stripe-create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          priceId: pkg.id,
          packageId: pkg.id,
          userId: user.id,
          mode: pkg.packageType === 'subscription' ? 'subscription' : 'payment',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create checkout session');
      }

      const { url } = await response.json();

      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error('Purchase error:', error);
      alert('Failed to process purchase. Please try again.');
      setProcessingPayment(null);
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
                Starting at $0.25 per credit
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {onetimePackages.map(pkg => (
                  <div key={pkg.id} className="relative group">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-green-500 rounded-xl opacity-10 group-hover:opacity-30 transition duration-300 blur" />

                    <div className="relative bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-xl rounded-xl p-6 border border-gray-700/50 hover:border-emerald-500/50 transition-all shadow-xl">
                      {pkg.badge && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full text-white text-xs font-bold shadow-lg flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          {pkg.badge}
                        </div>
                      )}
                      <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-emerald-500/10 rounded-lg">
                          <Package size={24} className="text-emerald-400" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-xl font-bold text-white">{pkg.creditAmount} Credits</h3>
                            {pkg.creditAmount > 100 && (
                              <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-500/20 border border-emerald-500/40 rounded-full text-emerald-400 text-xs font-semibold">
                                <Sparkles className="w-3 h-3" />
                                +{pkg.creditAmount === 210 ? 10 : 20} Bonus
                              </span>
                            )}
                          </div>
                          <p className="text-gray-400 text-sm">{pkg.description}</p>
                        </div>
                      </div>
                      <div className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-green-400 mb-4">${pkg.priceUsd.toFixed(2)}</div>
                      <button
                        onClick={() => handlePurchaseClick(pkg)}
                        disabled={processingPayment === pkg.id || balance?.isAdmin}
                        className="w-full px-4 py-3 bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all shadow-lg hover:shadow-emerald-500/25 hover:scale-105 active:scale-95 disabled:scale-100"
                      >
                        {processingPayment === pkg.id ? 'Processing...' : balance?.isAdmin ? 'Admin Account' : 'Buy Now'}
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
                Best value: Starting at $0.20 per credit (20% savings!)
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
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="text-xl font-bold text-white">{pkg.creditAmount} Credits</h3>
                            {pkg.creditAmount > 100 && (
                              <span className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/20 border border-blue-500/40 rounded-full text-blue-400 text-xs font-semibold">
                                <Sparkles className="w-3 h-3" />
                                +{pkg.creditAmount === 210 ? 10 : 20} Bonus
                              </span>
                            )}
                          </div>
                          <p className="text-gray-300 text-sm">Monthly</p>
                        </div>
                      </div>
                      <div className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-400 mb-1">${pkg.priceUsd.toFixed(2)}</div>
                      <div className="text-gray-400 text-sm mb-4">/month</div>
                      <button
                        onClick={() => handlePurchaseClick(pkg)}
                        disabled={processingPayment === pkg.id || balance?.isAdmin}
                        className="w-full px-4 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all shadow-lg hover:shadow-blue-500/25 hover:scale-105 active:scale-95 disabled:scale-100"
                      >
                        {processingPayment === pkg.id ? 'Processing...' : balance?.isAdmin ? 'Admin Account' : 'Subscribe'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-6">
            <CreditUsageAnalytics />

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
          </div>
        )}
      </div>
      <BottomNavigation />
    </div>
  );
}
