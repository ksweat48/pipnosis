# Historical Candle Backfill System

## Overview

This system backfills 1 year of historical candle data for all trading pairs and timeframes using free data sources with comprehensive validation and contamination protection.

## Features

✅ **Multi-source data fetching** - Yahoo Finance, Twelve Data, FCSAPI, Polygon with automatic fallback
✅ **Contamination protection** - Full integration with chart protection system
✅ **Symbol validation** - Uses branded types from symbol.ts
✅ **Price range validation** - Rejects prices outside valid ranges
✅ **Structure validation** - Validates OHLC consistency
✅ **Duplicate prevention** - Checks existing candles before insert
✅ **Batch processing** - Inserts candles in batches for performance
✅ **Progress tracking** - Real-time progress in database
✅ **Error handling** - Graceful handling with detailed logging
✅ **No disruption** - Runs separately from live polling/ticks

## Quick Start

### 1. Install Dependencies

```bash
cd scripts/backfill
npm install
```

### 2. Configure API Keys (Optional)

Add to your `.env` file (Yahoo Finance works without API keys):

```env
# Optional - for additional data sources
TWELVE_DATA_API_KEY=your_key_here
FCSAPI_KEY=your_key_here
POLYGON_API_KEY=your_key_here
```

### 3. Test with Single Pair

**IMPORTANT**: Test first to verify charts display data correctly!

```bash
npm run test-single
```

This will:
- Backfill 7 days of EURUSD 1h data
- Validate all candles
- Insert into database
- Show results

**After test completes:**
1. Open your app
2. Navigate to chart
3. Select EURUSD + 1h timeframe
4. Verify historical candles are visible

### 4. Run Full Backfill

Once test is successful and charts display data:

```bash
npm run backfill
```

This will backfill 1 year of data for:
- **Symbols**: EURUSD, GBPUSD, USDJPY, XAUUSD, US30, AUDUSD, USDCAD, NZDUSD, BTCUSD, ETHUSD
- **Timeframes**: 1d, 4h, 1h, 30m, 15m, 5m

## How It Works

### 1. Data Sources (Priority Order)

1. **Yahoo Finance** (Priority 100)
   - ✅ Free, no API key required
   - ✅ Reliable, good coverage
   - ✅ Forex, crypto, indices

2. **Twelve Data** (Priority 90)
   - 8 requests/minute free tier
   - 800 requests/day
   - Forex, crypto, stocks

3. **FCSAPI** (Priority 80)
   - 10 requests/minute
   - Forex focus

4. **Polygon** (Priority 70)
   - 5 requests/minute free tier
   - Forex, stocks

If primary source fails, automatically falls back to next source.

### 2. Validation Pipeline

Every candle goes through:

1. **Symbol Validation**
   - Checks symbol is known and valid
   - Uses branded types from chart protection system

2. **Structure Validation**
   - Validates OHLC consistency (high >= low, etc.)
   - Checks timestamps are valid
   - Ensures all prices are positive

3. **Range Validation**
   - Validates prices are within symbol-specific ranges
   - Example: EURUSD must be 0.90-1.40

4. **Contamination Detection**
   - Detects if prices belong to different symbol
   - Example: Rejects XAUUSD prices (2600) in EURUSD data

Rejected candles are logged but not inserted.

### 3. Database Integration

**Tables:**
- `backfill_progress` - Track status per symbol/timeframe
- `backfill_sources` - Data source configuration
- `backfill_execution_log` - Detailed execution logs
- `backfill_validation_stats` - Validation statistics

**Views:**
- `v_backfill_summary` - Overall progress summary
- `v_backfill_by_symbol` - Progress by symbol

### 4. Duplicate Prevention

Before inserting:
- Queries existing candles for time range
- Filters out duplicates
- Only inserts new candles

Uses UPSERT with `(symbol, timeframe, time)` conflict resolution.

### 5. Protection Integration

Fully integrated with chart protection system:
- Uses `ValidatedSymbol` branded types
- Applies price range validation
- Runs contamination detection
- Respects circuit breaker state
- Triggers database validation on insert

## File Structure

```
scripts/backfill/
├── README.md                    # This file
├── package.json                 # Dependencies
├── execute-backfill.js          # Main execution script
├── test-single-pair.js          # Test script
├── data-sources.js              # Multi-source data fetcher
├── candle-validator.js          # Validation pipeline
└── backfill-orchestrator.js     # Orchestration logic
```

## Progress Monitoring

### Check Status in Database

```sql
-- Overall summary
SELECT * FROM v_backfill_summary;

-- By symbol
SELECT * FROM v_backfill_by_symbol;

-- Detailed progress
SELECT symbol, timeframe, status, candles_inserted, candles_rejected
FROM backfill_progress
ORDER BY symbol, timeframe;

-- Validation stats
SELECT symbol, timeframe, total_candles, valid_candles,
       contamination_detected
FROM backfill_validation_stats
ORDER BY date DESC;
```

### Console Output

The script provides real-time progress:
```
🔄 Starting backfill: EURUSD 1h
   Period: 2024-12-01 to 2025-12-01

[EURUSD] Fetching data...
[EURUSD] ✅ Fetched 8760 candles from yahoo_finance
[EURUSD] Validating candles...
[EURUSD] Validation results:
   ✅ Valid: 8742
   ❌ Rejected: 18
[EURUSD] Inserting candles...
[EURUSD] Insert results:
   ✅ Inserted: 8742
   ❌ Failed: 0

✅ Backfill complete for EURUSD 1h
   Duration: 12.34s
   Success rate: 99.8%
```

## Expected Results

For 1 year backfill:

| Timeframe | Approx Candles per Symbol |
|-----------|---------------------------|
| 1d | ~365 |
| 4h | ~2,190 |
| 1h | ~8,760 |
| 30m | ~17,520 |
| 15m | ~35,040 |
| 5m | ~105,120 |

**Total per symbol**: ~169,000 candles
**Total for 10 symbols**: ~1,690,000 candles

Validation typically rejects 1-3% of candles (invalid structure, out of range, etc.)

## Troubleshooting

### No Data from Sources

**Problem**: `⚠️  No data received from any source`

**Solutions**:
- Check internet connection
- Verify API keys if using paid sources
- Check if symbol is supported by data source
- Try Yahoo Finance (doesn't need API key)

### High Rejection Rate

**Problem**: Many candles rejected by validation

**Solutions**:
- Check console for rejection reasons
- Review `backfill_validation_stats` table
- If contamination detected, check data source quality
- May need to adjust price ranges for new symbols

### Candles Not Visible on Chart

**Problem**: Backfill succeeds but charts don't show data

**Solutions**:
1. Verify candles exist in database:
   ```sql
   SELECT COUNT(*), MIN(time), MAX(time)
   FROM forex_candles
   WHERE symbol = 'EURUSD' AND timeframe = '1h';
   ```

2. Check timeframe format matches chart:
   - Chart uses: `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`, `1w`
   - Verify backfill uses same format

3. Refresh chart component or restart app

4. Check browser console for errors

### Database Errors

**Problem**: Insert fails with constraint violations

**Solutions**:
- Validation triggers may be rejecting candles
- Check `candle_validation_failures` table
- Review error messages in console
- May need to adjust validation logic

## Safety Features

### Won't Disrupt Live System

- Runs as separate Node.js process
- Doesn't interfere with browser polling
- Doesn't affect tick collection
- Doesn't block real-time updates

### Won't Break Charts

- Uses same data structure as live data
- Respects all database constraints
- Validates before insert
- Uses UPSERT to prevent duplicates

### Won't Insert Bad Data

- Multi-layer validation
- Contamination detection
- Range checks
- Structure verification
- Database triggers as final safety net

## Configuration

### Add More Symbols

Edit `execute-backfill.js`:

```javascript
const SYMBOLS = [
  'EURUSD',
  'GBPUSD',
  // Add your symbols here
  'EURGBP',
  'EURJPY',
];
```

### Add More Timeframes

```javascript
const TIMEFRAMES = [
  '1d',
  '4h',
  // Add timeframes here
  '2h',
  '1h',
];
```

### Adjust Time Range

```javascript
// For 2 years
const TWO_YEARS_AGO = new Date();
TWO_YEARS_AGO.setFullYear(TWO_YEARS_AGO.getFullYear() - 2);
```

### Add Data Sources

Edit `execute-backfill.js`:

```javascript
const sources = [
  { source: new YahooFinanceSource(), priority: 100 },
  { source: new YourCustomSource(), priority: 95 },
  // ... existing sources
];
```

## Performance

### Execution Time

- **Test (7 days)**: ~10-15 seconds
- **1 month**: ~30-60 seconds per symbol/timeframe
- **1 year**: ~5-10 minutes per symbol/timeframe
- **Full backfill**: 2-4 hours for all symbols/timeframes

Depends on:
- Data source speed
- Network latency
- Database performance
- Validation complexity

### Rate Limiting

Built-in rate limiting respects free tier limits:
- Yahoo Finance: 30 req/min
- Twelve Data: 8 req/min
- FCSAPI: 10 req/min
- Polygon: 5 req/min

### Database Load

Inserts in batches of 1000 candles with 100ms delay between batches to avoid overwhelming database.

## Support

### Check Logs

Console output shows detailed progress and errors.

### Query Database

```sql
-- Recent errors
SELECT * FROM backfill_execution_log
WHERE success = false
ORDER BY created_at DESC
LIMIT 10;

-- Contamination events
SELECT * FROM backfill_validation_stats
WHERE contamination_detected > 0
ORDER BY date DESC;
```

### Test Individual Components

```javascript
// Test validator
const { CandleValidator } = require('./candle-validator');
const validator = new CandleValidator();
const result = validator.validateCandle({
  symbol: 'EURUSD',
  time: Date.now() / 1000,
  open: 1.10,
  high: 1.11,
  low: 1.09,
  close: 1.10,
});
console.log(result);
```

## Next Steps

1. ✅ Run test: `npm run test-single`
2. ✅ Verify charts show test data
3. ✅ Run full backfill: `npm run backfill`
4. ✅ Monitor progress in console
5. ✅ Verify all charts show historical data
6. ✅ Check validation stats in database

---

**Questions? Check the logs and database tables for detailed information.**
