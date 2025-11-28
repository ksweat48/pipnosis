# Quick Start: Nuclear Reset System

## What Just Happened

✅ **Database was completely wiped clean** - All candles and prices deleted
✅ **Validation system installed** - Invalid prices are now auto-rejected
✅ **UI controls added** - Settings page has reset panel
✅ **Protection active** - Cross-symbol contamination is blocked

---

## Immediate Actions Needed

### Step 1: Clear Your Browser Cache
1. Go to **Settings** page (after deployment completes)
2. Find **"Data Reset & Cache Management"** section
3. Click **"Clear Cache & Reload"** button
4. Page will reload with clean state

### Step 2: Verify Charts Work
1. Go to **Charts** page
2. Load **EURUSD** - should show ~1.05-1.20 range
3. Load **XAUUSD** - should show ~2600-4200 range
4. Verify prices are correct for each symbol

### Step 3: Monitor for Issues
Watch the Settings page "Validation Rejections" counter:
- **0 rejections** = System is clean ✅
- **>0 rejections** = Cross-contamination detected 🚨

---

## What's Now Protected

### All Data Entry Points
- ✅ Live prices from MetaAPI
- ✅ Prices from database
- ✅ Candles from database
- ✅ Tick updates to chart
- ✅ Database inserts (via triggers)

### Detection Active
- ✅ EURUSD price (1.16) CANNOT contaminate XAUUSD chart
- ✅ XAUUSD price (2600) CANNOT contaminate EURUSD chart
- ✅ Invalid data is logged and rejected
- ✅ Console shows detailed error messages

---

## If Problem Persists

### Check Console Logs
Look for:
```
❌ REJECTED invalid price for XAUUSD: bid=1.16017 ask=1.16019
🚨 CROSS-CONTAMINATION: XAUUSD received EURUSD price!
```

### Check Database Rejections
```sql
SELECT * FROM price_validation_rejections
ORDER BY created_at DESC LIMIT 10;
```

### Check Settings Page
Go to Settings → Data Reset panel:
- Red alert = Cross-contamination detected
- Shows rejection count
- Shows suspected symbol

---

## Quick Reference: Valid Price Ranges

| Symbol | Min | Max | Typical |
|--------|-----|-----|---------|
| EURUSD | 0.50 | 2.00 | 1.10 |
| GBPUSD | 0.50 | 3.00 | 1.27 |
| USDJPY | 50 | 200 | 149 |
| XAUUSD | 1000 | 10000 | 2600 |
| XAGUSD | 10 | 100 | 30 |

Any price outside these ranges is **automatically rejected**.

---

## Troubleshooting

### Chart shows "1.16017" for XAUUSD
**This means the validation didn't catch it yet.**
1. Hard refresh page (Ctrl+Shift+R)
2. Clear cache from Settings
3. Check console for errors
4. Check if MetaAPI function has symbol parameter bug

### Rejection count increasing
**This is GOOD - system is working!**
1. Check console logs to see what's being rejected
2. Review `price_validation_rejections` table
3. Identify the source (MetaAPI, database, etc.)
4. Fix the source of contamination

### No data showing on charts
**Database is empty after nuclear reset.**
1. Just load a chart - data will be fetched automatically
2. Wait 10-30 seconds for initial load
3. Data is validated before insertion
4. Clean data will start flowing

---

## Key Files

- `src/services/price-validation-service.ts` - Core validation
- `src/components/DataResetPanel.tsx` - UI controls
- `supabase/migrations/20251128050000_nuclear_data_reset_and_validation.sql` - Database setup
- `scripts/force-fresh-data-collection.js` - Manual data collection

---

## Success Indicators

✅ XAUUSD shows ~2600-4200 prices
✅ EURUSD shows ~1.05-1.20 prices
✅ No "REJECTED" errors in console
✅ Validation rejections counter = 0
✅ Charts update smoothly

---

**The system is now hardened against cross-symbol contamination. Invalid data will be detected and rejected automatically.**
