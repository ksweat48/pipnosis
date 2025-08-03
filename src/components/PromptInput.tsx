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
    <div className="bg-gradient-to-r from-slate-800 to-slate-700 rounded-2xl p-6 sm:p-8 border border-slate-600 shadow-2xl backdrop-blur-sm">
      <div className="flex items-center justify-center space-x-3 mb-6">
        <div className="p-2 bg-gradient-to-r from-emerald-500 to-green-600 rounded-lg">
          <Zap className="h-6 w-6 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">AI Prompt Console</h2>
          <p className="text-sm text-slate-400">Powered by GPT-4 • Connected</p>
        </div>
      </div>
      
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start space-x-2">
          <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-red-400 text-sm font-medium">AI Analysis Error</p>
            <p className="text-red-300 text-xs mt-1">{error}</p>
          </div>
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter your trading goal... e.g., 'Make me $100 today'"
            className="w-full bg-slate-900 border border-slate-600 rounded-xl px-6 py-4 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none h-20 text-lg font-medium"
            disabled={isLoading}
          />
          <div className="absolute bottom-3 right-3 flex space-x-2">
            <button
              type="submit"
              disabled={isLoading || !prompt.trim()}
              className="p-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-xl hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
            >
              {isLoading ? (
                <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </form>

      <div className="mt-6 p-4 bg-gradient-to-r from-emerald-500/10 to-green-500/10 border border-emerald-500/30 rounded-xl">
        <div className="flex items-start space-x-2">
          <Zap className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-emerald-300 text-sm font-medium">Powered by GPT-4 • Following 10 Immutable Laws</p>
            <p className="text-emerald-200 text-xs mt-1">
              AI analyzes your goals, market conditions, and risk profile to generate optimal demo trading strategies.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};