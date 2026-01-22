# EQS Confidence Modifier - Monitoring Guide
## Quick Reference for Production Oversight

**Change ID:** EQS-CONF-MOD-001
**Status:** 🟡 Monitoring Phase (Retroactive CCIP)
**Started:** 2026-01-22
**Next Review:** T+24 hours

---

## Quick Access

### Documents Created
1. **Full CCIP Documentation:** `EQS_CONFIDENCE_MODIFIER_CCIP_RETROACTIVE.md`
2. **Monitoring Queries:** `scripts/monitor-eqs-confidence-impact.sql`
3. **This Guide:** `EQS_CONFIDENCE_MODIFIER_MONITORING_GUIDE.md`

### Database Tracking
- **Change Record:** `ccip_changes` table, ID: `EQS-CONF-MOD-001`
- **Monitoring Snapshots:** `ccip_monitoring_snapshots` table
- **View Progress:** Use queries in monitoring SQL file

---

## Monitoring Schedule

### Timeline
```
T+0  (NOW)     ✅ Retroactive docs complete, baseline captured
T+6h           ⏰ First health check
T+24h          ⏰ Comprehensive review
T+48h          ⏰ Full impact assessment
T+7d           ⏰ Long-term stability check
```

### What to Run at Each Checkpoint

#### **T+6 Hours**
```sql
-- Run Query 4: Quick Health Check
-- Expected: Establish baseline metrics
-- Alert if: No trades executed, system errors
```

#### **T+24 Hours**
```sql
-- Run ALL queries 1-8 from monitor-eqs-confidence-impact.sql
-- Focus on:
--   - Execution rate changes by confidence bucket
--   - Win rate stability
--   - Alert threshold checks
-- Record findings in ccip_monitoring_snapshots
```

#### **T+48 Hours**
```sql
-- Run ALL queries + Query 6 (Pre vs Post comparison)
-- Decision point: Continue monitoring or initiate rollback
-- Update ccip_changes.status if needed
```

---

## Alert Thresholds (Quick Reference)

### 🔴 CRITICAL - Immediate Action Required
- Win rate < 40% for any confidence bucket
- Win rate < 35% for confidence >= 85%
- Zero executions for high confidence (85-100%) over 6 hours
- System crashes or database errors
- 10+ consecutive losses

### 🟡 WARNING - Monitor Closely
- Win rate < 45% for confidence >= 85%
- Execution rate < 10% for confidence 75-84%
- Average PnL negative for any bucket over 24 hours
- Unusual standard deviation in confidence scores

### 🟢 SUCCESS INDICATORS
- Execution rate increases for 65-84% confidence
- Win rate maintained or improved for 85-100%
- More diverse symbol execution
- Positive overall PnL

---

## How to Record a Monitoring Snapshot

### Via SQL
```sql
SELECT record_ccip_monitoring_snapshot(
  'EQS-CONF-MOD-001',
  jsonb_build_object(
    'checkpoint', 'T+24h',
    'execution_rate_low_conf', 65.5,
    'execution_rate_high_conf', 45.2,
    'win_rate_85_plus', 52.3,
    'win_rate_75_84', 48.1,
    'total_trades', 47,
    'total_pnl', 245.80
  ),
  'green', -- or 'yellow', 'red'
  jsonb_build_array(
    'Win rate for 75-84% bucket slightly below 50%'
  ),
  'All metrics within acceptable ranges. Continue monitoring.'
);
```

### Viewing All Snapshots
```sql
SELECT
  snapshot_time,
  time_since_deploy,
  alert_level,
  metrics,
  notes
FROM ccip_monitoring_snapshots
WHERE change_id = 'EQS-CONF-MOD-001'
ORDER BY snapshot_time DESC;
```

---

## Expected Behavior Changes

### What SHOULD Happen
1. **More trades execute with 65-84% confidence** (easier threshold)
2. **Fewer trades execute with 95-100% confidence** (harder threshold)
3. **85-94% confidence trades maintain baseline** (no change)
4. **Overall execution diversity increases** (more symbols, scenarios)

### What Should NOT Happen
1. Win rates should NOT plummet
2. High-confidence trades should NOT have worse outcomes
3. System should NOT throw errors
4. Users should NOT report confusion

---

## Rollback Procedure

### Immediate Rollback Triggers
If ANY of these occur:
- Win rate < 35% for confidence >= 85%
- System crashes
- Critical bug discovered
- User-reported execution failures

### Rollback Steps
1. **Revert alpha-identity.ts:**
   ```typescript
   // Change getEQSConfidenceModifier to always return 1.0
   export function getEQSConfidenceModifier(alphaConfidence: number): number {
     return 1.0; // Rollback: disable confidence adjustment
   }
   ```

2. **Deploy immediately:**
   ```bash
   npm run build
   curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
   ```

3. **Update database:**
   ```sql
   UPDATE ccip_changes
   SET status = 'rolled_back',
       monitoring_completed_at = now()
   WHERE change_id = 'EQS-CONF-MOD-001';
   ```

4. **Document reason:**
   ```sql
   SELECT record_ccip_monitoring_snapshot(
     'EQS-CONF-MOD-001',
     jsonb_build_object('rollback_reason', 'YOUR REASON HERE'),
     'red',
     jsonb_build_array('ROLLBACK EXECUTED'),
     'Detailed explanation of why rollback was necessary'
   );
   ```

---

## Success Criteria (T+48h)

### Mark as Successful If:
- ✅ Win rate >= 45% for all confidence buckets
- ✅ No critical alerts triggered
- ✅ Execution diversity increased
- ✅ Overall PnL positive or neutral
- ✅ No user complaints
- ✅ System stability maintained

### Update Status:
```sql
UPDATE ccip_changes
SET status = 'completed',
    post_deploy_monitoring_completed = true,
    monitoring_completed_at = now()
WHERE change_id = 'EQS-CONF-MOD-001';
```

---

## Key Metrics to Watch

### Primary KPIs
1. **Execution Rate by Confidence Bucket** - Should diverge from baseline
2. **Win Rate by Confidence Bucket** - Should remain stable or improve
3. **Average PnL per Bucket** - Should be positive
4. **EQS vs Threshold Margin** - Shows how close trades are to cutoff

### Secondary KPIs
1. Symbol diversity
2. Trade duration patterns
3. Confidence score distribution
4. Entry quality score trends

---

## Contact & Escalation

### Who to Notify
- **Yellow Alert:** Document in snapshot, continue monitoring
- **Red Alert:** Create governance alert, notify admin team
- **Rollback Decision:** Requires admin approval unless critical emergency

### Documentation
All findings, decisions, and actions should be:
1. Recorded in `ccip_monitoring_snapshots`
2. Noted in project Slack/Discord
3. Summarized in weekly governance review

---

## Lessons for Future CCIP Compliance

### What We Did Wrong
- Deployed without system map
- No dry-run simulation
- Skipped compatibility review
- No staged rollout

### What We Did Right
- Comprehensive retroactive documentation
- Established monitoring framework
- Defined clear rollback criteria
- Created tracking infrastructure

### Process Improvement
Next time:
1. Write CCIP docs BEFORE coding
2. Get governance approval BEFORE deployment
3. Stage rollout (10% → 50% → 100%)
4. Have monitoring ready DAY ONE

---

**Status Check Command:**
```sql
SELECT
  c.change_id,
  c.status,
  c.ccip_compliant,
  c.deployed_at,
  COUNT(s.id) as snapshot_count,
  MAX(s.snapshot_time) as last_snapshot,
  MAX(s.alert_level) as latest_alert_level
FROM ccip_changes c
LEFT JOIN ccip_monitoring_snapshots s ON s.change_id = c.change_id
WHERE c.change_id = 'EQS-CONF-MOD-001'
GROUP BY c.id, c.change_id, c.status, c.ccip_compliant, c.deployed_at;
```
