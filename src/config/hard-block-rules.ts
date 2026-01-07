/**
 * HARD BLOCK RULES - Physics and Safety Only
 *
 * These are the ONLY conditions that may block trade execution.
 * Everything else is advisory with penalties.
 *
 * Core Principle: If the market can offer some profit, Alpha should take it.
 */

export type HardBlockCategory = 'PHYSICS' | 'DATA_INTEGRITY' | 'SAFETY';

export interface HardBlockRule {
  id: string;
  category: HardBlockCategory;
  description: string;
  checkFunction: string; // Reference to validation function
  rationale: string; // Why this is a hard block
}

export const HARD_BLOCK_RULES: HardBlockRule[] = [
  {
    id: 'MARKET_CLOSED',
    category: 'PHYSICS',
    description: 'Market is closed - no quotes available',
    checkFunction: 'checkMarketOpen',
    rationale: 'Cannot execute trades when market maker is offline. No liquidity.'
  },
  {
    id: 'DATA_STALE',
    category: 'DATA_INTEGRITY',
    description: 'Price data is stale (>5min old) - SSOT timestamp mismatch',
    checkFunction: 'checkDataFreshness',
    rationale: 'Trading on stale data violates SSOT and creates execution risk.'
  },
  {
    id: 'INVALID_STOP_LOSS',
    category: 'PHYSICS',
    description: 'Stop loss on wrong side of entry or zero-distance',
    checkFunction: 'validateStopLoss',
    rationale: 'Stop loss must protect capital. Wrong-side stops guarantee immediate loss.'
  },
  {
    id: 'SPREAD_EXCEEDS_PROFIT',
    category: 'PHYSICS',
    description: 'Spread + fees make any profit mathematically impossible',
    checkFunction: 'validateSpreadVsProfit',
    rationale: 'Cannot overcome transaction costs. Guaranteed loss trade.'
  },
  {
    id: 'NO_VALID_TP',
    category: 'PHYSICS',
    description: 'Cannot construct TP above noise floor',
    checkFunction: 'validateTPFeasibility',
    rationale: 'TP must be reachable above market noise. Unreachable TP = coin flip.'
  },
  {
    id: 'INVALID_POSITION_SIZE',
    category: 'SAFETY',
    description: 'Position size is zero, negative, or exceeds account balance',
    checkFunction: 'validatePositionSize',
    rationale: 'Cannot execute trades with invalid lot sizes. Broker will reject.'
  },
  {
    id: 'SYMBOL_INVALID',
    category: 'PHYSICS',
    description: 'Symbol does not exist or is not supported',
    checkFunction: 'validateSymbol',
    rationale: 'Cannot trade instruments that do not exist or are not configured.'
  }
];

/**
 * Check if a condition qualifies as a hard block
 */
export function isHardBlock(ruleId: string): boolean {
  return HARD_BLOCK_RULES.some(rule => rule.id === ruleId);
}

/**
 * Get hard block rule by ID
 */
export function getHardBlockRule(ruleId: string): HardBlockRule | undefined {
  return HARD_BLOCK_RULES.find(rule => rule.id === ruleId);
}

/**
 * Everything NOT in this list should be converted to:
 * - Confidence penalties
 * - Advisory warnings
 * - Reward adjustments
 * - Repair suggestions
 *
 * Examples of what is NOT a hard block:
 * - Session timing mismatch
 * - Style duration overrun
 * - Dead zone detection
 * - High volatility
 * - Low confidence
 * - Adversarial price action
 * - R:R below ideal
 * - Goal amount too large
 */
