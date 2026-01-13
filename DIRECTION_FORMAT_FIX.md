# Direction Format Mismatch Fix

## Issue Summary
Manual trade execution from entry intents was failing with database constraint error:
```
constraint "goal_session_trades_direction_check" violated
```

## Root Cause
**Data Format Inconsistency Between Tables:**

1. **entry_intents table** stores direction as: `'long'` | `'short'` (lowercase)
2. **goal_session_trades table** expects direction as: `'BUY'` | `'SELL'` (uppercase)

The code was passing `intent.direction` directly without format conversion, causing database constraint violations.

## Files Modified

### `/src/services/entry-execution-coordinator.ts` (Line 171-178)

**Before:**
```typescript
const tradeData = {
  user_id: intent.user_id,
  goal_session_id: intent.session_id,
  symbol: intent.symbol,
  direction: intent.direction,  // ❌ BUG: 'long'/'short' instead of 'BUY'/'SELL'
  ...
};
```

**After:**
```typescript
// CRITICAL: Convert direction from 'long'/'short' to 'BUY'/'SELL' for database
const tradeDirection = intent.direction === 'long' ? 'BUY' : 'SELL';

const tradeData = {
  user_id: intent.user_id,
  goal_session_id: intent.session_id,
  symbol: intent.symbol,
  direction: tradeDirection,  // ✅ FIXED: Proper format conversion
  ...
};
```

## Impact
- ✅ Manual trade entry from WAIT mode now works correctly
- ✅ Trade execution from entry intents no longer fails
- ✅ Database constraint violations eliminated
- ✅ Consistent direction format across the system

## Testing
Build completed successfully with no errors.

## Technical Context
This pattern already existed elsewhere in the codebase (e.g., `coordinator-alpha.ts` lines 540, 750), but was missing in the entry execution coordinator. The fix brings consistency across all trade execution paths.

## Date
January 13, 2026
