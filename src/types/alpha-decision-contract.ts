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

export type AlphaAction = 'EXECUTE_NOW' | 'WAIT' | 'PASS';
export type AlphaUrgency = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AlphaEntryPlan {
  /** Entry zone boundaries - price must reach this zone */
  entryZone: {
    minPrice: number;
    maxPrice: number;
  };

  /** Invalidation zone - if price enters here, thesis is invalidated */
  invalidationZone: {
    minPrice: number;
    maxPrice: number;
  };

  /** Maximum time to wait for entry (seconds) */
  timeoutSeconds: number;

  /** Urgency level - affects monitoring frequency */
  urgency: AlphaUrgency;
}

export interface AlphaExecutionPolicy {
  /** Whether Entry Optimizer can auto-execute when conditions met */
  allowAutoExecute: boolean;

  /** Whether to recheck with Alpha before executing (for complex setups) */
  requireRecheckBeforeExecute: boolean;
}

export interface AlphaWaitDecision {
  entryPlan: AlphaEntryPlan;
  executionPolicy: AlphaExecutionPolicy;
}

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
  /** Alpha's final decision */
  action: AlphaAction;

  /** Alpha's reasoning for this decision */
  reasoning: string;

  /** Final confidence after all penalties (0-100) */
  confidence: number;

  /** If WAIT: entry plan and execution policy */
  waitDecision?: AlphaWaitDecision;

  /** Trade parameters (for EXECUTE_NOW or WAIT) */
  tradeSpec: AlphaTradeSpec;

  /** Market context that informed decision */
  marketContext?: {
    atr?: number;
    spread?: number;
    volatility?: string;
    regime?: string;
    [key: string]: any;
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
  if (!['EXECUTE_NOW', 'WAIT', 'PASS'].includes(contract.action)) return false;
  if (typeof contract.reasoning !== 'string') return false;
  if (typeof contract.confidence !== 'number' || contract.confidence < 0 || contract.confidence > 100) return false;

  // Check tradeSpec
  if (!contract.tradeSpec || typeof contract.tradeSpec !== 'object') return false;
  const spec = contract.tradeSpec;
  if (typeof spec.symbol !== 'string') return false;
  if (!['BUY', 'SELL'].includes(spec.direction)) return false;
  if (typeof spec.entry !== 'number' || spec.entry <= 0) return false;
  if (typeof spec.stopLoss !== 'number' || spec.stopLoss <= 0) return false;
  if (typeof spec.takeProfit !== 'number' || spec.takeProfit <= 0) return false;

  // Check waitDecision if action is WAIT
  if (contract.action === 'WAIT') {
    if (!contract.waitDecision || typeof contract.waitDecision !== 'object') return false;
    const wait = contract.waitDecision;

    if (!wait.entryPlan || typeof wait.entryPlan !== 'object') return false;
    if (!wait.executionPolicy || typeof wait.executionPolicy !== 'object') return false;

    const plan = wait.entryPlan;
    if (!plan.entryZone || typeof plan.entryZone.minPrice !== 'number' || typeof plan.entryZone.maxPrice !== 'number') return false;
    if (!plan.invalidationZone || typeof plan.invalidationZone.minPrice !== 'number' || typeof plan.invalidationZone.maxPrice !== 'number') return false;
    if (typeof plan.timeoutSeconds !== 'number' || plan.timeoutSeconds <= 0) return false;
    if (!['HIGH', 'MEDIUM', 'LOW'].includes(plan.urgency)) return false;

    const policy = wait.executionPolicy;
    if (typeof policy.allowAutoExecute !== 'boolean') return false;
    if (typeof policy.requireRecheckBeforeExecute !== 'boolean') return false;
  }

  return true;
}

/**
 * Create a standard EXECUTE_NOW contract
 */
export function createExecuteNowContract(
  tradeSpec: AlphaTradeSpec,
  confidence: number,
  reasoning: string,
  marketContext?: Record<string, any>
): AlphaDecisionContract {
  return {
    action: 'EXECUTE_NOW',
    reasoning,
    confidence,
    tradeSpec,
    marketContext,
    decidedAt: new Date()
  };
}

/**
 * Create a standard WAIT contract
 */
export function createWaitContract(
  tradeSpec: AlphaTradeSpec,
  confidence: number,
  reasoning: string,
  entryPlan: AlphaEntryPlan,
  executionPolicy: AlphaExecutionPolicy,
  marketContext?: Record<string, any>
): AlphaDecisionContract {
  return {
    action: 'WAIT',
    reasoning,
    confidence,
    tradeSpec,
    waitDecision: {
      entryPlan,
      executionPolicy
    },
    marketContext,
    decidedAt: new Date()
  };
}

/**
 * Create a standard PASS contract
 */
export function createPassContract(
  reasoning: string,
  confidence: number = 0
): AlphaDecisionContract {
  // PASS requires minimal tradeSpec (not used)
  return {
    action: 'PASS',
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
