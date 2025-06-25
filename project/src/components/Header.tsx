import React, { useState } from 'react';
import { Settings, User, Plug, Menu, X, ExternalLink, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SettingsModal } from './SettingsModal';
import { MT5ConnectionModal } from './MT5ConnectionModal';
import { DisclaimerModal } from './DisclaimerModal';
import { BackendStatus } from './BackendStatus';

export const Header: React.FC = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMT5ModalOpen, setIsMT5ModalOpen] = useState(false);
  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const navigate = useNavigate();

  const handleWaitlistClick = () => {
    navigate('/waitlist');
    setIsUserMenuOpen(false);
    setIsMobileMenuOpen(false);
  };

  const handleDisclaimerClick = () => {
    setIsDisclaimerOpen(true);
    setIsUserMenuOpen(false);
    setIsMobileMenuOpen(false);
  };

  return (
    <>
      <header className="bg-slate-900 border-b border-slate-700 px-4 sm:px-6 py-3 sm:py-4">
        <div className="flex items-center justify-between">
          {/* Logo and Title */}
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
            <div className="text-right">
              <p className="text-sm text-slate-400">Account Balance</p>
              <p className="text-lg font-semibold text-green-400">$12,547.83</p>
            </div>
            
            <div className="flex items-center space-x-2">
              {/* Disclaimer Link */}
              <button 
                onClick={handleDisclaimerClick}
                className="p-2 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg transition-colors"
                title="View Disclaimer"
              >
                <AlertTriangle className="h-5 w-5" />
              </button>
              
              <button 
                onClick={() => setIsMT5ModalOpen(true)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                title="Connect MT5"
              >
                <Plug className="h-5 w-5" />
              </button>
              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              >
                <Settings className="h-5 w-5" />
              </button>
              
              {/* User Menu with Dropdown */}
              <div className="relative">
                <button 
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                >
                  <User className="h-5 w-5" />
                </button>
                
                {isUserMenuOpen && (
                  <div className="absolute right-0 mt-2 w-64 bg-slate-800 border border-slate-700 rounded-lg shadow-lg z-50">
                    <div className="py-1">
                      <button
                        onClick={handleWaitlistClick}
                        className="w-full flex items-center space-x-3 px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                      >
                        <ExternalLink className="h-4 w-4" />
                        <span>Waitlist Page</span>
                      </button>
                      <button
                        onClick={handleDisclaimerClick}
                        className="w-full flex items-center space-x-3 px-4 py-2 text-slate-300 hover:text-amber-400 hover:bg-slate-700 transition-colors"
                      >
                        <AlertTriangle className="h-4 w-4" />
                        <span>Disclaimer</span>
                      </button>
                      <div className="border-t border-slate-700 my-1"></div>
                      <button className="w-full flex items-center space-x-3 px-4 py-2 text-slate-300 hover:text-white hover:bg-slate-700 transition-colors">
                        <User className="h-4 w-4" />
                        <span>Profile</span>
                      </button>
                      <div className="border-t border-slate-700 my-1"></div>
                      {/* Backend Status in Profile Menu */}
                      <div className="px-4 py-2">
                        <BackendStatus showDetails={true} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Mobile Menu Button */}
          <div className="md:hidden flex items-center space-x-2">
            <div className="text-right mr-2">
              <p className="text-xs text-slate-400">Balance</p>
              <p className="text-sm font-semibold text-green-400">$12,547.83</p>
            </div>
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
              {/* Mobile Backend Status */}
              <div className="p-3 bg-slate-800 rounded-lg">
                <BackendStatus showDetails={true} />
              </div>
              
              <button 
                onClick={handleWaitlistClick}
                className="w-full flex items-center space-x-3 p-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              >
                <ExternalLink className="h-5 w-5" />
                <span>Waitlist Page</span>
              </button>
              <button 
                onClick={handleDisclaimerClick}
                className="w-full flex items-center space-x-3 p-3 text-slate-300 hover:text-amber-400 hover:bg-slate-800 rounded-lg transition-colors"
              >
                <AlertTriangle className="h-5 w-5" />
                <span>Disclaimer</span>
              </button>
              <button 
                onClick={() => {
                  setIsMT5ModalOpen(true);
                  setIsMobileMenuOpen(false);
                }}
                className="w-full flex items-center space-x-3 p-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              >
                <Plug className="h-5 w-5" />
                <span>Connect MT5</span>
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
              <button className="w-full flex items-center space-x-3 p-3 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
                <User className="h-5 w-5" />
                <span>Profile</span>
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

      <MT5ConnectionModal 
        isOpen={isMT5ModalOpen} 
        onClose={() => setIsMT5ModalOpen(false)} 
      />

      <DisclaimerModal 
        isOpen={isDisclaimerOpen} 
        onClose={() => setIsDisclaimerOpen(false)} 
      />
    </>
  );
};