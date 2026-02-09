import React, { useEffect, useState } from 'react';
import { Gift, AlertCircle, Flame, Info } from 'lucide-react';
import { ClubLayout } from '@/components/ClubLayout';
import { TokenBalanceCard } from '@/components/TokenBalanceCard';
import { TokenActionsCard } from '@/components/TokenActionsCard';
import { useAuth } from '@/hooks/useAuth';
import { useTokenBalance } from '@/hooks/useTokenBalance';
import { clubMembershipService, type UserMembership, type UserCreditDiscount } from '@/services/club-membership-service';
import { userTradeDiscountSettingService } from '@/services/user-trade-discount-setting';
import { getDisplayTradeCost, computePipBurn, computeTradeCost, TOKENOMICS } from '@/config/tokenomics-constants';
import { PipUtilityValueDisplay } from '@/components/PipUtilityValueDisplay';

const TIER_MULTIPLIERS: Record<number, number> = {
  3: 1.0,
  4: 1.1,
  5: 1.2,
  6: 1.3,
};

export function ClubRewardsPage() {
  const { user } = useAuth();
  const { balance, stakingSummary, loading: tokenLoading, refresh: refreshTokenData } = useTokenBalance();

  const [membership, setMembership] = useState<UserMembership | null>(null);
  const [discount, setDiscount] = useState<UserCreditDiscount | null>(null);
  const [discountToggle, setDiscountToggle] = useState(false);
  const [discountToggleLoading, setDiscountToggleLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    loadPageData();
  }, [user]);

  const loadPageData = async () => {
    if (!user) return;
    try {
      const [mem, discountData, toggleEnabled] = await Promise.all([
        clubMembershipService.getUserMembership(user.id),
        clubMembershipService.getUserCreditDiscount(user.id),
        userTradeDiscountSettingService.isEnabled(user.id),
      ]);
      setMembership(mem);
      setDiscount(discountData);
      setDiscountToggle(toggleEnabled);
    } catch (error) {
      console.error('[ClubRewards] Error loading page data:', error);
    } finally {
      setPageLoading(false);
    }
  };

  const discountEligible = discount && discount.discountPct > 0;
  const tradeCostIfEnabled = discount ? computeTradeCost(discount.discountPct) : TOKENOMICS.CREDITS.BASE_TRADE_COST;
  const creditSavings = TOKENOMICS.CREDITS.BASE_TRADE_COST - tradeCostIfEnabled;
  const pipBurnPerTrade = computePipBurn(creditSavings);

  const handleDiscountToggle = async () => {
    if (!user || !discountEligible) return;
    setDiscountToggleLoading(true);
    const newVal = !discountToggle;
    const result = await userTradeDiscountSettingService.setEnabled(user.id, newVal);
    if (result.success) {
      setDiscountToggle(newVal);
    }
    setDiscountToggleLoading(false);
  };

  const stakingEnabled = membership?.tierLevel != null && membership.tierLevel >= 3;
  const tierMultiplier = membership?.tierLevel ? TIER_MULTIPLIERS[membership.tierLevel] || 1.0 : 1.0;

  if (!user) return null;

  return (
    <ClubLayout>
      <div className="max-w-6xl mx-auto space-y-4 sm:space-y-8 pb-8">
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-sm">
          <div className="flex items-start gap-3 sm:gap-4">
            <div className="p-2 sm:p-3 bg-amber-100 rounded-lg sm:rounded-xl flex-shrink-0">
              <AlertCircle size={22} className="text-amber-600 sm:w-7 sm:h-7" />
            </div>
            <div>
              <h3 className="text-base sm:text-xl font-bold text-amber-900 mb-1.5 sm:mb-2">Important Notice</h3>
              <div className="text-amber-800 text-xs sm:text-sm space-y-1.5 sm:space-y-2">
                <p>
                  PIP tokens are <span className="font-bold">utility access units</span> for platform participation only.
                </p>
                <p>
                  <span className="font-bold">This is NOT investment advice.</span> Staking rewards are for <span className="font-bold">platform engagement</span> within the Pipnosis ecosystem.
                </p>
              </div>
            </div>
          </div>
        </div>

        <PipUtilityValueDisplay />

        <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl sm:rounded-2xl p-4 sm:p-8 shadow-lg">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="p-2.5 sm:p-3 bg-blue-50 rounded-xl">
              <Gift size={28} className="text-blue-500 sm:w-12 sm:h-12" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-4xl font-bold text-slate-900">
                Rewards & Staking
              </h1>
              <p className="text-slate-600 text-sm sm:text-lg">
                {stakingEnabled ? `Earn PIP utility rewards -- ${tierMultiplier}x multiplier` : 'Builder tier or above required for staking'}
              </p>
            </div>
          </div>
        </div>

        <TokenBalanceCard
          balance={balance}
          stakingSummary={stakingSummary}
          loading={tokenLoading}
          variant="full"
        />

        <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-lg">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 bg-orange-50 rounded-xl">
              <Flame size={22} className="text-orange-500" />
            </div>
            <div className="flex-1">
              <h2 className="text-base sm:text-lg font-bold text-slate-900">Trade Credit Discounts</h2>
              <p className="text-slate-500 text-xs sm:text-sm">Use PIP tokens to reduce your trade credit cost</p>
            </div>
          </div>

          <div className="flex items-center justify-between bg-slate-50/80 border border-slate-200/60 rounded-xl p-4">
            <div className="flex-1 min-w-0 mr-4">
              <div className="text-sm font-semibold text-slate-900 mb-1">
                Use PIP tokens for trade discounts
              </div>
              <div className="text-xs text-slate-500">
                When enabled, PIP tokens will be burned automatically to reduce your credit cost per trade.
              </div>
            </div>

            {discountEligible ? (
              <button
                onClick={handleDiscountToggle}
                disabled={discountToggleLoading}
                className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 ${
                  discountToggle ? 'bg-emerald-500' : 'bg-slate-300'
                } ${discountToggleLoading ? 'opacity-50 cursor-wait' : ''}`}
                role="switch"
                aria-checked={discountToggle}
                aria-label="Toggle trade discounts"
              >
                <span
                  className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                    discountToggle ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            ) : (
              <div className="relative group flex-shrink-0">
                <div className="inline-flex h-7 w-12 rounded-full bg-slate-200 cursor-not-allowed items-center">
                  <span className="inline-block h-6 w-6 ml-0.5 rounded-full bg-white shadow-sm" />
                </div>
                <div className="absolute right-0 bottom-full mb-2 w-56 p-2.5 bg-slate-800 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
                  <div className="flex items-start gap-1.5">
                    <Info size={12} className="flex-shrink-0 mt-0.5 text-slate-300" />
                    <span>Discounts are available at Builder tier and above.</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {discountEligible && (
            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="bg-white/60 border border-slate-100 rounded-xl p-3 text-center">
                <div className="text-slate-900 text-lg sm:text-xl font-bold">
                  {Math.round((discount?.discountPct ?? 0) * 100)}%
                </div>
                <div className="text-slate-500 text-[10px] sm:text-xs mt-0.5">Your Tier Discount</div>
              </div>
              <div className="bg-white/60 border border-slate-100 rounded-xl p-3 text-center">
                <div className="text-slate-900 text-lg sm:text-xl font-bold">
                  {getDisplayTradeCost(discount?.discountPct ?? 0)}
                </div>
                <div className="text-slate-500 text-[10px] sm:text-xs mt-0.5">Credits/Trade</div>
              </div>
              <div className="bg-white/60 border border-slate-100 rounded-xl p-3 text-center">
                <div className="text-orange-600 text-lg sm:text-xl font-bold">
                  {pipBurnPerTrade > 0 ? pipBurnPerTrade.toFixed(1) : '0'}
                </div>
                <div className="text-slate-500 text-[10px] sm:text-xs mt-0.5">PIP Burn/Trade</div>
              </div>
            </div>
          )}
        </div>

        <TokenActionsCard
          balance={balance}
          stakingSummary={stakingSummary}
          stakingEnabled={stakingEnabled}
          tierMultiplier={tierMultiplier}
          onRefresh={refreshTokenData}
        />

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-6 text-center shadow-sm">
          <p className="text-slate-600 text-xs sm:text-sm">
            <span className="font-bold">Remember:</span> PIP tokens are utility access units for platform participation.
            This is not financial advice. Rewards are for engagement purposes only.
          </p>
        </div>
      </div>
    </ClubLayout>
  );
}
