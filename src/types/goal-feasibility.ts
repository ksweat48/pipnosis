export interface MeaningfulnessChecks {
  meetsVolatilityFloor: boolean;
  meetsAccountFloor: boolean;
  meetsSpreadFloor: boolean;
  meetsHistoricalFloor: boolean;
  anyMet: boolean;
}

export interface AdjustedTradeParameters {
  targetProfit: number;
  stopLoss: number;
  riskReward: number;
  timeToFillMinutes: number;
  positionSize: number;
  estimatedSpreadCost: number;
}

export interface VolatilityContext {
  currentATR: number;
  typicalATR: number;
  dailyATR: number;
  sessionLiquidity: 'high' | 'medium' | 'low';
  atrMultiplierFromTypical: number;
}

export interface DownshiftProposal {
  originalGoal: number;
  adjustedGoal: number;
  retentionPercent: number;

  adjustedTrade: AdjustedTradeParameters;

  volatilityContext: VolatilityContext;

  meaningfulnessChecks: MeaningfulnessChecks;

  reasonsForDownshift: string[];

  calculationMetadata: {
    accountBalance: number;
    currentProgress: number;
    remainingGoal: number;
    symbol: string;
    timestamp: string;
  };
}

export type FeasibilityDecision =
  | 'AFFIRM'
  | 'WAIT'
  | 'REJECT';

export interface AlphaFeasibilityResponse {
  decision: FeasibilityDecision;
  reasoning: string;
  adjustments?: {
    modifiedStopLoss?: number;
    modifiedTargetProfit?: number;
  };
}

export interface FeasibilityResult {
  feasible: boolean;
  tier: 'EXECUTE' | 'WAIT_FOR_VOLATILITY' | 'BLOCK_WITH_ALTERNATIVES';
  proposal?: DownshiftProposal;
  waitReason?: string;
  blockReason?: string;
  alternativeSuggestions?: string[];
}

export interface MeaningfulTradeThresholds {
  volatilityFloorValue: number;
  accountFloorValue: number;
  spreadFloorValue: number;
  historicalFloorValue: number;
}

export interface GoalFeasibilityAnalysis {
  canDeliver: number;
  retentionPercent: number;
  isMeaningful: boolean;
  thresholds: MeaningfulTradeThresholds;
  checks: MeaningfulnessChecks;
  recommendedAction: 'EXECUTE' | 'WAIT' | 'BLOCK';
  explanation: string;
}
