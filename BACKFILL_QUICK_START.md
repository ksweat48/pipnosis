# Backfill System - Quick Start Guide

## Prerequisites

```bash
# Ensure environment variables are set in .env
ADMIN_REFRESH_KEY=your_admin_key
VITE_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Common Commands

### 1. Full Backfill (All New Pairs + All Timeframes)

```bash
node scripts/trigger-comprehensive-backfill.mjs
```

**What it does:**
- Backfills GBPJPY, EURJPY, AUDUSD, NZDUSD
- All timeframes: M1, M5, M15, H1, H4, D1, W1
- 28 total operations
- Duration: ~15-30 minutes

**Expected result:**
- ~500,000+ candles inserted
- Complete historical coverage per timeframe

---

### 2. Single Pair Backfill

```bash
node scripts/trigger-comprehensive-backfill.mjs --symbols GBPJPY
```

**What it does:**
- Backfills only GBPJPY
- All 7 timeframes
- 7 operations

---

### 3. Important Timeframes Only

```bash
node scripts/trigger-comprehensive-backfill.mjs --timeframes H1,H4,D1
```

**What it does:**
- Backfills all 4 pairs
- Only H1, H4, D1 timeframes
- 12 operations
- Duration: ~5-10 minutes

**Use case:** Quick setup for trading analysis

---

### 4. Single Pair + Single Timeframe

```bash
node scripts/trigger-comprehensive-backfill.mjs --symbols GBPJPY --timeframes H1
```

**What it does:**
- Backfills only GBPJPY H1
- 1 operation
- Duration: ~1-2 minutes

**Use case:** Quick test or specific gap fill

---

## Timeframe Data Ranges

| Timeframe | Days Back | Candles (approx) |
|-----------|-----------|------------------|
| M1 | 7 | 10,080 |
| M5 | 14 | 4,032 |
| M15 | 30 | 2,880 |
| H1 | 90 | 2,160 |
| H4 | 180 | 1,080 |
| D1 | 730 | 730 |
| W1 | 1825 | 260 |

## Verification Queries

### Check Data Coverage

```sql
SELECT
  symbol,
  timeframe,
  COUNT(*) as candles,
  MIN(open_time) as earliest,
  MAX(open_time) as latest
FROM forex_candles
WHERE symbol IN ('GBPJPY', 'EURJPY', 'AUDUSD', 'NZDUSD')
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;
```

### Check Recent Data

```sql
SELECT
  symbol,
  timeframe,
  COUNT(*) as recent_candles
FROM forex_candles
WHERE symbol IN ('GBPJPY', 'EURJPY', 'AUDUSD', 'NZDUSD')
  AND open_time >= NOW() - INTERVAL '24 hours'
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;
```

### Find Data Gaps

```sql
SELECT
  symbol,
  timeframe,
  open_time,
  LAG(open_time) OVER (PARTITION BY symbol, timeframe ORDER BY open_time) as prev_time,
  open_time - LAG(open_time) OVER (PARTITION BY symbol, timeframe ORDER BY open_time) as gap
FROM forex_candles
WHERE symbol = 'GBPJPY'
  AND timeframe = 'H1'
  AND open_time >= NOW() - INTERVAL '7 days'
ORDER BY gap DESC
LIMIT 20;
```

## Troubleshooting

### Function Not Found

**Problem:** 404 error when calling function

**Solution:**
1. Wait 2-3 minutes after deployment
2. Check Netlify dashboard for deployment status
3. Verify function exists in `netlify/functions/` directory

### Timeout Error

**Problem:** Request times out

**Solution:**
- Use smaller timeframe sets: `--timeframes H1,H4`
- Or smaller symbol sets: `--symbols GBPJPY,EURJPY`
- Check Netlify function logs for details

### No Data Returned

**Problem:** 0 candles fetched

**Solution:**
- Check if Dukascopy supports the symbol
- Verify date range is valid
- Check internet connectivity
- Review Netlify function logs

### Database Errors

**Problem:** Supabase insert failures

**Solution:**
1. Check Supabase connection limits
2. Verify `forex_candles` table exists
3. Check RLS policies allow service role
4. Review database logs in Supabase dashboard

## Best Practices

### 1. Initial Setup

Run this once when setting up new pairs:

```bash
node scripts/trigger-comprehensive-backfill.mjs
```

### 2. Daily Maintenance

Keep short timeframes updated:

```bash
node scripts/trigger-comprehensive-backfill.mjs --timeframes M1,M5,M15
```

### 3. Weekly Maintenance

Update hourly data:

```bash
node scripts/trigger-comprehensive-backfill.mjs --timeframes H1,H4
```

### 4. Monthly Maintenance

Update long timeframes:

```bash
node scripts/trigger-comprehensive-backfill.mjs --timeframes D1,W1
```

## Success Indicators

After running backfill, you should see:

```
SUMMARY:
- Total Operations: 28
- Successful: 28
- Failed: 0
- Total Candles Fetched: 523,456
- Total Candles Inserted: 523,456
- Duration: 1245.67s

BACKFILL COMPLETED SUCCESSFULLY
```

## Next Steps

After backfill completion:

1. **Verify data in database** using the SQL queries above
2. **Test chart rendering** on the frontend with new pairs
3. **Enable real-time updates** for the new pairs
4. **Monitor data quality** over the first few days
5. **Set up automated backfills** for maintenance

## Quick Reference Card

```
┌─────────────────────────────────────────────────┐
│        BACKFILL QUICK REFERENCE                 │
├─────────────────────────────────────────────────┤
│ Full Backfill:                                  │
│   node scripts/trigger-comprehensive-backfill.mjs│
│                                                 │
│ One Pair:                                       │
│   --symbols GBPJPY                              │
│                                                 │
│ Trading Timeframes:                             │
│   --timeframes H1,H4,D1                         │
│                                                 │
│ Duration:                                       │
│   Full: ~15-30 min                              │
│   Partial: ~5-10 min                            │
│                                                 │
│ Expected Data:                                  │
│   ~500k+ candles (full)                         │
│   ~100k+ candles (H1,H4,D1)                     │
└─────────────────────────────────────────────────┘
```

## Support Resources

- **Full Documentation**: `COMPREHENSIVE_BACKFILL_SYSTEM.md`
- **Function Code**: `netlify/functions/backfill-all-timeframes-new-pairs.ts`
- **Trigger Script**: `scripts/trigger-comprehensive-backfill.mjs`
- **Netlify Dashboard**: Check function logs for errors
- **Supabase Dashboard**: Check database status and logs
