# Data Management Guide

## Overview

The system now includes comprehensive historical data management and automated refresh capabilities to ensure all chart data stays up-to-date across all symbols and timeframes.

## Key Features Implemented

### 1. Chart Zoom/Pan Fix

**What Changed:**
- The chart no longer automatically resets when you zoom in or pan around
- User interactions are tracked, and auto-scrolling is paused for 30 seconds after you interact with the chart
- A "Reset to Live" button has been added to manually re-enable auto-scrolling

**How to Use:**
1. Zoom or pan on the chart as needed
2. The chart will stay at your chosen view for 30 seconds
3. Click the "Reset to Live" button to immediately return to live tracking
4. After 30 seconds of no interaction, the chart automatically resumes live tracking

### 2. Historical Data Bulk Import

**Location:** Admin Dashboard → Data Management Tab

**What It Does:**
- Fetches historical candle data from MetaAPI for any combination of symbols and timeframes
- Saves data to both `forex_candles` and `market_data` tables
- Provides real-time progress tracking during import
- Handles errors gracefully with retry logic

**How to Use:**
1. Navigate to Admin Dashboard
2. Click "Data Management" tab
3. Select symbols (use "Select All" for all pairs)
4. Select timeframes (use "Select All" for all timeframes)
5. Set "Days Back" (default: 7, max: 365)
6. Click "Start Bulk Import"
7. Monitor progress in the right panel
8. View results in the "Data Status" table below

**Recommended Initial Setup:**
- Select all symbols
- Select all timeframes
- Set days back to 7-14 for initial load
- Run the import during off-peak hours

### 3. Automated Data Refresh

**What It Does:**
- Automatically fetches new candle data every hour (configurable)
- Only runs when forex market is open
- Checks for data gaps and fills them
- Updates data completeness status
- Logs all refresh operations

**How to Use:**
1. Navigate to Admin Dashboard → Data Management
2. Click the "Auto-Refresh ON/OFF" button in the top right
3. When enabled (green), the system will:
   - Check market hours before refreshing
   - Fetch new data for all configured symbols/timeframes
   - Log success/failure for each operation
   - Update the data status table

**Configuration:**
- Default refresh interval: 60 minutes
- Market hours check: Enabled by default (Sunday 5pm - Friday 5pm EST)
- Auto-starts on page load if previously enabled

### 4. Data Completeness Monitoring

**What It Tracks:**
- Total candles per symbol/timeframe
- Oldest and newest candle timestamps
- Data staleness (no updates in 1+ hour)
- Last refresh attempt and success times

**Database Tables:**
- `data_completeness_status`: Current status for each symbol/timeframe
- `data_refresh_log`: Historical log of all refresh operations

**Status Indicators:**
- **Active** (green): Data is current and up-to-date
- **Stale** (yellow): No new data in the last hour
- **No Data** (gray): No candles available for this symbol/timeframe

### 5. Admin Dashboard

**Tabs:**
- **Data Management**: Bulk import, auto-refresh, status monitoring
- **Analytics**: Coming soon
- **Settings**: Coming soon

## Database Schema

### New Tables

#### data_completeness_status
```sql
- symbol: text
- timeframe: text
- has_data: boolean
- oldest_candle: timestamptz
- newest_candle: timestamptz
- total_candles: integer
- is_stale: boolean
- last_updated: timestamptz
```

#### data_refresh_log
```sql
- symbol: text
- timeframe: text
- refresh_type: text (manual/scheduled/automatic)
- status: text (pending/fetching/saving/completed/failed)
- candles_fetched: integer
- candles_saved: integer
- error_message: text
- started_at: timestamptz
- completed_at: timestamptz
- duration_ms: integer
```

### Database Functions

#### update_data_completeness_status(symbol, timeframe)
- Calculates and updates completeness statistics
- Called automatically after each successful refresh

#### mark_stale_data()
- Identifies data that hasn't been updated in 1+ hour
- Called every 5 minutes automatically

## Best Practices

### Initial Setup
1. Run bulk import for all symbols and timeframes with 7-14 days back
2. Enable auto-refresh
3. Monitor the data status table to ensure all symbols are updating

### Daily Operations
1. Check the data status table for stale data
2. Review refresh logs for any failures
3. Manually trigger imports for specific symbols if needed

### Troubleshooting

**Problem: Chart zoom keeps resetting**
- Solution: This has been fixed. If still occurring, clear browser cache.

**Problem: No data showing in charts**
- Check data status table - it may show "No Data"
- Run bulk import for the specific symbol and timeframe
- Verify forex_candles table has data for that symbol

**Problem: Auto-refresh not working**
- Check if it's enabled in Admin Dashboard
- Verify market is open (Sunday 5pm - Friday 5pm EST)
- Check data_refresh_log table for error messages

**Problem: Some symbols have stale data**
- Click into data status and check last update time
- Manually run bulk import for those specific symbols
- Check MetaAPI connection status

## API Endpoints

### Netlify Functions

#### forex-candles
```
GET /.netlify/functions/forex-candles?symbol=EURUSD&timeframe=M15&limit=100
```
Fetches historical candles from MetaAPI and saves to database.

## Performance Notes

- Bulk imports are rate-limited to prevent MetaAPI throttling
- 500ms delay between each symbol/timeframe combination
- Large imports (365 days) may take 10-15 minutes for all symbols
- Auto-refresh is lightweight and runs in the background

## Security

- All data tables use Row Level Security (RLS)
- Authenticated users can read data
- Only service role can write (via functions)
- No sensitive data exposed in client code

## Future Enhancements

- Scheduled imports at market open (Sunday 5pm EST)
- Email notifications for failed refreshes
- Gap detection and automatic backfilling
- Data retention policies
- Export functionality (CSV/JSON)
- Historical data analytics dashboard
