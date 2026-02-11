import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Eye, EyeOff } from 'lucide-react';
import { TermsModal } from '@/components/TermsModal';
import { DisclaimerModal } from '@/components/DisclaimerModal';

export function AuthPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedDisclaimer, setAcceptedDisclaimer] = useState(false);
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // SSOT: Capture referral code from URL and store it for signup processing
  useEffect(() => {
    const refCode = searchParams.get('ref');
    if (refCode) {
      sessionStorage.setItem('pending_referral_code', refCode);
      console.log('[AuthPage] Captured referral code:', refCode);
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!acceptedTerms || !acceptedDisclaimer) {
      setError('You must accept the Terms & Conditions and Disclaimer to continue.');
      return;
    }

    setLoading(true);

    try {
      const result = isSignUp ? await signUp(email, password) : await signIn(email, password);

      if (result.error) {
        setError(result.error.message);
      } else {
        navigate('/dashboard');
      }
    } catch (err) {
      setError('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-viewport relative flex items-center justify-center p-4 overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat animate-subtle-zoom"
        style={{
          backgroundImage: 'url(/2_pipnosis_background_hawk_and_candle_image.png)',
          backgroundAttachment: 'fixed'
        }}
      />
      <div className="absolute inset-0 bg-black/60" />

      <div className="glass-card p-8 max-w-md w-full relative z-10">
        <h1 className="text-3xl font-bold text-white mb-6 text-center">
          {isSignUp ? 'Sign Up' : 'Sign In'}
        </h1>

        {error && (
          <div className="bg-red-500/10 border border-red-500 text-red-500 p-3 rounded mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-gray-400 text-sm mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white/20 text-white p-3 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-gray-300"
              required
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-gray-400 text-sm">Password</label>
              {!isSignUp && (
                <Link
                  to="/reset-password"
                  className="text-emerald-500 hover:text-emerald-400 text-xs transition-colors"
                >
                  Forgot password?
                </Link>
              )}
            </div>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/20 text-white p-3 pr-12 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-gray-300"
                required
              />
              {isSignUp && (
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300 transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              )}
            </div>
          </div>

          <div className="space-y-3 bg-white/5 p-4 rounded border border-white/10">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="mt-1 w-5 h-5 rounded border-gray-400 text-emerald-600 focus:ring-emerald-500 focus:ring-offset-0 cursor-pointer"
                required
              />
              <span className="text-sm text-gray-300 flex-1">
                I have read and agree to the{' '}
                <button
                  type="button"
                  onClick={() => setShowTermsModal(true)}
                  className="text-emerald-400 hover:text-emerald-300 underline font-medium transition-colors"
                >
                  Terms & Conditions
                </button>
              </span>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={acceptedDisclaimer}
                onChange={(e) => setAcceptedDisclaimer(e.target.checked)}
                className="mt-1 w-5 h-5 rounded border-gray-400 text-emerald-600 focus:ring-emerald-500 focus:ring-offset-0 cursor-pointer"
                required
              />
              <span className="text-sm text-gray-300 flex-1">
                I have read and understand the{' '}
                <button
                  type="button"
                  onClick={() => setShowDisclaimerModal(true)}
                  className="text-amber-400 hover:text-amber-300 underline font-medium transition-colors"
                >
                  Risk Disclaimer
                </button>
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={loading || !acceptedTerms || !acceptedDisclaimer}
            className="w-full bg-emerald-600 text-white py-3 rounded hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? 'Processing...' : (isSignUp ? 'Sign Up' : 'Sign In')}
          </button>
        </form>

        <div className="mt-4 text-center">
          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              setAcceptedTerms(false);
              setAcceptedDisclaimer(false);
              setError('');
            }}
            className="text-emerald-500 hover:text-emerald-400 text-sm"
          >
            {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
          </button>
        </div>
      </div>

      <TermsModal isOpen={showTermsModal} onClose={() => setShowTermsModal(false)} />
      <DisclaimerModal isOpen={showDisclaimerModal} onClose={() => setShowDisclaimerModal(false)} />
    </div>
  );
}
