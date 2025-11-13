# Autonomous Co-Pilot Quick Start

## Getting Started in 3 Steps

### Step 1: Set Your Goal

Navigate to the Smart Goal Mode page and tell Pipnosis what you want to achieve:

**Example Prompts:**
- "Make $500 today with medium risk"
- "Grow my account 5% this week"
- "Trade conservatively and make $200 today"
- "Best possible profit today, high risk mode"

### Step 2: Enable Auto-Execute

Check the "Auto-Execute" option when creating your goal session:
- **Countdown Duration**: Default 3 minutes (180 seconds)
- **Watchlist**: Default symbols are XAUUSD, US30, EURUSD, USDJPY, GBPUSD
- **Risk Mode**: Choose Low, Medium, or High based on your risk tolerance

### Step 3: Let Pipnosis Work

Once started, the autonomous co-pilot will:

1. **Scan** markets every 10-30 seconds (based on risk mode)
2. **Analyze** using Flow Trader V2 multi-timeframe strategy
3. **Reason** with GPT-4o about every signal
4. **Notify** you when a high-quality setup is found (sound + email)
5. **Countdown** for 2-5 minutes, giving you time to cancel
6. **Execute** automatically on countdown expiry (or when you confirm)
7. **Manage** the position with adaptive stops, partials, and trailing
8. **Learn** from every outcome to improve future decisions

## What to Expect

### During Scanning

**In the Thread:**
- "Scanning XAUUSD, US30, EURUSD, USDJPY, GBPUSD..."
- "No valid setups yet, market conditions not optimal"
- "Found potential setup on XAUUSD, analyzing..."

### When Signal Found

**You'll Receive:**
1. **Notification Sound** - Executable opportunity detected
2. **Thread Update** - Full setup details and reasoning
3. **Email** - Countdown notice with trade plan and cancel button
4. **Live Countdown** - In-app timer showing time remaining

**Signal Details Include:**
- Symbol and direction (BUY/SELL)
- Entry price, Stop Loss, Take Profit
- Risk:Reward ratio
- Confidence percentage
- Flow V2 reasoning (H1 bias, M5 filter, M1 execution status)
- GPT-4o analysis and conviction score

### During Countdown

**You Can:**
- ✅ Let it auto-execute (do nothing, wait for expiry)
- ✅ Cancel it (click "Stop Countdown" button)
- ✅ Review the reasoning and trade plan

**Countdown Will:**
- Show remaining time (e.g., "2:30")
- Update every second
- Send email notification immediately
- Extend if email delivery fails
- Cancel if you click stop

### After Execution

**Alarm Sound** plays and you receive:
- Email confirmation
- Thread update with entry details
- Real-time P/L tracking

**Position Management (Automatic):**
- At +1R: Close 50%, move SL to entry (breakeven)
- At +0.75R: Activate trailing stop
- Monitor every 5-10 seconds for:
  - Momentum shifts
  - Signal line crosses
  - Structure breaks
  - Defensive exit triggers

### When Trade Closes

**You'll Get:**
- Alarm sound
- Email summary with profit/loss
- Thread update with outcome and next steps
- Learning layer records the pattern
- Session progress updated

**Defensive Mode** may activate if:
- 2 consecutive losses occur
- Maximum drawdown reaches 10%

When active, Defensive Mode:
- Reduces risk per trade by 50%
- Increases minimum confidence threshold
- Focuses on capital preservation
- Auto-deactivates after recovery

## Understanding the Thread

The thread is your continuous communication channel with Pipnosis. It shows:

### Reasoning Updates
```
"H1 candle is bullish on XAUUSD. Looking for BUY opportunities only."

"M5 filter not met on EURUSD: Stoch RSI 45, needs < 30 and crossing up"

"Found high-conviction LONG setup on XAUUSD (86% confidence)!
Entry: 2435.20
Stop Loss: 2430.40
Take Profit: 2447.00
Risk:Reward: 1:2.45

Flow V2 Analysis: H1 bullish bias confirmed. M5 HalfTrend GREEN,
Stoch RSI oversold at 28 and crossing up, price above signal line.
M1 Heikin Ashi flipped red to green, RSI crossing up at 52,
price above signal line.

GPT-4o Reasoning: Excellent setup alignment across all timeframes.
Strong momentum with healthy structure. Risk is appropriate for
medium mode. Recommending execution.

⏱️ Auto-executing in 3:00 unless you stop it."
```

### Status Updates
```
"Scanning complete. Next scan in 20 seconds."

"Countdown active: 2:30 remaining"

"✅ Trade executed on XAUUSD! LONG at 2435.20.
Stop Loss: 2430.40, Take Profit: 2447.00.
Monitoring position actively..."

"Trade progressing well at 45% to target. Current P/L: +$45.20"

"At +1R: Closed 50% for +$48.50, moved SL to entry (breakeven)"

"Trailing stop activated at +0.75R. Securing profits..."

"🎯 Take Profit hit! Closed at 2447.00 (+2.45R).
Profit: +$118.50. Excellent execution!

Scanning for similar Flow setups..."
```

### Defensive Mode
```
"🛡️ Defensive mode activated due to loss streak.
Risk per trade reduced to 2.5%. Minimum confidence
threshold increased. Focus on capital preservation."

"✅ Defensive mode deactivated. Recovery confirmed with
67% win rate over last 3 trades. Risk parameters restored
to normal levels."
```

## Email Notifications (Critical Only)

You'll receive emails for:

1. **Countdown Started**
   - Subject: "Pipnosis will execute LONG XAUUSD in 3:00"
   - Body: Trade plan + Cancel button + Timestamp (ET)

2. **Trade Executed**
   - Subject: "Trade Executed: LONG XAUUSD"
   - Body: Entry confirmation + SL/TP + Monitoring status

3. **Trade Closed**
   - Subject: "Trade Closed: XAUUSD +$118.50"
   - Body: Outcome summary + Next steps

4. **Defensive Mode**
   - Subject: "Defensive Mode Activated"
   - Body: Trigger reason + Adjusted risk parameters

## Sound Notifications

**Notification Sound** (lighter tone):
- Executable trade opportunity found
- Configurable in settings
- Default volume: 70%

**Alarm Sound** (attention-grabbing):
- Trade executed (opened)
- Take Profit hit
- Stop Loss hit
- Early exit triggered
- Configurable in settings
- Default volume: 90%

## User Controls

### You Can Always:
- ✅ Cancel any countdown before expiry
- ✅ Manually close any position anytime
- ✅ Stop the entire session
- ✅ Adjust sound preferences
- ✅ View reasoning for every decision
- ✅ Check session metrics and KPIs

### You Cannot:
- ❌ Override countdown duration once started
- ❌ Modify SL/TP on autonomous trades (adaptive management handles this)
- ❌ Add manual trades during autonomous session (conflicts with risk management)

## Best Practices

### Starting Strong
1. Start with **Medium Risk** mode first
2. Use default watchlist (5 major pairs) initially
3. Enable email notifications
4. Set realistic profit targets
5. Let the system complete at least 5 trades before evaluating

### During Session
1. **Trust the process** - Let countdowns expire unless you have strong reason to cancel
2. **Review reasoning** - Learn from GPT-4o's analysis in thread
3. **Monitor defensively** - If defensive mode activates, trust the protection
4. **Stay informed** - Check thread regularly for updates
5. **Don't interfere** - Manual intervention disrupts risk management

### After Session
1. Review session summary and KPIs
2. Check "What I learned today" summary
3. Analyze strategy performance by symbol
4. Adjust risk mode if needed for next session
5. Review defensive mode logs if applicable

## Troubleshooting

### "No signals for a long time"
- **Normal**: Market conditions may not meet Flow V2 criteria
- **Check**: Are symbols trading (market hours)?
- **Wait**: System scans every 10-30s, quality over quantity

### "Countdown cancelled itself"
- Check if max concurrent trades was reached
- Verify session is still active
- Look for defensive mode activation

### "Defensive mode activated too early"
- System prioritizes capital preservation
- 2 losses or 10% MDD triggers it automatically
- Will deactivate after recovery (3 trades, 60%+ win rate)

### "GPT-4o reasoning not showing"
- Check OpenAI API key configuration
- System falls back to rule-based logic automatically
- Reasoning still works, just less detailed

## Support

Need help?
- Check `/AUTONOMOUS_COPILOT_GUIDE.md` for detailed documentation
- Review session logs in database
- Check reasoning_log table for GPT-4o decisions
- Monitor defensive_mode_log for risk events

## Success Metrics

A successful autonomous session typically shows:
- ✅ 75-85%+ win rate
- ✅ Average R:R above 1:2
- ✅ Maximum drawdown under 8%
- ✅ 3-5 trades per day (quality focus)
- ✅ Consistent application of Flow V2 strategy
- ✅ Adaptive risk management working
- ✅ Learning layer improving over time

Remember: **Autonomous doesn't mean hands-off**. Stay informed through the thread, but trust the system's autonomous decisions unless you have compelling reason to intervene.

---

**Ready to start?** Navigate to Smart Goal Mode and tell Pipnosis your goal!
