# Deployment Guide

## Overview

Pipnosis is deployed on Netlify (frontend + functions) with Supabase (database + realtime). This guide covers production deployment and configuration.

## Prerequisites

- Netlify account with access to the project
- Supabase project (production instance)
- MetaAPI account for live trading data
- OpenAI API key for LLM reasoning
- VAPID keys for push notifications

## Environment Variables

### Required Variables

#### Supabase Configuration
```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here # Server-side only
```

#### MetaAPI Configuration
```bash
VITE_METAAPI_TOKEN=your_metaapi_token
VITE_METAAPI_ACCOUNT_ID=your_account_id
VITE_METAAPI_REGION=new-york # or your region
```

#### OpenAI Configuration
```bash
VITE_OPENAI_API_KEY=your_openai_api_key
```

#### Push Notifications
```bash
VITE_VAPID_PUBLIC_KEY=your_vapid_public_key
VAPID_PRIVATE_KEY=your_vapid_private_key # Server-side only
```

### Setting Environment Variables

**In Netlify:**
1. Go to Site Settings → Environment Variables
2. Add each variable listed above
3. Set scopes appropriately:
   - `VITE_*` variables: Available to builds
   - Non-`VITE_` variables: Functions only (server-side)

**In Supabase:**
No additional configuration needed - the database URL and keys are sufficient.

## Build Configuration

### netlify.toml

The project includes a `netlify.toml` configuration file that defines:

- **Build command**: `npm run build`
- **Publish directory**: `dist`
- **Functions directory**: `netlify/functions`
- **Headers**: Security headers for static assets
- **Redirects**: SPA routing configuration

### Build Settings

```toml
[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"

[build.environment]
  NODE_VERSION = "18"
```

### Headers
```toml
[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
```

## Database Setup

### Initial Migration

1. Log in to Supabase dashboard
2. Navigate to SQL Editor
3. Run migrations in order from `supabase/migrations/`

The migrations are ordered by timestamp and create:
- Core tables (users, sessions, trades, positions)
- Intelligence tables (caches, learning history)
- Monitoring tables (notifications, modals)
- Functions and triggers
- RLS policies

### Migration Order

Migrations must run sequentially. The consolidated schema migration (`20251016_100000_consolidated_schema.sql`) contains the base schema, followed by incremental updates.

**Critical Migrations:**
1. `20251016_100000_consolidated_schema.sql` - Base schema
2. `20251215022136_create_professional_risk_management_system.sql` - Risk system
3. `20251215033622_create_alpha_full_authority_system.sql` - Alpha brain
4. Entry system migrations (`20260109*`)
5. Recent optimizations and fixes

### Realtime Configuration

Enable realtime for these tables in Supabase Realtime settings:
- `goal_sessions`
- `goal_trades`
- `positions`
- `entry_intents`
- `goal_notifications`
- `realtime_prices`

## Netlify Functions

### Function Configuration

Functions are deployed from `netlify/functions/` directory:

**Key Functions:**
- `analyze-market.ts`: Market analysis endpoint
- `get-live-price.ts`: Fetches current prices
- `save-websocket-price.ts`: Persists WebSocket prices
- `send-push-notification.ts`: Sends browser notifications
- `openai-chat.ts`: Proxies OpenAI API calls

### Function Environment

Functions have access to server-side environment variables (non-`VITE_` prefixed). They use:
- `SUPABASE_SERVICE_ROLE_KEY` for admin operations
- `VAPID_PRIVATE_KEY` for push notifications
- OpenAI key for LLM calls

### Function Timeouts

Netlify free tier: 10 seconds
Netlify Pro: 26 seconds

Long-running operations (backfills, analysis) should be designed to complete within timeout or use async patterns.

## Deployment Process

### Automatic Deployment

**Via Git Push:**
1. Commit and push to `main` branch
2. Netlify automatically detects changes
3. Build process runs (`npm run build`)
4. If successful, new version is deployed
5. Old version remains active during build
6. Atomic swap to new version on success

**Via Build Hook:**
```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/YOUR_HOOK_ID
```

### Manual Deployment

**Via Netlify CLI:**
```bash
# Install Netlify CLI
npm install -g netlify-cli

# Log in
netlify login

# Deploy to production
netlify deploy --prod
```

## Database Migrations in Production

### Running New Migrations

**When adding new features:**
1. Create migration file locally in `supabase/migrations/`
2. Test migration in development
3. Commit migration file
4. Deploy via Git push (migration runs automatically)

**Manual migration:**
1. Log in to production Supabase dashboard
2. Navigate to SQL Editor
3. Copy migration SQL
4. Execute and verify

### Migration Safety

**Before running:**
- Backup database (Supabase handles automatic backups)
- Test on staging environment if available
- Review migration for destructive operations
- Check for data loss risks

**During migration:**
- Monitor execution time
- Watch for errors in logs
- Verify RLS policies don't lock out users

**After migration:**
- Test affected features
- Verify data integrity
- Check application logs for errors

## Monitoring & Logs

### Netlify Logs

**Build Logs:**
- Site Settings → Deploys → View logs
- Shows build output and errors

**Function Logs:**
- Functions tab → Select function → View logs
- Real-time function execution logs

### Supabase Logs

**Database Logs:**
- Logs tab → Select log type
- Query logs, API logs, realtime logs

**Real-time Monitoring:**
- Database tab → Check active connections
- Monitor query performance

### Application Monitoring

**Client-side:**
- Browser console for errors
- Network tab for API failures

**Server-side:**
- Netlify function logs
- Supabase query logs
- LLM token usage tracking in database

## Performance Optimization

### Build Optimization

**Vite Configuration:**
```typescript
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom'],
          'charts': ['lightweight-charts']
        }
      }
    }
  }
})
```

### CDN & Caching

Netlify automatically:
- Serves assets via global CDN
- Caches static assets
- Compresses responses (gzip/brotli)

**Cache headers** (set in `netlify.toml`):
```toml
[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
```

### Database Performance

**Indexes:**
All high-traffic queries have indexes. Verify with:
```sql
SELECT * FROM pg_indexes WHERE tablename = 'your_table';
```

**Connection Pooling:**
Supabase handles automatically via connection pooler.

## Security

### API Keys

**Never commit:**
- `.env` files
- Any file containing real API keys
- Service role keys

**Key Rotation:**
1. Generate new keys in respective platforms
2. Update Netlify environment variables
3. Redeploy application
4. Revoke old keys

### RLS Policies

All tables must have RLS enabled:
```sql
ALTER TABLE tablename ENABLE ROW LEVEL SECURITY;
```

Verify RLS policies:
```sql
SELECT * FROM pg_policies WHERE tablename = 'your_table';
```

### HTTPS

Netlify provides automatic HTTPS via Let's Encrypt. Custom domains also get free SSL certificates.

## Troubleshooting

### Build Failures

**Common issues:**
- Missing environment variables → Check Netlify settings
- TypeScript errors → Run `npm run build` locally
- Dependency issues → Delete `node_modules`, run `npm install`

**Solution:**
1. Check build logs in Netlify
2. Reproduce locally: `npm run build`
3. Fix errors
4. Commit and push

### Function Errors

**Timeout errors:**
- Optimize function code
- Reduce external API calls
- Consider async patterns

**Permission errors:**
- Verify environment variables are set
- Check Supabase RLS policies
- Ensure service role key is correct

### Database Issues

**Connection errors:**
- Verify Supabase URL and keys
- Check Supabase status page
- Review connection limits

**Query timeouts:**
- Add indexes to frequently queried columns
- Optimize query logic
- Consider caching results

## Rollback Procedure

### Application Rollback

**Via Netlify:**
1. Go to Deploys tab
2. Find previous successful deploy
3. Click "Publish deploy"
4. Previous version goes live immediately

### Database Rollback

**If migration fails:**
1. Have rollback SQL ready (migration reversal)
2. Log in to Supabase SQL Editor
3. Execute rollback SQL
4. Verify data integrity

**Prevention:**
- Always test migrations in development
- Create migrations that can be safely reversed
- Backup database before major changes

## Scaling Considerations

### Frontend Scaling

Netlify automatically scales CDN delivery. No manual configuration needed.

### Function Scaling

Netlify functions auto-scale. For high traffic:
- Optimize function code
- Implement caching
- Consider rate limiting

### Database Scaling

Supabase offers:
- Auto-scaling compute (Pro plan)
- Connection pooling
- Read replicas (Enterprise)

Monitor database metrics and upgrade plan as needed.

## Support & Resources

### Documentation
- Netlify Docs: https://docs.netlify.com
- Supabase Docs: https://supabase.com/docs
- MetaAPI Docs: https://metaapi.cloud/docs

### Status Pages
- Netlify Status: https://www.netlifystatus.com
- Supabase Status: https://status.supabase.com

### Internal Documentation
- `ARCHITECTURE.md` - System design
- `CHANGELOG.md` - Version history
- `README.md` - Quick start guide
- `docs/archive/` - Historical documentation

## Deployment Checklist

Before each deployment:

- [ ] All tests pass locally
- [ ] Build succeeds locally (`npm run build`)
- [ ] Environment variables are set correctly
- [ ] Database migrations are tested
- [ ] Backup database if running migrations
- [ ] Review changes for breaking updates
- [ ] Notify users if downtime expected
- [ ] Monitor deployment in real-time
- [ ] Test critical paths after deployment
- [ ] Check error logs for issues
- [ ] Verify database queries are working
- [ ] Test push notifications
- [ ] Verify WebSocket connections

## Emergency Procedures

### Critical Bug in Production

1. **Immediate**: Rollback to previous deploy (Netlify Deploys tab)
2. **Fix**: Address bug in development
3. **Test**: Verify fix thoroughly
4. **Deploy**: Push fix to production
5. **Monitor**: Watch logs for issues

### Database Emergency

1. **Assess**: Identify scope of issue
2. **Backup**: Ensure recent backup exists
3. **Fix**: Execute repair SQL carefully
4. **Verify**: Check data integrity
5. **Monitor**: Watch for cascading issues

### Service Outage

1. **Check Status**: Netlify, Supabase, MetaAPI status pages
2. **Communicate**: Notify users if prolonged
3. **Fallback**: Use cached data if available
4. **Recovery**: Verify systems when services return

## Conclusion

This deployment guide covers standard deployment procedures, monitoring, troubleshooting, and emergency procedures. Always test changes thoroughly before deploying to production, and keep backups of critical data.

For questions or issues not covered here, refer to platform documentation or archived implementation docs in `docs/archive/`.
