# Pipnosis Platform Architecture

## Overview

Pipnosis is an AI-powered trading platform built on a sophisticated multi-brain architecture that combines deterministic technical analysis with LLM-based strategic reasoning. The system follows **Single Source of Truth (SSOT)** principles to ensure data consistency across all components.

## Core Principles

### 1. Single Source of Truth (SSOT)
Every piece of data has exactly one authoritative source. When multiple systems need the same data, they query the same source rather than maintaining duplicates.

**Key SSOT Systems:**
- **Market Snapshot Cache**: Single source for all market data
- **Entry Intent State**: Single authority for entry decisions
- **PnL Calculation**: Unified profit/loss computation
- **Risk Constraints**: Centralized risk validation
- **Session State**: Single source for session status

### 2. Separation of Concerns
- **Brains**: Decision-making logic (Alpha, Omega council)
- **Services**: Business logic and data management
- **Components**: UI presentation layer
- **Coordinators**: Orchestration between services

### 3. Fail-Safe Design
- All trading decisions require multiple validations
- Stale data is rejected at the gate
- Stuck positions are automatically detected
- Timeouts enforce session boundaries

## System Architecture Layers

```
┌─────────────────────────────────────────────────┐
│           User Interface (React)                 │
│  Pages → Components → Hooks → Context           │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────┐
│          Application Services Layer              │
│  - Session Management                            │
│  - Trade Execution                               │
│  - Risk Management                               │
│  - Monitoring & Alerts                           │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────┐
│        Intelligence Layer (Brains)               │
│                                                   │
│  ┌─────────────────────────────────────────┐   │
│  │  Alpha (Coordinator)                     │   │
│  │  - Final decision authority              │   │
│  │  - Strategic planning                    │   │
│  │  - Learning & adaptation                 │   │
│  └──────────────┬──────────────────────────┘   │
│                 │                                │
│  ┌──────────────┴──────────────────────────┐   │
│  │  Omega Council (Specialists)            │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐      │   │
│  │  │Omega 7 │ │Omega 8 │ │Omega 9 │      │   │
│  │  │Market  │ │Order   │ │Halluc. │      │   │
│  │  │Context │ │Flow    │ │Check   │      │   │
│  │  └────────┘ └────────┘ └────────┘      │   │
│  │  ┌────────┐                             │   │
│  │  │Omega 10│                             │   │
│  │  │Meta    │                             │   │
│  │  │Reason  │                             │   │
│  │  └────────┘                             │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────┐
│            Data & Cache Layer                    │
│  - Market Snapshot Cache (SSOT)                 │
│  - LLM Response Cache                            │
│  - Platform Intelligence Cache                   │
└─────────────────────┬───────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────┐
│          Data Sources & APIs                     │
│  - Supabase (PostgreSQL + Realtime)             │
│  - MetaAPI (Forex data)                          │
│  - Kraken (Crypto data)                          │
│  - OpenAI (LLM reasoning)                        │
└──────────────────────────────────────────────────┘
```

## Key Components

### Intelligence System

#### Alpha Brain (Coordinator)
- **Role**: Strategic coordinator with final decision authority
- **Responsibilities**:
  - Aggregates Omega council votes
  - Makes final trade/no-trade decisions
  - Plans execution strategy
  - Learns from outcomes
  - Manages constraints
- **Technology**: OpenAI GPT-4 with specialized prompts
- **Caching**: Alpha decisions cached (expensive LLM calls)
- **Location**: `src/brains/coordinator-alpha.ts`

#### Omega Council (Specialists)
Each Omega is a domain expert providing one vote on market conditions:

**Omega 7: Market Context**
- Analyzes broader market sentiment
- Evaluates regime (trending vs ranging)
- Considers correlation across assets
- Location: `src/brains/omega7-market-context.ts`

**Omega 8: Hybrid Order Flow**
- Studies order flow patterns
- Identifies liquidity zones
- Detects institutional activity
- Location: `src/brains/omega8-hybrid-orderflow.ts`

**Omega 9: Hallucination Guard**
- Validates constraint compliance
- Prevents impossible scenarios
- Checks data consistency
- Location: `src/brains/omega9-hallucination-brain.ts`

**Omega 10: Meta-Reasoning**
- Evaluates decision quality
- Assesses confidence calibration
- Monitors system health
- Location: `src/brains/omega10-meta-reasoning.ts`

**Key Design Decision**: Omega votes are **deterministic** (computed fresh each time from same inputs) rather than cached. Only expensive LLM calls (Alpha) are cached.

### Service Layer

#### Session Management
- `goal-session-manager.ts`: Manages trading sessions
- `smart-goal-session-manager.ts`: Goal-based session orchestration
- `goal-session-live-engine.ts`: Real-time session execution (LARGE - needs refactoring)
- `session-learning-generator.ts`: Post-session analysis and learning

#### Trade Execution
- `trade-execution-engine.ts`: Executes validated trades
- `entry-planner.ts`: Plans optimal entry strategy
- `entry-execution-coordinator.ts`: Coordinates entry execution
- `entry-qualification-engine.ts`: Scores entry quality (EQS system)
- `unified-entry-monitor.ts`: Monitors active entry intents

#### Risk Management
- `professional-risk-manager.ts`: Comprehensive risk controls
- `adaptive-risk-manager.ts`: Dynamic risk adjustment
- `volatility-adjusted-risk.ts`: Volatility-based position sizing
- `risk-preflight-gate.ts`: Pre-trade risk validation
- `execution-eligibility-gate.ts`: Final execution approval

#### Market Data
- `market-snapshot-cache.ts`: **SSOT** for all market data
- `candle-data-service.ts`: Candle retrieval and aggregation
- `realtime-sltp-monitor.ts`: Live price monitoring
- `market-schedule-service.ts`: Trading hours and holidays

#### Intelligence Coordination
- `shared-intelligence-coordinator.ts`: Coordinates cache and intelligence
- `alpha-omega-orchestrator.ts`: Orchestrates Alpha + Omega workflow
- `global-intelligence-provider.ts`: Provides market intelligence platform-wide

#### Learning Systems
- `ai-learning-engine.ts`: Core learning loop
- `ai-skill-tracker.ts`: Tracks AI capability growth
- `alpha-learning-tracker.ts`: Alpha-specific learning
- `continuous-learning-loop.ts`: Real-time learning from trades

### Data Flow

#### Trade Decision Flow
```
1. User starts goal session
2. Goal Scanner identifies opportunities
   ↓
3. Multi-Symbol Snapshot Builder creates market snapshots
   ↓
4. Shared Intelligence Coordinator checks cache
   ↓
5. Omega Council votes (deterministic, computed fresh)
   ↓
6. Alpha Brain makes strategic decision (cached if possible)
   ↓
7. Entry Planner creates execution strategy
   ↓
8. Risk Preflight Gate validates safety
   ↓
9. Execution Eligibility Gate gives final approval
   ↓
10. Trade Execution Engine places order
    ↓
11. Position Monitor tracks position
    ↓
12. Learning Systems analyze outcome
```

#### Entry Monitoring Flow
```
1. Entry Intent created with conditions
   ↓
2. Unified Entry Monitor tracks in real-time
   ↓
3. Entry Urgency Calculator tracks time decay
   ↓
4. Entry Quality Monitor scores conditions (EQS)
   ↓
5. When conditions met + EQS sufficient:
   → Entry Execution Coordinator triggers execution
   ↓
6. Post-execution: Learning systems update
```

### Caching Strategy

#### 3-Tier Cache System

**Tier 1: Platform-Wide Cache** (Supabase tables)
- `omega_market_intelligence`: Omega votes (deprecated - now computed fresh)
- `alpha_strategic_cache`: Alpha LLM decisions
- `platform_intelligence`: Shared market insights
- **TTL**: 5-15 minutes depending on data type
- **Benefit**: Reduces DB queries across all users

**Tier 2: Session Cache** (In-memory)
- Market snapshots during active session
- Entry intent state
- Position monitoring data
- **TTL**: Session lifetime
- **Benefit**: Zero DB queries for repeated access

**Tier 3: Request Cache** (Function-scoped)
- Temporary data within single operation
- Prevents duplicate calculations
- **TTL**: Function execution time
- **Benefit**: Micro-optimization

### Database Schema

#### Core Tables
- `users`: User accounts and authentication
- `user_token_balance`: Credit/token tracking
- `goal_sessions`: Trading session records
- `goal_trades`: Individual trade records
- `positions`: Active positions (unified, not separated)

#### Intelligence Tables
- `alpha_strategic_cache`: Alpha LLM decision cache
- `platform_intelligence`: Platform-wide insights
- `ai_learning_history`: Learning system records
- `alpha_brain_decisions`: Decision audit trail

#### Entry System Tables
- `entry_intents`: Entry opportunities being monitored
- `entry_monitoring_logs`: Entry condition tracking
- `entry_thesis_memory`: Entry rationale storage

#### Monitoring Tables
- `goal_notifications`: User notifications
- `push_subscriptions`: Browser push notification subscriptions
- `persistent_modals`: User action queue
- `llm_token_usage`: LLM cost tracking

#### Market Data Tables
- `candles_1m`, `candles_5m`, `candles_15m`, `candles_1h`, `candles_4h`, `candles_1d`: Time-series candle data
- `realtime_prices`: Live price cache
- `market_context`: Market regime and sentiment

### Frontend Architecture

#### Pages
- `TradePage.tsx`: Main trading interface
- `SmartGoalModePage.tsx`: Goal-based trading
- `PositionsPage.tsx`: Position management
- `AdminDashboard.tsx`: Platform administration

#### Key Components
- `MarketChart.tsx`: Chart rendering (LARGE - needs refactoring)
- `GoalSessionDashboard.tsx`: Session controls (LARGE - needs refactoring)
- `ActiveEntryIntents.tsx`: Entry monitoring display
- `EntryQualityMonitor.tsx`: EQS display
- `NotificationCenter.tsx`: User notifications

#### Hooks
- `useAuth.tsx`: Authentication state
- `useEntryIntent.ts`: Entry intent management
- `useOptimizedCandles.ts`: Chart data optimization
- `useAdminDashboard.ts`: Admin data fetching

## Design Patterns

### 1. Coordinator Pattern
Coordinators orchestrate between multiple services without containing business logic themselves.

Example: `alpha-omega-orchestrator.ts` coordinates Alpha and Omega brains but doesn't make decisions.

### 2. Gate Pattern
Gates validate data/conditions and block invalid operations.

Examples:
- `risk-preflight-gate.ts`: Validates risk before trading
- `execution-eligibility-gate.ts`: Final approval gate
- `trade-execution-freshness-gate.ts`: Rejects stale data

### 3. Monitor Pattern
Monitors track state changes and trigger actions when thresholds are met.

Examples:
- `position-monitor.ts`: Tracks active positions
- `unified-entry-monitor.ts`: Monitors entry conditions
- `volatility-wait-monitor.ts`: Tracks volatility-based waits

### 4. Service Singleton Pattern
Most services export a singleton instance for consistent state.

```typescript
class MyService {
  // implementation
}

export const myService = new MyService();
```

### 5. Cache-Aside Pattern
Services check cache first, compute if miss, then store result.

```typescript
const cached = await cache.get(key);
if (cached) return cached;

const result = await computeExpensiveOperation();
await cache.set(key, result, ttl);
return result;
```

## Security

### Row Level Security (RLS)
All Supabase tables have RLS policies ensuring users can only access their own data.

### Authentication
- Supabase Auth for user management
- JWT tokens for API authentication
- Service role key for admin operations (server-side only)

### Data Validation
- All user inputs validated before database insertion
- Trade parameters validated against constraints
- Price data validated for staleness and drift

## Performance Optimizations

### Database
- Indexed columns for common queries
- Realtime subscriptions for live updates
- Connection pooling via Supabase

### Caching
- 3-tier cache reduces DB load by 80-90%
- LLM response caching saves 50-70% of costs
- Market snapshot caching eliminates redundant queries

### Frontend
- Code splitting for faster initial load
- Lazy loading of heavy components
- Memoization of expensive computations
- Virtual scrolling for large lists

## Error Handling

### Graceful Degradation
- Cache misses fall back to fresh computation
- API failures return cached data when available
- WebSocket disconnects trigger reconnection

### Circuit Breakers
- Prevent cascading failures
- Block operations when error rate is high
- Auto-reset after cooldown period

### Monitoring
- Error logging to console (development)
- LLM call tracking for cost monitoring
- System health dashboards

## Development Workflow

### Code Organization
- One responsibility per file
- Services in `src/services/`
- Brains in `src/brains/`
- Shared types in `src/types/`
- Configuration in `src/config/`

### Testing
- Unit tests for business logic
- Integration tests for data flow
- Manual testing for UI/UX

### Deployment
- Continuous deployment via Netlify
- Database migrations via Supabase
- Environment-specific configuration

## Future Improvements

### Planned Refactoring
1. Split `goal-session-live-engine.ts` (4327 lines)
2. Break down `MarketChart.tsx` (2380 lines)
3. Consolidate 15 entry management services
4. Merge 7 cache services into 2

### Architectural Enhancements
1. Extract context providers to reduce prop drilling
2. Implement event bus for loose coupling
3. Add more comprehensive error boundaries
4. Enhance realtime synchronization

## Conclusion

Pipnosis follows a layered architecture with clear separation between decision-making (brains), business logic (services), and presentation (components). The SSOT principle ensures data consistency, while the multi-tier caching system optimizes performance. The Alpha-Omega council provides both strategic reasoning and specialized analysis for robust trading decisions.
