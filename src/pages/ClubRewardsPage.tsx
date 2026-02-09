import React, { useEffect, useState } from 'react';
import { Gift, TrendingUp, Lock, AlertCircle, Coins, Clock, Unlock, Loader2, Flame, Info, Timer, CheckCircle } from 'lucide-react';
import { ClubLayout } from '@/components/ClubLayout';
import { useAuth } from '@/hooks/useAuth';
import { clubStakingService, type StakingPosition, type StakingSummary } from '@/services/club-staking-service';
import { clubTokenLedgerService, type ClubTokenBalance } from '@/services/club-token-ledger-service';
import { clubMembershipService, type UserMembership, type UserCreditDiscount } from '@/services/club-membership-service';
import { userTradeDiscountSettingService } from '@/services/user-trade-discount-setting';
import { getDisplayTradeCost, computePipBurn, computeTradeCost, TOKENOMICS } from '@/config/tokenomics-constants';
import { PipUtilityValueDisplay } from '@/components/PipUtilityValueDisplay';

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatTimeRemaining = (unlockAt: string): string => {
  const now = new Date().getTime();
  const unlock = new Date(unlockAt).getTime();
  const diff = unlock - now;

  if (diff <= 0) return 'Ready';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.ceil(hours / 24);
    return `${days}d remaining`;
  }

  return `${hours}h ${minutes}m`;
};

const TIER_MULTIPLIERS: Record<number, number> = {
  3: 1.0, // Builder
  4: 1.1, // Pro
  5: 1.2, // Elite
  6: 1.3, // Founder
};

export function ClubRewardsPage() {
  const { user } = useAuth();
  const [stakingSummary, setStakingSummary] = useState<StakingSummary | null>(null);
  const [tokenBalance, setTokenBalance] = useState<ClubTokenBalance | null>(null);
  const [membership, setMembership] = useState<UserMembership | null>(null);
  const [loading, setLoading] = useState(true);

  const [discount, setDiscount] = useState<UserCreditDiscount | null>(null);
  const [discountToggle, setDiscountToggle] = useState(false);
  const [discountToggleLoading, setDiscountToggleLoading] = useState(false);

  const [stakeAmount, setStakeAmount] = useState('');
  const [staking, setStaking] = useState(false);
  const [stakeError, setStakeError] = useState<string | null>(null);
  const [stakeSuccess, setStakeSuccess] = useState<string | null>(null);

  const [requestingUnstake, setRequestingUnstake] = useState<string | null>(null);
  const [executingUnstake, setExecutingUnstake] = useState<string | null>(null);
  const [claimingRewards, setClaimingRewards] = useState(false);

  const stakingConstants = clubStakingService.getStakingConstants();

  useEffect(() => {
    if (!user) return;

    loadData();

    const unsubBalance = clubTokenLedgerService.subscribeToBalance(user.id, (b) => setTokenBalance(b));

    const interval = setInterval(() => {
      if (user) loadStakingSummary();
    }, 10000);

    return () => {
      unsubBalance();
      clearInterval(interval);
    };
  }, [user]);

  const loadData = async () => {
    if (!user) return;

    try {
      const [balance, summary, mem, discountData, toggleEnabled] = await Promise.all([
        clubTokenLedgerService.getBalance(user.id),
        clubStakingService.getStakingSummary(user.id),
        clubMembershipService.getUserMembership(user.id),
        clubMembershipService.getUserCreditDiscount(user.id),
        userTradeDiscountSettingService.isEnabled(user.id),
      ]);

      setTokenBalance(balance);
      setStakingSummary(summary);
      setMembership(mem);
      setDiscount(discountData);
      setDiscountToggle(toggleEnabled);
    } catch (error) {
      console.error('[ClubRewards] Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadStakingSummary = async () => {
    if (!user) return;
    const summary = await clubStakingService.getStakingSummary(user.id);
    setStakingSummary(summary);
  };

  const handleStake = async () => {
    if (!user) return;

    const amount = parseFloat(stakeAmount);
    if (isNaN(amount) || amount <= 0) {
      setStakeError('Enter a valid amount');
      return;
    }

    setStaking(true);
    setStakeError(null);
    setStakeSuccess(null);

    const result = await clubStakingService.stake(user.id, amount, 30);

    if (result.success) {
      setStakeSuccess(`Staked ${fmt(result.amount || amount)} PIP successfully`);
      setStakeAmount('');
      await loadData();
    } else {
      setStakeError(result.error || 'Failed to stake');
    }

    setStaking(false);
  };

  const handleRequestUnstake = async (positionId: string) => {
    if (!user) return;

    setRequestingUnstake(positionId);
    setStakeError(null);
    setStakeSuccess(null);

    const result = await clubStakingService.requestUnstake(positionId);

    if (result.success) {
      setStakeSuccess('Unstake requested. 24-hour cooldown period started.');
      await loadData();
    } else {
      setStakeError(result.error || 'Failed to request unstake');
    }

    setRequestingUnstake(null);
  };

  const handleExecuteUnstake = async (positionId: string) => {
    if (!user) return;

    setExecutingUnstake(positionId);
    setStakeError(null);
    setStakeSuccess(null);

    const result = await clubStakingService.executeUnstake(positionId);

    if (result.success) {
      setStakeSuccess(`Unstaked ${fmt(result.amountReturned || 0)} PIP successfully`);
      await loadData();
    } else {
      setStakeError(result.error || 'Failed to execute unstake');
    }

    setExecutingUnstake(null);
  };

  const handleClaimRewards = async () => {
    if (!user) return;

    setClaimingRewards(true);
    setStakeError(null);
    setStakeSuccess(null);

    const result = await clubStakingService.claimRewards();

    if (result.success) {
      setStakeSuccess(`Claimed ${fmt(result.rewardsClaimed || 0)} PIP in rewards`);
      await loadData();
    } else {
      setStakeError(result.error || 'Failed to claim rewards');
    }

    setClaimingRewards(false);
  };

  const activePositions = stakingSummary?.activePositions.filter(p => p.status === 'active' || p.status === 'unstake_requested') || [];
  const totalStaked = stakingSummary?.rewardState?.stakedPip || 0;
  const totalRewardsPending = stakingSummary?.rewardState?.pendingRewardsPip || 0;
  const totalRewardsClaimed = stakingSummary?.rewardState?.claimedTotalPip || 0;

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

  const stakingEnabled = membership?.tierLevel && membership.tierLevel >= 3;
  const tierMultiplier = membership?.tierLevel ? TIER_MULTIPLIERS[membership.tierLevel] || 1.0 : 1.0;

  if (!user) return null;

  return (
    <ClubLayout>
      <div className="max-w-6xl mx-auto space-y-4 sm:space-y-8 pb-8">
        {/* Disclaimer Banner */}
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

        {/* PIP Utility Value Display */}
        <PipUtilityValueDisplay />

        {/* Page Header */}
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
                {stakingEnabled ? `Earn PIP utility rewards • ${tierMultiplier}x multiplier` : 'Builder tier or above required for staking'}
              </p>
            </div>
          </div>
        </div>

        {/* Token Balances Overview */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-3 sm:p-5 shadow-md">
            <div className="text-slate-500 text-[10px] sm:text-xs mb-1">Available PIP</div>
            <div className="text-slate-900 text-lg sm:text-2xl font-bold">
              {loading ? '...' : fmt(tokenBalance?.availableTokens || 0)}
            </div>
          </div>
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-3 sm:p-5 shadow-md">
            <div className="text-slate-500 text-[10px] sm:text-xs mb-1">Staked</div>
            <div className="text-blue-600 text-lg sm:text-2xl font-bold">
              {loading ? '...' : fmt(totalStaked)}
            </div>
          </div>
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-3 sm:p-5 shadow-md">
            <div className="text-slate-500 text-[10px] sm:text-xs mb-1">Rewards Pending</div>
            <div className="text-emerald-600 text-lg sm:text-2xl font-bold">
              {loading ? '...' : fmt(totalRewardsPending)}
            </div>
          </div>
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-3 sm:p-5 shadow-md">
            <div className="text-slate-500 text-[10px] sm:text-xs mb-1">Claimed Lifetime</div>
            <div className="text-amber-600 text-lg sm:text-2xl font-bold">
              {loading ? '...' : fmt(totalRewardsClaimed)}
            </div>
          </div>
        </div>

        {/* Claim Rewards Button */}
        {stakingEnabled && totalRewardsPending > 0 && (
          <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4 sm:p-6 shadow-md">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-emerald-100 rounded-xl">
                  <Coins size={24} className="text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-emerald-900">
                    {fmt(totalRewardsPending)} PIP Ready to Claim
                  </h3>
                  <p className="text-emerald-700 text-sm">
                    Claim your rewards without unstaking
                  </p>
                </div>
              </div>
              <button
                onClick={handleClaimRewards}
                disabled={claimingRewards}
                className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold rounded-xl transition-all shadow-md hover:shadow-lg flex items-center gap-2"
              >
                {claimingRewards ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Claiming...
                  </>
                ) : (
                  <>
                    <CheckCircle size={18} />
                    Claim Rewards
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Trade Discount Toggle */}
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

        {/* Stake New Tokens */}
        {stakingEnabled ? (
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl sm:rounded-2xl p-4 sm:p-8 shadow-lg">
            <h2 className="text-lg sm:text-2xl font-bold text-slate-900 mb-4 sm:mb-6 flex items-center gap-2 sm:gap-3">
              <Lock size={22} className="text-slate-700 sm:w-7 sm:h-7" />
              Stake PIP Tokens
            </h2>

            {stakeError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
                {stakeError}
              </div>
            )}
            {stakeSuccess && (
              <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm">
                {stakeSuccess}
              </div>
            )}

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
              <div className="flex items-start gap-3">
                <Info size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-blue-900 text-sm space-y-1">
                  <p><span className="font-semibold">Minimum lock:</span> 7 days before you can request unstake</p>
                  <p><span className="font-semibold">Cooldown period:</span> 24 hours after unstake request</p>
                  <p><span className="font-semibold">Rewards:</span> Accrue daily while ACTIVE, stop when unstake requested</p>
                  <p><span className="font-semibold">Your multiplier:</span> {tierMultiplier}x weight</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-600 text-sm mb-2">Amount (min {stakingConstants.minStakeAmount} PIP)</label>
                <input
                  type="number"
                  value={stakeAmount}
                  onChange={(e) => setStakeAmount(e.target.value)}
                  placeholder={`${stakingConstants.minStakeAmount}`}
                  min={stakingConstants.minStakeAmount}
                  step="0.01"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent"
                />
                <div className="text-slate-400 text-xs mt-1">
                  Available: {fmt(tokenBalance?.availableTokens || 0)} PIP
                </div>
              </div>

              <div className="flex flex-col justify-end">
                <button
                  onClick={handleStake}
                  disabled={staking || !stakeAmount}
                  className="w-full px-6 py-3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
                >
                  {staking ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Staking...
                    </>
                  ) : (
                    <>
                      <Lock size={18} />
                      Stake PIP
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl sm:rounded-2xl p-6 sm:p-10 shadow-lg text-center">
            <div className="p-3 sm:p-4 bg-slate-100 rounded-full w-fit mx-auto mb-4">
              <Lock size={32} className="text-slate-400 sm:w-10 sm:h-10" />
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mb-2">Staking Locked</h2>
            <p className="text-slate-600 text-sm sm:text-base max-w-md mx-auto">
              Staking is available for Builder tier members and above.
              Upgrade your membership to start earning staking rewards.
            </p>
          </div>
        )}

        {/* Active Staking Positions */}
        {activePositions.length > 0 && (
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl sm:rounded-2xl p-4 sm:p-8 shadow-lg">
            <h2 className="text-lg sm:text-2xl font-bold text-slate-900 mb-4 sm:mb-6 flex items-center gap-2 sm:gap-3">
              <TrendingUp size={22} className="text-slate-700 sm:w-7 sm:h-7" />
              Active Stakes ({activePositions.length})
            </h2>

            <div className="space-y-3">
              {activePositions.map((pos) => {
                const isUnstakeRequested = pos.status === 'unstake_requested';
                const canRequestUnstake = pos.canUnstake && pos.status === 'active';
                const canExecuteUnstake = pos.canExecuteUnstake;
                const stakedDays = Math.ceil((Date.now() - new Date(pos.stakedAt).getTime()) / (1000 * 60 * 60 * 24));

                return (
                  <div
                    key={pos.id}
                    className="bg-white/60 backdrop-blur-sm border border-slate-200/60 rounded-xl p-4 sm:p-5 shadow-sm"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${
                          canExecuteUnstake ? 'bg-emerald-50' :
                          isUnstakeRequested ? 'bg-amber-50' :
                          'bg-blue-50'
                        }`}>
                          {canExecuteUnstake ? (
                            <Unlock size={18} className="text-emerald-500" />
                          ) : isUnstakeRequested ? (
                            <Timer size={18} className="text-amber-500" />
                          ) : (
                            <Lock size={18} className="text-blue-500" />
                          )}
                        </div>
                        <div>
                          <div className="text-slate-900 font-bold">{fmt(pos.amountStaked)} PIP</div>
                          <div className="text-slate-500 text-xs">
                            {isUnstakeRequested ? (
                              <>Cooldown: {pos.unlockAt ? formatTimeRemaining(pos.unlockAt) : 'Processing'}</>
                            ) : (
                              <>Staked {stakedDays} day{stakedDays !== 1 ? 's' : ''} ago • {pos.tierWeight}x weight</>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-emerald-600 font-bold text-sm">
                            +{fmt(pos.rewardsEarned)} PIP
                          </div>
                          <div className="text-slate-400 text-xs">
                            {isUnstakeRequested ? 'Accrual stopped' : 'Accruing daily'}
                          </div>
                        </div>

                        {canExecuteUnstake && (
                          <button
                            onClick={() => handleExecuteUnstake(pos.id)}
                            disabled={executingUnstake === pos.id}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-sm font-semibold rounded-lg transition-all"
                          >
                            {executingUnstake === pos.id ? 'Unstaking...' : 'Unstake Now'}
                          </button>
                        )}

                        {isUnstakeRequested && !canExecuteUnstake && (
                          <div className="px-4 py-2 bg-amber-100 text-amber-700 text-sm font-semibold rounded-lg">
                            Cooling down
                          </div>
                        )}

                        {canRequestUnstake && (
                          <button
                            onClick={() => handleRequestUnstake(pos.id)}
                            disabled={requestingUnstake === pos.id}
                            className="px-4 py-2 bg-slate-600 hover:bg-slate-700 disabled:bg-slate-300 text-white text-sm font-semibold rounded-lg transition-all"
                          >
                            {requestingUnstake === pos.id ? 'Requesting...' : 'Request Unstake'}
                          </button>
                        )}

                        {!canRequestUnstake && !isUnstakeRequested && (
                          <div className="px-4 py-2 bg-slate-100 text-slate-500 text-sm font-semibold rounded-lg">
                            {7 - stakedDays > 0 ? `${7 - stakedDays}d until unlock` : 'Ready'}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-2 text-[10px] sm:text-xs text-slate-400">
                      <span>Staked: {new Date(pos.stakedAt).toLocaleDateString()}</span>
                      {pos.unstakeRequestedAt && (
                        <span>Requested: {new Date(pos.unstakeRequestedAt).toLocaleDateString()}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Staking Info */}
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
