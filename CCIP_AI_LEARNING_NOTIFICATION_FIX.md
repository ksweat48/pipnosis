# CCIP: AI Learning & Notification Infrastructure Fix

**Date**: 2026-01-14
**Priority**: P0 - Critical
**Status**: In Progress

---

## 1. SYSTEM MAP

### Current State

**AI Learning System (BROKEN)**:
- ❌ 4 tables referenced in code but DON'T EXIST:
  - `ai_trade_analysis` (referenced in 10+ files)
  - `ai_market_scenario_performance`
  - `trade_learning_log`
  - `ai_global_confidence_calibration`
- ❌ Generates 400/404 errors on every trade
- ❌ AI cannot learn from trades
- ❌ User sees no AI insights

**Notification System (BROKEN)**:
- ❌ `goal_notifications` table has RLS enabled but NO INSERT policy
- ❌ Generates 403 Forbidden errors
- ❌ System diagnostics cannot create alerts
- ✅ Table structure exists
- ✅ Type constraint is correct (fixed in migration 20260113232615)

**WebSocket System (WORKING)**:
- ✅ Used for event-driven SL/TP monitoring
- ✅ Has proper fallback to polling
- ⚠️ Disconnections are expected and handled
- 📝 Not broken, just informative warnings

### Affected Files

**AI Learning** (10 files):
- `src/services/ai-learning-engine.ts` (primary)
- `src/services/ev-calculator.ts`
- `src/services/post-trade-analyzer.ts`
- `src/services/llm-context-enricher.ts`
- `src/services/performance-analyzer.ts`
- `src/services/continuous-learning-loop.ts`
- `src/services/global-intelligence-provider.ts`
- `src/services/session-intelligence-service.ts`
- `src/services/platform-intelligence-service.ts`
- `src/services/ai-learning-diagnostics.ts`

**Notifications** (11 files):
- `src/services/coordinators/notification-coordinator.ts` (SSOT)
- `src/services/entry-monitoring-notifications.ts`
- `src/services/goal-notifications.ts`
- 8 more files

---

## 2. LOGIC CONTRACT

### Phase 1: AI Learning Tables

**CREATE 4 Tables with SSOT Compliance**:

1. **ai_trade_analysis** - SSOT for trade learning data
   - Stores detailed analysis of each closed trade
   - Links to goal_session_trades via live_trade_id
   - Tracks patterns, lessons, confidence calibration

2. **ai_market_scenario_performance** - SSOT for scenario learning
   - Aggregates performance by market conditions
   - Tracks win rates per symbol, scenario, timeframe
   - Progressive learning (updates on each trade)

3. **trade_learning_log** - Event log of learning activities
   - Immutable audit trail of AI learning events
   - Tracks what AI learned from each trade
   - 2x weight for live trades vs backtests

4. **ai_global_confidence_calibration** - Platform-wide calibration
   - Shared across all users (public table, no user_id)
   - Tracks predicted vs actual win rates
   - Helps AI adjust confidence scores

**RLS Policies**:
- Users can SELECT/INSERT/UPDATE own data (user_id FK)
- Service role can access all data
- Global calibration table readable by all authenticated users

**Indexes**:
- Performance indexes on user_id, symbol, created_at
- Lookup indexes for pattern matching
- Composite indexes for aggregation queries

### Phase 2: Notification RLS Fix

**ADD Missing INSERT Policies to goal_notifications**:
- Authenticated users can insert own notifications
- Service role can insert all notifications
- Maintains existing SELECT/UPDATE policies

**Compatibility**:
- Does NOT change table structure
- Only adds missing policies
- Code already expects this behavior

---

## 3. DRY-RUN SIMULATION

### Migration Execution Order

1. **Create AI learning tables** (20260114_001000)
   - Creates 4 new tables
   - No existing data to migrate
   - No breaking changes
   - Code will immediately start working

2. **Fix notification RLS** (20260114_001001)
   - Adds 2 policies to existing table
   - No data changes
   - Existing policies unchanged
   - Code will immediately start working

### Expected Outcomes

**Before**:
```
[AI Learning Engine] Error inserting into ai_trade_analysis: 404 Not Found
[NotificationCoordinator] Failed to create notification: 403 Forbidden
```

**After**:
```
[AI Learning Engine] ✅ Trade analysis stored successfully
[AI Learning Engine] ✅ Learning insights extracted: 3 patterns identified
[NotificationCoordinator] ✅ Sent notification: stale_data_alert to user xyz
```

### Data Flow

```
Trade Closes → ai-learning-engine.ts
              ↓
         Analyze Trade
              ↓
    ai_trade_analysis (INSERT) ✅
              ↓
    Extract Patterns & Insights
              ↓
    ai_market_scenario_performance (UPDATE) ✅
              ↓
    trade_learning_log (INSERT) ✅
              ↓
    ai_global_confidence_calibration (UPDATE) ✅
              ↓
    User sees AI insights in UI
```

---

## 4. COMPATIBILITY CHECK

### Breaking Changes: NONE

**AI Learning Tables**:
- ✅ New tables, no existing data
- ✅ Code already expects these tables
- ✅ No changes to existing tables
- ✅ No changes to existing code

**Notification RLS**:
- ✅ Only adds policies, doesn't modify existing
- ✅ Code already attempts these operations
- ✅ No changes to table structure
- ✅ No changes to existing code

### Dependencies

**AI Learning depends on**:
- ✅ goal_session_trades (exists)
- ✅ auth.users (exists)
- ✅ No circular dependencies

**Notification RLS depends on**:
- ✅ goal_notifications table (exists)
- ✅ auth.users (exists)
- ✅ No new dependencies

---

## 5. STAGED DEPLOYMENT

### Migration 1: AI Learning Tables
**File**: `20260114_001000_create_ai_learning_infrastructure.sql`
**Size**: ~400 lines
**Risk**: LOW - New tables only
**Rollback**: DROP tables if needed

### Migration 2: Notification RLS Fix
**File**: `20260114_001001_fix_goal_notifications_insert_policy.sql`
**Size**: ~50 lines
**Risk**: MINIMAL - Only adds policies
**Rollback**: DROP policies if needed

---

## 6. POST-DEPLOY VERIFICATION

### Test Checklist

**AI Learning**:
- [ ] Close a trade → Check ai_trade_analysis has entry
- [ ] Verify patterns extracted in matching_historical_patterns
- [ ] Check ai_market_scenario_performance updates
- [ ] Verify trade_learning_log entry created
- [ ] Check global confidence calibration updates
- [ ] No 400/404 errors in console

**Notifications**:
- [ ] Trigger diagnostic alert
- [ ] Check goal_notifications has entry
- [ ] Verify user can see notification
- [ ] No 403 errors in console

**System Health**:
- [ ] No new errors in logs
- [ ] AI learning diagnostics show "active"
- [ ] Notification delivery working
- [ ] WebSocket still functioning (unchanged)

---

## SSOT COMPLIANCE

### Single Source of Truth Principles

1. **AI Trade Analysis**: `ai_trade_analysis` table is SSOT
   - All code reads from this table
   - Only `ai-learning-engine.ts` writes to it
   - No duplicate analysis storage

2. **Market Scenario Performance**: `ai_market_scenario_performance` is SSOT
   - Aggregated metrics stored here
   - No recalculation from raw trades
   - Progressive updates only

3. **Notification Creation**: `notification-coordinator.ts` is SSOT
   - ALL notifications go through coordinator
   - No direct inserts elsewhere
   - RLS policies support this flow

4. **Learning Events**: `trade_learning_log` is immutable event log
   - Append-only, no updates
   - Complete audit trail
   - No derived data

---

## RISK ASSESSMENT

**Overall Risk**: LOW

**Mitigation**:
- New tables can be dropped if issues arise
- Policies can be removed if needed
- No existing data affected
- No code changes required
- Reversible in < 1 minute

**Success Criteria**:
- ✅ No 400/404 errors after migration
- ✅ No 403 errors after migration
- ✅ AI insights appear in UI
- ✅ Diagnostic notifications work
- ✅ All tests pass
