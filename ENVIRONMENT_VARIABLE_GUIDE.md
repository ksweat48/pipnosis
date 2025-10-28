# Environment Variable Configuration Guide

## Understanding VITE_ Prefix

### The Critical Difference

**VITE_ Prefixed Variables** (Frontend/Build-time)
- Available **only during build time** and compiled into frontend JavaScript bundle
- Accessible in browser via `import.meta.env.VITE_*`
- **NOT accessible** to Netlify serverless functions at runtime
- Safe to expose in browser (public)

**Non-Prefixed Variables** (Backend/Runtime)
- Available to **Netlify functions at runtime**
- **NOT accessible** to frontend code
- Required for backend serverless functions
- Should be kept private (never exposed to browser)

## Why You Need Both Versions

Your application has two separate parts:
1. **Frontend** (React app running in browser) - needs `VITE_*` variables
2. **Backend** (Netlify functions running on server) - needs non-prefixed variables

These environments are **completely separate** and cannot access each other's variables!

## Complete Variable List

### Supabase Configuration

```bash
# Frontend (Build-time)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here

# Backend (Runtime) - For Netlify Functions
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

### MetaAPI Configuration

```bash
# Frontend Variables (Build-time only)
VITE_METAAPI_ACCOUNT_ID=169ff8dd-bb46-4618-91b4-28f696fba223
VITE_METAAPI_REGION=cloud-g2

# Backend Variables (Runtime - CRITICAL!)
METAAPI_ADMIN_TOKEN=your_admin_token_here
METAAPI_ACCOUNT_ID=169ff8dd-bb46-4618-91b4-28f696fba223  # Same value as VITE_ version
METAAPI_REGION=cloud-g2  # Same value as VITE_ version
```

### Admin Configuration

```bash
ADMIN_REFRESH_KEY=your_secure_admin_key_here
```

## Common Issues and Solutions

### Issue 1: "VITE_METAAPI_ACCOUNT_ID not found in environment variables"

**Symptom:** Netlify function returns 500 error saying account ID is missing

**Cause:** Function is looking for `VITE_METAAPI_ACCOUNT_ID` but Netlify functions can't access `VITE_` variables at runtime

**Solution:** Add `METAAPI_ACCOUNT_ID` (without VITE_ prefix) to Netlify environment variables

### Issue 2: "Using Fallback Pattern"

**Symptom:** Test shows connection works but warns about using fallback

**Cause:** Code is falling back from `METAAPI_ACCOUNT_ID` to `VITE_METAAPI_ACCOUNT_ID`

**Solution:** Add proper backend variables to avoid relying on fallback

### Issue 3: MetaAPI Token Missing

**Symptom:** "No MetaAPI token found" error

**Cause:** `METAAPI_ADMIN_TOKEN` not set in Netlify environment variables

**Solution:** Add `METAAPI_ADMIN_TOKEN` to Netlify dashboard (never commit to git!)

## How to Set Environment Variables

### Local Development (.env file)

1. Copy `.env.example` to `.env`
2. Fill in all variables with your actual values
3. **Never commit .env to git** (it's in .gitignore)

### Netlify Production (Dashboard)

1. Go to Netlify Dashboard
2. Navigate to: **Site Settings > Environment Variables**
3. Click **Add a variable**
4. Add each variable from the checklist below

### Netlify Deployment Checklist

Copy these exact values to Netlify:

#### Supabase
- [ ] `VITE_SUPABASE_URL`
- [ ] `VITE_SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY` ⚠️ SENSITIVE

#### MetaAPI Frontend (Build-time)
- [ ] `VITE_METAAPI_ACCOUNT_ID`
- [ ] `VITE_METAAPI_REGION`

#### MetaAPI Backend (Runtime) - CRITICAL
- [ ] `METAAPI_ADMIN_TOKEN` ⚠️ HIGHLY SENSITIVE
- [ ] `METAAPI_ACCOUNT_ID` (same value as VITE_ version)
- [ ] `METAAPI_REGION` (same value as VITE_ version)

#### Admin
- [ ] `ADMIN_REFRESH_KEY` ⚠️ SENSITIVE

## Testing Your Configuration

### 1. Check Environment Variables

Visit: `https://your-site.netlify.app/test-metaapi-direct`

Click **"Check Environment"** button to see:
- Which variables are available to Netlify functions
- Which variables are missing
- Whether you're using fallback patterns
- Specific recommendations for your setup

### 2. Test MetaAPI Connection

On the same page, click **"Test with Environment Variables"** to:
- Verify MetaAPI connection works
- See which variable sources are being used
- Get configuration recommendations

### 3. Expected Results

**Good Configuration:**
```
✅ Fully Configured
Backend MetaAPI vars present: 3
Using Fallback: No
Configuration looks good
```

**Needs Improvement:**
```
❌ Configuration Issues
Backend MetaAPI vars missing: 2
Using Fallback: Yes
⚠️ Add METAAPI_ACCOUNT_ID and METAAPI_REGION to Netlify
```

## Security Best Practices

### Never Commit These to Git
- `METAAPI_ADMIN_TOKEN` - Full access to your trading account
- `SUPABASE_SERVICE_ROLE_KEY` - Bypasses all database security
- `ADMIN_REFRESH_KEY` - Admin operations access
- Any `.env` file with real credentials

### Safe to Expose (Public)
- `VITE_SUPABASE_URL` - Public project URL
- `VITE_SUPABASE_ANON_KEY` - Limited access, RLS protected
- `VITE_METAAPI_ACCOUNT_ID` - Account identifier (public in browser)
- `VITE_METAAPI_REGION` - Server region (public in browser)

### Keep Private (Backend Only)
- `METAAPI_ADMIN_TOKEN` - Backend functions only
- `METAAPI_ACCOUNT_ID` - Backend functions (duplicate of public version)
- `METAAPI_REGION` - Backend functions (duplicate of public version)
- `SUPABASE_SERVICE_ROLE_KEY` - Backend functions only

## Troubleshooting Commands

### Check Local Environment

```bash
# List all environment variables
cat .env

# Check specific variable
echo $VITE_METAAPI_ACCOUNT_ID
```

### Test Netlify Functions Locally

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Run functions locally
netlify dev

# Test specific function
curl http://localhost:8888/.netlify/functions/check-environment
```

### Verify Production Environment

1. Visit `/test-metaapi-direct` on your deployed site
2. Click "Check Environment"
3. Review the diagnostic output
4. Follow any recommendations shown

## Quick Fix Reference

| Error Message | Missing Variable | Where to Add |
|--------------|------------------|--------------|
| "Account ID not found" | `METAAPI_ACCOUNT_ID` | Netlify Dashboard |
| "Token not found" | `METAAPI_ADMIN_TOKEN` | Netlify Dashboard |
| "Using fallback pattern" | `METAAPI_ACCOUNT_ID` & `METAAPI_REGION` | Netlify Dashboard |
| "Database connection failed" | `SUPABASE_SERVICE_ROLE_KEY` | Netlify Dashboard |

## Need Help?

1. Run the environment diagnostic: `/test-metaapi-direct` → "Check Environment"
2. Run the connection test: `/test-metaapi-direct` → "Test with Environment Variables"
3. Review the recommendations provided by both tools
4. Check Netlify function logs for detailed error messages

## Summary

**Key Takeaway:** Set BOTH versions of MetaAPI variables!
- `VITE_METAAPI_*` for frontend (browser)
- `METAAPI_*` for backend (Netlify functions)

Both need the same values, but they serve different environments that can't share variables.
