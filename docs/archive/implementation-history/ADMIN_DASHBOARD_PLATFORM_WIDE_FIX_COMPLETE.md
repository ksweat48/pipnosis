# Admin Dashboard Platform-Wide Data Fix - Complete

## Issue Summary
Admin Dashboard was showing errors when loading platform-wide metrics because:
1. Mastery Curve was passing admin's `user_id` instead of `null` for platform-wide aggregation
2. Queries were using wrong table/column names after `trade_history` consolidation
3. `goal_session_trades` schema mismatch (no `outcome` or `pnl` columns)

## Fixes Applied

### 1. Admin Dashboard - Force Platform-Wide View
**File**: `src/pages/AdminDashboard.tsx`

**Change**:
```typescript
// OLD: Passed admin user's ID
<PipnosisMasteryCurve userId={user?.id || null} />

// NEW: Explicitly pass null for platform-wide data
<PipnosisMasteryCurve userId={null} />
```

**Impact**: Mastery Curve now correctly aggregates ALL users' data instead of just admin's data.

### 2. Admin Dashboard - Fix 24h Win Rate Query
**File**: `src/pages/AdminDashboard.tsx`

**Change**:
```typescript
// OLD: Used non-existent 'outcome' column
.select('outcome')
const winningTrades = recentTrades?.filter(t => t.outcome === 'win')

// NEW: Use actual 'profit_loss' column and derive outcome
.select('profit_loss, status')
.eq('status', 'closed')
const winningTrades = recentTrades?.filter(t => (t.profit_loss || 0) > 0)
```

**Impact**: 24h win rate calculation now works correctly using closed trades with positive profit.

### 3. Mastery Curve Service - Fix Trade Data Query
**File**: `src/services/mastery-curve-service.ts`

**Changes**:
1. **Removed fallback to deleted `trade_history` table**
   - Table was dropped in migration `20251211022701_consolidate_to_goal_based_only.sql`

2. **Fixed column names**:
   ```typescript
   // OLD: Non-existent columns
   .select('created_at, outcome, pnl, user_id')

   // NEW: Actual schema with join
   .select(`
     created_at,
     profit_loss,
     goal_sessions!inner(user_id)
   `)
   ```

3. **Added proper join for user filtering**:
   ```typescript
   if (userId) {
     query = query.eq('goal_sessions.user_id', userId);
   }
   ```

4. **Fixed aggregation to use correct field**:
   ```typescript
   // OLD: trade.pnl
   // NEW: trade.profit_loss
   agg.totalEV += trade.profit_loss || 0;
   ```

**Impact**: EV data now loads correctly from `goal_session_trades` with proper user filtering via join.

## Schema Reference

### goal_session_trades
```sql
CREATE TABLE goal_session_trades (
  id uuid PRIMARY KEY,
  goal_session_id uuid REFERENCES goal_sessions(id),
  profit_loss numeric DEFAULT 0,        -- NOT 'pnl'
  status text CHECK (status IN ('pending', 'open', 'closed', 'rejected')),
  created_at timestamptz DEFAULT now()
  -- NO 'outcome' column - derive from profit_loss
  -- NO 'user_id' - must join with goal_sessions
);
```

### goal_sessions
```sql
CREATE TABLE goal_sessions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),  -- User relationship here
  status text,
  starting_balance numeric,
  current_progress numeric,
  created_at timestamptz DEFAULT now()
);
```

## Testing

Build Status: ✅ **SUCCESS**

All queries now:
- Use correct table names (`goal_session_trades` only, no `trade_history`)
- Select actual columns (`profit_loss` not `pnl`, no `outcome`)
- Properly join with `goal_sessions` for user filtering
- Aggregate platform-wide data when `userId` is `null`

## Result

Admin Dashboard now displays true platform-wide collective intelligence:
- **Mastery Curve**: Aggregates all users' AI evolution
- **24h Win Rate**: Calculates across all platform trades
- **Skill Level**: Averages all users' progression
- **Learning Insights**: Sums all discovered patterns
- **Token Usage**: Tracks total platform LLM costs

Every user's goal session contributes to the collective learning visible to admins.
