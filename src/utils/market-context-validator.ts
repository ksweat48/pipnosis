/**
 * Market Context Validator - SINGLE SOURCE OF TRUTH
 *
 * This is the AUTHORITATIVE schema definition for market_context.
 * ALL market_context objects must conform to snake_case field names.
 *
 * CRITICAL: This prevents field name mismatches between creation and consumption.
 * The bug we're fixing: stopLoss/takeProfit (camelCase) created but stop_loss/take_profit (snake_case) expected.
 *
 * Architecture: This validator is the SSOT for:
 * - TypeScript type definitions
 * - Runtime validation
 * - Field name enforcement
 * - Database schema compliance
 */

/**
 * Market Context Schema - SSOT Type Definition
 *
 * CRITICAL: All fields MUST be snake_case to match database column naming conventions.
 *
 * Used by:
 * - entry_intents.market_context (JSONB column)
 * - Entry execution coordinator
 * - Entry monitor coordinator
 * - Entry planner
 */
export interface MarketContextSchema {
  // Core trade parameters
  symbol: string;
  price: number;
  confidence: number;

  // Risk management (MUST be snake_case)
  stop_loss: number;
  take_profit: number;
  risk_dollars?: number;

  // Dual TP system (MUST be snake_case)
  tp1_price?: number | null;
  tp1_confidence?: number | null;
  tp1_reasoning?: string | null;
  tp2_price?: number | null;
  tp2_reasoning?: string | null;

  // Omega summary (MUST be snake_case)
  omega_summary?: string;

  // Entry metadata (MUST be snake_case)
  original_entry?: number;

  // Allow additional fields for extensibility
  [key: string]: any;
}

/**
 * Validation Result
 */
export interface MarketContextValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  corrected?: MarketContextSchema;
}

/**
 * Forbidden camelCase field names that should be snake_case
 * This list is the CONTRACT between frontend and database
 */
const FORBIDDEN_CAMEL_CASE_FIELDS = [
  'stopLoss',      // Must be: stop_loss
  'takeProfit',    // Must be: take_profit
  'riskDollars',   // Must be: risk_dollars
  'tp1Price',      // Must be: tp1_price
  'tp1Confidence', // Must be: tp1_confidence
  'tp1Reasoning',  // Must be: tp1_reasoning
  'tp2Price',      // Must be: tp2_price
  'tp2Reasoning',  // Must be: tp2_reasoning
  'omegaSummary',  // Must be: omega_summary
  'originalEntry', // Must be: original_entry
];

/**
 * Required fields that must be present
 */
const REQUIRED_FIELDS = ['symbol', 'price', 'confidence', 'stop_loss', 'take_profit'];

/**
 * Validate market context object against SSOT schema
 *
 * Checks:
 * 1. Required fields present
 * 2. No forbidden camelCase fields
 * 3. Field types are correct
 * 4. stop_loss and take_profit are valid numbers
 *
 * @param marketContext The market context object to validate
 * @param throwOnError If true, throws error on validation failure (default: false)
 * @returns Validation result with errors and warnings
 */
export function validateMarketContext(
  marketContext: any,
  throwOnError: boolean = false
): MarketContextValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Defensive: Handle null/undefined
  if (!marketContext || typeof marketContext !== 'object') {
    errors.push('market_context is null, undefined, or not an object');
    if (throwOnError) {
      throw new Error(`[Market Context Validator] ${errors.join('; ')}`);
    }
    return { valid: false, errors, warnings };
  }

  // Check for forbidden camelCase fields
  const foundCamelCaseFields = FORBIDDEN_CAMEL_CASE_FIELDS.filter(
    field => field in marketContext
  );

  if (foundCamelCaseFields.length > 0) {
    errors.push(
      `Forbidden camelCase fields detected: ${foundCamelCaseFields.join(', ')}. ` +
      `Must use snake_case for database compatibility.`
    );
  }

  // Check for required fields
  const missingFields = REQUIRED_FIELDS.filter(field => !(field in marketContext));

  if (missingFields.length > 0) {
    errors.push(`Missing required fields: ${missingFields.join(', ')}`);
  }

  // Type validation for critical fields
  if (marketContext.stop_loss !== undefined && typeof marketContext.stop_loss !== 'number') {
    errors.push(`stop_loss must be a number (got ${typeof marketContext.stop_loss})`);
  }

  if (marketContext.take_profit !== undefined && typeof marketContext.take_profit !== 'number') {
    errors.push(`take_profit must be a number (got ${typeof marketContext.take_profit})`);
  }

  if (marketContext.confidence !== undefined && typeof marketContext.confidence !== 'number') {
    errors.push(`confidence must be a number (got ${typeof marketContext.confidence})`);
  }

  // Logical validation: stop_loss and take_profit should be different from entry price
  if (
    marketContext.price &&
    marketContext.stop_loss &&
    marketContext.stop_loss === marketContext.price
  ) {
    warnings.push('stop_loss equals entry price (0 pip stop loss)');
  }

  if (
    marketContext.price &&
    marketContext.take_profit &&
    marketContext.take_profit === marketContext.price
  ) {
    warnings.push('take_profit equals entry price (0 pip take profit)');
  }

  // Log validation results in development
  if (import.meta.env.DEV && (errors.length > 0 || warnings.length > 0)) {
    console.group('%c[Market Context Validator]', 'color: #ff9800; font-weight: bold');
    if (errors.length > 0) {
      console.error('%cValidation Errors:', 'color: #f44336; font-weight: bold');
      errors.forEach(err => console.error(`  ❌ ${err}`));
    }
    if (warnings.length > 0) {
      console.warn('%cValidation Warnings:', 'color: #ff9800; font-weight: bold');
      warnings.forEach(warn => console.warn(`  ⚠️ ${warn}`));
    }
    console.groupEnd();
  }

  if (errors.length > 0 && throwOnError) {
    throw new Error(`[Market Context Validator] ${errors.join('; ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Attempt to auto-correct camelCase fields to snake_case
 *
 * IMPORTANT: This is a MIGRATION helper only. New code should never create camelCase fields.
 *
 * @param marketContext The market context object to correct
 * @returns Corrected market context with snake_case fields
 */
export function autoCorrectMarketContext(marketContext: any): MarketContextSchema {
  const corrected: any = { ...marketContext };

  // Map camelCase to snake_case
  const fieldMappings: Record<string, string> = {
    stopLoss: 'stop_loss',
    takeProfit: 'take_profit',
    riskDollars: 'risk_dollars',
    tp1Price: 'tp1_price',
    tp1Confidence: 'tp1_confidence',
    tp1Reasoning: 'tp1_reasoning',
    tp2Price: 'tp2_price',
    tp2Reasoning: 'tp2_reasoning',
    omegaSummary: 'omega_summary',
    originalEntry: 'original_entry',
  };

  let correctionsMade = false;

  for (const [camelCase, snakeCase] of Object.entries(fieldMappings)) {
    if (camelCase in corrected && !(snakeCase in corrected)) {
      corrected[snakeCase] = corrected[camelCase];
      delete corrected[camelCase];
      correctionsMade = true;

      if (import.meta.env.DEV) {
        console.warn(
          `[Market Context Auto-Correct] Converted ${camelCase} → ${snakeCase}`,
          corrected[snakeCase]
        );
      }
    }
  }

  if (correctionsMade && import.meta.env.DEV) {
    console.log('%c[Market Context Auto-Correct] Corrections applied', 'color: #4caf50; font-weight: bold');
  }

  return corrected as MarketContextSchema;
}

/**
 * Type guard to check if object conforms to MarketContextSchema
 *
 * Usage:
 * ```typescript
 * if (isMarketContext(obj)) {
 *   // TypeScript now knows obj is MarketContextSchema
 *   const sl = obj.stop_loss;
 * }
 * ```
 */
export function isMarketContext(obj: any): obj is MarketContextSchema {
  const validation = validateMarketContext(obj, false);
  return validation.valid;
}

/**
 * Create a validated market context object
 *
 * This is the RECOMMENDED way to create market_context objects.
 * Ensures all required fields are present and correctly formatted.
 *
 * @param params Market context parameters
 * @returns Validated market context object
 */
export function createMarketContext(params: {
  symbol: string;
  price: number;
  confidence: number;
  stop_loss: number;
  take_profit: number;
  risk_dollars?: number;
  tp1_price?: number | null;
  tp1_confidence?: number | null;
  tp1_reasoning?: string | null;
  tp2_price?: number | null;
  tp2_reasoning?: string | null;
  omega_summary?: string;
  original_entry?: number;
  [key: string]: any;
}): MarketContextSchema {
  const marketContext: MarketContextSchema = {
    symbol: params.symbol,
    price: params.price,
    confidence: params.confidence,
    stop_loss: params.stop_loss,
    take_profit: params.take_profit,
    ...(params.risk_dollars !== undefined && { risk_dollars: params.risk_dollars }),
    ...(params.tp1_price !== undefined && { tp1_price: params.tp1_price }),
    ...(params.tp1_confidence !== undefined && { tp1_confidence: params.tp1_confidence }),
    ...(params.tp1_reasoning !== undefined && { tp1_reasoning: params.tp1_reasoning }),
    ...(params.tp2_price !== undefined && { tp2_price: params.tp2_price }),
    ...(params.tp2_reasoning !== undefined && { tp2_reasoning: params.tp2_reasoning }),
    ...(params.omega_summary !== undefined && { omega_summary: params.omega_summary }),
    ...(params.original_entry !== undefined && { original_entry: params.original_entry }),
  };

  // Include any additional fields
  for (const [key, value] of Object.entries(params)) {
    if (!(key in marketContext)) {
      marketContext[key] = value;
    }
  }

  // Validate before returning
  validateMarketContext(marketContext, true);

  return marketContext;
}
