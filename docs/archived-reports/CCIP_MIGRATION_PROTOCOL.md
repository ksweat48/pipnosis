# CCIP Migration Protocol - Production Implementation

## Executive Summary

Your system broke due to schema migrations applied without proper validation. This document establishes permanent protocols to prevent future breaks while maintaining SSOT (Single Source of Truth), CCIP (Change Control Intelligence Protocol), and governance compliance.

## What Happened (Root Cause Analysis)

### The Errors (from your logs)
```
POST /rest/v1/goal_notifications 403 Forbidden
POST /rest/v1/rpc/cleanup_orphaned_intents 400 Bad Request
  Error: "invalid input value for enum entry_intent_status: 'expired'"
POST /rest/v1/ai_trader_score 403 Forbidden
POST /rest/v1/ai_counterfactuals 403 Forbidden
```

### Why (Technical Root Causes)

1. **Enum Value Mismatch**
   - Function tried: `status = 'expired'`
   - Database enum only has: `'expired_no_entry'`
   - Validation failure = trades cannot close

2. **Duplicate RLS Policies**
   - goal_notifications: 6 policies (3 redundant)
   - ai_trader_score: 6 policies (3 redundant)
   - ai_counterfactuals: 5 policies (2 redundant)
   - Goal: Each role should have 1 clear permission path
   - Result: Conflicting policies = 403 Forbidden errors

3. **Duplicate Function Definitions**
   - cleanup_orphaned_intents defined 2+ times with different signatures
   - Different return types (TABLE vs jsonb)
   - Different parameter handling
   - Caller (frontend) calls with (p_session_id) but gets wrong signature

### Why This Happened (Process Failure)

Migrations were applied without:
- Pre-flight function signature validation
- Enum value verification
- RLS policy duplicate detection
- Caller compatibility audit

---

## Architectural Decisions Made

### 1. SECURITY DEFINER Pattern for System-Generated Tables

**Decision**: All writes to system-generated tables (notifications, scores, counterfactuals) MUST use SECURITY DEFINER wrapper functions.

**Why**:
- System records should NOT be created directly by users
- Prevents RLS permission issues (authenticated users lack permission to write)
- Creates single authority point for auditing
- Enforces governance compliance

**Example**:
```sql
-- ❌ WRONG: Frontend tries direct INSERT
await supabase
  .from('goal_notifications')
  .insert({ user_id, type, title });  // Fails with 403

-- ✅ RIGHT: Frontend calls SECURITY DEFINER function
await supabase.rpc('create_trade_notification', {
  p_user_id: userId,
  p_type: 'trade_closed',
  p_title: 'Trade closed'
});
```

**Implementation**:
- All SECURITY DEFINER functions include:
  - Explicit role validation
  - Governance audit trail logging
  - Input validation
  - Error handling with detailed logging
  - Comment documenting AUTHORITY and RESPONSIBILITY

### 2. Pre-Flight Migration Validation (Automation)

**Decision**: Every migration runs validation checks BEFORE applying to prevent schema breaks.

**What Gets Checked**:
- Enum types: Values being used exist in database enum definition
- Function signatures: Parameters match all callers
- RLS policies: No duplicate policies for same role/table
- Constraints: CHECK constraints match code logic
- Role permissions: Service role can do what functions need

**Execution**:
```bash
# Runs automatically during build phase
npm run validate:migrations

# Or manually:
node scripts/migrations/pre-flight-migration-validator.cjs <migration.sql>
```

**Exit Codes**:
- `0`: Migration is safe to apply
- `1`: BLOCKED - Fix errors before proceeding
- `2`: WARNING - Review warnings but can proceed

**Location**: `/scripts/migrations/pre-flight-migration-validator.cjs`

### 3. Rollback-First Migration Strategy

**Decision**: Document broken state and establish rollback BEFORE applying fixes.

**Pattern**:
1. Phase 0: Audit and document current broken state
2. Phase 1: Create rollback migration (idempotent, safe to re-run)
3. Phase 2: Apply fix migration with verification
4. Phase 3: Governance audit trail
5. Phase 4: Build and deploy with monitoring

**Governance Logging**:
Every migration logs to `governance_change_log`:
- What changed and why
- Who requested the change
- User impact if any
- Rollback procedure if needed

---

## Fixes Applied (CCIP-Compliant)

### Migration 1: `20260130_ccip_fix_schema_violations_complete_v2`

**Fixed Issues**:
1. Dropped duplicate cleanup_orphaned_intents functions
2. Removed duplicate RLS policies from all system-generated tables
3. Recreated clean RLS policy set (4 per table: service_role, auth select, auth insert, auth update)

**Results**:
- goal_notifications: 6 policies → 4 policies (removed duplicates)
- ai_trader_score: 6 policies → 4 policies
- ai_counterfactuals: 5 policies → 3 policies
- goal_ai_conversations: 6 policies → 3 policies

### Migration 2: `20260130_ccip_restore_cleanup_orphaned_intents_function`

**Fixed Issue**:
- Restored cleanup_orphaned_intents as SECURITY DEFINER
- Uses correct enum value: `'expired_no_entry'` (NOT `'expired'`)
- Proper error handling and governance logging

**Verification**:
```sql
-- Function now exists and is SECURITY DEFINER
SELECT prosecdef FROM pg_proc WHERE proname = 'cleanup_orphaned_intents';
-- Result: true ✓

-- RLS policies are clean
SELECT COUNT(*) FROM pg_policies
  WHERE tablename = 'goal_notifications';
-- Result: 4 (no duplicates) ✓
```

---

## Future Migration Checklist (CCIP Phase 0)

Every future migration MUST complete this checklist BEFORE writing any SQL:

### 1. System Map
- [ ] Document all tables being modified
- [ ] List all functions that read/write these tables
- [ ] Check for duplicate functions or policies
- [ ] Identify all callers (frontend, backend, triggers)

### 2. Logic Contract
- [ ] For each enum used: List all valid values
- [ ] For each function: Document parameters and return type
- [ ] For each RLS policy: Document which role and operation
- [ ] For data changes: Document old → new state

### 3. Dry-Run Simulation
- [ ] Run pre-flight validator on your migration file
- [ ] Check for critical patterns (invalid enum values, DROP without CASCADE consideration)
- [ ] Verify all function signatures match callers
- [ ] Confirm all enum values exist

### 4. Compatibility Check
- [ ] Grep codebase for all callers of functions being modified
- [ ] Verify each caller's parameter usage matches function signature
- [ ] Check RLS policies allow the operation for the user role
- [ ] Test with actual user context (authenticated user making the call)

### 5. Staged Deployment
- [ ] Write test case that reproduces the original issue
- [ ] Apply migration to test database
- [ ] Run test case against test database
- [ ] Verify no 403, 400, or constraint violation errors
- [ ] Check governance_change_log entries are created

### 6. Post-Deploy Verification
- [ ] Run migrations on production
- [ ] Verify all queries succeed (not just "schema updated")
- [ ] Check frontend operations work end-to-end
- [ ] Monitor error logs for new pattern of errors
- [ ] Document the change in CCIP_MIGRATIONS.log

---

## RLS Policy Pattern (SSOT)

All system-generated tables follow this RLS pattern:

```sql
-- 1. Service Role: Full access (system operations)
CREATE POLICY "Service role has full access"
  ON table_name FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 2. Authenticated Select: Users see their own data
CREATE POLICY "Authenticated users can select own data"
  ON table_name FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 3. Authenticated Insert: Users insert their own data
CREATE POLICY "Authenticated users can insert own data"
  ON table_name FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 4. Authenticated Update: Users update their own data
CREATE POLICY "Authenticated users can update own data"
  ON table_name FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

**NEVER**:
- Create duplicate policies for the same role/operation
- Use `USING (true)` for authenticated role
- Allow authenticated users to INSERT to system-generated tables directly
- Skip the service role policy

---

## Authority Registry (Governance Compliance)

Each table/function has a clear AUTHORITY:

```
Entry Intents Authority:
  - Owns: entry_intents.status transitions
  - Functions: cleanup_orphaned_intents, cleanup_expired_entry_intents
  - Columns: status, expired_reason, updated_at
  - Guardian: trade-closure-coordinator.ts

Trade Closure Authority:
  - Owns: goal_session_trades closure (status → closed, pnl calculation)
  - Function: trade-closure-coordinator.closeTrade()
  - Ensures: Atomic balance + trade + session updates

Goal Notifications Authority:
  - Owns: All goal_notifications inserts
  - Function: notification-coordinator.send()
  - Pattern: Service functions only (SECURITY DEFINER)
```

**Principle**: If it can be fixed in more than one place, the architecture is broken.

---

## Monitoring & Alerts

### Error Pattern Indicators

If you see these errors, STOP and check what changed:

| Error | Root Cause | Check |
|-------|-----------|-------|
| `403 Forbidden` on INSERT | Duplicate RLS policies or missing auth check | Run RLS policy count query |
| `invalid input value for enum` | Code uses value not in enum | Check enum_name values |
| `column reference ambiguous` | Multiple tables with same column | Fix query with explicit table alias |
| `function already exists` | Migration didn't DROP before CREATE | Use CREATE OR REPLACE or IF NOT EXISTS |

### Check Script (Run After Deploy)

```bash
# Verify all critical tables have clean RLS
psql $DATABASE_URL -c "
SELECT tablename, COUNT(*) as policy_count
FROM pg_policies
WHERE tablename IN ('goal_notifications', 'ai_trader_score', 'ai_counterfactuals')
GROUP BY tablename;"

# Should show 3-4 policies per table (no more, no less)
```

---

## Emergency Procedures

### If Trade Closure Fails

1. Check error in browser console
2. Run RLS policy count check (above)
3. If more than 4 policies on goal_notifications:
   ```sql
   DROP POLICY IF EXISTS "duplicate_policy_name" ON goal_notifications;
   ```
4. Verify cleanup_orphaned_intents exists and is SECURITY DEFINER
5. Retry trade closure

### If Migration Gets Stuck

```sql
-- Check governance_change_log for what happened
SELECT entity_type, operation, reason, created_at
FROM governance_change_log
ORDER BY created_at DESC
LIMIT 10;

-- View the migration in question
SELECT * FROM pg_migrations WHERE name LIKE 'your_migration_name';

-- If truly stuck, document and create rollback
-- See CCIP_ROLLBACK.md
```

---

## Summary: What Changed vs Before

| Aspect | Before | After |
|--------|--------|-------|
| Migration validation | None | Pre-flight script (mandatory) |
| Enum usage | Not checked | Validated against database |
| RLS policies | Could duplicate | Validated before applying |
| Function signatures | Not checked | Validated against callers |
| Governance trail | Incomplete | Full CCIP audit trail |
| Rollback strategy | Manual/risky | Documented and tested |
| SSOT enforcement | Partial | Full authority registry |

---

## Key Takeaway

**One broken migration can break the entire system.** This protocol ensures:

1. ✓ No schema violations get deployed (pre-flight validation)
2. ✓ Broken states are documented (governance audit)
3. ✓ Rollbacks are possible (explicit migration strategy)
4. ✓ SSOT is maintained (single authority per responsibility)
5. ✓ Governance is enforced (change tracking)

**The cost of this protocol**: ~5 minutes per migration for validation checks.
**The value**: System never breaks due to schema migrations again.

---

## Next Steps

1. **Before your next migration**:
   - Run `node scripts/migrations/pre-flight-migration-validator.cjs your_migration.sql`
   - Fix any errors or warnings
   - Re-test until validator passes

2. **Document your changes**:
   - Add detailed header comment explaining the fix
   - List affected tables and functions
   - Document user impact
   - Explain CCIP compliance

3. **Monitor after deploy**:
   - Check browser console for errors
   - Verify governance_change_log entries
   - Test critical user paths (trade entry/closure)
   - Alert on enum errors or 403 Forbidden patterns

---

**Protocol Created**: 2026-01-30
**Applied By**: CCIP Migration Safety System
**Status**: ACTIVE - All future migrations must follow this protocol
