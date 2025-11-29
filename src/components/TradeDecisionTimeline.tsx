import React from 'react';
import { Shield, Eye, Sliders, AlertTriangle, Brain, CheckCircle, ArrowRight } from 'lucide-react';
import { sessionIntelligenceService, TradeIntelligence } from '../services/session-intelligence-service';

interface TradeDecisionTimelineProps {
  trade: TradeIntelligence;
  orientation?: 'horizontal' | 'vertical';
}

// DEPRECATED: This component visualizes the old 5-layer system
// TODO: Rewrite to show Pipnosis Alpha decision flow:
//   1. Strategy Planning → 2. Condition Monitoring → 3. Execution Decision → 4. Safety Validation

export function TradeDecisionTimeline({ trade, orientation = 'vertical' }: TradeDecisionTimelineProps) {
  // Legacy layer extraction - kept for backward compatibility
  const trail = sessionIntelligenceService.extractLayerDecisionTrail(trade);

  const layers = [
    {
      number: 1,
      name: 'Hard Gate',
      icon: Shield,
      color: 'blue',
      decision: trail.layer1.decision,
      reasoning: trail.layer1.reasoning,
      blocked: trail.layer1.blocked,
      timestamp: trail.layer1.timestamp,
    },
    {
      number: 2,
      name: 'Regime Validation',
      icon: Eye,
      color: 'purple',
      decision: trail.layer2.decision,
      reasoning: trail.layer2.reasoning,
      confidence: trail.layer2.regimeConfidence,
      timestamp: trail.layer2.timestamp,
    },
    {
      number: 3,
      name: 'Adaptive Learning',
      icon: Sliders,
      color: 'green',
      decision: trail.layer3.decision,
      reasoning: trail.layer3.reasoning,
      adjustments: trail.layer3.adjustments,
      graduation: trail.layer3.graduation,
      similarPatterns: trail.layer3.similarPatternsCount,
      timestamp: trail.layer3.timestamp,
    },
    {
      number: 4,
      name: 'Mistake Prevention',
      icon: AlertTriangle,
      color: 'yellow',
      decision: trail.layer4.decision,
      reasoning: trail.layer4.reasoning,
      warnings: trail.layer4.warnings,
      timestamp: trail.layer4.timestamp,
    },
    {
      number: 5,
      name: 'LLM Brain',
      icon: Brain,
      color: 'pink',
      decision: trail.layer5.decision,
      reasoning: [trail.layer5.fullReasoning],
      confidence: trail.layer5.finalConfidence,
      timestamp: trail.layer5.timestamp,
    },
  ];

  if (orientation === 'horizontal') {
    return (
      <div className="flex items-start gap-2 overflow-x-auto pb-2">
        {layers.map((layer, idx) => (
          <React.Fragment key={layer.number}>
            <LayerCard layer={layer} compact />
            {idx < layers.length - 1 && (
              <div className="flex items-center pt-6">
                <ArrowRight className="w-5 h-5 text-gray-500" />
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {layers.map((layer) => (
        <LayerCard key={layer.number} layer={layer} />
      ))}
    </div>
  );
}

function LayerCard({ layer, compact }: { layer: any; compact?: boolean }) {
  const colorClasses = {
    blue: {
      bg: 'bg-blue-900/20',
      border: 'border-blue-500/30',
      text: 'text-blue-400',
      icon: 'text-blue-400',
    },
    purple: {
      bg: 'bg-purple-900/20',
      border: 'border-purple-500/30',
      text: 'text-purple-400',
      icon: 'text-purple-400',
    },
    green: {
      bg: 'bg-green-900/20',
      border: 'border-green-500/30',
      text: 'text-green-400',
      icon: 'text-green-400',
    },
    yellow: {
      bg: 'bg-yellow-900/20',
      border: 'border-yellow-500/30',
      text: 'text-yellow-400',
      icon: 'text-yellow-400',
    },
    pink: {
      bg: 'bg-pink-900/20',
      border: 'border-pink-500/30',
      text: 'text-pink-400',
      icon: 'text-pink-400',
    },
  };

  const colors = colorClasses[layer.color] || colorClasses.blue;
  const Icon = layer.icon;

  if (compact) {
    return (
      <div className={`${colors.bg} border ${colors.border} rounded-lg p-3 min-w-[200px]`}>
        <div className="flex items-center gap-2 mb-2">
          <Icon className={`w-4 h-4 ${colors.icon}`} />
          <div>
            <div className={`font-medium text-sm ${colors.text}`}>Layer {layer.number}</div>
            <div className="text-xs text-gray-400">{layer.name}</div>
          </div>
        </div>
        <div className="text-sm text-white font-medium mb-1">
          {formatDecision(layer.decision)}
        </div>
        {layer.confidence !== undefined && (
          <div className="text-xs text-gray-400">
            Confidence: {layer.confidence}%
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`${colors.bg} border ${colors.border} rounded-lg p-4`}>
      {/* Layer Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${colors.bg} border ${colors.border}`}>
            <Icon className={`w-5 h-5 ${colors.icon}`} />
          </div>
          <div>
            <div className={`font-semibold ${colors.text}`}>
              Layer {layer.number}: {layer.name}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              {new Date(layer.timestamp).toLocaleTimeString()}
            </div>
          </div>
        </div>

        {/* Decision Badge */}
        <div className="flex items-center gap-2">
          {layer.blocked ? (
            <span className="px-2 py-1 rounded bg-red-900/30 border border-red-500 text-red-400 text-xs font-medium">
              BLOCKED
            </span>
          ) : (
            <CheckCircle className="w-5 h-5 text-green-400" />
          )}
        </div>
      </div>

      {/* Decision */}
      <div className="mb-2">
        <div className="text-sm text-gray-400">Decision</div>
        <div className="text-white font-medium">{formatDecision(layer.decision)}</div>
      </div>

      {/* Confidence (if available) */}
      {layer.confidence !== undefined && (
        <div className="mb-2">
          <div className="text-sm text-gray-400">Confidence</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-gray-700 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${colors.bg}`}
                style={{ width: `${layer.confidence}%` }}
              ></div>
            </div>
            <span className="text-white text-sm font-medium">{layer.confidence}%</span>
          </div>
        </div>
      )}

      {/* Adjustments (Layer 3) */}
      {layer.adjustments && Object.keys(layer.adjustments).length > 0 && (
        <div className="mb-2">
          <div className="text-sm text-gray-400 mb-1">Adaptive Adjustments</div>
          <div className="grid grid-cols-2 gap-2">
            {layer.adjustments.confidence !== undefined && (
              <AdjustmentBadge
                label="Confidence"
                value={layer.adjustments.confidence}
                positive={layer.adjustments.confidence >= 0}
              />
            )}
            {layer.adjustments.risk !== undefined && (
              <AdjustmentBadge
                label="Risk"
                value={layer.adjustments.risk}
                positive={layer.adjustments.risk >= 0}
              />
            )}
            {layer.adjustments.sl !== undefined && (
              <AdjustmentBadge
                label="Stop Loss"
                value={layer.adjustments.sl}
                positive={layer.adjustments.sl <= 0}
              />
            )}
            {layer.adjustments.tp !== undefined && (
              <AdjustmentBadge
                label="Take Profit"
                value={layer.adjustments.tp}
                positive={layer.adjustments.tp >= 0}
              />
            )}
          </div>
          {layer.graduation && (
            <div className="mt-2 text-xs text-gray-400">
              Response: <span className={colors.text}>{formatGraduation(layer.graduation)}</span>
            </div>
          )}
          {layer.similarPatterns !== undefined && (
            <div className="text-xs text-gray-400">
              Based on {layer.similarPatterns} similar pattern{layer.similarPatterns !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}

      {/* Warnings (Layer 4) */}
      {layer.warnings && layer.warnings.length > 0 && (
        <div className="mb-2">
          <div className="text-sm text-gray-400 mb-1">Warnings</div>
          <div className="space-y-1">
            {layer.warnings.map((warning: string, idx: number) => (
              <div key={idx} className="text-sm text-yellow-400 flex items-start gap-2">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                {warning}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reasoning */}
      {layer.reasoning && layer.reasoning.length > 0 && (
        <div>
          <div className="text-sm text-gray-400 mb-1">Reasoning</div>
          <ul className="space-y-1">
            {layer.reasoning.slice(0, 3).map((reason: string, idx: number) => (
              <li key={idx} className="text-sm text-gray-300 flex items-start gap-2">
                <span className={`${colors.text} mt-0.5`}>•</span>
                <span className="flex-1">{reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AdjustmentBadge({ label, value, positive }: { label: string; value: number; positive: boolean }) {
  const displayValue = value >= 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
  const colorClass = positive ? 'text-green-400 bg-green-900/20' : 'text-red-400 bg-red-900/20';

  return (
    <div className={`px-2 py-1 rounded text-xs ${colorClass}`}>
      <div className="text-gray-400">{label}</div>
      <div className="font-medium">{displayValue}%</div>
    </div>
  );
}

function formatDecision(decision: string): string {
  return decision
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatGraduation(graduation: string): string {
  const graduationMap: Record<string, string> = {
    strong_boost: 'Strong Boost',
    modest_boost: 'Modest Boost',
    neutral: 'Neutral',
    modest_reduction: 'Modest Reduction',
    significant_reduction: 'Significant Reduction',
  };
  return graduationMap[graduation] || graduation;
}
