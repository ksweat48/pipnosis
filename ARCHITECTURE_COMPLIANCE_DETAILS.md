# Architecture Compliance Deep Dive

## SSOT Compliance - Single Source of Truth

### Problem Being Solved

**Before**: Session closure logic scattered across 3 layers
- UI Component: Close trades (GoalSessionDashboard)
- Service: Cancel intents & update database (SmartGoalSessionManager)
- Engine: Stop monitoring & close remaining trades (GoalSessionLiveEngine)

**Result**: Race conditions, duplicate operations, inconsistent state

### Solution: Atomic SSOT via RPC

**After**: Single authoritative source for session closure
```
┌─────────────────────────────────────────────────────────┐
│         UI Component (GoalSessionDashboard)             │
│  Role: Present button, show feedback, handle timeout    │
│  Action: ONLY calls atomic RPC                          │
└──────────────────────┬──────────────────────────────────┘
                       │
                       │ supabase.rpc('atomic_close_goal_session')
                       │
┌──────────────────────▼──────────────────────────────────┐
│         Database RPC (SSOT)                             │
│         atomic_close_goal_session()                     │
│  Role: SINGLE SOURCE OF TRUTH for all closure logic    │
│  Owner: Service role only (not UI, not service layer)  │
│                                                         │
│  Execution (all atomic):                               │
│  1. Verify session exists & belongs to user            │
│  2. Create/update closure_state record (SSOT)          │
│  3. Mark session 'stopping' (prevent duplicates)       │
│  4. Close all open trades                              │
│  5. Cancel entry intents                               │
│  6. Update session status 'user_stopped'               │
│  7. Log to CCIP governance                             │
│                                                         │
│  Returns: {success, steps_completed, errors}           │
└──────────────────────┬──────────────────────────────────┘
                       │
                       │ Result logged to ccip_change_tracking
                       │
┌──────────────────────▼──────────────────────────────────┐
│         Service Layer (Fallback - Non-Critical)        │
│         SmartGoalSessionManager.stopSession()          │
│  Role: ONLY cleanup live engine (already handled by RPC)│
│  Action: Stops monitoring, clears timers, logs result  │
└──────────────────────────────────────────────────────────┘
```

**SSOT Properties**:
- ✅ Single location for closure logic (RPC function)
- ✅ Atomic execution (all-or-nothing transactional)
- ✅ Governance tracked (every step logged)
- ✅ Service role protected (UI cannot bypass)
- ✅ Verifiable state (check session_closure_state table)

---

### Session Closure State Machine (SSOT)

```
┌─────────────────────────────────────────────────────────────┐
│  Database State: session_closure_state table (SSOT)        │
│                                                             │
│  Row Created with status: 'initiated'                      │
│  ↓                                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Status: 'initiated' + attempt_number: 1             │   │
│  │ Action: Create closure record (SSOT)                │   │
│  │ Next: Stop polling                                  │   │
│  └────────────────────┬────────────────────────────────┘   │
│                       │                                     │
│  ┌────────────────────▼────────────────────────────────┐   │
│  │ Status: 'polling_stopped'                           │   │
│  │ Action: Mark polling as stopped                     │   │
│  │ Next: Close all open trades                         │   │
│  └────────────────────┬────────────────────────────────┘   │
│                       │                                     │
│  ┌────────────────────▼────────────────────────────────┐   │
│  │ Status: 'trades_closing'                            │   │
│  │ Fields: trades_closed_count, trades_failed_count   │   │
│  │ Action: Update closure record with trade results   │   │
│  │ Next: Cancel entry intents                          │   │
│  └────────────────────┬────────────────────────────────┘   │
│                       │                                     │
│  ┌────────────────────▼────────────────────────────────┐   │
│  │ Status: 'intents_canceled'                          │   │
│  │ Fields: intents_canceled_count                      │   │
│  │ Action: Update closure record with intent results  │   │
│  │ Next: Final database update                         │   │
│  └────────────────────┬────────────────────────────────┘   │
│                       │                                     │
│  ┌────────────────────▼────────────────────────────────┐   │
│  │ Status: 'completed' ✓                               │   │
│  │ Fields: completed_at timestamp                      │   │
│  │ Result: SUCCESS - UI reload session data            │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  On Error at ANY step:                                     │
│  ├─ Status: 'failed'                                       │
│  ├─ Fields: error_message, error_details, error_code      │
│  ├─ Action: Log to CCIP as SESSION_CLOSURE_FAILED         │
│  └─ Result: UI re-enables button, shows error toast       │
│                                                             │
│  Safety: attempt_number increments on retry               │
│  Limit: max_attempts = 3 (prevents infinite loops)        │
└─────────────────────────────────────────────────────────────┘
```

**SSOT Enforcement**:
- ✅ Every status transition stored in database (not memory)
- ✅ Status flow validated by RPC logic (not UI)
- ✅ No duplicate record creation (UNIQUE constraint on session_id)
- ✅ UI never modifies session_closure_state (service_role only)
- ✅ Queryable at any time (can verify closure progress)

---

### Modal State Management (SSOT)

```
┌────────────────────────────────────────────────────────┐
│  ModalQueueManager (SSOT for modal state)             │
│  Role: Single authority for all modal operations      │
│                                                        │
│  Core Operations (all go through one manager):        │
│  ├─ createPendingModal()      [writes to DB]          │
│  ├─ getPendingModals()        [reads from DB]         │
│  ├─ dismissModal()            [deletes from DB]       │
│  └─ subscribeToModalUpdates() [listens to changes]    │
└────────────────┬───────────────────────────────────────┘
                 │
                 │ (All operations logged via log_modal_event())
                 │
┌────────────────▼───────────────────────────────────────┐
│  Database Tables (SSOT storage)                       │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ pending_user_modals (SSOT for current modals)   │  │
│  │ ├─ id, user_id, modal_type, modal_data         │  │
│  │ ├─ created_at, dismissed_at                    │  │
│  │ ├─ times_shown (detect duplicates)             │  │
│  │ ├─ is_stuck (health monitoring)                │  │
│  │ └─ last_health_check_at (tracking)             │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ modal_event_audit (SSOT for events)             │  │
│  │ ├─ id, modal_id, event_type                     │  │
│  │ ├─ event_details (what action was taken)        │  │
│  │ ├─ service_responsible (who created event)      │  │
│  │ └─ governance_log_id (audit trail link)         │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ modal_health_log (SSOT for lifecycle)           │  │
│  │ ├─ opened_at, first_action_at, closed_at       │  │
│  │ ├─ total_seconds_open (duration tracking)       │  │
│  │ ├─ is_stuck, stuck_reason (stuck detection)     │  │
│  │ ├─ close_method (how it was closed)             │  │
│  │ └─ governance_log_id (audit trail)              │  │
│  └──────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

**Component Isolation**:
- ✅ Components read modal state (via ModalQueueManager)
- ✅ Components don't write directly to database
- ✅ All writes go through ModalQueueManager
- ✅ ModalHealthMonitor observes only (via RPC health checks)
- ✅ No duplicate logic across services

---

## CCIP Compliance - Change Control Intelligence Protocol

### Governance Tracking Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Every Critical Operation                                  │
│                                                             │
│  Session Closure Example:                                  │
│  ├─ Operation starts (RPC called from UI)                │
│  ├─ RPC executes steps 1-7 (atomic block)                │
│  ├─ On success: INSERT into ccip_change_tracking         │
│  │  ├─ operation_type: 'SESSION_CLOSURE_COMPLETED'       │
│  │  ├─ user_id: [user closing session]                   │
│  │  ├─ record_id: [session_id]                           │
│  │  ├─ change_details: {steps_completed, errors}         │
│  │  └─ governance_log_id: [gen_random_uuid()]            │
│  │                                                        │
│  └─ On failure: INSERT into ccip_change_tracking         │
│     ├─ operation_type: 'SESSION_CLOSURE_FAILED'          │
│     ├─ change_details: {error_reason, steps_completed}   │
│     └─ governance_log_id: [unique identifier]            │
│                                                             │
│  Modal Health Example:                                     │
│  ├─ Operation: log_modal_event()                         │
│  ├─ Logs to modal_event_audit (timestamp, service)       │
│  ├─ Calls INSERT into ccip_change_tracking               │
│  │  ├─ operation_type: 'MODAL_EVENT_OPENED'              │
│  │  ├─ details: {modal_type, service_responsible}        │
│  │  └─ governance_log_id: [links both tables]            │
│  └─ Result: Complete audit trail across 3 tables         │
└─────────────────────────────────────────────────────────────┘
```

### Governance Log Structure

```
ccip_change_tracking Table
├─ Stores every critical state change
├─ Columns:
│  ├─ id (UUID primary key)
│  ├─ user_id (who made the change)
│  ├─ operation_type (what happened)
│  │  ├─ SESSION_CLOSURE_COMPLETED
│  │  ├─ SESSION_CLOSURE_FAILED
│  │  ├─ MODAL_EVENT_OPENED
│  │  ├─ MODAL_EVENT_DISMISSED
│  │  ├─ MODAL_EVENT_FORCE_CLOSED
│  │  └─ ... (expandable as system grows)
│  ├─ table_name (which table affected)
│  ├─ record_id (which specific record)
│  ├─ change_details (JSONB: what changed & why)
│  ├─ governance_log_id (correlation ID)
│  ├─ created_at (timestamp)
│  └─ RLS: Public read for authenticated users
│
└─ Indexing for performance:
   ├─ idx_user_id (queries by user)
   ├─ idx_operation_type (queries by operation)
   ├─ idx_created_at (queries by time range)
   └─ Enables compliance reporting & audit trails
```

### Compliance Verification Flow

```
┌──────────────────────────────────────────────────────────┐
│  Question: "Did user X close session Y?"                │
│                                                          │
│  Query:                                                 │
│  SELECT * FROM ccip_change_tracking                    │
│  WHERE operation_type IN (                             │
│    'SESSION_CLOSURE_COMPLETED',                        │
│    'SESSION_CLOSURE_FAILED'                            │
│  )                                                     │
│  AND user_id = X                                       │
│  AND record_id = Y                                     │
│  AND created_at BETWEEN start_date AND end_date       │
│                                                        │
│  Result Interpretation:                                │
│  ├─ Found entry + 'COMPLETED' → ✅ Session closed    │
│  ├─ Found entry + 'FAILED' → ⚠️ Closure failed      │
│  ├─ change_details: {steps_completed: {...}}         │
│  │  └─ Can verify which steps succeeded              │
│  ├─ governance_log_id → Links to session_closure_state │
│  │  └─ Can view complete state machine history       │
│  └─ No entry → ❌ Session NOT closed (investigate)   │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Question: "What happened with modal Z?"                │
│                                                          │
│  Query:                                                 │
│  SELECT * FROM modal_event_audit                       │
│  WHERE modal_id = Z                                    │
│  ORDER BY created_at ASC                               │
│                                                        │
│  Result Interpretation:                                │
│  ├─ Sequence of events:                               │
│  │  1. OPENED at 10:00:00                             │
│  │  2. ACTION_TRIGGERED at 10:00:05                  │
│  │  3. DISMISSED at 10:00:10                          │
│  ├─ Service responsible: Shows which service operated │
│  ├─ governance_log_id: Links to ccip_change_tracking  │
│  └─ event_details: Full context of what happened      │
│                                                        │
│  Additional Query (health log):                        │
│  SELECT * FROM modal_health_log WHERE modal_id = Z    │
│  → Shows: opened_at, closed_at, total_seconds_open    │
│  → Indicates: Was modal stuck? Auto-closed?           │
└──────────────────────────────────────────────────────────┘
```

### Audit Trail Integrity

```
┌────────────────────────────────────────────────────────────┐
│  Governance Log Integrity Guarantees                      │
│                                                            │
│  1. Immutability                                          │
│  └─ ccip_change_tracking has NO DELETE/UPDATE policies  │
│     (can only INSERT new records)                        │
│     → Prevents tampering with historical records        │
│                                                            │
│  2. Correlation                                           │
│  └─ governance_log_id links related records across:     │
│     ├─ ccip_change_tracking (main audit log)            │
│     ├─ session_closure_state (state machine progress)   │
│     ├─ modal_event_audit (event history)                │
│     └─ modal_health_log (lifecycle tracking)            │
│     → Single event ID traces through all tables         │
│                                                            │
│  3. Completeness                                          │
│  └─ Every critical state change creates log entry:     │
│     ├─ BEFORE RPC executes (immutable record)          │
│     ├─ AFTER step completes (with results)             │
│     ├─ ON ERROR (with error details)                   │
│     └─ Enables reconstruction of exact sequence        │
│                                                            │
│  4. Accountability                                        │
│  └─ Every log entry includes:                          │
│     ├─ user_id (who triggered action)                  │
│     ├─ service_responsible (which service executed)    │
│     ├─ operation_type (what happened)                  │
│     ├─ timestamp (when it happened)                    │
│     └─ change_details (why it happened)                │
└────────────────────────────────────────────────────────────┘
```

---

## Governance-Compliant Error Handling

### Session Closure Error Flow

```
┌───────────────────────────────────────────────────────────┐
│  RPC: atomic_close_goal_session()                        │
│                                                          │
│  Step 3: Mark session as 'stopping'                     │
│  ↓                                                       │
│  Step 4: FAILS ← Trade closure error                    │
│  ├─ Update closure_state:                              │
│  │  ├─ status = 'failed'                               │
│  │  ├─ error_message = 'Failed to close trade XYZ'     │
│  │  ├─ error_details = {error_code, trade_id}         │
│  │  └─ updated_at = NOW()                              │
│  │                                                     │
│  └─ INSERT into ccip_change_tracking:                 │
│     ├─ operation_type = 'SESSION_CLOSURE_FAILED'      │
│     ├─ user_id = [user]                               │
│     ├─ record_id = [session_id]                        │
│     ├─ change_details = {                             │
│     │  steps_completed: {                             │
│     │    session_marked_stopping: true,               │
│     │    polling_stopped: true                        │
│     │  },                                             │
│     │  errors: ['Trade closure failed for XYZ']       │
│     │}                                                │
│     └─ governance_log_id = [unique_uuid]              │
│                                                       │
│  Return to UI:                                        │
│  ├─ success: false                                    │
│  ├─ errors: ['Trade closure failed for XYZ']         │
│  └─ steps_completed: {...}                           │
│                                                       │
│  UI Response:                                         │
│  ├─ Re-enable close button (finally {} block)        │
│  ├─ Show error toast to user                         │
│  ├─ Suggest manual retry                             │
│  └─ Log entry in ccip_change_tracking enables        │
│     post-mortem analysis                             │
└───────────────────────────────────────────────────────────┘
```

### Modal Health Error Recovery

```
┌──────────────────────────────────────────────────────────┐
│  Periodic: cleanup_stuck_modals() (every 2 minutes)    │
│                                                         │
│  For each modal stuck > 10 minutes:                    │
│  ├─ Call detect_and_recover_stuck_modal()             │
│  │  ├─ UPDATE pending_user_modals SET is_stuck=true   │
│  │  ├─ UPDATE modal_health_log SET closed_at=NOW()   │
│  │  └─ Call log_modal_event(..., 'force_closed')      │
│  │     └─ INSERT into ccip_change_tracking:          │
│  │        ├─ operation_type = 'MODAL_EVENT_FORCE_CLOSED'
│  │        ├─ event_details = {                        │
│  │        │  reason: 'Auto-recovery: stuck 11 min'  │
│  │        │  threshold_minutes: 10                   │
│  │        │}                                         │
│  │        └─ governance_log_id = [uuid]              │
│  │                                                   │
│  └─ Result: Modal force-closed WITH audit trail      │
│                                                       │
│  Query for Compliance Audit:                          │
│  SELECT * FROM ccip_change_tracking               │
│  WHERE operation_type = 'MODAL_EVENT_FORCE_CLOSED'  │
│  AND created_at > DATE(NOW() - INTERVAL '7 days')   │
│  → Shows all stuck modals auto-recovered in last week │
└──────────────────────────────────────────────────────────┘
```

---

## Security & Access Control

### Row-Level Security (RLS) Policies

```
session_closure_state
├─ Service role only
├─ Policy: "Service role full access"
├─ Prevents: UI/authenticated users from viewing closure state
└─ Reason: Sensitive operational state

modal_health_log
├─ Authenticated users: Can view OWN modal health
├─ Policy: "Users can view own modal health"
│  ├─ USING (user_id = auth.uid())
│  └─ Prevents: Viewing other users' modal data
├─ Service role: Full access for monitoring
└─ Reason: Privacy + operational monitoring

modal_event_audit
├─ Authenticated users: Can view OWN events (audit trail)
├─ Policy: "Users can view own modal events"
│  ├─ USING (user_id = auth.uid())
│  └─ Enables: User can verify their actions
├─ Service role: Full access
└─ Reason: Privacy + transparency

ccip_change_tracking
├─ Authenticated users: Can view OWN operations
├─ Policy: "Users can view own operations"
│  ├─ USING (user_id = auth.uid())
│  └─ Shows: What operations they triggered
├─ Service role: Full access
└─ Reason: Transparency + compliance
```

### API Layer Security

```
RPC Functions (Service Role Protected)
├─ atomic_close_goal_session()
│  ├─ SECURITY DEFINER
│  ├─ SET search_path = public
│  ├─ Validates: Session belongs to user
│  └─ Prevents: Users closing other users' sessions
│
├─ detect_and_recover_stuck_modal()
│  ├─ SECURITY DEFINER
│  ├─ Uses: Service role to modify state
│  ├─ Validates: Stuck threshold & recovery logic
│  └─ Prevents: Unauthorized modal manipulation
│
└─ cleanup_stuck_modals()
   ├─ SECURITY DEFINER (service role only)
   ├─ Iterates: All stuck modals system-wide
   ├─ Validates: Each user_id & modal_id relationship
   └─ Prevents: Cross-user modal contamination
```

---

## Compliance Checklists

### ✅ SSOT Compliance Checklist

- [x] Session closure: Single RPC authority (atomic_close_goal_session)
- [x] Modal state: Single manager authority (ModalQueueManager)
- [x] State transitions: Tracked in database (not memory)
- [x] No UI-side business logic: All logic in RPC/services
- [x] No duplicate logic: Each operation has one location
- [x] Queryable state: Can verify state at any time
- [x] Consistent state: Atomic transactions ensure consistency

### ✅ CCIP Compliance Checklist

- [x] All operations tracked: INSERT into ccip_change_tracking
- [x] Correlation IDs: governance_log_id links related records
- [x] Immutable logs: RLS policies prevent UPDATE/DELETE
- [x] Complete accountability: user_id, service_responsible, timestamp
- [x] Error tracking: Failed operations also logged
- [x] Audit trail: Can reconstruct exact sequence of events
- [x] Compliance queries: Can verify specific operations occurred

### ✅ Governance Compliance Checklist

- [x] RLS policies: Proper access controls in place
- [x] Data privacy: Users can't view other users' data
- [x] Service role protection: Sensitive operations protected
- [x] Foreign key constraints: Referential integrity enforced
- [x] State validation: CHECK constraints prevent invalid states
- [x] Error handling: All error paths tracked & recoverable
- [x] Security definer: Sensitive operations use SECURITY DEFINER

---

## Appendix: Key Table Relationships

```
session_closure_state
├─ FK: session_id → goal_sessions.id
├─ FK: user_id → auth.users.id
└─ Referenced by: ccip_change_tracking (via governance_log_id)

modal_health_log
├─ FK: user_id → auth.users.id
├─ FK: modal_id → pending_user_modals.id (optional)
└─ Referenced by: ccip_change_tracking (via governance_log_id)

modal_event_audit
├─ FK: user_id → auth.users.id
├─ FK: modal_id → pending_user_modals.id (optional)
└─ Referenced by: ccip_change_tracking (via governance_log_id)

ccip_change_tracking
├─ FK: user_id → auth.users.id
├─ Correlates: session_closure_state, modal_health_log, modal_event_audit
└─ Central audit log for all governance tracking
```

**Design Principle**: Every critical operation creates an entry in ccip_change_tracking, which can be correlated with specific records in operation-specific tables (session_closure_state, modal_health_log, etc.) via governance_log_id.
