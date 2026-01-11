# Comprehensive Historical Data Backfill System

## Overview

This system provides automated historical data backfilling for all timeframes across multiple currency pairs using Dukascopy's free forex data API.

## Supported Pairs

- GBPJPY (British Pound / Japanese Yen)
- EURJPY (Euro / Japanese Yen)
- AUDUSD (Australian Dollar / US Dollar)
- NZDUSD (New Zealand Dollar / US Dollar)

## Supported Timeframes & Data Ranges

Each timeframe is configured with an optimal historical data range:

| Timeframe | Days Back | Description |
|-----------|-----------|-------------|
| M1 | 7 days | 1-minute candles |
| M5 | 14 days | 5-minute candles |
| M15 | 30 days | 15-minute candles |
| H1 | 90 days | 1-hour candles |
| H4 | 180 days | 4-hour candles |
| D1 | 730 days | Daily candles (2 years) |
| W1 | 1825 days | Weekly candles (5 years) |

## Architecture

### Components

1. **Netlify Function**: `backfill-all-timeframes-new-pairs.ts`
   - Handles batch processing of multiple symbol/timeframe combinations
   - Fetches data from Dukascopy API
   - Transforms and validates OHLC data
   - Inserts into Supabase database with conflict resolution

2. **Trigger Script**: `scripts/trigger-comprehensive-backfill.mjs`
   - Command-line interface for triggering backfills
   - Supports custom symbol and timeframe selection
   - Provides detailed progress reporting

### Data Flow

```
1. Trigger Script → Netlify Function
2. Netlify Function → Dukascopy API (fetch historical candles)
3. Dukascopy API → Data Validation & Transformation
4. Transformed Data → Supabase Database (upsert with conflict resolution)
5. Results → Detailed Report
```

## Usage

### Full Backfill (All Pairs, All Timeframes)

```bash
node scripts/trigger-comprehensive-backfill.mjs
```

This will backfill:
- 4 currency pairs × 7 timeframes = 28 operations
- Expected duration: 15-30 minutes
- Expected data volume: ~500,000+ candles

### Custom Symbol Backfill

```bash
node scripts/trigger-comprehensive-backfill.mjs --symbols GBPJPY,EURJPY
```

### Custom Timeframe Backfill

```bash
node scripts/trigger-comprehensive-backfill.mjs --timeframes H1,H4,D1
```

### Specific Combination

```bash
node scripts/trigger-comprehensive-backfill.mjs --symbols GBPJPY --timeframes M15,H1
```

### Get Help

```bash
node scripts/trigger-comprehensive-backfill.mjs --help
```

## Data Quality

### Source Priority

Data is marked as `dukascopy_historical` which has the highest priority in the system's data quality hierarchy:

1. `dukascopy_historical` (highest quality)
2. `metaapi`
3. `finnhub`
4. `twelvedata`

### Validation

Each candle is validated before insertion:

- High must be >= Low
- High must be >= Open and Close
- Low must be <= Open and Close
- All OHLC values must be > 0
- Timestamps must be sequential and non-overlapping

### Conflict Resolution

- Uses `upsert` with conflict on `(symbol, timeframe, open_time)`
- Existing candles are updated with newer data
- Duplicate prevention at database level

## Database Schema

Candles are stored in the `forex_candles` table:

```sql
{
  symbol: string,
  timeframe: string,
  open_time: timestamp,
  close_time: timestamp,
  open: float,
  high: float,
  low: float,
  close: float,
  volume: float,
  data_source: string
}
```

Unique constraint: `(symbol, timeframe, open_time)`

## Monitoring & Logging

### Console Output

The system provides real-time progress updates:

```
========================================
COMPREHENSIVE BACKFILL STARTED
========================================
Symbols: GBPJPY, EURJPY, AUDUSD, NZDUSD
Timeframes: M1, M5, M15, H1, H4, D1, W1
========================================

=== Starting backfill: GBPJPY M1 (7 days) ===
Fetching GBPJPY M1 from Dukascopy
Fetched 10080 candles from Dukascopy
Transformed 10080 valid candles
Inserting 10080 candles into database...
Batch 1: Inserted 500 candles
Batch 2: Inserted 500 candles
...
Completed GBPJPY M1: 10080/10080 candles in 5.34s
```

### Summary Report

After completion, a detailed summary is provided:

```json
{
  "success": true,
  "summary": {
    "totalOperations": 28,
    "successfulOperations": 28,
    "failedOperations": 0,
    "totalCandlesFetched": 523456,
    "totalCandlesInserted": 523456,
    "duration": "1245.67s"
  },
  "results": [...]
}
```

## Error Handling

### Network Errors

- Automatic retry with exponential backoff
- 60-second timeout per API request
- Graceful degradation on partial failures

### Data Errors

- Invalid candles are filtered out during transformation
- OHLC validation catches corrupt data
- Batch processing continues even if individual batches fail

### Rate Limiting

- 1-second delay between operations
- Respects Dukascopy API limits
- Batch size: 500 candles per database insert

## Performance Optimization

### Batch Processing

- Database inserts use batches of 500 candles
- Reduces database round-trips
- Optimizes memory usage

### Timeframe Strategy

- Shorter timeframes fetch less historical data
- Prevents overwhelming the database
- Balances data completeness with performance

### Parallel Processing

Currently sequential (one operation at a time) to:
- Respect API rate limits
- Prevent database connection exhaustion
- Maintain system stability

Future enhancement: Parallel processing with configurable concurrency.

## Troubleshooting

### No Data Returned

**Cause**: Dukascopy may not have data for the requested time range

**Solution**: Try a different date range or check Dukascopy availability

### Database Connection Errors

**Cause**: Supabase connection limits exceeded

**Solution**:
- Check Supabase dashboard for connection pool status
- Reduce batch size if necessary
- Wait and retry

### Timeout Errors

**Cause**: Large data ranges taking too long

**Solution**:
- Break into smaller date ranges
- Use custom timeframe selection
- Deploy to production (longer timeout limits)

## Maintenance

### Regular Backfills

Recommended schedule:

- **Daily**: M1, M5, M15 (catch up on recent data)
- **Weekly**: H1, H4 (fill in hourly data)
- **Monthly**: D1, W1 (update longer timeframes)

### Data Verification

After backfill, verify data completeness:

```sql
SELECT
  symbol,
  timeframe,
  COUNT(*) as candle_count,
  MIN(open_time) as earliest,
  MAX(open_time) as latest
FROM forex_candles
WHERE symbol IN ('GBPJPY', 'EURJPY', 'AUDUSD', 'NZDUSD')
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;
```

## Future Enhancements

1. **Parallel Processing**: Process multiple symbol/timeframe combinations concurrently
2. **Gap Detection**: Identify and fill missing candles automatically
3. **Incremental Backfill**: Only fetch data newer than existing records
4. **Progress Persistence**: Resume interrupted backfills
5. **Data Quality Metrics**: Track completeness and accuracy over time
6. **Alternative Sources**: Fallback to other APIs if Dukascopy fails

## Security

- Admin key required for all backfill operations
- API keys stored in environment variables
- CORS headers properly configured
- Service role key used for database access

## Cost Considerations

- **Dukascopy API**: Free (no cost)
- **Netlify Functions**: ~15-30 minutes runtime per full backfill
- **Supabase Storage**: ~500k+ rows per full backfill
- **Database Bandwidth**: Consider Supabase plan limits

## Support

For issues or questions:

1. Check Netlify function logs for detailed error messages
2. Verify environment variables are set correctly
3. Ensure Supabase connection is healthy
4. Review Dukascopy API status

## Changelog

### Version 1.0 (December 2024)

- Initial implementation
- Support for 4 currency pairs
- Support for 7 timeframes
- Dukascopy API integration
- Batch processing and validation
- Command-line trigger script
- Comprehensive logging and reporting
