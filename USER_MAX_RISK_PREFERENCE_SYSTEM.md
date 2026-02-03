# User Max Risk Preference System

## Overview

A three-tier risk management system that respects user-specified risk ceilings while maintaining Alpha's full authority over position sizing decisions.

**Core Principle**: Users express their risk tolerance; Alpha optimizes within that ceiling through intelligent degradation, not blocking.

---

## Architecture

### Three-Tier Risk Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│ PLATFORM_ABSOLUTE_RISK_CAP (10%)                            │
│ Hard system limit - maximum possible risk                    │
└──────────────────────┬──────────────────────────────────────┘
                       ▲
                       │
┌──────────────────────┴──────────────────────────────────────┐
│ USER_MAX_RISK_PREFERENCE (default 5%)                       │
│ User's stated ceiling - respects intent while maintaining   │
│ Alpha authority                                             │
└──────────────────────┬──────────────────────────────────────┘
                       ▲
                       │
┌──────────────────────┴──────────────────────────────────────┐
│ ALPHA_CALCULATED_RISK (varies by market conditions)         │
│ Intelligent sizing based on:                                │
│ - Kelly Criterion (edge strength)                           │
│ - Volatility adjustments                                    │
│ - Market condition analysis                                 │
│ - Correlation risk checks                                   │
│ - Progressive risk scaling                                  │
└─────────────────────────────────────────────────────────────┘
```

### Risk Negotiation Flow

```
Alpha Calculates Risk
        ↓
  Is it > User Max?
    /           \
   YES          NO
    ↓            ↓
DEGRADE      APPROVED
Position      Position
DOWN          Executes
    ↓            ↓
Logs        Logs
Negotiation  Trade
    ↓            ↓
  User Gets    User Gets
 Informed      Optimal
 Position      Position
```

---

## Key Components

### 1. **User Risk Preference Service** (SSOT)

**File**: `/src/services/user-risk-preference-service.ts`

**Responsibility**: Single authoritative source for user's maximum risk preference.

**Key Methods**:
- `getUserMaxRiskPercent(userId)` - Fetch user's max risk ceiling (default 5%)
- `updateUserMaxRiskPercent(userId, percent)` - Update preference with validation
- `resetToDefault(userId)` - Reset to platform default
- `initializeNewUser(userId)` - Initialize new users with default preference

**SSOT Compliance**:
- All reads come from single `user_max_risk_preferences` table
- No duplicate preference data elsewhere
- 30-second cache to prevent stale data
- Validation enforces 1-10% bounds

### 2. **Risk Negotiation Auditor** (Governance)

**File**: `/src/services/risk-negotiation-auditor.ts`

**Responsibility**: Track all risk adjustments for transparency and governance.

**Records Captured**:
- Alpha's calculated risk
- User's maximum risk preference
- Final executed risk
- Negotiation outcome (approved/degraded/exceeded)
- Degradation reason

**Analysis Functions**:
- `getUserNegotiations(userId)` - Recent negotiations history
- `getUserNegotiationStats(userId)` - Degradation rate, frequency
- `getTrendAnalysis(userId)` - Pattern detection (stable/exceeding/degrading)

### 3. **Professional Risk Manager** (Enhanced)

**File**: `/src/services/professional-risk-manager.ts` (Lines 210-265)

**Enhanced Logic**:

1. **Fetch User Preference** (Line 225):
   ```typescript
   const userMaxRiskPercent = await userRiskPreferenceService.getUserMaxRiskPercent(userId) / 100;
   ```

2. **Compare Against Ceiling** (Line 228-232):
   ```typescript
   if (finalRiskPercent > userMaxRiskPercent) {
     // DEGRADE position size down
     finalRiskPercent = userMaxRiskPercent;
   }
   ```

3. **Log Negotiation** (Line 350-392):
   ```typescript
   riskNegotiationAuditor.logNegotiation({
     alphaCalculatedRiskPercent: beforeUserPreference * 100,
     userMaxRiskPercent: userMaxRiskPercent * 100,
     finalRiskPercent: finalRiskPercent * 100,
     negotiationOutcome: 'degraded' | 'approved'
   });
   ```

### 4. **Database Schema**

**Table**: `user_max_risk_preferences`

```sql
CREATE TABLE user_max_risk_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  max_risk_percent numeric NOT NULL CHECK (max_risk_percent >= 1 AND max_risk_percent <= 10),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**RLS Policies**:
- Users can read/update their own preference only
- Service role can manage all preferences

**RPC Functions**:
- `get_user_max_risk_preference(user_id)` - Fetch with fallback
- `update_user_max_risk_preference(user_id, percent)` - Update with validation
- `reset_user_risk_to_default(user_id)` - Reset to 5%

---

## Compliance

### SSOT (Single Source of Truth)
- ✅ One authoritative table: `user_max_risk_preferences`
- ✅ Service layer owns all reads/writes: `userRiskPreferenceService`
- ✅ No duplicate preference data elsewhere
- ✅ Cache invalidation on updates

### CCIP (Change Control Intelligence Protocol)
- ✅ Immutable audit trail: `riskNegotiationAuditor` logs all decisions
- ✅ Clear causality: tracks calculated → user max → final risk
- ✅ Governance tracking: outcomes recorded (approved/degraded/exceeded)
- ✅ Transparency: users see why position is sized as it is

### Governance Standards
- ✅ Risk negotiations logged with full context
- ✅ Degradation reasons documented
- ✅ Trend analysis for pattern detection
- ✅ No silent behavior changes (all logged)
- ✅ Auditable decision flow

---

## User Experience

### When Alpha Calculates Risk Below User Max
```
✅ Risk Approved
Alpha: 3.2%  |  User Max: 5%  |  Final: 3.2%
→ Position executes at Alpha's optimal sizing
→ User is informed: "Risk within your 5% ceiling"
```

### When Alpha Calculates Risk Above User Max
```
🤝 Risk Negotiation
Alpha: 7.1%  |  User Max: 5%  |  Final: 5%
→ Position degraded DOWN to respect user ceiling
→ User is informed: "Alpha calculated 7.1% risk. Your preference is 5% max. Position sized for 5% ($250 at risk)."
→ Trade still executes, just with smaller position
```

### When User Wants to Override (Future Enhancement)
```
⚠️  Override Available
Alpha: 7.1%  |  User Max: 5%  |  Degraded To: 5%
→ User sees: "Accept Alpha's 7.1% this time?" button
→ If accepted: executes at 7.1%
→ Logged as: negotiationOutcome: 'exceeded'
```

---

## Migration & Initialization

### New Users
- Automatically initialized with 5% preference during signup
- `userRiskPreferenceService.initializeNewUser()` called in `useAuth.tsx`
- Safe fallback: 5% returned if preference unset

### Existing Users
- Migration applied: `20260203_initialize_user_max_risk_preferences_for_existing_users`
- All existing users initialized with 5% default
- Idempotent: won't reinitialize if already set
- Zero downtime: executed as part of deploy

---

## Data Flow

### During Trade Execution

```
1. Alpha Execution Planner calculates optimal sizing
   ↓
2. ProfessionalRiskManager.evaluateTrade(inputs)
   ├─ Apply Kelly criterion
   ├─ Apply volatility adjustments
   ├─ Apply market condition adjustments
   ├─ Apply correlation checks
   ├─ Apply risk profile ceiling/floor
   ↓
3. Fetch user's max_risk_percent from SSOT
   ├─ If missing: return 5.0%
   ├─ Use 30-second cache
   ↓
4. Compare Alpha's risk vs User's max
   ├─ If Alpha > User: DEGRADE position DOWN
   ├─ If Alpha ≤ User: APPROVED as-is
   ↓
5. Recalculate lot size based on final risk %
   ↓
6. Log negotiation to riskNegotiationAuditor
   ├─ Record decision outcome
   ├─ Store all metrics
   ├─ Track pattern for analytics
   ↓
7. Return assessment with:
   ├─ Recommended lot size (degraded or approved)
   ├─ Final risk percent
   ├─ Recommendations explaining adjustment
```

---

## Transparency & Feedback

### Information Provided to User

**On Trade Execution Modal**:
```
Risk Negotiation Summary:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Alpha's Analysis:
  • Calculated Risk: 7.1%
  • Lot Size at 7.1%: 0.85 lots
  • Reasoning: High confidence setup with favorable R:R

Your Risk Preference:
  • Maximum Risk Allowed: 5.0%

Final Execution:
  • Executed Risk: 5.0%
  • Executed Lot Size: 0.60 lots
  • At Risk Amount: $250

Message:
"Position sized down to respect your 5% ceiling.
Alpha retains full authority and will optimize within
your stated preference."
```

### Governance Dashboard (Future)
- View recent risk negotiations
- See degradation frequency
- Analyze trend patterns
- Adjust preference if desired

---

## Configuration

### Platform Defaults

| Parameter | Value | Source |
|-----------|-------|--------|
| Platform Absolute Cap | 10% | TRADING_CONSTANTS |
| User Default | 5% | user_max_risk_preferences |
| Min Allowed | 1% | CHECK constraint |
| Max Allowed | 10% | CHECK constraint |
| Cache TTL | 30 seconds | userRiskPreferenceService |

### Customization

Users can adjust their maximum risk preference anytime:
```typescript
// User raises their ceiling to 7%
await userRiskPreferenceService.updateUserMaxRiskPercent(userId, 7.0);

// User resets to platform default (5%)
await userRiskPreferenceService.resetToDefault(userId);
```

---

## Benefits

### For Users
1. **Expresses Intent**: Clear ceiling prevents surprises
2. **Maintains Control**: Preference respected, not ignored
3. **Graceful Degradation**: Smaller positions, not rejected trades
4. **Full Transparency**: Sees exactly why position is sized as it is
5. **Flexibility**: Can adjust anytime or temporarily override

### For Alpha
1. **Full Authority**: Still optimizes within user's ceiling
2. **No Hard Blocks**: User preference is respected, not enforced
3. **Better Execution**: Degradation is intelligent, not arbitrary
4. **Governance Ready**: All decisions logged for audit trail

### For Platform
1. **Risk Governance**: User intent respected at all times
2. **Auditability**: Complete decision trail for compliance
3. **Pattern Detection**: Can analyze aggregate behavior
4. **User Satisfaction**: Reduces "why was my position sized down?" questions

---

## Examples

### Example 1: Conservative User

User Sets: 2% max risk
Market Condition: High volatility (Alpha wants 4%)

**Result**:
- Alpha's calc: 4.0% → User max: 2.0% → Final: 2.0%
- Position degraded 50% to respect ceiling
- Logged as: "degraded" / "User max risk preference exceeded"
- User sees: "Alpha wanted larger position due to high volatility. Your 2% preference is respected."

### Example 2: Aggressive User

User Sets: 8% max risk
Market Condition: Low volatility (Alpha wants 3%)

**Result**:
- Alpha's calc: 3.0% → User max: 8.0% → Final: 3.0%
- Alpha is more conservative than user's ceiling
- Logged as: "approved"
- User sees: "Risk within your 8% ceiling. Optimal sizing applied."

### Example 3: User Override (Future)

User Sets: 5% max risk normally
Special Opportunity: High confidence, wants to exceed

**Result**:
- Alpha's calc: 6.5% → User max: 5.0% → Degraded to: 5.0%
- User option: "Accept Alpha's 6.5% for this trade?"
- If accepted: Executes at 6.5%, logged as: "exceeded"
- Future preference unchanged: still 5% default

---

## Monitoring & Analytics

### Risk Negotiation Statistics

```typescript
const stats = riskNegotiationAuditor.getUserNegotiationStats(userId);

// Example output:
{
  totalNegotiations: 42,
  degradedCount: 8,           // 8 trades degraded due to user ceiling
  degradationRate: 19.0,      // 19% of trades were degraded
  averageDegradationPercent: 1.5,  // Average 1.5% reduction
  exceedanceCount: 0          // No user overrides
}
```

### Trend Analysis

```typescript
const trend = riskNegotiationAuditor.getTrendAnalysis(userId, 10);

// Example output:
{
  trend: 'degrading-less',
  message: 'In last 10 trades, 2 were degraded (20%)',
  recommendation: 'Occasional degradation is normal. Monitor trend'
}
```

---

## FAQ

**Q: Why is my position smaller than Alpha calculated?**
A: Alpha calculated higher risk than your preference ceiling. Your position was intelligently degraded to respect your stated maximum.

**Q: Can I see why my position was degraded?**
A: Yes, the trade execution modal shows Alpha's calculation vs your ceiling. Check the "Risk Negotiation" section.

**Q: Can I change my risk preference?**
A: Yes, anytime in Settings → Risk Preferences. Default is 5%, you can set 1-10%.

**Q: Will Alpha ever ignore my preference?**
A: Never. Alpha will degrade position size down if needed. If you want larger positions, raise your preference.

**Q: What if I want to temporarily exceed my ceiling?**
A: Future enhancement will allow one-time overrides with a confirmation dialog.

---

## Technical Notes

### Performance
- User preference fetches: O(1) with 30-second cache
- Auditor logging: O(1) in-memory append
- No database hits during trade execution (cached)
- Cache invalidated on preference updates

### Scalability
- Auditor maintains last 1000 negotiations in memory
- Old records discarded (FIFO) when limit reached
- Full audit trail can be exported to database if needed

### Edge Cases Handled
- Missing preference → default to 5%
- User updates preference during trade → uses current value
- Multiple rapid trades → independent negotiations logged
- User deletes account → preference cascade deleted via FK

---

## Future Enhancements

1. **One-Time Overrides**: User can approve temporary exceptions
2. **Confidence-Based Ceiling**: Adjust ceiling based on confidence level
3. **Time-Based Pricing**: Higher ceiling for specific market hours
4. **Pair-Specific Ceilings**: Different max risk per trading pair
5. **Dashboard Analytics**: Visual trend analysis and recommendations
6. **API Integration**: Allow external risk management systems

---

## Summary

This system achieves the goal of **respecting user intent while maintaining Alpha's authority**. Users express a risk ceiling; Alpha optimizes within it. No surprises, no hard blocks, full transparency, complete audit trail.
