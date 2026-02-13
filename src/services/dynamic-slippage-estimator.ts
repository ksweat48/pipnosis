/**
 * Dynamic Slippage Estimation Engine (TIER 3 FIX)
 *
 * SSOT Authority: Estimates expected slippage for trade execution
 *
 * Governance:
 * - Validates: Provides slippage estimates based on market conditions
 * - Alpha Decides: Uses estimates to adjust entry zones and risk calculations
 * - Degrades Intelligently: Returns conservative estimates if data unavailable
 *
 * CCIP Compliance: Non-breaking advisory system, does not block trades
 *
 * Factors Considered:
 * 1. Market Volatility (ATR-based)
 * 2. Session Timing (London/NY overlaps = lower slippage)
 * 3. Symbol Liquidity Profile
 * 4. Order Size Impact
 */

import { logger } from '../lib/logger';
import { getCurrencyPipInfo } from '../utils/currencyHelpers';
import { getSymbolConfig } from '../config/symbol-registry';

export interface SlippageEstimate {
  estimatedPips: number;
  confidence: 'high' | 'medium' | 'low';
  factors: {
    volatility: 'low' | 'medium' | 'high';
    liquidity: 'high' | 'medium' | 'low';
    sessionTiming: 'optimal' | 'good' | 'poor';
    orderSizeImpact: 'minimal' | 'moderate' | 'significant';
  };
  recommendation: string;
  source: 'calculated' | 'conservative_fallback';
}

/**
 * TIER 3 FIX: Dynamic slippage estimation
 *
 * Estimates expected slippage in pips for trade execution.
 * Uses market conditions to provide realistic expectations.
 *
 * @param symbol Currency pair, crypto, index, or metal
 * @param orderSizePips Size of order in pips (SL distance as proxy)
 * @param atrValue Current ATR value (optional, for volatility assessment)
 * @returns SlippageEstimate with confidence and factors
 */
export function estimateSlippage(
  symbol: string,
  orderSizePips: number,
  atrValue?: number
): SlippageEstimate {
  try {
    // Get symbol configuration
    const symbolConfig = getSymbolConfig(symbol);
    const pipInfo = getCurrencyPipInfo(symbol);

    // 1. Assess volatility
    const volatility = assessVolatility(atrValue, orderSizePips, symbolConfig);

    // 2. Assess liquidity
    const liquidity = assessLiquidity(symbol, pipInfo.symbolType);

    // 3. Assess session timing
    const sessionTiming = assessSessionTiming();

    // 4. Assess order size impact
    const orderSizeImpact = assessOrderSizeImpact(orderSizePips, volatility);

    // Calculate base slippage from factors
    const baseSlippage = calculateBaseSlippage(
      volatility,
      liquidity,
      sessionTiming,
      orderSizeImpact,
      pipInfo.symbolType
    );

    // Determine confidence based on data availability
    const confidence = atrValue ? 'high' : 'medium';

    // Generate recommendation
    const recommendation = generateRecommendation(
      baseSlippage,
      volatility,
      liquidity,
      sessionTiming
    );

    logger.info('Dynamic slippage estimator: Calculated estimate', {
      symbol,
      estimatedPips: baseSlippage,
      confidence,
      volatility,
      liquidity,
      sessionTiming,
      orderSizeImpact
    });

    return {
      estimatedPips: baseSlippage,
      confidence,
      factors: {
        volatility,
        liquidity,
        sessionTiming,
        orderSizeImpact
      },
      recommendation,
      source: 'calculated'
    };

  } catch (error) {
    // Intelligent degradation: return conservative estimate
    logger.warn('Dynamic slippage estimator: Error calculating, using conservative fallback', {
      symbol,
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      estimatedPips: 3, // Conservative 3 pip estimate
      confidence: 'low',
      factors: {
        volatility: 'medium',
        liquidity: 'medium',
        sessionTiming: 'good',
        orderSizeImpact: 'moderate'
      },
      recommendation: 'Using conservative 3-pip slippage estimate due to data unavailability',
      source: 'conservative_fallback'
    };
  }
}

/**
 * Assess current market volatility
 */
function assessVolatility(
  atrValue: number | undefined,
  orderSizePips: number,
  symbolConfig: any
): 'low' | 'medium' | 'high' {
  if (!atrValue) {
    return 'medium'; // Unknown = assume medium
  }

  // Compare ATR to order size
  const atrRatio = atrValue / orderSizePips;

  if (atrRatio < 0.5) return 'low';
  if (atrRatio < 1.5) return 'medium';
  return 'high';
}

/**
 * Assess symbol liquidity profile
 */
function assessLiquidity(
  symbol: string,
  symbolType: string
): 'high' | 'medium' | 'low' {
  const normalized = symbol.toUpperCase();

  // High liquidity major pairs and instruments
  const highLiquidity = [
    'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF',
    'AUDUSD', 'USDCAD', 'NZDUSD',
    'BTCUSD', 'ETHUSD',
    'US30', 'SPX500', 'NAS100'
  ];

  // Medium liquidity crosses and popular instruments
  const mediumLiquidity = [
    'EURJPY', 'GBPJPY', 'EURGBP', 'AUDJPY',
    'EURAUD', 'GBPAUD', 'AUDNZD',
    'XAUUSD', 'XAGUSD',
    'SOLUSD', 'BNBUSD'
  ];

  if (highLiquidity.some(pair => normalized.includes(pair))) {
    return 'high';
  }

  if (mediumLiquidity.some(pair => normalized.includes(pair))) {
    return 'medium';
  }

  // Exotic pairs and less common instruments
  return 'low';
}

/**
 * Assess current session timing
 * London/NY overlap = optimal, single session = good, off-hours = poor
 */
function assessSessionTiming(): 'optimal' | 'good' | 'poor' {
  const now = new Date();
  const utcHour = now.getUTCHours();

  // London/NY overlap: 12:00-17:00 UTC (8am-12pm ET)
  if (utcHour >= 12 && utcHour < 17) {
    return 'optimal';
  }

  // London session: 7:00-16:00 UTC
  // NY session: 13:00-22:00 UTC
  if ((utcHour >= 7 && utcHour < 16) || (utcHour >= 13 && utcHour < 22)) {
    return 'good';
  }

  // Tokyo session or off-hours
  return 'poor';
}

/**
 * Assess order size impact on slippage
 */
function assessOrderSizeImpact(
  orderSizePips: number,
  volatility: 'low' | 'medium' | 'high'
): 'minimal' | 'moderate' | 'significant' {
  // Larger stops suggest larger position size, more slippage

  // Adjust thresholds by volatility
  const smallThreshold = volatility === 'high' ? 30 : volatility === 'medium' ? 20 : 15;
  const largeThreshold = volatility === 'high' ? 80 : volatility === 'medium' ? 60 : 40;

  if (orderSizePips < smallThreshold) return 'minimal';
  if (orderSizePips < largeThreshold) return 'moderate';
  return 'significant';
}

/**
 * Calculate base slippage estimate from all factors
 */
function calculateBaseSlippage(
  volatility: 'low' | 'medium' | 'high',
  liquidity: 'high' | 'medium' | 'low',
  sessionTiming: 'optimal' | 'good' | 'poor',
  orderSizeImpact: 'minimal' | 'moderate' | 'significant',
  symbolType: string
): number {
  // Base slippage by asset type
  let baseSlippage = symbolType === 'crypto' ? 5 : symbolType === 'index' ? 3 : 2;

  // Volatility multiplier
  const volatilityMultiplier = {
    low: 0.7,
    medium: 1.0,
    high: 1.5
  }[volatility];

  // Liquidity adjustment
  const liquidityAdjustment = {
    high: 0,
    medium: 0.5,
    low: 1.5
  }[liquidity];

  // Session timing adjustment
  const sessionAdjustment = {
    optimal: -0.5,
    good: 0,
    poor: 1.0
  }[sessionTiming];

  // Order size adjustment
  const sizeAdjustment = {
    minimal: 0,
    moderate: 0.5,
    significant: 1.5
  }[orderSizeImpact];

  // Calculate total
  const totalSlippage =
    (baseSlippage * volatilityMultiplier) +
    liquidityAdjustment +
    sessionAdjustment +
    sizeAdjustment;

  // Round to 1 decimal place and ensure minimum of 0.5 pips
  return Math.max(0.5, Math.round(totalSlippage * 10) / 10);
}

/**
 * Generate actionable recommendation
 */
function generateRecommendation(
  slippagePips: number,
  volatility: 'low' | 'medium' | 'high',
  liquidity: 'high' | 'medium' | 'low',
  sessionTiming: 'optimal' | 'good' | 'poor'
): string {
  if (slippagePips <= 1.5 && sessionTiming === 'optimal') {
    return 'Excellent execution conditions - minimal slippage expected';
  }

  if (slippagePips <= 2.5 && liquidity === 'high') {
    return 'Good execution conditions - normal slippage expected';
  }

  if (volatility === 'high' || sessionTiming === 'poor') {
    return 'Elevated slippage risk - consider wider entry zones or wait for better conditions';
  }

  if (liquidity === 'low') {
    return 'Lower liquidity pair - account for wider spreads in execution';
  }

  return 'Moderate slippage expected - standard execution conditions';
}

/**
 * Get slippage adjustment for entry zones
 * Returns additional pips to add to entry zones to account for slippage
 */
export function getSlippageAdjustmentForEntry(estimate: SlippageEstimate): number {
  // Add 1.5x the estimated slippage to entry zones for safety margin
  return Math.ceil(estimate.estimatedPips * 1.5);
}
