# KPI System Quick Start Guide

## How to Use the New KPI System

### 1. Trigger KPI Updates (After Each Backtest)

```typescript
import { kpiAggregator } from './services/kpi-aggregator';

// After backtest completes
const result = await kpiAggregator.updateAllKPIs(user.id);

console.log(`Updated: ${result.kpisUpdated.join(', ')}`);
if (result.errors.length > 0) {
  console.error('Errors:', result.errors);
}
```

### 2. Access the AI Learning Center

Navigate to `/ai-learning-center` to view:

- **Overview** - System health at a glance
- **LLM Decision Stack** - 5-layer performance funnel
- **Avoid Patterns** - Pattern enforcement metrics
- **Continuous Learning** - Learning loop health
- **Strategy Evolution** - Pattern discovery tracking
- **Smart Goal Mode** - LLM vs rule performance
- **AI Mastery** - Skill progression dashboard

### 3. Manual Refresh

Users can click the "Refresh" button in the header to:
- Recalculate all KPIs
- Reload data from database
- Update all visualizations

### 4. Export Data

Click "Export" button to download a JSON file containing:
- All KPI metrics
- Anomaly data
- Export timestamp

### 5. View Anomalies

Anomalies are automatically detected and displayed:
- Red banner in header shows count
- Overview tab lists all unacknowledged anomalies
- KPI cards with anomalies highlighted in red
- Severity levels: low, medium, high, critical

## Database Tables

### Core KPI Tables
- `llm_layer_kpis` - 5-layer decision stack metrics
- `avoid_pattern_kpis` - Pattern enforcement metrics
- `continuous_learning_kpis` - Learning loop metrics
- `strategy_evolution_kpis` - Pattern discovery metrics
- `smart_goal_kpis` - Smart Goal Mode metrics
- `ai_mastery_kpis` - Skill progression metrics
- `kpi_anomalies` - Detected anomalies
- `kpi_cache` - Performance caching

### Data Sources

KPIs are calculated from:
- `llm_layer_decision_log`
- `avoid_pattern_enforcement_log`
- `ai_learning_insights`
- `ai_pattern_discoveries`
- `smart_goal_sessions` / `smart_goal_trades`
- `ai_trade_analysis`
- `ai_skill_tracking`

## Key Metrics Tracked

### LLM Decision Stack (Layer 0-5)
- Pass rate per layer
- Rejection counts and reasons
- Token usage
- Processing time
- Layer activation counts

### Avoid Patterns
- Trades avoided count
- Block rate percentage
- Pattern match accuracy
- Average similarity score
- EV comparison (avoided vs taken)

### Continuous Learning
- Insights created/validated/updated/pruned
- Validation accuracy
- Confidence recalibrations
- Learning velocity
- System health score

### Strategy Evolution
- Patterns discovered
- Active vs deactivated patterns
- Average pattern EV
- Pattern survival rate
- Cross-symbol generalization

### Smart Goal Mode
- LLM decision percentage
- LLM vs rule-based win rates
- Performance gap
- Goals completed
- Goal completion efficiency

### AI Mastery
- Moving win rates (50/100/500 trades)
- Moving profit factors (50/100/500 trades)
- Skill level and progress
- Trades to next level
- Confidence accuracy

## Anomaly Thresholds

Default thresholds for anomaly detection:

| Metric | Min | Max | Severity |
|--------|-----|-----|----------|
| LLM Pass Rate | 40% | 100% | High |
| Avoid Block Rate | 0% | 50% | Medium |
| Learning Velocity | 10% | 200% | Medium |
| Win Rate | 45% | 100% | Critical |
| Profit Factor | 1.0 | 10.0 | Critical |

## Performance Features

1. **Caching** - 5-minute TTL for frequently accessed KPIs
2. **Batch Loading** - All KPIs loaded in parallel
3. **Indexed Queries** - Fast lookups by user_id and date
4. **Upsert Operations** - Efficient updates without duplicates
5. **Database Functions** - Server-side calculations

## Integration Example

```typescript
// In your backtest completion handler
async function handleBacktestComplete(userId: string) {
  try {
    // 1. Run backtest logic
    const backtestResults = await runBacktest(userId);

    // 2. Update KPIs
    await kpiAggregator.updateAllKPIs(userId);

    // 3. KPIs now available in AI Learning Center
    console.log('KPIs updated - users can view in Learning Center');

  } catch (error) {
    console.error('Error in backtest:', error);
  }
}
```

## Troubleshooting

### KPIs Not Updating
1. Check that `kpiAggregator.updateAllKPIs()` is being called
2. Verify user has data in source tables
3. Check console for error messages

### No Data Showing
1. Ensure KPIs have been calculated for today's date
2. Click "Refresh" button to trigger update
3. Check that source tables have data

### Anomalies Not Detecting
1. Verify thresholds in `kpi-aggregator.ts`
2. Check that KPIs are outside threshold ranges
3. Look in `kpi_anomalies` table directly

### Performance Issues
1. KPIs are cached for 5 minutes by default
2. Increase cache TTL if needed
3. Check database indexes are present

## Next Steps

The system is ready to use immediately. For enhancements:

1. Add real-time Supabase subscriptions for live updates
2. Implement date range filtering (week, month views)
3. Add charting library for trend visualization
4. Create drill-down modals for detailed analysis
5. Add PDF report generation
6. Implement email alerts for critical anomalies

## Support

For issues or questions:
1. Check `AI_LEARNING_CENTER_KPI_SYSTEM_COMPLETE.md` for full documentation
2. Review console logs for error messages
3. Verify database tables exist and have proper RLS policies
4. Check that all migrations have been applied
