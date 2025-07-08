import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  TrendingUp, Brain, Camera, Target, MessageCircle, 
  CheckCircle, Star, ArrowRight, Play, Shield, 
  DollarSign, Home, Menu, X
} from 'lucide-react';

export const LandingPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<'free' | 'beta'>('free');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  const handleBackToDashboard = () => {
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900">
      {/* Enhanced App-like Header */}
      <header className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur-md border-b border-slate-700/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16 sm:h-20">
            {/* Logo Section */}
            <div className="flex items-center space-x-3 min-w-0 flex-1">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl overflow-hidden flex-shrink-0 ring-2 ring-emerald-500/20">
                <img 
                  src="/Pipnosis icon.png" 
                  alt="Pipnosis AI Trading Logo" 
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-bold text-white truncate">Pipnosis</h1>
                <p className="text-xs text-emerald-400 truncate hidden sm:block">AI Trading System</p>
              </div>
            </div>
            
            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center space-x-1">
              <button 
                onClick={handleBackToDashboard}
                className="flex items-center space-x-2 px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-all duration-200"
              >
                <Home className="h-4 w-4" />
                <span>Dashboard</span>
              </button>
              <button className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-all duration-200">
                How It Works
              </button>
              <button className="px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-all duration-200">
                Features
              </button>
              <button className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white px-6 py-2 rounded-lg hover:from-emerald-600 hover:to-emerald-700 transition-all duration-200 font-medium shadow-lg">
                Join Waitlist
              </button>
            </nav>

            {/* Mobile Menu Button */}
            <div className="md:hidden">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              >
                {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </button>
            </div>
          </div>

          {/* Mobile Menu Dropdown */}
          {isMobileMenuOpen && (
            <div className="md:hidden border-t border-slate-700/50 py-4">
              <div className="space-y-2">
                <button 
                  onClick={() => {
                    handleBackToDashboard();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full flex items-center space-x-3 px-4 py-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors text-left"
                >
                  <Home className="h-5 w-5" />
                  <span>Dashboard</span>
                </button>
                <button 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="w-full flex items-center space-x-3 px-4 py-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors text-left"
                >
                  <Target className="h-5 w-5" />
                  <span>How It Works</span>
                </button>
                <button 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="w-full flex items-center space-x-3 px-4 py-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors text-left"
                >
                  <TrendingUp className="h-5 w-5" />
                  <span>Features</span>
                </button>
                <div className="pt-2">
                  <button 
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 text-white px-4 py-3 rounded-lg hover:from-emerald-600 hover:to-emerald-700 transition-all duration-200 font-medium"
                  >
                    Join Waitlist
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative px-4 py-12 sm:py-16 lg:py-24">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            <div className="text-center lg:text-left">
              <h1 className="text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-bold text-white leading-tight mb-6">
                Earn Passive Income with{' '}
                <span className="bg-gradient-to-r from-emerald-400 to-emerald-600 bg-clip-text text-transparent">
                  AI Trading
                </span>
                . Just Prompt and Profit.
              </h1>
              
              <p className="text-lg sm:text-xl text-slate-300 mb-8 leading-relaxed">
                Let Pipnosis handle the trades while you focus on life. Just tell it how much you want to make this week and it does the heavy lifting.
              </p>
              
              <div className="flex flex-col space-y-3 sm:space-y-4 justify-center lg:justify-start">
                <button 
                  onClick={() => setSelectedPlan('free')}
                  className={`px-6 sm:px-8 py-3 sm:py-4 rounded-xl font-semibold text-sm sm:text-lg transition-all transform hover:scale-105 shadow-lg ${
                    selectedPlan === 'free'
                      ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white'
                      : 'bg-slate-800 border-2 border-emerald-500 text-emerald-400 hover:bg-emerald-500 hover:text-white'
                  }`}
                >
                  Free Plan. Available in 12 Months
                </button>
                <button 
                  onClick={() => setSelectedPlan('beta')}
                  className={`px-6 sm:px-8 py-3 sm:py-4 rounded-xl font-semibold text-sm sm:text-lg transition-all ${
                    selectedPlan === 'beta'
                      ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white'
                      : 'bg-slate-800 border-2 border-emerald-500 text-emerald-400 hover:bg-emerald-500 hover:text-white'
                  }`}
                >
                  Beta Access in 3 Months. $20 Fast Track
                </button>
              </div>
              
              <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row items-center justify-center lg:justify-start space-y-2 sm:space-y-0 sm:space-x-6 text-sm text-slate-400">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="h-4 w-4 text-emerald-400" />
                  <span>No Trading Experience Required</span>
                </div>
                <div className="flex items-center space-x-2">
                  <CheckCircle className="h-4 w-4 text-emerald-400" />
                  <span>Fully Automated</span>
                </div>
              </div>
            </div>
            
            <div className="relative">
              <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 sm:p-6 shadow-2xl">
                <div className="bg-slate-900 rounded-lg p-4 mb-4">
                  <div className="flex items-center space-x-2 mb-3">
                    <Brain className="h-5 w-5 text-emerald-400" />
                    <span className="text-white font-medium">AI Prompt Console</span>
                  </div>
                  <div className="bg-slate-800 rounded-lg p-3 border border-slate-600">
                    <p className="text-slate-300 text-sm">"Make me $500 this week"</p>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div className="bg-gradient-to-r from-green-500/20 to-green-600/20 border border-green-500/30 rounded-lg p-3 sm:p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-green-400 font-medium text-sm sm:text-base">Low Risk Strategy</span>
                      <span className="text-green-400 text-sm">Est. $485</span>
                    </div>
                    <p className="text-slate-300 text-xs">Conservative approach with 85% success rate</p>
                  </div>
                  
                  <div className="bg-gradient-to-r from-yellow-500/20 to-yellow-600/20 border border-yellow-500/30 rounded-lg p-3 sm:p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-yellow-400 font-medium text-sm sm:text-base">Medium Risk Strategy</span>
                      <span className="text-yellow-400 text-sm">Est. $520</span>
                    </div>
                    <p className="text-slate-300 text-xs">Balanced approach with 75% success rate</p>
                  </div>
                  
                  <div className="bg-gradient-to-r from-red-500/20 to-red-600/20 border border-red-500/30 rounded-lg p-3 sm:p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-red-400 font-medium text-sm sm:text-base">High Risk Strategy</span>
                      <span className="text-red-400 text-sm">Est. $650</span>
                    </div>
                    <p className="text-slate-300 text-xs">Aggressive approach with 65% success rate</p>
                  </div>
                </div>
              </div>
              
              {/* Floating elements */}
              <div className="absolute -top-4 -right-4 bg-emerald-500 text-white p-3 rounded-full animate-pulse">
                <TrendingUp className="h-6 w-6" />
              </div>
              <div className="absolute -bottom-4 -left-4 bg-blue-500 text-white p-3 rounded-full animate-bounce">
                <Brain className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="px-4 py-12 sm:py-16">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white mb-4">
            Ready to Let AI Trade For You?
          </h2>
          <p className="text-lg sm:text-xl text-slate-300 mb-8">
            No strategy to learn. No screen time required. Just prompt. Pipnosis delivers.
          </p>
          
          <div className="flex flex-col space-y-3 sm:space-y-4 justify-center">
            <button 
              onClick={() => setSelectedPlan('free')}
              className={`px-6 sm:px-8 py-3 sm:py-4 rounded-xl font-semibold text-sm sm:text-lg transition-all transform hover:scale-105 ${
                selectedPlan === 'free'
                  ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white'
                  : 'bg-slate-800 border-2 border-emerald-500 text-emerald-400 hover:bg-emerald-500 hover:text-white'
              }`}
            >
              Free Plan Available in 12 Months
            </button>
            <button 
              onClick={() => setSelectedPlan('beta')}
              className={`px-6 sm:px-8 py-3 sm:py-4 rounded-xl font-semibold text-sm sm:text-lg transition-all ${
                selectedPlan === 'beta'
                  ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white'
                  : 'bg-slate-800 border-2 border-emerald-500 text-emerald-400 hover:bg-emerald-500 hover:text-white'
              }`}
            >
              Beta Access. $20 in 3 Months
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-4 py-6 sm:py-8 border-t border-slate-700">
        <div className="max-w-7xl mx-auto text-center">
          <div className="flex items-center justify-center space-x-3 mb-4">
            <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0">
              <img 
                src="/Pipnosis icon.png" 
                alt="Pipnosis AI Trading Logo" 
                className="w-full h-full object-cover"
              />
            </div>
            <span className="text-white font-semibold">Pipnosis</span>
          </div>
          <p className="text-slate-400 text-sm">
            © 2024 Pipnosis. All rights reserved. AI powered trading for the future.
          </p>
        </div>
      </footer>
    </div>
  );
};