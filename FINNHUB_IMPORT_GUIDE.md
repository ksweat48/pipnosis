# Finnhub Historical Data Import Guide

## Overview

This guide provides step-by-step instructions for importing 30 days of accurate historical market data from Finnhub into your Pipnosis AI trading platform. This one-time import will give your AI the historical context it needs for effective pattern recognition and decision-making.

---

## Quick Start

**Total Time Required:** 30-40 minutes (mostly automated)

1. Get Finnhub API key (5 minutes)
2. Configure environment (5 minutes)
3. Test with single symbol (5 minutes)
4. Run full 30-day import (25-35 minutes - automated)
5. Validate data quality (5 minutes)

---

## Step 1: Get Finnhub API Key

### Sign Up for Free Account

1. Visit [https://finnhub.io/register](https://finnhub.io/register)
2. Create a free account using your email
3. Verify your email address
4. Log in to your Finnhub dashboard
5. Copy your API key (looks like: `xxxxxxxxxxxxxxxxxx`)

### Free Tier Limits

- **60 API calls per minute** (sufficient with rate limiting)
- **30,000 calls per month** (enough for multiple 30-day imports)
- **No credit card required**

---

## Step 2: Configure Environment

### Local Development (.env file)

Add your Finnhub API key to your `.env` file:

```bash
# Add this to your .env file
FINNHUB_API_KEY=your_actual_api_key_here
```

### Production (Netlify Environment Variables)

1. Go to your Netlify dashboard
2. Navigate to: **Site settings → Environment variables**
3. Click **Add variable**
4. Add:
   - **Key:** `FINNHUB_API_KEY`
   - **Value:** Your actual API key
5. Click **Save**

**Important:** After adding the environment variable, you need to trigger a new build for it to take effect in your Netlify functions.

---

## Step 3: Deploy Updated Functions

Before running the import, ensure your new Finnhub functions are deployed to Netlify.

### Option A: Automatic Build Hook (Recommended)

```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

Wait 3-5 minutes for the build to complete.

### Option B: Git Push

```bash
git add .
git commit -m "Add Finnhub historical data import system"
git push
```

Netlify will automatically build and deploy.

### Verify Deployment

Check that the function is live:
```bash
curl https://pipnosis.netlify.app/.netlify/functions/finnhub-import
```

You should see a 405 error (Method not allowed) which confirms the function exists.

---

## Step 4: Test with Single Symbol (Recommended)

Before running the full 30-day import, test with a single symbol to verify everything works.

```bash
node scripts/finnhub-batch-import.js --test
```

This will:
- Import **EURUSD M5** for **1 day only**
- Verify API key works
- Confirm database connection
- Show you what to expect

**Expected output:**
```
📊 Importing EURUSD M5...
   Date range: 12/3/2024 to 12/4/2024
✅ Success:
   Fetched: 288 candles
   Inserted: 288 candles
   Deleted: 0 old candles
   Duration: 12.34s
```

If you see this, proceed to the full import!

---

## Step 5: Run Full 30-Day Import

### Start the Import

```bash
node scripts/finnhub-batch-import.js
```

### What Happens

The script will:
1. Import all 5 symbols (EURUSD, GBPUSD, USDJPY, XAUUSD, US30)
2. Import all 7 timeframes (M1, M5, M15, M30, H1, H4, D1)
3. Import 30 days of historical data for each
4. Overwrite any existing data in that range
5. Show progress for all 35 combinations
6. Provide a detailed summary at the end

### Expected Timeline

- **Total combinations:** 35 (5 symbols × 7 timeframes)
- **Rate limit delay:** 2.5 seconds between calls
- **Estimated time:** 25-35 minutes
- **Total candles:** ~285,000 candles

### Progress Output

```
╔════════════════════════════════════════════════════════════════╗
║         FINNHUB HISTORICAL DATA IMPORT - BATCH MODE            ║
╚════════════════════════════════════════════════════════════════╝

📅 Date Range: 11/4/2024 to 12/4/2024
📊 Symbols: EURUSD, GBPUSD, USDJPY, XAUUSD, US30
⏱️  Timeframes: M1, M5, M15, M30, H1, H4, D1
🔄 Overwrite Mode: ENABLED

[1/35] Processing EURUSD M1...
📊 Importing EURUSD M1...
✅ Success:
   Fetched: 43,200 candles
   Inserted: 43,200 candles
   Duration: 45.23s
⏳ Waiting 2.5s... (29 min remaining)

[2/35] Processing EURUSD M5...
...
```

### Monitoring Progress

The script will:
- Show real-time progress for each symbol/timeframe
- Display candles fetched and inserted
- Show estimated time remaining
- Report any errors immediately

### If Something Goes Wrong

The script automatically:
- Retries failed API calls (3 attempts)
- Handles rate limiting gracefully
- Logs all executions to `backfill_executions` table
- Continues with remaining imports even if one fails

You can safely **Ctrl+C to cancel** and restart later. The script will overwrite existing data, so you won't have duplicates.

---

## Step 6: Validate Data Quality

After the import completes, validate the data quality:

```bash
node scripts/validate-finnhub-import.js
```

### Validation Checks

The script will:
1. **Verify OHLC relationships** (high >= low, prices within range)
2. **Check for invalid prices** (zero or negative values)
3. **Detect time gaps** (missing candles in the time series)
4. **Calculate coverage percentage** (how complete the data is)
5. **Provide detailed statistics** per symbol and timeframe

### Expected Output

```
╔════════════════════════════════════════════════════════════════╗
║        FINNHUB IMPORT DATA QUALITY VALIDATION                  ║
╚════════════════════════════════════════════════════════════════╝

🔍 Validating EURUSD M1...
   📊 Found 43,200 candles
   ✅ All candles valid, no gaps detected
   📅 Coverage: 30 days (11/4/2024 to 12/4/2024)

...

╔════════════════════════════════════════════════════════════════╗
║                    VALIDATION SUMMARY                          ║
╚════════════════════════════════════════════════════════════════╝

📊 Total Candles Imported: 285,000
✅ Valid Candles: 285,000
❌ Invalid Candles: 0
⚠️  Time Gaps Detected: 0

✅ All data passed validation checks!
🎉 Your historical data is ready for AI training
```

---

## Verification Checklist

After completing the import, verify:

- [ ] All 5 symbols have data (EURUSD, GBPUSD, USDJPY, XAUUSD, US30)
- [ ] All 7 timeframes populated (M1, M5, M15, M30, H1, H4, D1)
- [ ] Validation script shows 0 errors
- [ ] Charts display smooth candlestick patterns
- [ ] Date range covers full 30 days
- [ ] No significant gaps in time series

---

## Advanced Options

### Import Different Time Ranges

Import only 7 days:
```bash
node scripts/finnhub-batch-import.js --days=7
```

Import 60 days:
```bash
node scripts/finnhub-batch-import.js --days=60
```

### Re-import Specific Symbol/Timeframe

If validation shows issues with a specific combination, you can manually trigger a re-import:

```bash
curl -X POST https://pipnosis.netlify.app/.netlify/functions/finnhub-import \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "EURUSD",
    "timeframe": "M5",
    "startDate": "2024-11-04T00:00:00Z",
    "endDate": "2024-12-04T00:00:00Z",
    "overwrite": true,
    "adminKey": "your_admin_key_here"
  }'
```

---

## Troubleshooting

### Error: "Invalid Finnhub API key"

**Solution:** Double-check your API key in:
1. Local `.env` file
2. Netlify environment variables
3. Trigger a new build after adding to Netlify

### Error: "ADMIN_REFRESH_KEY not set"

**Solution:** Add `ADMIN_REFRESH_KEY` to your `.env` file. Use any secure random string.

### Error: "Rate limited"

**Solution:** The script automatically handles rate limiting. If you see persistent rate limit errors:
1. Increase `DELAY_BETWEEN_CALLS_MS` in the script
2. Wait a few minutes and retry
3. Check your Finnhub dashboard for rate limit status

### Some Symbols Have No Data

**Possible causes:**
1. Finnhub doesn't have data for that symbol/date range
2. Symbol mapping is incorrect
3. API call failed silently

**Solution:** Check the `backfill_executions` table in Supabase for error messages:
```sql
SELECT * FROM backfill_executions
WHERE status = 'failed'
ORDER BY created_at DESC;
```

### Chart Shows Gaps After Import

**Solution:**
1. Run the validation script to identify gaps
2. Check if gaps are during market closures (weekends, holidays)
3. Re-import that specific symbol/timeframe if needed

---

## Database Schema

### Imported Candles

All imported candles are marked with:
- `data_source = 'finnhub_import'`

This allows you to:
- Distinguish imported data from live MetaAPI data
- Query specifically for historical data
- Easily remove and re-import if needed

### Execution Tracking

All imports are logged in `backfill_executions`:
```sql
SELECT
  symbol,
  timeframe,
  status,
  candles_requested,
  candles_filled,
  created_at,
  completed_at
FROM backfill_executions
WHERE created_at > NOW() - INTERVAL '1 day'
ORDER BY created_at DESC;
```

---

## Cost and Performance

### Free Tier Usage

- **API Calls:** 35-40 calls for full 30-day import
- **Monthly Limit:** 30,000 calls
- **Remaining After Import:** 29,960+ calls
- **Cost:** $0.00

### Database Impact

- **Total Rows:** ~285,000 candles
- **Storage:** ~50-70 MB
- **Index Size:** ~20-30 MB
- **Query Performance:** No impact (properly indexed)

### Time Investment

- **Setup:** 5-10 minutes
- **Test Import:** 5 minutes
- **Full Import:** 25-35 minutes (automated)
- **Validation:** 5 minutes
- **Total:** ~45-60 minutes

---

## What Happens Next

After successful import, your AI will:

1. **Use historical patterns** for better predictions
2. **Recognize market regimes** based on 30-day context
3. **Make informed decisions** using real historical data
4. **Improve accuracy** with production-quality training data
5. **Backtest effectively** against actual market conditions

---

## Maintenance

### Is This Ongoing?

**No.** This is a one-time import. After completion:

- Finnhub integration is **not** used for live data
- Your regular MetaAPI polling continues as normal
- Imported data remains in the database permanently
- You can re-run the import anytime to refresh historical data

### Future Imports

If you want to import more historical data later:

1. Finnhub API key remains in environment variables
2. Run the script again with desired date range
3. Use `overwrite: true` to replace existing data
4. Or use `overwrite: false` to add new historical data

---

## Support

### Check Import Status

```bash
node scripts/validate-finnhub-import.js
```

### View Execution Log

```sql
SELECT * FROM backfill_executions
ORDER BY created_at DESC
LIMIT 50;
```

### Manual Inspection

```sql
SELECT
  symbol,
  timeframe,
  COUNT(*) as candle_count,
  MIN(open_time) as oldest,
  MAX(open_time) as newest
FROM forex_candles
WHERE data_source = 'finnhub_import'
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;
```

---

## Success Criteria

✅ Import is successful when:

1. Batch script completes without critical errors
2. Validation shows 0 invalid candles
3. Coverage is >90% for all symbol/timeframe pairs
4. Charts display smooth, continuous candlestick patterns
5. AI LLM can query 30 days of historical context
6. No significant time gaps detected

---

## Congratulations!

You now have 30 days of production-quality historical data powering your AI trading system. Your AI can now:

- Recognize patterns across multiple timeframes
- Understand market regimes and trends
- Make informed decisions with historical context
- Backtest strategies against real market conditions
- Learn from thousands of real market scenarios

**Next Steps:**
1. Run backtests to validate AI performance
2. Test AI predictions against known historical patterns
3. Fine-tune AI parameters based on historical accuracy
4. Launch live trading with confidence

---

## Files Created

This implementation added the following files:

```
.env.example (updated)                           # Finnhub API key documentation
netlify/functions/_shared/finnhub-client.ts      # Finnhub API client library
netlify/functions/finnhub-import.ts              # One-time import function
scripts/finnhub-batch-import.js                  # Batch import orchestrator
scripts/validate-finnhub-import.js               # Data quality validator
FINNHUB_IMPORT_GUIDE.md                          # This guide
```

---

**Last Updated:** December 4, 2024
