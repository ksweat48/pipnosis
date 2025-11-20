# Quick Start: Comprehensive Historical Backfill

## 🎯 What This Does

Fetches ALL available historical candle data from earliest available date to present for all symbols and timeframes.

## ⚡ One Command to Rule Them All

```bash
node scripts/run-comprehensive-backfill.js
```

This single command will:
- ✅ Backfill all 5 symbols (XAUUSD, US30, EURUSD, GBPUSD, USDJPY)
- ✅ Backfill all 8 timeframes (M1, M5, M15, M30, H1, H4, D1, W1)
- ✅ Fetch maximum historical depth for each timeframe
- ✅ Fill forward to present candle
- ✅ Verify and display results

## ⏱️ Expected Time

**Full backfill**: 20-30 minutes

## 📊 What You Get

### Data Coverage

| Timeframe | Days Back | Candles per Symbol |
|-----------|-----------|-------------------|
| M1        | 30        | ~43,200           |
| M5        | 60        | ~17,280           |
| M15       | 90        | ~8,640            |
| M30       | 120       | ~5,760            |
| H1        | 180       | ~4,320            |
| H4        | 365       | ~2,190            |
| D1        | 730       | ~730              |
| W1        | 1,825     | ~260              |

**Total per symbol**: ~80,000 candles
**Total all symbols**: ~400,000 candles

## 🚀 Step-by-Step

### 1. Deploy Edge Function (One Time Only)

**Via Supabase Dashboard:**
1. Open [Supabase Dashboard](https://supabase.com/dashboard)
2. Go to **Edge Functions**
3. Click **New Function**
4. Name: `comprehensive-backfill`
5. Copy code from `supabase/functions/comprehensive-backfill/index.ts`
6. Deploy

### 2. Run Backfill

```bash
node scripts/run-comprehensive-backfill.js
```

### 3. Watch Progress

You'll see real-time output like:

```
🚀 Comprehensive Historical Backfill Tool

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 Processing symbol: EURUSD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ⏳ Processing H1 (max 180 days back)...
    📅 Existing data: None
    🎯 Backfilling from: 2024-05-20
    📦 Batch 1: 2024-05-20 to 2024-06-19
      ✅ Saved 720 candles
    📦 Batch 2: 2024-04-20 to 2024-05-20
      ✅ Saved 744 candles
    ⏩ Filling forward to present...
      ✅ Added 24 recent candles
  ✅ EURUSD H1 complete: 4,320 candles
```

### 4. Verify Results

At the end, you'll see a verification table:

```
┌────────────┬─────────┬──────────────┬──────────────┬───────────────┐
│ Symbol     │ TF      │ Total        │ Oldest       │ Newest        │
├────────────┼─────────┼──────────────┼──────────────┼───────────────┤
│ EURUSD     │ M1      │      43,200  │ 2024-10-20   │ 2024-11-20    │
│ EURUSD     │ H1      │       4,320  │ 2024-05-20   │ 2024-11-20    │
│ EURUSD     │ D1      │         730  │ 2022-11-20   │ 2024-11-20    │
└────────────┴─────────┴──────────────┴──────────────┴───────────────┘
```

## 🎯 Advanced Usage

### Backfill Single Symbol

```bash
node scripts/run-comprehensive-backfill.js EURUSD
```

### Backfill Single Timeframe

```bash
node scripts/run-comprehensive-backfill.js EURUSD H1
```

### Backfill Multiple Symbols (Run Sequentially)

```bash
node scripts/run-comprehensive-backfill.js EURUSD
node scripts/run-comprehensive-backfill.js XAUUSD
node scripts/run-comprehensive-backfill.js US30
```

## ❓ Common Questions

### Q: Will this overwrite my existing data?
**A:** No! The system intelligently preserves existing data and only fills gaps.

### Q: What if it times out?
**A:** Run it for specific symbols/timeframes to reduce load:
```bash
node scripts/run-comprehensive-backfill.js EURUSD H1
```

### Q: Can I run this multiple times?
**A:** Yes! It's idempotent - safe to run repeatedly.

### Q: What if I see "No candles returned"?
**A:** Normal! This means you've reached the limit of available historical data.

### Q: How often should I run this?
**A:**
- **Initially**: Once to populate database
- **Maintenance**: Weekly or after downtime
- **Before AI training**: To ensure maximum data availability

## 🔧 Requirements

### Environment Variables

Ensure these are set in your `.env` file:

```env
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-anon-key
METAAPI_TOKEN=your-metaapi-token
METAAPI_ACCOUNT_ID=your-account-id
```

### MetaAPI Limits

Be aware of your MetaAPI subscription limits:
- **Free tier**: Limited historical data access
- **Paid tiers**: Full historical data access
- **Rate limits**: System includes automatic rate limiting (500ms delays)

## ✅ Success Checklist

After running, verify:
- [ ] Console shows "COMPREHENSIVE BACKFILL COMPLETE!"
- [ ] Verification table shows data for all symbols/timeframes
- [ ] Date ranges match expected depths
- [ ] No critical errors in console
- [ ] Total candles count looks reasonable

## 🚨 Troubleshooting

### Issue: "VITE_SUPABASE_URL not set"
**Fix:** Ensure `.env` file exists with correct variables

### Issue: MetaAPI errors
**Fix:**
1. Verify `METAAPI_TOKEN` and `METAAPI_ACCOUNT_ID`
2. Check MetaAPI subscription status
3. Ensure account is active and connected

### Issue: Function not found
**Fix:** Deploy the edge function first (see Step 1 above)

### Issue: Slow performance
**Solution:** Normal for large backfills. Reduce scope:
```bash
# Just the essentials
node scripts/run-comprehensive-backfill.js EURUSD H1
node scripts/run-comprehensive-backfill.js EURUSD D1
```

## 📚 More Information

- `COMPREHENSIVE_BACKFILL_README.md` - Full documentation
- `COMPREHENSIVE_BACKFILL_GUIDE.md` - Technical details
- `supabase/functions/comprehensive-backfill/index.ts` - Source code

## 🎉 Next Steps

After successful backfill:

1. **Verify Data Quality**
   - Check admin dashboard for data metrics
   - Run gap detection if needed

2. **Start AI Training**
   - Navigate to AI Training page
   - Start training with comprehensive historical dataset

3. **Enable Real-time Updates**
   - Ensure continuous polling is active
   - Monitor data freshness

4. **Run Backtests**
   - Test strategies against historical data
   - Evaluate performance across different time periods

## 💡 Pro Tips

1. **Run during off-peak hours** - Less likely to hit rate limits
2. **Start with one symbol** - Test the system first
3. **Monitor console output** - Watch for errors or warnings
4. **Check verification table** - Ensure expected data ranges
5. **Keep MetaAPI quota in mind** - Large backfills use quota

## 🏁 Ready to Start?

Just run:

```bash
node scripts/run-comprehensive-backfill.js
```

That's it! The system handles everything else automatically.
