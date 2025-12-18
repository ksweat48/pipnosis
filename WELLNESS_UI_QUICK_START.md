# Wellness Check UI - Quick Start Guide

## What Was Fixed

**Problem:** Wellness checks ran in console but never showed in UI
**Solution:** Added display in "Live Market Analysis" section that transforms into "Alpha Trade Monitor" when trades are open

---

## How It Works Now

### When NO Trades Open
- Shows "Live Market Analysis"
- Displays market setup data (VWAP, trends, volatility)
- Shows countdown to next scan

### When Trades ARE Open
- Transforms into "Alpha Trade Monitor"
- Shows latest wellness check for each open trade
- Updates automatically every 60 seconds
- Real-time notifications when new checks arrive

---

## What You'll See

```
╔════════════════════════════════════════╗
║  🧠 Alpha Trade Monitor    MONITORING  ║
╠════════════════════════════════════════╣
║                                         ║
║  🛡️ EURUSD          +$6.00  │  HOLD   ║
║     2m ago          5h • 0.5R │  65%   ║
║                                         ║
║  STATUS: Position still open...        ║
║                                         ║
║  SITUATION: Down $6.00 but trend       ║
║  still favorable; setup not yet        ║
║  invalidated.                          ║
║                                         ║
║  WATCHING FOR: Monitoring price        ║
║  action around 1.17100...              ║
║                                         ║
║  ACTION TRIGGERS: Close if price       ║
║  breaches 1.17345 (stop loss)...       ║
║                                         ║
║  [Full Alpha AI analysis...]           ║
║                                         ║
╚════════════════════════════════════════╝
```

---

## Color Coding

- **🔵 BLUE** = HOLD (all good, keep monitoring)
- **🟠 ORANGE** = CONSIDER_EXIT (caution, watch closely)
- **🔴 RED** = CLOSE/EXIT_NOW (urgent action needed)

---

## Testing

1. **Start a goal session**
2. **Execute a trade**
3. **Wait 60 seconds** (Position Monitor runs every minute)
4. **Check "Alpha Trade Monitor" section** - you should see the wellness message
5. **Wait another 60 seconds** - message should update automatically

---

## Deployment

Build succeeded! Ready to deploy:

```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

---

## Technical Details

**Component:** `src/components/MarketAnalysisStream.tsx`

**Data Flow:**
1. Position Monitor runs every 60s
2. Alpha AI generates wellness check
3. Saved to `goal_ai_conversations` table with `conversation_type: 'periodic_wellness'`
4. Realtime subscription triggers UI update
5. MarketAnalysisStream displays message

**Key Functions:**
- `loadWellnessMessages()` - Fetches latest checks
- `getActionColor()` - Color codes by recommendation
- `formatTimeSince()` - Shows "2m ago" timestamps

---

## What's Next

After deployment, the wellness checks will be fully visible to users. No more "silent" monitoring - every check Alpha runs will be displayed with full reasoning, confidence, and recommendations.

**This completes the wellness check visibility system!** ✅
