/**
 * GRADING THRESHOLDS - Single Source of Truth
 *
 * All performance grading and scoring thresholds MUST be defined here.
 * DO NOT hardcode grading values elsewhere in the codebase.
 *
 * Usage: import { GRADING_THRESHOLDS, getGrade } from '@/config/grading-thresholds';
 */

export const GRADING_THRESHOLDS = {
  WIN_RATE: {
    MINIMUM: 50,
    ACCEPTABLE: 55,
    GOOD: 60,
    VERY_GOOD: 70,
    EXCELLENT: 75,
    EXCEPTIONAL: 80,
  },

  PROFIT_FACTOR: {
    BREAK_EVEN: 1.0,
    MINIMUM: 1.1,
    ACCEPTABLE: 1.2,
    GOOD: 1.3,
    TARGET: 1.5,
    EXCELLENT: 1.8,
    EXCEPTIONAL: 2.0,
    OUTSTANDING: 2.5,
  },

  SHARPE_RATIO: {
    POOR: 0,
    ACCEPTABLE: 0.5,
    GOOD: 1.0,
    EXCELLENT: 1.5,
    EXCEPTIONAL: 2.0,
  },

  MAX_DRAWDOWN_PERCENT: {
    EXCELLENT: 5,
    GOOD: 10,
    ACCEPTABLE: 15,
    POOR: 20,
    CRITICAL: 25,
  },

  CONSISTENCY_SCORE: {
    POOR: 40,
    ACCEPTABLE: 50,
    GOOD: 60,
    VERY_GOOD: 70,
    EXCELLENT: 80,
    EXCEPTIONAL: 90,
  },
} as const;

export type GradeLetter = 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';

export interface GradeRequirements {
  minWinRate: number;
  minProfitFactor: number;
  minConsistency?: number;
  maxDrawdown?: number;
}

export const GRADE_REQUIREMENTS: Record<GradeLetter, GradeRequirements> = {
  'A+': {
    minWinRate: GRADING_THRESHOLDS.WIN_RATE.EXCELLENT,
    minProfitFactor: GRADING_THRESHOLDS.PROFIT_FACTOR.EXCEPTIONAL,
    minConsistency: GRADING_THRESHOLDS.CONSISTENCY_SCORE.EXCELLENT,
    maxDrawdown: GRADING_THRESHOLDS.MAX_DRAWDOWN_PERCENT.EXCELLENT,
  },
  'A': {
    minWinRate: GRADING_THRESHOLDS.WIN_RATE.VERY_GOOD,
    minProfitFactor: GRADING_THRESHOLDS.PROFIT_FACTOR.EXCELLENT,
    minConsistency: GRADING_THRESHOLDS.CONSISTENCY_SCORE.VERY_GOOD,
    maxDrawdown: GRADING_THRESHOLDS.MAX_DRAWDOWN_PERCENT.GOOD,
  },
  'B+': {
    minWinRate: GRADING_THRESHOLDS.WIN_RATE.GOOD,
    minProfitFactor: GRADING_THRESHOLDS.PROFIT_FACTOR.TARGET,
    minConsistency: GRADING_THRESHOLDS.CONSISTENCY_SCORE.GOOD,
    maxDrawdown: GRADING_THRESHOLDS.MAX_DRAWDOWN_PERCENT.ACCEPTABLE,
  },
  'B': {
    minWinRate: GRADING_THRESHOLDS.WIN_RATE.ACCEPTABLE,
    minProfitFactor: GRADING_THRESHOLDS.PROFIT_FACTOR.GOOD,
    minConsistency: GRADING_THRESHOLDS.CONSISTENCY_SCORE.ACCEPTABLE,
  },
  'C+': {
    minWinRate: GRADING_THRESHOLDS.WIN_RATE.MINIMUM,
    minProfitFactor: GRADING_THRESHOLDS.PROFIT_FACTOR.ACCEPTABLE,
  },
  'C': {
    minWinRate: GRADING_THRESHOLDS.WIN_RATE.MINIMUM,
    minProfitFactor: GRADING_THRESHOLDS.PROFIT_FACTOR.MINIMUM,
  },
  'D': {
    minWinRate: 45,
    minProfitFactor: GRADING_THRESHOLDS.PROFIT_FACTOR.BREAK_EVEN,
  },
  'F': {
    minWinRate: 0,
    minProfitFactor: 0,
  },
};

export interface PerformanceMetrics {
  winRate: number;
  profitFactor: number;
  consistency?: number;
  maxDrawdown?: number;
}

export function getGrade(metrics: PerformanceMetrics): GradeLetter {
  const grades: GradeLetter[] = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'D', 'F'];

  for (const grade of grades) {
    const req = GRADE_REQUIREMENTS[grade];

    const meetsWinRate = metrics.winRate >= req.minWinRate;
    const meetsProfitFactor = metrics.profitFactor >= req.minProfitFactor;
    const meetsConsistency = !req.minConsistency || (metrics.consistency ?? 100) >= req.minConsistency;
    const meetsDrawdown = !req.maxDrawdown || (metrics.maxDrawdown ?? 0) <= req.maxDrawdown;

    if (meetsWinRate && meetsProfitFactor && meetsConsistency && meetsDrawdown) {
      return grade;
    }
  }

  return 'F';
}

export function getGradeColor(grade: GradeLetter): string {
  const colors: Record<GradeLetter, string> = {
    'A+': '#00C853',
    'A': '#00E676',
    'B+': '#69F0AE',
    'B': '#B2FF59',
    'C+': '#FFEB3B',
    'C': '#FFC107',
    'D': '#FF9800',
    'F': '#F44336',
  };
  return colors[grade];
}

export function getGradeDescription(grade: GradeLetter): string {
  const descriptions: Record<GradeLetter, string> = {
    'A+': 'Exceptional performance - Elite trader level',
    'A': 'Excellent performance - Professional level',
    'B+': 'Very good performance - Above average',
    'B': 'Good performance - Solid foundation',
    'C+': 'Acceptable performance - Room for improvement',
    'C': 'Average performance - Needs work',
    'D': 'Below average - Significant improvement needed',
    'F': 'Poor performance - Strategy review required',
  };
  return descriptions[grade];
}

export const EDGE_STRENGTH = {
  NEGATIVE: { min: -Infinity, max: 0, label: 'Negative Edge' },
  WEAK: { min: 0, max: 10, label: 'Weak Edge' },
  MODERATE: { min: 10, max: 25, label: 'Moderate Edge' },
  STRONG: { min: 25, max: Infinity, label: 'Strong Edge' },
} as const;

export function getEdgeStrength(edgePercent: number): keyof typeof EDGE_STRENGTH {
  if (edgePercent < 0) return 'NEGATIVE';
  if (edgePercent < 10) return 'WEAK';
  if (edgePercent < 25) return 'MODERATE';
  return 'STRONG';
}

export const SAMPLE_SIZE_CONFIDENCE = {
  LOW: { min: 10, label: 'Low confidence (10+ trades)' },
  MEDIUM: { min: 30, label: 'Medium confidence (30+ trades)' },
  HIGH: { min: 50, label: 'High confidence (50+ trades)' },
  VERY_HIGH: { min: 100, label: 'Very high confidence (100+ trades)' },
} as const;

export function getSampleSizeConfidence(tradeCount: number): keyof typeof SAMPLE_SIZE_CONFIDENCE {
  if (tradeCount >= 100) return 'VERY_HIGH';
  if (tradeCount >= 50) return 'HIGH';
  if (tradeCount >= 30) return 'MEDIUM';
  return 'LOW';
}
