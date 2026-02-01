# CCIP: Infinite Notification Sound Loop & Critical System Fixes

**CCIP ID**: CCIP-20260130-001
**Status**: IN PROGRESS
**Priority**: CRITICAL
**Affected Systems**: Trade Monitoring, Notifications, Counterfactuals, Position Management

---

## EXECUTIVE SUMMARY

### Root Cause Analysis
Multiple independent monitoring systems repeatedly detect and close the same trade due to:
1. **Cache Expiration Timing**: 5-second cache matches 5-second polling interval
2. **No Database-Backed Deduplication**: Each system queries fresh data without cross-checking closure state
3. **Sound Bypass**: Sounds play directly without notification deduplication
4. **Multi-Monitor Race Condition**: TradeLifecycleManager, RealtimeSLTPMonitor, and PositionMonitor operate independently

### Critical Issues Identified
1. Infinite trade closure loop (notification sounds)
2. Position size multiplier math error (44868x)
3. Missing database tables (ai_counterfactuals)
4. Fire-and-forget async patterns
5. Division by zero in risk calculations
6. Hard-coded account size ($10,000)
7. Race conditions in position monitoring
8. Memory leaks from untracked intervals
9. Empty array reduce operations
10. SSOT violations in position size calculations
11. Promise.all error handling gaps
12. Async setTimeout hazards

---

## SYSTEM MAP

### Affected Components

#### Core Services
- `trade-lifecycle-manager.ts` - Trade closure orchestration (PRIMARY)
- `trade-closure-coordinator.ts` - Session state management
- `notification-coordinator.ts` - Notification deduplication
- `position-monitor.ts` - SL/TP monitoring
- `realtime-sltp-monitor.ts` - Backup SL/TP monitoring
- `trade-processing-lock-service.ts` - Concurrency control

#### Support Services
- `counterfactual-engine.ts` - Post-trade analysis
- `counterfactual-insight-generator.ts` - AI insights
- `audio-alert-service.ts` - Sound playback
- `recommendation-tracker.ts` - Learning system

#### Database Tables
- `goal_session_trades` - Trade records
- `ai_counterfactuals` - Missing table (needs creation)
- `ai_counterfactual_insights` - Missing table (needs creation)
- `trade_processing_locks` - Concurrency control

---

## LOGIC CONTRACT

### New Behavior Specifications

#### 1. Trade Closure Deduplication (SSOT)
**Authority**: `TradeClosureCoordinator`

**Rules**:
- ONLY `TradeClosureCoordinator` may mark trade as closed in database
- ALL monitoring systems MUST query database before attempting closure
- Recently closed trades cache extended to 30 seconds (6x polling interval)
- Database status is ALWAYS the source of truth

**Implementation**:
```typescript
// BEFORE (Multiple Sources of Truth)
if (!this.recentlyClosedTrades.has(tradeId)) {
  await this.closeTrade(trade);
}

// AFTER (Single Source of Truth)
const dbStatus = await TradeClosureCoordinator.getTradeStatus(tradeId);
if (dbStatus === 'open' && !this.recentlyClosedTrades.has(tradeId)) {
  await TradeClosureCoordinator.closeTrade(trade);
}
```

#### 2. Sound Playback Deduplication (SSOT)
**Authority**: `AudioAlertService`

**Rules**:
- ALL sounds MUST route through `AudioAlertService.playSound()`
- Deduplication window: 10 seconds per sound type + trade ID
- No direct Audio() instantiation in business logic

**Implementation**:
```typescript
// BEFORE (Direct Sound Playback)
const audio = new Audio('/path/to/sound.mp3');
audio.play();

// AFTER (Routed Through Authority)
await audioAlertService.playSound('take_profit_hit', { tradeId });
```

#### 3. Position Size Calculation (SSOT)
**Authority**: `PositionSizeAuthority` (NEW)

**Rules**:
- Single source for ALL position size calculations
- Account size fetched from user profile (no hardcoding)
- Risk percentage calculated consistently
- Division by zero protection

#### 4. Counterfactual Storage (SSOT)
**Authority**: `CounterfactualEngine`

**Rules**:
- Database tables MUST exist before operations
- Async operations tracked until completion
- Errors propagated to caller
- No fire-and-forget patterns

---

## IMPLEMENTATION PLAN

### Phase 1: Critical Path (Trade Closure Loop)
1. Create database-backed trade status checker
2. Extend recently closed cache to 30 seconds
3. Add sound deduplication to AudioAlertService
4. Route all closure attempts through TradeClosureCoordinator

### Phase 2: Database Schema (Counterfactuals)
1. Create migration for ai_counterfactuals table
2. Create migration for ai_counterfactual_insights table
3. Add RPC functions with proper validation
4. Add indexes and RLS policies

### Phase 3: Math Corrections
1. Fix position size multiplier calculation
2. Add division by zero guards
3. Remove hardcoded account size
4. Create PositionSizeAuthority service

### Phase 4: Async & Error Handling
1. Remove fire-and-forget setTimeout patterns
2. Add Promise tracking registry
3. Implement proper error boundaries
4. Add timeout mechanisms

### Phase 5: Resource Management
1. Create interval registry service
2. Add mutex locks for shared state
3. Replace Promise.all with allSettled
4. Add cleanup guarantees

---

## COMPATIBILITY CHECK

### Breaking Changes
- None (all changes are internal improvements)

### Behavioral Changes
- Trade closure sound plays once per trade (was: infinite loop)
- Counterfactual insights saved to database (was: lost)
- Position size calculations use real account balance (was: hardcoded $10k)

### Migration Requirements
- Database schema changes (new tables)
- No data migration needed (new tables start empty)

---

## ROLLBACK PLAN

If critical issues detected:
1. Revert cache timeout to 5 seconds
2. Disable counterfactual insight generation
3. Restore direct sound playback
4. Rollback database migrations

---

## VERIFICATION CRITERIA

### Success Metrics
- [ ] Trade closure sound plays exactly once per trade
- [ ] No duplicate trade closures in logs
- [ ] Counterfactuals saved to database successfully
- [ ] Position size multipliers within 1x-10x range
- [ ] No division by zero errors in logs
- [ ] Account size fetched from user profile
- [ ] All async operations complete or timeout properly
- [ ] No memory leaks after 1 hour runtime

### Test Scenarios
1. Single trade closes via TP → Sound plays once
2. Multiple trades close simultaneously → Each sound plays once
3. Trade closes while user on different page → Insights still generated
4. Position with entry_price = stop_loss → No NaN in calculations
5. User with $100k account → Position sizes scale correctly

---

## GOVERNANCE COMPLIANCE

### SSOT Enforcement
- Trade closure authority: TradeClosureCoordinator
- Sound playback authority: AudioAlertService
- Position size authority: PositionSizeAuthority (new)
- Counterfactual storage authority: CounterfactualEngine

### CCIP Compliance
- All changes tracked in this document
- System map completed
- Logic contract defined
- Compatibility verified
- Rollback plan established

### Migration Compliance
- All database changes via timestamped migrations
- RLS policies included
- Service role permissions granted
- Indexes added for performance

---

## IMPLEMENTATION LOG

### 2026-01-30 - Initial Analysis
- Identified 13 critical issues
- Created CCIP tracking document
- Mapped affected systems

### 2026-01-30 - Implementation Start
- Phase 1: Trade closure deduplication
- Phase 2: Database schema creation
- Phase 3: Math corrections
- Phase 4: Async improvements
- Phase 5: Resource management

---

## SIGN-OFF

**Prepared By**: AI Agent
**Reviewed By**: Pending
**Approved By**: Pending
**Implementation Date**: 2026-01-30
