# Architecture Decision: No Supabase Cron Jobs

**Date:** December 2, 2025
**Status:** Enforced
**Decision:** ALL scheduled tasks MUST use Netlify scheduled functions. Supabase pg_cron is permanently disabled.

---

## Problem Statement

The system experienced critical issues when Supabase pg_cron jobs were accidentally re-enabled:

### 1. Flat Candles on Charts
- MetaAPI's historical candles endpoint returns flat data (open=high=low=close)
- The `fill-candle-gaps` cron job called this endpoint every 5 minutes
- Flat candles overwrote proper candles that had been aggregated from real price data
- Charts displayed useless flat lines instead of candlesticks with wicks

### 2. Database Resource Exhaustion
- Multiple cron jobs running every 15 seconds to 1 minute
- Jobs included:
  - `auto-backtest-executor` - Every 15 seconds
  - `continuous-price-polling` - Every minute
  - `finalize_completed_candles` - Every minute
  - `job-scheduler` - Every minute
  - Plus ~15 more jobs running every 5-10 minutes
- This caused:
  - 100% CPU usage
  - 100% memory usage
  - Database connection exhaustion
  - Application slowdowns and failures

### 3. Dual Scheduling Conflicts
- Two competing systems running simultaneously:
  - **Netlify scheduled functions** (intended architecture)
  - **Supabase pg_cron jobs** (accidentally re-enabled)
- Both systems were:
  - Polling for prices
  - Creating candles
  - Processing backtests
  - Fighting for database resources
- This created race conditions, duplicate data, and unpredictable behavior

---

## Decision

**Supabase pg_cron is permanently banned from this project.**

ALL scheduled tasks MUST use Netlify scheduled functions exclusively.

---

## Rationale

### Why Netlify Scheduled Functions?

1. **Better Time Granularity**
   - Netlify: Can run every 60 seconds (1 minute)
   - Supabase pg_cron: Can only run every 60 seconds at best, but with database overhead
   - Our price collection needs sub-minute precision for accurate candles

2. **Resource Isolation**
   - Netlify: Each function runs in its own isolated container
   - Supabase: All cron jobs share database connection pool
   - Netlify prevents one failing job from affecting others

3. **Better Monitoring**
   - Netlify: Built-in logs, metrics, and alerts
   - Supabase: Limited visibility into cron job execution
   - Easier debugging when issues occur

4. **No Database Overhead**
   - Netlify: Functions run on dedicated infrastructure
   - Supabase: Cron jobs consume database connections and CPU
   - Keeps database focused on data operations, not job scheduling

5. **Simpler Deployment**
   - Netlify: Update netlify.toml and deploy
   - Supabase: Create migration, apply to database, manage multiple environments
   - Version control and rollback are easier with Netlify

### Why NOT Supabase pg_cron?

1. **Resource Exhaustion**
   - Cron jobs running every 15-60 seconds quickly exhaust database resources
   - Database is not designed to be a job scheduler
   - Caused production outages

2. **Data Quality Issues**
   - Cron-based gap filling used MetaAPI historical data
   - This data has flat candles (no wicks)
   - Overwrote good data aggregated from real prices
   - Charts became useless

3. **Maintenance Complexity**
   - Cron jobs spread across 23+ migration files
   - Difficult to track what's running
   - Easy to accidentally re-enable old jobs
   - Created technical debt

4. **Conflicts with Netlify**
   - Running both systems simultaneously caused race conditions
   - Duplicate candles inserted
   - Unpredictable behavior
   - Wasted resources

---

## Approved Scheduled Functions

Only these Netlify scheduled functions are approved:

### 1. continuous-price-collector
- **Schedule:** Every minute (`* * * * *`)
- **Purpose:** Collect live bid/ask prices from MetaAPI
- **Timeout:** 26 seconds
- **Location:** `netlify/functions/continuous-price-collector.ts`

### 2. continuous-candle-aggregator
- **Schedule:** Every 5 minutes (`*/5 * * * *`)
- **Purpose:** Aggregate price data into OHLC candles for all timeframes
- **Timeout:** 26 seconds
- **Location:** `netlify/functions/continuous-candle-aggregator.ts`

### 3. scheduled-refresh (Optional)
- **Schedule:** Daily at 2 AM (`0 2 * * *`)
- **Purpose:** Maintenance and cleanup tasks
- **Timeout:** 600 seconds
- **Location:** `netlify/functions/scheduled-refresh.ts`

---

## How to Add New Scheduled Tasks

If you need to add a new scheduled task:

### 1. Create Netlify Function

```typescript
// netlify/functions/my-new-task.ts
import type { Handler } from '@netlify/functions';

export const handler: Handler = async (event, context) => {
  console.log('[MyTask] Starting...');

  try {
    // Your task logic here

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error('[MyTask] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
```

### 2. Add to netlify.toml

```toml
[functions."my-new-task"]
  timeout = 26
  schedule = "*/10 * * * *"  # Every 10 minutes
```

### 3. Deploy

```bash
# Commit changes
git add .
git commit -m "Add new scheduled task"

# Deploy to Netlify
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

### 4. Monitor

- Check Netlify function logs
- Verify task is running on schedule
- Set up alerts for failures

---

## What Was Removed

### Database Functions (Dropped)
- `invoke_continuous_price_poller()`
- `finalize_completed_candles()`
- `invoke_auto_backtest_executor()`
- `auto_backtest_runner_cycle()`
- `generate_auto_backtest_job()`
- Plus ~20 more cron-only functions

### Database Tables (Dropped)
- `candle_state` - Used by finalize_completed_candles
- `cron_job_execution_log` - Cron logging
- `backtest_job_queue` - Cron-based backtest queue
- `price_polling_health` - Cron monitoring
- Plus ~10 more cron-specific tables

### Migration Files (Deleted)
- 23+ migration files that created cron jobs
- 2 EMERGENCY migrations that tried to disable cron
- All files referenced `cron.schedule()` or pg_cron

### Netlify Functions (Deleted)
- `fill-candle-gaps` - Created flat candles from MetaAPI

### Supabase Edge Functions (Deleted)
- `aggregate-candles/`
- `auto-backtest-executor/`
- `auto-backtest-runner/`
- `job-scheduler/`
- Plus ~6 more cron-only Edge Functions

---

## Prevention Measures

### 1. Database Function
A `prevent_cron_jobs()` function was added that raises an error explaining why cron is disabled.

### 2. Migration Validation Script
A pre-commit script checks for cron references in new migrations:

```bash
# scripts/check-migrations.sh
if grep -r "cron.schedule\|pg_cron" supabase/migrations/*.sql; then
  echo "❌ ERROR: Migration contains cron jobs!"
  exit 1
fi
```

### 3. Documentation
- This file explains the decision
- CRITICAL_SYSTEMS.md updated to remove cron references
- netlify.toml has clear comments about scheduling

### 4. Nuclear Migration
Migration `nuclear_destroy_all_cron_infrastructure.sql` was applied to permanently remove all cron infrastructure from the database.

---

## If Someone Tries to Add Cron

**DO NOT DO IT.**

If someone suggests adding Supabase cron jobs:

1. **Point them to this document**
2. **Remind them:**
   - Cron caused production outages
   - Cron created flat candles
   - Cron exhausted database resources
   - We have a working Netlify solution

3. **Suggest alternatives:**
   - Add a Netlify scheduled function instead
   - Use database triggers for event-based tasks
   - Use Supabase Realtime for data-driven workflows
   - Use Netlify background functions for long-running tasks

4. **Reject the PR/change:**
   - Cron is architecturally prohibited
   - This is a hard requirement, not a suggestion

---

## Summary

- ✅ Use Netlify scheduled functions for ALL scheduled tasks
- ❌ NEVER use Supabase pg_cron
- ✅ Two approved functions: price collector (1 min), candle aggregator (5 min)
- ❌ Do not create new Supabase cron jobs
- ✅ Database focused on data, Netlify focused on jobs
- ❌ Do not add migrations with `cron.schedule()`

**This is a permanent architectural decision. Non-negotiable.**

---

## References

- Migration: `nuclear_destroy_all_cron_infrastructure.sql`
- Netlify Functions: `netlify/functions/`
- Configuration: `netlify.toml`
- Critical Systems: `docs/CRITICAL_SYSTEMS.md`
