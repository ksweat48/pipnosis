# STUCK SESSIONS FIX - CCIP & SSOT COMPLIANCE PLAN

**Change Request ID:** CCIP-2026-01-30-STUCK-SESSIONS
**Author:** Architecture Team
**Date:** 2026-01-30
**Status:** IN PROGRESS

---

## Phase 1: System Map & Logic Contracts

### 1.1 Affected Functions & Their SSOT Authority

| Function | Current Location | SSOT Authority | Responsibility |
|----------|------------------|-----------------|-----------------|
| `trigger_continuation_modal()` | DB Migration | **SessionStateAuthority** (new) | Transition session to 'awaiting_continuation' |
| `request_session_continuation()` | DB Migration | **SessionStateAuthority** (new) | Handle user continuation request |
| `close_goal_session_trade()` | DB Migration | **TradeClosureCoordinator** | Close trade and update balance atomically |
| `handle_continuation_response()` | DB Migration | **SessionStateAuthority** (new) | Transition from 'awaiting_continuation' |
| `check_continuation_modal_timeout()` | DB Migration | **SessionTimeoutAuthority** (new) | Auto-close expired continuation |
| `cleanup_stuck_sessions_automatic()` | DB Migration | **SessionTimeoutAuthority** (new) | Cleanup stuck sessions |
| `mark_intent_executed_on_trade_open` (trigger) | DB Migration | **EntryIntentAuthority** (new) | Mark intents as executed on trade open |

### 1.2 New SSOT Authorities Being Established

**SessionStateAuthority**: All session state transitions
- Who: Database functions & coordinators
- What: session.status, session.entry_monitor_state, session timestamps
- Authority: Single source for all state transitions
- Consumer: SessionManagementService calls these functions

**SessionTimeoutAuthority**: All session timeout logic
- Who: Database functions & cleanup services
- What: Determining when sessions have timed out
- Authority: Single place where timeout is calculated
- Consumer: Cleanup jobs and auto-recovery services

**EntryIntentAuthority**: All entry intent lifecycle
- Who: Database triggers & intent management services
- What: entry_intent.status, executed_at, abandoned_at
- Authority: Single place where intent status changes
- Consumer: Entry monitoring and session transitions

### 1.3 SSOT Violations Being Fixed

| Violation | Current State | Fix |
|-----------|--------------|-----|
| Two timeout checks (awaiting_continuation_since vs scanning_started_at) | check_continuation_modal_timeout() has both | Keep ONLY awaiting_continuation_since as authority |
| Two places calculating P&L for same trade | close_goal_session_trade() + balance trigger | Make close_goal_session_trade() only authority |
| Intent status updated in two ways (trigger INSERT vs trigger UPDATE) | mark_intent_executed_on_trade_open trigger fires only on INSERT | Add AFTER UPDATE trigger to fire on status='open' |
| Sessions can be stuck without cleanup mechanism | 7 different functions without cleanup | Create centralized cleanup_orphaned_intents() authority |
| Balance updates race condition | Multiple triggers can update balance | Serialize balance updates through TradeClosureCoordinator |

---

## Phase 2: Compatibility Checks

### 2.1 Data Compatibility

**Existing data state:**
- Sessions may be in 'awaiting_continuation' with NULL awaiting_continuation_since
- Entry intents may be stuck in 'monitoring' status from incomplete trades
- Trades may be 'closed' but balance not updated (P&L mismatch)
- Pending modals may exist for deleted sessions

**Backward compatibility:**
- All new functions are additions (non-breaking)
- Modified functions maintain same signature
- New columns are optional (migration adds with defaults)
- Old data is backfilled with safe defaults

### 2.2 Function Signature Compatibility

**No breaking changes to function signatures:**
```sql
-- BEFORE
CREATE FUNCTION request_session_continuation(p_session_id UUID)
RETURNS JSON ...

-- AFTER (same signature)
CREATE FUNCTION request_session_continuation(p_session_id UUID)
RETURNS JSON ...
```

**New internal behavior (non-breaking):**
- Better error handling (still returns same JSON structure)
- Transaction wrapping (still atomic from caller perspective)
- Added audit logging (still returns same result)

### 2.3 Deployment Order

1. Add new columns with defaults (nullable first, then backfill, then NOT NULL)
2. Create new utility functions (cleanup_orphaned_intents, validate_session_consistency)
3. Create new triggers (mark_intent_executed on UPDATE)
4. Modify existing functions one at a time
5. Backfill historical data
6. Enable NOT NULL constraints

---

## Phase 3: SSOT & Governance Implementation

### 3.1 Authority Registration

All new/modified functions MUST be registered in:
- `/src/governance/RESPONSIBILITY_REGISTRY.md`
- Database audit table: `governance_authority_registry`
- Runtime checks in `ssotViolationDetector`

### 3.2 State Transition Authority

**SessionStateAuthority owns:**
- Decision: When to transition session.status
- Execution: Database function that actually updates it
- Validation: Pre-transition checks (can transition from A to B?)
- Audit: Log all transitions with why and who requested

**Pattern:**
```sql
-- AUTHORITY ONLY
CREATE FUNCTION transition_session_to_awaiting_continuation(
  p_session_id UUID,
  p_reason TEXT,
  p_requester_id UUID
) RETURNS JSON AS $$
DECLARE
  v_session goal_sessions;
BEGIN
  -- Validate current state (can transition FROM current state?)
  SELECT * INTO v_session FROM goal_sessions WHERE id = p_session_id;

  -- Check state machine (scanning → awaiting_continuation OK, but not from user_stopped)
  IF v_session.status NOT IN ('scanning', 'trade_pending') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Cannot transition from %s to awaiting_continuation', v_session.status)
    );
  END IF;

  -- Set ALL required fields atomically
  UPDATE goal_sessions SET
    status = 'awaiting_continuation',
    awaiting_continuation_since = NOW(),
    continuation_modal_shown_at = NOW(),
    continuation_deadline = NOW() + interval '60 seconds',
    entry_monitor_state = 'ABANDONED_RESCAN_REQUESTED',
    updated_at = NOW()
  WHERE id = p_session_id;

  -- Audit
  INSERT INTO governance_change_log (
    entity_type, entity_id, operation, old_value, new_value,
    reason, requester_id, change_at
  ) VALUES (
    'goal_sessions', p_session_id, 'status_transition',
    v_session.status, 'awaiting_continuation',
    p_reason, p_requester_id, NOW()
  );

  RETURN jsonb_build_object('success', true, 'session_id', p_session_id);
EXCEPTION WHEN OTHERS THEN
  -- Audit failure
  INSERT INTO governance_change_log (entity_type, entity_id, operation, error_message)
  VALUES ('goal_sessions', p_session_id, 'status_transition_FAILED', SQLERRM);
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 3.3 Governance Audit Trail

Every state transition creates record:
```sql
CREATE TABLE IF NOT EXISTS governance_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL, -- 'goal_sessions', 'goal_session_trades', etc
  entity_id uuid NOT NULL,
  operation text NOT NULL, -- 'status_transition', 'balance_update', etc
  old_value jsonb,
  new_value jsonb,
  reason text, -- Why was this changed?
  requester_id uuid, -- Who requested it?
  error_message text, -- If failed
  changed_at timestamptz DEFAULT NOW(),

  CONSTRAINT valid_entity_type CHECK (
    entity_type IN ('goal_sessions', 'goal_session_trades', 'entry_intents', 'user_profiles')
  )
);
```

### 3.4 Conflict Prevention

**Race condition protection:**
- Use row-level locking: `SELECT ... FOR UPDATE` within transactions
- Idempotency checks: Don't try to transition if already in target state
- Serialization checks: Detect and reject conflicting concurrent updates

```sql
-- SAFE: Prevents race conditions
BEGIN;
  SELECT * FROM goal_sessions WHERE id = p_session_id FOR UPDATE; -- Lock row
  -- Now safe to read and modify without conflicts
  UPDATE goal_sessions SET ... WHERE id = p_session_id;
COMMIT;
```

---

## Phase 4: Dry-Run Simulation Plan

### 4.1 Test Scenarios

**Scenario 1: Happy path continuation modal**
```
1. Session in 'scanning'
2. trigger_continuation_modal() called
3. Session transitions to 'awaiting_continuation'
4. awaiting_continuation_since IS NOT NULL (required)
5. continuation_deadline IS NOT NULL (required)
6. Modal is created
7. Notification is created
```

**Scenario 2: Timeout auto-cleanup**
```
1. Session in 'awaiting_continuation' for >60 seconds
2. check_continuation_modal_timeout() runs
3. Uses awaiting_continuation_since (ONLY authority)
4. Transitions session to 'user_stopped'
5. cleanup_orphaned_intents() is called
6. Entry intents in 'monitoring' are marked 'abandoned'
7. Session_ended modal is created
```

**Scenario 3: P&L calculation failure with recovery**
```
1. Trade closed, balance update needed
2. close_goal_session_trade() starts
3. P&L calculation fails
4. Transaction ROLLS BACK (no partial state)
5. Trade remains 'open'
6. Retry mechanism detects and retries
7. Eventually succeeds or logs for admin review
```

**Scenario 4: Intent execution tracking**
```
1. Trade inserted as 'pending'
2. No trigger fires (INSERT with pending)
3. Later trade updated to 'open'
4. AFTER UPDATE trigger fires
5. Matching entry_intent marked 'executed'
6. Session transition no longer blocked by stale intent
```

### 4.2 Regression Test Suite

- All 7 function modifications run with existing data
- No orphaned modals left behind
- No orphaned intents blocking transitions
- All balance calculations still correct
- All timestamps properly set
- All audit logs created

---

## Phase 5: Risk Mitigation

### 5.1 Rollback Plan

**Per-function rollback:**
- Keep old function version in database
- Deploy new function as `function_name_v2()`
- Test thoroughly
- If issues, code can use old version
- Swap after verification

**Data rollback:**
- All changes are UPDATE operations
- Can backfill with old values if needed
- No data deleted, only updated
- Audit trail allows reconstruction

### 5.2 Monitoring & Alerts

**New metrics to track:**
- Sessions stuck in 'awaiting_continuation' >5min
- Entry intents in 'monitoring' >5min
- Sessions with missing timestamps
- Governance change log error rates
- Orphaned modals count

**Alert thresholds:**
- > 10 stuck sessions = critical alert
- > 100 orphaned intents = high alert
- Any governance change fails = alert for review

---

## Phase 6: Implementation Sequence

### 6.1 Migration Order

1. **Migration 1:** Add governance tables (change_log, authority_registry)
2. **Migration 2:** Create utility functions (cleanup_orphaned_intents, validate_session_consistency)
3. **Migration 3:** Add missing columns with defaults
4. **Migration 4:** Backfill missing timestamps
5. **Migration 5:** Create new triggers (AFTER UPDATE for intent execution)
6. **Migration 6:** Fix trigger_continuation_modal
7. **Migration 7:** Fix request_session_continuation
8. **Migration 8:** Fix close_goal_session_trade
9. **Migration 9:** Fix handle_continuation_response
10. **Migration 10:** Fix check_continuation_modal_timeout
11. **Migration 11:** Fix cleanup_stuck_sessions_automatic
12. **Migration 12:** Consolidate triggers and cleanup

### 6.2 Verification Checks

After each migration:
- Verify new functions exist and are callable
- Verify old data still intact
- Run test scenarios
- Check governance audit table has entries
- Monitor error logs for issues

---

## SSOT Authority Summary

| Authority | Functions It Owns | Who Calls It |
|-----------|------------------|------------|
| **SessionStateAuthority** | All session.status transitions | SessionManagementService, continuation handlers |
| **SessionTimeoutAuthority** | Session timeout logic | cleanup_stuck_sessions_automatic(), scheduled jobs |
| **EntryIntentAuthority** | All intent.status changes | Triggers, entry monitoring |
| **TradeClosureCoordinator** | Trade closure + balance update | trade-execution-engine, position monitoring |

---

## Governance Compliance Checklist

- [ ] All functions registered in RESPONSIBILITY_REGISTRY
- [ ] All state transitions have audit log entries
- [ ] All errors logged with full context
- [ ] All race conditions prevented with row locking
- [ ] All atomic operations wrapped in transactions
- [ ] All breaking changes documented
- [ ] All rollback procedures documented
- [ ] All monitoring metrics defined
- [ ] All test scenarios validated
- [ ] All alert thresholds configured

---

**NEXT STEP:** Proceed to Phase 1 Implementation
