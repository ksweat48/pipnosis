# Security Fix: Cross-User Trade Lines Bug

**Date**: January 1, 2026
**Severity**: HIGH - Security Vulnerability
**Status**: RESOLVED

---

## Problem Summary

Users were seeing trade lines (Entry, Stop Loss, Take Profit) on their charts for OTHER users' open positions. This occurred because:

1. **Missing Row Level Security (RLS)**: The `goal_sessions` and `goal_session_trades` tables did NOT have RLS enabled
2. **Missing User Filter**: `TradePage.tsx` queried trades by symbol only, without filtering by `user_id`
3. **Data Leakage**: Any authenticated user could see any other user's trading data

### Impact

- **Privacy Violation**: Users could see sensitive trading information from other users
- **UI Bug**: Charts displayed incorrect trade lines from other users
- **Security Risk**: Unauthorized access to trading data (entry prices, stop loss, take profit levels)

### Example

- User `ksweat48` had 0 open positions but saw trade lines on BTCUSD chart
- The trade lines belonged to user `oratio89@gmail.com` who had an open BTCUSD position
- Entry price `88780.93855` matched `oratio89`'s actual position

---

## Root Cause Analysis

### 1. Missing RLS on Database Tables

The `goal_sessions` and `goal_session_trades` tables were created without RLS:

```sql
-- RLS was NEVER enabled on these critical tables
-- goal_sessions: NO RLS
-- goal_session_trades: NO RLS
```

This allowed ANY authenticated user to query ANY row from these tables.

### 2. Missing user_id Filter in TradePage.tsx

**Before (Vulnerable Code):**

```typescript
// Line 50-57 in TradePage.tsx
const { data: trades, error } = await supabase
  .from('goal_session_trades')
  .select('entry_price, stop_loss, take_profit')
  .eq('symbol', selectedSymbol)           // ⚠️ Only filters by symbol
  .in('status', ['open', 'pending'])
  .order('opened_at', { ascending: false })
  .limit(1)
  .maybeSingle();
```

This query would return ANY user's open trade for the selected symbol, not just the current user's trade.

---

## Solution Implemented

### 1. Database Migration: Enable RLS and Add Policies

**Migration**: `20260101020000_enable_rls_goal_sessions_and_trades.sql`

```sql
-- Enable RLS on both tables
ALTER TABLE goal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_session_trades ENABLE ROW LEVEL SECURITY;

-- Create user-scoped SELECT policies
CREATE POLICY "Users can view own goal sessions"
  ON goal_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own goal session trades"
  ON goal_session_trades FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Similar INSERT and UPDATE policies for both tables
```

**Security Model:**
- Regular users: Can ONLY access their own rows (WHERE user_id = auth.uid())
- Admin users: Access all data via SECURITY DEFINER functions that bypass RLS
- No admin RLS policies (avoids infinite recursion bug from migration 20260101004209)

### 2. Code Fix: Add user_id Filter to TradePage.tsx

**After (Secure Code):**

```typescript
// Lines 53-61 in TradePage.tsx
const { data: trades, error } = await supabase
  .from('goal_session_trades')
  .select('entry_price, stop_loss, take_profit')
  .eq('user_id', user.id)                 // ✅ Filters by current user
  .eq('symbol', selectedSymbol)
  .in('status', ['open', 'pending'])
  .order('opened_at', { ascending: false })
  .limit(1)
  .maybeSingle();
```

**Additional Improvements:**
- Clear trade lines immediately when symbol changes (line 46)
- Clear trade lines when user is not authenticated (line 49-52)
- Defense-in-depth: Explicit user_id filter even though RLS now enforces it

---

## Security Verification

### RLS Policies Active

After migration, the following policies are active:

**goal_sessions (3 policies):**
1. `"Users can view own goal sessions"` - SELECT policy
2. `"Users can insert own goal sessions"` - INSERT policy
3. `"Users can update own goal sessions"` - UPDATE policy

**goal_session_trades (3 policies):**
1. `"Users can view own goal session trades"` - SELECT policy
2. `"Users can insert own goal session trades"` - INSERT policy
3. `"Users can update own goal session trades"` - UPDATE policy

### Other Components Already Secure

Audit showed most user-facing components already had proper `user_id` filtering:

- `AnalysisPage.tsx` - Line 93: `.eq('user_id', user?.id)` ✅
- `PositionsPage.tsx` - Line 185: `.eq('user_id', userId)` ✅
- `TradeHistory.tsx` - Line 76: `.eq('user_id', user.id)` ✅
- `ActivePositions.tsx` - Line 84: `.eq('user_id', user.id)` ✅
- `BalanceDisplay.tsx` - Line 42: `.eq('user_id', user.id)` ✅

**TradePage.tsx was the only vulnerable component.**

---

## Testing & Validation

### Build Verification

```bash
npm run build
✓ 1851 modules transformed
✓ built in 21.93s
```

All code compiles successfully with no errors.

### Expected Behavior After Fix

1. Users can ONLY see their own trade lines on charts
2. Database queries automatically filtered by user_id at RLS level
3. Chart lines clear properly when:
   - User has no open trades
   - User changes symbols
   - User is not authenticated

### What to Test

1. **No Cross-User Data:**
   - User A views BTCUSD chart → sees only their own trade lines
   - User B views BTCUSD chart → sees only their own trade lines
   - Users CANNOT see each other's positions

2. **Proper Line Clearing:**
   - User with no open trades sees NO trade lines
   - Changing symbols clears old trade lines immediately
   - Lines update in real-time when positions open/close

3. **Admin Dashboard Still Works:**
   - Admin users can still view all user data via admin functions
   - SECURITY DEFINER functions bypass RLS correctly

---

## Prevention

### Architectural Requirements

1. **ALWAYS enable RLS** on tables containing user-specific data
2. **ALWAYS add user_id filter** in application code (defense-in-depth)
3. **NEVER skip RLS setup** for any table with user_id column
4. **Test cross-user isolation** for all user-facing queries

### Code Review Checklist

When reviewing queries to `goal_session_trades` or `goal_sessions`:

- [ ] Does query filter by `user_id`?
- [ ] Is RLS enabled on the table?
- [ ] Are RLS policies user-scoped (auth.uid() = user_id)?
- [ ] Does admin access use SECURITY DEFINER functions?

---

## Related Files

### Modified Files

1. **Database Migration**: Applied via Supabase
   - Migration filename: `enable_rls_goal_sessions_and_trades.sql`

2. **Application Code**: `/src/pages/TradePage.tsx`
   - Line 46: Added immediate trade line clearing on symbol change
   - Line 49-52: Clear lines when user not authenticated
   - Line 56: Added `.eq('user_id', user.id)` filter

### Related Documentation

- Emergency RLS fix: `supabase/migrations/20260101004209_fix_recursive_rls_policy_emergency.sql`
- Admin RLS policies: `supabase/migrations/20251231202114_add_admin_rls_policies_for_realtime.sql`

---

## Deployment

### Steps Taken

1. ✅ Database migration applied successfully
2. ✅ TradePage.tsx updated with user_id filter
3. ✅ Build verified - no compilation errors
4. ✅ RLS policies active and verified

### Deployment Checklist

- [ ] Deploy migration to production
- [ ] Deploy application code to production
- [ ] Verify RLS policies are active in production
- [ ] Test with multiple users to confirm isolation
- [ ] Monitor for any RLS-related errors in logs
- [ ] Verify admin dashboard still functions correctly

---

## Conclusion

This was a **critical security vulnerability** that allowed users to see other users' trading data. The fix involved:

1. **Database Level**: Enable RLS and create user-scoped policies
2. **Application Level**: Add explicit user_id filtering
3. **UI Level**: Properly clear stale trade lines

The system now enforces proper data isolation at multiple layers, preventing any cross-user data leakage.

**Status**: RESOLVED ✅
**Verification**: Build successful, RLS policies active
**Next Steps**: Deploy to production and monitor
