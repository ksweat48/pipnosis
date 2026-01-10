# Quick Verification Guide - WebSocket Fix

## 1. Open Crypto Chart
Navigate to crypto chart (BTCUSD or ETHUSD)

## 2. Open Browser Console
Press F12 or right-click → Inspect → Console

## 3. Look for These Logs (Success)

```
✅ [KrakenWS] Connected successfully
✅ [KrakenWS] Subscribed to BTCUSD
✅ [WebSocketManager] Starting WebSocket connections...
✅ [Chart][BTCUSD] Subscribed to WebSocket updates
✅ [Chart][BTCUSD] 📈 Direct price update from kraken-ws: 87826.75
```

## 4. Watch Price Number
Price in chart header should update **multiple times per second** (not just once per second)

## 5. Watch Chart Line
Price line should animate **smoothly** in real-time (not jerky jumps)

## 6. Check Network Tab
1. Open Network tab in DevTools
2. Filter by "WS" (WebSocket)
3. Should see connection to `ws.kraken.com`
4. Status: "pending" (open)
5. Should show messages being received

## 7. Verify Environment Variable
In console, run:
```javascript
console.log('WebSocket Enabled:', import.meta.env.VITE_ENABLE_BROWSER_WEBSOCKET);
```
Should return: `"true"`

## Success = Smooth Real-Time Price Movement
If you see the price updating smoothly multiple times per second, the fix is working!

## If Still Not Working

**Check Netlify Environment Variables:**
1. Go to Netlify Dashboard
2. Site Settings → Environment Variables
3. Add: `VITE_ENABLE_BROWSER_WEBSOCKET` = `true`
4. Redeploy site

**Verify Build Included Change:**
Check if latest deployment has the updated `.env` file built in.
