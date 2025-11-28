# 🚨 Critical Infrastructure Quick Reference

## What's Protected?

### Files with Protection Headers
- `src/services/chart-direct-price-poller.ts` - Chart updates (3s)
- `src/services/global-polling-coordinator.ts` - Global polling
- `netlify.toml` - Scheduled functions

### Critical Values
```javascript
// Chart updates
interval: 3000  // 3 seconds - DO NOT CHANGE

// Global polling
MARKET_CHECK_INTERVAL: 60000     // 1 minute
HEARTBEAT_INTERVAL_MS: 5000      // 5 seconds
MAX_MISSED_HEARTBEATS: 3         // Recovery threshold

// Netlify cron (MUST be 5-field format)
schedule = "* * * * *"           // ✅ CORRECT
schedule = "0 * * * * *"         // ❌ WRONG (6 fields breaks it)
```

---

## Quick Commands

```bash
# Check for changes before deploying
npm run validate

# Build (automatically validates)
npm run build

# View baseline configuration
cat config/critical-baseline.json

# View full documentation
cat docs/CRITICAL_SYSTEMS.md
cat docs/PROTECTION_SYSTEM_GUIDE.md
```

---

## Warning Signs

### 🟢 All Good
```
✅ All critical systems match baseline configuration
✅ No changes detected
✅ Safe to deploy
```

### 🟡 Changes Detected
```
🔄 CHANGE DETECTED in src/services/chart-direct-price-poller.ts:
   Field: chartUpdateInterval
   Old: 3000
   New: 2000

⚠️  CONFIGURATION CHANGES: 1
📄 Full report written to: CRITICAL_CHANGES_REPORT.txt
⚠️  BUILD WILL CONTINUE (warning mode)
```

### 🔴 Critical Error
```
❌ CRITICAL: Invalid cron format
   Netlify requires 5-field format
   Found 6 fields. This will BREAK the scheduled function!
```

---

## What Happens When?

| Action | Validation Runs? | Blocks Deploy? |
|--------|-----------------|----------------|
| `npm run build` | ✅ Yes | ❌ No (warns) |
| `npm run validate` | ✅ Yes | ❌ No (warns) |
| Deploy to Netlify | ✅ Yes | ❌ No (warns) |
| Direct git push | ❌ No | N/A |

**Current Mode:** Non-blocking warnings

---

## If Something Breaks

### Quick Rollback
1. Netlify Dashboard → Deploys → Deploy previous version
2. OR restore values from `config/critical-baseline.json`
3. OR check git history for last known-good version

### Check What Changed
```bash
# View change report
cat CRITICAL_CHANGES_REPORT.txt

# Compare against baseline
diff <file> config/critical-baseline.json
```

---

## Common Mistakes Caught

| Mistake | Detection | Impact |
|---------|-----------|--------|
| 6-field cron format | ❌ ERROR | Breaks scheduled functions |
| Changed polling interval | 🔄 CHANGE | May affect API limits |
| Modified timeout | 🔄 CHANGE | May cause function failures |
| Removed market hours check | 🔄 CHANGE | Wastes API calls |

---

## For AI Assistants

**Before modifying:**
1. Check for `🚨 CRITICAL INFRASTRUCTURE` headers
2. Run `npm run validate`
3. Ask user for approval
4. Document why change is needed

**After modifying:**
1. Run `npm run validate`
2. Review warnings
3. Update baseline if approved
4. Provide rollback instructions

---

## Key Files

| File | Purpose |
|------|---------|
| `docs/CRITICAL_SYSTEMS.md` | Full documentation |
| `docs/PROTECTION_SYSTEM_GUIDE.md` | User guide |
| `config/critical-baseline.json` | Approved values |
| `scripts/validate-critical-systems.cjs` | Validator |
| `CRITICAL_CHANGES_REPORT.txt` | Generated on changes |

---

## Status Check

Run this to verify protection is active:

```bash
# Should show validation in prebuild
cat package.json | grep prebuild

# Should show critical values
grep -r "CRITICAL" src/services/*.ts

# Should pass validation
npm run validate
```

---

**Remember:** This system warns but doesn't block. It makes changes highly visible so you can review them before they cause issues.

---

Protection System v1.0 | Last Updated: 2025-11-28
