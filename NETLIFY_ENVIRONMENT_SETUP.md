# Netlify Environment Variables Setup

## Required Environment Variables

Your Netlify deployment needs these environment variables configured to enable live MetaAPI data:

### 1. MetaAPI Configuration (Required for Live Trading)

```bash
# Admin token for generating temporary tokens (REQUIRED - Serverless function)
METAAPI_ADMIN_TOKEN=eyJhbGciOiJSUzUxMiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiI1MDUzN2VhZWFjOGIyYWMxZmY4ZWQ2MTRhMjkzZjZkOCIsImFjY2Vzc1J1bGVzIjpbeyJpZCI6InRyYWRpbmctYWNjb3VudC1tYW5hZ2VtZW50LWFwaSIsIm1ldGhvZHMiOlsidHJhZGluZy1hY2NvdW50LW1hbmFnZW1lbnQtYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVzdC1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcnBjLWFwaSIsIm1ldGhvZHMiOlsibWV0YWFwaS1hcGk6d3M6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6Im1ldGFhcGktcmVhbC10aW1lLXN0cmVhbWluZy1hcGkiLCJtZXRob2RzIjpbIm1ldGFhcGktYXBpOndzOnB1YmxpYzoqOioiXSwicm9sZXMiOlsicmVhZGVyIiwid3JpdGVyIl0sInJlc291cmNlcyI6WyIqOiRVU0VSX0lEJDoqIl19LHsiaWQiOiJtZXRhc3RhdHMtYXBpIiwibWV0aG9kcyI6WyJtZXRhc3RhdHMtYXBpOnJlc3Q6cHVibGljOio6KiJdLCJyb2xlcyI6WyJyZWFkZXIiLCJ3cml0ZXIiXSwicmVzb3VyY2VzIjpbIio6JFVTRVJfSUQkOioiXX0seyJpZCI6InJpc2stbWFuYWdlbWVudC1hcGkiLCJtZXRob2RzIjpbInJpc2stbWFuYWdlbWVudC1hcGk6cmVzdDpwdWJsaWM6KjoqIl0sInJvbGVzIjpbInJlYWRlciIsIndyaXRlciJdLCJyZXNvdXJjZXMiOlsiKjokVVNFUl9JRCQ6KiJdfV0sImlnbm9yZVJhdGVMaW1pdHMiOmZhbHNlLCJ0b2tlbklkIjoiMjAyMTAyMTMiLCJpbXBlcnNvbmF0ZWQiOmZhbHNlLCJyZWFsVXNlcklkIjoiNTA1MzdlYWVhYzhiMmFjMWZmOGVkNjE0YTI5M2Y2ZDgiLCJpYXQiOjE3NjEyNjkwOTZ9.iZa6lkp8tFREvK1zSwIg4eJJ2F_R9-F95_bjWtlP2UXZ916xCYK9tGGqVSWkXdeud-e9enBHXluGZgfy1Bn5tix1zSaphHojabeRykIyipA7QGe6hvUCvNoytyrYTTXJIeY-Ba7TFnMmeG3KzjfKG3di1ODPe5TE9ipjVrySbiwZ6lgVNKUB4WFo4enA1L7L_DhRnzYtKcCuhq7ZUasLpWBVUzDANlnoXcrLNZ4yMQd4lZOM4cEwVY2i7BJ0Yys34UfRDYIgcLhAUdXE1h-iOM7ta0ZrInqpQ9NCK2xIgAgvp9t3J7pCeaMXyIUpEbikL_NBDLjbwVS7aKM4zxv9rGfnnHI65mUX3BPd4EVoPvgY6s4Ue3e5awwNlUOKXaGs3335KtI3a8vzT4We1q45-jWiE036uHxRY8WDK3mFB0yfSjL4z1P_p7l9BPJ3KqRVzzKhP5uHGaRmzA6PNwnnYdyOH_K6fVoM3BBt9zk7WwLohlDUARm44_OzSZsCrI1h2upHp9Jlrw197R8Is1A-cHzD9fHAxdsgYwylY3Q2N-bLiWhdd3fK6EiEEHryP_1HUCp-I283fjZtFommF4XwvXvAi48Eiw2qY4BEY4XDryeH-bc1Fu5XluFe3RJm5ZIp1o6fyVJHfVjuHAk-erCt845KaoXIRBAs4ovWYFo6aaw

# Account ID (REQUIRED - Both serverless and client)
METAAPI_ACCOUNT_ID=8845e940-c372-4a3d-9f7e-66288924c46f
VITE_METAAPI_ACCOUNT_ID=8845e940-c372-4a3d-9f7e-66288924c46f

# Region (Optional - defaults to new-york)
METAAPI_REGION=new-york
VITE_METAAPI_REGION=new-york
```

### 2. Supabase Configuration (Required for Database)

```bash
# Supabase URL (REQUIRED)
SUPABASE_URL=https://nzisgxdlydihlwsvonfy.supabase.co
VITE_SUPABASE_URL=https://nzisgxdlydihlwsvonfy.supabase.co

# Service Role Key (REQUIRED - Serverless function only)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56aXNneGRseWRpaGx3c3ZvbmZ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTU5NTU0MCwiZXhwIjoyMDc1MTcxNTQwfQ.Bas3dKkvMSzBPAK4zUJ24JC-T0-bcLQeJ458KYv-X5U
SUPABASE_SERVICE_ROLE=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56aXNneGRseWRpaGx3c3ZvbmZ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTU5NTU0MCwiZXhwIjoyMDc1MTcxNTQwfQ.Bas3dKkvMSzBPAK4zUJ24JC-T0-bcLQeJ458KYv-X5U

# Anon Key (REQUIRED - Client side)
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56aXNneGRseWRpaGx3c3ZvbmZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1OTU1NDAsImV4cCI6MjA3NTE3MTU0MH0.ZK6iWNbmb0BR5ZhzWQrTaZR_09Z0ls5Og9dFpmcuh7M
```

## How to Add These Variables to Netlify

### Method 1: Using Netlify UI (Recommended)

1. Go to your Netlify dashboard: https://app.netlify.com
2. Select your site (pipnosis.com)
3. Navigate to: **Site settings** → **Environment variables**
4. Click **Add a variable**
5. Copy and paste each variable name and value from above
6. Make sure to set them for **All scopes** (Production, Deploy Previews, Branch deploys)

### Method 2: Using Netlify CLI

```bash
# Install Netlify CLI if not already installed
npm install -g netlify-cli

# Login to Netlify
netlify login

# Link your site (if not already linked)
netlify link

# Set environment variables
netlify env:set METAAPI_ADMIN_TOKEN "your-token-here"
netlify env:set METAAPI_ACCOUNT_ID "8845e940-c372-4a3d-9f7e-66288924c46f"
netlify env:set VITE_METAAPI_ACCOUNT_ID "8845e940-c372-4a3d-9f7e-66288924c46f"
netlify env:set METAAPI_REGION "new-york"
netlify env:set VITE_METAAPI_REGION "new-york"
netlify env:set SUPABASE_URL "https://nzisgxdlydihlwsvonfy.supabase.co"
netlify env:set VITE_SUPABASE_URL "https://nzisgxdlydihlwsvonfy.supabase.co"
netlify env:set SUPABASE_SERVICE_ROLE_KEY "your-service-role-key"
netlify env:set SUPABASE_SERVICE_ROLE "your-service-role-key"
netlify env:set VITE_SUPABASE_ANON_KEY "your-anon-key"
```

### Method 3: Using Build Hook with Environment Variables

You can also set environment variables and trigger a new deployment:

```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

## Verify Configuration

After adding the environment variables:

1. Trigger a new deployment (or it will happen automatically)
2. Check the deployment logs for:
   - ✅ Environment validation: PASSED
   - ✅ MetaAPI Account: ✓ Present
   - ✅ Live MetaAPI connection established

3. In the browser console, you should see:
   - `✅ Market data service initialized successfully with LIVE MetaAPI connection`
   - `📡 Real-time streaming active for all subscribed symbols`
   - NO more "demo mode" messages

## Troubleshooting

### If you still see "500 Internal Server Error"

Check Netlify function logs:
1. Go to **Site settings** → **Functions**
2. Click on `get-metaapi-token`
3. Look for error messages in the logs

Common issues:
- ❌ Variable name typo (check exact spelling)
- ❌ Missing METAAPI_ADMIN_TOKEN
- ❌ Missing SUPABASE_SERVICE_ROLE_KEY
- ❌ Variables not saved for "Production" scope

### If you see "demo mode" messages

Check browser console for:
- `VITE_METAAPI_ACCOUNT_ID is not defined`
- Variables with `VITE_` prefix must be set at build time

Solution: Redeploy after adding the `VITE_` prefixed variables

## Security Notes

- ⚠️ **NEVER commit** `METAAPI_ADMIN_TOKEN` to Git
- ⚠️ **NEVER commit** `SUPABASE_SERVICE_ROLE_KEY` to Git
- ✅ These should ONLY exist in Netlify environment variables
- ✅ The `.env` file is for local development only

## Next Steps

After configuring:
1. Add all variables to Netlify
2. Trigger a new deployment
3. Monitor the deployment logs for success
4. Test the live trading interface
5. Verify real-time data is streaming

---

**Current Status:** Environment variables need to be added to Netlify for live MetaAPI data to work in production.
