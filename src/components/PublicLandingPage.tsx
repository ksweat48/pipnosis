import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, Brain, Zap, Shield, Target, ArrowRight,
  CheckCircle, DollarSign, BarChart3, Sparkles
} from 'lucide-react';

export const PublicLandingPage: React.FC = () => {
  const navigate = useNavigate();

  const handleSignUp = () => {
    navigate('/auth');
  };

  const handleSignIn = () => {
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
      <header className="border-b border-white/10 backdrop-blur-sm bg-gray-950/50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 sm:h-20">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl overflow-hidden">
                <img
                  src="/Pipnosis icon.png"
                  alt="Pipnosis Logo"
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-emerald-400 to-green-500 bg-clip-text text-transparent">
                Pipnosis
              </span>
            </div>

            <div className="flex items-center space-x-3 sm:space-x-4">
              <button
                onClick={handleSignIn}
                className="px-4 sm:px-6 py-2 text-white/80 hover:text-white transition-colors font-medium"
              >
                Sign In
              </button>
              <button
                onClick={handleSignUp}
                className="px-4 sm:px-6 py-2 sm:py-2.5 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-lg hover:from-emerald-600 hover:to-green-700 transition-all font-semibold shadow-lg shadow-emerald-500/20"
              >
                Get Started
              </button>
            </div>
          </div>
        </div>
      </header>

      <main>
        <section className="relative px-4 py-16 sm:py-20 lg:py-32 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 to-transparent"></div>

          <div className="max-w-6xl mx-auto relative">
            <div className="text-center space-y-6 sm:space-y-8">
              <div className="inline-flex items-center space-x-2 px-4 py-2 glass-card">
                <Sparkles className="h-4 w-4 text-emerald-400" />
                <span className="text-sm text-emerald-400 font-medium">AI-Powered Trading Platform</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold text-white leading-tight px-4">
                Tell Your Goal.
                <br />
                <span className="bg-gradient-to-r from-emerald-400 via-green-500 to-lime-400 bg-clip-text text-transparent">
                  AI Handles Trading.
                </span>
              </h1>

              <p className="text-lg sm:text-xl lg:text-2xl text-white/70 max-w-3xl mx-auto leading-relaxed px-4">
                Pipnosis uses advanced AI to analyze markets, generate strategies, and execute trades.
                No trading experience required.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
                <button
                  onClick={handleSignUp}
                  className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-xl hover:from-emerald-600 hover:to-green-700 transition-all font-semibold text-lg shadow-xl shadow-emerald-500/30 flex items-center justify-center space-x-2"
                >
                  <span>Start Trading Free</span>
                  <ArrowRight className="h-5 w-5" />
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-8 pt-6 text-sm text-white/60">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="h-4 w-4 text-emerald-400" />
                  <span>$10,000 Demo Account</span>
                </div>
                <div className="flex items-center space-x-2">
                  <CheckCircle className="h-4 w-4 text-emerald-400" />
                  <span>No Credit Card Required</span>
                </div>
                <div className="flex items-center space-x-2">
                  <CheckCircle className="h-4 w-4 text-emerald-400" />
                  <span>AI-Powered Strategies</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 py-16 sm:py-24">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12 sm:mb-16">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">
                How It Works
              </h2>
              <p className="text-lg sm:text-xl text-white/60 max-w-2xl mx-auto">
                Three simple steps to start AI-powered trading
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
              <div className="glass-card p-6 sm:p-8 text-center space-y-4">
                <div className="w-16 h-16 mx-auto bg-gradient-to-br from-emerald-500/20 to-green-600/20 rounded-2xl flex items-center justify-center">
                  <Brain className="h-8 w-8 text-emerald-400" />
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-white">1. Tell Your Goal</h3>
                <p className="text-white/60 leading-relaxed">
                  Simply describe what you want to achieve: "Make me $500 this week" or "Conservative gains with low risk"
                </p>
              </div>

              <div className="glass-card p-6 sm:p-8 text-center space-y-4">
                <div className="w-16 h-16 mx-auto bg-gradient-to-br from-blue-500/20 to-cyan-600/20 rounded-2xl flex items-center justify-center">
                  <Target className="h-8 w-8 text-blue-400" />
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-white">2. AI Analyzes</h3>
                <p className="text-white/60 leading-relaxed">
                  Our AI analyzes real-time market data and generates multiple strategy options tailored to your goal
                </p>
              </div>

              <div className="glass-card p-6 sm:p-8 text-center space-y-4">
                <div className="w-16 h-16 mx-auto bg-gradient-to-br from-purple-500/20 to-pink-600/20 rounded-2xl flex items-center justify-center">
                  <Zap className="h-8 w-8 text-purple-400" />
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-white">3. Execute Trades</h3>
                <p className="text-white/60 leading-relaxed">
                  Review AI recommendations and execute trades with one click. AI monitors and manages positions automatically
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 py-16 sm:py-24 bg-gradient-to-b from-transparent to-emerald-950/20">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12 sm:mb-16">
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4">
                Powerful Features
              </h2>
              <p className="text-lg sm:text-xl text-white/60 max-w-2xl mx-auto">
                Everything you need for successful AI-powered trading
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="glass-card p-6 space-y-3">
                <DollarSign className="h-10 w-10 text-emerald-400" />
                <h3 className="text-xl font-bold text-white">Real-Time Analysis</h3>
                <p className="text-white/60">
                  AI continuously monitors market conditions and adapts strategies in real-time
                </p>
              </div>

              <div className="glass-card p-6 space-y-3">
                <Shield className="h-10 w-10 text-blue-400" />
                <h3 className="text-xl font-bold text-white">Risk Management</h3>
                <p className="text-white/60">
                  Automated stop-loss and take-profit levels protect your capital
                </p>
              </div>

              <div className="glass-card p-6 space-y-3">
                <BarChart3 className="h-10 w-10 text-purple-400" />
                <h3 className="text-xl font-bold text-white">Performance Tracking</h3>
                <p className="text-white/60">
                  Detailed analytics and insights into your trading performance
                </p>
              </div>

              <div className="glass-card p-6 space-y-3">
                <TrendingUp className="h-10 w-10 text-green-400" />
                <h3 className="text-xl font-bold text-white">Multiple Strategies</h3>
                <p className="text-white/60">
                  AI generates multiple options from conservative to aggressive approaches
                </p>
              </div>

              <div className="glass-card p-6 space-y-3">
                <Brain className="h-10 w-10 text-cyan-400" />
                <h3 className="text-xl font-bold text-white">Natural Language</h3>
                <p className="text-white/60">
                  No complex commands - just tell the AI what you want in plain English
                </p>
              </div>

              <div className="glass-card p-6 space-y-3">
                <Sparkles className="h-10 w-10 text-amber-400" />
                <h3 className="text-xl font-bold text-white">Trading Journal</h3>
                <p className="text-white/60">
                  Automatic logging of all decisions and trades for learning and improvement
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 py-16 sm:py-24">
          <div className="max-w-4xl mx-auto text-center space-y-8">
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white">
              Ready to Start Trading?
            </h2>
            <p className="text-lg sm:text-xl text-white/60">
              Join Pipnosis today and experience AI-powered trading with a free $10,000 demo account
            </p>
            <button
              onClick={handleSignUp}
              className="px-10 py-5 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-xl hover:from-emerald-600 hover:to-green-700 transition-all font-bold text-lg shadow-2xl shadow-emerald-500/40 inline-flex items-center space-x-3"
            >
              <span>Create Free Account</span>
              <ArrowRight className="h-6 w-6" />
            </button>

            <p className="text-sm text-white/40 pt-4">
              No credit card required. Start with $10,000 demo balance.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 px-4 py-8">
        <div className="max-w-7xl mx-auto text-center">
          <div className="flex items-center justify-center space-x-2 mb-4">
            <div className="w-8 h-8 rounded-lg overflow-hidden">
              <img
                src="/Pipnosis icon.png"
                alt="Pipnosis Logo"
                className="w-full h-full object-cover"
              />
            </div>
            <span className="text-lg font-bold text-white">Pipnosis</span>
          </div>
          <p className="text-white/40 text-sm">
            © 2024 Pipnosis. AI-powered trading for everyone.
          </p>
        </div>
      </footer>
    </div>
  );
};
