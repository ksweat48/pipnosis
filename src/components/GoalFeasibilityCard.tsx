import { CheckCircle2, XCircle, Clock, TrendingUp, AlertCircle } from 'lucide-react';
import type { DownshiftProposal, AlphaFeasibilityResponse } from '../types/goal-feasibility';

interface GoalFeasibilityCardProps {
  proposal: DownshiftProposal;
  alphaResponse?: AlphaFeasibilityResponse;
  showDetails?: boolean;
}

export function GoalFeasibilityCard({
  proposal,
  alphaResponse,
  showDetails = true,
}: GoalFeasibilityCardProps) {
  const {
    originalGoal,
    adjustedGoal,
    retentionPercent,
    adjustedTrade,
    volatilityContext,
    meaningfulnessChecks,
    reasonsForDownshift,
  } = proposal;

  const retentionPercentDisplay = (retentionPercent * 100).toFixed(0);

  const getDecisionBadge = (decision?: string) => {
    if (!decision) return null;

    const config = {
      AFFIRM: {
        bg: 'bg-green-500/10',
        text: 'text-green-400',
        icon: CheckCircle2,
        label: 'Approved',
      },
      WAIT: {
        bg: 'bg-yellow-500/10',
        text: 'text-yellow-400',
        icon: Clock,
        label: 'Wait',
      },
      REJECT: {
        bg: 'bg-red-500/10',
        text: 'text-red-400',
        icon: XCircle,
        label: 'Rejected',
      },
    }[decision];

    if (!config) return null;

    const Icon = config.icon;

    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${config.bg}`}>
        <Icon className={`w-4 h-4 ${config.text}`} />
        <span className={`text-sm font-medium ${config.text}`}>{config.label}</span>
      </div>
    );
  };

  const checksPassedCount = [
    meaningfulnessChecks.meetsVolatilityFloor,
    meaningfulnessChecks.meetsAccountFloor,
    meaningfulnessChecks.meetsSpreadFloor,
    meaningfulnessChecks.meetsHistoricalFloor,
  ].filter(Boolean).length;

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-400" />
            Goal Adjusted for Market
          </h3>
          <p className="text-sm text-slate-400 mt-1">
            Market can deliver {retentionPercentDisplay}% of your target
          </p>
        </div>
        {alphaResponse && getDecisionBadge(alphaResponse.decision)}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-900/50 rounded-lg p-3">
          <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">
            Requested Goal
          </div>
          <div className="text-2xl font-bold text-slate-300">
            ${originalGoal.toFixed(2)}
          </div>
        </div>

        <div className="bg-slate-900/50 rounded-lg p-3 border-2 border-blue-500/30">
          <div className="text-xs text-blue-400 uppercase tracking-wider mb-1">
            Adjusted Goal
          </div>
          <div className="text-2xl font-bold text-blue-400">
            ${adjustedGoal.toFixed(2)}
          </div>
          <div className="text-xs text-blue-300 mt-1">
            {retentionPercentDisplay}% retention
          </div>
        </div>
      </div>

      <div className="border-t border-slate-700 pt-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-slate-300">
            Meaningfulness Checks
          </h4>
          <span className="text-sm text-slate-400">
            {checksPassedCount}/4 passed
          </span>
        </div>

        <div className="space-y-2">
          <CheckItem
            label="Volatility Floor"
            description="15% of daily ATR opportunity"
            passed={meaningfulnessChecks.meetsVolatilityFloor}
          />
          <CheckItem
            label="Account Floor"
            description="0.15% of account balance"
            passed={meaningfulnessChecks.meetsAccountFloor}
          />
          <CheckItem
            label="Spread Floor"
            description="3x spread cost minimum"
            passed={meaningfulnessChecks.meetsSpreadFloor}
          />
          <CheckItem
            label="Historical Floor"
            description="25% of typical winning trade"
            passed={meaningfulnessChecks.meetsHistoricalFloor}
          />
        </div>

        {!meaningfulnessChecks.anyMet && (
          <div className="mt-3 flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
            <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-yellow-300">
              Trade does not meet minimum meaningful thresholds. Waiting for better market conditions is recommended.
            </div>
          </div>
        )}
      </div>

      {showDetails && (
        <>
          <div className="border-t border-slate-700 pt-4">
            <h4 className="text-sm font-semibold text-slate-300 mb-3">
              Market Conditions
            </h4>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-slate-500">Volatility</div>
                <div className="text-slate-300 font-medium">
                  {(volatilityContext.atrMultiplierFromTypical * 100).toFixed(0)}% of typical
                </div>
              </div>
              <div>
                <div className="text-slate-500">Session Liquidity</div>
                <div className="text-slate-300 font-medium capitalize">
                  {volatilityContext.sessionLiquidity}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Est. Time to Fill</div>
                <div className="text-slate-300 font-medium">
                  ~{adjustedTrade.timeToFillMinutes} min
                </div>
              </div>
              <div>
                <div className="text-slate-500">Risk:Reward</div>
                <div className="text-slate-300 font-medium">
                  {adjustedTrade.riskReward.toFixed(2)}:1
                </div>
              </div>
            </div>
          </div>

          {reasonsForDownshift.length > 0 && (
            <div className="border-t border-slate-700 pt-4">
              <h4 className="text-sm font-semibold text-slate-300 mb-2">
                Why Adjusted?
              </h4>
              <ul className="space-y-1.5">
                {reasonsForDownshift.map((reason, idx) => (
                  <li key={idx} className="text-sm text-slate-400 flex items-start gap-2">
                    <span className="text-blue-400 mt-1">•</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {alphaResponse && (
            <div className="border-t border-slate-700 pt-4">
              <h4 className="text-sm font-semibold text-slate-300 mb-2">
                Alpha's Evaluation
              </h4>
              <p className="text-sm text-slate-400 leading-relaxed">
                {alphaResponse.reasoning}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CheckItem({
  label,
  description,
  passed,
}: {
  label: string;
  description: string;
  passed: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      {passed ? (
        <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 text-slate-600 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div
          className={`text-sm font-medium ${
            passed ? 'text-slate-300' : 'text-slate-500'
          }`}
        >
          {label}
        </div>
        <div className="text-xs text-slate-500">{description}</div>
      </div>
    </div>
  );
}
