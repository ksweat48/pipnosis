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
      const result = await clubAccessGateService.validateAccess(user.id, isAdmin);
      setAccessResult(result);

      // If user can access, redirect to Club home
      if (result.canAccess) {
        navigate('/club/home');
        return;
      }

      // If no membership, load packages
      if (result.status === 'no_membership') {
        const pkgs = await clubMembershipService.getActivePackages();
        setPackages(pkgs);
      }
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
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-amber-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Checking Club access...</p>
        </div>
      </div>
    );
  }

  if (!accessResult) {
    return null;
  }

  return (
    <div className="min-h-screen bg-black">
      <NavigationMenu />

      <div className="max-w-6xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-6">
            {accessResult.canAccess ? (
              <div className="relative">
                <div className="absolute inset-0 bg-amber-500 rounded-full blur-xl opacity-60 animate-pulse" />
                <Unlock size={64} className="text-amber-400 relative" />
              </div>
            ) : (
              <div className="relative">
                <div className="absolute inset-0 bg-amber-500 rounded-full blur-xl opacity-40" />
                <Lock size={64} className="text-amber-400 relative" />
              </div>
            )}
          </div>

          <h1 className="text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 mb-4">
            Pipnosis Club
          </h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            An exclusive membership community with utility tokens, rewards, and governance
          </p>
        </div>

        {/* Access Status Card */}
        <div className="relative group mb-8">
          <div className="absolute -inset-1 bg-gradient-to-r from-amber-600 to-yellow-600 rounded-2xl opacity-20 group-hover:opacity-30 transition blur-lg" />

          <div className="relative bg-gradient-to-br from-gray-950/95 to-black/95 backdrop-blur-xl border-2 border-amber-500/30 rounded-2xl p-8">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-amber-400 mb-2">Access Status</h2>
                <p className="text-gray-400">{accessResult.message}</p>
              </div>

              <div className={`px-4 py-2 rounded-full font-semibold flex items-center gap-2 ${
                accessResult.canAccess
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                  : 'bg-gray-800 text-gray-400 border border-gray-700'
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
              <div className="bg-gray-900/50 border border-amber-500/20 rounded-xl p-4">
                <div className="flex items-center gap-2 text-gray-400 text-sm mb-2">
                  <Coins size={16} />
                  Your Tokens
                </div>
                <div className="text-3xl font-bold text-amber-400">
                  {accessResult.tokens.available.toLocaleString()}
                </div>
              </div>

              <div className="bg-gray-900/50 border border-amber-500/20 rounded-xl p-4">
                <div className="flex items-center gap-2 text-gray-400 text-sm mb-2">
                  <Lock size={16} />
                  Required Tokens
                </div>
                <div className="text-3xl font-bold text-white">
                  {accessResult.tokens.required.toLocaleString()}
                </div>
              </div>
            </div>

            {accessResult.status === 'insufficient_tokens' && (
              <div className="mt-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                <p className="text-amber-300">
                  You need <span className="font-bold">{accessResult.tokens.deficit.toLocaleString()}</span> more tokens to access the Club.
                  Purchase a higher membership tier to receive more tokens.
                </p>
              </div>
            )}

            {accessResult.canAccess && (
              <button
                onClick={() => navigate('/club/home')}
                className="w-full mt-6 px-6 py-4 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-black font-semibold rounded-xl transition-all shadow-lg hover:shadow-amber-500/25 hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
              >
                Enter Pipnosis Club
                <ArrowRight size={20} />
              </button>
            )}
          </div>
        </div>

        {/* Membership Packages (if no membership) */}
        {accessResult.status === 'no_membership' && (
          <div>
            <h2 className="text-3xl font-bold text-center bg-clip-text text-transparent bg-gradient-to-r from-amber-400 to-yellow-400 mb-8">
              Choose Your Membership
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {packages.map((pkg) => (
                <div key={pkg.id} className="relative group">
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-amber-600 to-yellow-600 rounded-2xl opacity-20 group-hover:opacity-40 transition blur-lg" />

                  <div className="relative bg-gradient-to-br from-gray-950/95 to-black/95 backdrop-blur-xl border-2 border-amber-500/30 rounded-2xl p-6 h-full flex flex-col">
                    <div className="flex items-center gap-3 mb-4">
                      <div
                        className="p-3 rounded-xl"
                        style={{ backgroundColor: `${pkg.badgeColor}20`, border: `2px solid ${pkg.badgeColor}40` }}
                      >
                        <Crown size={28} style={{ color: pkg.badgeColor }} />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-amber-400">{pkg.name}</h3>
                        <p className="text-gray-400 text-sm">Tier {pkg.tierLevel}</p>
                      </div>
                    </div>

                    <p className="text-gray-400 mb-6">{pkg.description}</p>

                    <div className="bg-gray-900/50 border border-amber-500/20 rounded-xl p-4 mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-gray-500">Initial Tokens</span>
                        <span className="text-amber-400 font-bold">{pkg.initialTokenAllocation.toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Required Balance</span>
                        <span className="text-white font-bold">{pkg.requiredTokenBalance.toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="mb-6">
                      <div className="text-gray-500 text-sm mb-2">Benefits:</div>
                      <ul className="space-y-2">
                        {pkg.benefits.map((benefit, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-gray-400 text-sm">
                            <Check size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
                            <span>{benefit}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="mt-auto">
                      <div className="text-4xl font-bold text-amber-400 mb-4">
                        ${pkg.priceUsd.toFixed(2)}
                      </div>

                      <button
                        onClick={() => handlePurchaseClick(pkg)}
                        disabled={processingPurchase === pkg.id}
                        className="w-full px-6 py-3 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed text-black font-semibold rounded-xl transition-all shadow-lg hover:shadow-amber-500/25 hover:scale-105 active:scale-95 disabled:scale-100"
                      >
                        {processingPurchase === pkg.id ? 'Processing...' : 'Purchase'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 text-center text-gray-500 text-sm">
          <p>Pipnosis Club tokens are utility tokens for access and rewards.</p>
          <p>Not investment advice. No guaranteed returns.</p>
        </div>
      </div>
    </div>
  );
}
