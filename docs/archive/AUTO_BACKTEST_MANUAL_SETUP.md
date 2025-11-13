# Auto-Backtest System - Manual Setup Guide

## ✅ Deployment Status

### Completed
- ✅ Database migrations applied
- ✅ `auto_backtest_queue` table created
- ✅ `auto_backtest_controller` table exists
- ✅ `auto_backtest_config` table exists
- ✅ `auto_backtest_health_log` table exists
- ✅ Edge Functions deployed:
  - `auto-backtest-runner` (ACTIVE)
  - `auto-backtest-executor` (ACTIVE)
  - `auto-backtest-control` (ACTIVE)
- ✅ Frontend dashboard updated with new API

### Remaining: Set Up Cron Jobs

Since we can't automatically set up the cron jobs from here, you have **two options**:

## Option 1: Manual Cron Setup (Recommended for Production)

Run this SQL in your Supabase SQL Editor:

```sql
-- Enable pg_cron extension (already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule runner job - every 30 seconds
-- This checks controllers and queues new jobs
SELECT cron.schedule(
  'auto-backtest-runner-job',
  '30 seconds',
  $$
  SELECT
    net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/auto-backtest-runner',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Schedule executor job - every 15 seconds
-- This processes pending jobs from the queue
SELECT cron.schedule(
  'auto-backtest-executor-job',
  '15 seconds',
  $$
  SELECT
    net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/auto-backtest-executor',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key')
      ),
      body := '{}'::jsonb
    );
  $$
);

-- Schedule cleanup job - daily at 3 AM
-- This removes old jobs and logs
SELECT cron.schedule(
  'auto-backtest-cleanup-job',
  '0 3 * * *',
  $$SELECT cleanup_old_auto_backtest_jobs()$$
);

-- Verify cron jobs are scheduled
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'auto-backtest-%';
```

## Option 2: Manual Testing (Quick Start)

You can manually trigger the Edge Functions for testing:

### 1. Start an Auto-Backtest Session

Go to your application:
1. Navigate to **AI Training & Backtesting Lab**
2. Click the **"Auto-Backtest"** tab
3. Click **"Start Auto-Backtest"**

### 2. Manually Trigger Runner (Creates Jobs)

Use curl or your Supabase dashboard:

```bash
curl -X POST \
  https://YOUR_PROJECT.supabase.co/functions/v1/auto-backtest-runner \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 3. Manually Trigger Executor (Processes Jobs)

```bash
curl -X POST \
  https://YOUR_PROJECT.supabase.co/functions/v1/auto-backtest-executor \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 4. Check Status

```bash
curl -X POST \
  https://YOUR_PROJECT.supabase.co/functions/v1/auto-backtest-control \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "status"}'
```

## Verification Steps

### 1. Check Controller Status

```sql
SELECT
  user_id,
  status,
  is_active,
  total_backtests_completed,
  current_cycle_count,
  system_stress_score,
  cooldown_active
FROM auto_backtest_controller
WHERE is_active = true;
```

### 2. Check Queue Status

```sql
SELECT
  status,
  COUNT(*) as count
FROM auto_backtest_queue
GROUP BY status;
```

### 3. Check Recent Jobs

```sql
SELECT
  session_name,
  status,
  risk_level,
  result_win_rate,
  result_total_pnl,
  created_at,
  completed_at
FROM auto_backtest_queue
ORDER BY created_at DESC
LIMIT 10;
```

### 4. Check Health Logs

```sql
SELECT
  stress_score,
  database_response_ms,
  error_rate_percent,
  action_taken,
  logged_at
FROM auto_backtest_health_log
ORDER BY logged_at DESC
LIMIT 20;
```

## Testing the Complete Flow

1. **Start the system** via the UI (click "Start Auto-Backtest")
2. **Manually run runner** (or wait for cron if set up)
3. **Check queue** - should see "pending" jobs
4. **Manually run executor** (or wait for cron)
5. **Check queue again** - should see "completed" jobs
6. **Check dashboard** - stats should update
7. **Close browser** - system continues if cron is set up

## Expected Behavior

With cron jobs active:
- Runner executes every 30 seconds
- Executor executes every 15 seconds
- New jobs are queued automatically
- Jobs are processed automatically
- Health is monitored continuously
- Cooldowns trigger automatically
- System pauses for live trades
- Browser can be closed

## Troubleshooting

### No jobs being created
- Check if controller is active: `SELECT * FROM auto_backtest_controller WHERE is_active = true;`
- Manually call runner function
- Check Edge Function logs in Supabase dashboard

### Jobs stuck in "pending"
- Manually call executor function
- Check for errors in Edge Function logs
- Verify synthetic_generations and synthetic_backtest_sessions tables exist

### High stress score
- System will automatically cooldown
- Check health logs: `SELECT * FROM auto_backtest_health_log ORDER BY logged_at DESC LIMIT 10;`
- Adjust thresholds in Settings modal

### Cron jobs not running
- Verify they're scheduled: `SELECT * FROM cron.job WHERE jobname LIKE 'auto-backtest-%';`
- Check cron job history: `SELECT * FROM cron.job_run_details WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'auto-backtest-%') ORDER BY start_time DESC LIMIT 20;`

## Success Criteria

✅ Controller shows "Running Auto-Backtests" in dashboard
✅ Queue stats show pending → processing → completed flow
✅ Total backtests completed counter increases
✅ Health metrics are being logged
✅ Dashboard updates in real-time
✅ System continues after closing browser (with cron)

## Next Steps

Once cron jobs are set up, the system will be **fully autonomous**. You can:
- Adjust settings via the Settings modal
- Monitor health in real-time
- View completed backtests
- System handles cooldowns automatically
- Pauses for live trades automatically

**Note**: Without cron jobs, you'll need to manually trigger the runner and executor functions for testing.
