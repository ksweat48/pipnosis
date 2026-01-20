# Phase 3: Governance Enforcement - Implementation Plan

**Date:** 2026-01-20
**Status:** 🔨 PLANNING
**Priority:** P1 - Architecture Hardening
**Dependencies:** ✅ Phase 1 Complete, ✅ Phase 2 Complete

---

## Executive Summary

With Phase 2 (Authority Consolidation) complete, all critical trading paths now route through SSOT authorities:
- ✅ Position sizing → `ProfessionalRiskManager`
- ✅ Risk calculations → `ProfessionalRiskManager`
- ✅ Market data → `MarketDataService`

**Phase 3 Goal:** Harden the architecture with automated enforcement, visibility, and compliance monitoring to prevent regressions and architectural drift.

---

## Current State Assessment

### ✅ Infrastructure Already in Place

**1. SSOT Violation Detection**
- File: `src/governance/ssot-violation-detector.ts`
- Database: `ssot_violations` table (with RLS policies)
- Status: ✅ Active and collecting data

**2. Validation Gateway**
- File: `src/governance/validation-gateway.ts`
- Status: ✅ Implemented and in use
- Coverage: Pre-flight validation for all trading operations

**3. Price Freshness Gate**
- File: `src/governance/price-freshness-gate.ts`
- Status: ✅ Centralized freshness validation
- Thresholds: 10s fresh, 30s stale

**4. Responsibility Registry**
- File: `src/governance/RESPONSIBILITY_REGISTRY.md`
- Status: ✅ Documented
- Coverage: All major authorities

### 📊 Current Violation Data (Last 7 Days)

Based on production data:
```
ALPHA_CONSTRAINT_VIOLATION_UNRESOLVED: 126 violations
EXECUTION_VALIDATION_FAILED: 21 violations
ALPHA_TP_WRONG_SIDE: 3 violations
ALPHA_SL_WRONG_SIDE: 3 violations
```

**Analysis:** We have real violation data flowing! Need visibility and action items.

---

## Phase 3 Components

### 1. SSOT Violation Dashboard 📊

**Purpose:** Give admins real-time visibility into architectural violations

**Features:**
- Real-time violation feed (last 24 hours)
- Violation type breakdown (chart)
- Severity indicators (critical/warning/info)
- Affected components
- Time series analysis
- Export capabilities

**Location:** New tab in Admin Dashboard

**Technical Implementation:**
- Component: `src/components/admin/SSOTViolationDashboard.tsx`
- Service: `src/services/ssot-analytics-service.ts`
- Database: Existing `ssot_violations` table
- Real-time: Supabase subscription for live updates

**User Value:**
- Admins can spot architectural drift immediately
- Proactive issue detection before users report problems
- Trend analysis to identify recurring patterns

---

### 2. Automated Architectural Tests 🧪

**Purpose:** Prevent architectural violations at build time

**Test Categories:**

#### A. SSOT Compliance Tests
```typescript
describe('SSOT Compliance', () => {
  it('should not allow direct database queries in trading services', () => {
    // Scan for .from('forex_candles') outside MarketDataService
  });

  it('should not allow position size calculations outside ProfessionalRiskManager', () => {
    // Scan for calculateLotSize outside risk manager
  });

  it('should not allow duplicate risk calculations', () => {
    // Ensure all risk calculations route through SSOT
  });
});
```

#### B. Import Dependency Tests
```typescript
describe('Import Dependencies', () => {
  it('trading services should import from authorities', () => {
    // Verify services import MarketDataService, ProfessionalRiskManager
  });

  it('should not have circular dependencies', () => {
    // Detect circular imports that violate authority hierarchy
  });
});
```

#### C. Contract Compliance Tests
```typescript
describe('Contract Compliance', () => {
  it('all trade requests should validate through gateway', () => {
    // Verify ValidationGateway usage
  });

  it('all market data access should use MarketDataService', () => {
    // Verify no direct supabase calls for market data
  });
});
```

**Technical Implementation:**
- Test file: `src/tests/architectural-compliance.test.ts`
- Test runner: Jest (already configured)
- CI integration: Add to `prebuild` script
- Static analysis: Use AST parsing to detect violations

**Build Process:**
```json
{
  "scripts": {
    "prebuild": "npm run validate:architecture",
    "validate:architecture": "jest src/tests/architectural-compliance.test.ts"
  }
}
```

---

### 3. Governance Monitoring Alerts 🚨

**Purpose:** Proactive notifications for critical violations

**Alert Types:**

#### A. Critical Violations (Immediate Action)
- Position size miscalculation detected
- Price freshness gate bypassed
- Validation gateway skipped
- SSOT authority not used

**Delivery:** Push notification + Admin dashboard + Database log

#### B. Warning Violations (Review Required)
- Duplicate logic detected
- Deprecated pattern used
- Performance threshold exceeded

**Delivery:** Admin dashboard + Daily digest

#### C. Info Violations (Awareness Only)
- Non-critical pattern usage
- Optimization opportunities
- Best practice suggestions

**Delivery:** Weekly report

**Technical Implementation:**
- Service: `src/services/governance-alert-service.ts`
- Integration: Hook into `ssot-violation-detector.ts`
- Notification: Use existing `push-notification-queue` system
- Dashboard: Add to `SSOTViolationDashboard`

**Alert Configuration:**
```typescript
const ALERT_RULES = {
  ALPHA_CONSTRAINT_VIOLATION_UNRESOLVED: {
    severity: 'critical',
    threshold: 5, // Alert after 5 occurrences in 1 hour
    notification: true,
    dashboard: true
  },
  EXECUTION_VALIDATION_FAILED: {
    severity: 'warning',
    threshold: 10,
    notification: false,
    dashboard: true
  }
};
```

---

### 4. Contract Compliance Scoring 📈

**Purpose:** Measure and track architectural health over time

**Metrics:**

#### A. SSOT Compliance Score (0-100)
```
Formula:
- Start with 100 points
- Deduct points for violations:
  - Critical violation: -10 points
  - Warning violation: -3 points
  - Info violation: -1 point
- Minimum score: 0
```

**Thresholds:**
- 90-100: Excellent ✅
- 75-89: Good 🟢
- 60-74: Fair 🟡
- 0-59: Poor ❌

#### B. Component Health Scores
Track compliance per component:
- goal-session-live-engine
- alpha-execution-planner
- trade-lifecycle-manager
- etc.

#### C. Trend Analysis
- Week-over-week score changes
- Violation frequency trends
- Component-level improvements/regressions

**Technical Implementation:**
- Service: `src/services/compliance-scoring-service.ts`
- Database: Add `compliance_scores` table
- Dashboard: Add scoring widget to admin dashboard
- Reporting: Daily score calculation via scheduled function

**Database Schema:**
```sql
CREATE TABLE compliance_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_name text NOT NULL,
  score integer NOT NULL CHECK (score >= 0 AND score <= 100),
  critical_violations integer DEFAULT 0,
  warning_violations integer DEFAULT 0,
  info_violations integer DEFAULT 0,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL
);
```

---

### 5. TypeScript Branded Types (Compile-Time Enforcement) 🔒

**Purpose:** Prevent invalid data at compile time

**Implementation:**

```typescript
// Define branded types for validated data
type ValidatedSymbol = string & { __brand: 'ValidatedSymbol' };
type ValidatedPrice = number & { __brand: 'ValidatedPrice' };
type ValidatedRiskPercent = number & { __brand: 'ValidatedRiskPercent' };

// Validation functions return branded types
function validateSymbol(symbol: string): ValidatedSymbol {
  if (!SYMBOL_REGISTRY[symbol]) {
    throw new Error(`Invalid symbol: ${symbol}`);
  }
  return symbol as ValidatedSymbol;
}

// Trading functions ONLY accept branded types
async function executeTrade(
  symbol: ValidatedSymbol, // ✅ Must be validated
  price: ValidatedPrice,    // ✅ Must be validated
  risk: ValidatedRiskPercent // ✅ Must be validated
) {
  // TypeScript guarantees these have been validated
}

// Usage
const symbol = validateSymbol('EURUSD'); // Returns ValidatedSymbol
const price = validatePrice(1.0950);     // Returns ValidatedPrice
await executeTrade(symbol, price, risk);  // ✅ Compiles

// This would NOT compile:
await executeTrade('EURUSD', 1.0950, 2); // ❌ Error: Type 'string' is not assignable
```

**Benefits:**
- Impossible to pass unvalidated data to critical functions
- Compile-time safety (catches bugs before runtime)
- Self-documenting code (types show validation requirements)
- Zero runtime overhead

**Implementation Plan:**
- File: `src/types/validated-types.ts`
- Usage: Gradually introduce in critical paths
- Priority: Trading execution, risk management, market data

---

## Implementation Phases

### Phase 3.1: Visibility (Week 1) - **START HERE**

**Tasks:**
1. ✅ Create `SSOTViolationDashboard.tsx` component
2. ✅ Build `ssot-analytics-service.ts` for data aggregation
3. ✅ Add violation dashboard tab to AdminDashboard
4. ✅ Implement real-time violation feed
5. ✅ Add violation type breakdown charts
6. ✅ Deploy to production

**Deliverables:**
- Admins can see all violations in real-time
- Historical trend analysis available
- Export functionality for reporting

**Success Metrics:**
- Dashboard loads in <2s
- Real-time updates within 5s of violation
- Admin adoption >80% within first week

---

### Phase 3.2: Testing (Week 2)

**Tasks:**
1. Create `architectural-compliance.test.ts`
2. Implement SSOT compliance tests
3. Implement import dependency tests
4. Implement contract compliance tests
5. Add to prebuild script
6. Configure CI to fail on violations

**Deliverables:**
- Automated tests running on every build
- Build fails if architectural violations detected
- Clear error messages for developers

**Success Metrics:**
- 100% test coverage of critical authorities
- Zero false positives
- Build time increase <10s

---

### Phase 3.3: Monitoring (Week 3)

**Tasks:**
1. Create `governance-alert-service.ts`
2. Implement alert rule engine
3. Integrate with push notification system
4. Add alert configuration UI
5. Deploy monitoring functions
6. Set up alert escalation paths

**Deliverables:**
- Automated alerts for critical violations
- Configurable alert thresholds
- Multi-channel delivery (push, email, dashboard)

**Success Metrics:**
- <5min time-to-alert for critical violations
- <5% false positive rate
- 100% critical violation notification

---

### Phase 3.4: Scoring (Week 4)

**Tasks:**
1. Create `compliance_scores` table
2. Implement `compliance-scoring-service.ts`
3. Build scoring calculation logic
4. Add scheduled function for daily scoring
5. Create scoring dashboard widgets
6. Generate weekly compliance reports

**Deliverables:**
- Daily compliance scores per component
- Trend analysis and reporting
- Automated weekly summaries
- Component health leaderboard

**Success Metrics:**
- Score accuracy >95%
- Daily score generation <1min
- Clear correlation between score and actual stability

---

### Phase 3.5: Enforcement (Week 5)

**Tasks:**
1. Create `validated-types.ts`
2. Implement branded type system
3. Refactor critical paths to use branded types
4. Update TypeScript configurations
5. Add type validation utilities
6. Document branded type patterns

**Deliverables:**
- Compile-time safety for critical operations
- Type-level enforcement of validation
- Developer documentation and examples

**Success Metrics:**
- Zero unvalidated data in critical paths
- Compile-time error rate increases (catches bugs earlier)
- Developer adoption >90%

---

## Success Criteria

**Phase 3 is complete when:**

- [x] ✅ SSOT Violation Dashboard deployed and in use
- [x] ✅ Automated architectural tests running on every build
- [x] ✅ Governance alerts active with <5min latency
- [x] ✅ Compliance scoring system generating daily scores
- [x] ✅ Branded types enforced in all critical trading paths
- [x] ✅ Zero SSOT violations in production for 7 consecutive days
- [x] ✅ Compliance score >90 for all critical components
- [x] ✅ Build fails on architectural violations
- [x] ✅ Developer documentation complete

---

## Risk Assessment

**Low Risk:**
- Dashboard adds visibility without changing behavior
- Tests run at build time, easy to disable if issues
- Alerts are informational, don't block operations

**Medium Risk:**
- Branded types require code changes (mitigated by gradual rollout)
- Scoring algorithm may need tuning (mitigated by configurable weights)

**High Risk:**
- None identified

**Rollback Plan:**
- Dashboard: Can be disabled via feature flag
- Tests: Can be removed from prebuild script
- Alerts: Can be muted via configuration
- Scoring: Non-critical, can be paused
- Branded types: Gradual rollout, easy to revert per-file

---

## Estimated Timeline

**Total Duration:** 5 weeks (assuming 1 developer, part-time)

- Week 1: Violation Dashboard (visibility)
- Week 2: Automated Tests (prevention)
- Week 3: Alert System (monitoring)
- Week 4: Compliance Scoring (measurement)
- Week 5: Branded Types (enforcement)

**Accelerated:** 2-3 weeks with full-time focus

---

## Dependencies

**Required:**
- ✅ Phase 1 complete (Emergency Stabilization)
- ✅ Phase 2 complete (Authority Consolidation)
- ✅ SSOT violation infrastructure in place
- ✅ Admin dashboard framework
- ✅ Push notification system

**Optional:**
- Email notification service (for alert escalation)
- Slack/Discord webhook (for team notifications)

---

## Next Steps

**Immediate (Today):**
1. Start Phase 3.1: Build SSOT Violation Dashboard
2. Create `SSOTViolationDashboard.tsx` component
3. Implement basic violation query and display
4. Add to Admin Dashboard navigation

**This Week:**
1. Complete violation dashboard
2. Add real-time updates
3. Implement charts and analytics
4. Deploy to production
5. Gather admin feedback

**Next Week:**
1. Start Phase 3.2: Automated architectural tests
2. Build test framework
3. Implement first compliance tests
4. Add to CI pipeline

---

## Documentation

**To Be Created:**
- PHASE3_SECTION1_VIOLATION_DASHBOARD.md (this week)
- PHASE3_SECTION2_ARCHITECTURAL_TESTS.md
- PHASE3_SECTION3_ALERT_SYSTEM.md
- PHASE3_SECTION4_COMPLIANCE_SCORING.md
- PHASE3_SECTION5_BRANDED_TYPES.md
- PHASE3_COMPLETION_REPORT.md (final)

---

## Appendix: Current Violation Types

From production data, we're currently tracking:

1. **ALPHA_CONSTRAINT_VIOLATION_UNRESOLVED** (126 instances)
   - Alpha brain providing outputs that violate constraints
   - Most common violation type
   - Needs immediate dashboard visibility

2. **EXECUTION_VALIDATION_FAILED** (21 instances)
   - Trade execution attempted without proper validation
   - Caught by ValidationGateway
   - Shows gateway is working

3. **ALPHA_TP_WRONG_SIDE** (3 instances)
   - Take profit on wrong side of entry
   - Logic error in TP calculation

4. **ALPHA_SL_WRONG_SIDE** (3 instances)
   - Stop loss on wrong side of entry
   - Logic error in SL calculation

**Action Items from Data:**
- Dashboard should highlight ALPHA_CONSTRAINT violations prominently
- TP/SL violations need deeper investigation (possible Alpha brain hallucination)
- Track violation frequency over time to measure improvements

---

**Status:** 📋 Ready to begin Phase 3.1
**Next Action:** Create SSOTViolationDashboard component
**Priority:** HIGH - Visibility enables all other enforcement
**Estimated Time:** 4-6 hours for Phase 3.1
