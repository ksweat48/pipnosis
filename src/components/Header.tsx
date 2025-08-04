import React, { useState } from 'react';
import { Settings, Menu, X, ExternalLink, DollarSign } from 'lucide-react';
import { SettingsModal } from './SettingsModal';
import { DisclaimerModal } from './DisclaimerModal';

export const Header: React.FC = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDisclaimerOpen, setIsDisclaimerOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleDisclaimerClick = () => {
    setIsDisclaimerOpen(true);
    setIsMobileMenuOpen(false);
  };

  const getDisplayBalance = () => {
    return `$10,000`; // Static demo balance
  };

  return (
    <>
      <header className="bg-black/20 backdrop-blur-2xl border-b border-white/10 px-4 sm:px-6 py-6 sticky top-0 z-40">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 flex-1">
            <div className="w-12 h-12 rounded-2xl overflow-hidden flex-shrink-0 ring-2 ring-emerald-500/30">
              <img 
                src="/Pipnosis icon.png" 
                alt="Pipnosis AI Trading Logo" 
                className="w-full h-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-green-500 bg-clip-text text-transparent truncate">Pipnosis</h1>
              <p className="text-sm text-white/60 truncate font-medium">AI Trading Assistant</p>
            </div>
          </div>
          
          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-4">
            <div className="text-right glass-card px-6 py-3">
              <p className="text-sm text-white/60 font-medium">Demo Balance</p>
              <p className="text-2xl font-bold text-emerald-400 flex items-center justify-end">
                <DollarSign className="h-4 w-4 mr-1" />
                {getDisplayBalance()}
              </p>
              <p className="text-xs text-emerald-300 font-medium">Demo Account</p>
            </div>
            
            <div className="flex items-center space-x-2">
              <button 
                onClick={() => setIsSettingsOpen(true)}
                className="p-3 text-white/60 hover:text-white glass-button transition-all duration-200"
              >
                <Settings className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Mobile Menu Button */}
          <div className="md:hidden flex items-center space-x-2">
            <div className="text-right mr-2 glass-card px-4 py-2">
              <p className="text-xs text-white/60 font-medium">Demo</p>
              <p className="text-sm font-bold text-emerald-400">{getDisplayBalance()}</p>
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
          <div className="md:hidden mt-6 pt-6 border-t border-white/10">
            <div className="space-y-2">
              <button 
                onClick={handleDisclaimerClick}
                className="w-full flex items-center space-x-3 p-4 text-white/70 hover:text-amber-400 glass-button transition-all duration-200"
              >
                <ExternalLink className="h-5 w-5" />
                <span>Risk Disclaimer</span>
              </button>
              <button 
                onClick={() => {
                  setIsSettingsOpen(true);
                  setIsMobileMenuOpen(false);
                }}
                className="w-full flex items-center space-x-3 p-4 text-white/70 hover:text-white glass-button transition-all duration-200"
              >
                <Settings className="h-5 w-5" />
                <span>Settings</span>
              </button>
            </div>
          </div>
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