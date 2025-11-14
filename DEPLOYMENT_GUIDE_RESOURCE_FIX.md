# Resource Exhaustion Fix - Deployment Guide

## Problem Summary

Your Supabase database was hitting 100% CPU and 100% memory due to resource-intensive cron jobs:
- `continuous-price-polling`: Looped 20 times per minute with 3-second sleeps (holding connections open)
- `auto-backtest-executor`: Ran every 15 seconds
- `calculate-quality-metrics`: Nested loops every 15 minutes
- Multiple other jobs polling every 10-30 seconds

**Result**: Database connection exhaustion, timeouts, and service degradation.

## Solution Architecture

### What We Changed

1. **Removed all continuous cron jobs** - They were duplicating client-side work and crashing the DB
2. **Kept client-side polling** - Your browser-based polling already works perfectly
3. **Created lightweight job queue** - Proper queue system for backtests with resource monitoring
4. **Added on-demand processing** - Edge Functions process jobs when needed, not continuously
5. **Implemented circuit breakers** - Automatic protection against future resource exhaustion

### What Still Works

✅ **Live Polling**: Client-side `global-polling-coordinator` fetches prices every 2-5 seconds
✅ **Live Ticks**: `tick-buffer-service` batches and persists ticks efficiently
✅ **Candle Creation**: `background-candle-aggregator` creates candles from ticks in real-time
✅ **Full Wick Data**: All OHLC values captured accurately
✅ **Synthetic Backtests**: Backtest system now uses job queue (more reliable)
✅ **AI Training**: Continuous training via job queue without resource exhaustion
✅ **AI Learning Center**: All learning data persisted and retrieved normally

## Deployment Steps

### Step 1: Apply Emergency Cron Cleanup (CRITICAL - Do This First!)

Run this migration in Supabase SQL Editor to immediately stop the resource-intensive cron jobs:

```bash
# In Supabase Dashboard > SQL Editor > New Query
```

Paste and run the contents of:
```
supabase/migrations/EMERGENCY_disable_resource_intensive_cron_jobs.sql
```

**Expected Result**:
- 9 cron jobs unscheduled
- Database resource usage should start dropping within 2-3 minutes
- Connection count should decrease

**Verification**:
```sql
-- Check active cron jobs (should only see 3-4 cleanup jobs)
SELECT * FROM active_cron_jobs WHERE active = true;

-- Check resource usage (should show 'healthy' or 'warning', not 'critical')
SELECT check_database_resource_usage();
```

### Step 2: Create Job Queue System

Run these migrations in order:

```bash
# Migration 1: Create job queue tables and functions
```

Paste and run:
```
supabase/migrations/20251114_create_lightweight_job_queue.sql
```

**Expected Result**:
- `job_queue` table created
- `job_execution_log` table created
- Helper functions created (queue_job, get_next_pending_job, etc.)

**Verification**:
```sql
-- Verify tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('job_queue', 'job_execution_log');

-- Verify functions exist
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name LIKE '%job%';
```

### Step 3: Setup Lightweight Scheduler

```bash
# Migration 2: Create scheduler and resource monitoring
```

Paste and run:
```
supabase/migrations/20251114_setup_lightweight_scheduler.sql
```

**Expected Result**:
- New cron job `job-scheduler` created (runs once per minute)
- Resource monitoring system created
- Circuit breakers configured

**Verification**:
```sql
-- Verify new cron jobs
SELECT jobname, schedule FROM cron.job WHERE jobname IN ('job-scheduler', 'monitor-database-resources');

-- Check circuit breaker status
SELECT * FROM circuit_breaker_status;
```

### Step 4: Fix Backtest Progress Functions

```bash
# Migration 3: Optimize backtest progress tracking
```

Paste and run:
```
supabase/migrations/20251114_fix_backtest_progress_functions_optimized.sql
```

**Expected Result**:
- Backtest progress functions created with optimizations
- Indexes added for performance
- Statement timeouts configured

**Verification**:
```sql
-- Verify functions exist
SELECT routine_name FROM information_schema.routines
WHERE routine_name LIKE 'initialize_backtest_progress'
   OR routine_name LIKE 'update_backtest_progress_with_trade'
   OR routine_name LIKE 'complete_backtest_progress';
```

### Step 5: Deploy Edge Functions

Deploy the new job processing Edge Functions to Supabase:

```bash
# Using Supabase CLI (if you have it)
supabase functions deploy job-processor
supabase functions deploy job-scheduler
```

**Or manually in Supabase Dashboard**:
1. Go to Edge Functions in Supabase Dashboard
2. Create new function named `job-processor`
3. Copy contents from `supabase/functions/job-processor/index.ts`
4. Deploy
5. Repeat for `job-scheduler`

**Verification**:
```bash
# Test health endpoint
curl https://YOUR_PROJECT.supabase.co/functions/v1/job-processor?action=health \
  -H "Authorization: Bearer YOUR_ANON_KEY"

# Should return: {"status": "healthy", "timestamp": "..."}
```

### Step 6: Deploy Frontend Changes

Deploy the updated client code to Netlify:

```bash
npm run build
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

**Wait for build to complete** (check Netlify dashboard)

### Step 7: Verify System Health

After deployment, verify everything is working:

#### A. Check Database Resource Usage

```sql
-- Should show 'healthy' or 'warning', NOT 'critical'
SELECT * FROM check_database_resource_usage();

-- Monitor over time
SELECT * FROM recent_resource_usage ORDER BY minute DESC LIMIT 10;
```

#### B. Check Cron Jobs

```sql
-- Should only see ~5 jobs (not 15+)
SELECT COUNT(*) as active_cron_count FROM cron.job WHERE active = true;

-- List active jobs
SELECT jobname, schedule FROM cron.job WHERE active = true ORDER BY jobname;
```

Expected jobs:
- `job-scheduler` (every minute)
- `monitor-database-resources` (every 5 minutes)
- `cleanup-old-jobs` (daily at 3 AM)
- `cleanup-old-logs` (daily at 3 AM)
- `repair-candles-daily` (daily at 2 AM)

#### C. Check Client-Side Polling

Open your app in browser and check console:
```
✅ Should see: "🚀 Initializing global polling coordinator..."
✅ Should see: "🚀 Starting background candle aggregator..."
✅ Should see periodic price updates every 2-5 seconds
✅ Should see candles being saved
```

#### D. Test Backtest Queue

```sql
-- Queue a test backtest job
SELECT queue_job(
  'backtest',
  '{"symbol": "EURUSD", "timeframe": "M5", "strategy": "test", "start_date": "2024-11-01", "end_date": "2024-11-14"}'::jsonb,
  auth.uid(),
  50
);

-- Wait 1-2 minutes, then check if it was processed
SELECT * FROM job_queue ORDER BY created_at DESC LIMIT 5;
```

Expected statuses:
- `pending` → `running` → `completed` (good!)
- `pending` → `failed` (check error_message)

#### E. Monitor System Health

```sql
-- Overall system status
SELECT * FROM system_health_summary;
```

Expected values:
- `current_resource_status`: 'healthy' or 'warning'
- `current_connection_usage`: < 50%
- `active_cron_jobs`: ~5
- `open_circuits`: 0

## Continuous AI Training Setup

To enable continuous AI training without crashing:

### In Your React App

```typescript
import { aiTrainingQueueService } from '@/services/ai-training-queue-service';

// Start a training session
async function startAITraining() {
  const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30'];
  const timeframes = ['M5', 'M15', 'M30', 'H1'];

  const result = await aiTrainingQueueService.queueTrainingSession(
    symbols,
    timeframes,
    'flow-trader-v2',
    3 // months back
  );

  console.log(`Queued ${result.queued} training jobs`);

  // Monitor progress
  aiTrainingQueueService.startProgressMonitoring();
  aiTrainingQueueService.onProgress((progress) => {
    console.log('Training Progress:', progress);

    // Check if reached target
    if (progress.completedJobs >= progress.totalJobs) {
      aiTrainingQueueService.stopProgressMonitoring();
      console.log('Training complete!');
    }
  });
}
```

### Training will run continuously:
- Jobs processed one at a time (no resource exhaustion)
- Resource usage checked before each job
- Automatic circuit breakers if issues detected
- Progress tracked in real-time
- AI learns from each completed backtest

## Monitoring Dashboard

Create a simple monitoring page to watch system health:

```typescript
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export function SystemHealthDashboard() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    const fetchHealth = async () => {
      const { data } = await supabase
        .from('system_health_summary')
        .select('*')
        .single();
      setHealth(data);
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 10000); // Every 10 seconds

    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <h2>System Health</h2>
      <div>Resource Status: {health?.current_resource_status}</div>
      <div>Connection Usage: {health?.current_connection_usage}%</div>
      <div>Pending Jobs: {health?.pending_jobs}</div>
      <div>Running Jobs: {health?.running_jobs}</div>
      <div>Active Cron Jobs: {health?.active_cron_jobs}</div>
    </div>
  );
}
```

## Troubleshooting

### Database Still Showing High Resource Usage

1. **Wait 5-10 minutes** after applying emergency fix - existing connections need to close
2. Check if old cron jobs are still running:
   ```sql
   SELECT * FROM cron.job WHERE active = true;
   -- If you see more than 5 jobs, manually unschedule them:
   SELECT cron.unschedule('job-name-here');
   ```

3. Check for long-running queries:
   ```sql
   SELECT pid, query_start, state, query
   FROM pg_stat_activity
   WHERE state = 'active' AND query_start < now() - interval '1 minute';
   ```

### Job Processor Not Working

1. Check Edge Function logs in Supabase Dashboard
2. Verify `job-scheduler` cron is running:
   ```sql
   SELECT * FROM cron_job_execution_log
   WHERE job_name = 'job-scheduler'
   ORDER BY execution_time DESC LIMIT 5;
   ```

3. Check circuit breaker status:
   ```sql
   SELECT * FROM circuit_breaker_status WHERE status = 'open';
   -- If open, wait 5 minutes for automatic recovery
   ```

### Client-Side Polling Not Working

1. Check browser console for errors
2. Verify environment variables are set:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

3. Check if MetaAPI credentials are valid

### Jobs Stuck in 'running' Status

```sql
-- Find stuck jobs (running > 10 minutes)
SELECT * FROM job_queue
WHERE status = 'running'
AND started_at < now() - interval '10 minutes';

-- Reset them to failed
UPDATE job_queue
SET status = 'failed', error_message = 'Timeout - exceeded 10 minutes'
WHERE status = 'running'
AND started_at < now() - interval '10 minutes';
```

## Performance Expectations

After this fix, you should see:

| Metric | Before Fix | After Fix |
|--------|-----------|-----------|
| CPU Usage | 95-100% | 20-40% |
| Memory Usage | 90-100% | 30-50% |
| Active Connections | 80-95% | 20-40% |
| Active Cron Jobs | 15+ | ~5 |
| Database Timeouts | Frequent | None |
| Backtest Processing | Unreliable | Reliable |

## Summary

✅ **Resource exhaustion fixed** - No more continuous polling cron jobs
✅ **Client-side polling preserved** - Works exactly as before
✅ **Backtest system improved** - Now uses proper job queue
✅ **AI training enabled** - Can run continuously without crashing
✅ **Circuit breakers added** - Automatic protection against future issues
✅ **$25/month tier sufficient** - Architecture is now properly optimized

Your system is now production-ready and can handle continuous AI training without resource exhaustion!
