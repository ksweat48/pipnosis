import React, { useState, useEffect } from 'react';
import {
  Lock, Unlock, Loader2, Timer, TrendingUp, Info, CheckCircle,
  ArrowDownToLine, Coins, Wallet, Clock, XCircle, AlertTriangle
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { type ClubTokenBalance } from '@/services/club-token-ledger-service';
import { clubStakingService, type StakingSummary } from '@/services/club-staking-service';
import { cashoutRequestService, type CashoutRequest } from '@/services/cashout-request-service';
import { TOKENOMICS } from '@/config/tokenomics-constants';

const fmt = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatTimeRemaining = (unlockAt: string): string => {
  const diff = new Date(unlockAt).getTime() - Date.now();
  if (diff <= 0) return 'Ready';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) return `${Math.ceil(hours / 24)}d remaining`;
  return `${hours}h ${minutes}m`;
};

type ActiveTab = 'stake' | 'cashout' | 'positions';

interface TokenActionsCardProps {
  balance: ClubTokenBalance | null;
  stakingSummary: StakingSummary | null;
  stakingEnabled: boolean;
  tierMultiplier: number;
  onRefresh: () => Promise<void>;
}

export function TokenActionsCard({
  balance,
  stakingSummary,
  stakingEnabled,
  tierMultiplier,
  onRefresh,
}: TokenActionsCardProps) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>('stake');

  const [stakeAmount, setStakeAmount] = useState('');
  const [staking, setStaking] = useState(false);
  const [stakeError, setStakeError] = useState<string | null>(null);
  const [stakeSuccess, setStakeSuccess] = useState<string | null>(null);

  const [requestingUnstake, setRequestingUnstake] = useState<string | null>(null);
  const [executingUnstake, setExecutingUnstake] = useState<string | null>(null);
  const [claimingRewards, setClaimingRewards] = useState(false);

  const [cashoutAmount, setCashoutAmount] = useState('');
  const [payoutMethod, setPayoutMethod] = useState('ethereum');
  const [walletAddress, setWalletAddress] = useState('');
  const [cashoutLoading, setCashoutLoading] = useState(false);
  const [cashoutError, setCashoutError] = useState<string | null>(null);
  const [cashoutSuccess, setCashoutSuccess] = useState<string | null>(null);
  const [cashoutRequests, setCashoutRequests] = useState<CashoutRequest[]>([]);
  const [cashoutRequestsLoading, setCashoutRequestsLoading] = useState(false);

  const stakingConstants = clubStakingService.getStakingConstants();
  const activePositions = stakingSummary?.activePositions.filter(p => p.status === 'active' || p.status === 'unstake_requested') || [];
  const totalRewardsPending = stakingSummary?.rewardState?.pendingRewardsPip || 0;

  useEffect(() => {
    if (user && activeTab === 'cashout') {
      loadCashoutRequests();
    }
  }, [user, activeTab]);

  const loadCashoutRequests = async () => {
    if (!user) return;
    setCashoutRequestsLoading(true);
    const requests = await cashoutRequestService.getRequests(user.id);
    setCashoutRequests(requests);
    setCashoutRequestsLoading(false);
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
      setStakeSuccess(`Staked ${fmt(result.amount || amount)} PIP`);
      setStakeAmount('');
      await onRefresh();
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
      setStakeSuccess('Unstake requested. 24-hour cooldown started.');
      await onRefresh();
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
      setStakeSuccess(`Unstaked ${fmt(result.amountReturned || 0)} PIP`);
      await onRefresh();
    } else {
      setStakeError(result.error || 'Failed to unstake');
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
      await onRefresh();
    } else {
      setStakeError(result.error || 'Failed to claim rewards');
    }
    setClaimingRewards(false);
  };

  const handleSubmitCashout = async () => {
    if (!user) return;
    const amount = parseFloat(cashoutAmount);
    if (isNaN(amount) || amount < 100) {
      setCashoutError('Minimum cashout is $100 USD');
      return;
    }
    if (!walletAddress || walletAddress.trim().length < 10) {
      setCashoutError('Enter a valid wallet address or bank details');
      return;
    }

    setCashoutLoading(true);
    setCashoutError(null);
    setCashoutSuccess(null);

    const result = await cashoutRequestService.submitRequest(
      user.id, amount, payoutMethod, walletAddress.trim()
    );

    if (result.success) {
      setCashoutSuccess(`Cashout request submitted: $${amount} USD (${result.tokensDeducted} PIP deducted)`);
      setCashoutAmount('');
      setWalletAddress('');
      await onRefresh();
      await loadCashoutRequests();
    } else {
      setCashoutError(result.error || 'Failed to submit cashout');
    }
    setCashoutLoading(false);
  };

  const handleCancelCashout = async (requestId: string) => {
    if (!user) return;
    const result = await cashoutRequestService.cancelRequest(requestId, user.id);
    if (result.success) {
      await loadCashoutRequests();
    }
  };

  const tabs = [
    { id: 'stake' as const, label: 'Stake', icon: Lock },
    { id: 'positions' as const, label: `Positions (${activePositions.length})`, icon: TrendingUp },
    { id: 'cashout' as const, label: 'Cashout', icon: ArrowDownToLine },
  ];

  return (
    <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl sm:rounded-2xl shadow-lg overflow-hidden">
      <div className="flex border-b border-slate-200/60 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 sm:px-6 py-3 sm:py-4 text-sm font-semibold transition-all whitespace-nowrap flex-1 justify-center ${
              activeTab === tab.id
                ? 'text-slate-900 border-b-2 border-slate-900 bg-white/50'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50/50'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-6">
        {(stakeError || cashoutError) && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm flex items-center gap-2">
            <AlertTriangle size={16} className="flex-shrink-0" />
            {stakeError || cashoutError}
          </div>
        )}
        {(stakeSuccess || cashoutSuccess) && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-sm flex items-center gap-2">
            <CheckCircle size={16} className="flex-shrink-0" />
            {stakeSuccess || cashoutSuccess}
          </div>
        )}

        {activeTab === 'stake' && (
          <StakeTab
            stakingEnabled={stakingEnabled}
            stakingConstants={stakingConstants}
            tierMultiplier={tierMultiplier}
            balance={balance}
            stakeAmount={stakeAmount}
            setStakeAmount={setStakeAmount}
            staking={staking}
            handleStake={handleStake}
            totalRewardsPending={totalRewardsPending}
            claimingRewards={claimingRewards}
            handleClaimRewards={handleClaimRewards}
          />
        )}

        {activeTab === 'positions' && (
          <PositionsTab
            activePositions={activePositions}
            requestingUnstake={requestingUnstake}
            executingUnstake={executingUnstake}
            handleRequestUnstake={handleRequestUnstake}
            handleExecuteUnstake={handleExecuteUnstake}
          />
        )}

        {activeTab === 'cashout' && (
          <CashoutTab
            balance={balance}
            cashoutAmount={cashoutAmount}
            setCashoutAmount={setCashoutAmount}
            payoutMethod={payoutMethod}
            setPayoutMethod={setPayoutMethod}
            walletAddress={walletAddress}
            setWalletAddress={setWalletAddress}
            cashoutLoading={cashoutLoading}
            handleSubmitCashout={handleSubmitCashout}
            cashoutRequests={cashoutRequests}
            cashoutRequestsLoading={cashoutRequestsLoading}
            handleCancelCashout={handleCancelCashout}
          />
        )}
      </div>
    </div>
  );
}

function StakeTab({
  stakingEnabled, stakingConstants, tierMultiplier, balance,
  stakeAmount, setStakeAmount, staking, handleStake,
  totalRewardsPending, claimingRewards, handleClaimRewards,
}: any) {
  if (!stakingEnabled) {
    return (
      <div className="text-center py-8 sm:py-12">
        <div className="p-3 sm:p-4 bg-slate-100 rounded-full w-fit mx-auto mb-4">
          <Lock size={32} className="text-slate-400 sm:w-10 sm:h-10" />
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-2">Staking Locked</h3>
        <p className="text-slate-600 text-sm max-w-md mx-auto">
          Staking is available for Builder tier members and above. Upgrade your membership to start earning rewards.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {totalRewardsPending > 0 && (
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-100 rounded-xl">
                <Coins size={20} className="text-emerald-600" />
              </div>
              <div>
                <div className="text-emerald-900 font-bold">{fmt(totalRewardsPending)} PIP Ready</div>
                <div className="text-emerald-700 text-xs">Claim without unstaking</div>
              </div>
            </div>
            <button
              onClick={handleClaimRewards}
              disabled={claimingRewards}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-sm font-semibold rounded-xl transition-all flex items-center gap-2"
            >
              {claimingRewards ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
              {claimingRewards ? 'Claiming...' : 'Claim Rewards'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Info size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-blue-900 text-xs sm:text-sm space-y-1">
            <p><span className="font-semibold">Min lock:</span> 7 days before unstake request</p>
            <p><span className="font-semibold">Cooldown:</span> 24h after request</p>
            <p><span className="font-semibold">Multiplier:</span> {tierMultiplier}x weight</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-slate-600 text-sm mb-2">
            Amount (min {stakingConstants.minStakeAmount} PIP)
          </label>
          <input
            type="number"
            value={stakeAmount}
            onChange={(e: any) => setStakeAmount(e.target.value)}
            placeholder={`${stakingConstants.minStakeAmount}`}
            min={stakingConstants.minStakeAmount}
            step="0.01"
            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent"
          />
          <div className="text-slate-400 text-xs mt-1">
            Available: {fmt(balance?.availableTokens || 0)} PIP
          </div>
        </div>
        <div className="flex flex-col justify-end">
          <button
            onClick={handleStake}
            disabled={staking || !stakeAmount}
            className="w-full px-6 py-3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
          >
            {staking ? <Loader2 size={18} className="animate-spin" /> : <Lock size={18} />}
            {staking ? 'Staking...' : 'Stake PIP'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PositionsTab({
  activePositions, requestingUnstake, executingUnstake,
  handleRequestUnstake, handleExecuteUnstake,
}: any) {
  if (activePositions.length === 0) {
    return (
      <div className="text-center py-8 sm:py-12">
        <div className="p-3 bg-slate-100 rounded-full w-fit mx-auto mb-4">
          <TrendingUp size={28} className="text-slate-400" />
        </div>
        <h3 className="text-lg font-bold text-slate-900 mb-1">No Active Stakes</h3>
        <p className="text-slate-500 text-sm">Stake PIP tokens to start earning rewards</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activePositions.map((pos: any) => {
        const isUnstakeRequested = pos.status === 'unstake_requested';
        const canRequestUnstake = pos.canUnstake && pos.status === 'active';
        const canExecuteUnstake = pos.canExecuteUnstake;
        const stakedDays = Math.ceil((Date.now() - new Date(pos.stakedAt).getTime()) / (1000 * 60 * 60 * 24));

        return (
          <div key={pos.id} className="bg-white/60 backdrop-blur-sm border border-slate-200/60 rounded-xl p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${
                  canExecuteUnstake ? 'bg-emerald-50' :
                  isUnstakeRequested ? 'bg-amber-50' : 'bg-blue-50'
                }`}>
                  {canExecuteUnstake ? <Unlock size={18} className="text-emerald-500" /> :
                   isUnstakeRequested ? <Timer size={18} className="text-amber-500" /> :
                   <Lock size={18} className="text-blue-500" />}
                </div>
                <div>
                  <div className="text-slate-900 font-bold">{fmt(pos.amountStaked)} PIP</div>
                  <div className="text-slate-500 text-xs">
                    {isUnstakeRequested
                      ? `Cooldown: ${pos.unlockAt ? formatTimeRemaining(pos.unlockAt) : 'Processing'}`
                      : `Staked ${stakedDays}d ago`
                    }
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-emerald-600 font-bold text-sm">+{fmt(pos.rewardsEarned)} PIP</div>
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
                    {executingUnstake === pos.id ? 'Unstaking...' : 'Unstake'}
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
                    {requestingUnstake === pos.id ? 'Requesting...' : 'Unstake'}
                  </button>
                )}
                {!canRequestUnstake && !isUnstakeRequested && (
                  <div className="px-4 py-2 bg-slate-100 text-slate-500 text-sm font-semibold rounded-lg">
                    {7 - stakedDays > 0 ? `${7 - stakedDays}d lock` : 'Ready'}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CashoutTab({
  balance, cashoutAmount, setCashoutAmount, payoutMethod, setPayoutMethod,
  walletAddress, setWalletAddress, cashoutLoading, handleSubmitCashout,
  cashoutRequests, cashoutRequestsLoading, handleCancelCashout,
}: any) {
  const available = balance?.availableTokens || 0;
  const maxCashoutUsd = available * TOKENOMICS.TOKEN.UTILITY_REFERENCE_VALUE_USD;
  const tokensNeeded = cashoutAmount ? Math.ceil(parseFloat(cashoutAmount) / TOKENOMICS.TOKEN.UTILITY_REFERENCE_VALUE_USD) : 0;

  const payoutMethods = [
    { id: 'ethereum', label: 'Ethereum (ETH)', placeholder: '0x...' },
    { id: 'bitcoin', label: 'Bitcoin (BTC)', placeholder: 'bc1... or 1...' },
    { id: 'bank_transfer', label: 'Bank Transfer', placeholder: 'IBAN / Account details' },
  ];

  return (
    <div className="space-y-5">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-amber-900 text-xs sm:text-sm space-y-1">
            <p><span className="font-semibold">Minimum cashout:</span> $100 USD</p>
            <p><span className="font-semibold">Rate:</span> 1 PIP = ${TOKENOMICS.TOKEN.UTILITY_REFERENCE_VALUE_USD.toFixed(2)} USD</p>
            <p><span className="font-semibold">Available:</span> {fmt(available)} PIP (~${maxCashoutUsd.toFixed(2)} USD)</p>
            <p>Requests are reviewed by admin before processing.</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-slate-600 text-sm mb-2">Amount (USD)</label>
          <input
            type="number"
            value={cashoutAmount}
            onChange={(e: any) => setCashoutAmount(e.target.value)}
            placeholder="100.00"
            min={100}
            step="0.01"
            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent"
          />
          {tokensNeeded > 0 && (
            <div className="text-slate-500 text-xs mt-1">
              {tokensNeeded} PIP will be deducted
              {tokensNeeded > available && (
                <span className="text-red-500 ml-1">(insufficient balance)</span>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="block text-slate-600 text-sm mb-2">Payout Method</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {payoutMethods.map((m) => (
              <button
                key={m.id}
                onClick={() => setPayoutMethod(m.id)}
                className={`p-3 rounded-xl text-sm font-medium border transition-all text-left ${
                  payoutMethod === m.id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-slate-600 text-sm mb-2">
            {payoutMethod === 'bank_transfer' ? 'Bank Details' : 'Wallet Address'}
          </label>
          <input
            type="text"
            value={walletAddress}
            onChange={(e: any) => setWalletAddress(e.target.value)}
            placeholder={payoutMethods.find(m => m.id === payoutMethod)?.placeholder || ''}
            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-transparent"
          />
        </div>

        <button
          onClick={handleSubmitCashout}
          disabled={cashoutLoading || !cashoutAmount || !walletAddress}
          className="w-full px-6 py-3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
        >
          {cashoutLoading ? <Loader2 size={18} className="animate-spin" /> : <ArrowDownToLine size={18} />}
          {cashoutLoading ? 'Submitting...' : 'Submit Cashout Request'}
        </button>
      </div>

      {cashoutRequests.length > 0 && (
        <div className="mt-6">
          <h4 className="text-slate-900 font-bold text-sm mb-3 flex items-center gap-2">
            <Clock size={16} />
            Previous Requests
          </h4>
          <div className="space-y-2">
            {cashoutRequests.map((req: CashoutRequest) => (
              <div key={req.id} className="bg-white/60 border border-slate-200/60 rounded-xl p-3 sm:p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-slate-900 font-semibold text-sm">
                      ${Number(req.amountUsd).toFixed(2)} USD
                    </div>
                    <div className="text-slate-400 text-xs">
                      {req.tokensDeducted} PIP via {req.payoutMethod.replace('_', ' ')} -- {new Date(req.submittedAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <CashoutStatusBadge status={req.status} />
                    {req.status === 'pending' && (
                      <button
                        onClick={() => handleCancelCashout(req.id)}
                        className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                        title="Cancel request"
                      >
                        <XCircle size={16} />
                      </button>
                    )}
                  </div>
                </div>
                {req.rejectionReason && (
                  <div className="mt-2 text-xs text-red-600 bg-red-50 rounded-lg p-2">
                    Reason: {req.rejectionReason}
                  </div>
                )}
                {req.blockchainTxHash && (
                  <div className="mt-2 text-xs text-slate-500 bg-slate-50 rounded-lg p-2 font-mono truncate">
                    TX: {req.blockchainTxHash}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CashoutStatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Pending' },
    under_review: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Reviewing' },
    approved: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Approved' },
    processing: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Processing' },
    completed: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Completed' },
    rejected: { bg: 'bg-red-100', text: 'text-red-700', label: 'Rejected' },
    cancelled: { bg: 'bg-slate-100', text: 'text-slate-500', label: 'Cancelled' },
  };

  const c = config[status] || config.pending;
  return (
    <span className={`px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-semibold ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}
