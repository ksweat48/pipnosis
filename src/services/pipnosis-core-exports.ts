/**
 * Pipnosis Core System Exports
 *
 * Central export point for the refactored LLM-as-Brain + Local Memory architecture.
 */

export { PIPNOSIS_CORE_RULES, PipnosisCoreRules, pipnosisRules } from '../lib/pipnosis-core-rules';

export {
  localMemoryLayer,
  type LocalTrade,
  type LocalSessionMetrics,
  type LocalGoalProgress,
  type SessionSummary
} from './local-memory-layer';

export {
  llmStrategyBrain,
  type MarketSnapshot,
  type GoalContext,
  type RelevantHistory,
  type LLMTradeDecision,
  type LLMProviderConfig
} from './llm-strategy-brain';

export {
  marketSnapshotBuilder
} from './market-snapshot-builder';

export {
  supabaseSummaryWriter,
  type WrittenSummary
} from './supabase-summary-writer';

export {
  countdownNotificationSystem,
  type CountdownNotification,
  type ExecutionAdjustment
} from './countdown-notification-system';

export {
  smartGoalSessionManager,
  type SmartGoalConfig,
  type SmartGoalSession
} from './smart-goal-session-manager';

export {
  localBacktestEngine,
  type LocalBacktestConfig,
  type BacktestProgress
} from './local-backtest-engine';

export {
  shortTermMarketScanner,
  type ShortTermOpportunity
} from './short-term-market-scanner';
