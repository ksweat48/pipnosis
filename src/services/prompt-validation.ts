interface ValidationResult {
  isValid: boolean;
  isFeasible: boolean;
  errorMessage?: string;
  validationDetails?: {
    reasons: string[];
  };
  suggestedAlternative?: string;
}

class PromptValidationService {
  async validatePrompt(prompt: string, accountBalance: number): Promise<ValidationResult> {
    if (!prompt || prompt.trim().length === 0) {
      return {
        isValid: false,
        isFeasible: false,
        errorMessage: 'Please enter a trading request'
      };
    }

    if (accountBalance < 100) {
      return {
        isValid: false,
        isFeasible: false,
        errorMessage: 'Insufficient account balance',
        validationDetails: {
          reasons: ['Account balance must be at least $100 to trade']
        },
        suggestedAlternative: 'Please add funds to your demo account'
      };
    }

    return {
      isValid: true,
      isFeasible: true
    };
  }
}

export const promptValidationService = new PromptValidationService();
