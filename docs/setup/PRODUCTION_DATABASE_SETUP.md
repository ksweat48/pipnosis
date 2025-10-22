# Production Database Setup Guide

## CRITICAL: Your Production Database Needs Migration

Your production site is showing "Data Critical" status because the `market_data` table doesn't exist in your production Supabase database. This is causing all the 404 errors you're seeing in the console.

## Quick Fix (5 minutes)

### Step 1: Access Supabase Dashboard

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project: `xhunxrzwwaejancoquwd`
3. Click on "SQL Editor" in the left sidebar

### Step 2: Run the Migrations

You need to run 3 migrations in order. Copy and paste each SQL script into the SQL Editor and click "Run".

#### Migration 1: Create market_data table

```sql
/*
  # Create Market Data Table for Live Price Caching

  1. New Tables
    - `market_data` - Stores OHLC candlestick data
    - `market_data_subscriptions` - Tracks active subscriptions
  2. Security
    - Enable RLS on market_data table
    - Public read access (market data is public information)
    - Authenticated users can insert/update
*/

-- Create market_data table
CREATE TABLE IF NOT EXISTS market_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  timestamp timestamptz NOT NULL,
  open numeric(20, 8) NOT NULL,
  high numeric(20, 8) NOT NULL,
  low numeric(20, 8) NOT NULL,
  close numeric(20, 8) NOT NULL,
  volume numeric(20, 8) DEFAULT 0,
  tick_volume integer DEFAULT 0,
  spread integer DEFAULT 0,
  broker_time timestamptz,
  data_source text DEFAULT 'metaapi',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(symbol, timeframe, timestamp)
);

-- Create market_data_subscriptions table
CREATE TABLE IF NOT EXISTS market_data_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  last_update timestamptz DEFAULT now(),
  status text DEFAULT 'active',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(symbol, timeframe)
);

-- Create indexes for market_data
CREATE INDEX IF NOT EXISTS idx_market_data_symbol_timeframe_timestamp
  ON market_data(symbol, timeframe, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_market_data_symbol
  ON market_data(symbol);

CREATE INDEX IF NOT EXISTS idx_market_data_timeframe
  ON market_data(timeframe);

CREATE INDEX IF NOT EXISTS idx_market_data_timestamp
  ON market_data(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_market_data_created_at
  ON market_data(created_at DESC);

-- Create index for subscriptions
CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON market_data_subscriptions(status);

-- Enable RLS
ALTER TABLE market_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_data_subscriptions ENABLE ROW LEVEL SECURITY;

-- Market data is public - anyone can read
CREATE POLICY "Anyone can read market data"
  ON market_data FOR SELECT
  TO anon, authenticated
  USING (true);

-- Only service role can insert/update market data
CREATE POLICY "Service role can insert market data"
  ON market_data FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Service role can update market data"
  ON market_data FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Subscription policies
CREATE POLICY "Authenticated users can read subscriptions"
  ON market_data_subscriptions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage subscriptions"
  ON market_data_subscriptions FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_market_data_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for market_data
DROP TRIGGER IF EXISTS market_data_updated_at ON market_data;
CREATE TRIGGER market_data_updated_at
  BEFORE UPDATE ON market_data
  FOR EACH ROW
  EXECUTE FUNCTION update_market_data_updated_at();

-- Trigger for subscriptions
DROP TRIGGER IF EXISTS subscriptions_updated_at ON market_data_subscriptions;
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON market_data_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_market_data_updated_at();
```

#### Migration 2: Add candle completion tracking

```sql
/*
  # Add Candle Completion Tracking

  Adds fields to track whether candles are complete and when they were completed.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_data' AND column_name = 'is_complete'
  ) THEN
    ALTER TABLE market_data ADD COLUMN is_complete boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'market_data' AND column_name = 'completed_at'
  ) THEN
    ALTER TABLE market_data ADD COLUMN completed_at timestamptz;
  END IF;
END $$;

-- Update existing records to mark them as complete
UPDATE market_data
SET is_complete = true, completed_at = created_at
WHERE is_complete IS NULL OR is_complete = false;
```

#### Migration 3: Fix RLS policies for client-side writes

```sql
/*
  # Fix Market Data RLS Policies for Ticker Persistence

  Updates RLS policies to allow anonymous and authenticated users to insert/update
  market data. This is necessary for client-side ticker functionality.
*/

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Service role can insert market data" ON market_data;
DROP POLICY IF EXISTS "Service role can update market data" ON market_data;

-- Create permissive INSERT policy
CREATE POLICY "Anyone can insert market data"
  ON market_data FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Create permissive UPDATE policy
CREATE POLICY "Anyone can update market data"
  ON market_data FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Ensure SELECT policy exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'market_data'
    AND policyname = 'Anyone can read market data'
  ) THEN
    CREATE POLICY "Anyone can read market data"
      ON market_data FOR SELECT
      TO anon, authenticated
      USING (true);
  END IF;
END $$;

-- Prevent DELETE operations
DROP POLICY IF EXISTS "No one can delete market data" ON market_data;
CREATE POLICY "No one can delete market data"
  ON market_data FOR DELETE
  TO anon, authenticated
  USING (false);

-- Update subscription policies
DROP POLICY IF EXISTS "Service role can manage subscriptions" ON market_data_subscriptions;
CREATE POLICY "Anyone can manage subscriptions"
  ON market_data_subscriptions FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
```

### Step 3: Verify the Setup

After running all three migrations, verify that the table was created:

1. In Supabase Dashboard, go to "Table Editor"
2. You should see a `market_data` table
3. Click on it to verify it has these columns:
   - id, symbol, timeframe, timestamp
   - open, high, low, close
   - volume, tick_volume, spread
   - broker_time, data_source
   - is_complete, completed_at
   - created_at, updated_at

### Step 4: Test the Connection

Run this query in SQL Editor to test:

```sql
SELECT COUNT(*) FROM market_data;
```

If this returns a number (even 0), your table is set up correctly!

## Step 5: Verify Environment Variables in Netlify

1. Go to your Netlify dashboard
2. Select your site
3. Go to "Site settings" → "Environment variables"
4. Verify these are set:
   - `VITE_SUPABASE_URL`: https://xhunxrzwwaejancoquwd.supabase.co
   - `VITE_SUPABASE_ANON_KEY`: (your anon key from .env.production)
   - `VITE_METAAPI_TOKEN`: (your MetaAPI token)
   - `VITE_METAAPI_ACCOUNT_ID`: (your MetaAPI account ID)

5. If you made any changes, trigger a redeploy:
   ```bash
   curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
   ```

## What This Fixes

After completing these steps:
- ✅ All 404 errors in console will disappear
- ✅ Data Health Indicator will show "Healthy" status
- ✅ Tick updates will persist to database correctly
- ✅ Charts will load historical data from database
- ✅ Market data caching will work properly

## Troubleshooting

### Still seeing 404 errors?

1. Check that all 3 migrations ran successfully
2. Verify the table exists: `SELECT * FROM market_data LIMIT 1;`
3. Check RLS policies: Go to "Authentication" → "Policies" in Supabase Dashboard
4. Ensure your environment variables are correct in Netlify
5. Clear your browser cache and hard refresh (Ctrl+Shift+R)

### "Permission denied" errors?

This means RLS policies weren't applied correctly. Re-run Migration 3 from above.

### "Network error" messages?

Check that your Supabase project is online and not paused. Go to your Supabase Dashboard to verify.

## Need Help?

If you're still experiencing issues after following this guide, check:
1. Supabase project status (not paused)
2. Network connectivity to Supabase
3. Browser console for specific error messages
4. Netlify deployment logs for build errors
