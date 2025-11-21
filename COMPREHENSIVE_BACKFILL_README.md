# Comprehensive Historical Backfill System

## 🎯 Purpose

Fetch ALL available historical candle data from the earliest available date to the present candle for all symbols and timeframes.

## 📦 Components

### 1. Edge Function
- **Location**: `supabase/functions/comprehensive-backfill/index.ts`
- **Purpose**: Server-side backfill execution with MetaAPI
- **Timeout**: Handles long-running backfill operations

### 2. Execution Script
- **Location**: `scripts/run-comprehensive-backfill.js`
- **Purpose**: Command-line interface for triggering backfills
- **Features**: Progress tracking, verification, detailed reporting

### 3. Deployment Script
- **Location**: `scripts/deploy-comprehensive-backfill.sh`
- **Purpose**: Deploy edge function to Supabase

## 🚀 Quick Start

### Step 1: Deploy the Edge Function

The edge function must be deployed to your Supabase project:

**Option A: Manual Deployment (Recommended)**
1. Go to your Supabase Dashboard
2. Navigate to **Edge Functions**
3. Click **New Function**
4. Name: `comprehensive-backfill`
5. Copy contents from `supabase/functions/comprehensive-backfill/index.ts`
6. Paste and deploy

**Option B: CLI Deployment**
```bash
./scripts/deploy-comprehensive-backfill.sh
```

### Step 2: Run the Backfill

**Backfill everything:**
```bash
node scripts/run-comprehensive-backfill.js
```

**Backfill specific symbol:**
```bash
node scripts/run-comprehensive-backfill.js EURUSD
```

**Backfill specific symbol and timeframe:**
```bash
node scripts/run-comprehensive-backfill.js EURUSD H1
```

## 📊 What Gets Backfilled

### Symbols
- XAUUSD (Gold)
- US30 (Dow Jones)
- EURUSD (Euro/Dollar)
- GBPUSD (Pound/Dollar)
- USDJPY (Dollar/Yen)

### Timeframes with Maximum Depths

| Timeframe | Max Days | Data Points | Storage Size |
|-----------|----------|-------------|--------------|
| M1        | 30       | ~43,200     | ~2 MB        |
| M5        | 60       | ~17,280     | ~1 MB        |
| M15       | 90       | ~8,640      | ~500 KB      |
| M30       | 120      | ~5,760      | ~350 KB      |
| H1        | 180      | ~4,320      | ~250 KB      |
| H4        | 365      | ~2,190      | ~125 KB      |
| D1        | 730      | ~730        | ~40 KB       |
| W1        | 1,825    | ~260        | ~15 KB       |

**Total per symbol**: ~4.5 MB
**Total all symbols**: ~22.5 MB

## ⚙️ How It Works

### Algorithm

```
FOR each symbol:
  FOR each timeframe:
    1. Check existing data range
    2. Determine backfill start date (max depth limit)
    3. BACKWARD FILL:
       - Fetch 30-day chunks moving backwards
       - Continue until max depth or no more data
       - Save with data_source='backfill'
    4. FORWARD FILL:
       - Fetch from newest existing to present
       - Fill any recent gaps
       - Save with data_source='metaapi'
    5. Verify final data range
```

### Smart Features

1. **Respects Existing Data**: Won't overwrite good quality data
2. **Adaptive Ranges**: Each timeframe has appropriate depth limits
3. **Gap Detection**: Identifies and reports missing periods
4. **Error Recovery**: Continues despite individual failures
5. **Rate Limiting**: 500ms delays prevent API throttling
6. **Progress Tracking**: Real-time console updates

## 📈 Expected Runtime

- **Single symbol, single timeframe**: 30 seconds - 2 minutes
- **Single symbol, all timeframes**: 5-10 minutes
- **All symbols, all timeframes**: 20-30 minutes

## 🎨 Console Output Example

```
🚀 Starting comprehensive historical backfill...
📊 Processing 5 symbols × 8 timeframes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 Processing symbol: EURUSD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ⏳ Processing H1 (max 180 days back)...
    📅 Existing data: 2024-10-20 to 2024-11-19
    🎯 Backfilling from: 2024-05-20
    📦 Batch 1: 2024-05-20 to 2024-06-19
      ✅ Saved 720 candles
    📦 Batch 2: 2024-04-20 to 2024-05-20
      ✅ Saved 744 candles
    ...
    ⏩ Filling forward to present...
      ✅ Added 24 recent candles
  ✅ EURUSD H1 complete: 4,320 candles
     Range: 2024-05-23 to 2024-11-20
```

## 📋 Verification Output

After completion, a verification table shows your data:

```
┌────────────┬─────────┬──────────────┬──────────────┬───────────────┐
│ Symbol     │ TF      │ Total        │ Oldest       │ Newest        │
├────────────┼─────────┼──────────────┼──────────────┼───────────────┤
│ EURUSD     │ M1      │      43,200  │ 2024-10-20   │ 2024-11-20    │
│ EURUSD     │ M5      │      17,280  │ 2024-09-20   │ 2024-11-20    │
│ EURUSD     │ M15     │       8,640  │ 2024-08-20   │ 2024-11-20    │
│ EURUSD     │ M30     │       5,760  │ 2024-07-20   │ 2024-11-20    │
│ EURUSD     │ H1      │       4,320  │ 2024-05-20   │ 2024-11-20    │
│ EURUSD     │ H4      │       2,190  │ 2023-11-20   │ 2024-11-20    │
│ EURUSD     │ D1      │         730  │ 2022-11-20   │ 2024-11-20    │
│ EURUSD     │ W1      │         260  │ 2019-11-20   │ 2024-11-20    │
└────────────┴─────────┴──────────────┴──────────────┴───────────────┘
```

## 🔧 Configuration

### Environment Variables Required

```env
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
METAAPI_TOKEN=your-metaapi-token
METAAPI_ACCOUNT_ID=your-account-id
METAAPI_REGION=london
```

### Customization

To modify backfill depths, edit the `TIMEFRAMES` array in:
`supabase/functions/comprehensive-backfill/index.ts`

```typescript
const TIMEFRAMES = [
  { name: 'M1', minutes: 1, maxDaysBack: 30 },
  { name: 'M5', minutes: 5, maxDaysBack: 60 },
  // ... modify maxDaysBack values as needed
];
```

## 🐛 Troubleshooting

### "No candles returned"
- Normal when reaching historical data limits
- System automatically marks as complete

### "MetaAPI 404 errors"
- Some symbols may not have data for all timeframes
- Expected behavior, safely handled

### "Function timeout"
- Large backfills may timeout
- Run in smaller chunks (specific symbol/timeframe)
- Or increase edge function timeout in Supabase

### "Database conflicts"
- System uses smart upsert logic
- Existing good data is preserved
- Check console for specific error messages

## 📞 Support

For issues or questions:
1. Check console output for detailed error messages
2. Review `COMPREHENSIVE_BACKFILL_GUIDE.md` for detailed information
3. Verify MetaAPI credentials are correct
4. Ensure sufficient MetaAPI quota for large backfills

## 🎯 Use Cases

### Initial Setup
Run once to populate your database with comprehensive historical data for AI training.

### Regular Maintenance
Run weekly to ensure continuous coverage and fill any gaps.

### Before Training
Run before major AI training sessions to ensure maximum data availability.

### After Downtime
Run after system downtime to fill any gaps in real-time data collection.

## 🔄 Integration

This backfill system integrates with:
- **AI Training System**: Provides historical data for model training
- **Backtesting Engine**: Enables comprehensive strategy testing
- **Gap Prevention System**: Complements real-time data collection
- **Data Quality Monitoring**: Tracked via `candle_quality_metrics` table

## 📚 Additional Resources

- `COMPREHENSIVE_BACKFILL_GUIDE.md` - Detailed technical guide
- `supabase/functions/comprehensive-backfill/index.ts` - Source code
- `scripts/run-comprehensive-backfill.js` - Execution script

## ✅ Success Criteria

A successful backfill should result in:
- ✅ All symbols have data for all timeframes
- ✅ Date ranges match maximum depth limits
- ✅ No gaps between oldest and newest candles
- ✅ Recent data extends to present
- ✅ Console shows 100% success rate
- ✅ Verification table shows expected counts

## 🚦 Status Indicators

- ✅ **Complete** - Full backfill successful
- ⚠️ **Partial** - Some data missing (normal for historical limits)
- ❌ **Failed** - Check error messages and retry
