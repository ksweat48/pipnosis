# PIPNOSIS GOVERNANCE DECISIONS
## SSOT Authority Resolution & Architectural Decisions

**Document Purpose**: Record all critical governance decisions regarding SSOT authority, config conflicts, and architectural changes.

**Last Updated**: 2026-02-02 (Phase 1 Execution)

---

## PHASE 1 CONFIG CONFLICT RESOLUTIONS

### Decision 1: Minimum Confidence Threshold

**Conflict Identified**:
- `alpha-identity.ts`: MINIMUM_TRADE_CONFIDENCE = 60%
- `trading-constants.ts`: CONFIDENCE_THRESHOLDS.MINIMUM_TO_TRADE = 70%

**SSOT Authority Decision**: `alpha-identity.ts` is the SINGLE SOURCE OF TRUTH

**Authoritative Value**: **60%**

**Rationale**:
1. `alpha-identity.ts` is explicitly documented as "Alpha Identity Configuration - Single Source of Truth"
2. Contains detailed reasoning for 60% threshold (allows learning opportunities)
3. `trading-constants.ts` is for general platform constants, not Alpha-specific behavior
4. Alpha's behavioral parameters should live in alpha-identity namespace

**Implementation**:
- `alpha-identity.ts`: MINIMUM_TRADE_CONFIDENCE = 60 (authoritative)
- `trading-constants.ts`: Deprecated CONFIDENCE_THRESHOLDS.MINIMUM_TO_TRADE, added import reference
- All code must import from `ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE`

**Effective Date**: 2026-02-02

---

### Decision 2: Maximum Advisory Penalty

**Conflict Identified**:
- `alpha-identity.ts`: MAX_ADVISORY_PENALTY = 30%
- `alpha-authority.ts`: MAX_ADVISORY_PENALTY_PERCENT = 25%

**SSOT Authority Decision**: `alpha-identity.ts` is the SINGLE SOURCE OF TRUTH

**Authoritative Value**: **30%**

**Rationale**:
1. `alpha-identity.ts` is the designated SSOT for Alpha's behavioral parameters
2. Advisory systems report to Alpha, so penalty limits are Alpha's concern
3. 30% allows advisory systems sufficient influence while preserving Alpha's authority
4. `alpha-authority.ts` is more general authority model, not specific to penalties

**Implementation**:
- `alpha-identity.ts`: MAX_ADVISORY_PENALTY = 30 (authoritative)
- `alpha-authority.ts`: Deprecated MAX_ADVISORY_PENALTY_PERCENT, added import reference
- All advisory systems must import from `ALPHA_IDENTITY.MAX_ADVISORY_PENALTY`

**Effective Date**: 2026-02-02

---

## SSOT HIERARCHY ESTABLISHED

```
alpha-identity.ts (Alpha Behavior SSOT)
├── Minimum Trade Confidence: 60%
├── Maximum Advisory Penalty: 30%
├── EQS Execution Threshold: 40/75
└── Entry Mode Thresholds

trading-constants.ts (Platform Constants SSOT)
├── Risk Percentages
├── Position Sizing
├── Risk-Reward Ratios
└── Session Limits

alpha-authority.ts (Authority Model)
├── Legitimate Block Conditions
├── Authority Enforcement Rules
└── [References alpha-identity.ts for thresholds]
```

**Principle**: When in doubt, Alpha-specific parameters live in `alpha-identity.ts`.

---

## SAFETY-ENFORCER MUTATION POLICY

**Problem Identified**: safety-enforcer.ts had 9 mutation sites that modified Alpha's decisions without re-approval.

**Policy Established**:
1. **Advisory systems MUST NOT mutate Alpha's decisions**
2. Advisory systems return recommendations only
3. If adjustment required, return to Alpha for re-approval
4. Only exception: System integrity failures (impossible geometry, catastrophic R:R)

**Implementation**:
- safety-enforcer.ts converted to pure advisory mode
- Returns penalties/recommendations to Alpha
- Alpha re-evaluates with advisory input
- Mutations logged in audit trail for transparency

**Effective Date**: 2026-02-02

---

## DATABASE DEFAULT VALUE POLICY

**Problem Identified**: DEFAULT 0 values on financial columns masked calculation failures.

**Policy Established**:
1. **No DEFAULT values on financial calculation columns**
2. NULL allowed only when legitimately optional
3. System must fail loudly if calculation missing
4. Counters (close_attempts, consecutive_failures) may have DEFAULT 0

**Prohibited Patterns**:
```sql
-- ❌ PROHIBITED:
profit_loss numeric DEFAULT 0;  -- Masks calculation failures
current_pnl numeric DEFAULT 0;  -- Masks monitor failures
starting_balance numeric DEFAULT 0;  -- Hides initialization bugs
alpha_confidence integer DEFAULT 60;  -- Masks missing scores
```

**Acceptable Patterns**:
```sql
-- ✅ ACCEPTABLE:
consecutive_failures integer NOT NULL DEFAULT 0;  -- Valid counter
close_attempts_count integer NOT NULL DEFAULT 0;  -- Valid counter
current_progress numeric NOT NULL DEFAULT 0;  -- Valid zero state
```

**Effective Date**: 2026-02-02

---

## FOREIGN KEY POLICY

**Problem Identified**: Missing FK constraints allowed orphaned records.

**Policy Established**:
1. **All user_id columns MUST have FK to user_profiles(id)**
2. **All session_id columns MUST have FK to goal_sessions(id)**
3. CASCADE or SET NULL required based on business logic
4. No orphaned records permitted in production

**Implementation**:
- Added FK: goal_session_trades.user_id → user_profiles(id) ON DELETE CASCADE
- Verified no orphaned records before constraint application

**Effective Date**: 2026-02-02

---

## HARDCODED THRESHOLD POLICY

**Problem Identified**: Critical thresholds hardcoded instead of imported from config.

**Policy Established**:
1. **All thresholds MUST be declared in config files**
2. Code must import from config, never hardcode
3. Exception: Universal constants (0, 1, 100 for percentages)
4. Magic numbers flagged by pre-commit hooks

**Examples**:
```typescript
// ❌ PROHIBITED:
if (rr < 0.5) { return { pass: false }; }

// ✅ REQUIRED:
import { TRADING_CONSTANTS } from '@/config/trading-constants';
if (rr < TRADING_CONSTANTS.RISK_REWARD_RATIOS.CATASTROPHIC_THRESHOLD) {
  return { pass: false };
}
```

**Effective Date**: 2026-02-02

---

## CHANGE LOG

| Date | Decision | Authority | Impact |
|------|----------|-----------|--------|
| 2026-02-02 | Min confidence = 60% | alpha-identity.ts | Platform-wide |
| 2026-02-02 | Max advisory penalty = 30% | alpha-identity.ts | All advisory systems |
| 2026-02-02 | No DEFAULT 0 on financial columns | Database policy | All migrations |
| 2026-02-02 | Mandatory FKs for user_id/session_id | Database policy | Referential integrity |
| 2026-02-02 | Safety-enforcer = advisory only | Alpha authority | Execution pipeline |
| 2026-02-02 | All thresholds in config | SSOT policy | All code |

---

## FUTURE DECISION TEMPLATE

When new config conflicts arise:

1. **Identify**: What is in conflict? (values, sources)
2. **Analyze**: Which file should be SSOT? (based on hierarchy above)
3. **Decide**: Document authoritative value + rationale
4. **Implement**: Update code to import from SSOT
5. **Verify**: Test that all imports resolve correctly
6. **Document**: Add to this file with date and reasoning

---

**This document is the authoritative record of all SSOT governance decisions.**

**When in doubt, refer to this document for conflict resolution.**
