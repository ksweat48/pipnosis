# Responsibility Registry - SSOT Authority Map

**PURPOSE:** This document defines which service is the SINGLE SOURCE OF TRUTH (authority) for each domain.

**ENFORCEMENT:** All other services MUST call the authority. Duplicate logic is an architectural violation.

**VERSION:** 1.0.0 (Governance Architecture Implementation)

---

## Core Principles

1. **Single Authority**: Each responsibility has ONE authoritative service
2. **No Duplication**: Logic must NOT be duplicated in other services
3. **Call, Don't Copy**: Services call authorities, never copy their logic
4. **Fail Loudly**: Violations should be detected and reported automatically

---

## Authority Map

### 🔐 Validation & Governance

| Responsibility | Authority Service | Location |
|---|---|---|
| **Pre-flight validation** | `ValidationGateway` | `src/governance/validation-gateway.ts` |
| **Price freshness checks** | `PriceFreshnessGate` | `src/governance/price-freshness-gate.ts` |
| **SSOT violation detection** | `SSOTViolationDetector` | `src/governance/ssot-violation-detector.ts` |
| **Trade processing locks** | `TradeProcessingLockService` | `src/services/trade-processing-lock-service.ts` |

**TRADE PROCESSING LOCKS (CCIP-20260130-002):**
- ✅ SSOT Authority for "is this trade being processed"
- ✅ Prevents duplicate trade closures across 3 monitoring systems
- ✅ Database-backed locks (30s TTL, auto-cleanup every 60s)
- ✅ All monitoring systems MUST acquire lock before closing trades
- ✅ Governance logging: All lock operations logged to `governance_change_log`

### 💰 Position Sizing & Risk

| Responsibility | Authority Service | Location |
|---|---|---|
| **Position size calculation** | `ProfessionalRiskManager` | `src/services/professional-risk-manager.ts` |
| **Risk percentage determination** | `ProfessionalRiskManager` | `src/services/professional-risk-manager.ts` |
| **Stop loss validation** | `ProfessionalRiskManager` | `src/services/professional-risk-manager.ts` |
| **Asset class risk profiles** | `getAssetClassRiskProfile()` | `src/config/asset-class-risk-profiles.ts` |
| **Currency pip calculations** | `getCurrencyPipInfo()` | `src/utils/currencyHelpers.ts` |

**VIOLATIONS TO FIX:**
- ❌ Database trigger `validate_lot_size_before_insert` (remove business logic)
- ❌ Duplicate position sizing in `goal-session-live-engine.ts`
- ❌ Duplicate risk checks in `trade-execution-engine.ts`

### 📊 Market Data & Prices

| Responsibility | Authority Service | Location |
|---|---|---|
| **Price freshness validation** | `PriceFreshnessGate` | `src/governance/price-freshness-gate.ts` |
| **Real-time price fetching** | `PriceCoordinator` | `src/services/coordinators/price-coordinator.ts` |
| **Price data caching** | `MarketSnapshotCache` | `src/services/market-snapshot-cache.ts` |
| **Candle data retrieval** | `CandleDataService` | `src/services/candle-data-service.ts` |
| **Realtime prices schema (SSOT)** | Database migration 20251224101143 | `supabase/migrations/` |

**REALTIME_PRICES TABLE - CANONICAL SCHEMA:**
- ✅ Use `mid` for price (NOT `price`)
- ✅ Use `created_at` for timestamp (NOT `updated_at`)
- ✅ Use `bid, ask` for spread components
- ❌ NEVER create alias columns (`price`, `updated_at`)
- ❌ NEVER add computed columns that duplicate existing data

**ENFORCEMENT:**
- All services MUST query canonical columns (`mid`, `created_at`)
- Database is SSOT - consumers adapt to it, NOT vice versa
- If a bug can be fixed in multiple places, the architecture is wrong

**VIOLATIONS FIXED:**
- ✅ Removed generated `price` column (was duplicate of `mid`)
- ✅ Removed generated `updated_at` column (was duplicate of `created_at`)
- ✅ Updated `price-freshness-gate.ts` to use canonical columns

**REMAINING VIOLATIONS TO FIX:**
- ❌ Duplicate freshness checks in `goal-session-live-engine.ts`
- ❌ Duplicate freshness checks in `entry-execution-coordinator.ts`

### 🧠 AI & Intelligence

| Responsibility | Authority Service | Location |
|---|---|---|
| **Alpha thesis generation** | `CoordinatorAlpha` | `src/brains/coordinator-alpha.ts` |
| **Thesis caching** | `SharedIntelligenceCoordinator` | `src/services/shared-intelligence-coordinator.ts` |
| **Thesis immutability** | `ThesisImmutabilityGuard` | `src/services/thesis-immutability-guard.ts` |
| **Omega voting** | `OmegaCouncilValidationGate` | `src/services/omega-council-validation-gate.ts` |
| **Market regime detection** | `RegimeOracle` | `src/services/regime-oracle.ts` |

**VIOLATIONS TO FIX:**
- ❌ Unstable hash generation in cache key generator
- ❌ Duplicate regime detection logic

### 📊 Real-Time Intelligence & Probability

| Responsibility | Authority Service | Location |
|---|---|---|
| **Real-time probability calculation** | `RealTimeIntelligenceCalculator` | `netlify/functions/_shared/realtime-intelligence-calculator.ts` |
| **Indicator weighting** | `getIntelligentWeights()` | `src/config/intelligent-indicator-weights.ts` |
| **Session detection** | `getCurrentSession()` | `src/config/intelligent-indicator-weights.ts` |
| **Intelligence population** | `populate-session-intelligence` | `netlify/functions/populate-session-intelligence.ts` |

**CCIP COMPLIANCE (2026-01-29):**
- ✅ Replaced hardcoded session-based probabilities with real-time calculations
- ✅ Integrated intelligent indicator weighting (time/asset/regime aware)
- ✅ Removed duplicate `trading-session-monitor-service.ts` (SSOT violation)
- ✅ Shows only pairs ≥70% confidence threshold
- ✅ Updates every 3 minutes (was 2 hours)
- ✅ Calculates confidence from 8 technical indicators with intelligent weights

**VIOLATIONS FIXED:**
- ✅ Deleted `trading-session-monitor-service.ts` (duplicate session intelligence logic)
- ✅ Removed hardcoded confidence percentages (95%, 93%, 90%)
- ✅ Eliminated session window forecasts (replaced with RIGHT NOW calculations)

### 📈 Trade Execution & Lifecycle

| Responsibility | Authority Service | Location |
|---|---|---|
| **Trade execution** | `TradeExecutionEngine` | `src/services/trade-execution-engine.ts` |
| **Trade validation** | `ValidationGateway` + `TradeValidationService` | Multiple |
| **Trade closure** | `TradeClosureCoordinator` | `src/services/coordinators/trade-closure-coordinator.ts` |
| **Position monitoring** | `PositionMonitor` | `src/services/position-monitor.ts` |

### 🎯 Session & Goal Management

| Responsibility | Authority Service | Location | SSOT Table |
|---|---|---|---|
| **Session lifecycle** | `SessionManagementService` | `src/services/session-management-service.ts` | `goal_sessions` |
| **Session state (SSOT)** | **SessionStateAuthority** | `get_session_state()` RPC function | `goal_sessions` |
| **Scanning initialization** | **ScanningSystemAuthority** | `initialize_session_scanning()` RPC function | `goal_sessions` |
| **Status transition validation** | **SessionStateAuthority** | `validate_session_status_transition()` RPC function | `goal_session_audit_trail` |
| **Session health checks** | **SessionStateAuthority** | `check_goal_session_health()` RPC function | `goal_sessions` |
| **Goal achievement tracking** | `GoalAchievementCoordinator` | `src/services/coordinators/goal-achievement-coordinator.ts` | `goal_sessions` |
| **Session timeout enforcement** | **SessionTimeoutAuthority** | `supabase/migrations/20260130_*_ssot_compliant_stuck_session_fixes_*` | `goal_sessions` |
| **Entry intent lifecycle** | **EntryIntentAuthority** | `supabase/migrations/20260130_*_ssot_compliant_stuck_session_fixes_*` | `entry_intents` |
| **Trade closure & balance** | **TradeClosureCoordinator** | `supabase/migrations/20260130_*_ssot_compliant_stuck_session_fixes_*` | `goal_session_trades` |
| **Session audit trail** | Governance audit | `goal_session_audit_trail` table | `goal_session_audit_trail` |

**CCIP COMPLIANCE (2026-01-30 - Goal Sessions & Scanning Fix):**
- ✅ Added missing `scanning_duration_minutes` column to goal_sessions table
- ✅ Created `SessionStateAuthority` RPC functions (get_session_state, validate_status_transition, check_health)
- ✅ Created `ScanningSystemAuthority` RPC function (initialize_session_scanning)
- ✅ Created `goal_session_audit_trail` table for governance compliance
- ✅ Fixed RLS policies to allow proper session creation and updates
- ✅ Forced Supabase schema cache refresh via NOTIFY trigger
- ✅ All scanning operations logged to audit trail
- ✅ All sessions default to 60-minute scanning duration
- ✅ Session status transitions validated and logged
- ✅ Health checks available for debugging

**PREVIOUS CCIP COMPLIANCE (2026-01-30 - Stuck Sessions Fix):**
- ✅ Created `SessionTimeoutAuthority` for timeout logic (single source)
- ✅ Created `EntryIntentAuthority` for intent lifecycle
- ✅ Enhanced `TradeClosureCoordinator` with transaction support
- ✅ All state transitions logged to governance_change_log
- ✅ All functions have proper error handling with rollback
- ✅ Orphaned intents cleanup integrated into all session transitions
- ✅ Retry mechanism for failed balance updates

**REMOVED (2026-01-30):**
- ❌ 15-minute continuation modal system (unnecessary friction after shift to centralized caching)
- ❌ `ContinuationHandler`, `ContinuationDecisionCoordinator`, `ContinuationEntryStrategy` services
- ❌ Scanning remains interval-based (5 minutes) to prevent API hammering

### 🔔 Notifications & UI

| Responsibility | Authority Service | Location |
|---|---|---|
| **Notification routing** | `NotificationCoordinator` | `src/services/coordinators/notification-coordinator.ts` |
| **Modal queue management** | `ModalQueueManager` | `src/services/modal-queue-manager.ts` |
| **Push notifications** | `PushNotificationDispatcher` | `src/services/push-notification-dispatcher.ts` |

---

## Governance Rules

### Rule 1: Single Call Path
```typescript
// ✅ CORRECT: Call the authority
const positionSize = await professionalRiskManager.calculatePositionSize({
  symbol,
  stopLoss,
  entryPrice,
  accountBalance,
  riskPercentage
});

// ❌ WRONG: Duplicate the calculation
const dollarRisk = accountBalance * (riskPercentage / 100);
const pipValue = getCurrencyPipInfo(symbol).pipValue;
const stopDistancePips = Math.abs(entryPrice - stopLoss) / pipValue;
const positionSize = dollarRisk / (stopDistancePips * dollarPerPip);
```

### Rule 2: Validate Before Execute
```typescript
// ✅ CORRECT: Validate through gateway
const validation = validationGateway.validateTradeRequest(request);
if (!validation.isValid) {
  throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
}
const trade = await tradeExecutionEngine.execute(request);

// ❌ WRONG: Execute without validation
const trade = await tradeExecutionEngine.execute(request);
```

### Rule 3: Single Source of Configuration
```typescript
// ✅ CORRECT: Use centralized config
import { VALIDATION_RULES } from '../governance/validation-gateway';
if (positionSize > VALIDATION_RULES.POSITION_SIZE.MAX) {
  throw new Error('Position size too large');
}

// ❌ WRONG: Hardcode values
if (positionSize > 1000) {
  throw new Error('Position size too large');
}
```

---

## Migration Plan

### Phase 1: Emergency Fixes (Week 1)
- [x] Create ValidationGateway
- [x] Create PriceFreshnessGate
- [ ] Remove database business logic triggers
- [ ] Consolidate position sizing to ProfessionalRiskManager
- [ ] Fix thesis cache hash stability

### Phase 2: Authority Consolidation (Week 2)
- [ ] Refactor all services to call authorities
- [ ] Remove duplicate logic
- [ ] Add runtime violation detection
- [ ] Document remaining authorities

### Phase 3: Enforcement (Week 3)
- [ ] Build SSOT violation detector
- [ ] Add automated architectural tests
- [ ] Enforce contracts at compile time
- [ ] Add governance monitoring dashboard

### 💰 Credits & Payments

| Responsibility | Authority Service | Location | SSOT Table |
|---|---|---|---|
| **Credit balance (SSOT)** | **CreditManagementAuthority** | Database functions | `user_token_balance` |
| **Admin credit additions** | `admin_add_credits_to_user()` | `supabase/migrations/20260130_fix_credit_system_ssot_compliance_v2.sql` | `user_token_balance` |
| **New user credit signup** | `handle_new_user()` trigger | `supabase/migrations/20260130_fix_credit_system_ssot_compliance_v2.sql` | `user_token_balance` |
| **Credit audit trail** | Governance audit | `credit_transaction_audit` table | `credit_transaction_audit` |
| **Credit balance reading** | `CreditMeterService` | `src/services/credit-meter-service.ts` | `user_token_balance` |
| **Credit deduction on trade** | `CreditMeterService` | `src/services/credit-meter-service.ts` | `user_token_balance` |

**CCIP Compliance (2026-01-30 - Credit System Fix):**
- ✅ Created `CreditManagementAuthority` as SSOT for all credit changes
- ✅ Admin function fixed to work with RLS policies (was blocked by policy)
- ✅ New users receive 50 free credits on signup (verified and audited)
- ✅ All credit transactions logged to `credit_transaction_audit` table
- ✅ Governance compliance with full transaction history
- ✅ No duplicate credit management logic
- ✅ Admin can now successfully add credits to users

---

## Violation Detection

Services will be monitored for SSOT violations:

1. **Duplicate Logic Detection**: Static analysis to find copied code
2. **Direct Database Access**: Detect services bypassing coordinators
3. **Hardcoded Constants**: Find magic numbers that should use VALIDATION_RULES
4. **Multiple Authorities**: Detect when >1 service tries to own a responsibility

---

## Questions?

If unsure which service is the authority for a responsibility:
1. Check this registry first
2. Look for `SSOT` comments in code
3. Ask before creating new logic
4. When in doubt, add to ValidationGateway

---

**Last Updated:** 2026-01-29
**Maintained By:** Architecture Team
**Review Frequency:** Weekly during governance implementation
