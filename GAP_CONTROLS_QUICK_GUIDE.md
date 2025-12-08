# Gap Controls - Quick Reference Guide

## TL;DR

Your chart now has **tighter candle spacing** and **gap management controls**. Look for the button in the **bottom-right corner** of your chart.

## Fastest Solution for Smooth Candles

1. Click the "⚙️ Settings" button (bottom-right)
2. Select **"Compress All"** mode
3. Slide spacing to **2-3px**
4. Toggle **"Auto Fill Small Gaps"** ON
5. Done! Your candles are now much closer together

## What Each Mode Does

| Mode | Spacing | Best For | Effect |
|------|---------|----------|--------|
| **Show All** | 6px | Analysis | See everything, traditional view |
| **Hide Weekends** | 3px | Day trading | Remove weekend gaps, cleaner weekday view |
| **Compress All** | 2px | Maximum density | Tightest spacing, smoothest continuity |
| **Highlight Major** | 4px | Swing trading | Only mark significant gaps > 0.5% |

## Panel Location

```
┌─────────────────────────────────┐
│         YOUR CHART              │
│                                 │
│                                 │
│                                 │
│                    ┌──────────┐ │
│                    │ ⚙️ Settings│ │ ← Click here
│                    │  5 gaps  │ │
└────────────────────┴──────────┴─┘
```

When clicked, expands to full control panel with:
- Data quality score
- Gap statistics
- Mode selector
- Spacing slider
- Toggle switches

## Understanding Your Gaps

### Your Data is CLEAN ✅
- Database analysis shows **no missing candles**
- All gaps are **real market price jumps**
- This is normal forex market behavior

### Why Gaps Occur
1. **Low liquidity** - Fewer trades = bigger price jumps
2. **Market open/close** - Sunday 5 PM EST resumption
3. **News events** - Sudden volatility
4. **Weekend closures** - Friday to Sunday gap

### Gaps Are Important!
In trading, gaps often signal:
- Trend reversals
- Support/resistance breaks
- High volatility periods
- News-driven moves

**Don't hide them all** - they contain valuable information!

## Recommended Settings

### Best Balance (Recommended)
```
Mode: Hide Weekends
Spacing: 3-4px
Auto Fill: ON
Highlight Major: ON
```
**Result**: Clean weekday chart, smooth minor gaps, major gaps still visible

### Maximum Smoothness
```
Mode: Compress All
Spacing: 2px
Auto Fill: ON
Highlight Major: OFF
```
**Result**: Tightest possible spacing, all fillable gaps smoothed

### Trading Reality
```
Mode: Show All
Spacing: 4px
Auto Fill: OFF
Highlight Major: ON
```
**Result**: See actual market behavior with all gaps

## Keyboard Shortcuts (None Yet)

Currently, all controls are in the panel. Future enhancement could add:
- `G` - Toggle gap controls panel
- `1-4` - Switch between modes
- `+/-` - Adjust spacing

## Console Commands (For Testing)

Open browser console and try:

```javascript
// Check current settings
console.log(gapVisualizationService.getSettings());

// Get gap statistics
console.log(gapVisualizationService.getGapStatistics(gaps));

// Check if gap filler is enabled
console.log(candleGapFillerService.isEnabled());
```

## Settings Persistence

Your preferences are saved automatically:
- Visualization mode
- Bar spacing
- Gap filler enabled/disabled
- Major gap highlighting

**No need to reconfigure** every time you load the chart!

## Quick Troubleshooting

### "I still see gaps!"
- Are you in "Show All" mode? Switch to "Compress All"
- Is spacing at 6px? Slide to 2-3px
- Is gap filler disabled? Toggle it ON
- Are they major gaps? Those are preserved intentionally (>0.5%)

### "Panel won't open"
- Check bottom-right corner for small button
- Try clicking the button
- Check browser console for errors (F12)

### "Candles look weird"
- Reset to "Show All" mode
- Set spacing to 4px
- Disable gap filler
- This returns to default view

## Pro Tips

1. **Start conservative**: Use "Hide Weekends" mode first, then try "Compress All" if you want more

2. **Watch major gaps**: These often signal important market events - don't auto-fill them

3. **Check data quality**: Panel shows quality score - 80%+ is good, <80% may have issues

4. **Use weekend compression**: If you only trade weekdays, "Hide Weekends" mode is perfect

5. **Adjust per timeframe**: M5 charts benefit more from compression than H1/H4

## What Gap Filling Does

### Before Gap Filling
```
10:00 AM - Close: 1.16450
10:05 AM - [MISSING]
10:10 AM - [MISSING]
10:15 AM - Open: 1.16480
↑ Visible gap
```

### After Gap Filling
```
10:00 AM - Close: 1.16450
10:05 AM - [FILLED] OHLC: 1.16450
10:10 AM - [FILLED] OHLC: 1.16450
10:15 AM - Open: 1.16480
↑ Smooth continuity
```

**Note**: Only fills small gaps (<15 min) during market hours.

## Statistics Explained

When you open the panel, you see:

**Total Gaps**: All detected gaps between candles
**Major Gaps**: Gaps with >0.5% price change (significant)
**Weekend**: Friday close to Sunday open gaps
**Avg Size**: Average gap size as % of price

**Data Quality**: 0-100% score
- 90-100%: Excellent
- 80-89%: Good
- 70-79%: Fair
- <70%: Issues detected

## Default Values

Out of the box:
```javascript
{
  mode: 'show_all',
  highlightMajorGaps: true,
  showGapLabels: false,
  minGapSizeToShow: 0.1,  // 0.1%
  barSpacing: 4            // pixels
}
```

Gap Filler:
```javascript
{
  maxGapMinutes: 15,
  fillWeekendGaps: false,
  interpolationMethod: 'last_price',
  preserveMajorGaps: true
}
```

## Need Help?

Check these files:
- **GAP_CLOSING_SYSTEM_COMPLETE.md** - Full documentation
- **CHART_GAP_IMPROVEMENTS_INTEGRATION.md** - Technical integration guide

Or check the browser console for gap analysis logs:
```
[Chart] Gap Analysis: { ... }
[Chart] Gap Filling Applied: { ... }
```

---

**Start here**: Click the button in the bottom-right corner and select "Compress All" mode!
