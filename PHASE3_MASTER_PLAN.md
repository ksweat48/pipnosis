# Phase 3: Complete SSOT Consolidation & Advanced Enforcement - Master Plan

**Status:** PLANNING
**Date:** January 22, 2026
**Priority:** HIGH
**CCIP Stage:** System Map

---

## Situation Analysis

We currently have **TWO parallel tracks** in progress:

### Track A: SSOT Consolidation (Phase 2 Sections 3-4)
**Status:** 50% Complete (2 of 4 sections done)
**Remaining Work:**
- Section 3: Risk Calculation consolidation (2 violations deferred)
- Section 4: Market Data consolidation (16 services identified)

### Track B: Governance Enforcement (Phase 3.4-3.5)
**Status:** 60% Complete (3 of 5 sections done)
**Remaining Work:**
- Phase 3.4: Compliance Scoring & Daily Reports
- Phase 3.5: TypeScript Branded Types (compile-time enforcement)

---

## Phase 3 Unified Strategy

**Goal:** Complete both tracks to achieve full SSOT compliance and advanced enforcement.

**Approach:** Sequential implementation prioritizing highest impact work first.

---

## Phase 3 Structure

### 🎯 Phase 3.1: Complete SSOT Consolidation (HIGH PRIORITY)

**Sections:**
1. ✅ Section 1: Position Sizing (Already Complete)
2. ✅ Section 2: Trade Validation (Already Complete)
3. 🔨 Section 3: Risk Calculation (Deferred Fixes)
4. 🔨 Section 4: Market Data Consolidation

**Estimated Time:** 8-12 hours total
**Impact:** Eliminate remaining 18 SSOT violations
**Priority:** HIGH - Foundation for enforcement

---

### 🎯 Phase 3.2: Governance Advanced Enforcement (MEDIUM PRIORITY)

**Sections:**
1. ✅ Phase 3.1: Violation Dashboard (Complete)
2. ✅ Phase 3.2: Architectural Tests (Complete)
3. ✅ Phase 3.3: Monitoring & Alerts (Complete)
4. 🔨 Phase 3.4: Compliance Scoring & Reporting
5. 🔨 Phase 3.5: TypeScript Branded Types

**Estimated Time:** 6-8 hours total
**Impact:** Automated compliance tracking and compile-time safety
**Priority:** MEDIUM - Enhancement layer

---

## Recommended Execution Order

### Priority 1: Complete Phase 2 Section 3 (Risk Calculation)
**Why First:**
- Small scope (2 violations)
- Test improvements already deployed
- Clear architectural decision needed
- Quick win to close out Phase 2

**Time:** 2-3 hours
**Impact:** Closes architectural gaps

---

### Priority 2: Implement Phase 2 Section 4 (Market Data)
**Why Second:**
- High impact (16 violations)
- Critical for data consistency
- Foundation for future features
- Clear SSOT authority exists

**Time:** 6-9 hours
**Impact:** Massive consolidation, eliminates most remaining violations

---

### Priority 3: Implement Phase 3.4 (Compliance Scoring)
**Why Third:**
- Tracks progress from Priority 1 & 2
- Provides metrics on improvements
- Automated reporting to stakeholders
- Foundation for continuous improvement

**Time:** 3-4 hours
**Impact:** Visibility into compliance trends

---

### Priority 4: Implement Phase 3.5 (Branded Types)
**Why Last:**
- Requires stable SSOT foundation (from Priority 1 & 2)
- Compile-time safety is final enforcement layer
- Most advanced feature
- Prevents future regressions

**Time:** 3-4 hours
**Impact:** Compile-time guarantees, zero runtime overhead

---

## Phase 3.1: SSOT Consolidation Details

### Section 3: Risk Calculation Fixes

**Current State:**
- 2 services use simplified position sizing for estimations
- goal-feasibility-resolver.ts (feasibility calculations)
- goal-session-live-engine.ts (goal amount estimations)

**Options:**
1. **Create EstimationRiskCalculator** (Recommended)
   - Separate service for pre-trade estimations
   - Simplified, synchronous logic
   - Clear separation from execution
   - Time: 2 hours

2. **Add Estimation Mode to ProfessionalRiskManager**
   - Add `estimationMode` parameter
   - Skip expensive calculations
   - Maintain SSOT but add complexity
   - Time: 1.5 hours

3. **Document as Valid Exceptions**
   - Update architectural test to allow
   - Clear marking as estimations
   - Risk of drift over time
   - Time: 0.5 hours

**Recommendation:** Option 1 (EstimationRiskCalculator)
- Clear separation of concerns
- Fast, synchronous estimations
- No risk to execution path
- Easy to test independently

---

### Section 4: Market Data Consolidation

**Current State:**
- 16 services bypass MarketDataService
- Direct forex_candles queries scattered across codebase
- No centralized caching strategy
- Inconsistent data access patterns

**Violations:**
1. aggregator-health-monitor.ts
2. cache-warming-service.ts
3. chart-data-guarantor.ts
4. concurrent-bulk-loader.ts
5. coordinators/price-coordinator.ts
6. daily-narrative-builder.ts
7. emergency-price-poller.ts
8. gap-monitoring-service.ts
9. goal-session-manager.ts
10. historical-backfill-service.ts
11. historical-data-monitor.ts
12. kraken-backfill-service.ts
13. market-snapshot-cache.ts
14. position-monitor.ts
15. trade-lifecycle-manager.ts
16. wick-reconstruction-service.ts

**Strategy:**

**Phase 1: Enhance MarketDataService API (1-2 hours)**
- Add missing methods for complex queries
- Bulk operations for backfill services
- Gap detection queries
- Health check queries
- Aggregation methods

**Phase 2: Categorize by Complexity (0.5 hours)**
- **Low:** Simple SELECT queries (8 services) - 1 hour each
- **Medium:** Queries with filtering (5 services) - 1.5 hours each
- **High:** Backfill/write operations (3 services) - 2 hours each

**Phase 3: Create BackfillService (1-2 hours)**
- Separate write operations from reads
- Backfill-specific methods
- Historical data operations
- Used by: historical-backfill-service, kraken-backfill-service

**Phase 4: Refactor Services Incrementally (3-6 hours)**
- Start with low-complexity services
- Deploy and monitor after each batch
- Fix high-traffic services next
- Backfill services last

**Total Estimated Time:** 6-9 hours

---

## Phase 3.2: Advanced Enforcement Details

### Phase 3.4: Compliance Scoring & Reporting

**Goal:** Automated daily compliance tracking with trend analysis

**Components:**

1. **Database Infrastructure** (1 hour)
   - `compliance_scores` table (daily snapshots)
   - `compliance_trends` table (historical analysis)
   - `compliance_reports` table (weekly/monthly summaries)
   - Scheduled functions for daily calculation

2. **Compliance Calculator Service** (1.5 hours)
   - Daily score calculation
   - Component-level scores
   - Platform-wide score
   - Trend detection
   - Regression alerts

3. **Reporting Dashboard** (1 hour)
   - Daily compliance cards
   - 30-day trend charts
   - Component scorecard
   - Weekly summary generation
   - Export functionality

4. **Automated Reports** (0.5 hours)
   - Daily Slack/email summary
   - Weekly executive report
   - Monthly compliance review
   - Regression notifications

**Total Time:** 3-4 hours

---

### Phase 3.5: TypeScript Branded Types

**Goal:** Compile-time enforcement of validated data

**Concept:**
```typescript
// Before: Runtime only validation
function executeTrade(params: TradeParams) {
  const validated = tradeValidationService.validate(params);
  if (!validated.valid) throw new Error();
  // ... execute
}

// After: Compile-time guarantee
function executeTrade(params: ValidatedTradeParams) {
  // params MUST come from validation service
  // Impossible to pass unvalidated data
  // ... execute
}

// Usage
const params = await tradeValidationService.validate(input);
// params is now ValidatedTradeParams (branded type)
executeTrade(params); // ✅ Compiles
executeTrade(input); // ❌ Compile error: wrong type
```

**Components:**

1. **Branded Type System** (1 hour)
   - Define branded types
   - Validation service returns branded types
   - Type guards for runtime checks
   - Documentation

2. **Core Type Updates** (1.5 hours)
   - ValidatedTradeParams
   - ValidatedPrice
   - ValidatedSymbol
   - ValidatedRiskParams
   - AuthorizedUserId

3. **Service Updates** (1 hour)
   - Update function signatures
   - Use branded types throughout
   - Remove redundant validation
   - Update tests

4. **Documentation** (0.5 hours)
   - Usage guide
   - Migration guide
   - Best practices
   - Examples

**Total Time:** 3-4 hours

---

## Success Criteria

### Phase 3.1 (SSOT Consolidation)
- [ ] Zero position sizing violations
- [ ] Zero market data access violations
- [ ] All services use SSOT authorities
- [ ] Architectural compliance tests pass
- [ ] No performance degradation

### Phase 3.2 (Advanced Enforcement)
- [ ] Daily compliance scores calculated
- [ ] Automated reports delivered
- [ ] Branded types implemented
- [ ] Compile-time safety enforced
- [ ] Zero new SSOT violations possible

---

## Risk Assessment

### Low Risk
- Phase 2 Section 3 (small scope, estimation logic)
- Phase 3.4 (additive, monitoring only)

### Medium Risk
- Phase 2 Section 4 (large refactor, but clear patterns)
- Phase 3.5 (type system changes, but compile-time caught)

### Mitigation
- Incremental deployment
- Service-by-service rollout
- Comprehensive testing
- Rollback plan ready

---

## Deployment Strategy

### Stage 1: Complete Section 3 (Quick Win)
- Implement EstimationRiskCalculator
- Update 2 services
- Deploy and verify
- **Duration:** 1 session

### Stage 2: Begin Section 4 (Incremental)
- Enhance MarketDataService
- Refactor low-complexity services (batch 1: 4 services)
- Deploy and monitor
- **Duration:** 1 session

### Stage 3: Continue Section 4
- Refactor medium-complexity services (batch 2: 5 services)
- Deploy and monitor
- **Duration:** 1 session

### Stage 4: Complete Section 4
- Create BackfillService
- Refactor high-complexity services (batch 3: 3 services)
- Deploy and monitor
- **Duration:** 1 session

### Stage 5: Implement Phase 3.4
- Build compliance scoring system
- Deploy automated reports
- **Duration:** 1 session

### Stage 6: Implement Phase 3.5
- Implement branded type system
- Update all services
- Deploy final enforcement
- **Duration:** 1 session

**Total Duration:** 6 focused sessions

---

## Expected Outcomes

### By End of Phase 3

**SSOT Compliance:**
- Position Sizing: 100% ✅
- Trade Validation: 100% ✅
- Risk Calculation: 100% (currently 67%)
- Market Data: 100% (currently 0%)

**Overall Platform SSOT:** 100% ✅

**Enforcement:**
- Runtime violation detection: ✅ (Phase 1)
- Build-time architectural tests: ✅ (Phase 3.2)
- Real-time monitoring: ✅ (Phase 3.3)
- Daily compliance scoring: ✅ (Phase 3.4)
- Compile-time safety: ✅ (Phase 3.5)

**Governance Maturity:** Level 5 (Optimizing)
- Continuous compliance tracking
- Automated enforcement
- Zero regression possibility
- Proactive issue detection

---

## Recommendation

**START WITH:** Phase 3.1, Section 3 (Risk Calculation fixes)
- Small scope (2 services)
- Quick win to close out Phase 2
- Clear architectural decision
- 2-3 hours total

**THEN:** Phase 3.1, Section 4 (Market Data consolidation)
- High impact (16 services)
- Incremental deployment
- 6-9 hours over multiple sessions

**FINALLY:** Phase 3.2 (Advanced Enforcement)
- Build on stable SSOT foundation
- Add monitoring and compile-time safety
- 6-8 hours total

---

## Phase 3 Timeline

**Week 1:**
- Day 1: Complete Section 3 (Risk Calculation)
- Day 2-3: Begin Section 4 (Market Data - Batches 1-2)

**Week 2:**
- Day 1: Complete Section 4 (Market Data - Batch 3)
- Day 2: Implement Phase 3.4 (Compliance Scoring)
- Day 3: Implement Phase 3.5 (Branded Types)

**Total:** ~15-20 hours over 2 weeks

---

## Next Action

**IMMEDIATE:** Implement Phase 3.1, Section 3 (Risk Calculation)
- Create EstimationRiskCalculator service
- Update goal-feasibility-resolver.ts
- Update goal-session-live-engine.ts
- Deploy and verify
- **Time:** 2-3 hours

---

**Phase 3 Status:** READY TO BEGIN
**First Target:** Risk Calculation Consolidation
**Expected Completion:** 2-3 weeks for full Phase 3
**Final Outcome:** 100% SSOT compliance with advanced enforcement
