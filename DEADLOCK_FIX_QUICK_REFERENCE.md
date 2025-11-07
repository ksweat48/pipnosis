# Deadlock Fix Quick Reference

## What Was Fixed

**Problem**: Database deadlock in `finalize-candles-v2` cron job
**Solution**: Advisory locks + row ordering + skip locked + execution tracking
**Status**: ✅ Fixed and deployed

## Quick Health Check

```sql
-- Check if system is healthy (run in Supabase SQL Editor)
SELECT * FROM v_recent_finalizations LIMIT 10;
```

**Good signs:**
- Status = `success` or `partial_success`
- `candles_processed` > 0
- `duration_ms` < 5000 (under 5 seconds)
- Occasional `skipped` is normal (means lock is working)

**Bad signs:**
- Multiple `failed` status in a row
- Many `timeout` statuses
- `duration_ms` > 10000 consistently

## Common Issues & Solutions

### Issue: No candles being processed

**Symptom**: `candles_processed = 0` for multiple executions

**Check**:
```sql
SELECT COUNT(*) FROM candle_state
WHERE is_complete = false AND close_time <= now();
```

**If count is 0**: No candles need finalization (normal)
**If count > 0**: Check for errors in execution logs

### Issue: High skip rate

**Symptom**: Many `status = 'skipped'` executions

**Check**:
```sql
SELECT
  COUNT(*) FILTER (WHERE status = 'skipped') as skipped,
  COUNT(*) as total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'skipped') / COUNT(*), 2) as skip_pct
FROM candle_finalization_executions
WHERE started_at > now() - interval '1 hour';
```

**If skip_pct < 20%**: Normal - indicates healthy lock contention
**If skip_pct > 50%**: May indicate slow executions, check duration_ms

### Issue: Stuck execution

**Symptom**: Execution running for > 5 minutes

**Check**:
```sql
SELECT * FROM candle_finalization_executions
WHERE status = 'running'
  AND started_at < now() - interval '5 minutes';
```

**Solution**: Wait for automatic cleanup (runs every 10 min) or manually run:
```sql
SELECT cleanup_stale_finalization_locks();
```

### Issue: Errors in execution

**Symptom**: `status = 'failed'` or errors array is not empty

**Check**:
```sql
SELECT started_at, errors
FROM candle_finalization_executions
WHERE errors IS NOT NULL
  AND array_length(errors, 1) > 0
ORDER BY started_at DESC
LIMIT 5;
```

**Common errors and fixes:**
- "permission denied": RLS policy issue, check service role permissions
- "duplicate key": Conflict on insert, check forex_candles table constraints
- "deadlock detected": Should NOT happen with new code - report if seen

## Manual Testing

### Test finalization function
```sql
SELECT finalize_completed_candles();
```

**Expected result**:
```json
{
  "status": "completed",
  "candles_processed": <number>,
  "duration_ms": <number>
}
```

### Test cleanup function
```sql
SELECT cleanup_stale_finalization_locks();
```

**Expected result**: Integer (number of stale locks cleaned)

## Monitoring Dashboards

### Daily Health Summary
```sql
SELECT
  DATE(started_at) as date,
  COUNT(*) as total_runs,
  COUNT(*) FILTER (WHERE status = 'success') as successful,
  SUM(candles_processed) as total_candles,
  ROUND(AVG(duration_ms)::numeric, 0) as avg_duration_ms
FROM candle_finalization_executions
WHERE started_at > now() - interval '7 days'
GROUP BY DATE(started_at)
ORDER BY date DESC;
```

### Recent Performance
```sql
SELECT
  started_at,
  status,
  candles_processed,
  duration_ms,
  lock_acquired
FROM v_recent_finalizations
LIMIT 20;
```

### Error Rate (Last 24h)
```sql
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'success') as success,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'success') / COUNT(*), 1) as success_rate
FROM candle_finalization_executions
WHERE started_at > now() - interval '24 hours';
```

## Cron Jobs Status

### Check if cron jobs are scheduled
```sql
SELECT
  jobname,
  schedule,
  active,
  jobid
FROM cron.job
WHERE jobname LIKE '%finalize%' OR jobname LIKE '%cleanup%'
ORDER BY jobname;
```

**Expected jobs:**
1. `finalize-candles-v3-deadlock-free` - Every minute (`* * * * *`)
2. `cleanup-stale-finalization-locks` - Every 10 min (`*/10 * * * *`)
3. `cleanup-old-finalization-logs` - Daily at 2 AM (`0 2 * * *`)

### Manually trigger finalization
```sql
-- This will run immediately, not wait for cron schedule
SELECT finalize_completed_candles();
```

## Key Metrics to Watch

1. **Success Rate**: Should be > 95%
2. **Skip Rate**: Should be 5-20% (indicates lock working properly)
3. **Average Duration**: Should be 100-2000ms
4. **Candles Processed**: Should match expected volume
5. **Error Count**: Should be 0 or very low

## Files Created

1. **Migration**: `supabase/migrations/20251107160000_fix_candle_finalization_deadlock.sql`
2. **Documentation**: `DEADLOCK_FIX_COMPLETE.md`
3. **Monitoring Queries**: `monitor-candle-finalization.sql`
4. **Quick Reference**: This file

## Support Queries

### Full monitoring suite
```bash
# Run all monitoring queries
psql -f monitor-candle-finalization.sql
```

### Quick health check (single query)
```sql
SELECT
  'Last 10 runs' as metric,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'success') as success,
  COUNT(*) FILTER (WHERE status = 'skipped') as skipped,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  SUM(candles_processed) as total_candles,
  ROUND(AVG(duration_ms)::numeric, 0) as avg_ms
FROM candle_finalization_executions
WHERE started_at > now() - interval '10 minutes';
```

## When to Escalate

**Immediate attention needed if:**
- Deadlock error appears in logs again
- Success rate drops below 80%
- Multiple executions timeout
- No candles processed for > 1 hour when candles are pending
- Advisory lock never releases (execution stuck for > 10 minutes)

**Can wait/monitor if:**
- Occasional skipped executions (this is normal)
- Occasional partial_success (some errors but most candles processed)
- Duration varies between 500-3000ms (acceptable range)
- Error count is 1-2 per day (investigate but not urgent)
