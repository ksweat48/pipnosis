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
    "Make me $500 this week using medium risk",
    "Trade EURUSD with 3% target per trade",
    "Find the best scalping opportunity right now",
    "Execute low-risk swing trades on major pairs",
    "Help me grow my account by 10% this month",
    "What's the safest trade I can make today?"
  ];

  return (
    <div className="bg-slate-800 rounded-xl p-4 sm:p-6 border border-slate-700">
      <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:space-y-0 sm:space-x-2 mb-4">
        <div className="flex items-center space-x-2">
          <Zap className="h-5 w-5 text-yellow-400" />
          <h2 className="text-lg font-semibold text-white">AI Prompt Console</h2>
        </div>
        <div className="flex items-center space-x-2 text-xs">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
          <span className="text-green-400">GPT-4 Connected</span>
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
            placeholder="Enter your trading command... e.g., 'Make me $300 this week with low risk'"
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-3 sm:px-4 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none h-20 sm:h-24 text-sm sm:text-base"
            disabled={isLoading}
          />
          <div className="absolute bottom-2 right-2 sm:bottom-3 sm:right-3 flex space-x-2">
            <button
              type="button"
              className="p-1.5 sm:p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              disabled={isLoading}
              title="Voice input (coming soon)"
            >
              <Mic className="h-3 w-3 sm:h-4 sm:w-4" />
            </button>
            <button
              type="submit"
              disabled={isLoading || !prompt.trim()}
              className="p-1.5 sm:p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? (
                <div className="h-3 w-3 sm:h-4 sm:w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send className="h-3 w-3 sm:h-4 sm:w-4" />
              )}
            </button>
          </div>
        </div>
      </form>

      <div className="mt-4">
        <p className="text-sm text-slate-400 mb-2">Quick Prompts:</p>
        <div className="flex flex-wrap gap-2">
          {suggestedPrompts.map((suggestion, index) => (
            <button
              key={index}
              onClick={() => setPrompt(suggestion)}
              className="text-xs bg-slate-700 text-slate-300 px-2 py-1 sm:px-3 rounded-full hover:bg-slate-600 transition-colors"
              disabled={isLoading}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
        <div className="flex items-start space-x-2">
          <Zap className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
          <p className="text-blue-300 text-sm">
            Advanced AI analyzes your goals, market conditions, and risk profile to generate executable trading strategies.
          </p>
        </div>
      </div>
    </div>
  );
};