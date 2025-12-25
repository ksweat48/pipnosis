# Bootstrap New Symbols - Setup Guide

This guide explains how to populate historical candle data for the newly added crypto and index symbols.

## New Symbols Added

### Crypto Symbols (24/7 Trading)
- **BTCUSD** - Bitcoin
- **ETHUSD** - Ethereum
- **SOLUSD** - Solana
- **BNBUSD** - Binance Coin

### Index Symbols
- **NAS100** - Nasdaq 100
- **SPX500** - S&P 500

## Why Bootstrap is Needed

The symbols have been added to the system, but the database has no historical candle data yet. Without historical data:
- Charts cannot render (need at least some candles to display)
- Technical indicators won't work
- AI analysis cannot function

## Data Sources

- **Crypto**: Binance public API (free, no authentication required)
- **Indices**: MetaAPI (using your existing credentials)

## How to Bootstrap

### Option 1: Automated Script (Recommended)

Run the automated bootstrap script:

```bash
chmod +x scripts/bootstrap-all-symbols.sh
./scripts/bootstrap-all-symbols.sh
```

This script will:
1. Check if Netlify functions are deployed
2. Bootstrap all crypto symbols (BTCUSD, ETHUSD, SOLUSD, BNBUSD)
3. Bootstrap all index symbols (NAS100, SPX500)
4. Fetch 7 days of historical data for all timeframes
5. Display progress and results

### Option 2: Manual Execution

If you prefer manual control, call the functions directly:

```bash
# Bootstrap crypto symbols
curl -X GET "https://pipnosis.netlify.app/.netlify/functions/bootstrap-crypto-symbols"

# Bootstrap index symbols
curl -X GET "https://pipnosis.netlify.app/.netlify/functions/bootstrap-index-symbols"
```

### Option 3: Individual Symbol Bootstrap

For granular control, fetch data for individual symbols:

```bash
# Fetch BTCUSD M5 candles for last 7 days
curl -X GET "https://pipnosis.netlify.app/.netlify/functions/binance-historical-candles?symbol=BTCUSD&timeframe=M5&days=7"

# Fetch ETHUSD H1 candles for last 14 days
curl -X GET "https://pipnosis.netlify.app/.netlify/functions/binance-historical-candles?symbol=ETHUSD&timeframe=H1&days=14"
```

## What Gets Populated

For each symbol, the following timeframes are populated:
- **M1** - 1 minute
- **M5** - 5 minutes
- **M15** - 15 minutes
- **M30** - 30 minutes
- **H1** - 1 hour
- **H4** - 4 hours
- **D1** - 1 day

## Data Volume

- **Per symbol per timeframe**: ~2,000 candles (7 days)
- **Per symbol all timeframes**: ~14,000 candles
- **Total for 4 crypto symbols**: ~56,000 candles
- **Total for 2 index symbols**: ~28,000 candles
- **Grand total**: ~84,000 candles

## Timeframes

The bootstrap process takes approximately:
- **Crypto symbols**: 2-3 minutes (Binance is fast)
- **Index symbols**: 3-5 minutes (MetaAPI has rate limits)
- **Total**: 5-8 minutes

## Verification

After bootstrap completes:

1. Open Pipnosis app
2. Select any new symbol from dropdown (e.g., BTCUSD)
3. Chart should display historical candles
4. Try different timeframes (M5, M15, H1, etc.)
5. Verify real-time updates are working

## Troubleshooting

### Functions return 404
The Netlify deployment hasn't completed yet. Wait 2-3 minutes after deploying and try again.

### Crypto bootstrap fails
Binance API is public and doesn't require authentication. If it fails, check:
- Network connectivity
- Binance API status: https://www.binance.com/en/support/announcement

### Index bootstrap fails
Check MetaAPI credentials in `.env`:
```
METAAPI_TOKEN=your_token
METAAPI_ACCOUNT_ID=your_account_id
METAAPI_REGION=new-york
```

### Charts still empty
1. Check browser console for errors
2. Verify candles exist in database:
   ```sql
   SELECT COUNT(*) FROM market_data_m5 WHERE symbol = 'BTCUSD';
   ```
3. Clear browser cache and reload
4. Check if continuous-candle-aggregator is running

## Continuous Updates

After initial bootstrap, the system automatically maintains data:
- **Real-time prices**: Collected every minute via `continuous-price-collector`
- **Candle aggregation**: New candles built every 5 minutes via `continuous-candle-aggregator`
- **Gap filling**: Automatic gap detection and filling every 5 minutes

## API Costs

- **Binance**: FREE (public API, no authentication)
- **MetaAPI**: Uses existing account, no additional cost

## Next Steps

1. Deploy the new functions to Netlify
2. Wait for deployment to complete (2-3 minutes)
3. Run the bootstrap script
4. Start trading the new symbols!

## Files Created

- `netlify/functions/binance-historical-candles.ts` - Fetches Binance historical data
- `netlify/functions/bootstrap-crypto-symbols.ts` - Bootstraps all crypto symbols
- `netlify/functions/bootstrap-index-symbols.ts` - Bootstraps all index symbols
- `scripts/bootstrap-all-symbols.sh` - Automated bootstrap script
- `netlify.toml` - Updated with function timeout configs

## Support

If you encounter issues, check:
1. Netlify deployment logs
2. Browser console (F12)
3. Supabase logs for database errors
4. Function execution logs in Netlify dashboard
