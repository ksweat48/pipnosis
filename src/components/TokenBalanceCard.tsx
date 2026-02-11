import React from 'react';
import { Coins, Lock, TrendingUp, Gift, Loader2 } from 'lucide-react';
import { type ClubTokenBalance } from '@/services/club-token-ledger-service';
import { type StakingSummary } from '@/services/club-staking-service';
import { TOKENOMICS } from '@/config/tokenomics-constants';
import { FormattedTokenNumber } from './FormattedTokenNumber';

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface TokenBalanceCardProps {
  balance: ClubTokenBalance | null;
  stakingSummary?: StakingSummary | null;
  loading?: boolean;
  variant?: 'compact' | 'full';
}

export function TokenBalanceCard({
  balance,
  stakingSummary,
  loading = false,
  variant = 'compact',
}: TokenBalanceCardProps) {
  const available = balance?.availableTokens || 0;
  const locked = balance?.lockedTokens || 0;
  const totalTokens = balance?.totalTokens || 0;
  const lifetimeEarned = balance?.lifetimeEarned || 0;
  const lifetimeSpent = balance?.lifetimeSpent || 0;
  const staked = stakingSummary?.rewardState?.stakedPip || 0;
  const rewardsPending = stakingSummary?.rewardState?.pendingRewardsPip || 0;
  const rewardsClaimed = stakingSummary?.rewardState?.claimedTotalPip || 0;

  const utilityValue = available * TOKENOMICS.TOKEN.UTILITY_REFERENCE_VALUE_USD;

  const total = available + locked + staked;
  const availablePct = total > 0 ? (available / total) * 100 : 0;
  const lockedPct = total > 0 ? (locked / total) * 100 : 0;
  const stakedPct = total > 0 ? (staked / total) * 100 : 0;

  if (loading) {
    return (
      <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl sm:rounded-2xl p-6 sm:p-8 shadow-lg">
        <div className="flex items-center justify-center py-8">
          <Loader2 size={24} className="animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl sm:rounded-2xl p-4 sm:p-6 shadow-lg">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 bg-amber-50 rounded-xl">
            <Coins size={22} className="text-amber-500" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900">PIP Access Tokens</h3>
            <p className="text-slate-500 text-xs">Your token balance overview</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100/80 rounded-xl p-3 sm:p-4">
            <div className="text-slate-500 text-[10px] sm:text-xs mb-1">Available</div>
            <FormattedTokenNumber
              value={available}
              wholeClassName="text-base sm:text-xl md:text-2xl font-bold text-slate-900"
              decimalClassName="text-[10px] sm:text-xs text-slate-600"
            />
            <div className="text-amber-600 text-[10px] sm:text-xs mt-0.5">
              ~${utilityValue.toFixed(2)} value
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 sm:p-4">
            <div className="text-slate-500 text-[10px] sm:text-xs mb-1">Locked</div>
            <FormattedTokenNumber
              value={locked}
              wholeClassName="text-base sm:text-xl md:text-2xl font-bold text-slate-900"
              decimalClassName="text-[10px] sm:text-xs text-slate-600"
            />
            <div className="text-slate-400 text-[10px] sm:text-xs mt-0.5">Membership</div>
          </div>

          <div className="bg-blue-50 border border-blue-100/80 rounded-xl p-3 sm:p-4">
            <div className="text-slate-500 text-[10px] sm:text-xs mb-1">Staked</div>
            <FormattedTokenNumber
              value={staked}
              wholeClassName="text-base sm:text-xl md:text-2xl font-bold text-blue-600"
              decimalClassName="text-[10px] sm:text-xs text-blue-500"
            />
            <div className="text-blue-500 text-[10px] sm:text-xs mt-0.5">
              {rewardsPending > 0 ? `+${fmt(rewardsPending)} pending` : 'Earning rewards'}
            </div>
          </div>
        </div>

        {total > 0 && (
          <div className="mt-4">
            <div className="flex items-center gap-1.5 h-2 rounded-full overflow-hidden bg-slate-100">
              {availablePct > 0 && (
                <div
                  className="h-full bg-amber-400 rounded-full transition-all duration-500"
                  style={{ width: `${availablePct}%` }}
                />
              )}
              {lockedPct > 0 && (
                <div
                  className="h-full bg-slate-300 rounded-full transition-all duration-500"
                  style={{ width: `${lockedPct}%` }}
                />
              )}
              {stakedPct > 0 && (
                <div
                  className="h-full bg-blue-400 rounded-full transition-all duration-500"
                  style={{ width: `${stakedPct}%` }}
                />
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 text-[10px] sm:text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                Available
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-slate-300" />
                Locked
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-400" />
                Staked
              </span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl sm:rounded-2xl p-4 sm:p-8 shadow-lg">
      <div className="flex items-center gap-3 sm:gap-4 mb-6">
        <div className="p-2.5 sm:p-3 bg-amber-50 rounded-xl">
          <Coins size={28} className="text-amber-500 sm:w-8 sm:h-8" />
        </div>
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900">PIP Token Balance</h2>
          <p className="text-slate-500 text-sm">Complete token overview</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100/80 rounded-xl p-3 sm:p-5">
          <div className="flex items-center gap-2 mb-2">
            <Coins size={16} className="text-amber-500" />
            <span className="text-slate-500 text-[10px] sm:text-xs">Available</span>
          </div>
          <FormattedTokenNumber
            value={available}
            wholeClassName="text-lg sm:text-2xl md:text-3xl font-bold text-slate-900"
            decimalClassName="text-xs sm:text-sm text-slate-600"
          />
          <div className="text-amber-600 text-[10px] sm:text-xs mt-1">
            ~${utilityValue.toFixed(2)} utility value
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 sm:p-5">
          <div className="flex items-center gap-2 mb-2">
            <Lock size={16} className="text-slate-400" />
            <span className="text-slate-500 text-[10px] sm:text-xs">Locked</span>
          </div>
          <FormattedTokenNumber
            value={locked}
            wholeClassName="text-lg sm:text-2xl md:text-3xl font-bold text-slate-900"
            decimalClassName="text-xs sm:text-sm text-slate-600"
          />
          <div className="text-slate-400 text-[10px] sm:text-xs mt-1">Membership requirement</div>
        </div>

        <div className="bg-blue-50 border border-blue-100/80 rounded-xl p-3 sm:p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp size={16} className="text-blue-500" />
            <span className="text-slate-500 text-[10px] sm:text-xs">Staked</span>
          </div>
          <FormattedTokenNumber
            value={staked}
            wholeClassName="text-lg sm:text-2xl md:text-3xl font-bold text-blue-600"
            decimalClassName="text-xs sm:text-sm text-blue-500"
          />
          <div className="text-blue-500 text-[10px] sm:text-xs mt-1">Earning rewards</div>
        </div>

        <div className="bg-emerald-50 border border-emerald-100/80 rounded-xl p-3 sm:p-5">
          <div className="flex items-center gap-2 mb-2">
            <Gift size={16} className="text-emerald-500" />
            <span className="text-slate-500 text-[10px] sm:text-xs">Rewards</span>
          </div>
          <FormattedTokenNumber
            value={rewardsPending}
            wholeClassName="text-lg sm:text-2xl md:text-3xl font-bold text-emerald-600"
            decimalClassName="text-xs sm:text-sm text-emerald-500"
          />
          <div className="text-emerald-500 text-[10px] sm:text-xs mt-1">
            {fmt(rewardsClaimed)} claimed lifetime
          </div>
        </div>
      </div>

      {total > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-500 text-xs sm:text-sm">Token Distribution</span>
            <span className="text-slate-900 text-xs sm:text-sm font-semibold">
              {fmt(totalTokens)} total PIP
            </span>
          </div>
          <div className="flex items-center gap-1 h-3 rounded-full overflow-hidden bg-slate-100">
            {availablePct > 0 && (
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-500"
                style={{ width: `${availablePct}%` }}
              />
            )}
            {lockedPct > 0 && (
              <div
                className="h-full bg-slate-300 rounded-full transition-all duration-500"
                style={{ width: `${lockedPct}%` }}
              />
            )}
            {stakedPct > 0 && (
              <div
                className="h-full bg-gradient-to-r from-blue-400 to-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${stakedPct}%` }}
              />
            )}
          </div>
          <div className="flex items-center gap-4 sm:gap-6 mt-2 text-[10px] sm:text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              Available ({fmt(available)})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
              Locked ({fmt(locked)})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
              Staked ({fmt(staked)})
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="bg-white/60 border border-slate-100 rounded-xl p-3 sm:p-4">
          <div className="text-slate-500 text-[10px] sm:text-xs mb-1">Lifetime Earned</div>
          <div className="text-emerald-600 text-base sm:text-xl font-bold">{fmt(lifetimeEarned)}</div>
        </div>
        <div className="bg-white/60 border border-slate-100 rounded-xl p-3 sm:p-4">
          <div className="text-slate-500 text-[10px] sm:text-xs mb-1">Lifetime Spent</div>
          <div className="text-red-500 text-base sm:text-xl font-bold">{fmt(lifetimeSpent)}</div>
        </div>
      </div>
    </div>
  );
}
