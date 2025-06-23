import React, { useState } from 'react';
import { Shield, Scale, Target, AlertTriangle, Brain, TrendingUp, Clock, Zap, Activity, CheckCircle, ChevronDown, ChevronUp, Gavel } from 'lucide-react';

interface TradingLaw {
  id: number;
  title: string;
  description: string;
  icon: React.ComponentType<any>;
  category: 'capital' | 'performance' | 'risk' | 'execution' | 'discipline';
}

export const TradingLaws: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);

  const laws: TradingLaw[] = [
    {
      id: 1,
      title: "Capital Preservation Above All",
      description: "Pipnosis must never risk the entire account balance on any single trade or series of trades. Capital protection is the foundation of long-term success.",
      icon: Shield,
      category: 'capital'
    },
    {
      id: 2,
      title: "Target 70–80% Win Rate Over Time",
      description: "Trades should be selected and filtered to statistically strive for a 70%–80% win rate over time, regardless of daily, weekly, or prompt-specific goals.",
      icon: Target,
      category: 'performance'
    },
    {
      id: 3,
      title: "Manage Drawdown Relentlessly",
      description: "The system must limit cumulative drawdown. If drawdown exceeds safe thresholds (e.g. 10–20% based on risk mode), halt trading and protect capital.",
      icon: TrendingUp,
      category: 'risk'
    },
    {
      id: 4,
      title: "Never Chase Unrealistic Goals",
      description: "If a user prompt (e.g., \"Make $10,000 from $100\") is not feasible within defined risk tolerance, Pipnosis must scale down the goal, explain why, and preserve the user's funds.",
      icon: AlertTriangle,
      category: 'discipline'
    },
    {
      id: 5,
      title: "AI Is the Final Decision-Maker",
      description: "Even when high risk is selected, Pipnosis retains ultimate judgment to override a risky trade if the setup is not optimal. The user guides the intent; Pipnosis controls the method.",
      icon: Brain,
      category: 'execution'
    },
    {
      id: 6,
      title: "Trades Must Have High Quality Entry Conditions",
      description: "Each trade must meet multiple technical confirmations (e.g., price action, trend alignment, volume, S/R) regardless of urgency. Pipnosis must wait for optimal setups.",
      icon: CheckCircle,
      category: 'execution'
    },
    {
      id: 7,
      title: "Cut Losses Early, Let Winners Run",
      description: "Where possible, Pipnosis must favor intelligent trailing stops, time-based exits, and avoid hitting full SL. Always act in favor of net account health.",
      icon: Activity,
      category: 'risk'
    },
    {
      id: 8,
      title: "No Trading During High-Risk Events (unless user overrides)",
      description: "Pipnosis must avoid entering trades before or during major economic news unless the strategy can adapt for volatility and the user explicitly enables this mode.",
      icon: Clock,
      category: 'risk'
    },
    {
      id: 9,
      title: "Do Not Overtrade",
      description: "Even if multiple trade opportunities exist, Pipnosis must obey trade frequency limits based on account size and user risk tier (e.g., 1–5 open trades max).",
      icon: Zap,
      category: 'discipline'
    },
    {
      id: 10,
      title: "Prioritize Consistency Over Speed",
      description: "If fulfilling a prompt would violate risk control rules, Pipnosis should fulfill part of the prompt (e.g., 50–70% of profit goal) rather than overextend and risk a loss.",
      icon: Scale,
      category: 'discipline'
    }
  ];

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'capital': return 'border-l-green-500 bg-green-500/5';
      case 'performance': return 'border-l-blue-500 bg-blue-500/5';
      case 'risk': return 'border-l-yellow-500 bg-yellow-500/5';
      case 'execution': return 'border-l-purple-500 bg-purple-500/5';
      case 'discipline': return 'border-l-red-500 bg-red-500/5';
      default: return 'border-l-slate-500 bg-slate-500/5';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'capital': return 'text-green-400';
      case 'performance': return 'text-blue-400';
      case 'risk': return 'text-yellow-400';
      case 'execution': return 'text-purple-400';
      case 'discipline': return 'text-red-400';
      default: return 'text-slate-400';
    }
  };

  const visibleLaws = isExpanded ? laws : laws.slice(0, 5);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700">
      <div className="p-4 sm:p-6 border-b border-slate-700">
        <div className="flex flex-col space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
            <Gavel className="h-5 w-5 text-amber-400 flex-shrink-0" />
            <span>📜 Pipnosis Immutable Laws of Trading</span>
          </h3>
          <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:space-y-0 sm:space-x-4">
            <div className="text-sm text-amber-400 font-medium">
              AI Laws of Risk & Success
            </div>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center justify-center space-x-1 text-blue-400 hover:text-blue-300 transition-colors text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded-lg"
            >
              <span>{isExpanded ? 'Show Less' : 'Show All Laws'}</span>
              {isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        <div className="space-y-3 sm:space-y-4">
          {visibleLaws.map((law) => {
            const IconComponent = law.icon;
            return (
              <div
                key={law.id}
                className={`border-l-4 rounded-lg p-4 transition-all hover:shadow-lg ${getCategoryColor(law.category)}`}
              >
                <div className="flex items-start space-x-3">
                  <div className={`p-2 rounded-lg bg-slate-900 flex-shrink-0 ${getCategoryIcon(law.category)}`}>
                    <IconComponent className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="text-white font-semibold text-sm sm:text-base">
                        {law.id}. {law.title}
                      </h4>
                      <span className={`px-2 py-1 rounded text-xs font-medium capitalize flex-shrink-0 ml-2 ${
                        law.category === 'capital' ? 'bg-green-500/20 text-green-400' :
                        law.category === 'performance' ? 'bg-blue-500/20 text-blue-400' :
                        law.category === 'risk' ? 'bg-yellow-500/20 text-yellow-400' :
                        law.category === 'execution' ? 'bg-purple-500/20 text-purple-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {law.category}
                      </span>
                    </div>
                    <p className="text-slate-300 text-sm leading-relaxed">
                      {law.description}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Trade Morality Clause */}
        <div className="mt-6 p-4 bg-gradient-to-r from-amber-500/10 to-orange-500/10 border-2 border-amber-500/30 rounded-lg">
          <div className="flex items-start space-x-3">
            <div className="p-2 bg-amber-500/20 rounded-lg flex-shrink-0">
              <Scale className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <h4 className="text-amber-300 font-semibold mb-2">Trade Morality Clause</h4>
              <p className="text-amber-200 text-sm leading-relaxed">
                Pipnosis must never engage in unauthorized trading, never use deceptive logic to meet prompts, 
                and always provide reasoning and transparency in its decisions even if the user doesn't ask.
              </p>
            </div>
          </div>
        </div>

        {/* AI Integration Notice */}
        <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <div className="flex items-start space-x-3">
            <Brain className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-blue-300 text-sm">
                <strong>These laws are hard-coded into Pipnosis AI's decision-making engine.</strong> Every trade analysis, 
                strategy generation, and execution follows these immutable principles to ensure consistent, 
                responsible, and profitable trading behavior.
              </p>
            </div>
          </div>
        </div>

        {/* Category Legend */}
        <div className="mt-4 flex flex-wrap gap-2 justify-center">
          {[
            { category: 'capital', label: 'Capital Protection', color: 'bg-green-500/20 text-green-400' },
            { category: 'performance', label: 'Performance', color: 'bg-blue-500/20 text-blue-400' },
            { category: 'risk', label: 'Risk Management', color: 'bg-yellow-500/20 text-yellow-400' },
            { category: 'execution', label: 'Execution', color: 'bg-purple-500/20 text-purple-400' },
            { category: 'discipline', label: 'Discipline', color: 'bg-red-500/20 text-red-400' }
          ].map((item) => (
            <span key={item.category} className={`px-2 py-1 rounded text-xs font-medium ${item.color}`}>
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};