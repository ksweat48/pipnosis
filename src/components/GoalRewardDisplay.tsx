import { useEffect, useState } from 'react';
import { Trophy, TrendingUp, Star, Zap } from 'lucide-react';

interface GoalRewardDisplayProps {
  scoreChange: number;
  newScore: number;
  oldScore: number;
  factors: string[];
  personalityChanged: boolean;
  oldPersonality?: string;
  newPersonality?: string;
}

export function GoalRewardDisplay({
  scoreChange,
  newScore,
  oldScore,
  factors,
  personalityChanged,
  oldPersonality,
  newPersonality
}: GoalRewardDisplayProps) {
  const [animatedScore, setAnimatedScore] = useState(oldScore);
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    // Animate score counter
    const duration = 2000; // 2 seconds
    const steps = 50;
    const increment = (newScore - oldScore) / steps;
    const stepDuration = duration / steps;

    let currentStep = 0;
    const timer = setInterval(() => {
      currentStep++;
      if (currentStep <= steps) {
        setAnimatedScore(Math.round(oldScore + (increment * currentStep)));
      } else {
        setAnimatedScore(newScore);
        clearInterval(timer);

        // Show confetti for personality change
        if (personalityChanged) {
          setShowConfetti(true);
          setTimeout(() => setShowConfetti(false), 3000);
        }
      }
    }, stepDuration);

    return () => clearInterval(timer);
  }, [oldScore, newScore, personalityChanged]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-purple-400';
    if (score >= 65) return 'text-blue-400';
    if (score >= 50) return 'text-green-400';
    if (score >= 35) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getPersonalityIcon = () => {
    if (newScore >= 80) return <Trophy className="w-8 h-8" />;
    if (newScore >= 65) return <Star className="w-8 h-8" />;
    if (newScore >= 50) return <TrendingUp className="w-8 h-8" />;
    return <Zap className="w-8 h-8" />;
  };

  return (
    <div className="relative">
      {/* Confetti effect */}
      {showConfetti && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          {[...Array(30)].map((_, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 bg-gradient-to-r from-yellow-400 via-pink-500 to-purple-500 rounded-full animate-ping"
              style={{
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 0.5}s`,
                animationDuration: `${1 + Math.random()}s`
              }}
            />
          ))}
        </div>
      )}

      {/* Main reward display */}
      <div className="bg-gradient-to-br from-yellow-900/30 to-orange-900/30 border-2 border-yellow-500/50 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="bg-yellow-500/20 p-3 rounded-full">
              <Trophy className="w-6 h-6 text-yellow-400" />
            </div>
            <div>
              <div className="text-sm text-gray-400">Goal Achievement Reward</div>
              <div className="text-3xl font-bold text-yellow-400">
                +{scoreChange} Points
              </div>
            </div>
          </div>

          {/* Animated score */}
          <div className="text-center">
            <div className="text-sm text-gray-400 mb-1">Trader Score</div>
            <div className={`text-4xl font-bold transition-colors duration-300 ${getScoreColor(animatedScore)}`}>
              {animatedScore}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {oldScore} → {newScore}
            </div>
          </div>
        </div>

        {/* Reward factors */}
        <div className="space-y-2 mb-4">
          <div className="text-sm font-semibold text-gray-300 mb-2">Reward Breakdown:</div>
          {factors.map((factor, index) => (
            <div
              key={index}
              className="flex items-center gap-2 text-sm text-gray-300 bg-gray-800/30 rounded px-3 py-2 animate-fade-in"
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
              {factor}
            </div>
          ))}
        </div>

        {/* Personality change announcement */}
        {personalityChanged && oldPersonality && newPersonality && (
          <div className="bg-gradient-to-r from-purple-900/50 to-blue-900/50 border border-purple-500/50 rounded-lg p-4 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="bg-purple-500/20 p-3 rounded-full">
                {getPersonalityIcon()}
              </div>
              <div>
                <div className="text-lg font-bold text-white mb-1">
                  🎭 Personality Level Up!
                </div>
                <div className="text-sm text-gray-300">
                  <span className="text-gray-400 capitalize">{oldPersonality}</span>
                  <span className="mx-2">→</span>
                  <span className="text-purple-400 font-bold capitalize">{newPersonality}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fade-in {
          animation: fade-in 0.5s ease-out forwards;
          opacity: 0;
        }
      `}</style>
    </div>
  );
}
