# Auto-Backtest System Flow Diagnosis

## Current Status

**Problem**: Jobs are being created and queued ("Pending: 1, 5...") but never execute. They stay in "pending" status forever.

## Complete System Flow (How It Should Work)

```
1. User clicks "Start Auto-Backtest"
   ↓
2. autoBacktestAPI.start() → calls Edge Function `auto-backtest-control`
   ↓
3. Edge Function creates controller record in `auto_backtest_controller` table
   ↓
4. Frontend starts `autoBacktestJobMonitor` (browser-based)
   ↓
5. Job Monitor polls queue every 10 seconds for pending jobs
   ↓
6. When pending jobs found → calls `auto-backtest-executor` Edge Function
   ↓
7. Executor picks up pending jobs and runs them
   ↓
8. Executor updates progress tracking in real-time
   ↓
9. Completed jobs show in dashboard with win rates
```

## What's Currently Happening

```
1. ✅ User clicks "Start Auto-Backtest"
2. ✅ Controller created (Total Backtests: 115, Status: Active)
3. ✅ Job Monitor starts
4. ❌ Jobs created by cron/runner but STUCK in pending
5. ❌ No logs showing executor being called
6. ❌ Progress tracking never initialized
```

## Root Cause

The **auto-backtest-runner** Edge Function (triggered by cron) is creating jobs:

```typescript
// This runs and queues jobs successfully
await queueBacktestJob(supabase, jobConfig);
```

But those jobs **never get processed** because:

### Issue 1: Job Monitor Not Detecting Jobs

The job monitor checks for pending jobs:

```typescript
const { data: pendingJobs } = await supabase
  .from('auto_backtest_queue')
  .select('id, session_name, status')
  .eq('user_id', userId)  // ← This might be filtering incorrectly!
  .eq('status', 'pending')
```

**Possible Problem**: The jobs might be created without a user_id, or with a different user_id than expected.

### Issue 2: Edge Function URL Might Be Wrong

The job monitor calls:

```typescript
const EDGE_FUNCTION_URL = `${supabaseUrl}/functions/v1/auto-backtest-executor`;
```

This assumes the executor is deployed and accessible.

## Debugging Steps

### Step 1: Check if jobs have user_id

Run this query in Supabase SQL editor:

```sql
SELECT
  id,
  user_id,
  session_name,
  status,
  created_at
FROM auto_backtest_queue
WHERE status = 'pending'
ORDER BY created_at DESC
LIMIT 10;
```

### Step 2: Check if executor Edge Function is deployed

Look in Supabase Dashboard → Edge Functions. You should see:
- `auto-backtest-control` ✓
- `auto-backtest-runner` ✓
- `auto-backtest-executor` ← **THIS ONE MUST EXIST**

### Step 3: Manually test the executor

In browser console, run:

```javascript
const supabaseUrl = 'YOUR_SUPABASE_URL';
const token = 'YOUR_ACCESS_TOKEN';

fetch(`${supabaseUrl}/functions/v1/auto-backtest-executor`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({})
})
.then(r => r.json())
.then(console.log)
.catch(console.error);
```

## Quick Fix To Test

### Fix 1: Make Job Monitor More Verbose

The job monitor should log when it finds jobs. Check browser console for:

```
[Job Monitor] 📋 Found X pending job(s), triggering executor...
[Job Monitor] 🎯 Calling executor Edge Function...
```

If you DON'T see these logs, the monitor isn't finding jobs.

### Fix 2: Check Job Creation

When auto-backtest starts, the runner should create jobs. Check if:

```sql
SELECT COUNT(*) FROM auto_backtest_queue WHERE status = 'pending';
```

Returns > 0.

### Fix 3: Bypass Monitor and Directly Call Executor

For testing, you can manually trigger execution by calling the executor directly:

```javascript
// In browser console
const { data: { session } } = await supabase.auth.getSession();
const response = await fetch(
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-backtest-executor`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`
    },
    body: JSON.stringify({})
  }
);
const result = await response.json();
console.log('Executor result:', result);
```

## Expected Console Output When Working

```
[Auto-Backtest Dashboard] Calling start API...
[Auto-Backtest Dashboard] ✅ Started successfully
[Auto-Backtest Dashboard] 🔧 Starting job monitor...
[Job Monitor] 🚀 Starting job monitor service...
[Job Monitor] 📋 Found 1 pending job(s), triggering executor...
[Job Monitor] 🎯 Calling executor Edge Function...
[Job Monitor] ✅ Executor completed: {processed: 1, ...}
[Auto-Backtest API] Found 1 active backtest(s)
[Auto-Backtest Dashboard] Active backtests found: 1
```

## Next Steps

1. Check browser console for job monitor logs
2. Verify Edge Functions are deployed
3. Check database for pending jobs with user_id
4. Manually trigger executor to test
5. If executor works manually, issue is in job monitor polling

## Files to Check

- `/src/services/auto-backtest-job-monitor.ts` - Client-side job polling
- `/supabase/functions/auto-backtest-executor/index.ts` - Server-side job executor
- `/supabase/functions/auto-backtest-runner/index.ts` - Job creator (cron-triggered)
- `/supabase/migrations/20251112200000_fix_progress_tracking_win_rate.sql` - Progress tracking functions
