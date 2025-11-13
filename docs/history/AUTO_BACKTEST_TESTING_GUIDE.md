# Auto-Backtest Progress Testing Guide

## Quick Verification Steps

### 1. Start the Auto-Backtest System

1. Navigate to: **AI Training & Backtesting Lab** page
2. Click the **"Auto-Backtest"** tab (has "NEW" badge)
3. Click the **"Start Auto-Backtest"** button (green)
4. Status should change to **"Running Auto-Backtests"** with green indicator

### 2. Wait for First Job (30-45 seconds)

The system uses cron jobs that run at these intervals:
- **Runner**: Every 30 seconds (queues jobs)
- **Executor**: Every 15 seconds (processes jobs)

Maximum wait time for first progress: **45 seconds**

### 3. Verify Progress is Displayed

You should see a section appear: **"Currently Running (1)"**

Inside, you'll see a card showing:

```
Auto-BT-2025-11-12T14-23-45
━━━━━━━━━━━━━━━━━━━━ 35%

Generating synthetic candles (175/500)
Phase: Loading Data
⚡ 12.5 candles/second
📊 0 trades executed | Win Rate: 0.0%
⏱️ Est. completion: 26 seconds

Memory: 45 MB | CPU: 8%
```

### 4. Watch Progress Advance

The progress should move through these phases:

1. **0-10%**: "Initializing backtest"
2. **10-40%**: "Generating synthetic candles (X/500)"
   - Updates every 50 candles
   - Shows processing speed

3. **40%**: "Creating backtest session"
   - Brief transition phase

4. **60-90%**: "Simulating trades (X/12)"
   - Updates for each trade
   - Win/loss counts increment
   - Win rate percentage updates

5. **90%**: "Calculating metrics"
   - Final calculations

6. **100%**: "Backtest completed"
   - Moves to "Recently Completed" section

### 5. Check Queue Stats

The **"Job Queue Status"** section should show:

- **Pending**: 0 (after pickup)
- **Processing**: 1 (while running)
- **Completed**: Increments when done
- **Failed**: Should stay 0 (unless error)

### 6. Verify Completion

After backtest completes (~30-60 seconds):

1. Card disappears from "Currently Running"
2. Appears in **"Recently Completed"** section
3. Shows final stats:
   - Total trades executed
   - Final win rate percentage
   - Completion timestamp
   - Duration in seconds

## Expected Timings

- **Total backtest duration**: 30-60 seconds
- **Progress updates**: Every 2-5 seconds
- **Candle generation**: 10-30 seconds (depending on date range)
- **Trade simulation**: 5-15 seconds
- **Metrics calculation**: <1 second

## Troubleshooting

### Progress Stuck at 0%

**Cause**: Cron jobs may not be running or Edge Function hasn't been deployed

**Check**:
```sql
-- In Supabase SQL Editor
SELECT * FROM backtest_progress_tracking
WHERE status = 'running'
ORDER BY started_at DESC;
```

**Should show**: Active progress record with incrementing fields

### No "Currently Running" Section

**Cause**: Job hasn't been queued or picked up yet

**Wait**: Up to 45 seconds (30s for runner + 15s for executor)

**Check queue**:
```sql
SELECT * FROM auto_backtest_queue
WHERE status = 'pending'
ORDER BY created_at DESC;
```

### Progress Stuck at Same Percentage

**Cause**: Edge Function may have crashed or lost connection

**Check execution logs**:
```sql
SELECT * FROM backtest_execution_logs
ORDER BY timestamp DESC
LIMIT 20;
```

**Action**: Click "Stop Auto-Backtest" and restart

### Queue Shows Multiple Pending Jobs

**Cause**: Executor may not be processing jobs

**Check**:
1. Go to Supabase Dashboard
2. Navigate to Edge Functions
3. Check logs for `auto-backtest-executor`
4. Look for errors or warnings

## Database Inspection

### View Active Backtests

```sql
SELECT
  backtest_id,
  current_step,
  progress_percentage,
  phase,
  current_candle,
  total_candles,
  trades_executed,
  current_win_rate,
  status,
  started_at,
  last_updated_at
FROM backtest_progress_tracking
WHERE status = 'running'
ORDER BY started_at DESC;
```

### View Recent Execution Logs

```sql
SELECT
  step_name,
  step_type,
  status,
  message,
  timestamp
FROM backtest_execution_logs
ORDER BY timestamp DESC
LIMIT 50;
```

### Check Queue Status

```sql
SELECT
  status,
  COUNT(*) as count
FROM auto_backtest_queue
GROUP BY status;
```

### View Controller State

```sql
SELECT
  status,
  is_active,
  total_backtests_completed,
  current_cycle_count,
  system_stress_score,
  last_backtest_completed_at
FROM auto_backtest_controller
WHERE is_active = true;
```

## Success Indicators

✅ **Progress bar animates** from 0% to 100%
✅ **Step descriptions change** through phases
✅ **Candle count increments** (e.g., 150/500 → 200/500)
✅ **Trade count increments** (e.g., 5 → 6 → 7)
✅ **Win rate updates** in real-time
✅ **Processing speed shown** (candles/second)
✅ **Estimated completion time** displayed
✅ **Completes within 60 seconds**
✅ **Appears in Recently Completed** section

## What Good Progress Looks Like

### At 10%
```
Initializing backtest
Phase: Initializing
```

### At 25%
```
Generating synthetic candles (125/500)
Phase: Loading Data
⚡ 15.3 candles/second
⏱️ Est. completion: 24 seconds
```

### At 65%
```
Simulating trades (8/12)
Phase: Analyzing
📊 8 trades executed | Win Rate: 62.5%
```

### At 100%
```
Backtest completed
Phase: Completed
📊 12 trades executed | Win Rate: 58.3%
Total P&L: $145.20
```

## Performance Benchmarks

- **Candle generation rate**: 10-20 candles/second
- **Trade simulation**: 1-3 trades/second
- **Database writes**: <100ms per update
- **Memory usage**: 30-60 MB
- **CPU usage**: 5-15%

## Next Test: Multiple Concurrent Backtests

After verifying single backtest works:

1. Let first backtest complete
2. System automatically queues next job after delay (1-20 seconds)
3. Should see new backtest appear in "Currently Running"
4. Can have up to 2-3 running simultaneously
5. Each shows independent progress

## What to Report if Issues Found

Include this information:

1. **Browser console logs** (F12 → Console tab)
2. **Screenshot of the page** showing stuck state
3. **Time since clicking "Start"**
4. **Queue stats** (Pending/Processing/Completed/Failed counts)
5. **Database query results** (if accessible)

## Edge Function Logs

To check Edge Function execution:

1. Go to Supabase Dashboard
2. Click **Edge Functions** in sidebar
3. Click on **auto-backtest-executor**
4. View **Logs** tab
5. Look for:
   - "[Auto-Backtest Executor] Starting job processing..."
   - "[Auto-Backtest Executor] Processing job XXX for user YYY"
   - "[Auto-Backtest Executor] Job XXX completed successfully"

Any errors will appear here with stack traces.

## Final Checklist

- [ ] Clicked "Start Auto-Backtest"
- [ ] Status shows "Running Auto-Backtests"
- [ ] Waited at least 45 seconds
- [ ] "Currently Running" section appeared
- [ ] Progress bar moved from 0% upward
- [ ] Step descriptions changed
- [ ] Candle count incremented
- [ ] Trade count incremented
- [ ] Win rate percentage displayed
- [ ] Backtest completed to 100%
- [ ] Appeared in "Recently Completed"
- [ ] Can see final stats (trades, win rate, P&L)

If all items checked: **✅ PROGRESS TRACKING IS WORKING!**
