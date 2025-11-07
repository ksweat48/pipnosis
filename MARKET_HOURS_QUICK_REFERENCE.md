# Market Hours Polling - Quick Reference

## Current Status Check

```sql
-- See current market status and polling state
SELECT * FROM v_current_market_status;
```

## Market Schedule

- **Market Opens**: Sunday 5:00 PM EST
- **Market Closes**: Friday 5:00 PM EST
- **Weekend**: No polling from Friday 5pm to Sunday 5pm (48 hours)

## What Happens Automatically

### Friday 5pm EST - Market Closes
- ✅ Server polling automatically pauses
- ✅ Client polling automatically pauses
- ✅ No API calls to MetaAPI
- ✅ Status logged to database
- ✅ Cron job continues running but skips polls

### Sunday 5pm EST - Market Opens
- ✅ Server polling automatically resumes
- ✅ Client polling automatically resumes
- ✅ Price data starts flowing
- ✅ Candle aggregation resumes
- ✅ Status change logged to database

## Manual Controls (Admin Only)

### Force Enable Polling (Testing)
```sql
SELECT set_polling_config('force_polling_enabled', 'true'::jsonb);
```

### Enable Maintenance Mode
```sql
SELECT set_polling_config('maintenance_mode', 'true'::jsonb);
```

### Reset to Normal
```sql
SELECT set_polling_config('force_polling_enabled', 'false'::jsonb);
SELECT set_polling_config('maintenance_mode', 'false'::jsonb);
```

## Monitoring Queries

### Recent Polling Activity
```sql
SELECT
  poll_timestamp,
  successful_pairs,
  failed_pairs,
  SUBSTRING(error_message, 1, 50) as status
FROM price_polling_health
ORDER BY poll_timestamp DESC
LIMIT 10;
```

### Market Status History
```sql
SELECT
  status_change_timestamp,
  previous_status,
  new_status,
  day_name,
  time_est
FROM v_market_status_history
LIMIT 10;
```

### Current Configuration
```sql
SELECT config_key, config_value, description
FROM polling_configuration;
```

## Expected Behavior

### During Market Closure (Now - Friday 5pm to Sunday 5pm)
```
successful_pairs: 0
failed_pairs: 0
error_message: "Market closed - Day X, HH:MM EST"
```

### During Market Hours (Sunday 5pm - Friday 5pm)
```
successful_pairs: 5 (or close to 5)
failed_pairs: 0 (or minimal)
error_message: null
```

## Troubleshooting

### If polling doesn't resume Sunday 5pm:

1. Check market status:
   ```sql
   SELECT * FROM get_current_market_status();
   ```

2. Check cron job is active:
   ```sql
   SELECT jobname, active FROM cron.job
   WHERE jobname = 'continuous-price-polling-v3';
   ```

3. Check for maintenance mode:
   ```sql
   SELECT * FROM polling_configuration
   WHERE config_key = 'maintenance_mode';
   ```

4. Manually trigger a poll:
   ```sql
   SELECT invoke_continuous_price_poller();
   ```

### If you need to force restart polling immediately:

```sql
-- Enable force polling
SELECT set_polling_config('force_polling_enabled', 'true'::jsonb);

-- Wait 1-2 minutes for next cron cycle

-- Check if polling started
SELECT * FROM price_polling_health
ORDER BY poll_timestamp DESC LIMIT 5;

-- Disable force polling when done testing
SELECT set_polling_config('force_polling_enabled', 'false'::jsonb);
```

## System Architecture

**Server-Side (24/7 Operation)**
- Supabase pg_cron job runs every minute
- Checks market hours before each poll
- Invokes Edge Function when market is open
- Skips gracefully when market is closed

**Client-Side (Browser-Dependent)**
- Runs when user has app open
- Uses identical market hours logic
- Synchronized with server polling
- Falls back to client polling if server fails

Both systems work independently but are synchronized to respect the same market hours.
