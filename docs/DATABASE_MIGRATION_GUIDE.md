# Database Migration Guide - Step by Step

## 🎯 **Method 1: Supabase Dashboard (Easiest)**

### Step 1: Open SQL Editor
1. Go to your Supabase project dashboard
2. Click **"SQL Editor"** in the left sidebar
3. Click **"New Query"**

### Step 2: Copy and Execute Migration
1. Open the file `supabase/migrations/20250623031306_rustic_band.sql` in your project
2. **Copy the entire contents** of that file
3. **Paste it into the SQL Editor**
4. Click **"Run"** button (or press Ctrl+Enter)

### Step 3: Verify Tables Created
1. Go to **"Table Editor"** in the left sidebar
2. You should see these tables:
   - ✅ `user_profiles`
   - ✅ `trading_prompts` 
   - ✅ `trade_records`
   - ✅ `journal_entries`
   - ✅ `trading_sessions`
   - ✅ `waitlist`

---

## 🛠️ **Method 2: Supabase CLI (Advanced)**

### Step 1: Install Supabase CLI
```bash
# Install globally
npm install -g supabase

# Verify installation
supabase --version
```

### Step 2: Login and Link Project
```bash
# Login to Supabase
supabase login

# Link your project (replace with your project ID)
supabase link --project-ref YOUR_PROJECT_ID
```

### Step 3: Push Migration
```bash
# Push the migration to your database
supabase db push

# Alternative: Reset and apply all migrations
supabase db reset
```

---

## 🧪 **Method 3: Manual Verification**

### Test Database Connection
```bash
# Start your backend server
cd server
npm install
npm run dev
```

### Check Health Endpoint
```bash
# Test the connection
curl http://localhost:3001/api/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "2.0.0",
  "services": {
    "supabase": "connected",
    "mt5": "disconnected",
    "ai": "mock"
  }
}
```

---

## 🔍 **Troubleshooting Common Issues**

### Issue: "relation does not exist"
**Solution:** The migration didn't run properly. Try Method 1 again.

### Issue: "permission denied"
**Solution:** Check your service role key in `.env` file.

### Issue: "syntax error"
**Solution:** Make sure you copied the entire migration file content.

### Issue: "already exists"
**Solution:** Tables already created! You're good to go.

---

## ✅ **Verification Checklist**

After running the migration, verify:

- [ ] All 6 tables exist in Supabase Table Editor
- [ ] RLS (Row Level Security) is enabled on user tables
- [ ] Indexes are created for performance
- [ ] Backend health check shows "supabase": "connected"
- [ ] No errors in Supabase project logs

---

## 🎯 **What the Migration Creates**

### **Tables:**
1. **`user_profiles`** - User accounts, balance, preferences
2. **`trading_prompts`** - AI analysis history
3. **`trade_records`** - Individual trade logs
4. **`journal_entries`** - AI-generated insights
5. **`trading_sessions`** - Performance tracking
6. **`waitlist`** - Public signups (no auth required)

### **Security:**
- ✅ Row Level Security (RLS) enabled
- ✅ Users can only access their own data
- ✅ Authentication required for trading operations
- ✅ Service role access for backend operations

### **Performance:**
- ✅ Indexes on user_id columns
- ✅ Indexes on timestamp columns
- ✅ Automatic updated_at triggers

---

## 🚀 **Next Steps After Migration**

1. **Test Supabase connection** ✅
2. **Configure OpenAI API key** (next step)
3. **Set up MT5 Python bridge** (next step)
4. **Test full system integration** (final step)