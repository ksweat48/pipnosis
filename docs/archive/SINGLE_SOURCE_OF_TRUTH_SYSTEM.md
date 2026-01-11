# Single Source of Truth System

## Overview

This document describes the **Single Source of Truth (SSOT)** system implemented to eliminate data inconsistencies in the Pipnosis trading platform.

## Problem Statement

Previously, data was calculated and stored in multiple places:
- Balance calculated in frontend hooks AND database functions
- Unrealized P&L calculated in multiple components
- Price data scattered across tables and services
- No guarantee of consistency between frontend and backend
- Race conditions when updating data from multiple places

This caused:
- Users seeing different balances in different parts of the UI
- Unrealized P&L not matching actual position values
- Balance calculation errors after trades closed
- Debug nightmares trying to find where data came from

## Solution: Database as SSOT

**RULE: The database is the ONLY source of truth for all critical data.**

Frontend code should NEVER calculate:
- User balance
- Unrealized P&L
- Position P&L
- Total balance

Instead, frontend code should CALL database functions that return calculated values.

## Database Functions (SSOT API)

### 1. `get_user_balance(user_id)`

Returns the user's realized balance (closed trades only).

```sql
SELECT get_user_balance('user-uuid-here');
-- Returns: 10000.00
```

**Source**: `user_profiles.account_balance`

**Frontend Usage**:
```typescript
const { data, error } = await supabase
  .rpc('get_user_balance', { p_user_id: userId });
```

---

### 2. `get_unrealized_pnl(user_id)`

Calculates total unrealized P&L from all open positions.

```sql
SELECT get_unrealized_pnl('user-uuid-here');
-- Returns: 150.25
```

**Source**: Calculates from `goal_session_trades WHERE status = 'open'`

**Frontend Usage**:
```typescript
const { data, error } = await supabase
  .rpc('get_unrealized_pnl', { p_user_id: userId });
```

---

### 3. `get_total_balance(user_id)`

Returns balance + unrealized P&L + metadata.

```sql
SELECT get_total_balance('user-uuid-here');
-- Returns JSON:
{
  "balance": 10000.00,
  "unrealized_pnl": 150.25,
  "total_balance": 10150.25,
  "open_positions_count": 3,
  "calculated_at": "2025-12-31T05:00:00Z"
}
```

**Frontend Usage**:
```typescript
const { data, error } = await supabase
  .rpc('get_total_balance', { p_user_id: userId });

if (data) {
  setBalance(data.balance);
  setUnrealizedPnL(data.unrealized_pnl);
  setTotalBalance(data.total_balance);
  setOpenPositionsCount(data.open_positions_count);
}
```

---

### 4. `get_latest_price(symbol)`

Returns the latest market price for a symbol.

```sql
SELECT get_latest_price('EURUSD');
-- Returns JSON:
{
  "symbol": "EURUSD",
  "bid": 1.10245,
  "ask": 1.10255,
  "mid": 1.10250,
  "spread": 0.00010,
  "broker_time": "2025-12-31T05:00:00Z",
  "age_seconds": 2.5
}
```

**Source**: `realtime_prices` table (populated by Netlify functions)

**Frontend Usage**:
```typescript
const { data, error } = await supabase
  .rpc('get_latest_price', { p_symbol: 'EURUSD' });

if (data && !data.error) {
  setCurrentPrice(data.mid);
}
```

---

### 5. `get_position_current_pnl(position_id)`

Calculates real-time P&L for a single position using latest price.

```sql
SELECT get_position_current_pnl('position-uuid-here');
-- Returns: 45.50
```

**Source**:
- Position data from `goal_session_trades`
- Current price from `realtime_prices`
- Uses SAME calculation logic as `close_goal_session_trade()`

**Frontend Usage**:
```typescript
const { data, error } = await supabase
  .rpc('get_position_current_pnl', { p_position_id: positionId });
```

---

### 6. `get_open_positions_summary(user_id)`

Returns all open positions with current prices and P&L.

```sql
SELECT get_open_positions_summary('user-uuid-here');
-- Returns JSON array:
[
  {
    "id": "position-uuid-1",
    "symbol": "EURUSD",
    "direction": "buy",
    "entry_price": 1.10200,
    "current_price": 1.10250,
    "lot_size": 0.1,
    "stop_loss": 1.10150,
    "take_profit": 1.10300,
    "current_pnl": 50.00,
    "opened_at": "2025-12-31T04:00:00Z"
  },
  ...
]
```

**Frontend Usage**:
```typescript
const { data, error } = await supabase
  .rpc('get_open_positions_summary', { p_user_id: userId });

if (data) {
  setPositions(data);
}
```

---

## Frontend Implementation Rules

### ✅ CORRECT: Call database functions

```typescript
// useUserBalance.ts
const refreshBalance = async () => {
  // SINGLE SOURCE OF TRUTH: Call database function
  const { data, error } = await supabase
    .rpc('get_total_balance', { p_user_id: userId });

  if (data) {
    setBalance(data.balance);
    setTotalPnL(data.unrealized_pnl);
  }
};
```

### ❌ INCORRECT: Calculate locally

```typescript
// DON'T DO THIS!
const refreshBalance = async () => {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('account_balance');

  const { data: positions } = await supabase
    .from('goal_session_trades')
    .select('current_pnl');

  // ❌ BAD: Calculating locally
  const totalPnL = positions.reduce((sum, pos) => sum + pos.current_pnl, 0);
  setBalance(profile.account_balance);
  setTotalPnL(totalPnL);
};
```

---

## Benefits of SSOT System

### 1. **Guaranteed Consistency**
- All components see the same data
- No race conditions
- No "stale" calculations

### 2. **Single Place to Fix Bugs**
- Bug in P&L calculation? Fix in database function
- Automatically fixes all components

### 3. **Easier Testing**
- Test database functions once
- Frontend just displays values

### 4. **Better Performance**
- Database calculations are optimized
- Uses indexes efficiently
- Less data transfer to frontend

### 5. **Audit Trail**
- Database logs show all calculations
- Can trace where values come from

---

## Migration Strategy

### Phase 1: ✅ Create Database Functions (DONE)
- Created all 6 SSOT functions
- Added proper indexes
- Granted permissions

### Phase 2: ✅ Update Core Hooks (DONE)
- `useUserBalance` → uses `get_total_balance()`
- `BalanceDisplay` → uses `get_total_balance()`

### Phase 3: Update Remaining Components (IN PROGRESS)
Components that need updating:
- `ActivePositions.tsx` → use `get_open_positions_summary()`
- `GoalSessionDashboard.tsx` → use database functions
- `position-monitor.ts` → use `get_position_current_pnl()`

### Phase 4: Remove Local Calculations
- Delete all local balance calculation code
- Delete all local P&L calculation code
- Keep only database function calls

---

## Testing Checklist

- [ ] Balance displays correctly in header
- [ ] Unrealized P&L updates in real-time
- [ ] Total balance = balance + unrealized P&L
- [ ] Opening a trade updates balance correctly
- [ ] Closing a trade updates balance correctly
- [ ] Multiple components show same balance
- [ ] No console errors about missing data

---

## Database Migration

The SSOT system was created in migration:
```
supabase/migrations/20251231050000_create_single_source_of_truth_system.sql
```

To verify it's installed:
```sql
-- Check if functions exist
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name LIKE 'get_%';
```

---

## Troubleshooting

### Issue: "Function get_total_balance does not exist"

**Solution**: Run the migration:
```bash
supabase db reset
```

### Issue: "Balance is 0 or NULL"

**Solution**: Check if user profile exists:
```sql
SELECT account_balance FROM user_profiles WHERE id = 'user-uuid';
```

### Issue: "Unrealized P&L is 0 but I have open positions"

**Solution**: Check if positions have current prices:
```sql
SELECT id, symbol, current_price, current_pnl
FROM goal_session_trades
WHERE status = 'open';
```

### Issue: "Price data is stale"

**Solution**: Check realtime_prices table:
```sql
SELECT symbol, mid, created_at,
  EXTRACT(EPOCH FROM (NOW() - created_at)) as age_seconds
FROM realtime_prices
ORDER BY created_at DESC
LIMIT 10;
```

If age_seconds > 60, price collection is not running.

---

## Summary

**Golden Rule**: Frontend READS, Database CALCULATES.

Always use database functions:
- `get_user_balance()` for realized balance
- `get_unrealized_pnl()` for open position P&L
- `get_total_balance()` for everything at once
- `get_latest_price()` for current prices
- `get_position_current_pnl()` for individual position P&L
- `get_open_positions_summary()` for all positions

Never calculate balance, P&L, or prices locally in frontend code.

---

## Related Files

- Migration: `supabase/migrations/20251231050000_create_single_source_of_truth_system.sql`
- Hook: `src/hooks/useUserBalance.ts`
- Component: `src/components/BalanceDisplay.tsx`
- Service: `src/services/position-service.ts`

---

**Last Updated**: 2025-12-31
**Status**: Active
**Version**: 1.0
