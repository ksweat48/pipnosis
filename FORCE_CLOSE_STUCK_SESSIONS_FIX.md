# Force Close Stuck Sessions - CCIP-Compliant Fix

## Issue Summary
The "Force Close Stuck Sessions" button in the Admin Dashboard was failing with two errors:

1. **Frontend Error**: `showConfirm is not a function`
2. **Database Error**: `column reference "user_id" is ambiguous`

## CCIP Analysis

### Phase 1: System Map
- **Component**: Admin Dashboard → UserManagementPanel
- **Service**: admin-user-service.ts
- **Database**: force_close_stale_scanning_sessions() function
- **Flow**: Button Click → Confirm Dialog → Service Call → Database RPC → Update goal_sessions

### Phase 2: Logic Contract Violations

#### Frontend Violation
**Location**: `src/components/admin/UserManagementPanel.tsx:37`

**Problem**: Hook destructuring mismatch
```typescript
// INCORRECT:
const { showConfirm } = useConfirmDialog();
```

**Root Cause**: The `useConfirmDialog` hook exports `confirm`, not `showConfirm`

**SSOT Violation**: The hook's API contract (defined in useConfirmDialog.tsx) is the single source of truth, but the consumer was using a non-existent property.

#### Database Violation
**Location**: `supabase/migrations/.../force_close_stale_scanning_sessions()`

**Problem**: Ambiguous column reference
```sql
RETURNING id, user_id, EXTRACT(...) / 60
```

**Root Cause**: The function declares `user_id` in its RETURNS TABLE clause, and PostgreSQL cannot determine if `user_id` in the RETURNING clause refers to:
- The function's return parameter
- The goal_sessions table column

**SSOT Violation**: The function signature (RETURNS TABLE) is the contract, but the implementation created ambiguity by not explicitly qualifying which `user_id` to return.

### Phase 3: Fixes Applied

#### Fix 1: Frontend Hook Usage
**File**: `src/components/admin/UserManagementPanel.tsx`

```typescript
// BEFORE:
const { showConfirm } = useConfirmDialog();

// AFTER:
const { confirm: showConfirm } = useConfirmDialog();
```

**SSOT Compliance**: Correctly destructures the actual export (`confirm`) and aliases it to maintain existing code's variable name.

#### Fix 2: Database Function Qualification
**File**: `supabase/migrations/fix_force_close_ambiguous_user_id.sql`

```sql
-- BEFORE (AMBIGUOUS):
RETURNING id, user_id, EXTRACT(EPOCH FROM (NOW() - scanning_started_at)) / 60

-- AFTER (EXPLICIT):
RETURNING
  goal_sessions.id,
  goal_sessions.user_id,
  EXTRACT(EPOCH FROM (NOW() - goal_sessions.scanning_started_at)) / 60
```

**SSOT Compliance**:
- Function signature unchanged (maintains contract)
- All column references fully qualified with table name
- Eliminates ambiguity without changing behavior

### Phase 4: Compatibility Check
- No breaking changes to function signature
- No changes to return type structure
- Frontend service layer (admin-user-service.ts) requires no changes
- All existing callers remain compatible

### Phase 5: Post-Deploy Verification
The function now:
1. Accepts admin confirmation from UI
2. Validates admin permissions in database
3. Finds sessions stuck for >30 minutes
4. Updates their status to 'user_stopped'
5. Returns the closed sessions with unambiguous column references

## Testing Verification

### Expected Behavior
1. Admin clicks "Force Close Stuck Sessions" button
2. Confirmation dialog appears
3. If confirmed, database function executes
4. Sessions scanning >30 minutes are closed
5. Toast notification shows count of closed sessions
6. Dashboard refreshes to show updated state

### Success Criteria
- No "showConfirm is not a function" error
- No "column reference is ambiguous" database error
- Stuck sessions are successfully closed
- User count badge decrements correctly

## Architecture Compliance

### SSOT Principles Maintained
1. **useConfirmDialog hook** is the single authority for dialog API
2. **force_close_stale_scanning_sessions()** is the single authority for closing stuck sessions
3. **goal_sessions table** is the single source of truth for session state

### CCIP Process Followed
- ✅ System Map: Identified all components in the flow
- ✅ Logic Contract: Found contract violations (hook API, SQL ambiguity)
- ✅ Dry-Run: Verified fixes don't break existing behavior
- ✅ Compatibility: No breaking changes to any interface
- ✅ Staged Deployment: Applied migration then deployed frontend
- ✅ Verification: Can test in production admin dashboard

## Deployment Status
- ✅ Frontend fix deployed
- ✅ Database migration applied
- ✅ Build successful
- ✅ Netlify deployment triggered

## Related Files
- `src/components/admin/UserManagementPanel.tsx`
- `src/hooks/useConfirmDialog.tsx`
- `src/services/admin-user-service.ts`
- `supabase/migrations/fix_force_close_ambiguous_user_id.sql`
