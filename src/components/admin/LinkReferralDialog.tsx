import { useState } from 'react';
import { X, Link2, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface LinkReferralDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LinkReferralDialog({ isOpen, onClose }: LinkReferralDialogProps) {
  const [email, setEmail] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !referralCode.trim()) return;

    setLoading(true);
    setResult(null);

    try {
      const { data, error } = await supabase.rpc('admin_link_referral', {
        p_referee_email: email.trim(),
        p_referral_code: referralCode.trim().toUpperCase(),
      });

      if (error) {
        setResult({ success: false, message: error.message });
      } else if (data && !data.success) {
        setResult({ success: false, message: data.error });
      } else {
        setResult({ success: true, message: data?.message || 'Referral linked successfully' });
        setEmail('');
        setReferralCode('');
      }
    } catch (err: any) {
      setResult({ success: false, message: err.message || 'Unknown error' });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-gray-800 border border-gray-700 rounded-2xl p-6 max-w-md w-full shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <Link2 className="w-5 h-5 text-blue-400" />
            </div>
            <h3 className="text-lg font-bold text-white">Link Referral Manually</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <p className="text-gray-400 text-sm mb-5">
          Manually link a user to a referral code. Use this when the automatic referral capture failed.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Referee Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full px-4 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              required
            />
            <p className="text-xs text-gray-500 mt-1">The person who signed up via the referral link</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Referral Code
            </label>
            <input
              type="text"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value)}
              placeholder="CLUB-XXXXXX"
              className="w-full px-4 py-2.5 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono"
              required
            />
            <p className="text-xs text-gray-500 mt-1">The referrer's code (e.g., CLUB-4ZE356)</p>
          </div>

          {result && (
            <div className={`flex items-start gap-2.5 p-3 rounded-lg border text-sm ${
              result.success
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}>
              {result.success ? (
                <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              )}
              <span>{result.message}</span>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium rounded-lg transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !email.trim() || !referralCode.trim()}
              className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors text-sm flex items-center justify-center gap-2"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Linking...</>
              ) : (
                'Link Referral'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
