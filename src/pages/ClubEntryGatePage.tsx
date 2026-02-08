import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Unlock, Coins, Crown, Check, Loader2, ArrowRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { clubAccessGateService, type ClubAccessResult } from '@/services/club-access-gate-service';
import { clubMembershipService, type MembershipPackage } from '@/services/club-membership-service';
import { clubReferralService } from '@/services/club-referral-service';
import { NavigationMenu } from '@/components/NavigationMenu';

export function ClubEntryGatePage() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [accessResult, setAccessResult] = useState<ClubAccessResult | null>(null);
  const [packages, setPackages] = useState<MembershipPackage[]>([]);
  const [processingPurchase, setProcessingPurchase] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }

    loadAccessInfo();

    // Handle referral code from URL
    const refCode = searchParams.get('ref');
    if (refCode) {
      handleReferralCode(refCode);
    }
  }, [user]);

  const loadAccessInfo = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const [result, pkgs] = await Promise.all([
        clubAccessGateService.validateAccess(user.id, isAdmin),
        clubMembershipService.getActivePackages()
      ]);
      setAccessResult(result);
      setPackages(pkgs);
    } catch (error) {
      console.error('[ClubEntryGate] Error loading access info:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleReferralCode = async (code: string) => {
    if (!user) return;

    // Track referral (will be completed when user purchases membership)
    await clubReferralService.trackReferral(code, user.id);
  };

  const handlePurchaseClick = async (pkg: MembershipPackage) => {
    if (!user) return;

    setProcessingPurchase(pkg.id);

    try {
      // TODO: Integrate with Stripe (similar to credits purchase)
      // For now, show placeholder message
      alert(`Stripe integration for membership packages coming soon!\n\nPackage: ${pkg.name}\nPrice: $${pkg.priceUsd}`);

      // In production, this would call:
      // const response = await fetch('/.netlify/functions/club-membership-checkout', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ packageId: pkg.id, userId: user.id })
      // });
      // const { url } = await response.json();
      // window.location.href = url;

    } catch (error) {
      console.error('[ClubEntryGate] Purchase error:', error);
      alert('Failed to process purchase. Please try again.');
    } finally {
      setProcessingPurchase(null);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' as never }}>
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-12 h-12 text-slate-600 animate-spin mx-auto mb-4" />
            <p className="text-slate-600">Checking Club access...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!accessResult) {
    return null;
  }

  return (
    <div className="fixed inset-0 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' as never }}>
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      <NavigationMenu />

      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-6">
            {accessResult.canAccess ? (
              <div className="p-4 bg-white/70 backdrop-blur-md rounded-full shadow-lg">
                <Unlock size={64} className="text-emerald-500" />
              </div>
            ) : (
              <div className="p-4 bg-white/70 backdrop-blur-md rounded-full shadow-lg">
                <Lock size={64} className="text-slate-400" />
              </div>
            )}
          </div>

          <h1 className="text-5xl font-bold text-slate-900 mb-4">
            Pipnosis Club
          </h1>
          <p className="text-slate-600 text-lg max-w-2xl mx-auto">
            An exclusive membership community with utility tokens, rewards, and governance
          </p>
        </div>

        {/* Access Status Card */}
        <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-2xl p-8 shadow-lg mb-8">
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Access Status</h2>
              <p className="text-slate-600">{accessResult.message}</p>
            </div>

            <div className={`px-4 py-2 rounded-full font-semibold flex items-center gap-2 ${
              accessResult.canAccess
                ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                : 'bg-slate-100 text-slate-600 border border-slate-200'
            }`}>
                {accessResult.canAccess ? (
                  <>
                    <Unlock size={18} />
                    UNLOCKED
                  </>
                ) : (
                  <>
                    <Lock size={18} />
                    LOCKED
                  </>
                )}
              </div>
            </div>

            {/* Token Balance Display */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/60 backdrop-blur-sm border border-slate-200/60 rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
                  <Coins size={16} />
                  Your Tokens
                </div>
                <div className="text-3xl font-bold text-slate-900">
                  {accessResult.tokens.available.toLocaleString()}
                </div>
              </div>

              <div className="bg-white/60 backdrop-blur-sm border border-slate-200/60 rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
                  <Lock size={16} />
                  Required Tokens
                </div>
                <div className="text-3xl font-bold text-slate-900">
                  {accessResult.tokens.required.toLocaleString()}
                </div>
              </div>
            </div>

            {accessResult.status === 'insufficient_tokens' && (
              <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-amber-800">
                  You need <span className="font-bold">{accessResult.tokens.deficit.toLocaleString()}</span> more tokens to access the Club.
                  Purchase a higher membership tier to receive more tokens.
                </p>
              </div>
            )}

            <button
              onClick={() => accessResult.canAccess && navigate('/club/home')}
              disabled={!accessResult.canAccess}
              className={`w-full mt-6 px-6 py-4 font-semibold rounded-xl transition-all flex items-center justify-center gap-2 ${
                accessResult.canAccess
                  ? 'bg-slate-900 hover:bg-slate-800 text-white shadow-md hover:shadow-lg cursor-pointer'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              {accessResult.canAccess ? 'Enter Pipnosis Club' : 'Insufficient Tokens to Enter'}
              <ArrowRight size={20} />
            </button>
        </div>

        {/* Membership Packages */}
        {packages.length > 0 && (
          <div>
            <h2 className="text-3xl font-bold text-center text-slate-900 mb-8">
              Membership Tiers
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {packages.map((pkg) => (
                <div key={pkg.id} className="bg-white bg-opacity-70 backdrop-blur-md border border-slate-200 rounded-2xl p-6 shadow-lg hover:shadow-xl transition-shadow h-full flex flex-col">
                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className="p-3 rounded-xl"
                      style={{ backgroundColor: `${pkg.badgeColor}20`, border: `1px solid ${pkg.badgeColor}40` }}
                    >
                      <Crown size={28} style={{ color: pkg.badgeColor }} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">{pkg.name}</h3>
                      <p className="text-slate-500 text-sm">Tier {pkg.tierLevel}</p>
                    </div>
                  </div>

                  <p className="text-slate-600 mb-6">{pkg.description}</p>

                  <div className="bg-white bg-opacity-60 backdrop-blur-sm border border-slate-200 rounded-xl p-4 mb-4 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-slate-500">Initial Tokens</span>
                      <span className="text-slate-900 font-bold">{pkg.initialTokenAllocation.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Required Balance</span>
                      <span className="text-slate-900 font-bold">{pkg.requiredTokenBalance.toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="mb-6">
                    <div className="text-slate-500 text-sm mb-2">Benefits:</div>
                    <ul className="space-y-2">
                      {pkg.benefits.map((benefit, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-slate-600 text-sm">
                          <Check size={16} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                          <span>{benefit}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-auto">
                    <div className="text-4xl font-bold text-slate-900 mb-4">
                      ${pkg.priceUsd.toFixed(2)}
                    </div>

                    <button
                      onClick={() => handlePurchaseClick(pkg)}
                      disabled={processingPurchase === pkg.id}
                      className="w-full px-6 py-3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all shadow-md hover:shadow-lg"
                    >
                      {processingPurchase === pkg.id ? 'Processing...' : 'Purchase'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 text-center text-slate-500 text-sm">
          <p>Pipnosis Club tokens are utility tokens for access and rewards.</p>
          <p>Not investment advice. No guaranteed returns.</p>
        </div>
      </div>
      </div>
    </div>
  );
}
