# Critical Infrastructure Protection System - Flow Diagram

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEVELOPER / AI ASSISTANT                      │
│                                                                  │
│              Makes changes to codebase                           │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      RUN: npm run build                          │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              PREBUILD HOOK: Run Validation Script                │
│         scripts/validate-critical-systems.cjs                    │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │ Load Baseline  │
                    │ Configuration  │
                    └────────┬───────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │   Validate netlify.toml      │
              │   - Check cron format        │
              │   - Check timeouts           │
              │   - Check schedules          │
              └──────────────┬───────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │   Validate Polling Code      │
              │   - Chart intervals          │
              │   - Global coordinator       │
              │   - Market check intervals   │
              └──────────────┬───────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Any Changes?  │
                    └────────┬───────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
         ┌────────┐                   ┌─────────┐
         │   NO   │                   │   YES   │
         └───┬────┘                   └────┬────┘
             │                             │
             ▼                             ▼
    ┌──────────────────┐         ┌──────────────────────┐
    │  Show Success    │         │   Show Warnings      │
    │  ✅ All Good     │         │   🔄 Changes Found   │
    │  ✅ Safe Deploy  │         │   ⚠️  Review Report  │
    └───┬──────────────┘         └────┬─────────────────┘
        │                             │
        │                             ▼
        │                  ┌──────────────────────┐
        │                  │  Generate Report     │
        │                  │  CRITICAL_CHANGES_   │
        │                  │  REPORT.txt          │
        │                  └────┬─────────────────┘
        │                       │
        └───────────────────────┴────────────────────────┐
                                                         │
                                                         ▼
                                                ┌────────────────┐
                                                │ Continue Build │
                                                │ (Non-blocking) │
                                                └────────┬───────┘
                                                         │
                                                         ▼
                                                ┌────────────────┐
                                                │  Vite Build    │
                                                └────────┬───────┘
                                                         │
                                                         ▼
                                                ┌────────────────┐
                                                │    Deploy      │
                                                └────────┬───────┘
                                                         │
                              ┌──────────────────────────┴──────────────────────────┐
                              │                                                     │
                              ▼                                                     ▼
                   ┌────────────────────┐                              ┌────────────────────┐
                   │   No Changes       │                              │   Changes Made     │
                   │   Deploy Success   │                              │   Review & Monitor │
                   │   ✅ Safe         │                              │   ⚠️  Watch Closely │
                   └────────────────────┘                              └────────┬───────────┘
                                                                                │
                                                                                ▼
                                                                       ┌────────────────┐
                                                                       │  Everything    │
                                                                       │  Working?      │
                                                                       └────────┬───────┘
                                                                                │
                                                                 ┌──────────────┴─────────────┐
                                                                 │                            │
                                                                 ▼                            ▼
                                                            ┌────────┐                  ┌──────────┐
                                                            │  YES   │                  │   NO     │
                                                            └───┬────┘                  └────┬─────┘
                                                                │                            │
                                                                ▼                            ▼
                                                          ┌──────────┐              ┌────────────────┐
                                                          │  Update  │              │   Rollback     │
                                                          │ Baseline │              │   - Revert     │
                                                          └──────────┘              │   - Restore    │
                                                                                    │   - Fix        │
                                                                                    └────────────────┘
```

---

## Component Details

### 1. Validation Script Entry
```
Input: Current codebase files
Process: Load baseline, compare values
Output: Warnings + Report (if changes found)
Mode: Non-blocking (always continues)
```

### 2. netlify.toml Validation
```
Checks:
- Cron expression format (5-field only)
- Function timeouts match baseline
- Schedule values unchanged

Detects:
❌ "0 * * * * *" (6 fields) → ERROR
✅ "* * * * *" (5 fields) → OK
```

### 3. Code Validation
```
Scans:
- chart-direct-price-poller.ts
  → interval: 3000

- global-polling-coordinator.ts
  → MARKET_CHECK_INTERVAL: 60000
  → HEARTBEAT_INTERVAL_MS: 5000
  → MAX_MISSED_HEARTBEATS: 3

Compares:
Current values vs baseline values
```

### 4. Report Generation
```
When changes detected:

CRITICAL_CHANGES_REPORT.txt contains:
- List of all changes (old → new)
- Error messages for critical issues
- Recommended actions
- Rollback instructions
- Documentation references
```

---

## Decision Flow

### No Changes Path
```
Validation → Pass
    ↓
Build → Success
    ↓
Deploy → Safe
    ↓
Monitor → Normal
```

### Changes Detected Path
```
Validation → Warning
    ↓
Report Generated
    ↓
Build → Continues
    ↓
Deploy → With Caution
    ↓
Monitor → Closely
    ↓
Issues? → Rollback
    ↓
Working? → Update Baseline
```

---

## Protection Layers Visualization

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Documentation                                      │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│  • Warning headers in files                                  │
│  • Inline comments on critical constants                    │
│  • Comprehensive docs                                        │
└─────────────────────────────────────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Configuration Baseline                             │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│  • config/critical-baseline.json                             │
│  • Source of truth for approved values                       │
│  • Easy reference and restore                                │
└─────────────────────────────────────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Build-Time Validation                              │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│  • Automatic checks during build                             │
│  • Colorful warnings                                         │
│  • Detailed change reports                                   │
└─────────────────────────────────────────────────────────────┘
                           │
┌─────────────────────────────────────────────────────────────┐
│  Layer 4: Non-Blocking Approach                              │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│  • Warnings don't stop deployment                            │
│  • Maintains development velocity                            │
│  • Makes changes highly visible                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Warning Color System

```
🟢 GREEN - All Clear
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ All critical systems match baseline
✅ No changes detected
✅ Safe to deploy


🟡 YELLOW - Warning
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 CHANGE DETECTED
⚠️  Configuration changes found
📄 Report generated
⚠️  BUILD CONTINUES - review and monitor


🔴 RED - Critical Error
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
❌ CRITICAL ERROR DETECTED
🚨 This will likely BREAK functionality
📄 Detailed report generated
⚠️  BUILD CONTINUES - fix immediately!
```

---

## Real-World Example

### Scenario: Cron Expression Typo

```
Developer accidentally adds seconds field to cron:
schedule = "0 * * * * *"  ← 6 fields (WRONG!)

During Build:
┌──────────────────────────────────────┐
│  VALIDATION DETECTS CHANGE           │
│  ❌ Invalid cron format              │
│  Expected: 5 fields                  │
│  Found: 6 fields                     │
│  This will BREAK scheduled function! │
└──────────────────────────────────────┘

Report Generated:
CRITICAL_CHANGES_REPORT.txt

Build Continues:
⚠️  WARNING MODE - deploy proceeds

Developer Sees Big Red Warning:
❌ FIX BEFORE DEPLOYING!

Developer Fixes:
schedule = "* * * * *"  ← 5 fields (CORRECT!)

Re-run Build:
✅ All clear, safe to deploy
```

---

## Integration Points

### Package.json
```json
{
  "scripts": {
    "prebuild": "node scripts/validate-critical-systems.cjs",
    "validate": "node scripts/validate-critical-systems.cjs"
  }
}
```

### Protected Files
```
src/services/
  ├── chart-direct-price-poller.ts     🚨 PROTECTED
  └── global-polling-coordinator.ts    🚨 PROTECTED

netlify.toml                           🚨 PROTECTED

config/
  └── critical-baseline.json           📋 BASELINE
```

---

## Success Criteria

✅ **System is working if:**
- Validation runs on every build
- Changes are detected accurately
- Warnings are visible and clear
- Reports provide actionable information
- Build continues (non-blocking)
- Easy to understand and use

✅ **All criteria met!**

---

Last Updated: 2025-11-28
Protection System v1.0
