/**
 * COORDINATORS INDEX - Single Source of Truth Services
 *
 * Export all coordinator services from a single entry point.
 * These coordinators enforce SSOT patterns across the codebase.
 */

export {
  goalSessionStateMachine,
  type GoalSessionStatus,
  type StateTransitionResult,
  type TransitionMetadata,
} from './goal-session-state-machine';

export {
  goalAchievementCoordinator,
  type GoalCheckResult,
  type GoalContext,
} from './goal-achievement-coordinator';

export {
  tradeClosureCoordinator,
  type CloseReason,
  type CloseTradeRequest,
  type CloseTradeResult,
} from './trade-closure-coordinator';

export {
  notificationCoordinator,
  type NotificationType,
  type NotificationPriority,
  type NotificationRequest,
  type NotificationResult,
} from './notification-coordinator';

export {
  priceCoordinator,
  type PriceData,
  type PriceFetchOptions,
  type PriceFetchResult,
} from './price-coordinator';
