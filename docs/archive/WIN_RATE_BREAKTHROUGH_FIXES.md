# Win Rate Spread and Breakthrough Display Fixes

## Summary
Fixed two critical issues in the Plateau Breakthrough Dashboard:
1. Win rate spread showing stuck at "0.0%" (low end) due to invalid sessions with no trades
2. "Last Breakthrough" always displaying "Never" with unclear meaning

## Issues Identified

### Issue 1: Win Rate Spread - Low Number Stuck at 0.0%
**Root Cause**: Sessions with 0 trades and 0% win rates were being included in plateau analysis, skewing the minimum win rate calculation.

**Example**: Dashboard showed "0.0% - 63.6%" with "63.6% spread" because sessions that completed with no trades executed were being counted as valid data points.

### Issue 2: Last Breakthrough Always Shows "Never"
**Root Cause**: Two factors:
1. No breakthrough milestones had been recorded yet (expected if breakthrough mode hasn't found 5%+ improvements)
2. Unclear messaging about what this metric represents

**Explanation**: "Last Breakthrough" tracks when the AI discovers a strategy that improves win rate by 5%+ through the breakthrough engine. It shows "Never" until a successful breakthrough occurs.

## Changes Made

### 1. Plateau Detector (`src/services/plateau-detector.ts`)

#### Added Minimum Trade Count Requirement
```typescript
private readonly MIN_TRADES_REQUIRED = 5;
```

#### Enhanced Session Filtering
- Added database-level filters for valid sessions:
  - `not('total_trades', 'is', null)` - Exclude NULL trade counts
  - `gt('total_trades', 0)` - Exclude sessions with zero trades

- Added application-level validation:
  ```typescript
  const validSessions = data
    .filter(s => {
      const totalTrades = s.total_trades || 0;
      const winRate = parseFloat(s.win_rate?.toString() || '0');
      return totalTrades >= this.MIN_TRADES_REQUIRED && winRate > 0;
    })
  ```

#### Improved Logging
- Added console logs showing how many sessions were filtered out
- Displays reason for filtering (0 trades or < 5 trades)
- Shows count of valid sessions being analyzed

#### Enhanced Breakthrough Query
- Added error logging when milestone query fails
- Added informative console message when no breakthroughs found yet
- Better error handling for database queries

### 2. Breakthrough Engine (`src/services/breakthrough-engine.ts`)

#### Improved Milestone Recording
- Added error handling for milestone insertion:
  ```typescript
  const { error: milestoneError } = await supabase.from('ai_learning_milestones').insert({...});

  if (milestoneError) {
    console.error('[Breakthrough Engine] Failed to record breakthrough milestone:', milestoneError);
  } else {
    console.log('[Breakthrough Engine] ✅ Breakthrough milestone recorded successfully');
  }
  ```

- Fixed `total_trades_at_achievement` to use actual trade count instead of 0

### 3. Dashboard Display (`src/components/PlateauBreakthroughDashboard.tsx`)

#### Enhanced "Last Breakthrough" Display
- Changed message from "No breakthroughs yet" to "Run breakthrough mode when plateaued"
- Added Info icon with hover tooltip explaining what breakthroughs are
- Tooltip text: "A breakthrough occurs when the AI discovers a strategy that improves win rate by 5%+ through experimental testing. Click 'Trigger Breakthrough' when plateaued to search for improvements."

## Impact

### Before Fix
- Win rate range: "0.0% - 63.6%" (misleading due to invalid sessions)
- Last Breakthrough: "Never" with "No breakthroughs yet" (unclear meaning)
- Invalid sessions with 0 trades polluting performance analysis

### After Fix
- Win rate range: Shows accurate range based only on valid sessions with actual trades
- Sessions must have at least 5 trades to be included in analysis
- Clear explanation of what "Last Breakthrough" means via hover tooltip
- Better user guidance: "Run breakthrough mode when plateaued"
- Console logs show data quality filtering statistics

## Data Quality Standards

### Valid Backtest Session Criteria
A session is considered valid for plateau detection if:
1. Status = 'completed'
2. `win_rate` IS NOT NULL
3. `total_trades` IS NOT NULL
4. `total_trades` > 0
5. `total_trades` >= 5 (minimum trades required)
6. `win_rate` > 0

### Sessions Excluded
- Sessions with 0 trades (incomplete or errored runs)
- Sessions with fewer than 5 trades (insufficient data)
- Sessions with NULL win rates or trade counts
- Sessions that didn't complete successfully

## Testing Recommendations

1. **Check Filtered Sessions**: Look at console logs to see how many sessions are being filtered out
   - If many sessions are filtered, investigate why backtests are completing without trades

2. **Verify Win Rate Range**: The minimum should now reflect actual trading performance, not 0%
   - Range should be reasonable (e.g., "55.2% - 68.7%" instead of "0.0% - 68.7%")

3. **Test Breakthrough Mode**: Run breakthrough mode when plateaued
   - If it finds a 5%+ improvement, verify milestone is recorded
   - Check that "Last Breakthrough" updates with the date

4. **Database Query**: Run this to check for invalid sessions:
   ```sql
   SELECT
     COUNT(*) as total_sessions,
     COUNT(CASE WHEN total_trades = 0 THEN 1 END) as zero_trade_sessions,
     COUNT(CASE WHEN total_trades < 5 THEN 1 END) as low_trade_sessions
   FROM synthetic_backtest_sessions
   WHERE status = 'completed';
   ```

## User Guidance

### What is "Last Breakthrough"?
This metric tracks when your AI last discovered a significantly better trading strategy (5%+ win rate improvement) through the breakthrough engine. It shows "Never" until:
1. Performance plateaus (stuck in narrow win rate range for 10+ sessions)
2. You click "Trigger Breakthrough" button
3. The breakthrough engine finds a strategy that improves win rate by 5%+ or more
4. The improvement is recorded as a milestone

### When to Trigger Breakthrough
- When the dashboard shows "Performance Plateau Detected"
- When win rate has been stuck in a narrow range (< 5% spread) for many sessions
- When the "Trigger Breakthrough" button appears
- NOT when you see "Performance Progressing" - let it continue learning naturally

## Files Modified
1. `src/services/plateau-detector.ts` - Added trade count filtering and validation
2. `src/services/breakthrough-engine.ts` - Improved milestone tracking with error handling
3. `src/components/PlateauBreakthroughDashboard.tsx` - Enhanced UI with tooltips and better messaging

## Build Status
✅ Project builds successfully with no errors
