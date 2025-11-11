# Auto-Backtest System - Complete Guide

## 🚀 Overview

The Auto-Backtest System is an intelligent, autonomous AI training engine that runs continuous synthetic backtests to rapidly accelerate AI learning. It features dynamic health monitoring, automatic cooldown management, and seamless integration with live trading.

## ✨ Key Features

### 1. **Fully Autonomous Operation**
- Runs continuously until manually stopped
- No manual intervention required
- Auto-resumes after cooldowns
- Automatically pauses for live trades

### 2. **Intelligent Health Monitoring**
- Real-time system stress scoring (0-100%)
- Database response time tracking
- Error rate monitoring
- Automatic early cooldown triggers when stress detected

### 3. **Dynamic Cooldown Management**
- Standard cooldown: After 100 consecutive backtests (15 minutes)
- Early cooldown triggers:
  - System stress ≥ 80%: 15-minute cooldown
  - Database response time ≥ 5 seconds: 10-minute cooldown
  - Error rate ≥ 10%: 10-minute cooldown
  - 3+ consecutive errors: 20-minute cooldown

### 4. **Live Trading Integration**
- Automatically detects when live demo trades start
- Pauses auto-backtesting immediately
- Resumes automatically when live trade closes
- No conflicts or interference

### 5. **Randomized Training**
- Test duration: Random 1-3 days
- Risk levels: Randomly rotates between low, medium, high
- All pairs tested: EURUSD, XAUUSD, GBPUSD, USDJPY, US30
- Market scenario: Always "mixed" for diverse learning
- Delay between tests: Random 1-20 seconds

### 6. **Synthetic Data Generation**
- Generates fresh, unique synthetic candles for each backtest
- Realistic market behavior with randomized volatility
- No need for historical data backfilling
- Fast generation and testing cycles

## 🎯 How It Works

### Starting the System
1. Navigate to **AI Training & Backtesting Lab**
2. Click the **"Auto-Backtest"** tab
3. Click **"Start Auto-Backtest"**
4. System begins running immediately

### What Happens Next
1. **Session Generation**: Creates unique session name (e.g., `Auto-BT-2025-11-11-143025`)
2. **Parameter Randomization**: Selects random duration (1-3 days) and risk level (low/medium/high)
3. **Synthetic Data**: Generates unique synthetic market data for the test period
4. **Backtest Execution**: Runs complete backtest with all 5 pairs
5. **AI Learning**: Extracts patterns, insights, and updates skill progression
6. **Random Delay**: Waits 1-20 seconds before next backtest
7. **Repeat**: Goes back to step 1

### Cycle Management
- Runs 100 consecutive backtests per cycle
- After 100 tests: 15-minute cooldown (automatic)
- System automatically resumes after cooldown ends
- Cycle counter resets to 0 after cooldown

### Health-Based Interventions
The system continuously monitors its own health and triggers early cooldowns if:
- Database becomes slow (response time > 5 seconds)
- Error rate increases (> 10%)
- System stress score exceeds 80%
- Multiple consecutive errors occur

### Live Trading Priority
- Every 3 seconds, checks for open live demo trades
- If live trade detected: Immediately pauses auto-backtesting
- If live trade closes: Automatically resumes auto-backtesting
- No data conflicts or resource competition

## 📊 Dashboard Metrics

### Total Backtests Completed
- Running total of all successful auto-backtests
- Persists across sessions
- Shows overall AI training volume

### Current Cycle (X / 100)
- Progress toward next cooldown
- Resets to 0 after each cooldown
- Warning appears when approaching 80+

### System Stress (0-100%)
- Real-time health indicator
- **Green (0-60%)**: Healthy operation
- **Yellow (60-80%)**: Moderate stress
- **Red (80-100%)**: High stress, cooldown may trigger

### Training Status
- **Active**: System is running auto-backtests
- **Inactive**: System is stopped

### Status Indicators
- 🟢 **Running Auto-Backtests**: Actively executing tests
- 🔵 **In Cooldown Period**: Taking a break, shows countdown
- 🟡 **Paused for Live Trade**: Waiting for live trade to complete
- ⚪ **Stopped**: Not running

## 🔧 Configuration

### Default Settings (Optimized for Fast Learning)
```javascript
{
  maxConsecutiveRuns: 100,          // Backtests per cycle
  standardCooldownMinutes: 15,      // Standard cooldown duration
  maxStressScore: 80,               // Trigger early cooldown
  maxDbResponseMs: 5000,            // Max acceptable DB latency
  maxErrorRatePercent: 10.0,        // Max error rate before cooldown
  maxConsecutiveErrors: 3,          // Max errors before cooldown
  minDurationDays: 1,               // Min backtest duration
  maxDurationDays: 3,               // Max backtest duration
  delayBetweenRunsMinSeconds: 1,    // Min delay between tests
  delayBetweenRunsMaxSeconds: 20    // Max delay between tests
}
```

### Customizing Settings
Configuration is stored in the `auto_backtest_config` table and can be adjusted per user:
1. Connect to Supabase database
2. Update the config row for your user
3. Changes take effect on next system start

## 📈 Session History Enhancements

### Enhanced Display
Past backtest sessions now show:
- **Duration**: Number of days tested (e.g., "2 days")
- **Risk Level**: Badge showing LOW, MEDIUM, or HIGH risk
- **Pairs Tested**: Number of currency pairs in the test
- **Session Type**: AUTO badge for auto-generated backtests
- **Scenario**: SYNTHETIC or REAL DATA badge
- **P&L**: Total profit/loss from the session

### Auto-Backtest Identification
- Sessions starting with `Auto-BT-` are marked with green "AUTO" badge
- Easily distinguish between manual and automated tests
- All auto-backtests are synthetic by default

## ⚙️ Database Schema

### Tables Created

#### `auto_backtest_controller`
Tracks the auto-backtest system state for each user:
- Current status (running/stopped/paused/cooldown)
- Cycle progress and total backtests completed
- Health metrics (stress score, DB response time, error counts)
- Cooldown status and timestamps

#### `auto_backtest_health_log`
Time-series health metrics:
- Stress score snapshots
- Database response times
- Error rates
- Actions taken (continue/cooldown/pause)

#### `auto_backtest_config`
Per-user configuration:
- Cycle limits and cooldown durations
- Health thresholds for early cooldown
- Randomization ranges for duration and delays

## 🎓 AI Learning Integration

### What the AI Learns From Each Backtest
1. **Pattern Recognition**: Identifies winning vs. losing setups
2. **Market Condition Handling**: Learns which strategies work in different regimes
3. **Risk Assessment**: Understands optimal position sizing and stop placement
4. **Indicator Effectiveness**: Tracks which indicators predict successful trades

### Skill Progression
- **Only winning trades count** toward skill progression
- Synthetic backtests have 0.5x weighting (compared to live trades)
- AI levels up as it accumulates successful trades
- Pattern library grows with each backtest

### Learning Metrics Updated
- `ai_skill_progression`: Trade counts and level progression
- `ai_pattern_library`: Discovered patterns and their success rates
- `ai_indicator_effectiveness`: Per-indicator success tracking
- `ai_performance_evolution`: Historical capability tracking

## 🛡️ Safety & Performance

### Database Protection
- Rate limiting built into controller
- Batch operations for efficiency
- Health monitoring prevents overload
- Automatic cooldowns protect database

### Resource Management
- Only 1 backtest runs at a time
- Synthetic data generation is optimized
- Memory-efficient batch processing
- Browser performance monitoring

### Error Handling
- Graceful degradation on errors
- Automatic retry logic
- Error tracking and cooldown triggers
- Detailed console logging for debugging

## 🚦 Getting Started

### Prerequisites
1. Admin access to AI Training & Backtesting Lab
2. Supabase database migrations applied
3. No blocking database issues

### Quick Start
```bash
1. Navigate to: AI Training & Backtesting Lab
2. Click tab: "Auto-Backtest"
3. Click button: "Start Auto-Backtest"
4. Monitor the dashboard
5. Watch the AI train automatically!
```

### Stopping the System
1. Click **"Stop Auto-Backtest"** button
2. Current backtest completes if running
3. System status changes to "Stopped"
4. All progress is saved

### Monitoring
- Dashboard updates every 3 seconds
- Health metrics logged every minute
- Console logs show detailed progress
- Session history refreshes automatically

## 🎯 Best Practices

### When to Use Auto-Backtest
- **Before live trading**: Build up AI experience
- **Overnight training**: Let it run while you sleep
- **Rapid skill building**: Accumulate hundreds of test trades quickly
- **Pattern discovery**: Find winning setups across diverse conditions

### When to Use Manual Backtest
- **Specific scenario testing**: Test particular market conditions
- **Date range analysis**: Analyze specific historical periods
- **Real data validation**: Verify with actual historical data
- **Custom configurations**: Fine-tune parameters manually

### Optimal Training Strategy
1. Start with auto-backtest for rapid learning (100-200 tests)
2. Review AI Learning Progress dashboard
3. Identify weak areas
4. Run targeted manual backtests to address weaknesses
5. Resume auto-backtest to continue general training
6. Begin live demo trading when AI shows consistent performance

## 🐛 Troubleshooting

### System Won't Start
- **Check**: Admin permissions
- **Check**: Database connection
- **Check**: No existing errors in console
- **Solution**: Refresh page and retry

### Constant Cooldowns
- **Symptom**: System keeps triggering early cooldowns
- **Cause**: Database stress or network issues
- **Solution**: Check Supabase dashboard for issues, wait longer between tests

### Paused for Live Trade (But No Trade Active)
- **Symptom**: Shows paused but no live trade visible
- **Cause**: Database sync delay
- **Solution**: Wait 5-10 seconds, should auto-resume

### Low Stress Score but Slow Performance
- **Symptom**: Stress shows green but backtests are slow
- **Cause**: External factors (network, Supabase load)
- **Solution**: System will auto-adjust, no action needed

## 📚 Console Logs

### Understanding the Logs
```javascript
[Auto-Backtest] Starting auto-backtest system...
[Auto-Backtest] Config loaded: {...}
[Auto-Backtest] Controller initialized: <uuid>
[Auto-Backtest] ========== STARTING NEW BACKTEST ==========
[Auto-Backtest] Session: Auto-BT-2025-11-11-143025
[Auto-Backtest] Duration: 2 days
[Auto-Backtest] Risk Level: medium
[Auto-Backtest] Pairs: EURUSD, XAUUSD, GBPUSD, USDJPY, US30
[Synthetic Backtest] Generating synthetic data...
[Synthetic Backtest] Generated 2880 M1 candles
[Synthetic Backtest] Running backtest analysis...
[Synthetic Backtest] ✅ Completed! Win rate: 52.3%, P&L: $245.67
[Auto-Backtest] Health: Stress 15%, DB 234ms
[Auto-Backtest] Waiting 12s before next backtest...
```

### Key Log Prefixes
- `[Auto-Backtest]`: Main controller messages
- `[Synthetic Backtest]`: Backtest execution details
- `[Synthetic]`: Data generation progress
- `[AI Learning]`: Learning analysis messages

## 🎉 Success Metrics

After running auto-backtest for a while, you should see:
- ✅ Hundreds of completed backtests
- ✅ AI skill level increasing
- ✅ Pattern library growing
- ✅ Win rate improving over time
- ✅ More confident trade recommendations
- ✅ Better risk assessment in live trading

## 🔮 Future Enhancements

Potential improvements:
- Multi-user auto-backtest queuing
- Email notifications for milestones
- Performance comparisons between auto-backtests
- Strategy A/B testing automation
- Real data auto-backtest mode
- Custom scenario programming

---

**Built with intelligence. Powered by automation. Optimized for speed.**

The Auto-Backtest System represents the future of AI trading education—continuous, intelligent, and autonomous learning that never sleeps.
