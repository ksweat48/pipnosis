import { useState } from 'react';
import {
  X, Send, Search, AlertTriangle, CheckCircle, User,
  Shield, Coins, Loader2
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { logger } from '@/lib/logger';

interface ManualTokenTransferDialogProps {
  sourcePoolId: string;
  sourcePoolName: string;
  poolBalance: number;
  maxSingleGrant: number;
  onClose: () => void;
  onComplete: () => void;
}

type GrantPurpose =
  | 'marketing_partnership'
  | 'team_compensation'
  | 'community_reward'
  | 'operational_expense'
  | 'bug_bounty'
  | 'contest_prize'
  | 'other';

const GRANT_PURPOSES: { value: GrantPurpose; label: string }[] = [
  { value: 'marketing_partnership', label: 'Marketing Partnership' },
  { value: 'team_compensation', label: 'Team Compensation' },
  { value: 'community_reward', label: 'Community Reward' },
  { value: 'operational_expense', label: 'Operational Expense' },
  { value: 'bug_bounty', label: 'Bug Bounty' },
  { value: 'contest_prize', label: 'Contest / Prize' },
  { value: 'other', label: 'Other' },
];

interface RecipientInfo {
  userId: string;
  email: string;
  currentBalance: number;
}

type DialogStep = 'form' | 'preview' | 'success' | 'error';

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function ManualTokenTransferDialog({
  sourcePoolId,
  sourcePoolName,
  poolBalance,
  maxSingleGrant,
  onClose,
  onComplete,
}: ManualTokenTransferDialogProps) {
  const { user } = useAuth();
  const [step, setStep] = useState<DialogStep>('form');

  const [searchEmail, setSearchEmail] = useState('');
  const [searching, setSearching] = useState(false);
  const [recipient, setRecipient] = useState<RecipientInfo | null>(null);
  const [searchError, setSearchError] = useState('');

  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState<GrantPurpose>('community_reward');
  const [description, setDescription] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [resultMessage, setResultMessage] = useState('');

  const handleSearchRecipient = async () => {
    if (!searchEmail.trim()) return;
    setSearching(true);
    setSearchError('');
    setRecipient(null);

    try {
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('id, email')
        .eq('email', searchEmail.trim().toLowerCase())
        .maybeSingle();

      if (profileError) {
        setSearchError(`Search failed: ${profileError.message}`);
        return;
      }

      if (!profile) {
        setSearchError('No user found with that email address.');
        return;
      }

      const { data: balance } = await supabase
        .from('club_token_balances')
        .select('total_tokens')
        .eq('user_id', profile.id)
        .maybeSingle();

      setRecipient({
        userId: profile.id,
        email: profile.email,
        currentBalance: Number(balance?.total_tokens || 0),
      });
    } catch (error: any) {
      setSearchError(error.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const parsedAmount = Number(amount) || 0;

  const validationErrors: string[] = [];
  if (!recipient) validationErrors.push('Select a recipient');
  if (parsedAmount <= 0) validationErrors.push('Amount must be greater than 0');
  if (parsedAmount > maxSingleGrant) validationErrors.push(`Amount exceeds max single grant (${fmt(maxSingleGrant)} PIP)`);
  if (parsedAmount > poolBalance) validationErrors.push('Amount exceeds pool balance');
  if (!description.trim() && purpose === 'other') validationErrors.push('Description required for "Other" purpose');

  const canSubmit = validationErrors.length === 0;

  const handlePreview = () => {
    if (canSubmit) setStep('preview');
  };

  const handleConfirmGrant = async () => {
    if (!user || !recipient || !canSubmit) return;
    setSubmitting(true);

    try {
      const { data, error } = await supabase.rpc('admin_grant_tokens_from_pool', {
        p_admin_user_id: user.id,
        p_recipient_user_id: recipient.userId,
        p_amount: parsedAmount,
        p_source_pool_id: sourcePoolId,
        p_grant_purpose: purpose,
        p_description: description.trim() || `${GRANT_PURPOSES.find(p => p.value === purpose)?.label} grant`,
        p_metadata: {
          recipient_email: recipient.email,
          pool_balance_before: poolBalance,
          initiated_from: 'admin_dashboard',
        },
      });

      if (error) {
        logger.error('Admin grant failed', { error, sourcePoolId, recipientId: recipient.userId });
        setResultMessage(error.message);
        setStep('error');
        return;
      }

      setResultMessage(`Successfully granted ${fmt(parsedAmount)} PIP to ${recipient.email} from ${sourcePoolName}.`);
      setStep('success');
    } catch (error: any) {
      logger.error('Admin grant exception', { error });
      setResultMessage(error.message || 'Unexpected error');
      setStep('error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDone = () => {
    if (step === 'success') {
      onComplete();
    } else {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 rounded-lg">
              <Send className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-white font-semibold">Grant Tokens</h3>
              <p className="text-gray-400 text-xs">From: {sourcePoolName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Form Step */}
          {step === 'form' && (
            <>
              {/* Pool Info Bar */}
              <div className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3 border border-gray-700">
                <div>
                  <div className="text-gray-400 text-xs">Available in Pool</div>
                  <div className="text-white font-bold">{fmt(poolBalance)} PIP</div>
                </div>
                <div className="text-right">
                  <div className="text-gray-400 text-xs">Max Single Grant</div>
                  <div className="text-amber-400 font-bold">{fmt(maxSingleGrant)} PIP</div>
                </div>
              </div>

              {/* Recipient Search */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Recipient</label>
                {recipient ? (
                  <div className="flex items-center justify-between bg-emerald-500/10 rounded-lg px-4 py-3 border border-emerald-500/30">
                    <div className="flex items-center gap-3">
                      <User className="w-5 h-5 text-emerald-400" />
                      <div>
                        <div className="text-white text-sm font-medium">{recipient.email}</div>
                        <div className="text-gray-400 text-xs">
                          Current balance: {fmt(recipient.currentBalance)} PIP
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => { setRecipient(null); setSearchEmail(''); }}
                      className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-700 transition-colors"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <input
                          type="email"
                          value={searchEmail}
                          onChange={(e) => setSearchEmail(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSearchRecipient()}
                          placeholder="Enter user email..."
                          className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gray-500 transition-colors"
                        />
                      </div>
                      <button
                        onClick={handleSearchRecipient}
                        disabled={searching || !searchEmail.trim()}
                        className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-lg transition-colors text-sm font-medium"
                      >
                        {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Find'}
                      </button>
                    </div>
                    {searchError && (
                      <p className="text-red-400 text-xs flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {searchError}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Amount */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Amount (PIP)</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 500"
                  min={1}
                  max={maxSingleGrant}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gray-500 transition-colors"
                />
                {parsedAmount > 0 && parsedAmount <= maxSingleGrant && (
                  <div className="text-gray-500 text-xs mt-1">
                    {((parsedAmount / poolBalance) * 100).toFixed(4)}% of pool balance
                  </div>
                )}
              </div>

              {/* Purpose */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Grant Purpose</label>
                <select
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value as GrantPurpose)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-gray-500 transition-colors"
                >
                  {GRANT_PURPOSES.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Description {purpose === 'other' && <span className="text-red-400">*</span>}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief reason for this grant..."
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gray-500 transition-colors resize-none"
                />
              </div>

              {/* Validation Errors */}
              {validationErrors.length > 0 && parsedAmount > 0 && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                  {validationErrors.map((err, i) => (
                    <p key={i} className="text-red-400 text-xs flex items-center gap-1.5">
                      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                      {err}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Preview Step */}
          {step === 'preview' && recipient && (
            <div className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="w-5 h-5 text-amber-400" />
                  <span className="text-amber-400 font-semibold text-sm">Confirm Token Grant</span>
                </div>
                <p className="text-gray-300 text-sm">
                  Review the details below before confirming this irreversible token grant.
                </p>
              </div>

              <div className="space-y-3">
                <DetailRow label="Source Pool" value={sourcePoolName} />
                <DetailRow label="Pool ID" value={sourcePoolId} />
                <DetailRow label="Recipient" value={recipient.email} />
                <DetailRow label="Amount" value={`${fmt(parsedAmount)} PIP`} highlight />
                <DetailRow label="Purpose" value={GRANT_PURPOSES.find(p => p.value === purpose)?.label || purpose} />
                {description && <DetailRow label="Description" value={description} />}
                <div className="border-t border-gray-700 pt-3 mt-3">
                  <DetailRow label="Pool Balance After" value={`${fmt(poolBalance - parsedAmount)} PIP`} />
                  <DetailRow label="Recipient Balance After" value={`${fmt(recipient.currentBalance + parsedAmount)} PIP`} />
                </div>
              </div>
            </div>
          )}

          {/* Success Step */}
          {step === 'success' && (
            <div className="text-center py-6">
              <div className="mx-auto w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="w-8 h-8 text-emerald-400" />
              </div>
              <h3 className="text-white font-semibold text-lg mb-2">Grant Successful</h3>
              <p className="text-gray-400 text-sm">{resultMessage}</p>
            </div>
          )}

          {/* Error Step */}
          {step === 'error' && (
            <div className="text-center py-6">
              <div className="mx-auto w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
                <AlertTriangle className="w-8 h-8 text-red-400" />
              </div>
              <h3 className="text-white font-semibold text-lg mb-2">Grant Failed</h3>
              <p className="text-red-400 text-sm">{resultMessage}</p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-gray-700 flex items-center justify-end gap-3">
          {step === 'form' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-400 hover:text-white text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePreview}
                disabled={!canSubmit}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Coins className="w-4 h-4" />
                Review Grant
              </button>
            </>
          )}
          {step === 'preview' && (
            <>
              <button
                onClick={() => setStep('form')}
                className="px-4 py-2 text-gray-400 hover:text-white text-sm font-medium transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleConfirmGrant}
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {submitting ? 'Processing...' : 'Confirm Grant'}
              </button>
            </>
          )}
          {(step === 'success' || step === 'error') && (
            <button
              onClick={handleDone}
              className="px-5 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {step === 'success' ? 'Done' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-gray-400 text-sm">{label}</span>
      <span className={`text-sm font-medium ${highlight ? 'text-amber-400 text-base font-bold' : 'text-white'}`}>
        {value}
      </span>
    </div>
  );
}
