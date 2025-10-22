# Historical Data Backfill System - Usage Guide

## Overview

This system provides comprehensive tools for detecting, analyzing, and fixing gaps in historical market data. It's specifically designed to address issues like the October 8th data gaps and provides ongoing data quality monitoring.

## Quick Start: Fixing October 8th Gaps

### Via Admin Dashboard (Recommended)

1. Navigate to Admin Dashboard (`/admin`)
2. Click on the **Data Health** tab
3. Click the **"Fix Oct 8th"** button
4. Monitor progress in the "Recent Backfill Tasks" section

This will automatically:
- Scan October 8th across all symbols and timeframes
- Fetch missing data from MetaAPI
- Fill gaps while preserving existing good data
- Validate and verify the results

### Programmatically

```typescript
import { historicalBackfillService } from './services/historical-backfill';

// Backfill October 8th for all symbols and timeframes
const tasks = await historicalBackfillService.backfillOctoberEighth();

console.log(`Started ${tasks.length} backfill tasks`);
```

## Features

### 1. Gap Detection and Analysis

**Gap Detection Service** (`src/services/gap-detection.ts`)

Analyzes market data to identify:
- Missing candles during trading hours
- Data completeness percentages
- Specific dates with issues
- Critical vs minor gaps

```typescript
import { gapDetectionService } from './services/gap-detection';

// Analyze a specific symbol and timeframe
const analysis = await gapDetectionService.analyzeSymbolTimeframe(
  'EURUSD',
  'M15',
  new Date('2024-10-01'),
  new Date('2024-10-15')
);

console.log(`Completeness: ${analysis.completenessPercentage}%`);
console.log(`Gaps detected: ${analysis.gaps.length}`);
console.log(`Missing candles: ${analysis.missingCandles}`);

// Scan all symbols for gaps
const allResults = await gapDetectionService.scanAllSymbolsForGaps(
  new Date('2024-10-01'),
  new Date('2024-10-15'),
  ['EURUSD', 'GBPUSD', 'XAUUSD']
);

// Generate detailed report
const report = await gapDetectionService.generateGapReport(
  new Date('2024-10-01'),
  new Date('2024-10-15')
);
```

### 2. Historical Backfill Service

**Backfill Service** (`src/services/historical-backfill.ts`)

Fetches missing data from MetaAPI and fills gaps intelligently.

```typescript
import { historicalBackfillService } from './services/historical-backfill';

// Backfill a specific date range
const task = await historicalBackfillService.backfillDateRange(
  'EURUSD',
  'M15',
  new Date('2024-10-08T00:00:00Z'),
  new Date('2024-10-08T23:59:59Z'),
  100 // priority
);

// Monitor progress
historicalBackfillService.onProgress(task.id, (progress) => {
  console.log(`${progress.percentComplete}% - ${progress.currentStep}`);
});

// Backfill detected gaps
const gapTasks = await historicalBackfillService.backfillDetectedGaps(
  'EURUSD',
  'M15',
  gaps
);

// Backfill specific problem dates
const dateTasks = await historicalBackfillService.backfillProblemDates(
  'EURUSD',
  'M15',
  ['2024-10-08', '2024-10-09']
);

// Check task status
const status = await historicalBackfillService.getTaskStatus(task.id);
console.log(`Status: ${status?.status}`);
console.log(`Fetched: ${status?.candlesFetched}/${status?.candlesTarget}`);

// Get all recent tasks
const allTasks = await historicalBackfillService.getAllBackfillTasks(50);
```

### 3. Data Verification

**Verification Service** (`src/services/data-verification.ts`)

Validates data quality and integrity after backfilling.

```typescript
import { dataVerificationService } from './services/data-verification';

// Verify a specific symbol and timeframe
const report = await dataVerificationService.verifySymbolTimeframe(
  'EURUSD',
  'M15',
  new Date('2024-10-08T00:00:00Z'),
  new Date('2024-10-08T23:59:59Z')
);

console.log(`Overall: ${report.overall}`); // pass, warning, or fail
console.log(`Issues: ${report.issues.length}`);
console.log(`Recommendations:`, report.recommendations);

// Verify October 8th across all symbols
const oct8Results = await dataVerificationService.verifyOctoberEighth();

// Generate verification report
const verificationReport = await dataVerificationService.generateVerificationReport(
  oct8Results
);

// Create before/after comparison
const beforeSnapshot = await dataVerificationService.createDataSnapshot(
  'EURUSD',
  'M15',
  new Date('2024-10-08'),
  new Date('2024-10-08')
);

// ... run backfill ...

const comparison = await dataVerificationService.compareBeforeAfter(
  'EURUSD',
  'M15',
  new Date('2024-10-08'),
  new Date('2024-10-08'),
  beforeSnapshot
);

console.log(`Candles added: ${comparison.improvement.candlesAdded}`);
console.log(`Gaps fixed: ${comparison.improvement.gapsFixed}`);
console.log(`Completeness improved: ${comparison.improvement.completenessImprovement}%`);
```

### 4. Admin Dashboard Integration

The **Data Health Panel** component provides a user-friendly interface:

**Features:**
- Real-time health monitoring for all symbols and timeframes
- Visual indicators (excellent, good, fair, poor)
- Custom date range gap scanning
- One-click October 8th fix
- Manual backfill triggers
- Live progress tracking
- Exportable gap reports

**Access:**
1. Login as admin
2. Navigate to `/admin`
3. Click "Data Health" tab

## Database Tables

### `backfill_tasks`
Tracks all backfill operations with status and progress.

### `data_quality_logs`
Stores historical data quality check results.

### `market_data_completeness`
Tracks candle counts and completeness metrics per symbol/timeframe.

## Database Functions

### `get_active_backfill_tasks()`
Returns all pending and in-progress backfill tasks.

### `get_recent_quality_reports(p_symbol, p_timeframe, p_limit)`
Retrieves recent data quality check results.

### `log_data_quality_check(...)`
Creates a data quality log entry with automatic recommendations.

### `update_candle_count_stats(p_symbol, p_timeframe)`
Updates candle count statistics for a symbol/timeframe combination.

### `cleanup_old_candles(p_symbol, p_timeframe, p_keep_count)`
Removes old candles while keeping the most recent N candles.

## Workflow Example: Complete October 8th Fix

```typescript
import {
  gapDetectionService,
  historicalBackfillService,
  dataVerificationService
} from './services';

async function fixOctoberEighth() {
  const oct8Start = new Date('2024-10-08T00:00:00Z');
  const oct8End = new Date('2024-10-08T23:59:59Z');

  // Step 1: Create baseline snapshot
  console.log('📸 Creating baseline snapshot...');
  const beforeSnapshots = new Map();

  for (const symbol of ['EURUSD', 'GBPUSD', 'XAUUSD']) {
    for (const timeframe of ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1']) {
      const snapshot = await dataVerificationService.createDataSnapshot(
        symbol,
        timeframe,
        oct8Start,
        oct8End
      );
      beforeSnapshots.set(`${symbol}_${timeframe}`, snapshot);
    }
  }

  // Step 2: Run gap analysis
  console.log('🔍 Analyzing gaps...');
  const gapReport = await gapDetectionService.generateGapReport(
    oct8Start,
    oct8End,
    ['EURUSD', 'GBPUSD', 'XAUUSD']
  );
  console.log(gapReport);

  // Step 3: Execute backfill
  console.log('🚀 Starting backfill...');
  const tasks = await historicalBackfillService.backfillOctoberEighth();

  // Step 4: Wait for completion (in production, use async monitoring)
  console.log('⏳ Waiting for backfill to complete...');
  await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 minute

  // Step 5: Verify results
  console.log('✅ Verifying results...');
  const verificationResults = await dataVerificationService.verifyOctoberEighth();

  // Step 6: Generate comparison report
  console.log('📊 Generating comparison report...');
  for (const [key, beforeSnapshot] of beforeSnapshots.entries()) {
    const [symbol, timeframe] = key.split('_');
    const comparison = await dataVerificationService.compareBeforeAfter(
      symbol,
      timeframe as any,
      oct8Start,
      oct8End,
      beforeSnapshot
    );

    console.log(`${symbol} ${timeframe}:`);
    console.log(`  - Candles added: ${comparison.improvement.candlesAdded}`);
    console.log(`  - Gaps fixed: ${comparison.improvement.gapsFixed}`);
    console.log(`  - Completeness: ${comparison.beforeBackfill.completeness.toFixed(1)}% → ${comparison.afterBackfill.completeness.toFixed(1)}%`);
  }

  // Step 7: Generate final verification report
  const finalReport = await dataVerificationService.generateVerificationReport(
    verificationResults
  );
  console.log('\n' + finalReport);
}

// Run the fix
fixOctoberEighth().catch(console.error);
```

## Best Practices

1. **Always create snapshots before backfilling** to measure improvements
2. **Verify results** after backfill operations complete
3. **Monitor progress** using the admin dashboard or progress callbacks
4. **Start with critical gaps** (use priority system)
5. **Run during off-peak hours** for large backfill operations
6. **Export reports** for documentation and auditing

## Troubleshooting

### No data being fetched
- Check MetaAPI credentials in `.env`
- Verify account is deployed and connected
- Check date ranges are valid trading days

### Backfill tasks stuck in "in_progress"
- Check browser console for errors
- Verify MetaAPI rate limits not exceeded
- Restart backfill with higher priority

### Gaps still present after backfill
- Verify data actually exists for those dates
- Check if dates are weekends/holidays (market closed)
- Run verification to see specific issues

### Database errors
- Check RLS policies are correct
- Verify user has required permissions
- Check database connection

## Support

For issues or questions:
1. Check the verification report for specific problems
2. Review backfill task error messages
3. Check browser console for detailed errors
4. Export gap report for analysis
