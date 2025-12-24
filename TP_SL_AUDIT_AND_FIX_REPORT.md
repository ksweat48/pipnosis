# TP/SL System Audit & Fix Report

## Executive Summary

Critical bugs discovered in the goal achievement and P&L calculation logic that caused a LOSING trade to be incorrectly flagged as a WINNING trade.

## The User's Trade (Evidence)

- **Trade ID**: `a76c4f33-ec25-43d1-b1e5-7e8d3c2e0f7e`
- **Symbol**: EURUSD
- **Direction**: BUY
- **Entry Price**: 1.18012
- **Exit Price**: 1.17858 (at Stop Loss 1.17903)
- **Actual P&L**: -$205.42 (LOSS)
- **Final Status**: Closed at stop_loss ✅ CORRECT

### What Went Wrong

1. **At 13:38:07** - System sent notification: "🎯 Goal Achieved! Your $200 goal has been reached with current P&L of $206.75"
2. **At 13:38:09** - System closed trade at stop loss with P&L of -$205.42
3. **Result**: User received contradictory messages saying they both won (+$206.75) AND lost (-$205.42)

## Root Cause Analysis

### Bug #1: P&L Sign Inversion in trade-lifecycle-manager.ts

**Location**: `src/services/trade-lifecycle-manager.ts` lines 817-822

**The Buggy Code**:
```typescript
const pipDistance = calculatePipDistance(trade.symbol, trade.entry_price, price);
const dollarPerPip = calculateDollarPerPip(trade.symbol, trade.position_size);
const unrealizedPL = trade.direction === 'buy'
  ? pipDistance * dollarPerPip      // ❌ ALWAYS POSITIVE
  : -pipDistance * dollarPerPip;    // ❌ ALWAYS NEGATIVE
```

**The Problem**:
- `calculatePipDistance()` uses `Math.abs()` and ALWAYS returns POSITIVE numbers
- For BUY trades: `unrealizedPL = positive * positive = ALWAYS POSITIVE` ❌
- For SELL trades: `unrealizedPL = -(positive * positive) = ALWAYS NEGATIVE` ❌

**The Reality**:
- User had BUY trade at 1.18012
- Price moved DOWN to 1.17857 (LOSS of 154.5 pips)
- But code calculated: 154.5 pips × $1.33/pip = **+$206.75** ❌ WRONG SIGN
- Should have been: **-$206.75** ✅ CORRECT

**Why This Happened**:
The code doesn't check if price moved FAVORABLY or UNFAVORABLY. It assumes:
- BUY = always profit (wrong!)
- SELL = always loss (wrong!)

### Bug #2: Goal Achievement Logic Doesn't Validate Sign

**Location**: `src/services/position-monitor.ts` line 477

**The Code**:
```typescript
if (goalSession && !goalSession.goal_achieved_at && pnl >= goalSession.target_value) {
  console.log(`[PositionMonitor] 🎯 GOAL REACHED! Target: $${goalSession.target_value}, Current P&L: $${pnl.toFixed(2)}`);
```

**The Problem**:
- This check is CORRECT: `pnl >= goalSession.target_value`
- But it's receiving WRONG P&L values from Bug #1
- When Bug #1 passes +$206.75 instead of -$206.75, this check incorrectly triggers

### Bug #3: Peak Profit Not Recorded

**Location**: `src/services/position-monitor.ts` lines 126-130

**The Code**:
```typescript
// Update max_profit if current PnL is more positive
const newMaxProfit = pnl > currentMaxProfit ? pnl : currentMaxProfit;
```

**The Problem**:
- This logic is CORRECT
- But with Bug #1 providing wrong P&L values, max_profit gets corrupted
- User's trade shows: `max_profit: 0` and `max_drawdown: -206.75`
- The -$206.75 should have been recorded as max_drawdown (which it was), but because of sign inversion, the positive value never existed to record as max_profit

## The Complete Timeline

1. **10:01:25** - Trade opened: EURUSD BUY at 1.18012
2. **13:38:07** - Price at 1.17857 (154.5 pips DOWN = $206.75 LOSS)
   - Bug #1 calculates: +$206.75 ❌
   - System triggers goal achievement
   - Records `goal_met_at`, creates achievement record
   - Sends "Goal Achieved!" notification
3. **13:38:09** - Database trigger fires
   - Sees price 1.17858 <= stop_loss 1.17903
   - Closes trade using `close_goal_session_trade()` RPC
   - RPC uses CORRECT P&L calculation: -$205.42 ✅
   - Sends "Stop Loss Hit" notification
4. **Result**: User gets both "Goal Achieved! +$206.75" AND "Stop Loss Hit: -$205.42"

## Why The Database Was Correct

The PostgreSQL `close_goal_session_trade()` function (from migration `20251219223702_create_universal_pnl_calculator_final.sql`) uses the CORRECT calculation:

```sql
v_pips := calculate_pip_distance(p_symbol, p_entry_price, p_exit_price);
v_dpp := calculate_dollar_per_pip(p_symbol, p_lot_size);
v_diff := CASE
  WHEN p_direction = 'buy' THEN p_exit_price - p_entry_price
  ELSE p_entry_price - p_exit_price
END;
RETURN ROUND(CASE
  WHEN v_diff >= 0 THEN v_pips * v_dpp
  ELSE -v_pips * v_dpp
END, 2);
```

This is why:
- Final `profit_loss` = -$205.42 ✅ CORRECT
- `close_reason` = 'stop_loss' ✅ CORRECT
- `status` = 'closed' ✅ CORRECT

## The Fix

### Fix #1: Correct P&L Calculation in trade-lifecycle-manager.ts

Replace lines 817-822 with:

```typescript
const pipDistance = calculatePipDistance(trade.symbol, trade.entry_price, price);
const dollarPerPip = calculateDollarPerPip(trade.symbol, trade.position_size);

// Calculate signed price movement
const priceDiff = trade.direction === 'buy'
  ? price - trade.entry_price      // For BUY: profit if price goes UP
  : trade.entry_price - price;      // For SELL: profit if price goes DOWN

// Apply sign to pip distance based on favorable/unfavorable movement
const unrealizedPL = priceDiff >= 0
  ? pipDistance * dollarPerPip      // Profit (price moved favorably)
  : -pipDistance * dollarPerPip;    // Loss (price moved unfavorably)
```

### Fix #2: Use Existing calculatePnL() Function

The codebase ALREADY has a correct implementation in `src/types/position.ts` lines 194-219. We should USE IT instead of reimplementing:

```typescript
import { calculatePnL } from '@/types/position';

// Replace the buggy calculation with:
const unrealizedPL = calculatePnL(
  trade.direction,
  trade.entry_price,
  price,
  trade.position_size,
  trade.symbol
);
```

### Fix #3: Add Safety Validation

Add validation to prevent goal achievement on negative P&L:

```typescript
// In position-monitor.ts line 477
if (goalSession && !goalSession.goal_achieved_at && pnl >= goalSession.target_value) {
  // SAFETY CHECK: Never trigger goal on negative P&L
  if (pnl < 0) {
    console.error(`[PositionMonitor] ⚠️ PREVENTED FALSE GOAL: P&L is ${pnl.toFixed(2)} but triggered >= ${goalSession.target_value}`);
    return;
  }

  console.log(`[PositionMonitor] 🎯 GOAL REACHED! Target: $${goalSession.target_value}, Current P&L: $${pnl.toFixed(2)}`);
  // ... rest of goal achievement logic
}
```

## Testing The Fix

Using the user's exact trade scenario:
- Entry: 1.18012
- Current: 1.17857
- Direction: BUY
- Lot Size: 1.33

**Before Fix**:
- `priceDiff` = not calculated
- `pipDistance` = 154.5 (always positive)
- `unrealizedPL` = 154.5 * 1.33 = +$205.485 ❌ WRONG

**After Fix**:
- `priceDiff` = 1.17857 - 1.18012 = -0.00155 (negative = unfavorable)
- `pipDistance` = 154.5 (positive)
- `priceDiff >= 0` = FALSE
- `unrealizedPL` = -154.5 * 1.33 = -$205.485 ✅ CORRECT

## Impact Assessment

### Systems Affected
1. ✅ **Database close function**: WORKING CORRECTLY (no changes needed)
2. ❌ **Position monitor**: Uses CORRECT `calculatePnL()` function
3. ❌ **Trade lifecycle manager**: BUGGY - needs fix
4. ✅ **Goal achievement detection**: Logic is correct, receives bad data
5. ❌ **Max profit tracking**: Corrupted by wrong P&L values

### Notifications Affected
1. "Goal Achieved" modal - triggered incorrectly
2. "Stop Loss Hit" notification - triggered correctly
3. Achievement records - created incorrectly

## Recommendations

1. **Immediate**: Apply Fix #1 and Fix #2 to use the existing correct `calculatePnL()` function
2. **Safety**: Add Fix #3 validation to prevent future false triggers
3. **Code Review**: Search for ALL uses of `calculatePipDistance()` and verify they handle signs correctly
4. **Data Cleanup**: Check if any other trades have this corruption and fix historical records
5. **Testing**: Add unit tests for BUY losing trades and SELL losing trades

## Conclusion

The system had DUAL P&L calculation implementations:
- ✅ PostgreSQL function: CORRECT (used for final trade closure)
- ❌ TypeScript `trade-lifecycle-manager.ts`: BUGGY (used for monitoring)

This created a race condition where:
1. Monitoring detected "goal achieved" with buggy +$206.75
2. Database trigger closed at SL with correct -$205.42
3. User received contradictory messages

The fix is simple: Use the existing CORRECT `calculatePnL()` function everywhere instead of reimplementing it incorrectly.
