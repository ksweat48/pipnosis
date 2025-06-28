import React, { useState, useEffect } from 'react';
import { Settings, User, Menu, X, ExternalLink, LogIn, LogOut, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SettingsModal } from './SettingsModal';
import { AuthModal } from './auth/AuthModal';
import { BackendStatus } from './BackendStatus';
import { DatabaseStatus } from './DatabaseStatus';
import { MT5ConnectionModal } from './MT5ConnectionModal';
import { useAuth } from '../contexts/AuthContext';

export const Header: React.FC = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isMT5ModalOpen, setIsMT5ModalOpen] = useState(false);
  const navigate = useNavigate();
  const { user, profile, signOut, loading, databaseConnected } = useAuth();

  // CRITICAL FIX: Check MT5 connection status from localStorage and auto-connect
  const [mt5Connected, setMt5Connected] = useState(false);
  const [mt5AccountData, setMt5AccountData] = useState<any>(null);

  // Monitor MT5 connection status
  useEffect(() => {
    const checkMT5Status = () => {
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

    window.addEventListener('storage', handleStorageChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const handleWaitlistClick = () => {
    navigate('/waitlist');
    setIsUserMenuOpen(false);
    setIsMobileMenuOpen(false);
  };

  const handleAuthClick = (mode: 'signin' | 'signup') => {
    setAuthMode(mode);
    setIsAuthModalOpen(true);
    setIsUserMenuOpen(false);
    setIsMobileMenuOpen(false);
  };

  const handleSignOut = async () => {
    if (isSigningOut) return;
    
    setIsSigningOut(true);
    setIsUserMenuOpen(false);
    setIsMobileMenuOpen(false);
    
    try {
      console.log('🚪 Header: Initiating sign out...');
      const result = await signOut();
      
      if (result.error) {
        console.error('❌ Sign out error:', result.error);
      } else {
        console.log('✅ Sign out successful');
      }
    } catch (error) {
      console.error('❌ Sign out failed:', error);
    } finally {
      setIsSigningOut(false);
    }
  };

  const getDisplayBalance = () => {
    if (!user || !profile) return '$0.00';
    
    // CRITICAL FIX: Use MT5 account balance if connected, otherwise use profile balance
    if (mt5Connected && mt5AccountData) {
      return `$${mt5AccountData.balance?.toLocaleString() || '0.00'}`;
    }
    
    return `$${profile.account_balance?.toLocaleString() || '0.00'}`;
  };

  // Check if we're in production
  const isProduction = window.location.hostname === 'pipnosis.com' || 
                      window.location.hostname === 'www.pipnosis.com' ||
                      window.location.hostname.includes('netlify.app');

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
            {/* Status Indicators */}
            <div className="flex items-center space-x-3">
              <BackendStatus />
              <DatabaseStatus />
            </div>
            
            {user && (
              <div className="text-right">
                <p className="text-sm text-slate-400">
                  {mt5Connected ? 'MT5 Balance' : 'Account Balance'}
                </p>
                <p className="text-lg font-semibold text-green-400">{getDisplayBalance()}</p>
                {mt5Connected && (
                  <p className="text-xs text-green-400">Live MT5 Data</p>
                )}
              </div>
            )}
            
            <div className="flex items-center space-x-2">
              {/* CRITICAL FIX: MT5 Connect Button with proper status colors */}
              {user && (
                <button 
                  onClick={() => setIsMT5ModalOpen(true)}
                  className={`flex items-center space-x-2 px-3 py-2 border rounded-lg transition-colors text-sm ${
                    mt5Connected 
                      ? 'bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30' 
                      : 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30'
                  }`}
                  title={mt5Connected ? 'MT5 Connected - Click to manage' : 'Connect to MetaTrader 5'}
                >
                  <Zap className="h-4 w-4" />
                  <span className="hidden lg:inline">
                    {mt5Connected ? 'MT5 ✓' : 'MT5'}
                  </span>
                </button>
              )}
              
              {user && (
                <button 
                  onClick={() => setIsSettingsOpen(true)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <Settings className="h-5 w-5" />
                </button>
              )}
              
              <div className="relative">
                <button 
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                  disabled={loading}
                >
                  <User className="h-5 w-5" />
                </button>
                
                {isUserMenuOpen && (
                  <div className="absolute right-0 mt-2 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-50">
                    <div className="py-1">
                      {user ? (
                        <>
                          <div className="px-4 py-3 border-b border-slate-700">
                            <p className="text-white font-medium">{profile?.full_name || 'User'}</p>
                            <p className="text-slate-400 text-sm">{user.email}</p>
                            <div className="flex items-center space-x-2 mt-2">
                              <div className={`w-2 h-2 rounded-full ${databaseConnected ? 'bg-green-400' : 'bg-orange-400'}`}></div>
                              <span className="text-xs text-slate-500">
                                {databaseConnected ? 'Data synced' : 'Offline mode'}
                              </span>
                            </div>
                            {/* CRITICAL FIX: Show MT5 connection status in user menu */}
                            <div className="flex items-center space-x-2 mt-1">
                              <div className={`w-2 h-2 rounded-full ${mt5Connected ? 'bg-green-400' : 'bg-red-400'}`}></div>
                              <span className="text-xs text-slate-500">
                                {mt5Connected ? 'MT5 Connected' : 'MT5 Disconnected'}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={handleWaitlistClick}
                            className="w-full flex items-center space-x-3 px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                          >
                            <ExternalLink className="h-4 w-4" />
                            <span>Waitlist Page</span>
                          </button>
                          <div className="border-t border-slate-700 my-1"></div>
                          <button
                            onClick={handleSignOut}
                            disabled={isSigningOut}
                            className="w-full flex items-center space-x-3 px-4 py-2 text-red-400 hover:text-red-300 hover:bg-slate-700 transition-colors disabled:opacity-50"
                          >
                            {isSigningOut ? (
                              <>
                                <div className="h-4 w-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                                <span>Signing Out...</span>
                              </>
                            ) : (
                              <>
                                <LogOut className="h-4 w-4" />
                                <span>Sign Out</span>
                              </>
                            )}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleAuthClick('signin')}
                            className="w-full flex items-center space-x-3 px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                          >
                            <LogIn className="h-4 w-4" />
                            <span>Sign In</span>
                          </button>
                          <button
                            onClick={() => handleAuthClick('signup')}
                            className="w-full flex items-center space-x-3 px-4 py-2 text-blue-400 hover:text-blue-300 hover:bg-slate-700 transition-colors"
                          >
                            <User className="h-4 w-4" />
                            <span>Create Account</span>
                          </button>
                          <button
                            onClick={handleWaitlistClick}
                            className="w-full flex items-center space-x-3 px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                          >
                            <ExternalLink className="h-4 w-4" />
                            <span>Waitlist Page</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Mobile Menu Button */}
          <div className="md:hidden flex items-center space-x-2">
            <div className="flex items-center space-x-2">
              <BackendStatus />
              <DatabaseStatus />
            </div>
            {user && (
              <div className="text-right mr-2">
                <p className="text-xs text-slate-400">
                  {mt5Connected ? 'MT5' : 'Balance'}
                </p>
                <p className="text-sm font-semibold text-green-400">{getDisplayBalance()}</p>
              </div>
            )}
            {/* CRITICAL FIX: Mobile MT5 Button with proper status colors */}
            {user && (
              <button 
                onClick={() => setIsMT5ModalOpen(true)}
                className={`p-2 border rounded-lg transition-colors ${
                  mt5Connected 
                    ? 'bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30' 
                    : 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30'
                }`}
                title={mt5Connected ? 'MT5 Connected - Click to manage' : 'Connect to MetaTrader 5'}
              >
                <Zap className="h-4 w-4" />
              </button>
            )}
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
              {user ? (
                <>
                  <div className="p-3 bg-slate-800 rounded-lg">
                    <p className="text-white font-medium">{profile?.full_name || 'User'}</p>
                    <p className="text-slate-400 text-sm">{user.email}</p>
                    <div className="flex items-center space-x-2 mt-2">
                      <div className={`w-2 h-2 rounded-full ${databaseConnected ? 'bg-green-400' : 'bg-orange-400'}`}></div>
                      <span className="text-xs text-slate-500">
                        {databaseConnected ? 'Data synced' : 'Offline mode'}
                      </span>
                    </div>
                    {/* CRITICAL FIX: Show MT5 status in mobile menu */}
                    <div className="flex items-center space-x-2 mt-1">
                      <div className={`w-2 h-2 rounded-full ${mt5Connected ? 'bg-green-400' : 'bg-red-400'}`}></div>
                      <span className="text-xs text-slate-500">
                        {mt5Connected ? 'MT5 Connected' : 'MT5 Disconnected'}
                      </span>
                    </div>
                  </div>
                  
                  {/* CRITICAL FIX: Mobile MT5 Connect Button with proper status */}
                  <button 
                    onClick={() => {
                      setIsMT5ModalOpen(true);
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
                  
                  <button 
                    onClick={handleWaitlistClick}
                    className="w-full flex items-center space-x-3 p-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    <ExternalLink className="h-5 w-5" />
                    <span>Waitlist Page</span>
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
                  <button 
                    onClick={handleSignOut}
                    disabled={isSigningOut}
                    className="w-full flex items-center space-x-3 p-3 text-red-400 hover:text-red-300 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isSigningOut ? (
                      <>
                        <div className="h-5 w-5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                        <span>Signing Out...</span>
                      </>
                    ) : (
                      <>
                        <LogOut className="h-5 w-5" />
                        <span>Sign Out</span>
                      </>
                    )}
                  </button>
                </>
              ) : (
                <>
                  <button 
                    onClick={() => handleAuthClick('signin')}
                    className="w-full flex items-center space-x-3 p-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    <LogIn className="h-5 w-5" />
                    <span>Sign In</span>
                  </button>
                  <button 
                    onClick={() => handleAuthClick('signup')}
                    className="w-full flex items-center space-x-3 p-3 text-blue-400 hover:text-blue-300 hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    <User className="h-5 w-5" />
                    <span>Create Account</span>
                  </button>
                  <button 
                    onClick={handleWaitlistClick}
                    className="w-full flex items-center space-x-3 p-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                  >
                    <ExternalLink className="h-5 w-5" />
                    <span>Waitlist Page</span>
                  </button>
                </>
              )}
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

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        initialMode={authMode}
      />

      {/* MT5 Connection Modal */}
      <MT5ConnectionModal
        isOpen={isMT5ModalOpen}
        onClose={() => setIsMT5ModalOpen(false)}
      />
    </>
  );
};