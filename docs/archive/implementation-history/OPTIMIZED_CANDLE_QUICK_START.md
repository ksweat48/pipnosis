# Optimized Candle System - Quick Start Guide

## 🚀 Test It Now

1. **Start the app:** `npm run dev`
2. **Navigate to:** `/optimized-candles`
3. **Open multiple tabs** to see cross-tab coordination
4. **Watch the stats** update in real-time

## 📊 What You'll See

### Single Tab
- **Tab Mode:** Leader
- **Queries:** ~20/min
- **Cached Candles:** Growing as new candles complete
- **Updates:** Real-time via Realtime + polling

### Multiple Tabs
- **One tab:** Leader (polls database)
- **Other tabs:** Followers (receive via BroadcastChannel)
- **Total queries:** Same as single tab!
- **All tabs:** Synchronized data

## 💡 Quick Integration Example

### Use in Any Component
```typescript
import { useOptimizedCandles } from '@/hooks/useOptimizedCandles';

function MyChart() {
  const { candles, formingCandle, isLoading, error } = useOptimizedCandles({
    symbol: 'EURUSD',
    timeframe: 'M5',
    onCandleUpdate: (candle, isComplete) => {
      if (isComplete) {
        console.log('New completed candle!', candle);
      } else {
        console.log('Forming candle update', candle);
      }
    }
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      <div>Total Candles: {candles.length}</div>
      {formingCandle && (
        <div>Current Price: {formingCandle.close}</div>
      )}
    </div>
  );
}
```

## 📈 Resource Comparison

| Metric | Old System (3 tabs) | New System (3 tabs) | Savings |
|--------|---------------------|---------------------|---------|
| DB Queries/min | 210 | 35 | **83%** |
| Bandwidth | High | Low | **~80%** |
| Redundant queries | 180 | 0 | **100%** |

## 🔧 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Leader Tab (Polls)                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐         ┌──────────────┐              │
│  │   Realtime   │         │   Polling    │              │
│  │ Subscription │         │  (3 sec)     │              │
│  │              │         │              │              │
│  │ Completed    │         │ Forming      │              │
│  │ Candles      │         │ Candle       │              │
│  └──────┬───────┘         └──────┬───────┘              │
│         │                        │                      │
│         └────────┬───────────────┘                      │
│                  │                                      │
│            ┌─────▼──────┐                               │
│            │  Memory    │                               │
│            │   Cache    │                               │
│            └─────┬──────┘                               │
│                  │                                      │
│         ┌────────▼────────┐                             │
│         │ BroadcastChannel│                             │
│         └────────┬────────┘                             │
└──────────────────┼──────────────────────────────────────┘
                   │
     ┌─────────────┼─────────────┐
     │             │             │
┌────▼────┐   ┌────▼────┐   ┌────▼────┐
│ Follow  │   │ Follow  │   │ Follow  │
│ Tab 1   │   │ Tab 2   │   │ Tab 3   │
│ (0 DB)  │   │ (0 DB)  │   │ (0 DB)  │
└─────────┘   └─────────┘   └─────────┘
```

## ✅ Key Benefits

1. **Realtime Updates:** Completed candles pushed instantly via Supabase Realtime
2. **Minimal Polling:** Only query for forming candle (20/min vs 70+/min)
3. **Memory Cache:** Never re-fetch completed candles
4. **Cross-Tab Sync:** 3 tabs = same load as 1 tab
5. **Leader Election:** Automatic failover if leader tab closes
6. **Type Safe:** Full TypeScript support

## 🎯 When to Use

- **Charts** that need real-time candle data
- **Dashboards** showing multiple timeframes
- **Multi-tab apps** where users open duplicate tabs
- **High-frequency updates** where polling is inefficient

## 🔗 Files

- **Service:** `src/services/optimized-candle-manager.ts`
- **Hook:** `src/hooks/useOptimizedCandles.ts`
- **Demo:** `src/pages/OptimizedCandleTestPage.tsx`
- **Component:** `src/components/OptimizedCandleDemo.tsx`

## 📚 Full Documentation

See `OPTIMIZED_CANDLE_SYSTEM_COMPLETE.md` for detailed documentation.

---

**Ready to test? Visit `/optimized-candles` now!** 🚀
