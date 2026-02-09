import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Unlock, Coins, Crown, Check, Loader2, ArrowRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { clubAccessGateService, type ClubAccessResult } from '@/services/club-access-gate-service';
import { clubMembershipService, type MembershipPackage } from '@/services/club-membership-service';
import { getDisplayTradeCost } from '@/config/tokenomics-constants';
import { clubReferralService } from '@/services/club-referral-service';
import { NavigationMenu } from '@/components/NavigationMenu';

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ClubEntryGatePage() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [accessResult, setAccessResult] = useState<ClubAccessResult | null>(null);
  const [packages, setPackages] = useState<MembershipPackage[]>([]);
  const [processingPurchase, setProcessingPurchase] = useState<string | null>(null);

  const [purchaseSuccess, setPurchaseSuccess] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ tierName?: string; tokensAwarded?: number } | null>(null);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }

    const sessionId = searchParams.get('session_id');
    if (searchParams.get('success') === 'true' && sessionId) {
      verifyAndGrantPurchase(sessionId);
    } else {
      loadAccessInfo();
    }

    const refCode = searchParams.get('ref');
    if (refCode) {
      handleReferralCode(refCode);
    }
  }, [user]);

  const verifyAndGrantPurchase = async (sessionId: string) => {
    setVerifying(true);
    try {
      const response = await fetch('/.netlify/functions/verify-membership-purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        setPurchaseSuccess(true);
        if (data.tierName) {
          setVerifyResult({ tierName: data.tierName, tokensAwarded: data.tokensAwarded });
        }
      } else {
        console.error('[ClubEntryGate] Verification failed:', data.error);
        setPurchaseSuccess(true);
      }
    } catch (error) {
      console.error('[ClubEntryGate] Verification error:', error);
      setPurchaseSuccess(true);
    } finally {
      setVerifying(false);
      await loadAccessInfo();
    }
  };

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
    await clubReferralService.trackReferral(code, user.id);
  };

  const handlePurchaseClick = async (pkg: MembershipPackage) => {
    if (!user) return;

    if (!pkg.stripePriceId) {
      alert('This membership tier is not yet available for purchase. Please contact support.');
      return;
    }

    const stripePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
    if (!stripePublishableKey) {
      alert('Payment system not configured. Please contact support.');
      return;
    }

    setProcessingPurchase(pkg.id);

    try {
      const response = await fetch('/.netlify/functions/stripe-create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceId: pkg.stripePriceId,
          packageId: pkg.id,
          userId: user.id,
          mode: 'payment',
          purchaseType: 'membership',
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

      <div className="max-w-7xl mx-auto px-4 py-12">
        {verifying && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 mb-8 text-center">
            <Loader2 className="w-6 h-6 text-blue-600 animate-spin mx-auto mb-2" />
            <div className="text-blue-700 font-semibold">Verifying your purchase and granting tokens...</div>
          </div>
        )}

        {purchaseSuccess && !verifying && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 mb-8 text-center">
            <div className="text-emerald-600 font-bold text-xl mb-2">Membership Activated</div>
            {verifyResult ? (
              <p className="text-emerald-700">
                Your <span className="font-bold">{verifyResult.tierName}</span> membership is active.
                You received <span className="font-bold">{verifyResult.tokensAwarded} PIP</span> tokens. Welcome to Pipnosis Club.
              </p>
            ) : (
              <p className="text-emerald-700">Your Club membership is now active. Welcome to Pipnosis Club.</p>
            )}
          </div>
        )}

        {/* Header */}
        <div className="text-center mb-12">
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

            {/* PIP Balance Display */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/60 backdrop-blur-sm border border-slate-200/60 rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
                  <Coins size={16} />
                  Your PIP Balance
                </div>
                <div className="text-3xl font-bold text-slate-900">
                  {fmt(accessResult.tokens.available)}
                </div>
              </div>

              <div className="bg-white/60 backdrop-blur-sm border border-slate-200/60 rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
                  <Lock size={16} />
                  Required PIP
                </div>
                <div className="text-3xl font-bold text-slate-900">
                  {fmt(accessResult.tokens.required)}
                </div>
              </div>
            </div>

            {accessResult.status === 'insufficient_tokens' && (
              <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <p className="text-amber-800">
                  You need <span className="font-bold">{fmt(accessResult.tokens.deficit)}</span> more PIP to access the Club.
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
              {accessResult.canAccess ? 'Enter Pipnosis Club' : 'Insufficient PIP to Enter'}
              <ArrowRight size={20} />
            </button>
        </div>

        {/* Membership Packages */}
        {packages.length > 0 && (
          <div>
            <h2 className="text-3xl font-bold text-center text-slate-900 mb-8">
              Membership Tiers
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {packages.map((pkg) => (
                <div key={pkg.id} className="bg-white bg-opacity-70 backdrop-blur-md border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-lg hover:shadow-xl transition-shadow h-full flex flex-col relative overflow-hidden">
                  <div
                    className="absolute top-0 left-0 right-0 h-1"
                    style={{ backgroundColor: pkg.badgeColor }}
                  />

                  <div className="flex items-center gap-3 mb-4">
                    <div
                      className="p-2.5 rounded-xl"
                      style={{ backgroundColor: `${pkg.badgeColor}15`, border: `1px solid ${pkg.badgeColor}30` }}
                    >
                      <Crown size={24} style={{ color: pkg.badgeColor }} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">{pkg.name}</h3>
                      <p className="text-slate-500 text-xs">Tier {pkg.tierLevel}</p>
                    </div>
                  </div>

                  <p className="text-slate-600 text-sm mb-4">{pkg.description}</p>

                  <div className="bg-white bg-opacity-60 backdrop-blur-sm border border-slate-200 rounded-xl p-3 mb-4 shadow-sm space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">PIP Allocation</span>
                      <span className="text-slate-900 font-bold">{fmt(pkg.initialTokenAllocation)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">Required Balance</span>
                      <span className="text-slate-900 font-bold">{fmt(pkg.requiredTokenBalance)}</span>
                    </div>
                    {pkg.discountPct > 0 && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">Trade Cost</span>
                        <span className="text-emerald-600 font-bold">{getDisplayTradeCost(pkg.discountPct)} credits/trade</span>
                      </div>
                    )}
                  </div>

                  <div className="mb-4 flex-1">
                    <div className="text-slate-500 text-xs mb-2">Benefits:</div>
                    <ul className="space-y-1.5">
                      {pkg.benefits.map((benefit, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-slate-600 text-xs">
                          <Check size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                          <span>{benefit}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-auto pt-4 border-t border-slate-100">
                    <div className="text-3xl font-bold text-slate-900 mb-3">
                      ${pkg.priceUsd.toFixed(0)}
                    </div>

                    <button
                      onClick={() => handlePurchaseClick(pkg)}
                      disabled={processingPurchase === pkg.id}
                      className="w-full px-5 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all shadow-md hover:shadow-lg text-sm"
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
