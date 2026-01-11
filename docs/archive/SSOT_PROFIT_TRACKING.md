# Single Source of Truth: Profit Tracking

## Overview

This document establishes `current_progress` as the **Single Source of Truth (SSOT)** for profit tracking in goal sessions.

## The SSOT Fields

### `current_progress` (SSOT)
- **Type**: `NUMERIC` (database) / `number` (TypeScript)
- **Purpose**: Authoritative source for **realized profit** in dollars
- **Update Rule**: Only updated when trades are closed
- **Who Updates**: Database triggers and coordinators
- **85+ References**: Established throughout the codebase

### `progress_percentage` (Derived)
- **Type**: `NUMERIC` (database) / `number` (TypeScript)
- **Purpose**: Derived percentage value for UI display
- **Calculation**: `(current_progress / target_value) * 100`
- **Update Rule**: Calculated automatically, never set directly
- **Who Updates**: Database triggers recalculate when `current_progress` changes

## Architecture Decision

### Why `current_progress` is SSOT

1. **Established Pattern**: 85+ existing references across 25+ files
2. **Stability**: Changing to a new field would require massive refactoring
3. **Risk Mitigation**: Fewer changes = fewer regression bugs
4. **Historical Precedent**: All migrations and code use this field

### What Was Fixed

A recent migration incorrectly introduced `cumulative_profit` references:
- **Problem**: Column doesn't exist in the schema
- **Impact**: Functions writing to non-existent column would fail
- **Solution**: Fixed all references to use `current_progress`

## Database Schema

```sql
-- goal_sessions table (simplified)
CREATE TABLE goal_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  target_value NUMERIC NOT NULL,

  -- SSOT: Realized profit in dollars
  current_progress NUMERIC DEFAULT 0,

  -- Derived: Percentage calculated from current_progress
  progress_percentage NUMERIC DEFAULT 0,

  ...
);
```

## Usage Guidelines

### ✅ Correct Usage

```typescript
// Query the SSOT field
const { data: session } = await supabase
  .from('goal_sessions')
  .select('current_progress, target_value')
  .eq('id', sessionId)
  .single();

const realizedProfit = session.current_progress;
const progressPercent = (realizedProfit / session.target_value) * 100;
```

```sql
-- Update the SSOT (database trigger)
UPDATE goal_sessions
SET
  current_progress = v_closed_trades_pnl,  -- SSOT: dollar amount
  progress_percentage = (v_total_pnl / v_target) * 100  -- Derived
WHERE id = p_session_id;
```

### ❌ Incorrect Usage

```typescript
// DON'T: Query non-existent cumulative_profit
const { data: session } = await supabase
  .from('goal_sessions')
  .select('cumulative_profit')  // ❌ Column doesn't exist!
  .eq('id', sessionId);
```

```typescript
// DON'T: Update progress_percentage directly
await supabase
  .from('goal_sessions')
  .update({
    progress_percentage: 50  // ❌ This is derived, not a source
  });
```

```sql
-- DON'T: Use cumulative_profit
UPDATE goal_sessions
SET cumulative_profit = p_profit  -- ❌ Column doesn't exist!
WHERE id = p_session_id;
```

## Files Updated

### Database Migrations
- `fix_cumulative_profit_ssot_violation.sql` - Fixed trigger functions

### Frontend Services
- `src/services/coordinators/trade-closure-coordinator.ts`
- `src/services/coordinators/goal-achievement-coordinator.ts`
- `src/services/position-monitor.ts`
- `src/services/trade-lifecycle-manager.ts`

### Type Definitions
- `src/services/goal-session-manager.ts` - Added JSDoc comments

## Validation

Run this query to verify SSOT integrity:

```sql
-- Check that current_progress exists and cumulative_profit doesn't
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'goal_sessions'
AND column_name IN ('current_progress', 'cumulative_profit')
ORDER BY column_name;

-- Expected result: Only current_progress should appear
```

## Future Development

When adding new features that track profit:

1. **Always query `current_progress`** for realized profit
2. **Never create new profit columns** - extend existing SSOT
3. **Use `progress_percentage`** for display only
4. **Document any new calculations** that derive from `current_progress`

## Related Systems

- **Goal Achievement**: Uses `current_progress` to detect when goals are met
- **Session Progress Tracking**: Reads `current_progress` for UI updates
- **P&L Calculations**: Sum of closed trade profits writes to `current_progress`
- **Database Triggers**: Automatically update `current_progress` on trade close

---

**Last Updated**: 2026-01-03
**Migration**: `fix_cumulative_profit_ssot_violation.sql`
**Status**: ✅ Enforced
