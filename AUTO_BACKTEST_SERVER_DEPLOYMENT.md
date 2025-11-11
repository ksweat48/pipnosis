# Auto-Backtest Server-Side Deployment Guide

## Overview

The Auto-Backtest system has been completely rebuilt with a server-side architecture that runs independently on Supabase infrastructure. Users can start the system and close their browser - it will continue running 24/7.

## Architecture

### Components

1. **Database Tables**
   - `auto_backtest_controller` - Tracks controller state per user
   - `auto_backtest_config` - User-configurable settings
   - `auto_backtest_queue` - Job queue for pending backtests
   - `auto_backtest_health_log` - Health metrics log

2. **Edge Functions**
   - `auto-backtest-runner` - Checks controllers, queues jobs (runs every 30s)
   - `auto-backtest-executor` - Executes queued backtest jobs (runs every 15s)
   - `auto-backtest-control` - API for start/stop/status operations

3. **Cron Jobs (pg_cron)**
   - Runner job: Every 30 seconds
   - Executor job: Every 15 seconds
   - Cleanup job: Daily at 3 AM

4. **Frontend**
   - `AutoBacktestDashboard.tsx` - React UI component
   - `auto-backtest-api.ts` - API client service

## Deployment Steps

### Step 1: Apply Database Migrations

Run these migrations in order:

```bash
# 1. Apply queue table migration
psql -h your-supabase-db-host \
     -U postgres \
     -d postgres \
     -f supabase/migrations/20251111070000_create_auto_backtest_queue.sql

# 2. Apply cron job setup migration
psql -h your-supabase-db-host \
     -U postgres \
     -d postgres \
     -f supabase/migrations/20251111071000_setup_auto_backtest_cron_jobs.sql
```

Or use Supabase CLI:

```bash
supabase db push
```

### Step 2: Deploy Edge Functions

Deploy the three edge functions:

```bash
# Deploy runner function
supabase functions deploy auto-backtest-runner

# Deploy executor function
supabase functions deploy auto-backtest-executor

# Deploy control API function
supabase functions deploy auto-backtest-control
```

### Step 3: Verify Cron Jobs

Check that cron jobs are scheduled correctly:

```sql
SELECT * FROM cron.job WHERE jobname LIKE 'auto-backtest-%';
```

You should see:
- `auto-backtest-runner-job` (every 30 seconds)
- `auto-backtest-executor-job` (every 15 seconds)
- `auto-backtest-cleanup-job` (daily at 3 AM)

### Step 4: Test the System

1. Log into the application
2. Navigate to AI Training & Backtesting Lab
3. Click the "Auto-Backtest" tab
4. Click "Start Auto-Backtest"
5. Observe the dashboard updating in real-time
6. Close the browser tab and reopen after 1 minute
7. Verify backtests are still being executed

## Health Monitoring

### Real-Time Metrics

The system tracks:
- **System Stress Score (0-100%)** - Composite health metric
- **Database Response Time** - Query performance in ms
- **Error Rate** - Percentage of failed operations
- **Active Backtests** - Currently processing jobs

### Cooldown Triggers

The system automatically enters cooldown when:

1. **Standard Cycle Complete**: After 100 consecutive backtests → 15-min cooldown
2. **High Stress**: Stress score ≥ 80% → 15-min cooldown
3. **Slow Database**: Response time ≥ 5000ms → 10-min cooldown
4. **High Error Rate**: Error rate ≥ 10% → 10-min cooldown
5. **Consecutive Errors**: 3+ errors in a row → 20-min cooldown

### Live Trade Detection

The system automatically pauses when a live demo trade is detected and resumes when the trade closes.

## Configuration

Users can adjust settings via the Settings modal:

- **Max Consecutive Runs**: 10-200 (default: 100)
- **Cooldown Duration**: 5-60 minutes (default: 15)
- **Max Stress Score**: 50-100% (default: 80)
- **Max DB Response**: 1000-10000ms (default: 5000)
- **Backtest Duration Range**: 1-7 days
- **Delay Between Runs**: 1-60 seconds

## Monitoring & Debugging

### Check Controller Status

```sql
SELECT
  user_id,
  status,
  is_active,
  total_backtests_completed,
  current_cycle_count,
  system_stress_score,
  cooldown_active,
  cooldown_reason
FROM auto_backtest_controller
WHERE is_active = true;
```

### Check Queue Status

```sql
SELECT
  status,
  COUNT(*) as count
FROM auto_backtest_queue
GROUP BY status;
```

### View Recent Health Logs

```sql
SELECT
  logged_at,
  stress_score,
  database_response_ms,
  error_rate_percent,
  action_taken
FROM auto_backtest_health_log
ORDER BY logged_at DESC
LIMIT 20;
```

### Check Cron Job Execution

```sql
SELECT
  jobname,
  last_run,
  next_run,
  schedule,
  active
FROM cron.job
WHERE jobname LIKE 'auto-backtest-%';
```

## Troubleshooting

### Issue: No Jobs Being Created

**Solution**: Check if controller is active and running:

```sql
SELECT * FROM auto_backtest_controller WHERE is_active = true;
```

Verify cron jobs are active:

```sql
SELECT * FROM cron.job WHERE jobname = 'auto-backtest-runner-job';
```

### Issue: Jobs Stuck in Processing

**Solution**: Manually reset stuck jobs (only if necessary):

```sql
UPDATE auto_backtest_queue
SET status = 'failed', error_message = 'Timeout - manually reset'
WHERE status = 'processing'
AND started_at < now() - interval '10 minutes';
```

### Issue: Edge Functions Not Executing

**Solution**: Check Edge Function logs in Supabase dashboard under Functions → Logs.

Verify environment variables are set correctly.

### Issue: High Stress Score

**Solution**: System will automatically cooldown. To manually adjust thresholds:

```sql
UPDATE auto_backtest_config
SET max_stress_score = 90
WHERE user_id = '<user-uuid>';
```

## Performance Optimization

### Reduce Load

If system load is too high:

1. Increase delay between runs (Settings → Min/Max Delay)
2. Reduce max consecutive runs before cooldown
3. Increase cooldown duration
4. Raise stress score threshold

### Increase Throughput

If backtests are running too slowly:

1. Decrease delay between runs (minimum 1 second recommended)
2. Increase max consecutive runs (up to 200)
3. Reduce cooldown duration (minimum 5 minutes recommended)

## Cleanup & Maintenance

The system automatically cleans up:
- Completed jobs older than 7 days
- Failed jobs older than 7 days
- Health logs older than 30 days

Manual cleanup if needed:

```sql
DELETE FROM auto_backtest_queue
WHERE status IN ('completed', 'failed')
AND completed_at < now() - interval '7 days';

DELETE FROM auto_backtest_health_log
WHERE logged_at < now() - interval '30 days';
```

## Security Considerations

1. **RLS Enabled**: All tables have Row Level Security enabled
2. **User Isolation**: Each user can only access their own data
3. **Service Role Only**: Cron jobs and Edge Functions use service role key
4. **Rate Limiting**: Built-in delays prevent abuse

## Migration from Client-Side

The old client-side `auto-backtest-controller.ts` service is now deprecated. The frontend now uses the new `auto-backtest-api.ts` service which calls Edge Functions.

No data migration needed - new system creates fresh records.

## Support & Monitoring

Monitor system health via:
1. Dashboard UI (real-time stats)
2. Database queries (historical data)
3. Supabase Edge Function logs
4. pg_cron job status

For issues, check:
1. Edge Function logs first
2. Database health metrics
3. Cron job execution status
4. RLS policy permissions
