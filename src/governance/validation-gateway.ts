/**
 * VALIDATION GATEWAY - SSOT Entry Point
 *
 * PURPOSE: Single entry point for ALL trading operations
 * Prevents architectural violations by enforcing contracts BEFORE execution
 *
 * ARCHITECTURAL ROLE:
 * - Pre-flight validation of all trading requests
 * - Contract enforcement (input validation, business rules)
 * - SSOT routing (ensure requests go to correct authority)
 * - Fail fast with clear error messages
 *
 * GOVERNANCE PRINCIPLES:
 * 1. All trading operations MUST pass through this gateway
 * 2. No service can bypass validation
 * 3. Validation rules defined in ONE place
 * 4. Authority services are the ONLY place logic executes
 *
 * @module ValidationGateway
 */

import { logger } from '../lib/logger';
import { tradeValidationService } from '../services/trade-validation-service';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  metadata?: Record<string, unknown>;
}

export interface TradeRequest {
  symbol: string;
  direction: 'buy' | 'sell';
  stopLoss: number;
  takeProfit: number | null;
  takeProfit2?: number | null;
  confidence: number;
  entryPrice: number;
  userId: string;
  sessionId?: string;
  riskPercentage?: number;
}

export interface PositionSizeRequest {
  symbol: string;
  stopLoss: number;
  entryPrice: number;
  accountBalance: number;
  riskPercentage: number;
}

export interface PriceDataRequest {
  symbol: string;
  maxAgeSeconds?: number;
}

/**
 * Validation Rules Registry
 * Single source of truth for all validation constraints
 */
export const VALIDATION_RULES = {
  POSITION_SIZE: {
    MIN: 0.001,
    MAX: 1000,
    TYPICAL_MAX: 100
  },
  CONFIDENCE: {
    MIN: 0,
    MAX: 100
  },
  RISK_PERCENTAGE: {
    MIN: 0.1,
    MAX: 5.0,
    DEFAULT: 1.0
  },
  STOP_LOSS: {
    MIN_DISTANCE_PIPS: 3,
    MAX_DISTANCE_PIPS: 500
  },
  PRICE_FRESHNESS: {
    MAX_AGE_SECONDS: 60,
    CRITICAL_MAX_AGE_SECONDS: 120
  },
  SYMBOL: {
    ALLOWED_PATTERNS: [
      /^[A-Z]{6}$/,     // EURUSD, GBPUSD
      /^XAU[A-Z]{3}$/,  // XAUUSD
      /^XAG[A-Z]{3}$/,  // XAGUSD
      /^[A-Z]{3}USD$/,  // BTCUSD, ETHUSD
      /^US30$/,         // US30
      /^NAS100$/        // NAS100
    ]
  }
} as const;

class ValidationGateway {
  /**
   * Validate trade request before execution
   * SSOT: All trade requests must pass through here
   */
  validateTradeRequest(request: TradeRequest): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate symbol format
    const symbolValidation = this.validateSymbol(request.symbol);
    if (!symbolValidation.isValid) {
      errors.push(...symbolValidation.errors);
    }

    // Validate confidence range
    if (request.confidence < VALIDATION_RULES.CONFIDENCE.MIN ||
        request.confidence > VALIDATION_RULES.CONFIDENCE.MAX) {
      errors.push(`Confidence must be between ${VALIDATION_RULES.CONFIDENCE.MIN} and ${VALIDATION_RULES.CONFIDENCE.MAX}`);
    }

    // Validate prices are positive
    if (request.entryPrice <= 0) {
      errors.push('Entry price must be positive');
    }
    // ✅ PHASE 2 SECTION 2: Use TradeValidationService (SSOT for trade validation)
    // Replaces duplicate SL/TP direction validation logic (lines 121-144)
    // This ensures consistent validation across all layers
    const validation = tradeValidationService.validateTrade({
      symbol: request.symbol,
      direction: request.direction,
      entry: request.entryPrice,
      stopLoss: request.stopLoss,
      takeProfit: request.takeProfit || request.entryPrice * 1.01, // Use small default if null for validation
      lotSize: 1.0 // Default for validation purposes
    });

    if (!validation.valid) {
      errors.push(...validation.errors);
    }

    // Include warnings from SSOT validation
    if (validation.warnings.length > 0) {
      warnings.push(...validation.warnings);
    }

    // Validate user context
    if (!request.userId || request.userId.trim() === '') {
      errors.push('User ID is required');
    }

    // Log validation result
    if (errors.length > 0) {
      logger.warn('[Validation Gateway] ❌ Trade request validation failed', {
        symbol: request.symbol,
        errors,
        warnings
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate position size request
   * SSOT: All position sizing must pass through here before going to authority
   */
  validatePositionSizeRequest(request: PositionSizeRequest): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate symbol
    const symbolValidation = this.validateSymbol(request.symbol);
    if (!symbolValidation.isValid) {
      errors.push(...symbolValidation.errors);
    }

    // Validate account balance
    if (request.accountBalance <= 0) {
      errors.push('Account balance must be positive');
    }

    // Validate risk percentage
    if (request.riskPercentage < VALIDATION_RULES.RISK_PERCENTAGE.MIN) {
      errors.push(`Risk percentage must be at least ${VALIDATION_RULES.RISK_PERCENTAGE.MIN}%`);
    }
    if (request.riskPercentage > VALIDATION_RULES.RISK_PERCENTAGE.MAX) {
      errors.push(`Risk percentage cannot exceed ${VALIDATION_RULES.RISK_PERCENTAGE.MAX}%`);
    }

    // Validate prices
    if (request.entryPrice <= 0 || request.stopLoss <= 0) {
      errors.push('Entry price and stop loss must be positive');
    }

    // Validate stop loss distance is reasonable
    const stopDistancePips = Math.abs(request.entryPrice - request.stopLoss);
    if (stopDistancePips === 0) {
      errors.push('Stop loss cannot equal entry price');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate price data request
   * SSOT: All price freshness checks route through here
   */
  validatePriceDataRequest(request: PriceDataRequest): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate symbol
    const symbolValidation = this.validateSymbol(request.symbol);
    if (!symbolValidation.isValid) {
      errors.push(...symbolValidation.errors);
    }

    // Validate max age if provided
    if (request.maxAgeSeconds !== undefined) {
      if (request.maxAgeSeconds < 0) {
        errors.push('Max age cannot be negative');
      }
      if (request.maxAgeSeconds > VALIDATION_RULES.PRICE_FRESHNESS.CRITICAL_MAX_AGE_SECONDS) {
        warnings.push(`Max age ${request.maxAgeSeconds}s exceeds critical threshold of ${VALIDATION_RULES.PRICE_FRESHNESS.CRITICAL_MAX_AGE_SECONDS}s`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate symbol format
   * SSOT: Symbol validation logic
   */
  validateSymbol(symbol: string): ValidationResult {
    const errors: string[] = [];

    if (!symbol || typeof symbol !== 'string') {
      errors.push('Symbol is required and must be a string');
      return { isValid: false, errors, warnings: [] };
    }

    const normalized = symbol.toUpperCase().trim();

    // Check against allowed patterns
    const isValid = VALIDATION_RULES.SYMBOL.ALLOWED_PATTERNS.some(
      pattern => pattern.test(normalized)
    );

    if (!isValid) {
      errors.push(`Invalid symbol format: ${symbol}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings: []
    };
  }

  /**
   * Validate calculated position size
   * SSOT: Post-calculation validation before database write
   */
  validateCalculatedPositionSize(positionSize: number, symbol: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check minimum
    if (positionSize < VALIDATION_RULES.POSITION_SIZE.MIN) {
      errors.push(
        `Position size ${positionSize} is below minimum ${VALIDATION_RULES.POSITION_SIZE.MIN}`
      );
    }

    // Check maximum
    if (positionSize > VALIDATION_RULES.POSITION_SIZE.MAX) {
      errors.push(
        `Position size ${positionSize} exceeds maximum ${VALIDATION_RULES.POSITION_SIZE.MAX}`
      );
    }

    // Warning for large positions
    if (positionSize > VALIDATION_RULES.POSITION_SIZE.TYPICAL_MAX) {
      warnings.push(
        `Position size ${positionSize} is unusually large (typical max: ${VALIDATION_RULES.POSITION_SIZE.TYPICAL_MAX})`
      );
    }

    // Check for corruption indicators (NaN, Infinity)
    if (!Number.isFinite(positionSize)) {
      errors.push(`Position size is not a valid finite number: ${positionSize}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      metadata: {
        positionSize,
        symbol,
        rules: VALIDATION_RULES.POSITION_SIZE
      }
    };
  }
}

// Export singleton instance
export const validationGateway = new ValidationGateway();

// Export for testing
export { ValidationGateway };
