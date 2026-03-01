import React, { useState, useEffect } from 'react';
import { X, Award, ChevronRight, CheckCircle, AlertCircle, Coins, TrendingUp, Shield } from 'lucide-react';
import { clubMembershipService, MembershipPackage, AdminGrantResult } from '../../services/club-membership-service';
import { useAuth } from '../../hooks/useAuth';
import { useToast } from '../../hooks/useToast';

interface GrantMembershipDialogProps {
  targetUserId: string;
  targetEmail: string;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 'select' | 'confirm' | 'result';

const TIER_COLORS: Record<number, { bg: string; border: string; badge: string; text: string }> = {
  1: { bg: 'bg-gray-700/50',    border: 'border-gray-600',    badge: 'bg-gray-600 text-gray-200',       text: 'text-gray-300' },
  2: { bg: 'bg-blue-900/30',    border: 'border-blue-700',    badge: 'bg-blue-700 text-blue-100',       text: 'text-blue-300' },
  3: { bg: 'bg-emerald-900/30', border: 'border-emerald-700', badge: 'bg-emerald-700 text-emerald-100', text: 'text-emerald-300' },
  4: { bg: 'bg-amber-900/30',   border: 'border-amber-600',   badge: 'bg-amber-600 text-amber-100',     text: 'text-amber-300' },
  5: { bg: 'bg-orange-900/30',  border: 'border-orange-600',  badge: 'bg-orange-600 text-orange-100',   text: 'text-orange-300' },
  6: { bg: 'bg-red-900/30',     border: 'border-red-600',     badge: 'bg-red-600 text-red-100',         text: 'text-red-300' },
};

function tierColors(level: number) {
  return TIER_COLORS[level] ?? TIER_COLORS[1];
}

export const GrantMembershipDialog: React.FC<GrantMembershipDialogProps> = ({
  targetUserId,
  targetEmail,
  onClose,
  onSuccess,
}) => {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [step, setStep] = useState<Step>('select');
  const [packages, setPackages] = useState<MembershipPackage[]>([]);
  const [currentMembership, setCurrentMembership] = useState<{ tierLevel: number; tierName: string } | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<MembershipPackage | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AdminGrantResult | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [pkgs, membership] = await Promise.all([
          clubMembershipService.getActivePackages(),
          clubMembershipService.getUserMembership(targetUserId),
        ]);
        setPackages(pkgs);
        if (membership) {
          setCurrentMembership({ tierLevel: membership.tierLevel, tierName: membership.tierName });
        }
      } catch (err) {
        showToast('Failed to load membership packages', 'error');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [targetUserId, showToast]);

  const eligiblePackages = packages.filter(
    (p) => !currentMembership || p.tierLevel > currentMembership.tierLevel
  );

  const handleSelectPackage = (pkg: MembershipPackage) => {
    setSelectedPackage(pkg);
  };

  const handleProceedToConfirm = () => {
    if (!selectedPackage) {
      showToast('Please select a membership tier', 'error');
      return;
    }
    if (reason.trim().length < 5) {
      showToast('Please enter a reason (at least 5 characters)', 'error');
      return;
    }
    setStep('confirm');
  };

  const handleConfirm = async () => {
    if (!selectedPackage || !user?.id) return;
    try {
      setSubmitting(true);
      const res = await clubMembershipService.adminGrantMembership(
        user.id,
        targetUserId,
        selectedPackage.id,
        reason.trim()
      );
      setResult(res);
      setStep('result');
      if (res.success) {
        onSuccess();
      }
    } catch (err) {
      console.error(err);
      showToast('Unexpected error granting membership', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl max-w-lg w-full max-h-[90dvh] flex flex-col shadow-2xl border border-gray-700">

        {/* Header */}
        <div className="flex-shrink-0 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/15 rounded-lg">
              <Award size={20} className="text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Grant Membership</h2>
              <p className="text-xs text-gray-400 truncate max-w-[260px]">{targetEmail}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-lg transition-colors">
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        {/* Steps indicator */}
        {step !== 'result' && (
          <div className="flex-shrink-0 px-6 py-3 flex items-center gap-2 border-b border-gray-700/50">
            {(['select', 'confirm'] as Step[]).map((s, i) => (
              <React.Fragment key={s}>
                <div className={`flex items-center gap-1.5 text-xs font-medium ${step === s ? 'text-amber-400' : step === 'confirm' && s === 'select' ? 'text-green-400' : 'text-gray-500'}`}>
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step === s ? 'bg-amber-500 text-black' : step === 'confirm' && s === 'select' ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-500'}`}>
                    {step === 'confirm' && s === 'select' ? '✓' : i + 1}
                  </div>
                  {s === 'select' ? 'Select Tier' : 'Confirm'}
                </div>
                {i === 0 && <ChevronRight size={12} className="text-gray-600" />}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch', minHeight: 0 }}>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
              Loading membership packages...
            </div>
          ) : step === 'select' ? (
            <SelectStep
              packages={packages}
              eligiblePackages={eligiblePackages}
              currentMembership={currentMembership}
              selectedPackage={selectedPackage}
              reason={reason}
              onSelectPackage={handleSelectPackage}
              onReasonChange={setReason}
            />
          ) : step === 'confirm' ? (
            <ConfirmStep
              selectedPackage={selectedPackage!}
              currentMembership={currentMembership}
              targetEmail={targetEmail}
              reason={reason}
            />
          ) : (
            <ResultStep result={result!} selectedPackage={selectedPackage} />
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-gray-700 px-6 py-4">
          {step === 'select' && !loading && (
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 px-4 py-2.5 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium">
                Cancel
              </button>
              <button
                onClick={handleProceedToConfirm}
                disabled={!selectedPackage || reason.trim().length < 5}
                className="flex-1 px-4 py-2.5 bg-amber-500 text-black rounded-lg hover:bg-amber-400 transition-colors text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                Review Grant
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          {step === 'confirm' && (
            <div className="flex gap-3">
              <button onClick={() => setStep('select')} disabled={submitting} className="flex-1 px-4 py-2.5 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium disabled:opacity-50">
                Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={submitting}
                className="flex-1 px-4 py-2.5 bg-amber-500 text-black rounded-lg hover:bg-amber-400 transition-colors text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Granting...' : 'Confirm Grant'}
              </button>
            </div>
          )}
          {step === 'result' && (
            <button onClick={onClose} className="w-full px-4 py-2.5 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

interface SelectStepProps {
  packages: MembershipPackage[];
  eligiblePackages: MembershipPackage[];
  currentMembership: { tierLevel: number; tierName: string } | null;
  selectedPackage: MembershipPackage | null;
  reason: string;
  onSelectPackage: (pkg: MembershipPackage) => void;
  onReasonChange: (v: string) => void;
}

const SelectStep: React.FC<SelectStepProps> = ({
  packages,
  eligiblePackages,
  currentMembership,
  selectedPackage,
  reason,
  onSelectPackage,
  onReasonChange,
}) => {
  return (
    <div className="p-6 space-y-5">
      {currentMembership && (
        <div className="bg-blue-900/20 border border-blue-700/40 rounded-lg px-4 py-3 flex items-center gap-3">
          <Shield size={16} className="text-blue-400 flex-shrink-0" />
          <div className="text-sm text-gray-300">
            Current membership: <span className="font-semibold text-blue-300">{currentMembership.tierName}</span>
            {' '}(Tier {currentMembership.tierLevel}). Only higher tiers are available.
          </div>
        </div>
      )}

      {!currentMembership && (
        <div className="bg-gray-700/30 rounded-lg px-4 py-3 text-sm text-gray-400">
          This user has no active membership. Any tier can be granted.
        </div>
      )}

      <div className="space-y-2">
        <div className="text-sm font-medium text-gray-300 mb-1">Select Membership Tier</div>
        {packages.map((pkg) => {
          const isEligible = eligiblePackages.some((e) => e.id === pkg.id);
          const isSelected = selectedPackage?.id === pkg.id;
          const colors = tierColors(pkg.tierLevel);

          return (
            <button
              key={pkg.id}
              onClick={() => isEligible && onSelectPackage(pkg)}
              disabled={!isEligible}
              className={`w-full text-left rounded-lg border px-4 py-3 transition-all ${
                !isEligible
                  ? 'opacity-40 cursor-not-allowed bg-gray-900/40 border-gray-700'
                  : isSelected
                  ? `${colors.bg} ${colors.border} ring-1 ring-amber-500/60`
                  : `${colors.bg} ${colors.border} hover:opacity-90`
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${colors.badge}`}>
                    TIER {pkg.tierLevel}
                  </span>
                  <span className={`font-semibold text-sm ${isEligible ? colors.text : 'text-gray-500'}`}>
                    {pkg.name}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span className="flex items-center gap-1">
                    <Coins size={12} className="text-amber-400" />
                    {pkg.initialTokenAllocation.toLocaleString()} PIP
                  </span>
                  {isSelected && <CheckCircle size={16} className="text-amber-400" />}
                </div>
              </div>
              {isEligible && pkg.discountPct > 0 && (
                <div className="mt-1 text-xs text-gray-500">
                  {(pkg.discountPct * 100).toFixed(0)}% credit discount
                  {pkg.stakingEnabled ? ' · Staking enabled' : ''}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Reason for Grant <span className="text-red-400">*</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="e.g., Awarded for beta testing participation, partnership agreement..."
          rows={3}
          className="w-full px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 resize-none text-sm"
        />
        <div className={`text-xs mt-1 ${reason.trim().length < 5 ? 'text-gray-600' : 'text-green-500'}`}>
          {reason.trim().length}/5 minimum characters
        </div>
      </div>
    </div>
  );
};

interface ConfirmStepProps {
  selectedPackage: MembershipPackage;
  currentMembership: { tierLevel: number; tierName: string } | null;
  targetEmail: string;
  reason: string;
}

const ConfirmStep: React.FC<ConfirmStepProps> = ({ selectedPackage, currentMembership, targetEmail, reason }) => {
  const colors = tierColors(selectedPackage.tierLevel);
  const isUpgrade = !!currentMembership;

  return (
    <div className="p-6 space-y-4">
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
        <AlertCircle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-gray-300">
          You are about to {isUpgrade ? 'upgrade' : 'grant'} membership. This action is <strong className="text-white">logged and irreversible</strong>.
          Tokens will be immediately emitted to the user's wallet.
        </p>
      </div>

      <div className="bg-gray-900 rounded-lg divide-y divide-gray-700/50">
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-gray-400">Target User</span>
          <span className="text-sm text-white font-mono truncate max-w-[200px]">{targetEmail}</span>
        </div>
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-gray-400">Action</span>
          <span className={`text-sm font-semibold ${isUpgrade ? 'text-blue-300' : 'text-green-300'}`}>
            {isUpgrade ? 'Tier Upgrade' : 'New Grant'}
          </span>
        </div>
        {isUpgrade && currentMembership && (
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-gray-400">From</span>
            <span className="text-sm text-gray-300">
              {currentMembership.tierName} (Tier {currentMembership.tierLevel})
            </span>
          </div>
        )}
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-gray-400">New Tier</span>
          <span className={`text-sm font-bold ${colors.text}`}>
            {selectedPackage.name} (Tier {selectedPackage.tierLevel})
          </span>
        </div>
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-gray-400">PIP Tokens Emitted</span>
          <span className="text-sm font-bold text-amber-400 flex items-center gap-1.5">
            <TrendingUp size={14} />
            +{selectedPackage.initialTokenAllocation.toLocaleString()} PIP
          </span>
        </div>
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-gray-400">Amount Charged</span>
          <span className="text-sm font-semibold text-green-400">$0.00 (Complimentary)</span>
        </div>
        <div className="px-4 py-3">
          <div className="text-sm text-gray-400 mb-1">Reason (logged)</div>
          <div className="text-sm text-white italic">"{reason}"</div>
        </div>
      </div>
    </div>
  );
};

interface ResultStepProps {
  result: AdminGrantResult;
  selectedPackage: MembershipPackage | null;
}

const ResultStep: React.FC<ResultStepProps> = ({ result, selectedPackage }) => {
  if (!result.success) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex flex-col items-center text-center py-6 gap-4">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
            <AlertCircle size={32} className="text-red-400" />
          </div>
          <div>
            <div className="text-xl font-bold text-white mb-1">Grant Failed</div>
            <div className="text-sm text-red-400">{result.error}</div>
          </div>
        </div>
      </div>
    );
  }

  const colors = selectedPackage ? tierColors(selectedPackage.tierLevel) : tierColors(1);

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-col items-center text-center py-4 gap-3">
        <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center">
          <CheckCircle size={32} className="text-green-400" />
        </div>
        <div>
          <div className="text-xl font-bold text-white mb-1">
            {result.isUpgrade ? 'Membership Upgraded!' : 'Membership Granted!'}
          </div>
          <div className={`text-sm font-semibold ${colors.text}`}>{result.tierName}</div>
        </div>
      </div>

      <div className="bg-gray-900 rounded-lg divide-y divide-gray-700/50">
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-gray-400">New Tier</span>
          <span className={`text-sm font-bold ${colors.text}`}>
            {result.tierName} (Level {result.tierLevel})
          </span>
        </div>
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-gray-400">PIP Tokens Emitted</span>
          <span className="text-sm font-bold text-amber-400 flex items-center gap-1.5">
            <Coins size={14} />
            +{(result.tokensAwarded ?? 0).toLocaleString()} PIP
          </span>
        </div>
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-gray-400">Audit ID</span>
          <span className="text-xs font-mono text-gray-500 truncate max-w-[200px]">{result.auditId}</span>
        </div>
      </div>

      <div className="text-xs text-center text-gray-500">
        This action has been logged in the admin audit trail and the token ledger.
      </div>
    </div>
  );
};
