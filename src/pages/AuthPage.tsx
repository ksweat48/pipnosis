import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, AlertCircle, Loader, User } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

export const AuthPage: React.FC = () => {
  const { user, signIn, signUp, resetPassword, loading: authLoading } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Redirect if already authenticated
  if (user && !authLoading) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (isForgotPassword) {
        const { error } = await resetPassword(email);
        if (error) {
          setError(error.message);
        } else {
          setSuccessMessage('Password reset link sent! Check your email.');
          setTimeout(() => {
            setIsForgotPassword(false);
            setSuccessMessage(null);
          }, 3000);
        }
      } else {
        const { error } = isSignUp
          ? await signUp(email, password, fullName)
          : await signIn(email, password);

        if (error) {
          let errorMessage = error.message;

          if (errorMessage.includes('Invalid login credentials')) {
            errorMessage = 'Invalid email or password. Please check your credentials and try again.';
          } else if (errorMessage.includes('Email not confirmed')) {
            errorMessage = 'Please confirm your email address before signing in.';
          } else if (errorMessage.includes('User not found')) {
            errorMessage = 'No account found with this email address.';
          }

          setError(errorMessage);
        }
      }
    } catch (err) {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex items-center justify-center">
        <div className="text-center">
          <Loader className="h-12 w-12 text-emerald-400 animate-spin mx-auto mb-4" />
          <p className="text-white/70 text-lg">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo Section */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center space-x-3 mb-6">
            <div className="w-12 h-12 rounded-2xl overflow-hidden">
              <img 
                src="/Pipnosis icon.png" 
                alt="Pipnosis Logo" 
                className="w-full h-full object-cover"
              />
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-400 to-green-500 bg-clip-text text-transparent">
              Pipnosis
            </h1>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">
            {isForgotPassword ? 'Reset Password' : isSignUp ? 'Create Account' : 'Welcome Back'}
          </h2>
          <p className="text-white/60">
            {isForgotPassword
              ? 'Enter your email to receive a password reset link'
              : isSignUp
                ? 'Start your AI trading journey'
                : 'Sign in to your trading account'
            }
          </p>
        </div>

        {/* Auth Form */}
        <div className="glass-card p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Full Name Field - Only for Sign Up */}
            {isSignUp && !isForgotPassword && (
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Full Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-white/40" />
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full bg-white/5 border border-white/20 rounded-xl pl-12 pr-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                    placeholder="Enter your full name"
                    required
                  />
                </div>
              </div>
            )}

            {/* Email Field */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-white/40" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white/5 border border-white/20 rounded-xl pl-12 pr-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="Enter your email"
                  required
                />
              </div>
            </div>

            {/* Password Field - Hide for Forgot Password */}
            {!isForgotPassword && (
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-white/40" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white/5 border border-white/20 rounded-xl pl-12 pr-12 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                  placeholder="Enter your password"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white/40 hover:text-white/60"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>
            )}

            {/* Success Message */}
            {successMessage && (
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl flex items-start space-x-3">
                <AlertCircle className="h-5 w-5 text-emerald-400 mt-0.5 flex-shrink-0" />
                <p className="text-emerald-300 text-sm">{successMessage}</p>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl flex items-start space-x-3">
                <AlertCircle className="h-5 w-5 text-red-400 mt-0.5 flex-shrink-0" />
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-emerald-500 to-green-600 text-white py-3 px-4 rounded-xl font-semibold hover:from-emerald-600 hover:to-green-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {loading ? (
                <div className="flex items-center justify-center space-x-2">
                  <Loader className="h-5 w-5 animate-spin" />
                  <span>
                    {isForgotPassword
                      ? 'Sending Reset Link...'
                      : isSignUp
                        ? 'Creating Account...'
                        : 'Signing In...'
                    }
                  </span>
                </div>
              ) : (
                <span>
                  {isForgotPassword
                    ? 'Send Reset Link'
                    : isSignUp
                      ? 'Create Account'
                      : 'Sign In'
                  }
                </span>
              )}
            </button>
          </form>

          {/* Toggle Sign Up/Sign In/Forgot Password */}
          <div className="mt-6 text-center space-y-3">
            {!isForgotPassword && !isSignUp && (
              <button
                onClick={() => {
                  setIsForgotPassword(true);
                  setError(null);
                  setSuccessMessage(null);
                }}
                className="text-emerald-400 hover:text-emerald-300 text-sm font-medium block w-full"
              >
                Forgot your password?
              </button>
            )}

            <button
              onClick={() => {
                if (isForgotPassword) {
                  setIsForgotPassword(false);
                } else {
                  setIsSignUp(!isSignUp);
                }
                setError(null);
                setSuccessMessage(null);
                setFullName('');
              }}
              className="text-emerald-400 hover:text-emerald-300 text-sm font-medium"
            >
              {isForgotPassword
                ? 'Back to sign in'
                : isSignUp
                  ? 'Already have an account? Sign in'
                  : "Don't have an account? Sign up"
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};