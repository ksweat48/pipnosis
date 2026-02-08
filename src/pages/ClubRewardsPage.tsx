import React, { useEffect, useState } from 'react';
import { Gift, TrendingUp, Lock, AlertCircle, Coins, Clock, Unlock, Loader2 } from 'lucide-react';
import { ClubLayout } from '@/components/ClubLayout';
import { useAuth } from '@/hooks/useAuth';
import { clubStakingService, type StakingPosition } from '@/services/club-staking-service';
import { clubTokenLedgerService, type ClubTokenBalance } from '@/services/club-token-ledger-service';
import { clubMembershipService, type UserMembership } from '@/services/club-membership-service';

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DURATION_OPTIONS = [
  { days: 30, label: '30 days' },
  { days: 60, label: '60 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '180 days' },
  { days: 365, label: '365 days' },
];

export function ClubRewardsPage() {
  const { user } = useAuth();
  const [positions, setPositions] = useState<StakingPosition[]>([]);
  const [tokenBalance, setTokenBalance] = useState<ClubTokenBalance | null>(null);
  const [membership, setMembership] = useState<UserMembership | null>(null);
  const [loading, setLoading] = useState(true);

  const [stakeAmount, setStakeAmount] = useState('');
  const [stakeDuration, setStakeDuration] = useState(30);
  const [staking, setStaking] = useState(false);
  const [stakeError, setStakeError] = useState<string | null>(null);
  const [stakeSuccess, setStakeSuccess] = useState<string | null>(null);
  const [unstaking, setUnstaking] = useState<string | null>(null);

  const stakingConstants = clubStakingService.getStakingConstants();

  useEffect(() => {
    if (!user) return;

    loadData();

    const unsubBalance = clubTokenLedgerService.subscribeToBalance(user.id, (b) => setTokenBalance(b));
    const unsubPositions = clubStakingService.subscribeToPositions(user.id, (p) => setPositions(p));

    return () => {
      unsubBalance();
      unsubPositions();
    };
  }, [user]);

  const loadData = async () => {
    if (!user) return;

    try {
      const [balance, pos, mem] = await Promise.all([
        clubTokenLedgerService.getBalance(user.id),
        clubStakingService.getPositions(user.id),
        clubMembershipService.getUserMembership(user.id),
      ]);

      setTokenBalance(balance);
      setPositions(pos);
      setMembership(mem);
    } catch (error) {
      console.error('[ClubRewards] Error loading data:', error);
    } finally {
      setLoading(false);
    }
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

    const result = await clubStakingService.stake(user.id, amount, stakeDuration);

    if (result.success) {
      setStakeSuccess(`Staked ${fmt(result.amount || amount)} PIP for ${stakeDuration} days`);
      setStakeAmount('');
      await loadData();
    } else {
      setStakeError(result.error || 'Failed to stake');
    }

    setStaking(false);
  };

  const handleUnstake = async (positionId: string) => {
    if (!user) return;

    setUnstaking(positionId);

    const result = await clubStakingService.unstake(user.id, positionId);

    if (result.success) {
      setStakeSuccess(`Unstaked ${fmt(result.amountReturned || 0)} PIP + ${fmt(result.rewardsEarned || 0)} rewards`);
      await loadData();
    } else {
      setStakeError(result.error || 'Failed to unstake');
    }

    setUnstaking(null);
  };

  const activePositions = positions.filter((p) => p.status === 'active');
  const completedPositions = positions.filter((p) => p.status === 'completed');
  const totalStaked = activePositions.reduce((sum, p) => sum + p.amountStaked, 0);
  const totalRewards = positions.reduce((sum, p) => sum + p.rewardsEarned, 0);
  const maturedPositions = activePositions.filter((p) => p.isMatured);

  const stakingEnabled = membership?.tierLevel && membership.tierLevel >= 3;

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
                  Pipnosis Club tokens are <span className="font-bold">utility tokens</span> for membership access and community features only.
                </p>
                <p>
                  <span className="font-bold">This is NOT investment advice.</span> There are <span className="font-bold">no guaranteed returns</span>.
                  The rewards system is for <span className="font-bold">engagement purposes</span> within the Pipnosis Club community.
                </p>
              </div>
            </div>
          </div>
        </div>

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
                {stakingEnabled ? 'Lock PIP tokens to earn staking rewards' : 'Builder tier or above required for staking'}
              </p>
            </div>
          </div>
        </div>

        {/* Staking Overview Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-3 sm:p-5 shadow-md">
            <div className="text-slate-500 text-[10px] sm:text-xs mb-1">Available PIP</div>
            <div className="text-slate-900 text-lg sm:text-2xl font-bold">
              {loading ? '...' : fmt(tokenBalance?.availableTokens || 0)}
            </div>
          </div>
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-3 sm:p-5 shadow-md">
            <div className="text-slate-500 text-[10px] sm:text-xs mb-1">Total Staked</div>
            <div className="text-slate-900 text-lg sm:text-2xl font-bold">
              {loading ? '...' : fmt(totalStaked)}
            </div>
          </div>
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-3 sm:p-5 shadow-md">
            <div className="text-slate-500 text-[10px] sm:text-xs mb-1">Rewards Earned</div>
            <div className="text-emerald-600 text-lg sm:text-2xl font-bold">
              {loading ? '...' : fmt(totalRewards)}
            </div>
          </div>
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl p-3 sm:p-5 shadow-md">
            <div className="text-slate-500 text-[10px] sm:text-xs mb-1">Ready to Claim</div>
            <div className="text-amber-600 text-lg sm:text-2xl font-bold">
              {loading ? '...' : maturedPositions.length}
            </div>
          </div>
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
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

              <div>
                <label className="block text-slate-600 text-sm mb-2">Lock Duration</label>
                <div className="grid grid-cols-3 sm:grid-cols-1 gap-1.5">
                  {DURATION_OPTIONS.map((opt) => (
                    <button
                      key={opt.days}
                      onClick={() => setStakeDuration(opt.days)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        stakeDuration === opt.days
                          ? 'bg-slate-900 text-white shadow-md'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
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
                const daysLeft = Math.max(0, Math.ceil((new Date(pos.unlockAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                const progress = Math.min(100, ((pos.durationDays - daysLeft) / pos.durationDays) * 100);

                return (
                  <div
                    key={pos.id}
                    className="bg-white/60 backdrop-blur-sm border border-slate-200/60 rounded-xl p-4 sm:p-5 shadow-sm"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${pos.isMatured ? 'bg-emerald-50' : 'bg-slate-100'}`}>
                          {pos.isMatured ? (
                            <Unlock size={18} className="text-emerald-500" />
                          ) : (
                            <Lock size={18} className="text-slate-500" />
                          )}
                        </div>
                        <div>
                          <div className="text-slate-900 font-bold">{fmt(pos.amountStaked)} PIP</div>
                          <div className="text-slate-500 text-xs">{pos.durationDays}-day lock</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-emerald-600 font-bold text-sm">+{fmt(pos.rewardsEarned)} PIP</div>
                          <div className="text-slate-400 text-xs">
                            {pos.isMatured ? 'Matured' : `${daysLeft} days left`}
                          </div>
                        </div>

                        {pos.isMatured && (
                          <button
                            onClick={() => handleUnstake(pos.id)}
                            disabled={unstaking === pos.id}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-sm font-semibold rounded-lg transition-all"
                          >
                            {unstaking === pos.id ? 'Claiming...' : 'Claim'}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${pos.isMatured ? 'bg-emerald-500' : 'bg-slate-400'}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between mt-2 text-[10px] sm:text-xs text-slate-400">
                      <span>{new Date(pos.stakedAt).toLocaleDateString()}</span>
                      <span>{new Date(pos.unlockAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Completed Positions */}
        {completedPositions.length > 0 && (
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl sm:rounded-2xl p-4 sm:p-8 shadow-lg">
            <h2 className="text-lg sm:text-2xl font-bold text-slate-900 mb-4 sm:mb-6 flex items-center gap-2 sm:gap-3">
              <Clock size={22} className="text-slate-700 sm:w-7 sm:h-7" />
              Completed Stakes ({completedPositions.length})
            </h2>

            <div className="space-y-2">
              {completedPositions.slice(0, 5).map((pos) => (
                <div
                  key={pos.id}
                  className="flex items-center justify-between p-3 sm:p-4 bg-white/60 backdrop-blur-sm border border-slate-200/60 rounded-xl shadow-sm"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-1.5 bg-emerald-50 rounded-lg flex-shrink-0">
                      <Coins size={16} className="text-emerald-500" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-slate-900 font-medium text-sm">{fmt(pos.amountStaked)} PIP ({pos.durationDays}d)</div>
                      <div className="text-slate-400 text-xs">{new Date(pos.stakedAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <div className="text-emerald-600 font-bold text-sm flex-shrink-0 ml-2">
                    +{fmt(pos.rewardsEarned)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Staking Info */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-6 text-center shadow-sm">
          <p className="text-slate-600 text-xs sm:text-sm">
            <span className="font-bold">Remember:</span> Pipnosis Club tokens are utility tokens for membership access and community features.
            This is not financial advice. There are no guaranteed returns.
          </p>
        </div>
      </div>
    </ClubLayout>
  );
}
