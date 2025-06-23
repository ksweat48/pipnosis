# Supabase Setup Guide for Pipnosis

## 📋 Quick Setup Checklist

### 1. Create Supabase Project
- [ ] Go to [supabase.com](https://supabase.com)
- [ ] Create account and new project
- [ ] Choose region and set database password
- [ ] Wait for project to initialize (~2 minutes)

### 2. Get Credentials
Navigate to **Settings → API** in your Supabase dashboard:

- [ ] Copy **Project URL**
- [ ] Copy **anon (public) key**
- [ ] Copy **service_role (secret) key**

### 3. Configure Environment
- [ ] Update `.env` file with your credentials
- [ ] Replace placeholder values with real Supabase credentials

### 4. Run Database Migration
```bash
# Install Supabase CLI (if not already installed)
npm install -g supabase

# Login to Supabase
supabase login

# Link your project
supabase link --project-ref your-project-id

# Run the migration
supabase db push
```

### 5. Test Connection
```bash
# Start the backend server
npm run server

# Check health endpoint
curl http://localhost:3001/api/health
```

## 🔐 Security Notes

### Environment Variables Explained:

**Frontend (.env):**
- `VITE_SUPABASE_URL` - Your project URL (public)
- `VITE_SUPABASE_ANON_KEY` - Public key for client-side operations (public)

**Backend (.env):**
- `SUPABASE_URL` - Same project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Secret key for server-side operations (NEVER expose publicly)

### Row Level Security (RLS)
Our migration automatically sets up RLS policies so:
- ✅ Users can only access their own data
- ✅ Authentication is required for all operations
- ✅ Waitlist table is public (no auth required)

## 🗄️ Database Schema

The migration creates these tables:
- `user_profiles` - User account info and preferences
- `trading_prompts` - AI analysis history
- `trade_records` - Individual trade execution logs
- `journal_entries` - AI-generated insights and decisions
- `trading_sessions` - Session metadata and performance
- `waitlist` - Public signup table (no auth required)

## 🧪 Testing Your Setup

### 1. Test Database Connection
```javascript
// In browser console or Node.js
import { supabase } from './src/lib/supabase.ts'

// Test connection
const { data, error } = await supabase.from('waitlist').select('count')
console.log('Connection test:', { data, error })
```

### 2. Test Authentication
```javascript
// Sign up test user
const { data, error } = await supabase.auth.signUp({
  email: 'test@example.com',
  password: 'testpassword123'
})
```

### 3. Test Backend Integration
```bash
# Test waitlist signup
curl -X POST http://localhost:3001/api/waitlist \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","plan":"beta"}'
```

## 🚨 Common Issues

### Issue: "Invalid API key"
**Solution:** Double-check your keys in Supabase dashboard → Settings → API

### Issue: "Connection refused"
**Solution:** Ensure your project is fully initialized (green status in dashboard)

### Issue: "RLS policy violation"
**Solution:** Make sure you're authenticated when accessing user data

### Issue: "Migration failed"
**Solution:** Check if tables already exist, or reset database in Supabase dashboard

## 🔄 Next Steps After Setup

1. **Test the hybrid backend** - Run `npm run server`
2. **Configure OpenAI API** - Add your OpenAI key to `.env`
3. **Set up MT5 Python bridge** - Configure MT5 connector
4. **Test frontend integration** - Run `npm run dev`

## 📞 Support

If you encounter issues:
1. Check Supabase project logs in dashboard
2. Verify all environment variables are set correctly
3. Ensure your project region matches your location
4. Check the Supabase status page for any outages