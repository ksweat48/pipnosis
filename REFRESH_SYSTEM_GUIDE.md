# Automated Refresh System Guide

## Overview

The Automated Refresh System ensures your historical candle data stays up-to-date through scheduled daily refreshes and manual on-demand refreshes. The system supports both single symbol refreshes and batch operations across multiple trading pairs.

## System Components

### 1. Database Tables

**refresh_schedules**
- Stores scheduled refresh configurations
- Controls which symbols/timeframes are automatically refreshed
- Tracks last run and next scheduled run times

**refresh_history**
- Audit log of all refresh operations
- Tracks success/failure status, candles fetched, and duration
- Supports filtering by symbol, timeframe, and status

### 2. Netlify Functions

**refresh-candles**
- Manual refresh endpoint for single symbols or batch operations
- Requires admin authentication via `ADMIN_REFRESH_KEY`
- Supports both single and batch modes

**scheduled-refresh**
- Automated daily refresh function
- Runs at 2:00 AM UTC (configured in netlify.toml)
- Processes all enabled schedules automatically

### 3. Admin Interface

**Refresh Schedule Manager**
- Visual interface for managing schedules
- Add, edit, enable/disable, and delete schedules
- View refresh history with real-time status
- Trigger manual refreshes from the UI
- Access via Admin Dashboard > Refresh Schedules tab

## Setup Instructions

### 1. Environment Variables

Add these to your Netlify environment variables:

```bash
# Supabase Service Role Key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Admin Refresh Key (use a secure random string)
ADMIN_REFRESH_KEY=your_secure_admin_key_here
```

**To get your Supabase Service Role Key:**
1. Go to your Supabase Dashboard
2. Navigate to Settings > API
3. Copy the `service_role` key (keep this secret!)

### 2. Deploy to Netlify

The scheduled function will automatically be configured when you deploy:

```bash
# Deploy using build hook
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

Or push to your connected repository.

### 3. Verify Scheduled Function

After deployment:
1. Go to Netlify Dashboard > Functions
2. Find `scheduled-refresh` function
3. Verify the schedule is set to `0 2 * * *` (daily at 2 AM UTC)

## Usage

### Manual Single Refresh

Refresh a specific symbol/timeframe:

```bash
curl -X POST "https://your-app.netlify.app/.netlify/functions/refresh-candles?symbol=EURUSD&timeframe=5m&daysBack=3&adminKey=YOUR_ADMIN_KEY"
```

**Parameters:**
- `symbol`: Trading symbol (e.g., EURUSD, GBPUSD, XAUUSD)
- `timeframe`: One of: 5m, 15m, 1h
- `daysBack`: Number of days to fetch (1-365, default: 3)
- `overwrite`: true/false (default: true)
- `adminKey`: Your secret admin key

### Manual Batch Refresh

Refresh all enabled schedules:

```bash
curl -X POST "https://your-app.netlify.app/.netlify/functions/refresh-candles?mode=batch&adminKey=YOUR_ADMIN_KEY"
```

### Using the Admin Interface

1. Log in as admin
2. Navigate to Admin Dashboard
3. Click "Refresh Schedules" tab
4. Use the interface to:
   - Add new schedules
   - Enable/disable existing schedules
   - Trigger manual refreshes
   - View refresh history
   - Delete schedules

## Default Schedules

The system comes pre-configured with these schedules:

| Symbol | Timeframe | Days Back | Frequency |
|--------|-----------|-----------|-----------|
| EURUSD | 5m        | 3         | Daily     |
| EURUSD | 15m       | 3         | Daily     |
| EURUSD | 1h        | 7         | Daily     |
| GBPUSD | 5m        | 3         | Daily     |
| GBPUSD | 15m       | 3         | Daily     |
| GBPUSD | 1h        | 7         | Daily     |
| XAUUSD | 5m        | 3         | Daily     |
| XAUUSD | 15m       | 3         | Daily     |
| XAUUSD | 1h        | 7         | Daily     |

## Monitoring

### Check Refresh History

View recent refreshes in the Admin Interface:
- Filter by symbol, timeframe, or status
- See candles fetched/saved
- View error messages for failed refreshes
- Check duration of each operation

### Check Function Logs

In Netlify Dashboard:
1. Go to Functions
2. Click on `scheduled-refresh` or `refresh-candles`
3. View execution logs

### Database Queries

Query refresh history directly:

```sql
-- Recent refresh operations
SELECT * FROM refresh_history
ORDER BY started_at DESC
LIMIT 20;

-- Failed refreshes
SELECT * FROM refresh_history
WHERE status = 'failed'
ORDER BY started_at DESC;

-- Schedule status
SELECT * FROM refresh_schedules
WHERE enabled = true
ORDER BY next_run_at;
```

## Troubleshooting

### Scheduled Function Not Running

1. Verify the function is deployed in Netlify Dashboard
2. Check the schedule syntax in netlify.toml
3. View function logs for errors
4. Ensure SUPABASE_SERVICE_ROLE_KEY is set

### Manual Refresh Failing

1. Verify ADMIN_REFRESH_KEY matches in .env and your request
2. Check that MetaApi credentials are valid
3. Ensure Supabase connection is working
4. Check function timeout (currently 10 minutes)

### No Data Being Saved

1. Verify historical_candles table exists
2. Check RLS policies allow service role to insert
3. View function logs for database errors
4. Ensure MetaApi is returning data

### Rate Limiting Issues

The system includes built-in rate limiting protection:
- 500ms delay between chunks
- 1 second delay between schedules in batch mode
- Optimal chunk sizing to stay under MetaApi limits

If you still hit rate limits:
- Reduce `days_back` for high-frequency timeframes
- Disable some schedules temporarily
- Spread refreshes across different times

## Security Considerations

1. **Admin Key**: Keep ADMIN_REFRESH_KEY secret and use a strong random value
2. **Service Role Key**: Never expose SUPABASE_SERVICE_ROLE_KEY in client-side code
3. **RLS Policies**: Only admins can manage schedules; service role can write history
4. **Function Authentication**: All manual endpoints require valid admin key

## Performance Tips

1. **Timeframe Selection**: Use appropriate days_back for each timeframe:
   - 5m: 3-7 days (generates lots of candles)
   - 15m: 7-14 days
   - 1h: 30-90 days

2. **Batch Operations**: Schedule batch refreshes during off-peak hours (default: 2 AM UTC)

3. **Function Timeout**: Current limit is 10 minutes per function execution. For very large datasets, split into smaller schedules.

4. **Database Indexes**: The system includes optimized indexes for:
   - Symbol/timeframe lookups
   - Time-based queries
   - Status filtering

## API Reference

### POST /.netlify/functions/refresh-candles (Single Mode)

**Query Parameters:**
- `symbol` (required): Trading symbol
- `timeframe` (required): 5m, 15m, or 1h
- `daysBack` (optional): Number of days (default: 3)
- `overwrite` (optional): true/false (default: true)
- `adminKey` (required): Admin authentication key

**Response:**
```json
{
  "status": "completed",
  "mode": "single",
  "symbol": "EURUSD",
  "timeframe": "5m",
  "candlesFetched": 864,
  "candlesSaved": 864,
  "duration": 5234,
  "message": "Successfully refreshed 864 candles"
}
```

### POST /.netlify/functions/refresh-candles (Batch Mode)

**Query Parameters:**
- `mode` (required): "batch"
- `adminKey` (required): Admin authentication key

**Response:**
```json
{
  "status": "completed",
  "mode": "batch",
  "totalSchedules": 9,
  "successful": 9,
  "failed": 0,
  "duration": 45678,
  "results": [
    {
      "symbol": "EURUSD",
      "timeframe": "5m",
      "success": true,
      "candlesSaved": 864,
      "error": null
    }
  ]
}
```

## Support

For issues or questions:
1. Check function logs in Netlify Dashboard
2. Review refresh history in Admin Interface
3. Verify environment variables are set correctly
4. Ensure database migrations are applied
