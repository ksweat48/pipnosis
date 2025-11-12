# Quick Start: Gap Prevention System

## 🚀 Get Started in 5 Minutes

### Step 1: Apply Database Migrations

The system needs new database tables and functions:

```bash
# Apply the comprehensive gap prevention migration
supabase db push
```

This creates:
- 5 new monitoring tables
- Enhanced gap-fill function with realistic spreads
- Candle validation triggers
- Quality metrics calculator
- 6 automated cron jobs

### Step 2: Deploy Edge Functions

Deploy the 4 new edge functions:

```bash
# Deploy all functions at once
supabase functions deploy polling-outage-monitor
supabase functions deploy backfill-historical-candles
supabase functions deploy repair-candles
supabase functions deploy prefetch-ticks
```

### Step 3: Initial Backfill (Replace Flat Candles)

Run this to replace all existing gap_fill candles with real MetaAPI data:

```bash
curl -X POST "https://nzisgxdlydihlwsvonfy.supabase.co/functions/v1/backfill-historical-candles?days=7&replaceGapFills=true&priority=high" \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY"
```

This will:
- Fetch last 7 days of data from MetaAPI
- Replace flat gap_fill candles with real OHLC data
- Prioritize important symbols (EURUSD, XAUUSD first)

### Step 4: Verify System is Working

Check the monitoring dashboard:

```sql
-- Check cron job health
SELECT * FROM cron_job_health;

-- View data quality
SELECT * FROM candle_quality_summary ORDER BY quality_percentage ASC;

-- See recent backfill operations
SELECT * FROM polling_outage_log ORDER BY run_time DESC LIMIT 10;
```

### Step 5: Monitor in Real-Time

Add the quality dashboard to your app:

```typescript
// In your admin or monitoring page
import { CandleQualityDashboard } from '@/components/CandleQualityDashboard';

<CandleQualityDashboard />
```

## ✅ What You Just Enabled

### Automatic Gap Prevention (Every 5 Minutes)
- System checks for missing candles
- Detects polling outages automatically
- Triggers backfill within 5 minutes
- No manual intervention needed

### Automatic Candle Repair (Every Hour)
- Fixes flat candles (adds realistic wicks)
- Corrects invalid OHLC relationships
- Improves data quality continuously

### Tick Buffering (Real-Time)
- Stores ticks in browser before database write
- Prevents data loss during network hiccups
- Auto-syncs every 5 seconds
- Retries failed writes 3 times

### Enhanced Gap-Filling (Real-Time)
- New gap_fill candles have realistic appearance
- Uses symbol-specific spreads (EURUSD: 1.5 pips, XAUUSD: 30 pips)
- Adds micro-variations to prevent flat lines
- Marks synthetic data with completion_score

## 🎯 Expected Results

### Before
- Flat gap_fill candles appear as thin lines
- 50-70% data quality
- Manual backfill required after outages

### After
- All candles have visible bodies and wicks
- 90-100% data quality
- Automatic recovery from outages
- No visible gaps in chart

## 📊 Quick Health Check

Run this query to see if everything is working:

```sql
SELECT
  symbol,
  timeframe,
  quality_percentage,
  CASE
    WHEN quality_percentage >= 90 THEN '🟢 Excellent'
    WHEN quality_percentage >= 70 THEN '🟡 Good'
    ELSE '🔴 Poor'
  END as status
FROM candle_quality_summary
ORDER BY quality_percentage ASC;
```

## 🔧 Common Issues & Fixes

### Issue: Cron jobs not running
```sql
-- Check if pg_cron is enabled
SELECT * FROM pg_extension WHERE extname = 'pg_cron';

-- If not, enable it
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

### Issue: Still seeing flat candles
```bash
# Run immediate repair
curl "https://nzisgxdlydihlwsvonfy.supabase.co/functions/v1/repair-candles"

# Then backfill last 24 hours
curl "https://nzisgxdlydihlwsvonfy.supabase.co/functions/v1/backfill-historical-candles?days=1&replaceGapFills=true"
```

### Issue: Low quality percentage
```bash
# Aggressive backfill for all symbols
curl "https://nzisgxdlydihlwsvonfy.supabase.co/functions/v1/backfill-historical-candles?days=3&priority=high"
```

## 📈 Monitor Your Progress

Check these metrics daily:

```sql
-- Overall system health
SELECT
  AVG(quality_percentage) as avg_quality,
  SUM(gap_fill_count) as total_gap_fills,
  SUM(metaapi_count) as total_real_data
FROM candle_quality_summary;

-- Outages detected and resolved
SELECT
  DATE(run_time) as date,
  COUNT(*) as checks_run,
  SUM(outages_detected) as outages_found,
  SUM(backfills_triggered) as backfills_run
FROM polling_outage_log
GROUP BY DATE(run_time)
ORDER BY date DESC;
```

## 🎉 Success Indicators

You'll know the system is working when you see:

1. ✅ Quality percentage > 90% for all symbols
2. ✅ Cron jobs running every 5-15 minutes
3. ✅ Automatic backfills triggered within 5 min of gaps
4. ✅ No flat candles in recent data (last 24 hours)
5. ✅ Tick buffer syncing successfully (check dashboard)
6. ✅ Chart displays smooth, continuous candlesticks with proper wicks

## 🚨 Alert Thresholds

The system will automatically detect and log:

- **Critical**: >5 symbols with quality < 50%
- **Warning**: >50% gap_fill candles in dataset
- **Stale**: No cron execution in >10 minutes
- **Unhealthy**: >3 failed cron runs in last hour

Check alerts:
```sql
SELECT * FROM cron_job_execution_log
WHERE status = 'failed'
ORDER BY execution_time DESC
LIMIT 20;
```

## 📚 Full Documentation

For detailed technical information, see: `GAP_PREVENTION_SYSTEM_COMPLETE.md`

## 💡 Pro Tips

1. **Run backfill during low-traffic hours** for faster processing
2. **Monitor quality metrics weekly** to catch degradation early
3. **Clear tick buffer monthly** if accumulating failed entries
4. **Adjust spread config** if your broker has different typical spreads
5. **Enable email alerts** by connecting to send-load-alert-email function

---

**That's it!** Your gap prevention system is now active and protecting your data 24/7.

The system runs automatically - no ongoing maintenance needed. Just check the quality dashboard occasionally to ensure everything stays healthy.
