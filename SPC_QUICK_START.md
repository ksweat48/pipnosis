# SPC System - Quick Start Guide

## 🚀 Getting Started

The Session Profit Coefficient (SPC) system is now live! Here's everything you need to know to start using it.

---

## 📋 Prerequisites

1. **Database Migration Applied**
   - The migration `20251109140000_create_spc_session_system.sql` must be applied
   - Run via Supabase dashboard or CLI

2. **User Authenticated**
   - User must be logged in
   - User must have a record in `ai_skill_progression` (auto-created on first use)

---

## 🎯 Using the System

### Step 1: Start a Trading Session

**Option A: Via UI (Session Dashboard)**
1. Navigate to Session Dashboard page
2. Enter optional session name (e.g., "Morning Trading")
3. Enter optional notes (e.g., "Focusing on EURUSD")
4. Click "Start New Session"

**Option B: Via Code**
```typescript
import { sessionManagementService } from '@/services/session-management-service';

const result = await sessionManagementService.startSession(
  userId,
  "My Trading Session",
  "Testing the SPC system"
);

if (result.success) {
  console.log('Session started:', result.sessionId);
}
```

### Step 2: Execute Trades

Trades executed during an active session need to be linked:

```typescript
// After a trade closes in trade_history
const activeSession = await sessionManagementService.getActiveSession(userId);

if (activeSession) {
  const tradeNumber = activeSession.total_trades + 1;

  await sessionManagementService.linkTradeToSession(
    userId,
    tradeId,
    activeSession.id,
    tradeNumber
  );
}
```

**Automatic Comeback Detection:**
- System automatically detects: 2+ losses followed by a win with R:R ≥ 2.0
- Applies bonus: +0.5 (or +1.0 if 3+ losses)
- Logs: `🎉 COMEBACK TRADE!`

### Step 3: End Session

**Option A: Via UI**
1. Click "End Session" button
2. Confirm the prompt
3. Report auto-generates

**Option B: Via Code**
```typescript
const endResult = await sessionManagementService.endSession(userId, sessionId);

if (endResult.success) {
  console.log('Session metrics:', endResult.metrics);

  // Generate report
  const report = await sessionReportGenerator.generateSessionReport(userId, sessionId);
  console.log('Report:', report.report?.reportContent);
}
```

### Step 4: View Progress

Check your cumulative SPC and progress:

```typescript
import { spcCalculator } from '@/services/spc-calculator';

const progress = await spcCalculator.getSPCProgress(userId);

console.log('Current SPC:', progress.currentSPC);
console.log('Target SPC:', progress.targetSPC);
console.log('Progress:', progress.progressPercent + '%');
console.log('Needed:', progress.spcNeeded);
```

---

## 📊 Understanding SPC

### Formula
```
Session SPC = (Wins - Losses) × Profit Weight + Comeback Bonus
```

### Profit Weight Tiers
| Profit Factor | Weight |
|---------------|--------|
| ≥ 1.5 | 1.25 |
| ≥ 1.0 | 1.0 |
| ≥ 0.8 | 0.75 |
| < 0.8 | 0.5 |

### Comeback Bonus
- **Requirements:** 2+ losses, then win with R:R ≥ 2.0
- **Base bonus:** +0.5
- **Double bonus:** +1.0 (if 3+ losses before)

### Examples

**Example 1: Positive Session**
```
Trades: 6W / 2L
Profit Factor: 2.1
Profit Weight: 1.25

Base SPC = (6 - 2) × 1.25 = +5.0
Comeback Bonus = 0 (no comebacks)
Session SPC = +5.0 (exceptional tier)
```

**Example 2: Comeback Session**
```
Trades: 3W / 3L (with 1 comeback after 3 losses)
Profit Factor: 1.4
Profit Weight: 1.0

Base SPC = (3 - 3) × 1.0 = 0
Comeback Bonus = +1.0 (3+ losses)
Session SPC = +1.0 (positive tier)
```

**Example 3: Challenging Session**
```
Trades: 2W / 4L
Profit Factor: 0.65
Profit Weight: 0.5

Base SPC = (2 - 4) × 0.5 = -1.0
Comeback Bonus = 0
Session SPC = -1.0 (negative tier)
```

---

## 🎯 Tier Targets

| Skill Level | Cumulative SPC Target |
|-------------|----------------------|
| Novice | 0 |
| Intermediate | +10 |
| Pro | +25 |
| Expert | +50 |
| Master | +100 |
| Exceptional | +200 |

**Important:** All other requirements must also be met (trades, win rate, profit factor, CSS).

---

## 🛡️ Defensive Mode

### Triggers
Defensive mode activates when:
- 2 consecutive negative SPC sessions, OR
- Last session SPC ≤ -2.0, OR
- Profit factor < 0.8 for 3 sessions

### Effects
- Risk per trade: 50% of normal
- Position size: 0.5x multiplier
- Min confidence: 80% (raised from usual threshold)
- Pattern filter: Only PF ≥ 1.5 patterns allowed

### Deactivation
- 2 consecutive positive SPC sessions, OR
- Profit factor recovers above 1.0

---

## 📈 Viewing Reports

### Latest Report (UI)
Reports display automatically on Session Dashboard after ending a session.

### Recent Reports (Code)
```typescript
import { sessionReportGenerator } from '@/services/session-report-generator';

const reports = await sessionReportGenerator.getRecentReports(userId, 5);

reports.forEach(report => {
  console.log('Title:', report.report_title);
  console.log('SPC:', report.spc_breakdown.totalSPC);
  console.log('Grade:', report.spc_breakdown.grade);
  console.log('Comebacks:', report.comeback_highlights.length);
});
```

---

## 🎨 UI Components

### SPCProgressBar
Visual progress bar with colored segments:

```tsx
import { SPCProgressBar } from '@/components/SPCProgressBar';

<SPCProgressBar
  segments={report.progressBarData}
  cumulativeSPC={50.5}
  targetSPC={75}
  progressPercent={68}
  nextTier="Pro"
/>
```

### SessionDashboard
Complete session management interface:

```tsx
import { SessionDashboard } from '@/components/SessionDashboard';

<SessionDashboard />
```

---

## 🔧 Advanced Usage

### Check Tier Eligibility
```typescript
const eligibility = await spcCalculator.checkTierEligibility(userId, 'Pro');

if (eligibility.eligible) {
  console.log('Eligible for Pro level!');
} else {
  console.log('Missing:', eligibility.missingRequirements);
}
```

### Integrated Progression (SPC + CSS)
```typescript
import { spcSkillIntegration } from '@/services/spc-skill-integration';

const progression = await spcSkillIntegration.getIntegratedProgression(userId);

console.log('SPC contribution (60%):', progression.integratedScore.spcContribution);
console.log('CSS contribution (40%):', progression.integratedScore.cssContribution);
console.log('Combined score:', progression.integratedScore.combinedScore);
console.log('Can level up:', progression.integratedScore.canLevelUp);
```

### Manual Defensive Mode Check
```typescript
const check = await spcCalculator.shouldActivateDefensiveMode(userId);

if (check.shouldActivate) {
  console.log('Defensive mode recommended:', check.reason);
}
```

---

## 💡 Best Practices

### 1. Session Naming
Use descriptive names to track performance patterns:
- "Morning Session - High Volatility"
- "London Session - EURUSD Focus"
- "Comeback Attempt - Conservative Risk"

### 2. Regular Sessions
- Start a session for each distinct trading period
- Don't run sessions across multiple days
- End sessions after market close or when done trading

### 3. Trade Linking
- Ensure trades are linked to active session
- Check `linkTradeToSession()` is called after trade closes
- Verify comeback trades are detected correctly

### 4. Progress Monitoring
- Review session reports after each session
- Track cumulative SPC weekly
- Adjust strategy based on recommendations

### 5. Defensive Mode
- Respect defensive mode restrictions
- Use it as capital protection, not punishment
- Work on improving metrics to exit defensive mode

---

## ❓ Troubleshooting

### "No active session" Error
**Cause:** Trying to link trade when no session is active
**Fix:** Start a session before trading

### Comeback Not Detected
**Check:**
- At least 2 consecutive losses before the win
- Win trade has R:R ≥ 2.0
- Trades are in correct sequence (trade_number)

### SPC Not Updating
**Check:**
- Session was ended properly
- `endSession()` completed successfully
- `spcCalculator.updateCumulativeSPC()` was called

### Report Not Generating
**Check:**
- Session has at least 1 trade
- Session status is 'ended'
- All session trades have valid data

### Defensive Mode Stuck
**Check:**
- Consecutive negative sessions count
- Recent session SPC values
- May need 2 positive sessions to deactivate

---

## 📚 Additional Resources

- **Full Implementation Guide:** `SPC_SYSTEM_IMPLEMENTATION_COMPLETE.md`
- **Database Schema:** `supabase/migrations/20251109140000_create_spc_session_system.sql`
- **Services:**
  - `src/services/session-management-service.ts`
  - `src/services/spc-calculator.ts`
  - `src/services/session-report-generator.ts`
  - `src/services/spc-skill-integration.ts`
- **Components:**
  - `src/components/SPCProgressBar.tsx`
  - `src/components/SessionDashboard.tsx`

---

## 🎉 Quick Test

To test the system works:

```typescript
// 1. Start session
const session = await sessionManagementService.startSession(userId, "Test Session");

// 2. Link a winning trade
await sessionManagementService.linkTradeToSession(
  userId,
  testTradeId,
  session.sessionId!,
  1
);

// 3. End session
await sessionManagementService.endSession(userId, session.sessionId!);

// 4. Check SPC
const progress = await spcCalculator.getSPCProgress(userId);
console.log('Test complete! SPC:', progress?.currentSPC);
```

---

**You're all set! Start your first trading session and watch your SPC grow!** 🚀
