# 🚨 CRITICAL INFRASTRUCTURE SYSTEMS

**DO NOT MODIFY WITHOUT EXPLICIT APPROVAL**

This document outlines the mission-critical systems that power Pipnosis's real-time trading functionality. These systems have been carefully tuned and tested. Any modifications to these components must be reviewed and approved before deployment.

## 📚 Related Architecture Documents

- **Alpha Authority:** [ALPHA_FINAL_AUTHORITY_ARCHITECTURE.md](./ALPHA_FINAL_AUTHORITY_ARCHITECTURE.md) - Decision-making authority and Omega-9 scope
- **Cron Jobs:** [ARCHITECTURE_DECISION.md](./ARCHITECTURE_DECISION.md) - Why Supabase cron is permanently disabled
- **Protection Systems:** [PROTECTION_SYSTEM_GUIDE.md](./PROTECTION_SYSTEM_GUIDE.md) - Two-layer protection architecture

---

## 🎯 Critical Systems Overview

### 1. Real-Time Price Polling System

**Purpose:** Fetches live forex prices from MetaAPI and maintains real-time data flow

**Components:**
- `src/services/global-polling-coordinator.ts` - Coordinates all symbol polling
- `src/services/polling-config-service.ts` - Manages polling intervals by priority
- `src/services/chart-direct-price-poller.ts` - Direct price polling for charts
- `netlify/functions/continuous-price-collector.ts` - Server-side price collection

**Critical Configuration:**
- **Chart Update Interval (Dynamic):**
  - **Crypto symbols (BTCUSD, ETHUSD):** `500ms` - High-frequency updates for 24/7 markets
  - **Forex symbols:** `3000ms` (3 seconds) - Industry standard for retail forex
  - Interval adjusts automatically based on tracked symbols
- **Priority-based Intervals:**
  - Critical (active positions): 1000ms
  - High (viewed pairs): 2000ms
  - Normal: 3000ms
  - Low (background): 5000ms
- **Market Hours Check:** Every 60 seconds
- **Heartbeat Monitoring:** Every 5 seconds

**Why These Values:**
- 500ms for crypto provides smooth, flowing price movement (6x faster than forex)
- 3 seconds for forex matches TradingView and MetaTrader standards
- Crypto APIs (Kraken, Binance) support higher request rates than forex MetaAPI
- Balances real-time feel with API rate limits
- Prevents browser throttling in background tabs

---

### 2. Chart System

**Purpose:** Renders live candlestick charts with real-time price updates

**Components:**
- `src/components/MarketChart.tsx` - Main chart component
- `src/services/chart-direct-price-poller.ts` - Chart-specific polling (dynamic interval)
- `src/services/chart-candle-poller.ts` - Candle data management
- `src/services/candle-data-service.ts` - Candle data layer

**Critical Configuration:**
- **Price Update Frequency:** Dynamic based on symbol type
  - Crypto: 500ms (real-time streaming feel)
  - Forex: 3 seconds (standard)
- **Visibility Detection:** Pauses when tab hidden
- **Source Fallback:** MetaAPI → Database → Offline
- **Blue Indicator:** Live MetaAPI/Kraken data
- **Yellow Indicator:** Database fallback

**Data Flow:**
```
MetaAPI Price Feed
    ↓
Netlify Function (continuous-price-collector)
    ↓
Supabase (realtime_prices table)
    ↓
Chart Direct Price Poller (500ms crypto / 3s forex)
    ↓
MarketChart Component
    ↓
Lightweight Charts Library
    ↓
User sees live price
```

---

### 3. Server-Side Data Collection (Netlify Scheduled Functions)

**Purpose:** Collects price data and aggregates candles on server-side to prevent browser throttling

**⚠️ ARCHITECTURE DECISION: ALL SCHEDULING USES NETLIFY ONLY**

Supabase pg_cron is permanently disabled. See `docs/ARCHITECTURE_DECISION.md` for rationale.

**Approved Scheduled Functions:**
- `netlify/functions/continuous-price-collector.ts` - Collects live prices every minute
- `netlify/functions/continuous-candle-aggregator.ts` - Aggregates candles every 5 minutes

**Critical Configuration (netlify.toml):**

```toml
[functions."continuous-price-collector"]
  timeout = 26
  schedule = "* * * * *"  # Every minute

[functions."continuous-candle-aggregator"]
  timeout = 26
  schedule = "*/5 * * * *"  # Every 5 minutes
```

**⚠️ CRITICAL REQUIREMENTS:**
- Cron format MUST be 5-field format (minute hour day month weekday)
- DO NOT use 6-field format (with seconds) - Netlify does not support it
- DO NOT add Supabase cron jobs - they are permanently banned
- DO NOT use MetaAPI historical candles endpoint - it returns flat data
- ✅ CORRECT: `"* * * * *"` (5 fields)
- ❌ WRONG: `"0 * * * * *"` (6 fields - will break)

---

### 4. Database Tables (Supabase)

**Critical Tables:**
- `realtime_prices` - Live price data (source of truth)
- `forex_candles` - Historical candle data
- `polling_configuration` - User polling preferences

**RLS Policies:**
- Prices: Read-only for authenticated users
- Candles: Service role write, authenticated read
- Configuration: User-specific read/write

---

## 🔒 Protected Files

**DO NOT MODIFY without explicit review:**

### High Risk (Core Polling)
- `src/services/global-polling-coordinator.ts`
- `src/services/chart-direct-price-poller.ts`
- `src/services/polling-config-service.ts`
- `netlify.toml` (functions section)

### Medium Risk (Data Flow)
- `src/components/MarketChart.tsx`
- `src/services/candle-data-service.ts`
- `netlify/functions/continuous-price-collector.ts`
- `netlify/functions/continuous-candle-aggregator.ts`

### Low Risk (Supporting)
- `src/services/chart-preferences.ts`
- `src/utils/marketHours.ts`

---

## ⚠️ Common Mistakes to Avoid

### 1. Changing Polling Intervals
**DON'T:** Reduce forex chart polling below 2 seconds
**WHY:** API rate limits (20 req/min max) and browser throttling
**NOTE:** Crypto polling at 500ms is approved (Kraken/Binance support higher rates)

### 2. Modifying Cron Expressions
**DON'T:** Use 6-field cron format (includes seconds)
**WHY:** Netlify only supports 5-field format, will silently fail

### 3. Removing Visibility Detection
**DON'T:** Remove `document.hidden` checks
**WHY:** Browser throttles background tabs, causing stale data

### 4. Changing Function Timeouts
**DON'T:** Set timeouts below 26 seconds for scheduled functions
**WHY:** Cold starts require 5-10 seconds, API calls need buffer

### 5. Disabling Market Hours Checks
**DON'T:** Remove `getForexMarketStatus()` calls
**WHY:** Prevents wasted API calls when market is closed (nights/weekends)

---

## 🔄 Change Request Protocol

**Before modifying any critical system:**

1. **Document the Change**
   - What are you changing?
   - Why is it necessary?
   - What's the expected impact?

2. **Review Dependencies**
   - What other systems depend on this?
   - Will this break existing functionality?
   - Is there a fallback/rollback plan?

3. **Test in Isolation**
   - Create a test branch
   - Verify polling still works
   - Check chart updates continue
   - Monitor console for errors

4. **Deploy with Monitoring**
   - Watch the build validation warnings
   - Review the CRITICAL_CHANGES_REPORT.txt
   - Monitor production for 15 minutes after deploy
   - Keep rollback commands ready

---

## 🛡️ Protection Mechanisms

### Build-Time Validation
- `npm run build` checks critical configurations
- Warns if intervals or schedules changed
- Generates change report
- **Does NOT block deployment** (warnings only)

### Runtime Monitoring
- Heartbeat detection for polling health
- Automatic recovery from browser throttling
- Console warnings if intervals deviate
- Status indicators show system health

### Documentation
- This file serves as the authority
- `config/critical-baseline.json` has approved values
- Comments in code mark critical sections

---

## 📊 System Health Indicators

**Healthy System:**
- ✅ Blue indicator on chart (live MetaAPI/Kraken data)
- ✅ Crypto prices update every 500ms (smooth flow)
- ✅ Forex prices update every 3 seconds
- ✅ Global polling shows "active" for all pairs
- ✅ Console logs show successful polls
- ✅ No error messages in console

**Degraded System:**
- ⚠️ Yellow indicator on chart (database fallback)
- ⚠️ Some pairs show "stale" status
- ⚠️ Console shows MetaAPI errors but continues
- ⚠️ Prices still updating but from cache

**Failed System:**
- ❌ Red/grey indicator on chart (offline)
- ❌ Prices frozen or not updating
- ❌ Console shows repeated errors
- ❌ "Stopped polling" messages
- ❌ All pairs show "error" status

---

## 🚀 Recovery Procedures

### If Polling Stops:
1. Check browser console for errors
2. Verify market is open (Sunday 5pm - Friday 5pm EST)
3. Check Netlify function logs
4. Restart polling via GlobalPollingStatus component
5. Hard refresh page (Ctrl+Shift+R)

### If Chart Freezes:
1. Check indicator color (blue = live, yellow = cached)
2. Verify chart-direct-price-poller is running
3. Check realtime_prices table has recent data
4. Restart page visibility detection
5. Clear browser cache

### If Cron Jobs Fail:
1. Check netlify.toml for correct 5-field format
2. Verify function timeouts are adequate
3. Check Netlify dashboard for failed runs
4. Review function logs for errors
5. Redeploy with corrected configuration

---

## 📝 Version History

**Last Updated:** 2025-12-28
**Current Configuration Version:** 1.1
**Last Major Change:** Implemented dynamic polling intervals (500ms crypto / 3s forex)

---

## 🆘 Emergency Contacts

If critical systems fail in production:

1. Check this documentation first
2. Review `config/critical-baseline.json` for known-good values
3. Check build warnings in last deployment
4. Review Netlify function logs
5. Rollback to last known-good deployment if needed

---

**Remember:** These systems work. They've been tested and tuned. If something breaks, it's almost always because a critical value was changed. Always check the baseline configuration first.
