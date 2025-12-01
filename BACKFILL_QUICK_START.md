# Historical Backfill - Quick Start Guide

## TL;DR

Run these commands to backfill 1 year of historical candles:

```bash
# 1. Install dependencies
cd scripts/backfill && npm install

# 2. Test with one pair (IMPORTANT!)
npm run test-single

# 3. Verify charts show test data
# Open app → Chart → EURUSD + 1h → See candles?

# 4. Run full backfill (2-4 hours)
npm run backfill
```

## What This Does

✅ Fetches 1 year of historical candles
✅ For 10 symbols (EURUSD, GBPUSD, USDJPY, XAUUSD, US30, etc.)
✅ For 6 timeframes (1d, 4h, 1h, 30m, 15m, 5m)
✅ ~1.6 million candles total
✅ Validates every candle (no contamination)
✅ Doesn't disrupt live polling or ticks
✅ Charts display data immediately

## Data Sources

Uses **Yahoo Finance** (FREE, no API key needed) + optional fallbacks:
- Twelve Data (optional API key)
- FCSAPI (optional API key)
- Polygon (optional API key)

Yahoo Finance is sufficient for all major pairs.

## Step-by-Step

### 1. Install

```bash
cd /tmp/cc-agent/58035261/project/scripts/backfill
npm install
```

### 2. Test First (REQUIRED)

```bash
npm run test-single
```

**What it does:**
- Backfills 7 days of EURUSD 1h data
- Takes 10-15 seconds
- Validates entire pipeline
- Safe to run multiple times

**Expected output:**
```
✅ TEST PASSED!
Success: ✅ YES
Candles inserted: 168
Candles rejected: 0
```

### 3. Verify Charts

**CRITICAL STEP** - Don't skip this!

1. Open your app in browser
2. Navigate to chart page
3. Select **EURUSD** symbol
4. Select **1h** timeframe
5. **Look for historical candles from past 7 days**

If you see candles → ✅ Proceed to step 4
If no candles → ❌ Check troubleshooting below

### 4. Run Full Backfill

```bash
npm run backfill
```

**What happens:**
- Processes 60 tasks (10 symbols × 6 timeframes)
- Takes 2-4 hours total
- Shows real-time progress
- Can be interrupted and resumed

**Progress display:**
```
📊 Progress: 23/60 tasks
   ✅ Completed: 22
   ❌ Failed: 1
   📈 Total candles inserted: 412,853
   🚫 Total candles rejected: 3,147
```

### 5. Verify All Charts

After backfill completes:

Test each pair:
- EURUSD ✓
- GBPUSD ✓
- USDJPY ✓
- XAUUSD ✓
- US30 ✓

Test each timeframe:
- 1d ✓
- 4h ✓
- 1h ✓
- 30m ✓
- 15m ✓
- 5m ✓

All should show 1 year of historical data.

## Troubleshooting

### Test Fails: "No data from any source"

**Fix:**
- Check internet connection
- Yahoo Finance might be temporarily down
- Try again in a few minutes
- Check `.env` has Supabase credentials

### Test Passes But No Charts

**Fix 1: Check database**
```sql
SELECT COUNT(*) FROM forex_candles
WHERE symbol = 'EURUSD' AND timeframe = '1h';
```
Should show ~168 candles.

**Fix 2: Refresh chart**
- Hard refresh browser (Ctrl+Shift+R)
- Restart app
- Clear browser cache

**Fix 3: Check timeframe format**
Chart might use different format. Check `MarketChart.tsx`.

### High Rejection Rate

**Normal**: 1-3% rejection is normal (bad ticks, data gaps)
**High** (>10%): Check validation stats

```sql
SELECT * FROM backfill_validation_stats
WHERE contamination_detected > 0;
```

### Slow Performance

**Normal**:
- 5-10 minutes per symbol/timeframe
- Rate limiting intentional (respects free tiers)
- Total: 2-4 hours for everything

**Too slow**:
- Check network speed
- Yahoo Finance might be rate limiting
- Try different time of day

## Safety Features

✅ **Won't break anything:**
- Separate process from live app
- Duplicate prevention
- Validation before insert
- Database constraints as safety net

✅ **Can be stopped:**
- Ctrl+C to cancel anytime
- Safe to resume later
- Won't lose progress

✅ **Won't contaminate data:**
- Every candle validated
- Price ranges enforced
- Symbol validation active
- Contamination detection running

## Expected Results

### Test (7 days, EURUSD 1h)
- Candles: ~168
- Time: 10-15 seconds
- Rejection: 0-2 candles

### Full Backfill (1 year, all pairs/timeframes)
- Candles: ~1.6 million
- Time: 2-4 hours
- Rejection: ~1-3%
- Database: +250-300 MB

## Commands Reference

```bash
# Install
cd scripts/backfill && npm install

# Test
npm run test-single

# Full backfill
npm run backfill

# Check status (in psql or Supabase dashboard)
SELECT * FROM v_backfill_summary;
SELECT * FROM v_backfill_by_symbol;
```

## Files Created

```
scripts/backfill/
├── execute-backfill.js      # Main script
├── test-single-pair.js      # Test script
├── data-sources.js          # Multi-source fetcher
├── candle-validator.js      # Validation
├── backfill-orchestrator.js # Orchestration
├── package.json             # Dependencies
└── README.md                # Detailed docs
```

## Need Help?

1. **Check logs** - Console shows detailed progress
2. **Check database** - Query `backfill_*` tables
3. **Read detailed docs** - `scripts/backfill/README.md`
4. **Check system docs** - `HISTORICAL_BACKFILL_COMPLETE.md`

## Quick Checklist

Before running full backfill:

- [ ] Dependencies installed
- [ ] Test script passed
- [ ] Charts showed test data
- [ ] Database has space (~300 MB)
- [ ] Internet connection stable
- [ ] Ready to wait 2-4 hours

After backfill:

- [ ] All symbols completed
- [ ] Charts show historical data
- [ ] No contamination detected
- [ ] Validation rate >97%

---

**Ready to go? Run the test first, verify charts, then backfill!**

```bash
cd scripts/backfill && npm run test-single
```
