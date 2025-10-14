import React, { useState } from 'react';
import { Settings, Menu, X, ExternalLink, DollarSign, LogOut, User, LogIn, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useChartPreferences } from '@/hooks/useChartPreferences';
import { SettingsModal } from './SettingsModal';
import { DisclaimerModal } from './DisclaimerModal';
import { ConnectionStatus } from './ConnectionStatus';

export const Header: React.FC = () => {
  const { user, signOut, isAdmin } = useAuth();
  const { preferences, updatePreferences } = useChartPreferences();
  const navigate = useNavigate();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleDisclaimerClick = () => {
    setIsDisclaimerOpen(true);
    setIsMobileMenuOpen(false);
  };

  const handleSignOut = async () => {
    await signOut();
    setIsMobileMenuOpen(false);
  };

  const handleSignInClick = () => {
    navigate('/auth');
    setIsMobileMenuOpen(false);
  };

  const getDisplayBalance = () => {
    return `$10,000`; // Static demo balance
  };

  return (
    <>
      <header className="bg-black/20 backdrop-blur-2xl border-b border-white/10 px-4 sm:px-6 py-6 sticky top-0 z-40">
        <div className="flex items-center justify-between space-y-2">
          <ConnectionStatus className="absolute top-2 right-4 hidden sm:flex" />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 min-w-0 flex-1">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl overflow-hidden flex-shrink-0 ring-2 ring-emerald-500/30">
              <img 
                src="/Pipnosis icon.png" 
                alt="Pipnosis AI Trading Logo" 
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-2xl font-bold bg-gradient-to-r from-emerald-400 to-green-500 bg-clip-text text-transparent truncate">Pipnosis</h1>
              <p className="text-xs sm:text-sm text-white/60 truncate font-medium hidden xs:block">AI Trading Assistant</p>
            </div>
          </div>
          
          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center space-x-4">
            {user ? (
              <>
                {/* User Info */}
                <div className="flex items-center space-x-3 text-right">
                  <div className="p-2 bg-emerald-500/20 rounded-xl">
                    <User className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-xs text-white/60 font-medium">Signed in as</p>
                    <p className="text-sm font-bold text-white truncate max-w-32">
                      {user?.email}
                    </p>
                  </div>
                </div>
                
                <div className="text-right glass-card px-4 py-2">
                  <p className="text-xs text-white/60 font-medium">Demo Balance</p>
                  <p className="text-xl font-bold text-emerald-400 flex items-center justify-end">
                    <DollarSign className="h-4 w-4 mr-1" />
                    {getDisplayBalance()}
                  </p>
                  <p className="text-xs text-emerald-300 font-medium">Demo Account</p>
                </div>
                
                <div className="flex items-center space-x-2">
                  {isAdmin && (
                    <button
                      onClick={() => {
                        navigate('/admin/dashboard');
                      }}
                      className="p-3 text-white/60 hover:text-emerald-400 glass-button transition-all duration-200"
                      title="Admin Dashboard"
                    >
                      <Shield className="h-5 w-5" />
                    </button>
                  )}
                  <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="p-3 text-white/60 hover:text-white glass-button transition-all duration-200"
                  >
                    <Settings className="h-5 w-5" />
                  </button>
                  <button
                    onClick={handleSignOut}
                    className="p-3 text-white/60 hover:text-red-400 glass-button transition-all duration-200"
                    title="Sign Out"
                  >
                    <LogOut className="h-5 w-5" />
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-right glass-card px-4 py-2">
                  <p className="text-xs text-white/60 font-medium">Demo Balance</p>
                  <p className="text-xl font-bold text-emerald-400 flex items-center justify-end">
                    <DollarSign className="h-4 w-4 mr-1" />
                    {getDisplayBalance()}
                  </p>
                  <p className="text-xs text-emerald-300 font-medium">Demo Mode</p>
                </div>
                
                <button 
                  onClick={handleSignInClick}
                  className="flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-xl hover:from-emerald-600 hover:to-green-700 transition-all duration-200 font-medium shadow-lg"
                >
                  <LogIn className="h-5 w-5" />
                  <span>Sign In</span>
                </button>
              </>
            )}
          </div>

          {/* Mobile Menu Button */}
          <div className="lg:hidden flex items-center space-x-2">
            <div className="text-right glass-card px-3 py-2">
              <p className="text-xs text-white/60 font-medium">Demo</p>
              <p className="text-sm font-bold text-emerald-400 flex items-center">
                <DollarSign className="h-3 w-3 mr-1" />
                10K
              </p>
            </div>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-3 text-white/60 hover:text-white glass-button transition-all duration-200"
            >
              {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu Dropdown */}
        {isMobileMenuOpen && (
          <div className="lg:hidden mt-4 pt-4 border-t border-white/10">
            {user ? (
              <>
                {/* Mobile User Info */}
                <div className="mb-4 p-3 glass-card">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 bg-emerald-500/20 rounded-xl">
                      <User className="h-5 w-5 text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-xs text-white/60 font-medium">Signed in as</p>
                      <p className="text-sm font-bold text-white truncate">
                        {user?.email}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {isAdmin && (
                    <button
                      onClick={() => {
                        navigate('/admin/dashboard');
                        setIsMobileMenuOpen(false);
                      }}
                      className="w-full flex items-center space-x-3 p-3 text-white/70 hover:text-emerald-400 glass-button transition-all duration-200"
                    >
                      <Shield className="h-5 w-5" />
                      <span>Admin Dashboard</span>
                    </button>
                  )}
                  <button
                    onClick={handleDisclaimerClick}
                    className="w-full flex items-center space-x-3 p-3 text-white/70 hover:text-amber-400 glass-button transition-all duration-200"
                  >
                    <ExternalLink className="h-5 w-5" />
                    <span>Risk Disclaimer</span>
                  </button>
                  <button
                    onClick={() => {
                      setIsSettingsOpen(true);
                      setIsMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center space-x-3 p-3 text-white/70 hover:text-white glass-button transition-all duration-200"
                  >
                    <Settings className="h-5 w-5" />
                    <span>Settings</span>
                  </button>
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center space-x-3 p-3 text-white/70 hover:text-red-400 glass-button transition-all duration-200"
                  >
                    <LogOut className="h-5 w-5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <button 
                  onClick={handleDisclaimerClick}
                  className="w-full flex items-center space-x-3 p-3 text-white/70 hover:text-amber-400 glass-button transition-all duration-200"
                >
                  <ExternalLink className="h-5 w-5" />
                  <span>Risk Disclaimer</span>
                </button>
                <button 
                  onClick={handleSignInClick}
                  className="w-full flex items-center space-x-3 p-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-xl hover:from-emerald-600 hover:to-green-700 transition-all duration-200 font-medium"
                >
                  <LogIn className="h-5 w-5" />
                  <span>Sign In</span>
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        chartPreferences={preferences}
        onChartPreferencesUpdate={updatePreferences}
      />
      
      <DisclaimerModal 
        isOpen={isDisclaimerOpen} 
        onClose={() => setIsDisclaimerOpen(false)} 
      />
    </>
  );
};