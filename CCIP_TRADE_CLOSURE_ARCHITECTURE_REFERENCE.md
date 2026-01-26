# CCIP Trade Closure Architecture - Complete Reference

## SSOT (Single Source of Truth) Authority Matrix

| Responsibility | SSOT Authority | Location | Enforcement | Fallback |
|---|---|---|---|---|
| Trade Data | goal_session_trades table | Database | PK, FK constraints | None |
| User Balance | user_profiles.account_balance | Database | PK, RLS policies | Audit trail |
| Close Decision | check_and_close_positions_on_price_update trigger | Database Trigger | SECURITY DEFINER | Manual review |
| Close Validation | close_goal_session_trade RPC | Application Layer | Service role policy | Force close |
| P&L Calculation | calculate_pnl_universal function | SSOT Math | Must use for all | Audit failure |
| Governance Record | closure_audit_log table | Audit Database | Append-only, immutable | Admin alerts |
| Alert System | admin_alerts table | Alert Queue | Admin read-only | Escalation |

**SSOT Principle:** If the same problem can be fixed in more than one place, the system is architecturally broken.
- All P&L calculations → calculate_pnl_universal (1 source)
- All balance updates → close_goal_session_trade (1 gatekeeper)
- All closure records → closure_audit_log (1 immutable record)
- All escalations → admin_alerts (1 alert queue)

---

## CCIP (Change Control Intelligence Protocol) - Three-Stage Gates

### Stage 1: Validation Gate (VALIDATE)

**Purpose:** Ensure prerequisites are met before attempting mutations

**Checks:**
```sql
-- Trade validation
✓ Trade exists by ID
✓ Trade belongs to authenticated user (RLS)
✓ Trade is in valid state (open|pending|soft_closing)
✓ Not already closed (unless force_close)

-- Access control
✓ User is owner OR service_role
✓ Goal session matches (if specified)

-- Business rules
✓ Close reason is valid enum value
✓ Close price is numeric and reasonable
```

**Functions Involved:**
- `check_and_close_positions_on_price_update()` - initiates validation
- `close_goal_session_trade()` - Stage 1 validation block

**Output:** Binary (proceed to Stage 2 or fail)

**Failure Handling:**
```json
{
  "success": false,
  "error": "Trade not found or already closed",
  "status": "failed_trade_not_found",
  "audit_id": "uuid"
}
```

### Stage 2: Calculation Gate (CALCULATE)

**Purpose:** Prepare all data needed for mutation before touching any state

**Calculations:**
```sql
-- P&L Calculation (SSOT)
✓ Call calculate_pnl_universal(symbol, direction, entry, exit, lot_size)
✓ Result verified to be numeric

-- User Profile Lookup
✓ SELECT account_balance FROM user_profiles WHERE id = v_trade.user_id
✓ If NULL: decide force_close vs fail

-- New Balance Calculation
✓ v_new_balance := v_current_balance + v_calculated_pnl
✓ Verify new balance is reasonable
```

**Functions Involved:**
- `calculate_pnl_universal()` - SSOT P&L authority
- `close_goal_session_trade()` - Stage 2 calculation block

**Output:** Calculated data structure (ready for mutation)

**Failure Handling:**
```json
{
  "success": false,
  "error": "User profile not found",
  "status": "failed_missing_profile",
  "force_close_available": true
}
```

### Stage 3: Mutation Gate (MUTATE)

**Purpose:** Apply changes with full audit trail

**Mutations:**
```sql
-- 1. Update trade record
UPDATE goal_session_trades
SET status = 'closed', exit_price = ?, profit_loss = ?, closed_at = now()
WHERE id = ?;

-- 2. Update user balance (if trade was open)
UPDATE user_profiles
SET account_balance = ?, updated_at = now()
WHERE id = ?;

-- 3. Log to audit trail (ALWAYS)
INSERT INTO closure_audit_log (...)
VALUES (...);

-- 4. Create admin alert if critical (if needed)
INSERT INTO admin_alerts (...)
VALUES (...);
```

**Functions Involved:**
- `close_goal_session_trade()` - Stage 3 mutation block
- `log_closure_audit()` - Governance logging
- `notify_admin_alert()` - Alert escalation

**Output:** Closure record with full context

**Success Response:**
```json
{
  "success": true,
  "trade_id": "uuid",
  "pnl": 123.45,
  "balance_before": 10000,
  "balance_after": 10123.45,
  "audit_id": "uuid"
}
```

---

## CCIP Flow Diagram: Trade Closure Decision Path

```
┌─────────────────────────────────────────────────────────────────┐
│ Price Update (realtime_prices INSERT)                           │
└────────────────────────────┬──────────────────────────────────┘
                             │
                             ▼
    ┌────────────────────────────────────────────────────────┐
    │ TRIGGER: check_and_close_positions_on_price_update()   │
    │ - Determine current market price (bid/ask)             │
    │ - Check SL/TP criteria against position                │
    └──────────────────────────┬───────────────────────────┘
                               │
                   ┌───────────┴───────────┐
                   │                       │
         ┌─────────▼──────────┐   ┌──────▼─────────┐
         │ SL/TP Not Met      │   │ SL/TP Triggered│
         │ → Continue Loop    │   │ → Call RPC     │
         └────────────────────┘   └────────┬───────┘
                                           │
                                ┌──────────▼────────────────┐
                                │ CCIP STAGE 1: VALIDATE    │
                                │ check_and_close_positions │
                                │ _on_price_update()        │
                                │ - Trade exists?           │
                                │ - User owns trade?        │
                                │ - Valid state?            │
                                └──────────┬─────────────────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │ FAIL                 │ OK                  │
                    ▼                      ▼                     │
            ┌──────────────┐        ┌─────────────────────────┐ │
            │ Log to       │        │ CCIP STAGE 2: CALCULATE │ │
            │ closure_     │        │ close_goal_session_trade│ │
            │ audit_log    │        │ - P&L calc (SSOT)      │ │
            │ status=      │        │ - User profile lookup  │ │
            │ failed_*     │        │ - New balance calc     │ │
            │ Return error │        │ - Prepare mutations    │ │
            └──────────────┘        └──────────┬──────────────┘ │
                                               │                 │
                        ┌──────────────────────┼─────────────────┤
                        │                      │                 │
                        │        ┌─────────────▼────────────────┐│
                        │        │ User Profile Found?          ││
                        │        └──────────┬───────────────────┘│
                        │                   │                    │
                        │     ┌─────────────┴──────────────────┐ │
                        │     │                                │ │
                        │  YES│ Normal Close                 NO│ │
                        │     │                                │ │
                        │     ▼                                ▼ │
                        │ ┌─────────────┐          ┌─────────────┐ │
                        │ │ Proceed to  │          │ force_close?│ │
                        │ │ Stage 3     │          │ param?      │ │
                        │ │ (Mutate)    │          └────┬────┬───┘ │
                        │ └─────────────┘               │    │     │
                        │                             NO│    │YES  │
                        │                    ┌─────────▼┐   ▼     │
                        │                    │Log       │   │ Force│
                        │                    │failure   │   │Close │
                        │                    │Create    │   │With  │
                        │                    │admin_    │   │Zero  │
                        │                    │alert     │   │Bal   │
                        │                    │Return    │   │      │
                        │                    │error     │   │      │
                        │                    └──────────┘   │      │
                        │                                   │      │
                        │                     ┌─────────────▼──────▼─┐
                        │                     │ CCIP STAGE 3: MUTATE │
                        │                     │ - Update trade rec   │
                        │                     │ - Update balance     │
                        │                     │ - Log to audit_log   │
                        │                     │ - Create alerts      │
                        │                     └─────────┬────────────┘
                        │                               │
                        │                    ┌──────────┴──────────┐
                        │                    │                     │
                        ▼                    ▼                     ▼
                    ┌────────────┐      ┌──────────┐        ┌──────────────┐
                    │ Log Error  │      │ Log to   │        │ Log Success  │
                    │ to audit   │      │ audit    │        │ to audit     │
                    │ Return to  │      │ Return   │        │ Return to    │
                    │ trigger    │      │ to RPC   │        │ RPC trigger  │
                    └────────────┘      └──────────┘        └──────────────┘
                                             │
                         ┌───────────────────┼───────────────────┐
                         │                   │                   │
              ┌──────────▼────────┐ ┌──────▼──────────┐ ┌──────▼──────────┐
              │ Error logged      │ │ Return result  │ │ Trigger catches │
              │ to audit trail    │ │ to trigger     │ │ all exceptions  │
              │ Trigger catches   │ │ Trigger logs   │ │ Logs to audit   │
              │ exception         │ │ success        │ │ Never blocks    │
              │ Never blocks      │ │ Continues loop │ │ price insert    │
              │ price insert      │ │                │ │                 │
              └───────────────────┘ └────────────────┘ └─────────────────┘
                         │                   │                   │
                         └───────────────────┼───────────────────┘
                                             │
                                ┌────────────▼────────────┐
                                │ Price Insert Completes  │
                                │ (NEVER BLOCKED)         │
                                └─────────────────────────┘
```

---

## Governance Audit Trail: Data Flow

```
Trade Closure Event
    │
    ├─ SL/TP Trigger detects condition
    │
    ├─ Calls close_goal_session_trade()
    │
    ├─ Stage 1: Validates prerequisites
    │   └─ If fails → closure_audit_log (failed_trade_not_found)
    │
    ├─ Stage 2: Calculates P&L and balance
    │   └─ If user profile missing → admin_alerts (critical)
    │
    ├─ Stage 3: Mutates records
    │   └─ Always → closure_audit_log (success or failure)
    │
    └─ If critical failure → admin_alerts (escalation)

closure_audit_log Record:
├─ trade_id: UUID of closed trade
├─ user_id: User who owned trade
├─ symbol: Symbol traded (EURUSD, etc.)
├─ entry_price: Entry price
├─ exit_price: Exit price at close
├─ lot_size: Position size
├─ closure_status: success | failed_* | force_closed_zero_balance
├─ pnl_calculated: P&L if successful
├─ balance_before: Balance before closure
├─ balance_after: Balance after closure
├─ error_message: If failed, why
├─ trigger_source: manual | stop_loss | take_profit | system
├─ execution_context: Full request context (jsonb)
└─ created_at: Immutable timestamp

admin_alerts Record (if critical):
├─ alert_type: closure_failure | profile_missing | balance_mismatch | orphaned_trade
├─ severity: info | warning | critical
├─ user_id: Affected user
├─ trade_id: Affected trade
├─ title: Human-readable title
├─ message: Description of issue
├─ metadata: Additional context (pnl, symbol, etc.)
├─ resolved: Boolean for manual resolution
└─ created_at: Timestamp for SLA tracking
```

---

## Error Handling: Decision Tree

```
close_goal_session_trade(trade_id, close_price, close_reason, goal_session_id, force_close)
│
├─ STAGE 1: Is close_reason valid enum?
│  │
│  ├─ NO → RAISE EXCEPTION → RPC error
│  │
│  └─ YES → Continue
│
├─ STAGE 1: Does trade exist?
│  │
│  ├─ NO → Log to closure_audit_log (failed_trade_not_found)
│  │        Return {success: false, status: failed_trade_not_found}
│  │
│  └─ YES → Continue
│
├─ STAGE 1: Does user own trade?
│  │
│  ├─ NO → Log to closure_audit_log (failed_access_denied)
│  │        Return {success: false, status: failed_access_denied}
│  │
│  └─ YES → Continue
│
├─ STAGE 1: Is trade in valid state?
│  │
│  ├─ Already closed & !force_close → Log (failed_already_closed)
│  │                                   Return error
│  │
│  └─ Valid state or force_close → Continue
│
├─ STAGE 2: Can we calculate P&L?
│  │
│  ├─ NO → Log to closure_audit_log (failed_pnl_calculation)
│  │        Return {success: false, status: failed_pnl_calculation}
│  │
│  └─ YES → Continue
│
├─ STAGE 2: Can we find user profile?
│  │
│  ├─ NO & !force_close → Create admin_alerts (critical)
│  │                       Log to closure_audit_log (failed_missing_profile)
│  │                       Return {success: false, alert_id: ...}
│  │
│  ├─ NO & force_close → Skip balance update, continue
│  │                      Log as force_closed_zero_balance
│  │                      Create admin_alerts (critical)
│  │
│  └─ YES → Continue
│
├─ STAGE 3: Can we update trade?
│  │
│  ├─ NO → Log to closure_audit_log (failed_trade_update)
│  │        Return {success: false}
│  │
│  └─ YES → Continue
│
├─ STAGE 3: Can we update balance?
│  │
│  ├─ NO → Log to closure_audit_log (failed_balance_update)
│  │        Return {success: false}
│  │
│  ├─ YES & trade was open → Update balance, continue
│  │
│  └─ YES & trade was closed → Skip balance update, continue
│
├─ STAGE 3: Log successful closure
│  │
│  └─ INSERT into closure_audit_log (success)
│
└─ Return {success: true, pnl: ..., balance_after: ..., audit_id: ...}
```

---

## RLS Policy Compliance

### closure_audit_log RLS

```sql
-- SELECT: Users see own trades, admins see all
CREATE POLICY "closure_audit_log_authenticated_select"
  ON closure_audit_log FOR SELECT
  USING (user_id = auth.uid() OR is_admin(auth.uid()))

-- INSERT: Service role only (via RPC)
-- UPDATE: Service role only (resolve alerts)
-- DELETE: Service role only (never delete audit records)
```

### admin_alerts RLS

```sql
-- SELECT: Admins only
CREATE POLICY "admin_alerts_admin_only"
  USING (is_admin(auth.uid()))

-- INSERT: Service role only (via RPC)
-- UPDATE: Service role and admins (mark resolved)
-- DELETE: Service role only
```

**Service Role Bypass:**
```sql
-- Grants for trigger execution
GRANT EXECUTE ON FUNCTION close_goal_session_trade(...) TO service_role;
GRANT EXECUTE ON FUNCTION log_closure_audit(...) TO service_role;
GRANT EXECUTE ON FUNCTION notify_admin_alert(...) TO service_role;
```

---

## Production Monitoring Queries

### Active Closure Failures (Last Hour)

```sql
SELECT
  closure_status,
  COUNT(*) as failure_count,
  user_id,
  error_message
FROM closure_audit_log
WHERE created_at > now() - interval '1 hour'
  AND closure_status LIKE 'failed%'
GROUP BY closure_status, user_id, error_message
ORDER BY failure_count DESC;
```

### Force-Closed Orphaned Trades

```sql
SELECT
  id,
  trade_id,
  user_id,
  symbol,
  pnl_calculated as estimated_pnl,
  created_at
FROM closure_audit_log
WHERE closure_status = 'force_closed_zero_balance'
  AND created_at > now() - interval '24 hours'
ORDER BY created_at DESC;
```

### Unresolved Admin Alerts (Critical)

```sql
SELECT
  alert_type,
  severity,
  COUNT(*) as alert_count,
  MIN(created_at) as oldest_alert
FROM admin_alerts
WHERE resolved = false
  AND severity = 'critical'
GROUP BY alert_type, severity
ORDER BY oldest_alert DESC;
```

### Closure Success Rate by Close Reason

```sql
SELECT
  trigger_source,
  COUNT(*) as total_attempts,
  SUM(CASE WHEN closure_status = 'success' THEN 1 ELSE 0 END) as successes,
  ROUND(
    100.0 * SUM(CASE WHEN closure_status = 'success' THEN 1 ELSE 0 END) / COUNT(*),
    2
  ) as success_rate_percent
FROM closure_audit_log
WHERE created_at > now() - interval '7 days'
GROUP BY trigger_source
ORDER BY success_rate_percent DESC;
```

---

## SSOT Verification Checklist

Run these queries to verify SSOT compliance:

```sql
-- 1. Verify close_goal_session_trade is the only mutation source
SELECT COUNT(*) as direct_goal_session_trades_updates
FROM pg_stat_statements
WHERE query LIKE '%UPDATE goal_session_trades%'
  AND query NOT LIKE '%close_goal_session_trade%';
-- Expected: 0 (only close_goal_session_trade updates trades)

-- 2. Verify P&L calculations go through SSOT
SELECT COUNT(DISTINCT query)
FROM pg_stat_statements
WHERE query LIKE '%calculate_pnl%';
-- Expected: 1-2 (only calculate_pnl_universal and its callers)

-- 3. Verify all closure attempts are logged
SELECT COUNT(*)
FROM closure_audit_log;
-- Expected: Growing over time, no gaps

-- 4. Verify no balance updates outside close_goal_session_trade
SELECT COUNT(*) as direct_balance_updates
FROM pg_stat_statements
WHERE query LIKE '%UPDATE user_profiles SET account_balance%'
  AND query NOT LIKE '%close_goal_session_trade%';
-- Expected: 0 (only close_goal_session_trade updates balance)
```

---

## Architecture Decision Record

**Title:** CCIP Trade Closure Resilience Framework

**Status:** APPROVED

**Context:**
- Production failures: P0001 errors when user profile not found
- Trigger exceptions blocked price updates
- No audit trail for failed closures
- Repeated failures caused system unavailability

**Decision:**
Implement SSOT + CCIP + Governance framework for trade closures with:
1. Centralized close_goal_session_trade RPC as single mutation authority
2. Three-stage validation (CCIP) before any updates
3. Immutable audit trail (closure_audit_log) for all closures
4. Admin alert escalation (admin_alerts) for critical failures
5. Force-close-zero-balance fallback for orphaned trades

**Consequences:**
- Positive: 100% audit coverage, resilient error handling, admin visibility
- Trade-off: Slightly more complex function logic (well-documented)
- Risk: If audit logging fails, critical failures could occur silently (mitigated by separate transaction)

**Compliance:**
- SSOT: ✓ Single authority per responsibility
- CCIP: ✓ Three-stage validation gates
- Governance: ✓ Immutable audit trail + admin alerts

---

**Last Updated:** 2026-01-26
**Version:** 1.0
**Maintainer:** CCIP Governance Framework
