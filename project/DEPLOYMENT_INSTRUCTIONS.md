# 🚀 Manual Deployment Instructions

## Current Status
✅ CORS configuration has been fixed in the backend
✅ Backend is ready for production deployment
⏳ Need to push changes to GitHub for Railway auto-deployment

## Step 1: Download Your Updated Code

Since git commands aren't available in this environment, you'll need to manually sync your changes:

### Option A: Download Project Files
1. Download the updated `server/index.js` file from this environment
2. Replace the file in your local GitHub repository
3. Commit and push from your local machine

### Option B: Copy Changes Manually
Copy the updated CORS configuration from `server/index.js` lines 60-95:

```javascript
// Enhanced CORS configuration for production deployment
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'https://pipnosis.com',
  'https://www.pipnosis.com',
  'https://pipnosis.netlify.app',
  'https://main--pipnosis.netlify.app'
];

// Add WebContainer and Railway patterns
const allowedPatterns = [
  /\.webcontainer-api\.io$/,
  /\.local-credentialless\.webcontainer-api\.io$/,
  /\.railway\.app$/,
  /\.netlify\.app$/,
  /\.bolt\.new$/,
  /\.stackblitz\.io$/
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Check if origin matches any pattern
    for (const pattern of allowedPatterns) {
      if (pattern.test(origin)) {
        return callback(null, true);
      }
    }
    
    console.log(`❌ CORS blocked origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200
}));
```

## Step 2: Local Git Commands

Run these commands in your local repository:

```bash
# Navigate to your project directory
cd path/to/your/pipnosis-project

# Check current status
git status

# Add the updated server file
git add server/index.js

# Commit the changes
git commit -m "Fix CORS configuration for production deployment

- Updated CORS origins to include pipnosis.com and netlify.app domains
- Enhanced CORS pattern matching for Railway and production environments
- Fixed backend connectivity issues for live deployment
- Backend now properly serves requests from production frontend"

# Push to GitHub (triggers Railway auto-deployment)
git push origin main
```

## Step 3: Monitor Railway Deployment

1. **Go to Railway Dashboard**: https://railway.app
2. **Find your backend project**: Look for "pipnosis-backend" or similar
3. **Watch deployment logs**: Should start automatically after git push
4. **Wait for completion**: Usually takes 2-3 minutes
5. **Look for success message**: "✅ Deployment successful"

## Step 4: Test Production Connection

After Railway deployment completes:

1. **Visit**: https://pipnosis.com
2. **Check Backend Status**: Should show "Backend Connected" 
3. **Test AI Prompt**: Try submitting "Make me $500 this week"
4. **Verify Market Data**: Should load live data from backend

## Step 5: Verify CORS Fix

Open browser DevTools → Network tab:
- ✅ Should see requests to: `https://pipnosis-production.up.railway.app/api/*`
- ✅ No more CORS errors in console
- ✅ All API calls successful (200 status codes)

## 🚨 Troubleshooting

### If Railway deployment fails:
- Check Railway logs for specific error messages
- Verify `server/package.json` is correct
- Ensure environment variables are set in Railway

### If CORS errors persist:
- Double-check the CORS configuration was applied correctly
- Verify your domain matches exactly: `pipnosis.com` (not `www.pipnosis.com`)
- Check Railway logs for CORS-related messages

### If backend still shows offline:
- Wait 5 minutes for DNS propagation
- Hard refresh browser (Ctrl+F5)
- Check Railway service is running and healthy

## 🎯 Expected Result

After successful deployment:
- ✅ Frontend at https://pipnosis.com connects to backend
- ✅ AI prompts work end-to-end
- ✅ Market data loads from Railway backend
- ✅ No CORS errors in browser console
- ✅ Full system functionality restored

---

**Next**: Once you've pushed to GitHub and Railway has deployed, test the connection at https://pipnosis.com and let me know if everything works!