# CCIP: Omega Conflict Detection Enhancement

**Date**: 2026-02-14
**Tier**: Tier 3 - Critical Intelligence Pipeline Fix
**SSOT Violation**: Yes - Conflict detection disconnected from learning system
**Breaking Change**: No
**Deployment Strategy**: Single atomic deployment (code + migration)

---

## 1. System Map: Current State vs. Intended State

### Current State (BROKEN)

```
┌─────────────────────────────────────────────────────────────────┐
│ alpha-omega-orchestrator.ts                                     │
│                                                                  │
│ detectOmegaConflicts() {                                        │
│   return {                                                      │
│     hasConflict: true,                                          │
│     conflictType: 'HARD',                                       │
│     severity: 'HIGH',                                           │
│     conflictDescription: "...",                                 │
│     confidencePenalty: 0.75                                     │
│   }                                                             │
│ }                                                               │
│                                                                  │
│ // ❌ Conflict data NOT attached to decision                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ goal-session-live-engine.ts                                     │
│                                                                  │
│ alphaLearningTracker.logDecision(                               │
│   userId,                                                       │
│   decision,  // ❌ No conflict data in decision                │
│   omegaVotes,                                                   │
│   omegaConsensus,                                               │
│   {                                                             │
│     detected: false,  // ❌ HARDCODED                          │
│     type: 'NONE'      // ❌ HARDCODED                          │
│   }                                                             │
│ )                                                               │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Database: alpha_decisions                                       │
│                                                                  │
│ conflict_detected = false  ← Always false                       │
│ conflict_type = 'NONE'     ← Always 'NONE'                     │
│ override_reason = NULL     ← Never populated                    │
│                                                                  │
│ ❌ Learning system NEVER sees actual conflicts                 │
│ ❌ Alpha cannot learn from conflict scenarios                  │
└─────────────────────────────────────────────────────────────────┘
```

### Intended State (FIXED)

```
┌─────────────────────────────────────────────────────────────────┐
│ alpha-omega-orchestrator.ts                                     │
│                                                                  │
│ const conflictCheck = detectOmegaConflicts(...)                 │
│                                                                  │
│ const alphaDecision = await alphaCoordinator(...)               │
│                                                                  │
│ // ✅ ATTACH conflict data to decision (SSOT)                  │
│ alphaDecision.conflictInfo = {                                  │
│   detected: conflictCheck.hasConflict,                          │
│   type: conflictCheck.conflictType,                             │
│   severity: conflictCheck.severity,                             │
│   description: conflictCheck.conflictDescription,               │
│   penalty: conflictCheck.confidencePenalty                      │
│ }                                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ goal-session-live-engine.ts                                     │
│                                                                  │
│ // ✅ EXTRACT real conflict data from decision                 │
│ const conflictInfo = decision.conflictInfo || {                 │
│   detected: false,                                              │
│   type: 'NONE'                                                  │
│ }                                                               │
│                                                                  │
│ alphaLearningTracker.logDecision(                               │
│   userId,                                                       │
│   decision,                                                     │
│   omegaVotes,                                                   │
│   omegaConsensus,                                               │
│   conflictInfo  // ✅ Real data from orchestrator              │
│ )                                                               │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ Database: alpha_decisions                                       │
│                                                                  │
│ conflict_detected = TRUE   ← Real data                          │
│ conflict_type = 'HARD'     ← Real data                         │
│ override_reason = "..."    ← Real explanation                   │
│                                                                  │
│ ✅ Learning system sees actual conflicts                       │
│ ✅ Alpha learns when overrides succeed vs. fail                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Logic Contract

### SSOT Authority
- **Orchestrator** (`alpha-omega-orchestrator.ts`) is the SSOT for conflict detection
- **Learning Tracker** (`alpha-learning-tracker.ts`) is the SSOT for decision history
- **No other component** may detect or log conflicts

### Data Flow Contract
```
Orchestrator.detectOmegaConflicts()
  → Attach to AlphaDecision object
  → Pass through decision pipeline
  → Extract in goal-session-live-engine
  → Log to alpha_decisions table
```

### Type Safety Contract
```typescript
interface ConflictInfo {
  detected: boolean;
  type: 'HARD' | 'SOFT' | 'NONE';
  severity?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  description?: string;
  penalty?: number; // Confidence multiplier applied
}

interface AlphaDecision {
  // ... existing fields ...
  conflictInfo?: ConflictInfo; // NEW: Attached by orchestrator
}
```

### Backward Compatibility
- `conflictInfo` is **optional** on `AlphaDecision`
- Default fallback: `{ detected: false, type: 'NONE' }`
- Existing code paths continue to work
- No breaking changes to function signatures

---

## 3. Dry-Run Simulation

### Test Case 1: HARD Conflict (Trend BUY vs OrderFlow SELL)
```
Input:
  - Trend: BUY @ 85%
  - OrderFlow: SELL @ 90%
  - Alpha decides: BUY

Expected Flow:
  1. Orchestrator detects HARD conflict
  2. Applies 0.75x penalty → confidence drops 85% → 64%
  3. Attaches conflictInfo to decision
  4. Learning tracker logs:
     - conflict_detected = TRUE
     - conflict_type = 'HARD'
     - override_reason = "Alpha followed Trend (BUY) against OrderFlow (SELL)"
  5. Database row created with real conflict data

Verification Query:
  SELECT conflict_detected, conflict_type, override_reason
  FROM alpha_decisions
  WHERE action = 'BUY' AND conflict_detected = TRUE;
```

### Test Case 2: SOFT Conflict (Low confidence disagreement)
```
Input:
  - Scalper: BUY @ 55%
  - Reversal: SELL @ 60%
  - Alpha decides: BUY

Expected Flow:
  1. Orchestrator detects SOFT conflict
  2. Applies 0.90x penalty → confidence drops slightly
  3. Attaches conflictInfo with severity = 'LOW'
  4. Learning tracker logs soft conflict
  5. Database row tracks low-severity conflict

Verification:
  SELECT confidence, conflict_type, conflict_detected
  FROM alpha_decisions
  WHERE conflict_type = 'SOFT';
```

### Test Case 3: NO Conflict (Unanimous)
```
Input:
  - All Omegas: BUY (unanimous)
  - Alpha decides: BUY

Expected Flow:
  1. Orchestrator: hasConflict = false
  2. conflictInfo = { detected: false, type: 'NONE' }
  3. Learning tracker logs: conflict_detected = FALSE
  4. Database row shows no conflict

Verification:
  SELECT COUNT(*) FROM alpha_decisions
  WHERE conflict_detected = FALSE;
```

---

## 4. Compatibility Check

### File Impact Analysis
| File | Change Type | Risk | Breaking |
|------|-------------|------|----------|
| `src/types/alpha-thesis.ts` | Add `ConflictInfo` type | LOW | NO |
| `src/brains/coordinator-alpha.ts` | Add `conflictInfo?` to `AlphaDecision` | LOW | NO |
| `src/services/alpha-omega-orchestrator.ts` | Attach conflict data | MEDIUM | NO |
| `src/services/goal-session-live-engine.ts` | Extract real conflict data | MEDIUM | NO |
| `supabase/migrations/...` | Governance tracking | LOW | NO |

### Dependency Analysis
- ✅ No external API changes
- ✅ No database schema changes (columns already exist)
- ✅ No breaking type changes (all fields optional)
- ✅ Backward compatible with existing code

### Runtime Safety
- Orchestrator continues to work if decision object unchanged
- Learning tracker has fallback for missing conflictInfo
- Database accepts NULL values for conflict fields
- No risk of null pointer exceptions

---

## 5. Staged Deployment

### Deployment Strategy: **Single Atomic Push**

This change is **low-risk** and can be deployed atomically because:
1. No schema changes (columns exist)
2. No breaking changes (all optional fields)
3. Single-direction data flow (no circular dependencies)
4. Fallback behavior preserves existing functionality

### Deployment Steps
```bash
# 1. Deploy code changes
git add .
git commit -m "CCIP: Wire Omega conflict detection to Alpha learning system"

# 2. Apply governance migration
supabase db push

# 3. Verify deployment
npm run build
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca

# 4. Monitor first 10 decisions post-deploy
SELECT conflict_detected, conflict_type, created_at
FROM alpha_decisions
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 10;
```

### Rollback Plan
If issues arise:
```sql
-- Emergency rollback: Does nothing (no schema changes)
-- Code rollback: git revert commit hash
```

---

## 6. Post-Deploy Verification

### Verification Queries

#### 6.1 Confirm Conflict Detection Active
```sql
-- Should return TRUE for decisions with actual conflicts
SELECT
  symbol,
  action,
  confidence,
  conflict_detected,
  conflict_type,
  override_reason,
  created_at
FROM alpha_decisions
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND conflict_detected = TRUE
ORDER BY created_at DESC
LIMIT 20;
```

#### 6.2 Verify Conflict Type Distribution
```sql
SELECT
  conflict_type,
  COUNT(*) as count,
  AVG(confidence) as avg_confidence,
  COUNT(CASE WHEN alpha_override THEN 1 END) as override_count
FROM alpha_decisions
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY conflict_type;

-- Expected distribution:
-- NONE: 60-70% (most decisions have consensus)
-- SOFT: 20-30% (minor disagreements)
-- HARD: 5-10%  (major conflicts)
```

#### 6.3 Learning System Integrity
```sql
-- Verify override_reason is populated when Alpha overrides
SELECT
  action,
  alpha_override,
  override_reason,
  conflict_detected
FROM alpha_decisions
WHERE alpha_override = TRUE
  AND created_at > NOW() - INTERVAL '24 hours';

-- Should return rows with non-null override_reason
```

#### 6.4 Data Flow Verification
```sql
-- Confirm no more hardcoded FALSE values
SELECT COUNT(*) as should_be_zero
FROM alpha_decisions
WHERE created_at > NOW() - INTERVAL '1 hour'
  AND conflict_detected = FALSE
  AND conflict_type = 'NONE';

-- If this count is 100%, deployment failed (still hardcoded)
-- If this count is <100%, deployment succeeded (real data flowing)
```

### Success Criteria
- ✅ `conflict_detected = TRUE` appears in logs
- ✅ `conflict_type` has values other than 'NONE'
- ✅ `override_reason` is populated when alpha_override = TRUE
- ✅ No errors in console logs
- ✅ Learning system receives conflict data for first time

### Monitoring
```typescript
// Add to goal-session-live-engine.ts after logDecision
if (decisionId) {
  console.log(`[CONFLICT TRACKING] Decision ${decisionId}:`);
  console.log(`  Conflict Detected: ${conflictInfo.detected}`);
  console.log(`  Conflict Type: ${conflictInfo.type}`);
  if (conflictInfo.description) {
    console.log(`  Description: ${conflictInfo.description}`);
  }
}
```

---

## 7. Governance Compliance

### Change Classification
- **Type**: Intelligence Pipeline Enhancement
- **Scope**: Alpha Learning System
- **Risk**: Low (No schema changes, backward compatible)
- **SSOT Fix**: Yes (Reconnects orchestrator → learning tracker)

### CCIP Tracking
This change will be tracked in `ccip_change_tracking` table:
```sql
INSERT INTO ccip_change_tracking (
  change_type,
  component,
  description,
  risk_level,
  ssot_compliant,
  deployed_at
) VALUES (
  'intelligence_pipeline',
  'omega_conflict_detection',
  'Wire Omega conflict detection to Alpha learning system',
  'low',
  TRUE,
  NOW()
);
```

### Governance Log
```sql
INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  change_type,
  description,
  metadata
) VALUES (
  'alpha_learning_system',
  'conflict_detection_pipeline',
  'ssot_reconnection',
  'Fixed SSOT violation: Omega conflict detection now flows to learning tracker',
  jsonb_build_object(
    'files_changed', ARRAY[
      'src/types/alpha-thesis.ts',
      'src/brains/coordinator-alpha.ts',
      'src/services/alpha-omega-orchestrator.ts',
      'src/services/goal-session-live-engine.ts'
    ],
    'breaking_change', FALSE,
    'schema_change', FALSE,
    'ccip_compliant', TRUE
  )
);
```

---

## Expected Outcomes

### Immediate Benefits
1. **Learning System Activation**: Alpha can finally learn from conflict scenarios
2. **Populated Database Columns**: `conflict_detected`, `conflict_type`, `override_reason` now have real data
3. **Override Analysis**: Can analyze when Alpha's overrides succeed vs. fail
4. **Conflict Pattern Recognition**: Can identify which conflict types lead to best outcomes

### Long-Term Benefits
1. **Improved Alpha Calibration**: Alpha learns optimal override strategies
2. **Conflict Resolution Patterns**: Identify which Omega disagreements are most predictive
3. **Personality Adaptation**: Learn how aggressive vs. conservative traders handle conflicts
4. **Meta-Learning**: Alpha learns when to trust Omega consensus vs. override

### Success Metrics (Week 1)
- At least 10% of decisions have `conflict_detected = TRUE`
- `conflict_type` distribution matches expected pattern (60% NONE, 30% SOFT, 10% HARD)
- `override_reason` populated for all alpha_override cases
- No increase in error rates or trade execution failures

---

## Conclusion

This CCIP enhancement fixes a critical SSOT violation where Omega conflict detection was disconnected from the Alpha learning system. The fix is:

- ✅ **SSOT Compliant**: Orchestrator remains sole conflict detection authority
- ✅ **CCIP Compliant**: Full system map, logic contract, dry-run simulation
- ✅ **Governance Compliant**: Tracked in change logs, non-breaking
- ✅ **Low Risk**: No schema changes, backward compatible, atomic deployment
- ✅ **High Value**: Enables Alpha to learn from conflicts for first time

**Ready for deployment.**
