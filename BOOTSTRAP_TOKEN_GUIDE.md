# Bootstrap Token Generator Guide

## Quick Start

The bootstrap token generator pre-caches a MetaAPI token in Supabase, providing immediate demo mode exit capability.

## Prerequisites

1. All environment variables configured in `.env` file:
   - `METAAPI_ADMIN_TOKEN`
   - `VITE_METAAPI_ACCOUNT_ID`
   - `VITE_METAAPI_REGION` (optional, defaults to new-york)
   - `VITE_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

2. Dependencies installed:
   ```bash
   npm install
   ```

3. Supabase `metaapi_token_cache` table exists (should be created by migrations)

## Running the Bootstrap Script

```bash
node scripts/generate-bootstrap-token.js
```

## What It Does

1. Loads environment variables from `.env`
2. Validates all required configuration
3. Attempts to generate token from multiple MetaAPI regions:
   - Primary region (from `VITE_METAAPI_REGION`)
   - new-york (fallback 1)
   - london (fallback 2)
   - singapore (fallback 3)
4. Caches the successfully generated token in Supabase
5. Sets expiry to 1 hour from generation time

## Expected Output

### Success
```
🚀 Bootstrap Token Generator

Configuration:
   Account ID: c9991ce7-f9ab-49fd-bc67-12839e567e8f
   Region: new-york
   Supabase URL: https://your-project.supabase.co

📦 Loading MetaAPI SDK...
✓ MetaAPI SDK loaded

🌍 Will try regions in order: new-york, london, singapore

🔄 Attempting to generate token from new-york region...
✓ Token generated successfully from new-york in 8234ms
  Token length: 128 characters

💾 Caching token in Supabase...
✓ Token cached successfully

✅ Bootstrap Complete!

Token Details:
   Region: new-york
   Expires: 2025-10-24T01:52:00.000Z
   Valid for: 1 hour

🎉 Your application should now exit demo mode immediately!
```

### All Regions Timeout
```
🚀 Bootstrap Token Generator

Configuration:
   Account ID: c9991ce7-f9ab-49fd-bc67-12839e567e8f
   Region: new-york
   Supabase URL: https://your-project.supabase.co

📦 Loading MetaAPI SDK...
✓ MetaAPI SDK loaded

🌍 Will try regions in order: new-york, london, singapore

🔄 Attempting to generate token from new-york region...
✗ Failed from new-york: Operation timed out
  Trying next region...

🔄 Attempting to generate token from london region...
✗ Failed from london: Operation timed out
  Trying next region...

🔄 Attempting to generate token from singapore region...
✗ Failed from singapore: Operation timed out

❌ Bootstrap Failed: Failed to generate token from all regions

Please check:
   1. Your METAAPI_ADMIN_TOKEN is valid
   2. Your VITE_METAAPI_ACCOUNT_ID is correct
   3. Your Supabase credentials are correct
   4. The metaapi_token_cache table exists in Supabase
   5. MetaAPI services are operational
```

## When to Use

### Initial Setup
Run this script once during initial application setup to cache a token before first user access.

### After Long Downtime
If the application hasn't been used for over an hour, the cached token will expire. Run this script to refresh.

### MetaAPI Issues
If MetaAPI is experiencing intermittent issues, run this during off-peak hours to cache a token for peak usage times.

### Before Demo/Presentation
Run this before showing the application to ensure immediate access without waiting for token generation.

## Troubleshooting

### Missing Environment Variables
```
❌ Configuration Error:
   - METAAPI_ADMIN_TOKEN is missing
   - VITE_SUPABASE_URL is missing

Please set all required environment variables in your .env file
```

**Solution**: Create or update your `.env` file with the missing variables.

### Supabase Connection Failed
```
❌ Bootstrap Failed: Failed to cache token: connection refused
```

**Solution**:
- Check `VITE_SUPABASE_URL` is correct
- Check `SUPABASE_SERVICE_ROLE_KEY` is valid
- Verify Supabase project is active

### Table Not Found
```
❌ Bootstrap Failed: relation "metaapi_token_cache" does not exist
```

**Solution**:
- Run database migrations: Apply the migration `20251023010540_add_metaapi_token_cache.sql`
- Verify table exists in Supabase dashboard

### Invalid Admin Token
```
❌ Bootstrap Failed: Authentication failed with MetaAPI
```

**Solution**:
- Verify `METAAPI_ADMIN_TOKEN` in MetaAPI dashboard
- Check token hasn't expired
- Ensure token has proper permissions

### All Regions Timing Out
**Solution**:
1. Wait 5-10 minutes and try again
2. Check MetaAPI status page
3. Try during off-peak hours (late night/early morning)
4. Contact MetaAPI support if persistent

## Benefits

1. **Immediate Access**: Application exits demo mode instantly on first load
2. **Reduced Load**: First user doesn't wait 8-22 seconds for token generation
3. **Reliability**: Token cached before users access the application
4. **Testing**: Useful for development/testing without repeated token generation delays
5. **Presentations**: Ensures smooth demos without loading delays

## Technical Details

### Token Validity
- Tokens are valid for 1 hour from generation
- After 55 minutes, the application will automatically generate a fresh token
- The 5-minute buffer ensures seamless token rotation

### Cache Strategy
- Tokens stored in `metaapi_token_cache` table
- Primary key: `(account_id, region)`
- Upsert operation updates existing cache entries
- Multiple regions can be cached simultaneously

### Security
- Admin token never sent to frontend
- Bootstrap script runs server-side only
- Service role key required for cache access
- Tokens automatically expire after 1 hour
