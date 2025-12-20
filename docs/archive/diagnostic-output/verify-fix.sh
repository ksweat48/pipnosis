#!/bin/bash

echo "🔍 Verifying Chart Fix Deployment"
echo "=================================="
echo ""

# Check if build completed
if [ -f "dist/assets/TradePage-DAM1S1xA.js" ]; then
    echo "✅ NEW build found: TradePage-DAM1S1xA.js"
else
    echo "❌ Build file not found. Run: npm run build"
    exit 1
fi

echo ""
echo "📊 Build Statistics:"
ls -lh dist/assets/TradePage-*.js | tail -1

echo ""
echo "🚀 Next Steps:"
echo "1. Wait for Netlify deployment (2-5 minutes)"
echo "2. Check: https://app.netlify.com/sites/pipnosis/deploys"
echo "3. Hard refresh: Ctrl+Shift+R (or Cmd+Shift+R on Mac)"
echo ""
echo "🔍 To verify fix worked:"
echo "- Open browser DevTools (F12)"
echo "- Go to Console tab"
echo "- Look for: 'loadTime: 150' (should be ~150ms, NOT 150000000ms)"
echo "- Check Network tab for: TradePage-DAM1S1xA.js (not Wi6EU6De)"
echo ""
echo "✅ If you see the NEW bundle name, the fix is live!"
