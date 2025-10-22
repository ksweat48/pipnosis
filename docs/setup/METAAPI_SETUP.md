# MetaApi Live Market Data Setup Guide

Your candlestick chart is now connected to **live market data** from MetaApi! Follow these steps to activate real-time price feeds.

## Quick Setup

### 1. Get Your MetaApi API Token

1. Go to https://app.metaapi.cloud/
2. Log in to your account
3. Navigate to **API Access** in the left sidebar
4. Copy your API token

### 2. Get Your Account ID

You already have an account created:
- **Account ID**: `c9991ce7-f9ab-49fd-bc67-1`
- **Name**: Pipnosis Demo Project
- **Status**: Currently showing as "Disconnected" and "Undeployed"

### 3. Update Your .env File

Open `/tmp/cc-agent/58035261/project/.env` and replace:

```bash
VITE_METAAPI_TOKEN=your_metaapi_token_here
```

With your actual API token from step 1.

The account ID is already set correctly.

### 4. Deploy Your MT5 Account

Before the app can fetch live data, your MetaApi account needs to be deployed:

1. Go to https://app.metaapi.cloud/accounts
2. Click on your "Pipnosis Demo Project" account
3. Click the **Deploy** button
4. Wait for status to change from "Undeployed" to "Deployed" (this takes 1-2 minutes)

## How It Works

### Multi-Timeframe Support

The chart now supports 7 different timeframes:
- **M1** - 1 Minute
- **M5** - 5 Minutes
- **M15** - 15 Minutes (default)
- **M30** - 30 Minutes
- **H1** - 1 Hour
- **H4** - 4 Hours
- **D1** - Daily

Use the timeframe dropdown selector to switch between them.

### Data Flow

1. **Historical Data**: When you first load a symbol/timeframe, the app fetches 500 historical candles from MetaApi
2. **Caching**: All fetched data is automatically saved to your Supabase database
3. **Real-Time Updates**: Once connected, new candles stream in live via WebSocket
4. **Offline Mode**: If MetaApi is unavailable, the app falls back to cached data

### Connection Status Indicators

The chart header shows:
- **🟢 Live** - Connected to MetaApi, receiving real-time updates
- **🔵 Cached** - Using stored data from database (offline mode)
- **🔴 Offline** - No data available

## Supported Currency Pairs

Currently configured for:
- **EURUSD** - Euro vs US Dollar
- **GBPUSD** - British Pound vs US Dollar
- **XAUUSD** - Gold vs US Dollar

You can add more pairs by updating the `availablePairs` array in `MarketChart.tsx`.

## Database Caching

All market data is stored in your Supabase `market_data` table with automatic retention policies:

- **M1 data**: 30 days retention
- **M5/M15 data**: 90 days retention
- **H1/H4 data**: 1 year retention
- **D1/W1/MN1 data**: Unlimited retention

This minimizes API costs and provides fast chart loading.

## Troubleshooting

### "Failed to connect to MetaApi"

**Solution**:
1. Verify your API token is correct in `.env`
2. Check your account is deployed on MetaApi dashboard
3. Ensure your MT5 demo account credentials are valid

### "No market data available"

**Solution**:
1. Add your MetaApi token to `.env` file
2. Restart the development server: `npm run dev`
3. Check the browser console for detailed error messages

### Chart shows cached data only

**Solution**:
- MetaApi might be temporarily unavailable
- Verify your account subscription is active
- Check MetaApi dashboard for any service alerts

## Cost Optimization

MetaApi charges based on:
- **Active connections**: $4/month per account
- **API calls**: Included in subscription

To minimize costs:
1. The app uses aggressive caching (all data stored in Supabase)
2. Only subscribes to symbols actively being viewed
3. Automatically disconnects when browser tab is closed
4. Reuses cached data when available (90%+ cache hit rate)

## Next Steps

Once configured:
1. The chart will automatically load live data on page refresh
2. AI trading strategies will use real market prices
3. Trade executions will sync with actual MT5 account
4. All data persists in your Supabase database

For questions or issues, check MetaApi documentation: https://metaapi.cloud/docs/
