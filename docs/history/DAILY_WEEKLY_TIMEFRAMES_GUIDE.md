# Daily and Weekly Timeframes Implementation Guide

## Overview

Your trading platform now has full support for longer timeframes including **H4 (4-Hour)**, **D1 (Daily)**, and **W1 (Weekly)** charts across all trading pairs.

## What Was Implemented

### 1. Timeframe Support Added
- **H4**: 4-hour candles for medium-term analysis
- **D1**: Daily candles for swing trading and long-term trends
- **W1**: Weekly candles for macro trend analysis

### 2. Updated Components

#### Chart Preferences Service
- Added H4, D1, W1 to timeframe type definitions
- Configured appropriate data limits (365 days for D1, 260 weeks for W1)
- Set optimized polling intervals (10 minutes for D1, 30 minutes for W1)

#### Candle Data Service
- Full support for H4, D1, W1 timeframe calculations
- Proper time alignment for longer interval candles
- Validation logic for price movements on longer timeframes

#### Background Candle Aggregator
- Real-time aggregation for H4, D1, W1 candles
- Efficient memory management for longer interval data
- Automatic persistence of completed longer timeframe candles

#### MetaAPI Service
- Added W1 timeframe mappings
- Support for fetching historical daily and weekly data
- Proper time calculations for longer intervals

#### Market Chart Component
- H4, D1, W1 added to timeframe selector dropdown
- Optimized rendering for longer timeframe candles
- Proper date formatting for daily and weekly views

### 3. Database Optimizations

#### New Indexes Created
```sql
-- Composite index for efficient timeframe queries
idx_forex_candles_symbol_timeframe_time_desc

-- Partial indexes for specific timeframes
idx_forex_candles_daily (D1)
idx_forex_candles_weekly (W1)
idx_forex_candles_4hour (H4)
```

These indexes significantly improve chart loading performance when viewing daily and weekly timeframes.

### 4. Historical Data Backfill Script

A new script is available to backfill historical data for longer timeframes:

```bash
node scripts/backfill-daily-weekly-candles.js
```

This script will:
- Fetch historical H4, D1, and W1 candles from MetaAPI
- Backfill up to 90 days for H4, 365 days for D1, and 2 years for W1
- Store data in the forex_candles table
- Handle errors gracefully and provide progress updates

## How to Use

### Viewing Different Timeframes

1. Open your trading platform
2. Navigate to the Trade page
3. Select your desired trading pair (EURUSD, GBPUSD, etc.)
4. Click the timeframe dropdown
5. Select H4, D1, or W1

The chart will automatically:
- Load historical candles for the selected timeframe
- Display appropriate date formatting
- Update technical indicators for the longer timeframe
- Adjust the time scale for better visualization

### Trading on Longer Timeframes

When viewing daily or weekly charts:

- **Technical Indicators** automatically adjust to the timeframe
  - RSI, ATR, VWAP calculate based on daily/weekly candles
  - EMAs show appropriate periods for longer-term trends

- **Chart Analysis** shows broader market context
  - Daily charts: Perfect for swing trading (holding 1-5 days)
  - Weekly charts: Ideal for position trading (holding weeks/months)

- **Trade Signals** consider longer-term trends
  - More reliable support/resistance levels
  - Clearer trend direction identification
  - Reduced market noise

### Performance Characteristics

**Data Fetching:**
- M1, M5, M15, M30: 500 candles (~8-250 hours)
- H1: 500 candles (~21 days)
- H4: 500 candles (~83 days)
- D1: 365 candles (~1 year)
- W1: 260 candles (~5 years)

**Polling Intervals:**
- M1: 5 seconds (for intraday scalping)
- M5: 15 seconds
- M15: 30 seconds
- M30: 1 minute
- H1: 2 minutes
- H4: 4 minutes
- D1: 10 minutes (daily updates)
- W1: 30 minutes (weekly updates)

## Technical Details

### Timeframe Calculations

```typescript
// Minutes per candle
M1:  1 minute
M5:  5 minutes
M15: 15 minutes
M30: 30 minutes
H1:  60 minutes (1 hour)
H4:  240 minutes (4 hours)
D1:  1440 minutes (24 hours)
W1:  10080 minutes (7 days)
```

### Candle Time Alignment

Candles are aligned to their respective intervals:
- **D1**: Opens at 00:00 UTC each day
- **W1**: Opens at 00:00 UTC each Monday
- **H4**: Opens at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC

### Data Validation

The system validates longer timeframe candles against recent price history to ensure:
- No extreme price deviations (>10% from recent average)
- Proper time sequencing
- Consistent OHLC relationships

## Backfilling Historical Data

### When to Run Backfill

Run the backfill script when:
1. First setting up the platform
2. Adding new trading pairs
3. Recovering from extended downtime
4. Filling gaps in historical data

### Running the Backfill Script

```bash
# Ensure environment variables are set
export METAAPI_TOKEN="your-token"
export METAAPI_ACCOUNT_ID="your-account-id"
export SUPABASE_SERVICE_ROLE_KEY="your-service-key"

# Run the backfill
node scripts/backfill-daily-weekly-candles.js
```

### Expected Output

```
Starting Daily and Weekly Candle Backfill
=========================================

============================================================
Backfilling EURUSD H4
============================================================
Fetching H4 candles for EURUSD from 2024-08-01...
Received 540 H4 candles for EURUSD
Saved batch 1/6 for EURUSD H4
...
EURUSD H4: Inserted 540, Errors 0

============================================================
Backfilling EURUSD D1
============================================================
...
```

## Trading Strategies with Longer Timeframes

### Swing Trading with D1
1. Identify major support/resistance on weekly charts
2. Switch to daily charts for entry timing
3. Enter trades in direction of weekly trend
4. Use daily chart for stop loss and take profit levels

### Position Trading with W1
1. Identify multi-month trends on weekly charts
2. Wait for weekly candle confirmations
3. Enter on pullbacks using daily charts
4. Hold positions for weeks to months

### Multi-Timeframe Analysis
1. W1: Identify overall market direction
2. D1: Find key levels and entry zones
3. H4: Time your entry for optimal risk/reward
4. H1/M15: Fine-tune entry and exit points

## Troubleshooting

### Charts Not Loading
- Check browser console for errors
- Verify database connection is active
- Ensure sufficient historical data exists
- Try refreshing the page

### Missing Historical Data
- Run the backfill script: `node scripts/backfill-daily-weekly-candles.js`
- Check MetaAPI connection and credentials
- Verify symbol is available in your broker account

### Slow Chart Performance
- Check browser memory usage (close other tabs)
- Clear browser cache and reload
- Verify database indexes are created
- Check network connection speed

### Incorrect Timeframe Calculations
- Verify system time is set correctly (UTC)
- Check browser timezone settings
- Ensure proper date handling in chart library

## Best Practices

1. **Start with Weekly**: Always check the weekly chart first to understand the big picture
2. **Confirm with Daily**: Use daily charts to confirm weekly trends and find entry points
3. **Use Multiple Timeframes**: Combine W1, D1, and H4 for comprehensive analysis
4. **Respect Higher Timeframes**: Never trade against the trend on higher timeframes
5. **Be Patient**: Longer timeframes require patience - don't force trades

## Next Steps

Now that you have full support for daily and weekly timeframes:

1. **Backfill Historical Data**: Run the backfill script to populate your database
2. **Explore Different Timeframes**: Switch between timeframes to see how the market looks at different scales
3. **Develop Strategies**: Create trading strategies that incorporate multiple timeframe analysis
4. **Monitor Performance**: Track how longer timeframe analysis improves your trading decisions

## Support

If you encounter any issues or have questions:
1. Check the browser console for error messages
2. Review the database logs for any query issues
3. Verify all environment variables are set correctly
4. Ensure MetaAPI credentials are valid and active

Happy trading with your new multi-timeframe analysis capabilities!
