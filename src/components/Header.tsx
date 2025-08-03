import React, { useState, useEffect } from 'react';
import { Settings, Menu, X, ExternalLink, Zap, HelpCircle, User, LogIn } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { SettingsModal } from './SettingsModal';
import { MT5ConnectionStatus } from './MT5ConnectionStatus';
import { DisclaimerModal } from './DisclaimerModal';
import { WebContainerNotice } from './WebContainerNotice';
import { BackendStatus } from './BackendStatus';
import { MT5ConnectionModal } from './MT5ConnectionModal';

interface HeaderProps {
  onOpenMT5Modal: () => void;
  onOpenAuth: () => void;
  onOpenProfile: () => void;
  user: any;
  profile: any;
}

export const Header: React.FC<HeaderProps> = ({ 
  onOpenMT5Modal, 
  onOpenAuth, 
  onOpenProfile, 
  user, 
  profile 
}) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isMT5ModalOpen, setIsMT5ModalOpen] = useState(false);

  // CRITICAL FIX: Check MT5 connection status from localStorage and auto-connect
  const [mt5Connected, setMt5Connected] = useState(false);
  const [mt5AccountData, setMt5AccountData] = useState<any>(null);

  // Monitor MT5 connection status
  useEffect(() => {
    const checkMT5Status = () => {
      try {
        const connected = localStorage.getItem('pipnosis_mt5_connected') === 'true';
        const accountData = localStorage.getItem('pipnosis_mt5_account');
        
        setMt5Connected(connected);
        
        if (connected && accountData) {
          try {
            setMt5AccountData(JSON.parse(accountData));
          } catch (error) {
            console.error('Error parsing MT5 account data:', error);
            setMt5AccountData(null);
          }
        } else {
          setMt5AccountData(null);
        }
      } catch (error) {
        console.error('Error checking MT5 status:', error);
        setMt5Connected(false);
        setMt5AccountData(null);
      }
    };

    // Check immediately
    checkMT5Status();

    // Set up interval to check every 2 seconds
    const interval = setInterval(checkMT5Status, 2000);

    // Listen for storage changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'pipnosis_mt5_connected' || e.key === 'pipnosis_mt5_account') {
        checkMT5Status();
      }
    };

    // Listen for custom MT5 modal open event
    const handleOpenMT5Modal = () => {
      onOpenMT5Modal();
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('openMT5Modal', handleOpenMT5Modal);

    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('openMT5Modal', handleOpenMT5Modal);
    };
  }, []);

  const handleDisclaimerClick = () => {
    setIsDisclaimerOpen(true);
    setIsUserMenuOpen(false);
    setIsMobileMenuOpen(false);
  };

  // CRITICAL FIX: Safe number formatting function
  const safeToFixed = (value: any, digits: number = 2): string => {
    if (typeof value === "number" && !isNaN(value)) {
      return value.toFixed(digits);
    }
    return "0.00";
  };

  // CRITICAL FIX: Get display balance from MT5 if connected, otherwise use profile balance
  const getDisplayBalance = () => {
    // Use profile balance if user is logged in
    const profileBalance = profile?.account_balance || 10000;
    
    // Use MT5 account balance if connected
    if (mt5Connected && mt5AccountData) {
      if (typeof mt5AccountData.balance === 'number') {
        return `$${mt5AccountData.balance.toLocaleString()}`;
      }
    }
    
    return `$${profileBalance.toLocaleString()}`;
  };

  return (
    <>
      <header className="bg-slate-900 border-b border-slate-700 px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg overflow-hidden flex-shrink-0">
              <img 
                src="/Pipnosis icon.png" 
                alt="Pipnosis AI Trading Logo" 
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-white truncate">Pipnosis</h1>
              <p className="text-xs sm:text-sm text-slate-400 truncate">AI Forex Trading System</p>
            </div>
          </div>
          
          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-4">
            <div className="flex items-center space-x-3">
              <MT5ConnectionStatus />
              <BackendStatus />
            </div>
            
            <div className="text-right">
              <p className="text-sm text-slate-400">
                {mt5Connected ? 'MT5 Balance' : user ? 'Demo Balance' : 'Account Balance'}
              </p>
              <p className="text-lg font-semibold text-green-400">{getDisplayBalance()}</p>
              {mt5Connected && (
                <p className="text-xs text-green-400">Live MT5 Data</p>
              )}
              {user && !mt5Connected && (
                <p className="text-xs text-blue-400">Demo Account</p>
              )}
            </div>
            
            <div className="flex items-center space-x-2">
              {/* CRITICAL FIX: MT5 Connect Button with proper status colors */}
              <button 
                onClick={onOpenMT5Modal}
                className={`flex items-center space-x-2 px-3 py-2 border rounded-lg transition-colors text-sm ${
                  mt5Connected 
                    ? 'bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30' 
                    : 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30'
                }`}
                title={mt5Connected ? 'MT5 Connected - Click to manage' : 'Connect to MetaTrader 5'}
              >
                <Zap className="h-4 w-4" />
                <span className="hidden lg:inline whitespace-nowrap">
                  {mt5Connected ? 'MT5 ✓' : 'MT5'}
                </span>
              </button>
              
              {/* MT5 Setup Guide */}
              <a 
                href="/PRODUCTION_MT5_SETUP.md"
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                title="MT5 Setup Guide"
              >
                <HelpCircle className="h-5 w-5" />
              </a>
              
              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              >
                <Settings className="h-5 w-5" />
              </button>
              
              {/* User Authentication Button */}
              {user ? (
                <button 
                  onClick={onOpenProfile}
                  className="flex items-center space-x-2 px-3 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-500/30 transition-colors"
                  title="User Profile"
                >
                  <User className="h-4 w-4" />
                  <span className="hidden lg:inline">
                    {profile?.full_name || user.email?.split('@')[0] || 'Profile'}
                  </span>
                </button>
              ) : (
                <button 
                  onClick={onOpenAuth}
                  className="flex items-center space-x-2 px-3 py-2 bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/30 transition-colors"
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
            <div className="flex items-center space-x-2">
              <MT5ConnectionStatus />
              <BackendStatus />
            </div>
            <div className="text-right mr-2">
              <p className="text-xs text-slate-400">
                {mt5Connected ? 'MT5' : user ? 'Demo' : 'Balance'}
              </p>
              <p className="text-sm font-semibold text-green-400">{getDisplayBalance()}</p>
            </div>
            {/* CRITICAL FIX: Mobile MT5 Button with proper status colors */}
            <button 
              onClick={onOpenMT5Modal}
              className={`p-2 border rounded-lg transition-colors ${
                mt5Connected 
                  ? 'bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30' 
                  : 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30'
              }`}
              title={mt5Connected ? 'MT5 Connected - Click to manage' : 'Connect to MetaTrader 5'}
            >
              <Zap className="h-4 w-4" />
            </button>
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu Dropdown */}
        {isMobileMenuOpen && (
          <div className="md:hidden mt-4 pt-4 border-t border-slate-700">
            <div className="space-y-2">
              {/* CRITICAL FIX: Mobile MT5 Connect Button with proper status */}
              <button 
                onClick={() => {
                  onOpenMT5Modal();
                  setIsMobileMenuOpen(false);
                }}
                className={`w-full flex items-center space-x-3 p-3 border rounded-lg transition-colors ${
                  mt5Connected 
                    ? 'bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30' 
                    : 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30'
                }`}
              >
                <Zap className="h-5 w-5" />
                <span>{mt5Connected ? 'Manage MT5 Connection' : 'Connect MT5'}</span>
              </button>
              
              {/* Mobile User Auth Button */}
              {user ? (
                <button 
                  onClick={() => {
                    onOpenProfile();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full flex items-center space-x-3 p-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <User className="h-5 w-5" />
                  <span>Profile</span>
                </button>
              ) : (
                <button 
                  onClick={() => {
                    onOpenAuth();
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full flex items-center space-x-3 p-3 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-lg transition-colors"
                >
                  <LogIn className="h-5 w-5" />
                  <span>Sign In</span>
                </button>
              )}
              
              <WebContainerNotice />
              <button 
                onClick={handleDisclaimerClick}
                className="w-full flex items-center space-x-3 p-3 text-slate-300 hover:text-amber-400 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <ExternalLink className="h-5 w-5" />
                <span>Risk Disclaimer</span>
              </button>
              <button 
                onClick={() => {
                  setIsSettingsOpen(true);
                  setIsMobileMenuOpen(false);
                }}
                className="w-full flex items-center space-x-3 p-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
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