# Pipnosis Autonomous Co-Pilot System

## Overview

The Pipnosis Autonomous Co-Pilot is a fully autonomous AI trading system that operates independently after an initial user prompt. It combines the Flow Trader V2 strategy with GPT-4o reasoning, adaptive risk management, and continuous learning to achieve high win rates while protecting capital.

## Core Features

### 1. Flow Trader V2 Strategy (Baseline)

The default strategy uses multi-timeframe analysis with phase-gated execution:

**Phase 1: H1 Macro Intel**
- Determines directional bias from H1 candlestick
- Only looks for BUY signals when H1 is bullish
- Only looks for SELL signals when H1 is bearish
- Provides high-level market context

**Phase 2: M5 Tactical Alignment**
- HalfTrend indicator for trend confirmation
- Stochastic RSI for pullback/OTE detection
- Linear Regression Signal Line for price position
- All filters must pass before proceeding

**Phase 3: M1 Precision Entry**
- Heikin Ashi color flip for momentum confirmation
- RSI crossing for strength validation
- Signal Line position for structure confirmation
- CHoCH (Change of Character) detection for structure shifts

### 2. Enhanced Reasoning Engine (GPT-4o)

Every signal is evaluated by GPT-4o for strategic reasoning:

- **Signal Quality Assessment**: Validates Flow V2 setup quality
- **Timing Analysis**: Determines if this is the RIGHT TRADE at the RIGHT TIME
- **Goal Alignment**: Ensures trade aligns with user goals and timeframe
- **Risk Evaluation**: Assesses if risk is appropriate for current conditions
- **Adaptive Recommendations**: Suggests modifications or strategic switches

**Key Outputs:**
- Strategy selection (Flow V2 or alternative)
- Conviction score (0-100)
- Execute/Skip decision
- Plain English rationale
- Risk assessment
- Optional adjustments to SL/TP/size

### 3. Countdown and Auto-Execution

**Countdown Flow:**
1. Signal detected → Notification sound plays
2. Email sent with trade plan and countdown (2-5 minutes configurable)
3. In-app thread shows live countdown with cancel button
4. On expiry: Auto-executes simulated trade (unless user cancels)
5. Alarm sound + email confirmation on execution

**User Control:**
- Can stop any countdown before expiry
- Can manually close any position anytime
- Countdown extends if email delivery fails

### 4. Adaptive Trade Management

**Real-Time Monitoring (every 5-10 seconds):**
- Breakeven Move: At +1R, close 50% and move SL to entry
- Trailing Stop: Activate at +0.75R, trail dynamically
- Partial Takes: Scale out at profit milestones
- Early Exit: Detect momentum flips and structure breaks
- Signal Line Exit: Close immediately if M1 price crosses Signal Line against position

**Adaptive Adjustments:**
- Tighten SL when momentum extends favorably
- Exit early on defensive triggers (news, volatility spike, structure failure)
- Switch to capital preservation mode if conditions deteriorate

### 5. Risk Management and Safety

**Adaptive De-Risking:**
- After 2 losses: Risk per trade reduced by 50%
- After 10% MDD: Defensive Mode activated automatically
- Concurrent trade limits per risk mode (Low: 1, Medium: 2, High: 3)
- Minimum R:R ratio enforced (never below 1.5)
- No multiple positions on same symbol

**Defensive Mode:**
- Triggered by loss streaks or max drawdown
- Halves risk per trade
- Increases minimum confidence threshold
- Focuses on capital preservation over growth
- Auto-deactivates after recovery (3+ trades with 60%+ win rate)

### 6. Learning Layer

**Pattern Memory:**
- Records every trade with full feature vector
- Tracks win/loss, R:R, MAE/MFE, duration, time of day, market conditions
- Adjusts confidence thresholds based on performance
- Identifies best performing setups, times, and symbols

**Performance Tracking:**
- Win rate, expectancy, average R:R per strategy/symbol
- Auto-tunes entry criteria when win rate falls below target
- Lowers confidence threshold when performance exceeds expectations
- Generates daily "What I learned today" summaries

### 7. Communication Hub

**Thread (Continuous In-App):**
- Reasoning for every decision
- Live countdown status
- P/L updates
- SL/TP adjustments with explanations
- Partial closes and hedges
- Regime changes and strategy switches
- Timestamps in America/New_York timezone

**Email (Critical Only):**
- Countdown started (with cancel button)
- Trade executed
- TP/SL/Early exit achieved
- Strategy upgrade requiring user action
- Defensive mode activation/deactivation

**Sounds:**
- Notification: Executable trade found
- Alarm: Open, close, TP, SL, or forced exit events

## System Architecture

```
User Prompt
    ↓
Goal Session Created
    ↓
Autonomous Scanner Starts (10-30s intervals)
    ↓
┌─────────────────────────────────────────┐
│   For Each Symbol in Watchlist:         │
│                                          │
│   1. Flow V2 Strategy Analysis          │
│      - H1 Bias Check                    │
│      - M5 Filter Validation             │
│      - M1 Execution Confirmation        │
│                                          │
│   2. GPT-4o Reasoning Engine            │
│      - Signal Quality Assessment        │
│      - Market Regime Analysis           │
│      - Goal Alignment Check             │
│      - Execute/Skip Decision            │
│                                          │
│   3. If Execute Decision:               │
│      ├─ Risk Management Assessment      │
│      ├─ Position Size Calculation       │
│      ├─ Countdown Orchestrator          │
│      │   ├─ Notification Sound          │
│      │   ├─ Email Countdown             │
│      │   └─ In-App Timer                │
│      └─ Auto-Execution on Expiry        │
│          └─ Alarm Sound + Confirmation  │
│                                          │
│   4. Trade Monitor Loop (5-10s):        │
│      ├─ Breakeven Move (+1R)            │
│      ├─ Trailing Stop (+0.75R)          │
│      ├─ Partial Takes (milestones)      │
│      ├─ Signal Line Exit Detection      │
│      └─ Early Exit on Momentum Flip     │
│                                          │
│   5. On Trade Close:                    │
│      ├─ Learning Layer Records Pattern  │
│      ├─ Strategy Performance Updated    │
│      ├─ Defensive Mode Check            │
│      └─ Session Progress Updated        │
└─────────────────────────────────────────┘
```

## Database Schema

**New Tables:**
- `countdown_state` - Active countdown timers
- `flow_v2_signals` - Flow V2 signal data
- `learning_patterns` - Pattern memory for ML
- `strategy_performance` - Per-strategy/symbol stats
- `defensive_mode_log` - Defensive mode history
- `email_queue` - Email delivery queue
- `sound_preferences` - User audio preferences
- `session_metrics_snapshot` - Real-time session KPIs
- `reasoning_log` - GPT-4o decision history
- `strategy_switches` - Strategy change log

**Enhanced Tables:**
- `goal_sessions` - Added autonomous mode fields
- `goal_session_trades` - Added Flow V2 tracking fields

## Services and Modules

### Core Services
1. **Flow Trader V2 Strategy** (`src/strategies/flow-trader-v2.ts`)
   - Multi-timeframe analysis
   - Phase-gated execution logic
   - Confidence scoring

2. **Autonomous Reasoning Engine** (`src/services/autonomous-reasoning-engine.ts`)
   - GPT-4o integration
   - Market regime detection
   - Profit Preservation Index (PPI)
   - Strategy switching logic

3. **Countdown Orchestrator** (`src/services/countdown-orchestrator.ts`)
   - Countdown state management
   - Auto-execution scheduling
   - Cancel handling

4. **Sound Notification Service** (`src/services/sound-notification-service.ts`)
   - Browser audio management
   - Notification permissions
   - Volume controls

5. **Autonomous Goal Scanner** (`src/services/autonomous-goal-scanner.ts`)
   - Session orchestration
   - Scan interval management
   - Component integration

6. **Learning Layer** (`src/services/learning-layer.ts`)
   - Pattern recording
   - Performance tracking
   - Insight generation

7. **Risk Management Service** (`src/services/risk-management-service.ts`)
   - Defensive mode logic
   - Position sizing
   - MDD calculation

### Indicator Library
**Technical Indicators** (`src/strategies/indicators.ts`)
- Heikin Ashi conversion
- HalfTrend calculation
- Stochastic RSI
- Linear Regression Signal Line
- EMA, MACD, ATR

## Configuration

### Session Configuration
```typescript
{
  goalType: 'profit_target' | 'percentage_gain' | 'account_growth',
  targetValue: number,
  timeframe: string,
  riskMode: 'low' | 'medium' | 'high',
  autoExecute: boolean,
  countdownDuration: number (seconds, default: 180),
  watchlist: string[] (default: ['XAUUSD', 'US30', 'EURUSD', 'USDJPY', 'GBPUSD']),
  maxConcurrentTrades: number (based on risk mode)
}
```

### Risk Mode Parameters
- **Low**: 3% risk, 1 concurrent trade max, 85% min confidence
- **Medium**: 5% risk, 2 concurrent trades max, 75% min confidence
- **High**: 10% risk, 3 concurrent trades max, 70% min confidence

## Usage

### Starting an Autonomous Session

1. User submits goal prompt: "Make $500 today with medium risk"
2. System creates goal session with parsed parameters
3. Autonomous scanner activates immediately
4. User receives confirmation in thread with scan cadence
5. System operates fully autonomously until goal reached or session expired

### Handling Countdowns

**User Actions:**
- View countdown in real-time in thread
- Click "Cancel" button to stop auto-execution
- Countdown extends automatically if email fails
- User can manually close position anytime after execution

### Monitoring Active Session

**Thread provides:**
- Real-time reasoning for every decision
- "Why I'm scanning" / "Why I'm waiting" updates
- Countdown status with time remaining
- Trade execution confirmations
- P/L updates
- SL/TP adjustments with explanations
- Strategy switches with reasoning

**Email notifications for:**
- Countdown started (critical decision point)
- Trade executed
- Take Profit hit
- Stop Loss hit
- Early exit triggered
- Defensive mode activated

## Performance Metrics

### Session-Level KPIs
- Total trades executed
- Win rate percentage
- Average risk:reward realized
- Maximum drawdown
- Time to first trade
- Trades per session

### Strategy-Specific Metrics
- Win rate by strategy (Flow V2, Trend Rider, etc.)
- Expectancy by strategy/symbol
- Average trade duration
- Confidence threshold adjustments
- Best performing timeframes

### Risk Metrics
- Loss streaks
- Recovery factor
- Defensive mode activations
- Concurrent trade peaks
- Position sizing adjustments

## Safety Features

1. **Hard Limits:**
   - Minimum R:R 1.5
   - Maximum concurrent trades enforced
   - No duplicate symbol positions
   - Spread/slippage breach detection

2. **Soft Limits:**
   - Confidence thresholds (adaptive)
   - Risk per trade (adaptive)
   - Scan intervals (based on risk mode)
   - News blackout windows (optional)

3. **Emergency Controls:**
   - User can cancel any countdown
   - User can close any position anytime
   - Defensive mode auto-activates on risk triggers
   - System pauses on repeated failures

## Future Enhancements

### Planned Features
- Email service integration (Resend/SendGrid)
- Additional strategy archetypes (Trend Rider, Range Sniper, Scalper, Counterstriker)
- Strategy switching automation
- News event integration
- Advanced learning with neural networks
- Multi-session portfolio management

### Integration Points
- MetaAPI for live market data (already implemented)
- OpenAI GPT-4o for reasoning (implemented)
- Supabase for data persistence (implemented)
- Email provider (to be integrated)
- Browser notifications and audio (implemented)

## Troubleshooting

### Common Issues

**Countdown not starting:**
- Check if another countdown is active
- Verify max concurrent trades not reached
- Ensure confidence threshold met for risk mode

**No signals detected:**
- Confirm market data is flowing (check market_data table)
- Verify symbols in watchlist are valid
- Check if defensive mode is active (higher thresholds)

**Defensive mode stuck:**
- Requires 3+ trades with 60%+ win rate to deactivate
- Check recent trade history
- May need manual override via session management

**GPT-4o not responding:**
- Verify VITE_OPENAI_API_KEY is set
- Check token usage limits (50K per session max)
- System falls back to rule-based logic automatically

## Technical Requirements

- Node.js 18+
- React 18+
- Supabase account with database
- OpenAI API key for GPT-4o
- MetaAPI account for market data
- Modern browser with Web Audio API support

## Conclusion

The Pipnosis Autonomous Co-Pilot provides a complete autonomous trading solution with:
- ✅ Flow Trader V2 strategy as baseline
- ✅ GPT-4o reasoning for every decision
- ✅ Countdown system with user control
- ✅ Adaptive risk management
- ✅ Continuous learning
- ✅ Full transparency via thread and email
- ✅ Sound notifications
- ✅ Defensive mode protection

The system operates autonomously after a simple user prompt, scanning continuously, reasoning strategically, managing risk adaptively, and learning from outcomes—all while keeping the user informed and in control.
