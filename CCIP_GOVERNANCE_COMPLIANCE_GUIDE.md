# CCIP & Governance Compliance Guide

## Status: IMPLEMENTED ✅

**Last Updated:** January 21, 2026
**System Version:** 1.0.0
**Compliance Level:** Mandatory for all code changes

---

## Overview

The **Change Control Intelligence Protocol (CCIP)** is Pipnosis's mandatory framework for managing all code, infrastructure, and configuration changes. This document provides the complete workflow for CCIP-compliant changes.

---

## CCIP Architecture

### Core Principle
**If a problem can be fixed in more than one place, the architecture is broken.**

All changes must:
- Maintain Single Source of Truth (SSOT)
- Follow the six-stage CCIP process
- Receive governance approval
- Be fully documented and auditable

---

## The Six CCIP Stages

### Stage 1: System Map (5-10 minutes)

**Purpose:** Document all affected components before making any changes.

**Required Actions:**
1. List every file/service/table that will be modified
2. Identify dependencies and side effects
3. Assess risk level for each component
4. Document potential cascading impacts

**Database Records:**
```sql
-- Record affected components
INSERT INTO ccip_system_map (change_id, component_type, component_name, file_path, change_impact, risk_level, risk_description)
VALUES (
  'change-request-id',
  'database', -- frontend, backend, database, api, service, config
  'trigger_continuation_modal',
  'supabase/functions/trigger_continuation_modal',
  'modify', -- create, modify, delete, refactor
  'high', -- low, medium, high, critical
  'Changes core timeout logic affecting all active sessions'
);
```

**Example System Map:**
```
AFFECTED COMPONENTS:
├── Database
│   ├── trigger_continuation_modal function [MODIFY - HIGH RISK]
│   ├── goal_notifications table [MODIFY - MEDIUM RISK]
│   └── goal_sessions.awaiting_continuation_since [READ - LOW RISK]
├── Frontend
│   ├── PendingContinuationModalHandler.tsx [NO CHANGE - depends on DB]
│   └── SessionContinuationModal.tsx [NO CHANGE - displays modal]
└── Backend
    └── continuation-handler.ts [NO CHANGE - calls RPC]
```

---

### Stage 2: Logic Contract (5-10 minutes)

**Purpose:** Define exact behavior changes with formal specifications.

**Required Actions:**
1. Document OLD behavior (what currently happens)
2. Document NEW behavior (what should happen)
3. List edge cases and expected outcomes
4. Define acceptance criteria

**Database Records:**
```sql
INSERT INTO ccip_logic_contracts (change_id, contract_name, old_behavior, new_behavior, edge_cases, acceptance_criteria)
VALUES (
  'change-request-id',
  'Continuation Modal Timeout Check',
  'Function checks goal_trades table for records > 15 minutes old',
  'Function checks goal_session_trades table for records > 60 minutes old',
  '[
    {"scenario": "Session with open trade at 59 minutes", "expected": "No modal"},
    {"scenario": "Session with open trade at 61 minutes", "expected": "Modal triggered"},
    {"scenario": "Session with no trades", "expected": "No modal, handled by separate timeout"}
  ]'::jsonb,
  ARRAY[
    'Modal appears at exactly 60 minutes (not 15)',
    'Function queries goal_session_trades (not goal_trades)',
    'Existing modals updated with correct timeout message',
    'No sessions stuck in awaiting_continuation'
  ]
);
```

---

### Stage 3: Dry-Run Simulation (10-15 minutes)

**Purpose:** Test changes before production deployment.

**Required Actions:**
1. Export affected production data
2. Create local/staging copy
3. Apply migration to copy
4. Verify results match expectations
5. Document any surprises or adjustments needed

**Simulation Script Example:**
```sql
-- Export current state
COPY (SELECT * FROM goal_notifications WHERE type = 'continuation_modal') TO '/tmp/notifications_backup.csv';

-- Test on copy (local/staging)
BEGIN;
  -- Apply your changes
  UPDATE goal_notifications SET message = 'New message' WHERE type = 'continuation_modal';

  -- Verify results
  SELECT COUNT(*), type FROM goal_notifications GROUP BY type;

  -- If satisfied, COMMIT. Otherwise, ROLLBACK.
COMMIT;
```

**Database Records:**
```sql
INSERT INTO ccip_test_results (change_id, test_type, test_environment, passed, records_affected, notes)
VALUES (
  'change-request-id',
  'migration_dry_run',
  'local',
  true,
  74,
  'Tested on copy of production data. All 74 notification records updated correctly. Function now queries goal_session_trades successfully.'
);
```

---

### Stage 4: Compatibility Check (5-10 minutes)

**Purpose:** Verify change won't break existing systems.

**Required Actions:**
1. Check active sessions impact
2. Verify no breaking changes to API contracts
3. Test backward compatibility
4. Identify systems that need updates
5. Plan coordinated deployment if needed

**Checklist:**
- [ ] Active sessions won't be disrupted
- [ ] Frontend can handle new backend behavior
- [ ] Database constraints satisfied
- [ ] No orphaned data created
- [ ] External integrations unaffected

---

### Stage 5: Staged Deployment (10-30 minutes)

**Purpose:** Roll out changes gradually to minimize blast radius.

**Deployment Strategy:**

**For Critical Changes (Hotfixes):**
1. Deploy to internal/admin users (5%)
2. Monitor for 15 minutes
3. Deploy to 25% of users
4. Monitor for 30 minutes
5. Deploy to 100%

**For Standard Changes:**
1. Deploy to dev environment
2. Deploy to staging environment
3. Deploy to production (canary - 10%)
4. Deploy to production (50%)
5. Deploy to production (100%)

**Emergency Bypass:**
If time-critical (production down, critical bug):
- Deploy directly to production
- Mark as `emergency_bypass` in CCIP
- Schedule retrospective review within 24 hours

**Database Records:**
```sql
INSERT INTO ccip_deployment_log (change_id, stage_order, stage_name, deployed, deployed_at, health_check_passed, notes)
VALUES
  ('change-request-id', 1, 'Production', true, now(), true, 'Emergency deployment - users experiencing stuck sessions');
```

---

### Stage 6: Post-Deploy Verification (24-48 hours)

**Purpose:** Confirm changes work correctly in production.

**Required Actions:**
1. Monitor key metrics
2. Watch for errors in logs
3. Verify user feedback
4. Check data integrity
5. Confirm rollback readiness

**Verification Checklist:**
```sql
INSERT INTO ccip_verification_log (change_id, check_type, check_name, status, result_details)
VALUES
  ('change-request-id', 'functionality', 'Modal Display Test', 'passed', 'Verified continuation modals display at 60min'),
  ('change-request-id', 'data_integrity', 'No Stuck Sessions', 'passed', 'Zero sessions stuck in awaiting_continuation after 24 hours'),
  ('change-request-id', 'performance', 'SL/TP Accuracy', 'passed', 'Stop loss and take profit triggers functioning normally');
```

**Monitoring Duration:**
- Low-risk changes: 24 hours
- Medium-risk changes: 48 hours
- High-risk/critical changes: 72 hours
- Database schema changes: 1 week

---

## Governance Workflow

### Approval Requirements

**Change Type → Required Approval:**
- Emergency hotfix: Post-deployment retrospective
- Critical priority: Admin + Technical Lead
- High priority: Technical Lead
- Medium/Low priority: Peer review

### Approval Process

```sql
-- Request approval
INSERT INTO ccip_change_requests (change_title, change_type, priority, description, ...)
VALUES ('Fix timeout system', 'hotfix', 'critical', 'Users stuck after 60min', ...);

-- Admin approves
INSERT INTO ccip_approvals (change_id, approver_role, decision, comments)
VALUES ('change-request-id', 'admin', 'approved', 'Emergency fix approved - deploy immediately');

-- Update governance status
UPDATE ccip_change_requests
SET governance_status = 'approved', approved_at = now()
WHERE id = 'change-request-id';
```

---

## Emergency CCIP Bypass Protocol

### When to Use
- Production is completely down
- Critical security vulnerability
- Data loss in progress
- Users cannot trade (financial impact)

### Minimum Requirements (Even in Emergencies)
1. **Quick System Map** (2 minutes): List what you're changing
2. **One-Line Contract** (1 minute): "OLD: X breaks | NEW: X fixed"
3. **Deployment Note** (1 minute): Document what was deployed and when

### Post-Emergency Actions (Within 24 Hours)
1. Create full retrospective CCIP entry
2. Document what should have been done
3. Schedule team review
4. Update runbooks/playbooks

```sql
-- Mark as emergency bypass
UPDATE ccip_change_requests
SET
  ccip_status = 'emergency_bypass',
  ccip_bypass_reason = 'Production emergency - users experiencing stuck sessions',
  governance_status = 'retrospective_review'
WHERE id = 'change-request-id';
```

---

## Compliance Scoring

### CCIP Compliance Score Calculation

```
Score = (Completed Stages / 6) × 100

Example:
- 6/6 stages: 100% (Full Compliance)
- 4/6 stages: 67% (Partial Compliance)
- 0/6 stages: 0% (Emergency Bypass)
```

### Governance Compliance Grades

| Score | Grade | Status |
|-------|-------|--------|
| 100% | A+ | Excellent - Full CCIP compliance |
| 90-99% | A | Good - Minor shortcuts taken |
| 75-89% | B | Acceptable - Some stages skipped |
| 50-74% | C | Poor - Major shortcuts taken |
| 25-49% | D | Critical - CCIP largely ignored |
| 0-24% | F | Failure - Emergency bypass required |

---

## Practical Examples

### Example 1: Full CCIP Compliance

**Scenario:** Add new "dark mode" feature

```bash
# Stage 1: System Map (7 minutes)
- Frontend: ThemeProvider, Settings page, Header component
- Config: theme-config.ts
- Database: Add user_preferences.dark_mode_enabled column
- Risk: Low (new feature, no existing behavior changes)

# Stage 2: Logic Contract (5 minutes)
- OLD: Light mode only
- NEW: User can toggle dark mode, preference saved
- Edge Cases: First-time users default to light, preference persists across sessions

# Stage 3: Dry-Run Simulation (12 minutes)
- Created feature branch
- Added migration locally
- Tested in dev environment
- All tests passing

# Stage 4: Compatibility Check (6 minutes)
- No breaking changes
- Gracefully degrades if preference not set
- Works in all browsers

# Stage 5: Staged Deployment (25 minutes)
- Deployed to staging: ✓
- Deployed to 10% production: ✓ (monitored 15min)
- Deployed to 100% production: ✓

# Stage 6: Post-Deploy Verification (48 hours)
- User feedback: Positive
- Error rate: No increase
- Performance: No degradation
- Data integrity: All preferences saving correctly

# Result: 100% CCIP Compliance, A+ Grade
```

---

### Example 2: Emergency Bypass (Recent Fix)

**Scenario:** Continuation modal checking wrong table

```bash
# Emergency Context:
- Production issue: Users stuck after 60 minutes
- Financial impact: Users cannot continue trading
- Time pressure: Immediate fix required

# Minimum Emergency CCIP (4 minutes):
1. Quick Map: "trigger_continuation_modal function, goal_notifications table"
2. Quick Contract: "OLD: queries goal_trades | NEW: queries goal_session_trades"
3. Deploy Note: "Applied migration 20260121205303, updated 74 records, deployed via Netlify hook"

# Post-Emergency (Within 24 hours):
✓ Created full CCIP retrospective entry
✓ Documented all skipped stages
✓ Added verification checklist
✓ Scheduled 48-hour monitoring
✓ Updated this compliance guide

# Result: 0% CCIP Compliance (emergency bypass), Retrospective Review Required
```

---

## Quick Reference Commands

### Create New Change Request
```sql
INSERT INTO ccip_change_requests (change_title, change_type, priority, description, business_justification)
VALUES ('Your change title', 'feature', 'medium', 'Description', 'Why needed');
```

### Mark Stage Complete
```sql
UPDATE ccip_stage_completions
SET completed = true, completed_at = now(), notes = 'Stage completion notes'
WHERE change_id = 'your-id' AND stage_name = 'system_map';
```

### Calculate Compliance Score
```sql
SELECT calculate_ccip_score('your-change-id');
```

### Get Compliance Summary
```sql
SELECT * FROM get_ccip_summary();
```

### View Your Recent Changes
```sql
SELECT
  change_title,
  change_type,
  ccip_status,
  ccip_score,
  governance_status,
  deployed_at
FROM ccip_change_requests
WHERE created_at > now() - interval '7 days'
ORDER BY created_at DESC;
```

---

## Integration with Development Workflow

### Pre-Commit Checklist
- [ ] Created CCIP change request
- [ ] Completed system map
- [ ] Defined logic contract
- [ ] Ran local tests (dry-run simulation)

### Pre-Merge Checklist
- [ ] All 6 CCIP stages completed OR emergency bypass justified
- [ ] Governance approval obtained
- [ ] Compliance score calculated
- [ ] Rollback plan documented

### Post-Deploy Checklist
- [ ] Verification checks scheduled
- [ ] Monitoring alerts configured
- [ ] Team notified of changes
- [ ] Documentation updated

---

## Team Responsibilities

### Developers
- Create CCIP requests for all changes
- Complete required stages before deployment
- Document emergency bypasses immediately after resolution

### Technical Leads
- Review CCIP requests
- Approve medium/high priority changes
- Ensure team follows protocol

### Admins
- Approve critical changes
- Monitor compliance scores
- Conduct retrospective reviews for emergency bypasses

---

## Monitoring & Reporting

### Daily Compliance Dashboard
```sql
SELECT
  COUNT(*) as total_changes,
  COUNT(*) FILTER (WHERE ccip_score = 100) as fully_compliant,
  COUNT(*) FILTER (WHERE ccip_status = 'emergency_bypass') as bypasses,
  ROUND(AVG(ccip_score), 2) as avg_compliance
FROM ccip_change_requests
WHERE created_at > current_date - interval '30 days';
```

### Weekly Compliance Report
- Total changes deployed
- Average CCIP compliance score
- Number of emergency bypasses
- Outstanding retrospective reviews
- Top compliance issues

---

## Continuous Improvement

### Quarterly Review
- Analyze compliance trends
- Update CCIP process based on feedback
- Celebrate high compliance achievements
- Address persistent non-compliance patterns

### Success Metrics
- Target: 90%+ average CCIP compliance score
- Target: <10% emergency bypasses
- Target: All retrospectives completed within 48 hours
- Target: Zero repeat violations of same SSOT principle

---

## Conclusion

CCIP compliance is not optional. It ensures:
- **Quality:** Changes are thoroughly tested
- **Safety:** Production impact is minimized
- **Accountability:** All changes are documented
- **Learning:** Team learns from both successes and emergencies

**Remember:** The few minutes spent on CCIP upfront save hours of debugging and fixing architectural mistakes later.

---

## Appendix: Database Schema

See migration `create_ccip_change_tracking_system_fixed.sql` for complete schema.

**Key Tables:**
- `ccip_change_requests` - Master change tracking
- `ccip_stage_completions` - Six-stage progress
- `ccip_system_map` - Affected components
- `ccip_logic_contracts` - Behavior specifications
- `ccip_test_results` - Test outcomes
- `ccip_deployment_log` - Deployment history
- `ccip_verification_log` - Post-deploy checks
- `ccip_approvals` - Governance approvals

**Key Functions:**
- `calculate_ccip_score(change_id)` - Calculate compliance score
- `get_ccip_summary()` - Get 30-day summary

---

**END OF DOCUMENT**
