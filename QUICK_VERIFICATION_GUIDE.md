# Credit Deduction Fix - Quick Verification Guide

**Deploy Date**: January 19, 2026
**Run This**: 1 hour, 24 hours, and 7 days after deployment

---

## ⚡ 5-Minute Health Check

### Step 1: Run Health Dashboard Query (30 seconds)
```sql
-- Copy/paste this entire query into Supabase SQL Editor
-- This gives you an instant health snapshot

WITH metrics AS (
  SELECT
    (SELECT COUNT(*) FROM credit_transactions WHERE created_at >= NOW() - INTERVAL '24 hours' AND transaction_type = 'signal_deduction' AND credits_deducted > 0) as successful_deductions,
    (SELECT COUNT(*) FROM credit_transactions WHERE created_at >= NOW() - INTERVAL '24 hours' AND transaction_type = 'signal_deduction' AND credits_deducted = 0) as failed_deductions,
    (SELECT COUNT(*) FROM goal_session_trades WHERE created_at >= NOW() - INTERVAL '24 hours') as total_trades,
    (SELECT COUNT(*) FROM credit_transactions WHERE created_at >= NOW() - INTERVAL '24 hours' AND transaction_type = 'purchase') as purchases,
    (SELECT COALESCE(SUM((metadata->>'amount_usd')::numeric), 0) FROM credit_transactions WHERE created_at >= NOW() - INTERVAL '24 hours' AND transaction_type = 'purchase') as revenue
)
SELECT
  'DEDUCTIONS: ' || successful_deductions || ' successful, ' || failed_deductions || ' failed (' || ROUND((successful_deductions::numeric / NULLIF(successful_deductions + failed_deductions, 0) * 100), 1) || '% success)' as status_1,
  'TRADES: ' || total_trades || ' executed' as status_2,
  'REVENUE: ' || purchases || ' purchases, $' || ROUND(revenue, 2) as status_3
FROM metrics;
```

**Expected Output**:
```
DEDUCTIONS: 50 successful, 2 failed (96.2% success)
TRADES: 52 executed
REVENUE: 5 purchases, $49.95
```

**Red Flags**:
- ❌ 0 successful deductions but >0 trades → **FIX NOT WORKING**
- ❌ Success rate < 90% → **INVESTIGATE ERRORS**
- ❌ 0 purchases after 24 hours → **USERS CHURNING**

---

### Step 2: Check for Phantom Deductions (30 seconds)
```sql
-- Detects credits deducted without corresponding trade
SELECT COUNT(*) as phantom_deductions
FROM credit_transactions ct
WHERE ct.created_at >= NOW() - INTERVAL '24 hours'
  AND ct.transaction_type = 'signal_deduction'
  AND ct.credits_deducted = 10
  AND NOT EXISTS (
    SELECT 1 FROM goal_session_trades t
    WHERE t.user_id = ct.user_id
      AND t.symbol = ct.metadata->>'symbol'
      AND t.created_at BETWEEN ct.created_at AND ct.created_at + INTERVAL '30 seconds'
  )
  AND NOT EXISTS (
    SELECT 1 FROM entry_intents ei
    WHERE ei.user_id = ct.user_id
      AND ei.created_at BETWEEN ct.created_at - INTERVAL '5 seconds' AND ct.created_at + INTERVAL '5 seconds'
  );
```

**Expected**: `0`
**Red Flag**: Any number > 0 → **USERS LOSING CREDITS WITHOUT TRADES**

---

### Step 3: Check for Free Trades (30 seconds)
```sql
-- Detects trades without credit deduction (free trades slipping through)
SELECT COUNT(*) as free_trades
FROM goal_session_trades t
WHERE t.created_at >= NOW() - INTERVAL '24 hours'
  AND NOT EXISTS (
    SELECT 1 FROM credit_transactions ct
    WHERE ct.user_id = t.user_id
      AND ct.transaction_type = 'signal_deduction'
      AND ct.created_at BETWEEN t.created_at - INTERVAL '10 seconds' AND t.created_at + INTERVAL '2 seconds'
  );
```

**Expected**: `0`
**Red Flag**: Any number > 0 → **FIX NOT WORKING, FREE TRADES EXIST**

---

## ✅ What Success Looks Like

### Hour 1 After Deployment
- ✅ Deduction success rate: >95%
- ✅ Every trade has matching deduction
- ✅ Zero phantom deductions
- ✅ Zero free trades
- ✅ Users see toast errors when blocked

### Hour 24 After Deployment
- ✅ Credit distribution spreading out (users at 40, 30, 20, 10 credits)
- ✅ Some users at 0 credits (normal)
- ✅ First credit purchases appearing
- ✅ Blocked sessions logged correctly

### Day 7 After Deployment
- ✅ Steady credit burn rate
- ✅ Conversion to paid credits >50%
- ✅ Revenue growing daily
- ✅ No system errors or anomalies

---

## 🚨 Rollback Triggers

**Rollback immediately if:**

1. **Deductions Not Happening**
   ```
   Symptom: Trades executing but 0 credit deductions
   Query Result: successful_deductions = 0 but total_trades > 0
   Impact: Critical revenue loss continues
   ```

2. **Phantom Deductions**
   ```
   Symptom: Credits deducted without trades created
   Query Result: phantom_deductions > 0
   Impact: Users losing credits unfairly
   ```

3. **System Errors**
   ```
   Symptom: Error rate >5% in logs
   Query Result: failed_deductions / total_attempts > 0.05
   Impact: System instability
   ```

4. **User Reports**
   ```
   Symptom: Multiple users reporting blocked legitimate trades
   Source: Support tickets, feedback
   Impact: Poor user experience
   ```

---

## 🔄 Rollback Procedure

### If You Need to Rollback:

**1. Trigger Rollback Deploy (2 minutes)**
```bash
# Contact dev team or run:
curl -X POST https://api.netlify.com/build_hooks/[ROLLBACK_HOOK]
```

**2. Verify Rollback (1 minute)**
```bash
# Check deployment status
# Wait for "Deploy successful" notification
```

**3. Notify Users (1 minute)**
```
Admin announcement:
"Credit system temporarily disabled for maintenance.
All trades currently free. Fix coming soon."
```

**4. Document Issues (5 minutes)**
- Save query results showing the issue
- Screenshot any errors
- Note user reports
- Share with dev team

**Total Rollback Time**: ~5 minutes

---

## 📊 Monitoring Locations

### Supabase SQL Editor
- URL: `https://supabase.com/dashboard/project/[project-id]/editor`
- Use for: Running verification queries
- Frequency: Hourly first day, then daily

### Admin Dashboard
- URL: `https://pipnosis.com/admin`
- Use for: Real-time user credit balances
- Check: Credit transactions, blocked sessions

### Application Logs
- Location: Browser console on live site
- Look for: `[Entry Execution] ✅ Credits deducted`
- Red flags: Error toasts, failed deductions

### Error Tracking
- Check for: New error patterns
- Monitor: Entry execution coordinator errors
- Alert threshold: >5% error rate

---

## 📝 Verification Checklist

### 1 Hour After Deploy
- [ ] Health dashboard query shows successful deductions
- [ ] Success rate >95%
- [ ] Zero phantom deductions
- [ ] Zero free trades
- [ ] Balance accuracy check passes

### 24 Hours After Deploy
- [ ] Credit distribution spreading across ranges
- [ ] Some users at 0 credits (normal)
- [ ] Credit purchases starting to appear
- [ ] Blocked sessions logged
- [ ] No user complaints about unfair blocking

### 7 Days After Deploy
- [ ] Steady credit burn rate trend
- [ ] >50% conversion to paid credits
- [ ] Revenue growing daily
- [ ] No system anomalies detected
- [ ] User feedback positive

---

## 🆘 Who to Contact

### If Queries Show Problems
**Contact**: Development Team
**Provide**: Query results, error logs, user reports
**Urgency**: Immediate if rollback triggers met

### If Users Complaining
**Contact**: Support Team
**Document**: User ID, timestamp, specific issue
**Escalate**: To dev team if pattern detected

### If Revenue Not Growing
**Contact**: Business Team
**Analyze**: User behavior, pricing strategy
**Timeline**: After 7 days of data

---

## 💡 Quick Tips

### Reading Query Results
```
phantom_deductions = 0     ✅ Good
phantom_deductions > 0     ❌ Bad - users losing credits

free_trades = 0            ✅ Good
free_trades > 0            ❌ Bad - revenue leak

success_rate >= 95%        ✅ Good
success_rate < 90%         ⚠️ Investigate
success_rate < 80%         ❌ Critical issue
```

### Common False Alarms
```
❌ "Some failed deductions"
✅ Normal - users with <10 credits will fail (by design)

❌ "Zero purchases after 1 hour"
✅ Normal - users need time to deplete free credits

❌ "User at 0 credits can't trade"
✅ Normal - system working as intended
```

### When to Panic vs. Monitor
```
🚨 PANIC (Rollback):
- Zero deductions but trades executing
- Phantom deductions found
- System error rate >5%

⚠️ MONITOR (Investigate):
- Success rate 90-95%
- Slow credit purchases
- User feedback about pricing

✅ NORMAL:
- Some deduction failures (<10 credits users)
- Users complaining about 0 credits
- Blocked session count >0
```

---

**Quick Start**: Run Step 1 query above → Check for `0` in Steps 2 & 3 → You're done!

**Full Verification**: Use `scripts/verify-credit-deduction-fix.sql` for comprehensive analysis

**Need Help**: See `CCIP_CREDIT_DEDUCTION_FIX_PLAN.md` for detailed documentation
