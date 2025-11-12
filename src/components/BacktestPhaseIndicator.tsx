import React from 'react';
import { Download, Activity, TrendingUp, BarChart3, CheckCircle } from 'lucide-react';

interface BacktestPhaseIndicatorProps {
  currentPhase: string;
  progressPercentage: number;
}

interface Phase {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
}

export default function BacktestPhaseIndicator({ currentPhase, progressPercentage }: BacktestPhaseIndicatorProps) {
  const phases: Phase[] = [
    {
      id: 'initializing',
      name: 'Initialize',
      icon: <Download className="w-4 h-4" />,
      color: 'text-gray-400',
      bgColor: 'bg-gray-700'
    },
    {
      id: 'loading',
      name: 'Load Data',
      icon: <Download className="w-4 h-4" />,
      color: 'text-blue-400',
      bgColor: 'bg-blue-600'
    },
    {
      id: 'processing',
      name: 'Process',
      icon: <Activity className="w-4 h-4" />,
      color: 'text-green-400',
      bgColor: 'bg-green-600'
    },
    {
      id: 'analyzing',
      name: 'Analyze',
      icon: <TrendingUp className="w-4 h-4" />,
      color: 'text-purple-400',
      bgColor: 'bg-purple-600'
    },
    {
      id: 'completing',
      name: 'Complete',
      icon: <BarChart3 className="w-4 h-4" />,
      color: 'text-yellow-400',
      bgColor: 'bg-yellow-600'
    },
    {
      id: 'completed',
      name: 'Done',
      icon: <CheckCircle className="w-4 h-4" />,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-600'
    }
  ];

  const currentPhaseIndex = phases.findIndex(p => p.id === currentPhase);
  const isPhaseActive = (phaseIndex: number): boolean => phaseIndex <= currentPhaseIndex;
  const isCurrentPhase = (phaseIndex: number): boolean => phaseIndex === currentPhaseIndex;

  return (
    <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-300">Execution Pipeline</h3>
        <span className="text-xs text-gray-400">{progressPercentage}% Complete</span>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Horizontal line */}
        <div className="absolute top-4 left-0 w-full h-0.5 bg-gray-700"></div>

        {/* Filled progress line */}
        <div
          className="absolute top-4 left-0 h-0.5 bg-gradient-to-r from-blue-500 via-green-500 to-purple-500 transition-all duration-500"
          style={{ width: `${(currentPhaseIndex / (phases.length - 1)) * 100}%` }}
        ></div>

        {/* Phase nodes */}
        <div className="relative flex justify-between">
          {phases.map((phase, index) => (
            <div key={phase.id} className="flex flex-col items-center" style={{ width: '100px' }}>
              {/* Circle node */}
              <div
                className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${
                  isCurrentPhase(index)
                    ? `${phase.bgColor} border-white shadow-lg animate-pulse`
                    : isPhaseActive(index)
                    ? `${phase.bgColor} border-white`
                    : 'bg-gray-700 border-gray-600'
                }`}
              >
                <div className={isPhaseActive(index) ? phase.color : 'text-gray-500'}>
                  {phase.icon}
                </div>
              </div>

              {/* Label */}
              <span
                className={`mt-2 text-xs font-medium transition-colors ${
                  isCurrentPhase(index) ? phase.color : isPhaseActive(index) ? 'text-gray-400' : 'text-gray-600'
                }`}
              >
                {phase.name}
              </span>

              {/* Active indicator */}
              {isCurrentPhase(index) && (
                <div className="mt-1 w-1 h-1 rounded-full bg-white animate-ping"></div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
