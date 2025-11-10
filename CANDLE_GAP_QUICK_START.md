# Candle Gap Filling - Quick Start Guide

## 🚀 What This Does

Eliminates gaps in your candlestick charts by automatically creating "flat candles" for periods with no price data. Your charts will now display smooth, continuous candle sequences just like professional trading platforms.

---

## ⚡ Quick Setup (5 Minutes)

### Step 1: Apply Database Migration

The migration creates all necessary tables and functions for automatic gap filling.

```bash
# The migration file is already created at:
# supabase/migrations/20251110120000_add_automatic_candle_gap_filling.sql

# It will be applied automatically on next deployment
# Or apply manually via Supabase dashboard SQL editor
```

### Step 2: Backfill Historical Gaps

Fill any existing gaps in your historical data:

```bash
# Backfill last 3 days (recommended for first run)
node scripts/backfill-candle-gaps.js 72

# Or backfill last 7 days for more complete data
node scripts/backfill-candle-gaps.js 168
```

Expected output:
```
╔═══════════════════════════════════════════════════════════╗
║       HISTORICAL CANDLE GAP BACKFILL SCRIPT             ║
╚═══════════════════════════════════════════════════════════╝

📊 Scanning for gaps in the last 72 hours...
⏰ Started at: 11/10/2025, 3:45:23 PM

🔍 Calling auto_fill_all_gaps database function...

✅ Gap filling completed!

╔═══════════════════════════════════════════════════════════╗
║                    BACKFILL SUMMARY                       ║
╚═══════════════════════════════════════════════════════════╝

📊 Total Gaps Filled:     23
🕯️  Total Candles Created: 145

✅ All gaps have been filled with flat candles
📊 Your chart data is now continuous and complete
🎯 Charts will display smooth candle sequences without gaps
```

### Step 3: Verify Charts

1. Open your trading app
2. Navigate to any chart (EURUSD, XAUUSD, etc.)
3. Look for continuous candles with no gaps
4. Switch between timeframes (M1, M5, M15, etc.)

**What you should see:**
- ✅ Smooth, continuous candle sequences
- ✅ No visual gaps or missing periods
- ✅ Flat candles (thin lines) during low-activity periods

---

## 🎯 How It Works

### Three-Layer Protection

**1. Frontend (Browser)**
- Runs every 60 seconds
- Detects missing candles in real-time
- Creates flat candles immediately using cached price

**2. Backend (Netlify)**
- Runs every 5 minutes automatically
- Server-side safety net for missed gaps
- Works even when browser is closed

**3. Database (Supabase)**
- Stores gap fill logic and functions
- Maintains price cache for instant fills
- Provides audit logs of all operations

### What is a "Flat Candle"?

A flat candle represents a time period with no price movement:
- **Open** = Last known price
- **High** = Last known price
- **Low** = Last known price
- **Close** = Last known price
- **Volume** = 0

This is the same approach used by TradingView, MetaTrader, and other professional platforms.

---

## 📊 Monitoring

### View Data Health

The system includes a monitoring dashboard component:

```typescript
import CandleContinuityMonitor from '@/components/CandleContinuityMonitor';

// Add to your admin dashboard
<CandleContinuityMonitor />
```

**Shows:**
- Real-time data completeness per symbol/timeframe
- Recent gap fill operations
- Health indicators (green/yellow/red)
- Manual "Fill Gaps Now" button

### Check Console Logs

Watch for these messages in browser console:

```
[BackgroundAggregator] 🕐 Starting candle finalizer (checks every 60s)
[BackgroundAggregator] 🔧 Detected missing candle for EURUSD M5
[BackgroundAggregator] ✓ Created flat candle using price 1.05432
```

---

## 🔧 Common Commands

### Manual Gap Fill (Last 24 Hours)
```bash
node scripts/backfill-candle-gaps.js 24
```

### Check Database for Gaps
```sql
-- Check EURUSD M5 for gaps
SELECT
  open_time,
  LAG(open_time) OVER (ORDER BY open_time) as prev_time,
  EXTRACT(EPOCH FROM (open_time - LAG(open_time) OVER (ORDER BY open_time))) / 60 as gap_minutes
FROM forex_candles
WHERE symbol = 'EURUSD'
  AND timeframe = 'm5'
  AND open_time > now() - interval '24 hours'
  AND EXTRACT(EPOCH FROM (open_time - LAG(open_time) OVER (ORDER BY open_time))) / 60 > 6
ORDER BY open_time DESC;
```

### View Recent Gap Fills
```sql
SELECT
  symbol,
  timeframe,
  gap_start_time,
  gap_end_time,
  candles_filled,
  fill_price,
  created_at
FROM candle_gap_fill_log
ORDER BY created_at DESC
LIMIT 20;
```

### Check Price Cache
```sql
SELECT * FROM last_known_prices;
```

---

## ❓ FAQ

### Q: Will this slow down my charts?
**A:** No. The system is highly optimized:
- Frontend checks run only once per minute
- Database queries use indexes
- Minimal CPU/memory usage

### Q: What happens during weekends?
**A:** The system respects forex market hours (Sunday 5pm - Friday 5pm EST). No gaps are filled during weekend market closures - this is expected behavior.

### Q: Can I tell which candles are synthetic?
**A:** Visually, flat candles appear as thin lines (since OHLC are equal). In the database, they have `data_source = 'gap_fill'`.

### Q: Will backfilling create duplicate candles?
**A:** No. The system checks if a candle exists before creating one. It's safe to run backfill multiple times.

### Q: How much storage will this use?
**A:** Minimal. A flat candle is the same size as a regular candle (~100 bytes). Even 10,000 gap-fill candles = ~1MB.

---

## ⚠️ Troubleshooting

### Problem: Still seeing gaps

**Solution 1:** Run manual backfill
```bash
node scripts/backfill-candle-gaps.js 72
```

**Solution 2:** Check if system is running
```javascript
// In browser console:
console.log(backgroundCandleAggregator.getStatus());
// Should show: isRunning: true
```

**Solution 3:** Verify price cache
```sql
SELECT * FROM last_known_prices WHERE symbol = 'EURUSD';
-- Should return a recent price
```

### Problem: Too many flat candles

This usually means:
1. **Price feed issues** - Check realtime_prices table
2. **MetaAPI connection problems** - Verify connection
3. **Market is actually quiet** - This is normal during off-peak hours

Check price feed health:
```sql
SELECT COUNT(*) FROM realtime_prices
WHERE created_at > now() - interval '1 hour';
-- Should be > 1000 for active symbol
```

---

## 📚 More Information

For detailed technical documentation, see:
- **Full Guide:** `CANDLE_GAP_FILLING_GUIDE.md`
- **Database Schema:** Migration file in `supabase/migrations/`
- **Code:** `src/services/background-candle-aggregator.ts`

---

## ✅ Success Checklist

After setup, verify these items:

- [ ] Database migration applied successfully
- [ ] Backfill script completed without errors
- [ ] Charts display continuous candles (no visual gaps)
- [ ] Console shows `[BackgroundAggregator]` logs
- [ ] `last_known_prices` table has data
- [ ] Monitoring dashboard shows >95% completeness
- [ ] Netlify function scheduled and running

---

## 🎉 You're Done!

Your charts now have professional-grade continuity. The system will automatically:
- ✅ Detect gaps as they occur
- ✅ Fill them with flat candles
- ✅ Maintain continuous chart display
- ✅ Respect market hours
- ✅ Provide monitoring and logs

No more gaps. No more interrupted analysis. Just smooth, continuous charts like the pros use.

**Questions?** Check the full guide or review the troubleshooting section above.
