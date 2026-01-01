# Netlify Function Environment Variables Fix

## Problem Fixed

The Netlify scheduled functions were failing with "Missing Supabase credentials" errors because they were looking for environment variables with the `VITE_` prefix, which are only available during frontend builds, not in serverless function runtimes.

## Files Updated

Updated the following critical scheduled functions to support both prefixed and non-prefixed environment variables:

1. `netlify/functions/emergency-position-recovery.ts` (runs every minute)
2. `netlify/functions/hybrid-price-collector.ts` (runs every minute)
3. `netlify/functions/continuous-candle-aggregator.ts` (runs every 2 minutes)
4. `netlify/functions/automatic-gap-filler.ts` (runs every 3 minutes)

**Note:** `autonomous-goal-monitor.ts` already had the correct fallback pattern.

## Changes Made

Changed from:
```typescript
const supabaseUrl = process.env.VITE_SUPABASE_URL!;
```

To:
```typescript
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
```

This allows the functions to check for both:
- Non-prefixed versions (set in Netlify dashboard)
- VITE_ prefixed versions (fallback for compatibility)

## Required Action: Set Environment Variables in Netlify

To ensure these functions work properly, you need to add the following environment variables in your Netlify dashboard:

### Go to: Site Settings → Environment Variables

Add these **non-prefixed** variables:

1. **SUPABASE_URL**
   - Value: `https://nzisgxdlydihlwsvonfy.supabase.co`

2. **SUPABASE_ANON_KEY**
   - Value: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56aXNneGRseWRpaGx3c3ZvbmZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1OTU1NDAsImV4cCI6MjA3NTE3MTU0MH0.ZK6iWNbmb0BR5ZhzWQrTaZR_09Z0ls5Og9dFpmcuh7M`

### Verification Variables Already Set

Make sure these existing variables are also present:
- SUPABASE_SERVICE_ROLE_KEY
- METAAPI_TOKEN
- METAAPI_ACCOUNT_ID
- METAAPI_REGION

## Why This Matters

These scheduled functions are critical infrastructure:
- **emergency-position-recovery**: Safety net for stuck positions at TP/SL
- **hybrid-price-collector**: Collects live prices from MetaAPI and Kraken
- **continuous-candle-aggregator**: Aggregates ticks into candles
- **automatic-gap-filler**: Detects and fills missing data

Without proper environment variables, these functions fail silently and your data collection stops.

## How to Verify Fix Works

1. Wait for the Netlify deployment to complete (2-3 minutes)
2. Go to Functions → emergency-position-recovery → Function Log
3. Look for successful executions instead of "Missing Supabase credentials" errors
4. Check other functions to ensure they're running without errors

## Important Note

This fix makes the functions more resilient by checking both naming conventions. However, **setting the non-prefixed variables in Netlify is the correct production configuration** and will ensure optimal performance.

## WebSocket vs This Issue

These errors are **completely separate** from the WebSocket inactive issue:
- **WebSocket**: Frontend real-time price feeds (browser-based)
- **This issue**: Backend serverless functions (Netlify-based)

Both systems can run independently.
