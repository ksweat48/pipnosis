/**
 * Alpha Decision Contract - SSOT for Alpha's Final Trading Decisions
 *
 * This contract defines the structure of Alpha's decisions.
 * All components must honor Alpha's decision without blocking (except mandatory safety).
 *
 * ALPHA SOVEREIGNTY PRINCIPLE:
 * - Alpha is the ONLY trading decision maker
 * - Components serve Alpha's decisions, not judge them
 * - Only mandatory safety (margin, market closed, SSOT, format) can block
 */

export type AlphaAction = 'BUY' | 'SELL' | 'NO_TRADE';

// REMOVED: WAIT infrastructure
// AlphaUrgency, AlphaEntryPlan, AlphaExecutionPolicy, AlphaWaitDecision
// Alpha now returns BUY/SELL for immediate execution or NO_TRADE to continue scanning

export interface AlphaTradeSpec {
  symbol: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  stopLoss: number;
  takeProfit: number;

  /** Optional: Secondary take profit for scaling out */
  takeProfit2?: number;

  /** Trade style for duration tracking */
  style?: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';
}

/**
 * Alpha Decision Contract
 *
 * Every Alpha decision must conform to this structure.
 * Components must execute Alpha's will, not override it.
 */
export interface AlphaDecisionContract {
  /** Alpha's final decision: BUY, SELL, or NO_TRADE */
  action: AlphaAction;

  /** Alpha's reasoning for this decision */
  reasoning: string;

  /** Final confidence after all penalties (0-100) */
  confidence: number;

  /** Trade parameters (for BUY/SELL actions) */
  tradeSpec: AlphaTradeSpec;

  /** Market context that informed decision */
  marketContext?: {
    atr?: number;
    spread?: number;
    volatility?: string;
    regime?: string;
    [key: string]: any;
  };

  /**
   * Market assessment: Alpha's prediction of what the market can realistically give
   * SSOT for profit potential - used to set TP levels
   */
  marketAssessment?: {
    /** Minimum expected profit (conservative estimate) */
    predictedProfitMin: number;
    /** Maximum expected profit (optimistic estimate) */
    predictedProfitMax: number;
    /** Confidence in this assessment (0-100) */
    confidence: number;
    /** Why Alpha set this range */
    reasoning: string;
  };

  /** Timestamp of decision */
  decidedAt: Date;
}

/**
 * Validate Alpha Decision Contract structure
 * Does NOT validate trading viability - only structure
 */
export function validateAlphaContract(contract: any): contract is AlphaDecisionContract {
  if (!contract || typeof contract !== 'object') return false;

  // Check required fields
  if (!['BUY', 'SELL', 'NO_TRADE'].includes(contract.action)) return false;
  if (typeof contract.reasoning !== 'string') return false;
  if (typeof contract.confidence !== 'number' || contract.confidence < 0 || contract.confidence > 100) return false;

  // Check tradeSpec (required for BUY/SELL, minimal for NO_TRADE)
  if (!contract.tradeSpec || typeof contract.tradeSpec !== 'object') return false;
  const spec = contract.tradeSpec;

  // For BUY/SELL actions, validate full tradeSpec
  if (contract.action === 'BUY' || contract.action === 'SELL') {
    if (typeof spec.symbol !== 'string') return false;
    if (!['BUY', 'SELL'].includes(spec.direction)) return false;
    if (typeof spec.entry !== 'number' || spec.entry <= 0) return false;
    if (typeof spec.stopLoss !== 'number' || spec.stopLoss <= 0) return false;
    if (typeof spec.takeProfit !== 'number' || spec.takeProfit <= 0) return false;
  }

  return true;
}

/**
 * Create a standard BUY contract
 */
export function createBuyContract(
  tradeSpec: AlphaTradeSpec,
  confidence: number,
  reasoning: string,
  marketContext?: Record<string, any>
): AlphaDecisionContract {
  return {
    action: 'BUY',
    reasoning,
    confidence,
    tradeSpec: { ...tradeSpec, direction: 'BUY' },
    marketContext,
    decidedAt: new Date()
  };
}

/**
 * Create a standard SELL contract
 */
export function createSellContract(
  tradeSpec: AlphaTradeSpec,
  confidence: number,
  reasoning: string,
  marketContext?: Record<string, any>
): AlphaDecisionContract {
  return {
    action: 'SELL',
    reasoning,
    confidence,
    tradeSpec: { ...tradeSpec, direction: 'SELL' },
    marketContext,
    decidedAt: new Date()
  };
}

/**
 * Create a standard NO_TRADE contract
 */
export function createNoTradeContract(
  reasoning: string,
  confidence: number = 0
): AlphaDecisionContract {
  // NO_TRADE requires minimal tradeSpec (not used)
  return {
    action: 'NO_TRADE',
    reasoning,
    confidence,
    tradeSpec: {
      symbol: '',
      direction: 'BUY',
      entry: 0,
      stopLoss: 0,
      takeProfit: 0
    },
    decidedAt: new Date()
  };
}
