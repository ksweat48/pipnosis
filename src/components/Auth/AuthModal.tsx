import React, { useState } from 'react';
import { X, Mail, Lock, User, Loader, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'login' | 'signup';
}

export const AuthModal: React.FC<AuthModalProps> = ({ 
  isOpen, 
  onClose, 
  initialMode = 'login' 
}) => {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { signIn, signUp } = useAuth();

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setFullName('');
    setError(null);
    setSuccess(null);
  };

  const handleModeSwitch = (newMode: 'login' | 'signup') => {
    setMode(newMode);
    resetForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (mode === 'signup') {
        const { error } = await signUp(email, password, fullName);
        if (error) {
          setError(error.message);
        } else {
          setSuccess('Account created successfully! Please check your email to verify your account.');
          setTimeout(() => {
            onClose();
          }, 2000);
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) {
          setError(error.message);
        } else {
          setSuccess('Logged in successfully!');
          setTimeout(() => {
            onClose();
          }, 1000);
        }
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg overflow-hidden">
              <img 
                src="/Pipnosis icon.png" 
                alt="Pipnosis Logo" 
                className="w-full h-full object-cover"
              />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">
                {mode === 'login' ? 'Welcome Back' : 'Join Pipnosis'}
              </h2>
              <p className="text-sm text-slate-400">
                {mode === 'login' ? 'Sign in to your account' : 'Create your trading account'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <div className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  <User className="h-4 w-4 inline mr-2" />
                  Full Name
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter your full name"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required={mode === 'signup'}
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <Mail className="h-4 w-4 inline mr-2" />
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                <Lock className="h-4 w-4 inline mr-2" />
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
                minLength={6}
              />
              {mode === 'signup' && (
                <p className="text-xs text-slate-500 mt-1">Password must be at least 6 characters</p>
              )}
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start space-x-2">
                <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-red-400 text-sm font-medium">Error</p>
                  <p className="text-red-300 text-xs mt-1">{error}</p>
                </div>
              </div>
            )}

            {success && (
              <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg flex items-start space-x-2">
                <CheckCircle className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-green-400 text-sm font-medium">Success</p>
                  <p className="text-green-300 text-xs mt-1">{success}</p>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 text-white py-3 px-4 rounded-lg hover:from-emerald-600 hover:to-emerald-700 transition-all font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="flex items-center justify-center space-x-2">
                  <Loader className="h-4 w-4 animate-spin" />
                  <span>{mode === 'login' ? 'Signing In...' : 'Creating Account...'}</span>
                </div>
              ) : (
                mode === 'login' ? 'Sign In' : 'Create Account'
              )}
            </button>
          </form>

          {/* Mode Switch */}
          <div className="mt-6 text-center">
            <p className="text-slate-400 text-sm">
              {mode === 'login' ? "Don't have an account?" : "Already have an account?"}
              <button
                onClick={() => handleModeSwitch(mode === 'login' ? 'signup' : 'login')}
                className="text-emerald-400 hover:text-emerald-300 ml-1 font-medium"
              >
                {mode === 'login' ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          </div>

          {/* Demo Account Notice */}
          {mode === 'signup' && (
            <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
              <div className="flex items-start space-x-2">
                <CheckCircle className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-emerald-300 text-sm font-medium">Demo Trading Account</p>
                  <p className="text-emerald-200 text-xs mt-1">
                    You'll start with a $10,000 demo balance to practice AI trading strategies risk-free.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};