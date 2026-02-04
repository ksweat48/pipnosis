# Timeout Governance Deployment Runbook - CCIP Compliant

**Feature**: Adaptive Timeout + Exponential Backoff + Circuit Breaker System
**Start Date**: 2026-02-04
**CCIP Stage**: Staged Canary Deployment (4 stages over 22+ hours)

---

## Pre-Deployment Checklist

### System Verification
- [ ] All 3 migrations applied successfully
  - [ ] `20260204_create_timeout_governance_infrastructure`
  - [ ] `20260204_create_timeout_logging_rpc`
  - [ ] `20260204_create_ccip_deployment_tracking`
  - [ ] `20260204_create_deployment_verification_system`

- [ ] Code changes compiled without errors
  - [ ] time-constants.ts: SERVICE_TIMEOUTS added
  - [ ] PriceCoordinator: Timeout logic implemented
  - [ ] chart-bulletproofing.ts: Backoff config added
  - [ ] error-handler.ts: Timeout recovery added

- [ ] Database integrity checks passed
  ```sql
  -- Verify timeout_governance_config populated
  SELECT COUNT(*) FROM timeout_governance_config;
  -- Should return: 6 service configurations

  -- Verify RLS policies enabled
  SELECT * FROM timeout_governance_config LIMIT 1;
  -- Should work for service_role only

  -- Verify deployment tracking tables exist
  SELECT COUNT(*) FROM ccip_deployment_stages;
  -- Should return: 4 deployment stages
  ```

### Admin Approvals
- [ ] Engineering Lead: Deployment plan reviewed
- [ ] Database Admin: Migration safety verified
- [ ] DevOps Lead: Monitoring dashboards prepared
- [ ] Product Owner: Canary percentages approved (5%, 25%, 50%, 100%)

---

## Stage-by-Stage Deployment

### STAGE 1: Canary 5% (4-6 hours)

**Objective**: Deploy infrastructure and verify governance logging

**Actions**:
1. Run pre-deployment verification:
   ```sql
   SELECT * FROM run_pre_deployment_verification(1);
   ```

2. Activate Stage 1 deployment:
   ```sql
   UPDATE ccip_deployment_stages
   SET is_active = true, activated_at = now()
   WHERE stage_number = 1;

   -- Mark all Stage 1 changes as verified
   UPDATE ccip_deployment_changes
   SET verification_status = 'verified', verified_at = now()
   WHERE stage_id = (SELECT id FROM ccip_deployment_stages WHERE stage_number = 1);
   ```

3. Enable feature flag for 5% of users:
   ```sql
   UPDATE deployment_feature_flags
   SET enabled = true, stage_number = 1
   WHERE feature_name = 'timeout-governance-ccip-20260204';
   ```

4. Monitor for 4 hours:
   - Watch `governance_change_log` for timeout events
   - Check `timeout_event_metrics` every 30 minutes
   - Alert if success_rate < 90%

**Success Criteria**:
- 0 critical governance violations logged
- Timeout event count stabilizes (< 1 per minute per service)
- No user complaints in error tracking

**Rollback Plan**:
```sql
UPDATE ccip_deployment_stages SET is_active = false WHERE stage_number = 1;
UPDATE deployment_feature_flags SET enabled = false
  WHERE feature_name = 'timeout-governance-ccip-20260204';
```

---

### STAGE 2: Canary 25% (6-8 hours after Stage 1)

**Objective**: Deploy PriceCoordinator timeout logic

**Actions**:
1. Verify Stage 1 completed successfully:
   ```sql
   SELECT * FROM get_timeout_metrics_summary(NULL, 360);
   -- Verify success_rate >= 95%
   ```

2. Run pre-deployment verification for Stage 2:
   ```sql
   SELECT * FROM run_pre_deployment_verification(2);
   ```

3. Deploy PriceCoordinator code (feature flag auto-activates at stage 2)

4. Monitor metrics:
   ```sql
   -- Check success rates by service
   SELECT * FROM get_timeout_metrics_summary(NULL, 120);

   -- Check for circuit breaker activations
   SELECT service, COUNT(*) as breaker_activations
   FROM timeout_event_metrics
   WHERE failure_reason LIKE '%circuit breaker%'
     AND event_timestamp > now() - interval '2 hours'
   GROUP BY service;
   ```

5. Watch dashboards:
   - Query latency (should stay stable or improve)
   - AbortError rate (should decrease 70-80%)
   - Timeout event frequency (should spike initially, then stabilize)

**Success Criteria**:
- Success rate stays >= 90% for all services
- No cascading failures detected
- User impact minimal (< 0.1% of requests affected)

**Rollback Plan**:
```sql
-- Disable feature flag and revert PriceCoordinator code
UPDATE deployment_feature_flags SET enabled = false
  WHERE feature_name = 'timeout-governance-ccip-20260204';
-- Wait for canary percentage to naturally decrease to 0%
-- Then proceed with manual rollback of code changes
```

---

### STAGE 3: Canary 50% (8+ hours after Stage 2)

**Objective**: Deploy chart-bulletproofing and error-handler updates

**Actions**:
1. Verify Stage 2 success metrics:
   ```sql
   SELECT * FROM get_timeout_metrics_summary(NULL, 480);
   -- Should show sustained 95%+ success rate
   ```

2. Run verification for Stage 3:
   ```sql
   SELECT * FROM run_pre_deployment_verification(3);
   ```

3. Deploy code changes (auto-activate at stage 3)

4. Monitor for backoff strategy effectiveness:
   ```sql
   -- Check retry distributions
   SELECT service, retry_attempt, COUNT(*) as count
   FROM timeout_event_metrics
   WHERE event_timestamp > now() - interval '4 hours'
   GROUP BY service, retry_attempt
   ORDER BY service, retry_attempt;
   ```

**Success Criteria**:
- Retry success rates show exponential backoff working
- Circuit breaker activations < 1% of requests
- No increased user complaints

---

### STAGE 4: Full Rollout (24+ hours after Stage 1)

**Objective**: Complete deployment to 100% of users

**Actions**:
1. Final verification:
   ```sql
   SELECT * FROM get_timeout_metrics_summary(NULL, 1440);
   -- Verify 24-hour baseline stability
   ```

2. Activate Stage 4:
   ```sql
   UPDATE ccip_deployment_stages
   SET is_active = true, activated_at = now()
   WHERE stage_number = 4;
   ```

3. Update feature flag to full rollout:
   ```sql
   UPDATE deployment_feature_flags
   SET stage_number = 4
   WHERE feature_name = 'timeout-governance-ccip-20260204';
   ```

4. Continue monitoring for 24+ hours with full traffic

**Success Criteria**:
- All metrics stable at 95%+ success rates
- Circuit breaker activations minimal
- Zero critical incidents

---

## Monitoring & Observability

### Admin Dashboard Queries

```sql
-- Current deployment stage
SELECT * FROM get_current_deployment_stage();

-- Timeout metrics by service (last hour)
SELECT * FROM get_timeout_metrics_summary(NULL, 60);

-- Governance change log (timeout events only)
SELECT
  entity_type,
  operation,
  timeout_context,
  created_at
FROM governance_change_log
WHERE operation = 'timeout_event'
  AND created_at > now() - interval '1 hour'
ORDER BY created_at DESC;

-- Timeout governance alerts
SELECT service, timeout_percentage, threshold, triggered_at
FROM governance_timeout_alerts
WHERE triggered_at > now() - interval '24 hours'
ORDER BY triggered_at DESC;

-- Deployment verification results
SELECT stage_number, verification_type, checks_passed, checks_failed,
       checks_total, critical_failures, verification_time
FROM deployment_verification_results
ORDER BY verification_time DESC;
```

### Alert Thresholds

**CRITICAL** (Immediate Rollback):
- Any service success_rate < 85%
- Circuit breaker active for > 30 seconds
- Governance verification fails with critical_failures = true

**WARNING** (Investigation Required):
- Any service success_rate < 90%
- > 10 timeout events per minute per service
- Circuit breaker activations > 5% of requests

**INFO** (Monitor Only):
- Timeout events occurring (expected during deployment)
- Backoff delays increasing (expected retry behavior)

---

## Rollback Procedures

### Quick Rollback (Any Stage)

```sql
-- 1. Disable feature flag immediately
UPDATE deployment_feature_flags
SET enabled = false, override_enabled = true, override_value = false
WHERE feature_name = 'timeout-governance-ccip-20260204';

-- 2. Mark current stage as inactive
UPDATE ccip_deployment_stages
SET is_active = false
WHERE is_active = true;

-- 3. Log rollback to governance system
INSERT INTO governance_change_log (
  entity_type, entity_id, operation, reason
) VALUES (
  'deployment_feature_flags',
  (SELECT id FROM deployment_feature_flags
   WHERE feature_name = 'timeout-governance-ccip-20260204'),
  'feature_disable',
  'Emergency rollback due to performance degradation'
);
```

### Full Rollback (Code Changes)

```sql
-- 1. Revert PriceCoordinator code to previous version
-- 2. Revert chart-bulletproofing changes
-- 3. Revert error-handler changes

-- 4. Clear metrics and feature flags
DELETE FROM timeout_event_metrics
WHERE created_at > (SELECT activated_at FROM ccip_deployment_stages WHERE stage_number = 1);

UPDATE deployment_feature_flags SET enabled = false;

-- 5. Restart service to reset circuit breaker state
```

---

## Post-Deployment Verification

### 24 Hours After Stage 4

```sql
-- Validate all success metrics
SELECT
  service,
  success_rate,
  CASE
    WHEN success_rate >= 95 THEN 'EXCELLENT'
    WHEN success_rate >= 90 THEN 'GOOD'
    WHEN success_rate >= 85 THEN 'ACCEPTABLE'
    ELSE 'NEEDS_INVESTIGATION'
  END as health_status
FROM (
  SELECT
    service,
    ROUND(COUNT(CASE WHEN success = true THEN 1 END)::numeric /
           NULLIF(COUNT(*)::numeric, 0) * 100, 2) as success_rate
  FROM timeout_event_metrics
  WHERE event_timestamp > now() - interval '24 hours'
  GROUP BY service
) metrics
ORDER BY service;

-- Compare pre/post deployment metrics
-- Should show:
-- - AbortError rate down 70-80%
-- - Query latency stable or improved
-- - Circuit breaker activations minimal
-- - No cascading failures
```

---

## CCIP Compliance Checklist

- [ ] All changes logged to governance_change_log
- [ ] Deployment stages tracked in ccip_deployment_stages
- [ ] Verification results stored in deployment_verification_results
- [ ] Feature flags respect current deployment stage
- [ ] Rollback capability documented and tested
- [ ] Admin override mechanism functional
- [ ] RLS policies enforced on all new tables
- [ ] Audit trail complete for compliance audits

---

## Support & Escalation

**Deployment Leader**: [Name] - Contact for go/no-go decisions
**Database Admin**: [Name] - Contact for migration issues
**DevOps Lead**: [Name] - Contact for monitoring/alerting
**Engineering Lead**: [Name] - Contact for code rollback

**Escalation**: If success_rate < 85% at any time, initiate rollback without waiting for stage completion.
