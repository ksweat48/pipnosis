# Comprehensive Backfill - Quick Reference

## 🚀 One-Line Usage

```bash
node scripts/run-comprehensive-backfill.js
```

## 📋 Command Options

```bash
# All symbols, all timeframes (20-30 min)
node scripts/run-comprehensive-backfill.js

# Single symbol, all timeframes (8-12 min)
node scripts/run-comprehensive-backfill.js EURUSD

# Single symbol, single timeframe (2-3 min)
node scripts/run-comprehensive-backfill.js EURUSD H1
```

## 📊 What You Get

| Timeframe | Days Back | Candles/Symbol |
|-----------|-----------|----------------|
| M1        | 30        | ~43,200        |
| M5        | 60        | ~17,280        |
| M15       | 90        | ~8,640         |
| M30       | 120       | ~5,760         |
| H1        | 180       | ~4,320         |
| H4        | 365       | ~2,190         |
| D1        | 730       | ~730           |
| W1        | 1,825     | ~260           |

**Total**: ~400,000 candles across 5 symbols

## ⚡ Quick Setup

### 1. Deploy Edge Function
- Go to Supabase Dashboard → Edge Functions
- Create: `comprehensive-backfill`
- Copy: `supabase/functions/comprehensive-backfill/index.ts`
- Deploy

### 2. Set Environment Variables
```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
METAAPI_TOKEN=...
METAAPI_ACCOUNT_ID=...
```

### 3. Run
```bash
node scripts/run-comprehensive-backfill.js
```

## ✅ Success Check

Look for:
- ✅ "COMPREHENSIVE BACKFILL COMPLETE!"
- ✅ Verification table with counts
- ✅ Date ranges match expected
- ✅ No critical errors

## 🔧 Troubleshooting

| Issue | Fix |
|-------|-----|
| "Function not found" | Deploy edge function first |
| "VITE_SUPABASE_URL not set" | Check `.env` file |
| MetaAPI errors | Verify credentials |
| Timeout | Run smaller chunks |

## 📁 File Locations

```
supabase/functions/comprehensive-backfill/index.ts  # Edge function
scripts/run-comprehensive-backfill.js               # Execution script
COMPREHENSIVE_BACKFILL_README.md                     # Full docs
BACKFILL_QUICK_START.md                              # Setup guide
```

## 🎯 Common Scenarios

**Initial Setup**:
```bash
node scripts/run-comprehensive-backfill.js
```

**Just the essentials**:
```bash
node scripts/run-comprehensive-backfill.js EURUSD H1
node scripts/run-comprehensive-backfill.js EURUSD D1
```

**After downtime**:
```bash
node scripts/run-comprehensive-backfill.js
```

## 📞 Need Help?

Check these docs in order:
1. `BACKFILL_QUICK_START.md` - Quick start guide
2. `COMPREHENSIVE_BACKFILL_README.md` - Full documentation
3. `COMPREHENSIVE_BACKFILL_GUIDE.md` - Technical details

## ⏱️ Expected Times

- M1: 5-10 min
- M5: 5-8 min
- M15: 3-5 min
- M30: 3-4 min
- H1: 2-3 min
- H4: 2-3 min
- D1: 1-2 min
- W1: 1 min

**All symbols × all timeframes**: 20-30 min

## 💡 Remember

- Safe to run multiple times (idempotent)
- Preserves existing good quality data
- Includes automatic verification
- Rate limited (500ms delays)
- Real-time progress tracking

---

**Quick Start**: Deploy function → Run script → Verify results → Done! 🎉
