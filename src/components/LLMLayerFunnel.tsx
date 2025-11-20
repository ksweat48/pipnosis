import React from 'react';
import { CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface LayerData {
  layer_number: number;
  layer_name: string;
  total_evaluations: number;
  pass_count: number;
  reject_count: number;
  pass_rate: number;
  avg_processing_time_ms: number;
  total_tokens_used: number;
}

interface LLMLayerFunnelProps {
  layers: LayerData[];
}

export function LLMLayerFunnel({ layers }: LLMLayerFunnelProps) {
  const sortedLayers = [...layers].sort((a, b) => a.layer_number - b.layer_number);
  const maxEvaluations = Math.max(...sortedLayers.map(l => l.total_evaluations), 1);

  return (
    <div className="space-y-3">
      {sortedLayers.map((layer, index) => {
        const widthPercentage = (layer.pass_count / maxEvaluations) * 100;
        const isHealthy = layer.pass_rate >= 60;
        const isWarning = layer.pass_rate >= 40 && layer.pass_rate < 60;
        const isCritical = layer.pass_rate < 40;

        return (
          <div key={layer.layer_number} className="relative">
            <div className="flex items-center gap-3 mb-1">
              <div className="flex items-center gap-2 min-w-[200px]">
                {isHealthy && <CheckCircle className="w-4 h-4 text-green-400" />}
                {isWarning && <AlertCircle className="w-4 h-4 text-yellow-400" />}
                {isCritical && <XCircle className="w-4 h-4 text-red-400" />}
                <span className="text-sm text-white font-medium">
                  Layer {layer.layer_number}: {layer.layer_name}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span>{layer.pass_count}/{layer.total_evaluations}</span>
                <span className={`font-semibold ${
                  isHealthy ? 'text-green-400' : isWarning ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {layer.pass_rate.toFixed(1)}%
                </span>
              </div>
            </div>

            <div className="h-12 bg-gray-800 rounded-lg overflow-hidden relative">
              <div
                className={`h-full transition-all duration-500 ${
                  isHealthy ? 'bg-gradient-to-r from-green-600 to-green-500' :
                  isWarning ? 'bg-gradient-to-r from-yellow-600 to-yellow-500' :
                  'bg-gradient-to-r from-red-600 to-red-500'
                }`}
                style={{ width: `${widthPercentage}%` }}
              />

              <div className="absolute inset-0 flex items-center justify-between px-4">
                <div className="flex items-center gap-4">
                  <span className="text-white font-bold text-sm">
                    {layer.pass_count} passed
                  </span>
                  {layer.reject_count > 0 && (
                    <span className="text-red-300 text-xs">
                      {layer.reject_count} rejected
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs text-gray-300">
                  <span>{layer.avg_processing_time_ms}ms</span>
                  <span>{layer.total_tokens_used} tokens</span>
                </div>
              </div>
            </div>

            {index < sortedLayers.length - 1 && (
              <div className="flex justify-center">
                <div className="w-0.5 h-2 bg-gray-700" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
