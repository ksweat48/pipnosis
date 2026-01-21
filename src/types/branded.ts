/**
 * Branded Types for Compile-Time Safety
 *
 * TypeScript branded types that make it impossible to pass unvalidated
 * data to critical functions at compile time.
 *
 * Benefits:
 * - Zero runtime overhead (types are erased at compile time)
 * - Impossible to accidentally pass raw data
 * - Clear distinction between validated and unvalidated data
 * - Self-documenting code
 * - Prevents entire classes of bugs
 *
 * Part of Phase 3.5: TypeScript Safety Enforcement
 */

// =====================================================
// Brand Definition
// =====================================================

/**
 * Brand symbol - unique symbol for each brand
 */
declare const brand: unique symbol;

/**
 * Branded type - adds compile-time brand to a base type
 */
export type Branded<T, TBrand extends string> = T & {
  readonly [brand]: TBrand;
};

// =====================================================
// Validation Result Types
// =====================================================

/**
 * Validated price - has passed freshness and sanity checks
 */
export type ValidatedPrice = Branded<number, 'ValidatedPrice'>;

/**
 * Validated position size - has passed risk management checks
 */
export type ValidatedPositionSize = Branded<number, 'ValidatedPositionSize'>;

/**
 * Validated stop loss - has passed placement validation
 */
export type ValidatedStopLoss = Branded<number, 'ValidatedStopLoss'>;

/**
 * Validated take profit - has passed placement validation
 */
export type ValidatedTakeProfit = Branded<number, 'ValidatedTakeProfit'>;

/**
 * Validated symbol - has passed symbol validation
 */
export type ValidatedSymbol = Branded<string, 'ValidatedSymbol'>;

/**
 * Validated user ID - has passed authentication
 */
export type ValidatedUserId = Branded<string, 'ValidatedUserId'>;

/**
 * Validated account balance - has passed balance verification
 */
export type ValidatedBalance = Branded<number, 'ValidatedBalance'>;

/**
 * Validated trade parameters - complete validated trade request
 */
export type ValidatedTradeParams = Branded<
  {
    symbol: ValidatedSymbol;
    direction: 'BUY' | 'SELL';
    positionSize: ValidatedPositionSize;
    stopLoss: ValidatedStopLoss;
    takeProfit: ValidatedTakeProfit;
    userId: ValidatedUserId;
    balance: ValidatedBalance;
  },
  'ValidatedTradeParams'
>;

/**
 * Fresh market data - has passed freshness validation
 */
export type FreshMarketData = Branded<
  {
    symbol: string;
    price: number;
    timestamp: Date;
    source: string;
  },
  'FreshMarketData'
>;

/**
 * Validated risk parameters - passed risk checks
 */
export type ValidatedRiskParams = Branded<
  {
    riskAmount: number;
    riskPercentage: number;
    maxDrawdown: number;
    positionSize: number;
  },
  'ValidatedRiskParams'
>;

// =====================================================
// Brand Creation Functions
// =====================================================

/**
 * Create branded value (use with caution - only after validation!)
 */
function createBrand<T, TBrand extends string>(
  value: T
): Branded<T, TBrand> {
  return value as Branded<T, TBrand>;
}

/**
 * Extract raw value from branded type (use with caution!)
 */
export function unwrapBrand<T, TBrand extends string>(
  branded: Branded<T, TBrand>
): T {
  return branded as T;
}

// =====================================================
// Validation Functions (Brand Creators)
// =====================================================

/**
 * Validate and brand a price
 * Only call this after passing through ValidationGateway!
 */
export function brandValidatedPrice(price: number): ValidatedPrice {
  return createBrand<number, 'ValidatedPrice'>(price);
}

/**
 * Validate and brand a position size
 * Only call this after passing through ProfessionalRiskManager!
 */
export function brandValidatedPositionSize(size: number): ValidatedPositionSize {
  return createBrand<number, 'ValidatedPositionSize'>(size);
}

/**
 * Validate and brand a stop loss
 * Only call this after validation!
 */
export function brandValidatedStopLoss(sl: number): ValidatedStopLoss {
  return createBrand<number, 'ValidatedStopLoss'>(sl);
}

/**
 * Validate and brand a take profit
 * Only call this after validation!
 */
export function brandValidatedTakeProfit(tp: number): ValidatedTakeProfit {
  return createBrand<number, 'ValidatedTakeProfit'>(tp);
}

/**
 * Validate and brand a symbol
 * Only call this after symbol validation!
 */
export function brandValidatedSymbol(symbol: string): ValidatedSymbol {
  return createBrand<string, 'ValidatedSymbol'>(symbol);
}

/**
 * Validate and brand a user ID
 * Only call this after authentication!
 */
export function brandValidatedUserId(userId: string): ValidatedUserId {
  return createBrand<string, 'ValidatedUserId'>(userId);
}

/**
 * Validate and brand an account balance
 * Only call this after balance verification!
 */
export function brandValidatedBalance(balance: number): ValidatedBalance {
  return createBrand<number, 'ValidatedBalance'>(balance);
}

/**
 * Validate and brand complete trade parameters
 * Only call this after ValidationGateway approval!
 */
export function brandValidatedTradeParams(params: {
  symbol: ValidatedSymbol;
  direction: 'BUY' | 'SELL';
  positionSize: ValidatedPositionSize;
  stopLoss: ValidatedStopLoss;
  takeProfit: ValidatedTakeProfit;
  userId: ValidatedUserId;
  balance: ValidatedBalance;
}): ValidatedTradeParams {
  return createBrand<typeof params, 'ValidatedTradeParams'>(params);
}

/**
 * Validate and brand fresh market data
 * Only call this after freshness gate approval!
 */
export function brandFreshMarketData(data: {
  symbol: string;
  price: number;
  timestamp: Date;
  source: string;
}): FreshMarketData {
  return createBrand<typeof data, 'FreshMarketData'>(data);
}

/**
 * Validate and brand risk parameters
 * Only call this after risk validation!
 */
export function brandValidatedRiskParams(params: {
  riskAmount: number;
  riskPercentage: number;
  maxDrawdown: number;
  positionSize: number;
}): ValidatedRiskParams {
  return createBrand<typeof params, 'ValidatedRiskParams'>(params);
}

// =====================================================
// Type Guards
// =====================================================

/**
 * Check if a value is a branded type (runtime check)
 * Note: This is primarily for documentation - brands are compile-time only
 */
export function isBranded<T, TBrand extends string>(
  value: any
): value is Branded<T, TBrand> {
  // At runtime, branded types are indistinguishable from their base types
  // This is a no-op but helps with type narrowing
  return true;
}

// =====================================================
// Example Usage Patterns
// =====================================================

/**
 * CORRECT USAGE:
 *
 * // 1. Validate data
 * const validationResult = await validationGateway.validate(rawPrice);
 *
 * // 2. Brand validated data
 * const validatedPrice = brandValidatedPrice(validationResult.price);
 *
 * // 3. Pass branded data to critical function
 * executeTrade(validatedPrice); // ✅ TypeScript allows this
 *
 *
 * INCORRECT USAGE:
 *
 * // 1. Try to pass raw data directly
 * const rawPrice = 1.0850;
 * executeTrade(rawPrice); // ❌ TypeScript error: Type 'number' is not assignable to type 'ValidatedPrice'
 *
 * // 2. Try to brand without validation
 * const fakeValidated = brandValidatedPrice(rawPrice); // ⚠️ Compiles but violates contract!
 *
 *
 * BEST PRACTICE:
 *
 * // Keep validation and branding together in authority functions
 * async function validateAndBrandPrice(raw: number): Promise<ValidatedPrice> {
 *   const result = await validationGateway.validate(raw);
 *   if (!result.valid) {
 *     throw new Error('Validation failed');
 *   }
 *   return brandValidatedPrice(result.price);
 * }
 */

// =====================================================
// Utility Types
// =====================================================

/**
 * Extract the base type from a branded type
 */
export type UnwrapBrand<T> = T extends Branded<infer U, any> ? U : T;

/**
 * Check if a type is branded
 */
export type IsBranded<T> = T extends Branded<any, any> ? true : false;

/**
 * Make all properties of an object branded
 */
export type BrandAll<T, TBrand extends string> = {
  [K in keyof T]: Branded<T[K], TBrand>;
};

// =====================================================
// Documentation Comments
// =====================================================

/**
 * IMPORTANT NOTES FOR DEVELOPERS:
 *
 * 1. ZERO RUNTIME COST
 *    - Branded types are erased at compile time
 *    - No performance impact whatsoever
 *    - Pure compile-time safety
 *
 * 2. WHEN TO USE BRANDS
 *    - After validation gateway approval
 *    - After risk management calculations
 *    - After authentication checks
 *    - After freshness validation
 *    - Anywhere you want compile-time guarantees
 *
 * 3. WHERE TO BRAND
 *    - In authority services (ValidationGateway, ProfessionalRiskManager, etc.)
 *    - At validation boundaries
 *    - NOT in application logic
 *
 * 4. MIGRATION STRATEGY
 *    - Start with critical paths (trade execution)
 *    - Gradually expand to other areas
 *    - Update function signatures to require brands
 *    - Let TypeScript guide the refactoring
 *
 * 5. BENEFITS
 *    - Impossible to accidentally use raw data
 *    - Self-documenting (types show validation requirements)
 *    - Compile-time enforcement (catches bugs before runtime)
 *    - Forces proper architecture (validation at boundaries)
 *
 * 6. LIMITATIONS
 *    - Only compile-time safety (can be bypassed with 'as' casts)
 *    - Requires discipline (don't brand without validation)
 *    - May require more verbose code initially
 *    - Team must understand the pattern
 *
 * 7. ENFORCEMENT
 *    - Use ESLint rules to detect improper branding
 *    - Code reviews should check brand usage
 *    - Architectural tests can verify branded types are used
 *
 * 8. ALTERNATIVES CONSIDERED
 *    - Classes with private constructors (runtime overhead)
 *    - Validation decorators (runtime overhead)
 *    - Wrapper objects (runtime overhead + complexity)
 *    - Branded types win: zero cost + compile-time safety
 */
