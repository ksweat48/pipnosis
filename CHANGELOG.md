# Pipnosis Platform Changelog

This document tracks major system changes, implementations, and bug fixes. Detailed documentation for each change is archived in `docs/archive/`.

## System Architecture Changes

### Single Source of Truth (SSOT) Implementation
- **Snapshot SSOT System**: All market data queries now flow through a unified snapshot cache
- **Entry Intent SSOT**: Consolidated entry management into single authority
- **Risk Limits SSOT**: Unified risk calculation and validation
- **PnL Calculation SSOT**: Single source for profit/loss calculations across all systems
- **Constraint Authority**: Centralized trade constraint validation

### Cache & Performance Optimizations
- **3-Tier Cache System**: Platform-wide, session, and request-level caching
- **Market Snapshot Cache**: Eliminates duplicate database queries (80-90% reduction)
- **Freshness Circuit Breaker**: Prevents stale data from reaching trading decisions
- **Intelligent Cache Warming**: Pre-loads frequently accessed market data
- **Rate Limit Optimizations**: Reduced API calls while maintaining data quality

### Trading Intelligence Systems

#### Alpha Brain (Coordinator)
- **Final Authority**: Alpha has ultimate decision power on all trades
- **Entry Execution Intelligence**: Monitors and optimizes entry timing
- **Learning Feedback Loop**: Tracks and learns from every trade decision
- **Meta-Learning**: Identifies patterns in successful vs failed trades
- **Constraint Learning**: Adapts constraints based on historical performance

#### Omega Council (Specialists)
- **Omega 7**: Market context and sentiment analysis
- **Omega 8**: Hybrid order flow analysis
- **Omega 9**: Hallucination and constraint validation
- **Omega 10**: Meta-reasoning and decision quality scoring
- **Deterministic Voting**: All Omega votes computed fresh (not cached)

### Entry Management System
- **Entry Intent Lifecycle**: Complete state machine for trade entry monitoring
- **Entry Qualification Score (EQS)**: 75-point scoring system for entry quality
- **Urgency Phase Timer**: Time-based urgency tracking for entry execution
- **Viability Monitoring**: Real-time tracking of entry condition validity
- **Monitor Mode**: Tracks entry opportunities without executing

### Risk Management
- **Professional Risk Dashboard**: Comprehensive risk metrics and controls
- **Volatility-Aware Patience**: Adjusts wait times based on market volatility
- **Adaptive Risk Manager**: Dynamic position sizing based on market conditions
- **Goal Feasibility Resolver**: Validates goal achievability before session start
- **Emergency Position Recovery**: Handles orphaned trades and stuck positions

### Goal-Based Trading
- **Smart Goal Sessions**: AI-powered goal tracking and achievement
- **Feasibility Classification**: Validates if goals are achievable with current balance
- **Intelligence Classification**: Scores goal complexity and risk
- **Progress Tracking**: Real-time goal achievement monitoring
- **Achievement Rewards**: Badge system for goal completion

### Data Quality & Reliability
- **Market Schedule System**: Handles market hours, holidays, and weekend protection
- **Candle Quality Validator**: Ensures data integrity before trading decisions
- **Gap Detection & Filling**: Identifies and fills missing historical data
- **Realtime Price Monitoring**: WebSocket-based live price updates
- **Data Integrity Validation**: Multi-layer validation of all market data

### User Experience
- **Push Notifications**: Browser notifications for critical trading events
- **Session Continuation**: Intelligent prompts to continue or start new sessions
- **Wellness Checks**: Periodic position health monitoring
- **Modal Queue System**: Prioritized user action prompts
- **Admin Dashboard**: Comprehensive platform monitoring and user management

## Major Bug Fixes & Improvements

### Critical Fixes
- **PnL Calculation Accuracy**: Fixed multiple PnL calculation inconsistencies
- **Position Sizing**: Corrected crypto and forex position size calculations
- **Pip Value Calculations**: Fixed pip calculations for gold, crypto, and forex pairs
- **Entry Execution Deadlocks**: Resolved concurrent execution conflicts
- **Session Timeout Issues**: Fixed 15-minute timeout enforcement
- **Orphaned Trades**: Automatic detection and cleanup of stuck positions
- **Balance Reconciliation**: Corrected balance calculation discrepancies

### Performance Improvements
- **Database Load Optimization**: Reduced query count by 80-90%
- **Polling Coordination**: Centralized and optimized real-time polling
- **Chart Performance**: Dramatically improved chart rendering speed
- **LLM Cost Reduction**: 50-70% reduction through intelligent caching
- **Memory Management**: Optimized chart memory usage

### Data Quality Fixes
- **Crypto Candle Fixes**: Corrected BTC/ETH candle data handling
- **Realtime Aggregation**: Fixed candle freezing and stale data issues
- **Websocket Reliability**: Improved connection handling and reconnection
- **Price Drift Detection**: Prevents trading on stale prices
- **ATR Unit Consistency**: Fixed ATR calculation discrepancies

### UI/UX Improvements
- **Admin Dashboard Refresh**: Real-time updates and better clarity
- **Chart System**: Fixed multiple chart rendering and data issues
- **Entry Quality Monitor**: Improved visibility and status tracking
- **Notification System**: Enhanced notification reliability and types
- **Modal Flow**: Fixed continuation modal and session-ended dialogs

## System Constraints & Safety

### Hard Block Rules
- No trading during major economic events
- Weekend protection (no new trades Friday close to Sunday open)
- Maximum position size limits by risk mode
- Minimum EQS thresholds for entry execution
- ATR-based stop loss requirements

### Trade Styles
- **Scalper**: Quick entries/exits, tight stops
- **Intraday**: Within-day trades, moderate holds
- **Swing Removed**: Only intraday and scalper supported

### Risk Modes
- **Conservative**: 0.5% risk per trade, strict constraints
- **Moderate**: 1.0% risk per trade, balanced approach
- **Aggressive**: 2.0% risk per trade, relaxed constraints

## Migration History

Database schema evolution is tracked in `supabase/migrations/`. Major schema changes include:

- **Initial Schema** (20251016): Consolidated base tables
- **Professional Risk** (20251215): Risk management system
- **Alpha Authority** (20251215): Alpha brain decision framework
- **Entry Intent System** (20260109+): Entry monitoring and execution
- **Goal Intelligence** (20251224): Goal classification and feasibility
- **Learning Systems** (20251223+): AI learning and pattern recognition

## Deprecated Features

- **Alpha Scout**: Removed in favor of direct snapshot caching
- **Swing Trading**: Removed to focus on intraday strategies
- **Timeframe System**: Simplified to single timeframe approach
- **Separate Simulated Positions**: Merged into unified positions table

## Environment & Deployment

### Required Environment Variables
- Supabase: URL, anon key, service role key
- MetaAPI: Token, account ID, region
- OpenAI: API key for LLM calls
- Push Notifications: VAPID keys for browser notifications

### Deployment Platform
- Frontend: Netlify (continuous deployment)
- Database: Supabase (PostgreSQL with real-time)
- Functions: Netlify serverless functions
- APIs: MetaAPI for forex data, Kraken for crypto

## Documentation

Detailed documentation for specific features and fixes is available in:
- `docs/archive/` - Historical implementation and fix documentation
- `docs/` - Current architecture and system documentation
- `README.md` - Quick start and overview
- `ARCHITECTURE.md` - System design and patterns

## Version Notes

This is a living platform under active development. All changes prioritize:
1. Data integrity and accuracy
2. User fund safety
3. System reliability
4. Performance optimization
5. Code maintainability

For questions or issues, refer to archived documentation or contact support.
