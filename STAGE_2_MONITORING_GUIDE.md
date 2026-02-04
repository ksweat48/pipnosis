# Stage 2 Real-Time Monitoring Guide

**Time Window**: 6-8 hours from Stage 2 activation
**Check Interval**: Every 30 minutes
**Quick Check Time**: 2-3 minutes per check

---

## Pre-Check Verification (Do This First)

Run these queries in Supabase SQL editor to confirm Stage 2 is active:

```sql
-- Confirm Stage 2 is active
SELECT stage_number, stage_name, canary_percentage, is_active, activated_at
FROM ccip_deployment_stages
WHERE is_active = true;
-- Expected: stage_number = 2, canary_percentage = 25, is_active = true

-- Confirm feature flag stage
SELECT feature_name, stage_number, enabled
FROM deployment_feature_flags
WHERE feature_name = 'timeout-governance-ccip-20260204';
-- Expected: stage_number = 2, enabled = true

-- Verify deployment is tracking changes
SELECT COUNT(*) as stage_2_changes
FROM ccip_deployment_changes
WHERE stage_id = (SELECT id FROM ccip_deployment_stages WHERE stage_number = 2);
-- Expected: 4 changes pre-populated
```

---

## 30-Minute Monitoring Routine

### Step 1: Overall Health Check (1 minute)

```sql
SELECT
  service,
  success_rate,
  total_events,
  CASE
    WHEN success_rate >= 95 THEN '✅ EXCELLENT'
    WHEN success_rate >= 90 THEN '✅ GOOD'
    WHEN success_rate >= 85 THEN '⚠️ WARNING'
    ELSE '❌ CRITICAL'
  END as health_status
FROM (
  SELECT
    service,
    COUNT(*) as total_events,
    ROUND(
      COUNT(CASE WHEN success = true THEN 1 END)::numeric /
      NULLIF(COUNT(*)::numeric, 0) * 100.0,
      2
    ) as success_rate
  FROM timeout_event_metrics
  WHERE event_timestamp > now() - interval '2 hours'
  GROUP BY service
) metrics
ORDER BY success_rate ASC;
```

**What to Look For**:
- ✅ All rows show GREEN or YELLOW
- ❌ Any RED = need to investigate/rollback

---

### Step 2: Detailed Metrics (1 minute)

```sql
SELECT * FROM get_timeout_metrics_summary(NULL, 120);
```

**Expected Output**:
```
service         | total_events | success_queries | failed_queries | success_rate | avg_timeout_ms | users_affected | last_event_time
price_coord     | 450          | 432             | 18             | 96.00        | 5832.45        | 1250           | [recent]
chart_data      | 320          | 304             | 16             | 95.00        | 6200.15        | 890            | [recent]
position_monitor| 280          | 265             | 15             | 94.64        | 6500.80        | 765            | [recent]
```

**Red Flags** 🚨:
- Any success_rate < 85%
- Sudden spike in total_events (possible cascade)
- Last_event_time is NULL or stale (> 5 min old)

---

### Step 3: Circuit Breaker Status (1 minute)

```sql
SELECT
  service,
  COUNT(*) as total_events,
  COUNT(CASE WHEN success = false THEN 1 END) as failures,
  COUNT(CASE WHEN failure_reason LIKE '%circuit breaker%' THEN 1 END) as breaker_activations,
  ROUND(
    COUNT(CASE WHEN failure_reason LIKE '%circuit breaker%' THEN 1 END)::numeric /
    NULLIF(COUNT(*)::numeric, 0) * 100.0,
    2
  ) as breaker_percentage
FROM timeout_event_metrics
WHERE event_timestamp > now() - interval '2 hours'
GROUP BY service
HAVING COUNT(*) > 0
ORDER BY breaker_percentage DESC;
```

**Expected Values**:
- breaker_percentage: < 1% (all rows)
- If any > 2%: service needs investigation

**Red Flags** 🚨:
- Any breaker_percentage > 5%
- Circuit breaker staying open (stuck)

---

### Step 4: Retry Distribution (1 minute)

```sql
SELECT
  service,
  retry_attempt,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (PARTITION BY service), 1) as percentage
FROM timeout_event_metrics
WHERE event_timestamp > now() - interval '2 hours'
GROUP BY service, retry_attempt
ORDER BY service, retry_attempt;
```

**Expected Pattern**:
```
Attempt 1: 70-75% (first try succeeds)
Attempt 2: 20-25% (backoff helps, retry succeeds)
Attempt 3: 3-5% (exponential backoff, rare)
Attempt 4+: < 1% (very rare, circuit breaker kicks in)
```

**Red Flags** 🚨:
- Attempt 1 < 50% (too many immediate failures)
- Attempt 4+ > 2% (circuit breaker not activating)

---

### Step 5: Alert Status (1 minute)

```sql
SELECT
  COUNT(*) as alert_count,
  COUNT(CASE WHEN triggered_at > now() - interval '30 minutes' THEN 1 END) as recent_alerts,
  service,
  timeout_percentage
FROM governance_timeout_alerts
WHERE triggered_at > now() - interval '2 hours'
GROUP BY service, timeout_percentage
ORDER BY triggered_at DESC
LIMIT 10;
```

**Expected**:
- recent_alerts: 0-3 (minimal)
- If recent_alerts > 5: possible issue

**Red Flags** 🚨:
- Same service alerting repeatedly
- Different services alerting simultaneously (cascade)

---

## Decision Tree

### If Everything Looks Green ✅

```
Success Rate: ≥ 90% ✅
Circuit Breaker: < 1% ✅
Retry Distribution: Expected pattern ✅
Alerts: Minimal ✅

→ Record "HEALTHY" in monitoring log
→ Move to next 30-min check
→ No action needed
```

### If Warning Signs Appear ⚠️

```
Success Rate: 85-90% ⚠️
Circuit Breaker: 1-3% ⚠️
Alerts: 5-10 recent ⚠️

→ Run detailed investigation queries (see below)
→ Look for pattern (specific service? specific time?)
→ Check user error reports
→ If improving, wait and re-check in 15 min
→ If degrading, consider rollback
```

### If Critical Issues Detected ❌

```
Success Rate: < 85% ❌
Circuit Breaker: > 5% open ❌
Cascading failures detected ❌
Multiple services failing ❌

→ INITIATE ROLLBACK IMMEDIATELY
→ Run rollback command (see below)
→ Document what went wrong
→ Escalate to engineering team
```

---

## Detailed Investigation Queries

### When Success Rate is Low

```sql
-- Which services are failing most?
SELECT
  service,
  COUNT(*) as total,
  COUNT(CASE WHEN success = false THEN 1 END) as failures,
  ROUND(COUNT(CASE WHEN success = false THEN 1 END)::numeric / COUNT(*) * 100, 2) as failure_rate
FROM timeout_event_metrics
WHERE event_timestamp > now() - interval '30 minutes'
GROUP BY service
ORDER BY failure_rate DESC;

-- What are the failure reasons?
SELECT
  service,
  failure_reason,
  COUNT(*) as count,
  MAX(event_timestamp) as last_occurrence
FROM timeout_event_metrics
WHERE success = false AND event_timestamp > now() - interval '30 minutes'
GROUP BY service, failure_reason
ORDER BY count DESC;
```

### When Circuit Breaker is Active

```sql
-- Which service's circuit breaker is open?
SELECT
  service,
  COUNT(*) as breaker_events,
  MIN(event_timestamp) as first_activation,
  MAX(event_timestamp) as last_activation,
  EXTRACT(MINUTE FROM (MAX(event_timestamp) - MIN(event_timestamp))) as open_duration_minutes
FROM timeout_event_metrics
WHERE failure_reason LIKE '%circuit breaker%'
  AND event_timestamp > now() - interval '1 hour'
GROUP BY service
ORDER BY breaker_events DESC;

-- Is circuit breaker recovering?
SELECT
  DATE_TRUNC('minute', event_timestamp) as minute,
  service,
  COUNT(CASE WHEN failure_reason LIKE '%circuit breaker%' THEN 1 END) as breaker_count
FROM timeout_event_metrics
WHERE event_timestamp > now() - interval '30 minutes'
GROUP BY minute, service
ORDER BY minute DESC, breaker_count DESC;
```

### When Alerts are Firing

```sql
-- What's triggering alerts?
SELECT
  service,
  timeout_percentage,
  threshold,
  COUNT(*) as alert_count,
  MIN(triggered_at) as first_alert,
  MAX(triggered_at) as last_alert
FROM governance_timeout_alerts
WHERE triggered_at > now() - interval '1 hour'
GROUP BY service, timeout_percentage, threshold
ORDER BY alert_count DESC;

-- Is the issue persistent?
SELECT
  service,
  COUNT(*) as total_alerts_1hr,
  COUNT(CASE WHEN triggered_at > now() - interval '30 minutes' THEN 1 END) as recent_30min,
  COUNT(CASE WHEN triggered_at > now() - interval '10 minutes' THEN 1 END) as recent_10min
FROM governance_timeout_alerts
WHERE triggered_at > now() - interval '1 hour'
GROUP BY service;
```

---

## Rollback Command (If Needed)

### EMERGENCY: Disable Feature Immediately

```sql
-- Run this to instantly disable timeout governance
UPDATE deployment_feature_flags
SET enabled = false, override_enabled = true, override_value = false
WHERE feature_name = 'timeout-governance-ccip-20260204';

-- Verify it's disabled (should show false)
SELECT enabled FROM deployment_feature_flags
WHERE feature_name = 'timeout-governance-ccip-20260204';

-- Log the rollback
INSERT INTO deployment_verification_results (
  stage_number, verification_type, checks_passed, checks_failed, checks_total,
  critical_failures, verification_details
) VALUES (
  2, 'rollback'::text, 0, 1, 1, true,
  jsonb_build_object('reason', 'Emergency rollback from Stage 2 - critical metrics', 'timestamp', now())
);
```

**Effect**: Feature immediately disabled globally, old code path used

---

## 30-Minute Check Log Template

```
Time: [HH:MM]
Stage: 2 (Canary 25%)
Duration So Far: [XX hours]

Overall Health: ✅ GOOD / ⚠️ WARNING / ❌ CRITICAL
Success Rate: XX%
Circuit Breaker: XX%
Recent Alerts: XX

Notable Changes:
- [Change 1]
- [Change 2]

Action Taken:
- Continue monitoring / Investigate / Rollback

Next Check: [Time +30 min]
```

---

## What to Do At Each Milestone

### Hour 1-2 (0-120 min)
- Check every 30 minutes
- System still stabilizing
- Some variability expected
- Success rate should approach 90%+

### Hour 2-4 (120-240 min)
- Check every 45 minutes
- System should stabilize
- Success rate should be steady 90-95%
- Circuit breaker < 1%

### Hour 4-6 (240-360 min)
- Check every 60 minutes
- Metrics should be consistent
- Verify trend is stable, not degrading
- Prepare Stage 3 approval if all good

### Hour 6-8 (360-480 min)
- Final comprehensive check
- 24-hour baseline established
- Decision: Proceed to Stage 3 or investigate further

---

## Success Criteria Verification (After 6-8 Hours)

Before advancing to Stage 3, all of these must be true:

```sql
-- Check 1: Success rate stable at 90%+
SELECT
  CASE
    WHEN MIN(success_rate) >= 90 THEN 'PASS'
    ELSE 'FAIL: ' || MIN(success_rate)
  END
FROM (
  SELECT
    ROUND(COUNT(CASE WHEN success = true THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as success_rate
  FROM timeout_event_metrics
  WHERE event_timestamp > now() - interval '2 hours'
);

-- Check 2: No cascading failures
SELECT
  CASE
    WHEN COUNT(*) = 0 THEN 'PASS: No cascades detected'
    ELSE 'FAIL: ' || COUNT(*) || ' potential cascades'
  END
FROM timeout_event_metrics
WHERE failure_reason LIKE '%cascade%' AND event_timestamp > now() - interval '8 hours';

-- Check 3: Circuit breaker < 1%
SELECT
  CASE
    WHEN SUM(CASE WHEN breaker_pct > 1 THEN 1 ELSE 0 END) = 0
    THEN 'PASS: All services < 1%'
    ELSE 'FAIL: Some services > 1%'
  END
FROM (
  SELECT
    service,
    ROUND(COUNT(CASE WHEN failure_reason LIKE '%circuit breaker%' THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as breaker_pct
  FROM timeout_event_metrics
  WHERE event_timestamp > now() - interval '8 hours'
  GROUP BY service
) metrics;
```

All PASS → **Ready for Stage 3**
Any FAIL → **Investigate or Hold in Stage 2**

---

## Quick Reference: All Monitoring Queries

Save this section and run queries as needed:

```sql
-- Quick health check (run this every 30 min)
SELECT * FROM get_timeout_metrics_summary(NULL, 120);

-- Circuit breaker activity
SELECT service, COUNT(*) FROM timeout_event_metrics
WHERE failure_reason LIKE '%circuit breaker%'
  AND event_timestamp > now() - interval '2 hours'
GROUP BY service;

-- Recent alerts
SELECT service, COUNT(*) as alerts FROM governance_timeout_alerts
WHERE triggered_at > now() - interval '1 hour'
GROUP BY service;

-- Retry success by attempt
SELECT retry_attempt, COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) as pct
FROM timeout_event_metrics
WHERE event_timestamp > now() - interval '2 hours'
GROUP BY retry_attempt ORDER BY retry_attempt;
```

---

**IMPORTANT**: Don't over-analyze - metrics will naturally fluctuate. Look for TRENDS, not individual spikes.

**REMEMBER**: If success_rate ever drops below 85%, execute emergency rollback immediately. Don't wait for Stage 3.
