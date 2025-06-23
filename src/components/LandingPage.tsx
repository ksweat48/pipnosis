import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Zap, 
  TrendingUp, 
  Brain, 
  Camera, 
  Target, 
  MessageCircle, 
  Mail, 
  CheckCircle, 
  Star,
  ArrowRight,
  Play,
  Shield,
  Clock,
  DollarSign,
  Home,
  Loader,
  AlertCircle
} from 'lucide-react';
import { useWaitlistSignup } from '../hooks/useAPI';

export const LandingPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<'free' | 'beta'>('free');
  const navigate = useNavigate();
  
  const { joinWaitlist, isSubmitting, error, success, resetState } = useWaitlistSignup();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    
    const result = await joinWaitlist(email, selectedPlan);
    if (result) {
      // Success handled by the hook
      console.log('Successfully joined waitlist');
    }
  };

  const handleBackToDashboard = () => {
    navigate('/');
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    if (error || success) {
      resetState();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900">
      {/* Header */}
      <header className="relative z-50 px-4 py-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
              <img 
                src="/Pipnosis icon.png" 
                alt="Pipnosis AI Trading Logo" 
                className="w-full h-full object-cover"
              />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Pipnosis</h1>
              <p className="text-xs text-emerald-400">AI Trading System</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <button 
              onClick={handleBackToDashboard}
              className="flex items-center space-x-2 text-slate-300 hover:text-white transition-colors"
            >
              <Home className="h-4 w-4" />
              <span>Dashboard</span>
            </button>
            <button className="text-slate-300 hover:text-white transition-colors">
              How It Works
            </button>
            <button className="bg-emerald-500 text-white px-4 py-2 rounded-lg hover:bg-emerald-600 transition-colors">
              Join Waitlist
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative px-4 py-16 sm:py-24">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="text-center lg:text-left">
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight mb-6">
                Earn Passive Income with{' '}
                <span className="bg-gradient-to-r from-emerald-400 to-emerald-600 bg-clip-text text-transparent">
                  AI Trading
                </span>
                . Just Prompt and Profit.
              </h1>
              
              <p className="text-xl text-slate-300 mb-8 leading-relaxed">
                Let Pipnosis handle the trades while you focus on life. Just tell it how much you want to make this week and it does the heavy lifting.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                <button 
                  onClick={() => setSelectedPlan('free')}
                  className={`px-8 py-4 rounded-xl font-semibold text-lg transition-all transform hover:scale-105 shadow-lg ${
                    selectedPlan === 'free'
                      ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white'
                      : 'bg-slate-800 border-2 border-emerald-500 text-emerald-400 hover:bg-emerald-500 hover:text-white'
                  }`}
                >
                  Join Free Waitlist. Available in 12 Months
                </button>
                <button 
                  onClick={() => setSelectedPlan('beta')}
                  className={`px-8 py-4 rounded-xl font-semibold text-lg transition-all ${
                    selectedPlan === 'beta'
                      ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white'
                      : 'bg-slate-800 border-2 border-emerald-500 text-emerald-400 hover:bg-emerald-500 hover:text-white'
                  }`}
                >
                  Join Beta in 3 Months. $20 Fast Track Access
                </button>
              </div>
              
              <div className="mt-8 flex items-center justify-center lg:justify-start space-x-6 text-sm text-slate-400">
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
              <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6 shadow-2xl">
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
                  <div className="bg-gradient-to-r from-green-500/20 to-green-600/20 border border-green-500/30 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-green-400 font-medium">Low Risk Strategy</span>
                      <span className="text-green-400 text-sm">Est. $485</span>
                    </div>
                    <p className="text-slate-300 text-xs">Conservative approach with 85% success rate</p>
                  </div>
                  
                  <div className="bg-gradient-to-r from-yellow-500/20 to-yellow-600/20 border border-yellow-500/30 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-yellow-400 font-medium">Medium Risk Strategy</span>
                      <span className="text-yellow-400 text-sm">Est. $520</span>
                    </div>
                    <p className="text-slate-300 text-xs">Balanced approach with 75% success rate</p>
                  </div>
                  
                  <div className="bg-gradient-to-r from-red-500/20 to-red-600/20 border border-red-500/30 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-red-400 font-medium">High Risk Strategy</span>
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

      {/* What is Pipnosis Section */}
      <section className="px-4 py-16 bg-slate-800/50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Meet Pipnosis: The Smartest Way to Trade.
            </h2>
            <p className="text-xl text-slate-300 max-w-4xl mx-auto leading-relaxed">
              Pipnosis is your AI trading brain. It analyzes charts across multiple timeframes (W1, D1, H1, M15) and executes trades on your behalf. You don't need to understand technical indicators or strategy. Just prompt what you want to earn, and Pipnosis calculates a path to your goal based on risk preference.
            </p>
          </div>
          
          <div className="bg-slate-900 rounded-2xl border border-slate-700 p-8 max-w-4xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div>
                <div className="bg-slate-800 rounded-lg p-4 mb-4">
                  <div className="flex items-center space-x-2 mb-2">
                    <MessageCircle className="h-4 w-4 text-emerald-400" />
                    <span className="text-white text-sm">User Prompt</span>
                  </div>
                  <p className="text-emerald-400 font-medium">"Make me $300 this week"</p>
                </div>
                
                <div className="flex items-center space-x-3 mb-4">
                  <ArrowRight className="h-5 w-5 text-slate-400" />
                  <span className="text-slate-300">AI Analysis in Progress...</span>
                </div>
              </div>
              
              <div className="space-y-3">
                <div className="bg-gradient-to-r from-emerald-500/10 to-emerald-600/10 border border-emerald-500/30 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-400 text-sm font-medium">Low Risk Plan</span>
                    <span className="text-emerald-400 text-xs">2% risk/trade</span>
                  </div>
                </div>
                <div className="bg-gradient-to-r from-yellow-500/10 to-yellow-600/10 border border-yellow-500/30 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-yellow-400 text-sm font-medium">Medium Risk Plan</span>
                    <span className="text-yellow-400 text-xs">5% risk/trade</span>
                  </div>
                </div>
                <div className="bg-gradient-to-r from-red-500/10 to-red-600/10 border border-red-500/30 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-red-400 text-sm font-medium">High Risk Plan</span>
                    <span className="text-red-400 text-xs">10% risk/trade</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="px-4 py-16">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">How It Works</h2>
            <p className="text-xl text-slate-300">Four simple steps to automated trading success</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              {
                step: 1,
                title: 'Prompt Pipnosis',
                description: 'Type: "Make me $500 this week" or "Earn 3% per trade"',
                icon: MessageCircle,
                color: 'emerald'
              },
              {
                step: 2,
                title: 'Choose Risk Mode',
                description: 'Low, Medium, or High or let AI decide for you',
                icon: Shield,
                color: 'blue'
              },
              {
                step: 3,
                title: 'Execution',
                description: 'Pipnosis enters and exits real time trades using smart decision making',
                icon: Brain,
                color: 'purple'
              },
              {
                step: 4,
                title: 'You Profit',
                description: 'Watch AI hit your goals while sending updates to Telegram & email',
                icon: DollarSign,
                color: 'green'
              }
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className={`w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-${item.color}-500 to-${item.color}-600 rounded-2xl flex items-center justify-center`}>
                  <item.icon className="h-8 w-8 text-white" />
                </div>
                <div className={`w-8 h-8 mx-auto mb-4 bg-${item.color}-500 text-white rounded-full flex items-center justify-center font-bold`}>
                  {item.step}
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-slate-300 text-sm leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="px-4 py-16 bg-slate-800/50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Why Join the Waitlist?</h2>
            <p className="text-xl text-slate-300">Choose your path to AI powered trading</p>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* Free Plan */}
            <div className={`bg-slate-900 border-2 rounded-2xl p-8 relative transition-all ${
              selectedPlan === 'free' ? 'border-emerald-500' : 'border-slate-700'
            }`}>
              <div className="text-center mb-6">
                <h3 className="text-2xl font-bold text-white mb-2">Free Plan</h3>
                <p className="text-slate-400 mb-4">Join in 12 Months</p>
                <div className="text-4xl font-bold text-white mb-2">$0</div>
                <p className="text-slate-400">No payment now, get notified at public release</p>
              </div>
              
              <ul className="space-y-3 mb-8">
                <li className="flex items-center space-x-3">
                  <CheckCircle className="h-5 w-5 text-emerald-400" />
                  <span className="text-slate-300">Snapshot trading (upload charts, let AI decide)</span>
                </li>
                <li className="flex items-center space-x-3">
                  <CheckCircle className="h-5 w-5 text-emerald-400" />
                  <span className="text-slate-300">Perfect for learners & casual traders</span>
                </li>
                <li className="flex items-center space-x-3">
                  <CheckCircle className="h-5 w-5 text-emerald-400" />
                  <span className="text-slate-300">Email notifications</span>
                </li>
                <li className="flex items-center space-x-3">
                  <CheckCircle className="h-5 w-5 text-emerald-400" />
                  <span className="text-slate-300">Basic AI strategies</span>
                </li>
              </ul>
              
              <button 
                onClick={() => setSelectedPlan('free')}
                className={`w-full py-3 px-6 rounded-lg font-semibold transition-all ${
                  selectedPlan === 'free' 
                    ? 'bg-emerald-500 text-white' 
                    : 'bg-slate-800 border border-slate-600 text-slate-300 hover:border-emerald-500'
                }`}
              >
                {selectedPlan === 'free' ? 'Selected' : 'Select Free Plan'}
              </button>
            </div>
            
            {/* Beta Plan */}
            <div className={`bg-gradient-to-br from-emerald-900/50 to-emerald-800/50 border-2 rounded-2xl p-8 relative transition-all ${
              selectedPlan === 'beta' ? 'border-emerald-400' : 'border-emerald-500'
            }`}>
              <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                <span className="bg-emerald-500 text-white px-4 py-1 rounded-full text-sm font-medium">
                  Most Popular
                </span>
              </div>
              
              <div className="text-center mb-6">
                <h3 className="text-2xl font-bold text-white mb-2">Beta Access</h3>
                <p className="text-emerald-400 mb-4">Available in 3 Months</p>
                <div className="text-4xl font-bold text-white mb-2">$20</div>
                <p className="text-slate-400">Early access to Pipnosis AI + real time API trading</p>
              </div>
              
              <ul className="space-y-3 mb-8">
                <li className="flex items-center space-x-3">
                  <CheckCircle className="h-5 w-5 text-emerald-400" />
                  <span className="text-slate-300">Full automation and earnings potential</span>
                </li>
                <li className="flex items-center space-x-3">
                  <CheckCircle className="h-5 w-5 text-emerald-400" />
                  <span className="text-slate-300">Priority support & feature testing</span>
                </li>
                <li className="flex items-center space-x-3">
                  <CheckCircle className="h-5 w-5 text-emerald-400" />
                  <span className="text-slate-300">Real time MT5 API integration</span>
                </li>
                <li className="flex items-center space-x-3">
                  <CheckCircle className="h-5 w-5 text-emerald-400" />
                  <span className="text-slate-300">Advanced AI strategies</span>
                </li>
                <li className="flex items-center space-x-3">
                  <CheckCircle className="h-5 w-5 text-emerald-400" />
                  <span className="text-slate-300">Telegram + Email alerts</span>
                </li>
              </ul>
              
              <button 
                onClick={() => setSelectedPlan('beta')}
                className={`w-full py-3 px-6 rounded-lg font-semibold transition-all ${
                  selectedPlan === 'beta' 
                    ? 'bg-emerald-500 text-white' 
                    : 'bg-emerald-500/20 border border-emerald-500 text-emerald-400 hover:bg-emerald-500 hover:text-white'
                }`}
              >
                {selectedPlan === 'beta' ? 'Selected' : 'Select Beta Plan'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="px-4 py-16">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Features That Sell the Vision</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center">
                <Brain className="h-10 w-10 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">🧠 AI Brain Driven Decisions</h3>
              <p className="text-slate-300">Pipnosis evaluates every trade in real time based on smart predictions.</p>
            </div>
            
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl flex items-center justify-center">
                <Camera className="h-10 w-10 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">📷 Snapshot OR API Mode</h3>
              <p className="text-slate-300">Use chart screenshots or connect your MT5 account with one click.</p>
            </div>
            
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-2xl flex items-center justify-center">
                <Target className="h-10 w-10 text-white" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-3">📈 Set Your Goals, Sit Back</h3>
              <p className="text-slate-300">Tell Pipnosis how much you want to earn this week. Let it do the rest.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="px-4 py-16 bg-slate-800/50">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">What Users Say</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8">
              <div className="flex items-center space-x-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-5 w-5 text-yellow-400 fill-current" />
                ))}
              </div>
              <blockquote className="text-slate-300 text-lg mb-4 italic">
                "I was invited to test Pipnosis 'Make me $200 this week' and the bot did just that. I got updates, trades, and results all hands off. OMG this is a game changer!"
              </blockquote>
              <cite className="text-slate-400">— Future User, Beta Program</cite>
            </div>
            
            <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8">
              <div className="flex items-center space-x-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-5 w-5 text-yellow-400 fill-current" />
                ))}
              </div>
              <blockquote className="text-slate-300 text-lg mb-4 italic">
                "Pipnosis is like having a professional trader on autopilot, only smarter. I can literally use this to earn extra income every week. I can't believe this is possible!"
              </blockquote>
              <cite className="text-slate-400">— Future User, Beta Program</cite>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="px-4 py-16">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Ready to Let AI Trade For You?
          </h2>
          <p className="text-xl text-slate-300 mb-8">
            No strategy to learn. No screen time required. Just prompt. Pipnosis delivers.
          </p>
          
          <form onSubmit={handleSubmit} className="max-w-md mx-auto mb-8">
            <div className="flex flex-col sm:flex-row gap-4">
              <input
                type="email"
                value={email}
                onChange={handleEmailChange}
                placeholder="Enter your email"
                className="flex-1 px-4 py-3 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                required
                disabled={isSubmitting}
              />
              <button
                type="submit"
                disabled={isSubmitting || !email.trim()}
                className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white px-6 py-3 rounded-lg font-semibold hover:from-emerald-600 hover:to-emerald-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <div className="flex items-center space-x-2">
                    <Loader className="h-4 w-4 animate-spin" />
                    <span>Joining...</span>
                  </div>
                ) : (
                  'Join Waitlist'
                )}
              </button>
            </div>
            
            {/* Success/Error Messages */}
            {success && (
              <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg flex items-start space-x-2">
                <CheckCircle className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-green-400 text-sm font-medium">Successfully joined waitlist!</p>
                  <p className="text-green-300 text-xs mt-1">
                    You'll receive updates about the {selectedPlan === 'beta' ? 'beta release' : 'public launch'}.
                  </p>
                </div>
              </div>
            )}
            
            {error && (
              <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start space-x-2">
                <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-red-400 text-sm font-medium">Failed to join waitlist</p>
                  <p className="text-red-300 text-xs mt-1">{error}</p>
                </div>
              </div>
            )}
          </form>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button 
              onClick={() => setSelectedPlan('free')}
              className={`px-8 py-4 rounded-xl font-semibold text-lg transition-all transform hover:scale-105 ${
                selectedPlan === 'free'
                  ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white'
                  : 'bg-slate-800 border-2 border-emerald-500 text-emerald-400 hover:bg-emerald-500 hover:text-white'
              }`}
            >
              Join Free Waitlist. Launching in 12 Months
            </button>
            <button 
              onClick={() => setSelectedPlan('beta')}
              className={`px-8 py-4 rounded-xl font-semibold text-lg transition-all ${
                selectedPlan === 'beta'
                  ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white'
                  : 'bg-slate-800 border-2 border-emerald-500 text-emerald-400 hover:bg-emerald-500 hover:text-white'
              }`}
            >
              Join Beta Test. $20 Access in 3 Months
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-4 py-8 border-t border-slate-700">
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