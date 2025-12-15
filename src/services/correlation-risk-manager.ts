import { supabase } from '../lib/supabase';

export interface CorrelationCheckInputs {
  proposedSymbol: string;
  proposedDirection: 'long' | 'short';
  proposedLotSize: number;
  userId: string;
  goalSessionId?: string;
}

export interface CorrelationRiskResult {
  approved: boolean;
  totalCorrelationRisk: number; // 0-1 scale
  correlatedPositions: Array<{
    symbol: string;
    direction: 'long' | 'short';
    correlation: number; // -1 to 1
    lotSize: number;
  }>;
  effectiveExposure: number; // Equivalent lot size considering correlation
  maxSafeSize: number; // Maximum recommended lot size
  reasoning: string;
  warnings: string[];
}

class CorrelationRiskManager {
  private readonly MAX_CORRELATION_RISK = 0.70; // Maximum 70% correlation risk
  private readonly CORRELATION_MATRIX: Record<string, Record<string, number>> = {
    'EURUSD': {
      'EURUSD': 1.0,
      'GBPUSD': 0.75,
      'AUDUSD': 0.65,
      'NZDUSD': 0.60,
      'USDJPY': -0.55,
      'USDCHF': -0.90,
      'USDCAD': -0.60,
      'XAUUSD': 0.45
    },
    'GBPUSD': {
      'EURUSD': 0.75,
      'GBPUSD': 1.0,
      'AUDUSD': 0.55,
      'NZDUSD': 0.50,
      'USDJPY': -0.45,
      'USDCHF': -0.70,
      'USDCAD': -0.50,
      'XAUUSD': 0.40
    },
    'USDJPY': {
      'EURUSD': -0.55,
      'GBPUSD': -0.45,
      'USDJPY': 1.0,
      'USDCHF': 0.50,
      'USDCAD': 0.45,
      'AUDUSD': -0.40,
      'NZDUSD': -0.35,
      'XAUUSD': -0.30
    },
    'XAUUSD': {
      'EURUSD': 0.45,
      'GBPUSD': 0.40,
      'AUDUSD': 0.50,
      'XAUUSD': 1.0,
      'USDJPY': -0.30,
      'USDCHF': -0.40,
      'USDCAD': -0.25
    },
    'AUDUSD': {
      'EURUSD': 0.65,
      'GBPUSD': 0.55,
      'AUDUSD': 1.0,
      'NZDUSD': 0.85,
      'USDJPY': -0.40,
      'USDCHF': -0.60,
      'XAUUSD': 0.50
    },
    'NZDUSD': {
      'EURUSD': 0.60,
      'GBPUSD': 0.50,
      'AUDUSD': 0.85,
      'NZDUSD': 1.0,
      'USDJPY': -0.35,
      'USDCHF': -0.55
    }
  };

  async checkCorrelationRisk(inputs: CorrelationCheckInputs): Promise<CorrelationRiskResult> {
    const { proposedSymbol, proposedDirection, proposedLotSize, userId, goalSessionId } = inputs;

    // Get current open positions
    const openPositions = await this.getOpenPositions(userId, goalSessionId);

    if (openPositions.length === 0) {
      // No existing positions, no correlation risk
      return {
        approved: true,
        totalCorrelationRisk: 0,
        correlatedPositions: [],
        effectiveExposure: proposedLotSize,
        maxSafeSize: proposedLotSize * 2,
        reasoning: 'No existing positions - no correlation risk',
        warnings: []
      };
    }

    // Calculate correlation with each open position
    const correlatedPositions: CorrelationRiskResult['correlatedPositions'] = [];
    let totalCorrelationRisk = 0;
    let effectiveExposure = proposedLotSize;

    for (const position of openPositions) {
      const correlation = this.getCorrelation(proposedSymbol, position.symbol);

      // Adjust correlation based on direction
      // Same direction = positive correlation amplifies risk
      // Opposite direction = negative correlation can hedge
      let effectiveCorrelation = correlation;
      if (proposedDirection !== position.direction) {
        effectiveCorrelation *= -1; // Flip correlation for opposite directions
      }

      correlatedPositions.push({
        symbol: position.symbol,
        direction: position.direction,
        correlation: effectiveCorrelation,
        lotSize: position.lotSize
      });

      // Add to correlation risk (only positive correlations increase risk)
      if (effectiveCorrelation > 0) {
        const correlationContribution = Math.abs(effectiveCorrelation) * (position.lotSize / proposedLotSize);
        totalCorrelationRisk += correlationContribution;
        effectiveExposure += position.lotSize * effectiveCorrelation;
      }
    }

    // Normalize correlation risk to 0-1 scale
    totalCorrelationRisk = Math.min(1.0, totalCorrelationRisk);

    // Calculate maximum safe size
    const maxSafeSize = totalCorrelationRisk > 0
      ? proposedLotSize * (1 - totalCorrelationRisk) * 1.5
      : proposedLotSize * 2;

    // Determine if approved
    const approved = totalCorrelationRisk <= this.MAX_CORRELATION_RISK;

    // Generate warnings
    const warnings: string[] = [];

    if (totalCorrelationRisk > this.MAX_CORRELATION_RISK) {
      warnings.push('⚠️ EXCESSIVE CORRELATION RISK: Too much exposure to correlated pairs');
      warnings.push(`Total correlation risk: ${(totalCorrelationRisk * 100).toFixed(0)}% (max: ${(this.MAX_CORRELATION_RISK * 100).toFixed(0)}%)`);
    } else if (totalCorrelationRisk > 0.50) {
      warnings.push('⚠️ High correlation risk detected');
      warnings.push('Consider reducing position size or closing correlated positions');
    }

    // Find highly correlated positions
    const highlyCorrelated = correlatedPositions.filter(p => Math.abs(p.correlation) > 0.70);
    if (highlyCorrelated.length > 0) {
      warnings.push(`Highly correlated with: ${highlyCorrelated.map(p => p.symbol).join(', ')}`);
    }

    // Check for perfect correlation (same pair)
    if (correlatedPositions.some(p => p.symbol === proposedSymbol && p.direction === proposedDirection)) {
      warnings.push('⚠️ You already have a position in this symbol and direction');
      warnings.push('Consider scaling into existing position instead of opening new one');
    }

    // Generate reasoning
    let reasoning = `Correlation risk: ${(totalCorrelationRisk * 100).toFixed(0)}%. `;
    reasoning += `Effective exposure: ${effectiveExposure.toFixed(2)} lots `;
    reasoning += `(proposed: ${proposedLotSize.toFixed(2)} lots). `;

    if (correlatedPositions.length > 0) {
      reasoning += `Open correlated positions: ${correlatedPositions.length}. `;
    }

    if (approved) {
      reasoning += `✅ Within acceptable correlation limits.`;
    } else {
      reasoning += `❌ Exceeds correlation risk limit of ${(this.MAX_CORRELATION_RISK * 100).toFixed(0)}%.`;
    }

    return {
      approved,
      totalCorrelationRisk,
      correlatedPositions,
      effectiveExposure,
      maxSafeSize,
      reasoning,
      warnings
    };
  }

  private getCorrelation(symbol1: string, symbol2: string): number {
    if (symbol1 === symbol2) return 1.0;

    // Check correlation matrix
    const correlation = this.CORRELATION_MATRIX[symbol1]?.[symbol2];
    if (correlation !== undefined) {
      return correlation;
    }

    // Check reverse
    const reverseCorrelation = this.CORRELATION_MATRIX[symbol2]?.[symbol1];
    if (reverseCorrelation !== undefined) {
      return reverseCorrelation;
    }

    // Default to low correlation if not in matrix
    return 0.2;
  }

  private async getOpenPositions(userId: string, goalSessionId?: string): Promise<Array<{
    symbol: string;
    direction: 'long' | 'short';
    lotSize: number;
  }>> {
    try {
      let query = supabase
        .from('goal_trades')
        .select('symbol, direction, lot_size')
        .eq('user_id', userId)
        .eq('status', 'open');

      if (goalSessionId) {
        query = query.eq('goal_session_id', goalSessionId);
      }

      const { data: positions, error } = await query;

      if (error || !positions) {
        return [];
      }

      return positions.map(p => ({
        symbol: p.symbol,
        direction: p.direction as 'long' | 'short',
        lotSize: p.lot_size
      }));
    } catch (error) {
      console.error('Error fetching open positions:', error);
      return [];
    }
  }

  async logCorrelationCheck(
    userId: string,
    inputs: CorrelationCheckInputs,
    result: CorrelationRiskResult
  ): Promise<void> {
    try {
      await supabase.from('correlation_risk_log').insert({
        user_id: userId,
        goal_session_id: inputs.goalSessionId,
        proposed_symbol: inputs.proposedSymbol,
        proposed_direction: inputs.proposedDirection,
        proposed_lot_size: inputs.proposedLotSize,
        total_correlation_risk: result.totalCorrelationRisk,
        effective_exposure: result.effectiveExposure,
        approved: result.approved,
        reasoning: result.reasoning,
        correlated_positions: result.correlatedPositions
      });
    } catch (error) {
      console.error('Error logging correlation check:', error);
    }
  }

  getDiversificationScore(positions: Array<{ symbol: string; lotSize: number }>): number {
    if (positions.length === 0) return 1.0;
    if (positions.length === 1) return 0.5;

    // Calculate average correlation between all positions
    let totalCorrelation = 0;
    let count = 0;

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const correlation = Math.abs(this.getCorrelation(positions[i].symbol, positions[j].symbol));
        totalCorrelation += correlation;
        count++;
      }
    }

    const avgCorrelation = totalCorrelation / count;

    // Diversification score: 1.0 = perfectly diversified, 0 = perfectly correlated
    return 1.0 - avgCorrelation;
  }
}

export const correlationRiskManager = new CorrelationRiskManager();
