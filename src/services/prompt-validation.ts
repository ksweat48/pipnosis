import { openAIService } from './openai';

export interface PromptValidationResult {
  isValid: boolean;
  isFeasible: boolean;
  errorMessage?: string;
  requiredCapital?: number;
  estimatedProfit?: number;
  riskLevel?: 'low' | 'medium' | 'high';
  suggestedAlternative?: string;
  validationDetails?: {
    meetsImmutableLaws: boolean;
    sufficientBalance: boolean;
    realisticTarget: boolean;
    reasons: string[];
  };
}

export interface PromptIntent {
  type: 'profit_target' | 'trade_request' | 'market_analysis' | 'general';
  targetAmount?: number;
  targetPercentage?: number;
  timeframe?: string;
  riskTolerance: 'low' | 'medium' | 'high';
  symbols?: string[];
}

export class PromptValidationService {
  private readonly IMMUTABLE_LAW_MAX_RISK_PERCENT = 4;
  private readonly IMMUTABLE_LAW_MIN_RR = 1;
  private readonly IMMUTABLE_LAW_MAX_DRAWDOWN = 15;
  private readonly STANDARD_LOT_VALUE = 100000;
  private readonly PIP_VALUE = 10;

  async validatePrompt(
    prompt: string,
    accountBalance: number
  ): Promise<PromptValidationResult> {
    const intent = this.parsePromptIntent(prompt);

    if (intent.targetAmount) {
      return this.validateProfitTarget(
        intent.targetAmount,
        accountBalance,
        intent.riskTolerance
      );
    }

    const feasibilityCheck = await this.checkGeneralFeasibility(
      prompt,
      accountBalance,
      intent.riskTolerance
    );

    return feasibilityCheck;
  }

  private parsePromptIntent(prompt: string): PromptIntent {
    const lowerPrompt = prompt.toLowerCase();

    let targetAmount: number | undefined;
    const dollarMatch = prompt.match(/\$\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/);
    if (dollarMatch) {
      targetAmount = parseFloat(dollarMatch[1].replace(/,/g, ''));
    }

    const numberMatch = prompt.match(/(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:dollars?|usd)/i);
    if (!targetAmount && numberMatch) {
      targetAmount = parseFloat(numberMatch[1].replace(/,/g, ''));
    }

    let targetPercentage: number | undefined;
    const percentMatch = prompt.match(/(\d+(?:\.\d+)?)\s*%/);
    if (percentMatch) {
      targetPercentage = parseFloat(percentMatch[1]);
    }

    let riskTolerance: 'low' | 'medium' | 'high' = 'medium';
    if (lowerPrompt.includes('safe') || lowerPrompt.includes('conservative') || lowerPrompt.includes('low risk')) {
      riskTolerance = 'low';
    } else if (lowerPrompt.includes('aggressive') || lowerPrompt.includes('high risk')) {
      riskTolerance = 'high';
    }

    const symbols: string[] = [];
    const majorPairs = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'XAUUSD'];
    for (const pair of majorPairs) {
      if (lowerPrompt.includes(pair.toLowerCase())) {
        symbols.push(pair);
      }
    }

    let type: PromptIntent['type'] = 'general';
    if (targetAmount || targetPercentage) {
      type = 'profit_target';
    } else if (lowerPrompt.includes('analyze') || lowerPrompt.includes('market')) {
      type = 'market_analysis';
    } else if (lowerPrompt.includes('trade') || lowerPrompt.includes('buy') || lowerPrompt.includes('sell')) {
      type = 'trade_request';
    }

    return {
      type,
      targetAmount,
      targetPercentage,
      riskTolerance,
      symbols: symbols.length > 0 ? symbols : undefined
    };
  }

  private validateProfitTarget(
    targetProfit: number,
    accountBalance: number,
    riskTolerance: 'low' | 'medium' | 'high'
  ): PromptValidationResult {
    const reasons: string[] = [];

    const maxRiskPercent = riskTolerance === 'low' ? 2 : riskTolerance === 'medium' ? 3 : 4;
    const maxRiskAmount = accountBalance * (maxRiskPercent / 100);

    const minRR = this.IMMUTABLE_LAW_MIN_RR;
    const requiredCapital = targetProfit / (minRR * (maxRiskPercent / 100));

    const profitAsPercentage = (targetProfit / accountBalance) * 100;

    if (targetProfit <= 0) {
      return {
        isValid: false,
        isFeasible: false,
        errorMessage: 'Invalid profit target. Please specify a positive profit amount.',
        validationDetails: {
          meetsImmutableLaws: false,
          sufficientBalance: false,
          realisticTarget: false,
          reasons: ['Profit target must be greater than $0']
        }
      };
    }

    if (requiredCapital > accountBalance) {
      const maxRealisticProfit = accountBalance * (maxRiskPercent / 100) * minRR;

      return {
        isValid: false,
        isFeasible: false,
        errorMessage: `This profit target requires $${requiredCapital.toFixed(2)} but you have $${accountBalance.toFixed(2)} available.`,
        requiredCapital: requiredCapital,
        estimatedProfit: targetProfit,
        suggestedAlternative: `With your $${accountBalance.toFixed(2)} balance and ${riskTolerance} risk tolerance, you could safely target $${maxRealisticProfit.toFixed(2)} profit (${maxRiskPercent}% risk at ${minRR}:1 RR).`,
        validationDetails: {
          meetsImmutableLaws: false,
          sufficientBalance: false,
          realisticTarget: false,
          reasons: [
            `Required capital: $${requiredCapital.toFixed(2)}`,
            `Available balance: $${accountBalance.toFixed(2)}`,
            `Shortfall: $${(requiredCapital - accountBalance).toFixed(2)}`,
            `Immutable Law #1: Cannot risk more than ${this.IMMUTABLE_LAW_MAX_RISK_PERCENT}% per trade`
          ]
        }
      };
    }

    if (profitAsPercentage > 20) {
      reasons.push('Target represents >20% account growth - very aggressive');
    }

    const meetsImmutableLaws = true;
    const sufficientBalance = true;
    const realisticTarget = profitAsPercentage <= 50;

    if (!realisticTarget) {
      return {
        isValid: false,
        isFeasible: false,
        errorMessage: `Target of $${targetProfit.toFixed(2)} (${profitAsPercentage.toFixed(1)}% of account) is unrealistic for a single trading session.`,
        suggestedAlternative: `Consider breaking this into multiple sessions or lowering your target. With ${riskTolerance} risk, a realistic session target would be $${(accountBalance * 0.1).toFixed(2)} to $${(accountBalance * 0.2).toFixed(2)}.`,
        validationDetails: {
          meetsImmutableLaws,
          sufficientBalance,
          realisticTarget: false,
          reasons: [
            `Target: ${profitAsPercentage.toFixed(1)}% account growth`,
            'Immutable Law #4: Maximum 2 trades per session',
            'Realistic single-session target: 5-20% maximum'
          ]
        }
      };
    }

    return {
      isValid: true,
      isFeasible: true,
      requiredCapital,
      estimatedProfit: targetProfit,
      riskLevel: riskTolerance,
      validationDetails: {
        meetsImmutableLaws: true,
        sufficientBalance: true,
        realisticTarget: true,
        reasons: [
          `Target: $${targetProfit.toFixed(2)} (${profitAsPercentage.toFixed(1)}% of balance)`,
          `Risk tolerance: ${riskTolerance}`,
          `Max risk per trade: ${maxRiskPercent}%`,
          'All Immutable Laws satisfied'
        ]
      }
    };
  }

  private async checkGeneralFeasibility(
    prompt: string,
    accountBalance: number,
    riskTolerance: 'low' | 'medium' | 'high'
  ): Promise<PromptValidationResult> {
    try {
      const assessment = await openAIService.assessFeasibility(
        prompt,
        accountBalance,
        riskTolerance
      );

      if (!assessment.feasible) {
        return {
          isValid: false,
          isFeasible: false,
          errorMessage: assessment.reasoning,
          suggestedAlternative: assessment.recommendations?.[0] || 'Please adjust your request to match your account size.',
          riskLevel: assessment.riskLevel,
          validationDetails: {
            meetsImmutableLaws: false,
            sufficientBalance: false,
            realisticTarget: false,
            reasons: [assessment.reasoning]
          }
        };
      }

      return {
        isValid: true,
        isFeasible: true,
        riskLevel: assessment.riskLevel,
        validationDetails: {
          meetsImmutableLaws: true,
          sufficientBalance: true,
          realisticTarget: true,
          reasons: [assessment.reasoning]
        }
      };
    } catch (error) {
      console.error('Feasibility check failed:', error);
      return {
        isValid: true,
        isFeasible: true,
        riskLevel: riskTolerance,
        validationDetails: {
          meetsImmutableLaws: true,
          sufficientBalance: true,
          realisticTarget: true,
          reasons: ['Validation check passed']
        }
      };
    }
  }

  calculateMinimumCapitalRequired(
    targetProfit: number,
    riskPercentage: number,
    riskRewardRatio: number
  ): number {
    return targetProfit / (riskRewardRatio * (riskPercentage / 100));
  }

  getRealisticProfitRange(accountBalance: number, riskTolerance: 'low' | 'medium' | 'high'): {
    min: number;
    max: number;
    conservative: number;
    aggressive: number;
  } {
    const riskPercent = riskTolerance === 'low' ? 2 : riskTolerance === 'medium' ? 3 : 4;
    const minRR = 1;
    const maxRR = 3;

    const conservative = accountBalance * (riskPercent / 100) * minRR;
    const aggressive = accountBalance * (riskPercent / 100) * maxRR * 2;

    return {
      min: conservative,
      max: aggressive,
      conservative: conservative * 1.5,
      aggressive: aggressive * 0.7
    };
  }
}

export const promptValidationService = new PromptValidationService();
