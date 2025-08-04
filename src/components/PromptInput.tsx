import React, { useState } from 'react';
import { Send, Mic, Zap, AlertCircle } from 'lucide-react';

interface PromptInputProps {
  onSubmit: (prompt: string) => void;
  isLoading: boolean;
  error?: string | null;
}

export const PromptInput: React.FC<PromptInputProps> = ({ onSubmit, isLoading, error }) => {
  const [prompt, setPrompt] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim() && !isLoading) {
      onSubmit(prompt.trim());
      setPrompt('');
    }
  };

  const suggestedPrompts = [
    "Make me $100 today",
    "Earn $200 this week with low risk", 
    "Find the best EURUSD opportunity",
    "Generate a safe XAUUSD trade",
    "Make 2% profit on GBPUSD",
    "What's the safest trade right now?"
  ];

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-start space-x-3">
          <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-red-400 text-sm font-medium">AI Analysis Error</p>
            <p className="text-red-300 text-xs mt-1">{error}</p>
          </div>
        </div>
      )}
      
      <div className="text-center mb-8">
        <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-3">What's your trading goal?</h2>
        <p className="text-white/70 text-base sm:text-lg font-medium px-4">Tell me what you want to achieve and I'll create the perfect strategy</p>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g., 'Make me $500 this week' or 'Find a safe EURUSD trade'"
            className="w-full bg-white/5 backdrop-blur-xl border border-white/20 rounded-2xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500/50 resize-none h-24 sm:h-32 text-base sm:text-lg lg:text-xl font-medium transition-all duration-200"
            disabled={isLoading}
          />
          <div className="absolute bottom-3 right-3 sm:bottom-4 sm:right-4">
            <button
              type="submit"
              disabled={isLoading || !prompt.trim()}
              className="p-3 sm:p-4 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-2xl hover:from-emerald-600 hover:to-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-xl hover:shadow-2xl hover:scale-105"
            >
              {isLoading ? (
                <div className="h-5 w-5 sm:h-6 sm:w-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send className="h-5 w-5 sm:h-6 sm:w-6" />
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Suggested Prompts */}
      <div className="space-y-4">
        <h3 className="text-base sm:text-lg font-semibold text-white/80 text-center">Or try these examples:</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {suggestedPrompts.map((suggestion, index) => (
            <button
              key={index}
              onClick={() => setPrompt(suggestion)}
              disabled={isLoading}
              className="p-3 sm:p-4 glass-card text-white/70 hover:text-white hover:bg-white/10 transition-all duration-200 text-xs sm:text-sm font-medium rounded-xl disabled:opacity-50"
            >
              "{suggestion}"
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 sm:p-6 bg-gradient-to-r from-emerald-500/10 to-green-500/10 border border-emerald-500/20 rounded-2xl">
        <div className="flex items-start space-x-3">
          <Zap className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm sm:text-base text-emerald-300 font-semibold">Powered by GPT-4 • Following 10 Immutable Laws</p>
            <p className="text-emerald-200/80 text-xs sm:text-sm mt-1 font-medium">
              AI analyzes your goals, market conditions, and risk profile to generate optimal trading strategies.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};