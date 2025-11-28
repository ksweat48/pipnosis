# Critical Infrastructure Protection System

## Overview

This system protects Pipnosis's critical polling and chart infrastructure from accidental modifications during development. It provides warnings and notifications without blocking deployments.

---

## 🎯 What It Protects

### Real-Time Systems
- Chart price polling (3-second updates)
- Global polling coordinator (priority-based intervals)
- Market hours detection
- Visibility-based pause/resume
- Heartbeat monitoring

### Server-Side Functions
- Scheduled price collection (Netlify cron jobs)
- Candle aggregation
- Gap filling
- Cron expression format validation

### Configuration Files
- `netlify.toml` - Function timeouts and schedules
- Polling interval constants in code
- Chart update frequencies

---

## 🛡️ Protection Layers

### 1. Documentation Warnings

**Location:** Comments in critical files

Files with protection headers:
- `src/services/chart-direct-price-poller.ts`
- `src/services/global-polling-coordinator.ts`
- `netlify.toml`

Look for:
```
═══════════════════════════════════════════════════════════════
🚨 CRITICAL INFRASTRUCTURE - DO NOT MODIFY WITHOUT EXPLICIT APPROVAL
═══════════════════════════════════════════════════════════════
```

### 2. Configuration Baseline

**Location:** `config/critical-baseline.json`

Contains approved values for:
- Chart update interval: 3000ms
- Priority intervals (critical/high/normal/low)
- Netlify cron schedules
- Function timeouts
- Market check intervals

This is the "source of truth" for working configurations.

### 3. Build-Time Validation

**Location:** `scripts/validate-critical-systems.cjs`

**Runs:** Automatically during `npm run build` (via `prebuild` hook)

**What it does:**
- Compares current configuration against baseline
- Detects changes to critical values
- Validates cron expression format (5-field only)
- Generates colorful console warnings
- Creates detailed change report
- **Does NOT block deployment** (warning mode)

### 4. Manual Validation

**Command:** `npm run validate`

Run this anytime to check if critical configurations have changed:
```bash
npm run validate
```

---

## 🚀 How It Works

### Normal Build (No Changes)
```bash
$ npm run build

════════════════════════════════════════════════════════════════
🛡️  CRITICAL SYSTEMS VALIDATION
════════════════════════════════════════════════════════════════

Checking critical infrastructure configurations...
Mode: WARNING (non-blocking)

✅ Loaded baseline configuration v1.0
✅ netlify.toml configuration matches baseline
✅ All polling intervals match baseline

════════════════════════════════════════════════════════════════
📊 VALIDATION SUMMARY
════════════════════════════════════════════════════════════════

✅ All critical systems match baseline configuration
✅ No changes detected
✅ Safe to deploy

> vite build
Building...
```

### Build With Changes Detected
```bash
$ npm run build

════════════════════════════════════════════════════════════════
🛡️  CRITICAL SYSTEMS VALIDATION
════════════════════════════════════════════════════════════════

Checking critical infrastructure configurations...
Mode: WARNING (non-blocking)

✅ Loaded baseline configuration v1.0

📋 Validating netlify.toml...

🔄 CHANGE DETECTED in netlify.toml [functions."continuous-price-collector"]:
   Field: schedule
   Old: "* * * * *"
   New: "0 * * * * *"

❌ CRITICAL: Invalid cron format for continuous-price-collector: "0 * * * * *"
   Netlify requires 5-field format (minute hour day month weekday)
   Found 6 fields. This will BREAK the scheduled function!

════════════════════════════════════════════════════════════════
📊 VALIDATION SUMMARY
════════════════════════════════════════════════════════════════

 CRITICAL ERRORS: 1
These changes will likely BREAK functionality!

 CONFIGURATION CHANGES: 1
Review these changes before deployment

📄 Full report written to: CRITICAL_CHANGES_REPORT.txt

⚠️  BUILD WILL CONTINUE (warning mode)
Review the report and monitor deployment closely

> vite build
Building...
```

---

## 📋 Change Report Format

When changes are detected, a `CRITICAL_CHANGES_REPORT.txt` file is generated:

```
═══════════════════════════════════════════════════════════════
🚨 CRITICAL INFRASTRUCTURE CHANGES DETECTED
═══════════════════════════════════════════════════════════════

Generated: 2025-11-28T10:30:00.000Z
Baseline Version: 1.0

❌ ERRORS (Will break functionality):
────────────────────────────────────────────────────────────────
1. CRITICAL: Invalid cron format for continuous-price-collector
   Expected 5 fields, found 6. This will BREAK the function!

🔄 CONFIGURATION CHANGES:
────────────────────────────────────────────────────────────────
1. netlify.toml [functions."continuous-price-collector"]
   Field: schedule
   Old Value: "* * * * *"
   New Value: "0 * * * * *"

📋 RECOMMENDED ACTIONS:
────────────────────────────────────────────────────────────────
1. Review each change to determine if it was intentional
2. If unintentional, restore values from critical-baseline.json
3. Test polling and chart functionality after deployment
4. Update baseline if changes are approved and working
5. Monitor production for 15 minutes after deployment

📚 DOCUMENTATION:
────────────────────────────────────────────────────────────────
See docs/CRITICAL_SYSTEMS.md for detailed information
Baseline: config/critical-baseline.json

🔄 ROLLBACK:
────────────────────────────────────────────────────────────────
If deployment breaks functionality:
1. Revert to previous deployment in Netlify dashboard
2. Or restore files from git history
3. Or manually restore values from critical-baseline.json
```

---

## 🔧 Common Scenarios

### Scenario 1: Accidental Change During Feature Development

**What happens:**
1. You or I accidentally modify a polling interval while adding a feature
2. `npm run build` runs the validation script
3. Big yellow warnings appear in console
4. `CRITICAL_CHANGES_REPORT.txt` is generated
5. Build continues and deploys

**What to do:**
1. Read the warnings carefully
2. Review the change report
3. If change was unintentional, create a hotfix:
   - Restore value from `config/critical-baseline.json`
   - Commit and redeploy
4. If change was intentional and tested:
   - Update baseline to match new approved values
   - Document why the change was made

### Scenario 2: Intentional Configuration Update

**What happens:**
1. You decide to change chart update speed to 2 seconds (faster)
2. You test it thoroughly and it works
3. `npm run build` shows warnings about the change
4. You deploy knowing the change is intentional

**What to do:**
1. Document the change and reason
2. Monitor production to ensure it works
3. Update `config/critical-baseline.json` with new approved value:
   ```json
   "polling": {
     "chartUpdateInterval": 2000,  // Changed from 3000
     ...
   }
   ```
4. Commit the updated baseline

### Scenario 3: Cron Syntax Error (Most Common Issue)

**What happens:**
1. Cron expression accidentally changed to 6-field format
2. Validation detects this and shows RED error
3. Report explicitly warns this will break the function
4. Build continues (warning mode)

**What to do:**
1. Fix immediately before deploying:
   - Change from `"0 * * * * *"` (6 fields)
   - Back to `"* * * * *"` (5 fields)
2. Or rollback after deployment if missed

---

## 📚 Key Files Reference

| File | Purpose |
|------|---------|
| `docs/CRITICAL_SYSTEMS.md` | Complete documentation of protected systems |
| `config/critical-baseline.json` | Approved configuration values |
| `scripts/validate-critical-systems.cjs` | Validation script |
| `CRITICAL_CHANGES_REPORT.txt` | Generated when changes detected |
| `src/services/chart-direct-price-poller.ts` | Chart polling (3s interval) |
| `src/services/global-polling-coordinator.ts` | Global polling system |
| `netlify.toml` | Scheduled functions configuration |

---

## 🔍 How to Check Current Protection Status

### Quick Check
```bash
npm run validate
```

### Detailed Check
```bash
# View critical baseline
cat config/critical-baseline.json

# Check for warning comments in code
grep -r "CRITICAL INFRASTRUCTURE" src/services/

# View full documentation
cat docs/CRITICAL_SYSTEMS.md
```

---

## ⚙️ Configuration

### Change Validation Mode

Edit `config/critical-baseline.json`:

```json
"validation": {
  "enabled": true,        // Enable/disable validation
  "mode": "warn",         // "warn" or "error"
  "failOnError": false,   // Block build on errors
  "generateReport": true  // Generate change report
}
```

**Current Setting:** Warning mode (non-blocking)

### Disable Validation

If needed (not recommended):
```bash
# Temporarily skip validation
npm run build --ignore-scripts

# Or disable in package.json by removing "prebuild" script
```

---

## 🎓 For AI Assistants

When modifying Pipnosis code:

1. **Always check** if files have `🚨 CRITICAL INFRASTRUCTURE` headers
2. **Always run** `npm run validate` before proposing changes to:
   - Polling intervals
   - Chart update frequencies
   - Netlify cron schedules
   - Function timeouts
3. **Always inform** the user before modifying critical values
4. **Always explain** why the change is needed and the potential impact
5. **Always provide** rollback instructions

---

## 🆘 Troubleshooting

### Validation Script Won't Run
```bash
# Check if file exists
ls -la scripts/validate-critical-systems.cjs

# Run manually
node scripts/validate-critical-systems.cjs

# Check package.json
cat package.json | grep prebuild
```

### False Positives
If validation detects changes that don't exist:
1. Check baseline version matches deployed code
2. Update baseline if code was changed outside validation system
3. Review regex patterns in validation script

### Baseline Out of Sync
If baseline doesn't match production:
1. Review current working configuration
2. Update `config/critical-baseline.json`
3. Document changes
4. Run `npm run validate` to confirm

---

## 📈 Future Enhancements

Potential improvements to consider:

- [ ] Add runtime validators in polling coordinator
- [ ] Create admin UI to view/update baseline
- [ ] Add automated tests for critical paths
- [ ] Email notifications on critical changes
- [ ] Integration with git hooks (pre-commit checks)
- [ ] Dashboard showing system health
- [ ] Automatic rollback on detection of failures

---

## ✅ Summary

**Protection System Benefits:**
- Prevents accidental breakage of working systems
- Non-blocking approach keeps development agile
- Clear visibility into configuration changes
- Easy rollback with documented baselines
- Catches common mistakes (cron format, intervals)

**Key Principle:**
> Trust but verify - Allow changes to proceed, but make them highly visible and trackable

---

Last Updated: 2025-11-28
Protection System Version: 1.0
