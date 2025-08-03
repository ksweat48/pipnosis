import React, { useState } from 'react';
import { Shield, Scale, Target, AlertTriangle, Brain, TrendingUp, Clock, Zap, Activity, ChevronDown, ChevronUp, Gavel } from 'lucide-react';

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
      icon: Activity,
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
      title: "No Trading During High-Risk Events",
      description: "Pipnosis must avoid entering trades before or during major economic news unless the strategy can adapt for volatility and the user explicitly enables this mode.",
      icon: Clock,
      category: 'risk'
    },
    {
      id: 9,
      title: "Do Not Overtrade",
      description: "Maximum 2 trades per session. No overlapping trades on the same pair. Obey trade frequency limits to prevent overexposure and maintain disciplined trading.",
      icon: Zap,
      category: 'discipline'
    },
    {
      id: 10,
      title: "Prioritize Consistency Over Speed",
      description: "Follow 5-minute reassessment rules strictly. Use demo equity for all calculations. Always explain the reason behind each trade. Fulfill part of prompt rather than overextend and risk loss.",
      icon: Scale,
      category: 'discipline'
    }
  ];

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'capital': return 'border-l-green-500 bg-green-500/5';
      case 'performance': return 'border-l-emerald-500 bg-emerald-500/5';
      case 'risk': return 'border-l-yellow-500 bg-yellow-500/5';
      case 'execution': return 'border-l-purple-500 bg-purple-500/5';
      case 'discipline': return 'border-l-red-500 bg-red-500/5';
      default: return 'border-l-slate-500 bg-slate-500/5';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'capital': return 'text-green-400';
      case 'performance': return 'text-emerald-400';
      case 'risk': return 'text-yellow-400';
      case 'execution': return 'text-purple-400';
      case 'discipline': return 'text-red-400';
      default: return 'text-slate-400';
    }
  };

  // Show only the first law when collapsed, all laws when expanded
  const visibleLaws = isExpanded ? laws : laws.slice(0, 1);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700">
      <div className="p-4 sm:p-6 border-b border-slate-700 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex flex-col space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
            <Gavel className="h-5 w-5 text-amber-400 flex-shrink-0" />
            <span>📜 Pipnosis Immutable Laws of Trading</span>
          </h3>
          <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:space-y-0 sm:space-x-4">
            <div className="text-sm text-amber-400 font-medium">
              AI Laws of Risk & Success
            </div>
            <button className="p-2 text-slate-400 hover:text-white transition-colors">
              {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
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

        {/* Show summary when collapsed */}
        {!isExpanded && (
          <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <p className="text-amber-200 text-sm text-center">
              <strong>Law #1 is the foundation.</strong> Click to see the complete set of 10 immutable trading principles.
            </p>
          </div>
        )}

        {/* Category Legend - Only show when expanded */}
        {isExpanded && (
          <div className="mt-4 flex flex-wrap gap-2 justify-center">
            {[
              { category: 'capital', label: 'Capital Protection', color: 'bg-green-500/20 text-green-400' },
              { category: 'performance', label: 'Performance', color: 'bg-emerald-500/20 text-emerald-400' },
              { category: 'risk', label: 'Risk Management', color: 'bg-yellow-500/20 text-yellow-400' },
              { category: 'execution', label: 'Execution', color: 'bg-purple-500/20 text-purple-400' },
              { category: 'discipline', label: 'Discipline', color: 'bg-red-500/20 text-red-400' }
            ].map((item) => (
              <span key={item.category} className={`px-2 py-1 rounded text-xs font-medium ${item.color}`}>
                {item.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};