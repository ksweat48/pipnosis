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

**VIOLATIONS TO FIX:**
- ❌ Duplicate freshness checks in `goal-session-live-engine.ts`
- ❌ Duplicate freshness checks in `entry-execution-coordinator.ts`
- ❌ Multiple services reading `realtime_prices` table directly

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

### 📈 Trade Execution & Lifecycle

| Responsibility | Authority Service | Location |
|---|---|---|
| **Trade execution** | `TradeExecutionEngine` | `src/services/trade-execution-engine.ts` |
| **Trade validation** | `ValidationGateway` + `TradeValidationService` | Multiple |
| **Trade closure** | `TradeClosureCoordinator` | `src/services/coordinators/trade-closure-coordinator.ts` |
| **Position monitoring** | `PositionMonitor` | `src/services/position-monitor.ts` |

### 🎯 Session & Goal Management

| Responsibility | Authority Service | Location |
|---|---|---|
| **Session lifecycle** | `SessionManagementService` | `src/services/session-management-service.ts` |
| **Goal achievement tracking** | `GoalAchievementCoordinator` | `src/services/coordinators/goal-achievement-coordinator.ts` |
| **Session timeout enforcement** | Database triggers | `supabase/migrations/*.sql` |

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

**Last Updated:** 2026-01-20
**Maintained By:** Architecture Team
**Review Frequency:** Weekly during governance implementation
