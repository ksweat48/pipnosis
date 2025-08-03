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
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 max-w-2xl mx-auto">
      
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
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-4 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none h-16 text-lg"
            disabled={isLoading}
          />
          <div className="absolute bottom-3 right-3 flex space-x-2">
            <button
              type="submit"
              disabled={isLoading || !prompt.trim()}
              className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? (
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </form>

      <div className="mt-4">
        <p className="text-sm text-slate-400 mb-3 text-center">Quick Examples:</p>
        <div className="flex flex-wrap gap-2">
          {suggestedPrompts.map((suggestion, index) => (
            <button
              key={index}
              onClick={() => setPrompt(suggestion)}
              className="text-xs bg-slate-700 text-slate-300 px-3 py-2 rounded-full hover:bg-slate-600 transition-colors"
              disabled={isLoading}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
        <div className="flex items-start space-x-2">
          <Zap className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-blue-300 text-sm font-medium text-center">Powered by GPT-4</p>
            <p className="text-blue-200 text-xs mt-1">
              AI analyzes your goals and market conditions to generate demo trading strategies.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};