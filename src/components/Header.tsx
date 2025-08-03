import React, { useState, useEffect } from 'react';
import { Settings, Menu, X, ExternalLink, User, LogIn, DollarSign } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { SettingsModal } from './SettingsModal';
import { DisclaimerModal } from './DisclaimerModal';

interface HeaderProps {
  onOpenAuth: () => void;
  onOpenProfile: () => void;
  user: any;
  profile: any;
}

export const Header: React.FC<HeaderProps> = ({ 
  onOpenAuth, 
  onOpenProfile, 
  user, 
  profile 
}) => {
  const { signOut } = useAuth();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);


  const handleDisclaimerClick = () => {
    setIsDisclaimerOpen(true);
    setIsUserMenuOpen(false);
    setIsMobileMenuOpen(false);
  };

  const handleSignOut = async () => {
    await signOut();
    setIsUserMenuOpen(false);
  };

  const getDisplayBalance = () => {
    return `$${(profile?.account_balance || 10000).toLocaleString()}`;
  };

  return (
    <>
      <header className="bg-slate-900/95 backdrop-blur-md border-b border-slate-700/50 px-4 sm:px-6 py-4 sm:py-5 sticky top-0 z-40">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl overflow-hidden flex-shrink-0 ring-2 ring-blue-500/20">
              <img 
                src="/Pipnosis icon.png" 
                alt="Pipnosis AI Trading Logo" 
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-emerald-400 to-green-500 bg-clip-text text-transparent truncate">Pipnosis</h1>
              <p className="text-xs sm:text-sm text-slate-400 truncate">AI Trading Assistant</p>
            </div>
          </div>
          
          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-4">
            <div className="text-right bg-slate-800/50 rounded-lg px-4 py-2 border border-slate-600">
              <p className="text-sm text-slate-400">
                {user ? 'Demo Balance' : 'Account Balance'}
              </p>
              <p className="text-xl font-bold text-green-400 flex items-center">
                <DollarSign className="h-4 w-4 mr-1" />
                {getDisplayBalance()}
              </p>
              {user && (
                <p className="text-xs text-blue-400">Demo Account</p>
              )}
            </div>
            
            <div className="flex items-center space-x-2">
              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="p-3 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
              >
                <Settings className="h-5 w-5" />
              </button>
              
              {/* User Authentication Button */}
              {user ? (
                <div className="relative">
                  <button 
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className="flex items-center space-x-2 px-4 py-3 bg-gradient-to-r from-emerald-500/20 to-green-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl hover:from-emerald-500/30 hover:to-green-500/30 transition-all"
                    title="User Menu"
                  >
                    <User className="h-4 w-4" />
                    <span className="hidden lg:inline">
                      {profile?.full_name || user.email?.split('@')[0] || 'Profile'}
                    </span>
                  </button>
                  
                  {isUserMenuOpen && (
                    <div className="absolute right-0 mt-2 w-56 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 backdrop-blur-sm">
                      <div className="py-1">
                        <button
                          onClick={() => {
                            onOpenProfile();
                            setIsUserMenuOpen(false);
                          }}
                          className="w-full flex items-center space-x-3 px-4 py-3 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                        >
                          <User className="h-4 w-4" />
                          <span>Profile</span>
                        </button>
                        <button
                          onClick={handleDisclaimerClick}
                          className="w-full flex items-center space-x-3 px-4 py-3 text-slate-300 hover:text-amber-400 hover:bg-slate-700 transition-colors"
                        >
                          <ExternalLink className="h-4 w-4" />
                          <span>Disclaimer</span>
                        </button>
                        <div className="border-t border-slate-700 my-1"></div>
                        <button
                          onClick={handleSignOut}
                          className="w-full flex items-center space-x-3 px-4 py-3 text-red-300 hover:text-red-400 hover:bg-slate-700 transition-colors"
                        >
                          <ExternalLink className="h-4 w-4" />
                          <span>Sign Out</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <button 
                  onClick={onOpenAuth}
                  className="flex items-center space-x-2 px-4 py-3 bg-gradient-to-r from-emerald-500/20 to-green-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl hover:from-emerald-500/30 hover:to-green-500/30 transition-all"
                  title="Sign In"
                >
                  <LogIn className="h-4 w-4" />
                  <span className="hidden lg:inline">Sign In</span>
                </button>
              )}
            </div>
          </div>

          {/* Mobile Menu Button */}
          <div className="md:hidden flex items-center space-x-2">
            <div className="text-right mr-2 bg-slate-800/50 rounded-lg px-3 py-1">
              <p className="text-xs text-slate-400">
                {user ? 'Demo' : 'Balance'}
              </p>
              <p className="text-sm font-bold text-green-400">{getDisplayBalance()}</p>
            </div>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-3 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
            >
              {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu Dropdown */}
        {isMobileMenuOpen && (
          <div className="md:hidden mt-4 pt-4 border-t border-slate-700/50">
            <div className="space-y-2">
              {/* Mobile User Auth Button */}
              {user ? (
                <>
                  <button 
                    onClick={() => {
                      onOpenProfile();
                      setIsMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center space-x-3 p-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
                  >
                    <User className="h-5 w-5" />
                    <span>Profile</span>
                  </button>
                  <button 
                    onClick={() => {
                      handleSignOut();
                      setIsMobileMenuOpen(false);
                    }}
                    className="w-full flex items-center space-x-3 p-3 text-red-300 hover:text-red-400 hover:bg-slate-800 rounded-xl transition-colors"
                  >
                    <ExternalLink className="h-5 w-5" />
                    <span>Sign Out</span>
                  </button>
                </>
              ) : (
                <button 
                  onClick={() => {
                    onOpenAuth();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full flex items-center space-x-3 p-3 bg-gradient-to-r from-emerald-500/20 to-green-500/20 text-emerald-400 hover:from-emerald-500/30 hover:to-green-500/30 rounded-xl transition-all"
                >
                  <LogIn className="h-5 w-5" />
                  <span>Sign In</span>
                </button>
              )}
              
              <button 
                onClick={handleDisclaimerClick}
                className="w-full flex items-center space-x-3 p-3 text-slate-300 hover:text-amber-400 hover:bg-slate-800 rounded-xl transition-colors"
              >
                <ExternalLink className="h-5 w-5" />
                <span>Risk Disclaimer</span>
              </button>
              <button 
                onClick={() => {
                  setIsSettingsOpen(true);
                  setIsMobileMenuOpen(false);
                }}
                className="w-full flex items-center space-x-3 p-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
              >
                <Settings className="h-5 w-5" />
                <span>Settings</span>
              </button>
            </div>
          </div>
        )}

        {/* Click outside to close user menu */}
        {isUserMenuOpen && (
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsUserMenuOpen(false)}
          ></div>
        )}
      </header>

      <SettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
      />
      
      <DisclaimerModal 
        isOpen={isDisclaimerOpen} 
        onClose={() => setIsDisclaimerOpen(false)} 
      />
    </>
  );
};