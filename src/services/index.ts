/**
 * Services Index - Export all service modules
 */

// SSOT Infrastructure - Single Source of Truth for Asset and Session Logic
export * from './asset-classifier';
export * from './session-constraint-coordinator';

// SSOT Trade Execution - Single Authority for Server-Side Trade Execution
// (moved to alpha-trade-executor.ts)

// Autonomous Pipnosis Alpha Services
export * from './ai-identity';
export * from './reward-engine';
export * from './llm-strategy-brain';
export * from './llm-execution-brain';
export * from './condition-monitor';
export * from './safety-enforcer';
export * from './performance-analyzer';
export * from './alpha-thought-stream';

// Platform Intelligence Services
export * from './platform-intelligence-service';

// Credit System Services
export * from './credit-validation-service';
export * from './credit-meter-service';

// Risk Management Services (SSOT - Single Source of Truth)
export * from './user-risk-preference-service';
export * from './risk-negotiation-auditor';

// CCIP Audit Services (Change Control Intelligence Protocol)
export * from './ccip-audit-wrapper';

// Balance Management Services
export * from './balance-initialization-authority';

// Scanning Cycle Services
export * from './scanning-state-machine';

// Entry Intent Services
export * from './entry-intent-monitor-mode';
export * from './llm-call-guard';

// Weekend Protection Services
export * from './weekend-protection-service';

// Elite TP System
export * from './profit-target-calculator';

// Critical Level Detection System
export * from './critical-level-detector';
export * from './trade-level-integration';

// Goal Feasibility and Audit System
export * from './goal-feasibility-resolver';
export * from './goal-feasibility-audit-logger';

// CCIP Governance: Goal Advisory and Risk Tolerance
export * from './goal-advisory-coordinator';
export * from './risk-tolerance-enforcer';

// Existing Services
export * from './openai-client';
export * from './database-service';
export * from './candle-data-service';
// export * from './simulated-trading'; // REMOVED: File doesn't exist - functionality moved to position-service
export * from './chart-data-guarantor';
