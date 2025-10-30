# ARCHITECTURE REFERENCE
## Pipnosis AI Trading Platform - Technical Deep Dive

**Last Updated:** October 30, 2025
**System Version:** 1.0.0
**Purpose:** Complete technical architecture documentation

---

## 📐 SYSTEM ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────────┐
│                     PIPNOSIS AI TRADING PLATFORM                 │
│                         (October 2025)                           │
└─────────────────────────────────────────────────────────────────┘

┌────────────────────────── FRONTEND LAYER ──────────────────────────┐
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  React 18 + TypeScript Application (Vite Build)              │ │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐             │ │
│  │  │  Trading   │  │   Market   │  │  Position  │             │ │
│  │  │ Dashboard  │  │   Charts   │  │  Monitor   │             │ │
│  │  └────────────┘  └────────────┘  └────────────┘             │ │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐             │ │
│  │  │  Manual    │  │     AI     │  │   Trade    │             │ │
│  │  │   Trade    │  │  Console   │  │  History   │             │ │
│  │  └────────────┘  └────────────┘  └────────────┘             │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                              │                                     │
│                              │ HTTP/WebSocket                      │
└──────────────────────────────┼─────────────────────────────────────┘
                               │
┌──────────────────────────────┼────── SERVICE LAYER ────────────────┐
│                              │                                     │
│  ┌───────────────────────────▼──────────────────────────────────┐ │
│  │            Global Services & State Management                 │ │
│  │                                                                │ │
│  │  ┌──────────────────────┐    ┌──────────────────────┐        │ │
│  │  │ Global Polling       │    │ Simulated Trading    │        │ │
│  │  │ Coordinator          │    │ Service              │        │ │
│  │  │ • 10 Forex Pairs     │    │ • Position Mgmt      │        │ │
│  │  │ • 5s Intervals       │    │ • P&L Calculation    │        │ │
│  │  └──────────────────────┘    └──────────────────────┘        │ │
│  │                                                                │ │
│  │  ┌──────────────────────┐    ┌──────────────────────┐        │ │
│  │  │ Extended Search      │    │ Position Monitor     │        │ │
│  │  │ Service              │    │ Service              │        │ │
│  │  │ • Background Scan    │    │ • Real-time Updates  │        │ │
│  │  │ • 1hr Max Duration   │    │ • Auto SL/TP Check   │        │ │
│  │  └──────────────────────┘    └──────────────────────┘        │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
┌──────────────────────────────┼────── BACKEND LAYER ────────────────┐
│                              │                                     │
│  ┌───────────────────────────▼──────────────────────────────────┐ │
│  │           Netlify Edge Functions (Serverless)                 │ │
│  │                                                                │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │ │
│  │  │ get-live-price  │  │ forex-candles   │  │ analyze-     │ │ │
│  │  │ • MetaAPI call  │  │ • Historical    │  │ market       │ │ │
│  │  │ • 8s timeout    │  │   data fetch    │  │ • AI         │ │ │
│  │  │ • Cache fallback│  │ • Bulk insert   │  │   analysis   │ │ │
│  │  └─────────────────┘  └─────────────────┘  └──────────────┘ │ │
│  │                                                                │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │ │
│  │  │ verify-metaapi- │  │ get-metaapi-    │  │ scheduled-   │ │ │
│  │  │ connection      │  │ token           │  │ refresh      │ │ │
│  │  │ • Health check  │  │ • Token cache   │  │ • Daily 2AM  │ │ │
│  │  │ • Diagnostics   │  │ • 1hr validity  │  │ • 600s limit │ │ │
│  │  └─────────────────┘  └─────────────────┘  └──────────────┘ │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
┌──────────────────────────────┼────── EXTERNAL APIS ────────────────┐
│                              │                                     │
│  ┌───────────────────────────▼──────────────────────────────────┐ │
│  │                  MetaAPI Cloud (MT5 Bridge)                   │ │
│  │                                                                │ │
│  │  REST API:  https://mt-client-api-v1.london.agiliumtrade.ai  │ │
│  │  Region:    london (Europe)                                   │ │
│  │  Auth:      Bearer token (admin → temporary tokens)           │ │
│  │  Data:      Real-time forex prices, account info             │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
┌──────────────────────────────┼────── DATA LAYER ───────────────────┐
│                              │                                     │
│  ┌───────────────────────────▼──────────────────────────────────┐ │
│  │              Supabase (PostgreSQL + Real-time)                │ │
│  │                                                                │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │ │
│  │  │ User Profiles│  │  Simulated   │  │ Realtime     │       │ │
│  │  │ • Auth       │  │  Positions   │  │ Prices       │       │ │
│  │  │ • Balance    │  │ • Open/Close │  │ • 30s Cache  │       │ │
│  │  │ • Admin Role │  │ • P&L Track  │  │ • All Pairs  │       │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘       │ │
│  │                                                                │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │ │
│  │  │ Trade History│  │  Balance     │  │ Trading      │       │ │
│  │  │ • Closed P&L │  │  Transactions│  │ Prompts      │       │ │
│  │  │ • Strategy   │  │ • Audit Log  │  │ • AI Input   │       │ │
│  │  │ • Timestamps │  │ • Full Trail │  │ • Generated  │       │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘       │ │
│  │                                                                │ │
│  │  Security: Row Level Security (RLS) on ALL tables             │ │
│  └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 DATA FLOW DIAGRAMS

### 1. Real-Time Price Polling Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    REAL-TIME PRICE POLLING                          │
└─────────────────────────────────────────────────────────────────────┘

Application Startup
        │
        ▼
┌───────────────────────┐
│ App.tsx useEffect()   │
│ Initialize Polling    │
└───────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│ globalPollingCoordinator.initialize()│
│ • Verify MetaAPI connection         │
│ • Start polling for 10 pairs        │
│ • Set 5-second intervals            │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│              FOR EACH FOREX PAIR (Every 5 seconds)          │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 1. Check if previous poll is complete                │  │
│  │    (prevent concurrent polls)                        │  │
│  └──────────────────────────────────────────────────────┘  │
│                      │                                      │
│                      ▼                                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 2. Call /.netlify/functions/get-live-price          │  │
│  │    ?symbol=EURUSD                                     │  │
│  └──────────────────────────────────────────────────────┘  │
│                      │                                      │
│                      ▼                                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 3. get-live-price.ts Function                        │  │
│  │    a. Fetch from MetaAPI (8s timeout)                │  │
│  │    b. If fail → check cache (30s window)             │  │
│  │    c. Return { bid, ask, timestamp, source }         │  │
│  └──────────────────────────────────────────────────────┘  │
│                      │                                      │
│                      ▼                                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 4. Insert into realtime_prices table                 │  │
│  │    INSERT INTO realtime_prices (                     │  │
│  │      symbol, bid, ask, mid, spread,                  │  │
│  │      broker_time, source                             │  │
│  │    )                                                  │  │
│  └──────────────────────────────────────────────────────┘  │
│                      │                                      │
│                      ▼                                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 5. Update poll status                                │  │
│  │    • lastPrice = { bid, ask }                        │  │
│  │    • lastPoll = now                                  │  │
│  │    • errorCount = 0                                  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  If error: increment errorCount                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────┐
│ MarketChart.tsx       │
│ • Subscribes to DB    │
│ • Updates chart       │
│ • Shows live price    │
└───────────────────────┘
```

### 2. Demo Trade Execution Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      DEMO TRADE EXECUTION                           │
└─────────────────────────────────────────────────────────────────────┘

User Input
        │
        ▼
┌───────────────────────────────────────┐
│ ManualTradePanel.tsx                  │
│ • User selects: symbol, action, lots  │
│ • Sets: entry, SL, TP                 │
│ • Clicks "Execute Trade"              │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ Validation                            │
│ • Check balance sufficient            │
│ • Verify SL/TP values valid           │
│ • Confirm lot size reasonable         │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ simulatedTradingService.executeTrade()                    │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ 1. INSERT INTO simulated_positions                  │ │
│  │    {                                                 │ │
│  │      user_id: userId,                               │ │
│  │      symbol: 'EURUSD',                              │ │
│  │      position_type: 'buy',                          │ │
│  │      order_type: 'market',                          │ │
│  │      lot_size: 0.1,                                 │ │
│  │      entry_price: 1.0850,                           │ │
│  │      stop_loss: 1.0800,                             │ │
│  │      take_profit: 1.0950,                           │ │
│  │      status: 'open',                                │ │
│  │      current_price: 1.0850,                         │ │
│  │      current_pnl: 0                                 │ │
│  │    }                                                 │ │
│  └─────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ Position Opened Successfully          │
│ • Notification shown                  │
│ • Balance reserved                    │
│ • Position appears in ActivePositions │
└───────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│           REAL-TIME P&L MONITORING (Every 5s)               │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ positionMonitorService (Background)                   │ │
│  │                                                        │ │
│  │ 1. Fetch all open positions for user                 │ │
│  │ 2. Get latest price from realtime_prices             │ │
│  │ 3. Calculate current P&L:                            │ │
│  │    pnl = (currentPrice - entryPrice) / pointSize     │ │
│  │          * (lotSize * contractSize / 10000)          │ │
│  │ 4. Check if SL or TP hit                             │ │
│  │ 5. If hit → auto-close position                      │ │
│  │ 6. Update current_pnl in real-time                   │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
        │
        ▼ (When SL/TP hit OR manual close)
┌─────────────────────────────────────────────────────────────┐
│ simulatedTradingService.closePosition()                     │
│                                                             │
│  1. Calculate final P&L                                    │
│  2. UPDATE simulated_positions                             │
│     SET status = 'closed',                                 │
│         current_pnl = finalPnL,                            │
│         closed_at = NOW()                                  │
│                                                             │
│  3. UPDATE user_profiles                                   │
│     SET demo_balance = demo_balance + finalPnL             │
│                                                             │
│  4. INSERT INTO balance_transactions                       │
│     (audit log of balance change)                          │
│                                                             │
│  5. INSERT INTO trade_history                              │
│     (permanent record of closed trade)                     │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ UI Updates                            │
│ • Position removed from ActivePositions│
│ • Balance updated in BalanceDisplay   │
│ • Trade appears in TradeHistory       │
│ • Notification with P&L result        │
└───────────────────────────────────────┘
```

### 3. AI Signal Generation Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AI SIGNAL GENERATION FLOW                        │
└─────────────────────────────────────────────────────────────────────┘

User enters prompt: "Find me a low-risk EUR trade"
        │
        ▼
┌───────────────────────────────────────┐
│ App.tsx handlePromptSubmit()          │
│ • Capture prompt text                 │
│ • Get user's account balance          │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ promptValidationService.validatePrompt()                  │
│ • Check if feasible with current balance                 │
│ • Validate risk parameters                               │
│ • Return isValid, isFeasible, suggestions                │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ multiSymbolScanner.analyzePrompt()    │
│ • Extract: symbols, risk, timeframe  │
│ • Returns: PromptAnalysis object      │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│ multiSymbolScanner.scanAllSymbols()                       │
│                                                           │
│  FOR EACH extracted symbol:                              │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ 1. Fetch latest price from realtime_prices          │ │
│  │ 2. Analyze market conditions                        │ │
│  │ 3. Generate TradeSignal:                            │ │
│  │    {                                                 │ │
│  │      symbol: 'EURUSD',                              │ │
│  │      direction: 'BUY' or 'SELL',                    │ │
│  │      entryPrice: 1.0850,                            │ │
│  │      stopLoss: 1.0800,                              │ │
│  │      takeProfit: 1.0950,                            │ │
│  │      riskReward: 2.0,                               │ │
│  │      confidence: 75,                                │ │
│  │      reasoning: 'Market analysis...'                │ │
│  │    }                                                 │ │
│  │ 4. Calculate opportunity score                      │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  Return: MarketOpportunity[] (sorted by score)          │
└───────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────── DECISION POINT ─────────────────────────┐
│                                                                 │
│  If opportunities found:                                        │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ • Display best opportunity in StrategyOptions             │ │
│  │ • Draw trade lines on chart (entry, SL, TP)              │ │
│  │ • User can accept/reject                                  │ │
│  │ • Show notification with confidence                       │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  If NO opportunities found:                                     │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ • Start Extended Search                                   │ │
│  │ • extendedSearchService.startExtendedSearch()             │ │
│  │ • Background scanning for up to 1 hour                    │ │
│  │ • User notified when opportunity found                    │ │
│  │ • Can cancel anytime                                      │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ User Accepts Strategy                 │
│ • Opens TradeConfirmationModal        │
│ • Shows full details                  │
│ • User confirms execution             │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│ Execute Trade                         │
│ (Follow Demo Trade Execution Flow)   │
└───────────────────────────────────────┘
```

---

## 🗄️ DATABASE SCHEMA & RELATIONSHIPS

### Core Entity Relationship Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                     DATABASE SCHEMA (Supabase)                     │
└────────────────────────────────────────────────────────────────────┘

┌─────────────────────┐
│  auth.users         │ (Supabase Auth Built-in)
│─────────────────────│
│ • id (PK)           │
│ • email             │
│ • encrypted_password│
│ • created_at        │
└─────────────────────┘
         │
         │ 1:1
         ▼
┌─────────────────────┐          ┌─────────────────────┐
│  user_profiles      │          │  simulated_positions│
│─────────────────────│          │─────────────────────│
│ • id (PK, FK)       │◄─────────│ • id (PK)           │
│ • email             │   1:N    │ • user_id (FK)      │
│ • full_name         │          │ • symbol            │
│ • avatar_url        │          │ • position_type     │
│ • plan_type         │          │ • lot_size          │
│ • demo_balance      │          │ • entry_price       │
│ • risk_profile      │          │ • stop_loss         │
│ • is_admin          │          │ • take_profit       │
│ • created_at        │          │ • status            │
│ • updated_at        │          │ • current_pnl       │
└─────────────────────┘          │ • opened_at         │
         │                       │ • closed_at         │
         │ 1:N                   └─────────────────────┘
         │                                │
         │                                │ 1:1
         ▼                                ▼
┌─────────────────────┐          ┌─────────────────────┐
│  balance_transactions│         │  trade_history      │
│─────────────────────│          │─────────────────────│
│ • id (PK)           │          │ • id (PK)           │
│ • user_id (FK)      │          │ • user_id (FK)      │
│ • transaction_type  │          │ • position_id (FK)  │
│ • amount            │          │ • symbol            │
│ • balance_before    │          │ • position_type     │
│ • balance_after     │          │ • entry_price       │
│ • position_id (FK)  │          │ • exit_price        │
│ • description       │          │ • profit_loss       │
│ • created_at        │          │ • strategy_name     │
└─────────────────────┘          │ • opened_at         │
                                 │ • closed_at         │
                                 └─────────────────────┘

┌─────────────────────┐
│  realtime_prices    │ (Market Data Cache)
│─────────────────────│
│ • id (PK)           │
│ • symbol            │
│ • bid               │
│ • ask               │
│ • mid               │
│ • spread            │
│ • broker_time       │
│ • source            │
│ • created_at        │
└─────────────────────┘

┌─────────────────────┐          ┌─────────────────────┐
│  trading_prompts    │          │  journal_entries    │
│─────────────────────│          │─────────────────────│
│ • id (PK)           │          │ • id (PK)           │
│ • user_id (FK)      │          │ • user_id (FK)      │
│ • prompt_text       │          │ • trade_id (FK)     │
│ • account_balance   │          │ • entry_type        │
│ • market_data       │          │ • title             │
│ • strategies_gen    │          │ • content           │
│ • selected_strategy │          │ • confidence_level  │
│ • ai_confidence     │          │ • metadata          │
│ • status            │          │ • created_at        │
│ • created_at        │          └─────────────────────┘
└─────────────────────┘

┌─────────────────────┐          ┌─────────────────────┐
│  extended_search_   │          │  metaapi_token_     │
│  sessions           │          │  cache              │
│─────────────────────│          │─────────────────────│
│ • id (PK)           │          │ • id (PK)           │
│ • user_id (FK)      │          │ • account_id        │
│ • prompt            │          │ • token             │
│ • status            │          │ • region            │
│ • started_at        │          │ • expires_at        │
│ • completed_at      │          │ • created_at        │
│ • result            │          └─────────────────────┘
└─────────────────────┘

┌─────────────────────┐          ┌─────────────────────┐
│  function_logs      │          │  connection_health_ │
│─────────────────────│          │  status             │
│ • id (PK)           │          │─────────────────────│
│ • function_name     │          │ • id (PK)           │
│ • event_type        │          │ • service           │
│ • status            │          │ • status            │
│ • duration_ms       │          │ • response_time_ms  │
│ • error_message     │          │ • error_message     │
│ • metadata          │          │ • last_check        │
│ • created_at        │          │ • created_at        │
└─────────────────────┘          └─────────────────────┘
```

### Table Purposes & Key Fields

#### user_profiles
**Purpose:** Extended user data and account management
**Key Fields:**
- `demo_balance`: User's virtual trading balance (starts at $10,000)
- `is_admin`: Admin role flag (grants access to admin dashboard)
- `risk_profile`: User's risk tolerance (low/medium/high/auto)
- `plan_type`: Subscription level (free/beta/premium)

#### simulated_positions
**Purpose:** Active and closed trading positions
**Key Fields:**
- `status`: 'open' | 'closed' | 'pending'
- `current_pnl`: Real-time profit/loss calculation
- `order_type`: 'market' | 'limit' (currently only market)
- `position_type`: 'buy' | 'sell'

#### trade_history
**Purpose:** Permanent record of all closed trades
**Key Fields:**
- `profit_loss`: Final P&L for the trade
- `strategy_name`: Which strategy generated the trade (nullable)
- `close_reason`: 'manual' | 'stop_loss' | 'take_profit' | 'system'

#### realtime_prices
**Purpose:** 30-second cache of live forex prices
**Key Fields:**
- `source`: 'metaapi-live' | 'supabase-cache' | 'polling'
- `broker_time`: Timestamp from MetaAPI
- `created_at`: Database insertion time (used for cache expiry)

#### balance_transactions
**Purpose:** Complete audit trail of all balance changes
**Key Fields:**
- `transaction_type`: 'trade_pnl' | 'deposit' | 'withdrawal' | 'adjustment'
- `balance_before/after`: Snapshot of balance change
- `position_id`: Link to related trade

---

## 🔐 ROW LEVEL SECURITY (RLS) POLICIES

### RLS Architecture

Every table has RLS ENABLED with restrictive policies:

```sql
-- DEFAULT BEHAVIOR: NO ACCESS
-- Users must be authenticated and policies must explicitly grant access

-- POLICY PATTERN for user_profiles
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- POLICY PATTERN for simulated_positions
CREATE POLICY "Users can view own positions"
  ON simulated_positions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own positions"
  ON simulated_positions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ADMIN OVERRIDE PATTERN
CREATE POLICY "Admins can view all profiles"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );
```

### RLS Policy Summary by Table

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| user_profiles | Own + Admin | System only | Own + Admin | None |
| simulated_positions | Own + Admin | Own | Own | Own |
| trade_history | Own + Admin | System only | None | None |
| balance_transactions | Own + Admin | System only | None | None |
| realtime_prices | All authenticated | None | None | None |
| trading_prompts | Own + Admin | Own | Own | Own |
| journal_entries | Own + Admin | Own | Own | Own |
| extended_search_sessions | Own + Admin | Own | Own | Own |
| metaapi_token_cache | All authenticated | Service role | Service role | Service role |

---

## 🔌 API ENDPOINTS & INTERFACES

### Frontend API Calls (from React components)

#### 1. Get Live Price
```typescript
// FILE: src/services/global-polling-coordinator.ts:96
const response = await fetch(`/.netlify/functions/get-live-price?symbol=${symbol}`);
const data = await response.json();
// Returns: { ok: boolean, symbol: string, bid: number, ask: number, timestamp: string, source: string }
```

#### 2. Verify MetaAPI Connection
```typescript
// FILE: src/services/global-polling-coordinator.ts:34
const verifyResponse = await fetch('/.netlify/functions/verify-metaapi-connection');
const verifyData = await verifyResponse.json();
// Returns: { healthy: boolean, diagnostics: {...} }
```

#### 3. Execute Demo Trade
```typescript
// FILE: src/services/simulated-trading.ts:34
const result = await simulatedTradingService.executeTrade(params, userId);
// Returns: { success: boolean, message: string, position?: {...} }
```

### Supabase Database Calls

#### 1. Insert Realtime Price
```typescript
// FILE: src/services/global-polling-coordinator.ts:105
await supabase.from('realtime_prices').insert({
  symbol: symbol,
  bid: bid,
  ask: ask,
  mid: mid,
  spread: spread,
  broker_time: data.timestamp || new Date().toISOString(),
  source: data.source || 'polling'
});
```

#### 2. Fetch Open Positions
```typescript
// FILE: src/services/simulated-trading.ts:73
const { data, error } = await supabase
  .from('simulated_positions')
  .select('*')
  .eq('user_id', userId)
  .eq('status', 'open')
  .order('opened_at', { ascending: false });
```

#### 3. Close Position
```typescript
// FILE: src/services/simulated-trading.ts:128
await supabase.from('simulated_positions').update({
  status: 'closed',
  current_price: currentPrice,
  current_pnl: pnl,
  closed_at: closedAt,
  close_reason: 'manual'
}).eq('id', positionId);
```

---

## 🎨 COMPONENT HIERARCHY

```
App.tsx (Root)
│
├── ErrorBoundary.tsx
│   └── DatabaseErrorBoundary.tsx
│
├── BrowserRouter
│   └── AuthProvider
│       └── Routes
│           │
│           ├── / (Public or Dashboard based on auth)
│           │   ├── PublicLandingPage.tsx (if not authenticated)
│           │   └── Dashboard (if authenticated)
│           │
│           ├── /auth
│           │   └── AuthPage.tsx
│           │
│           ├── /reset-password
│           │   └── ResetPasswordPage.tsx
│           │
│           ├── /dashboard (Protected)
│           │   └── Dashboard Component
│           │
│           ├── /waitlist
│           │   └── LandingPage.tsx
│           │
│           └── /admin/dashboard (Admin Only)
│               └── AdminDashboard.tsx

Dashboard Component (Main Trading Interface)
│
├── Header.tsx
│   └── User info, logout, navigation
│
├── NotificationCenter.tsx
│   └── System alerts and trade notifications
│
├── ConfigurationStatus.tsx
│   └── System health indicators
│
├── GlobalPollingStatus.tsx
│   └── Live data polling status
│
├── MarketChart.tsx
│   ├── Symbol selector
│   ├── Timeframe selector
│   ├── Lightweight Charts integration
│   └── Trade line overlays (entry, SL, TP)
│
├── ManualTradePanel.tsx
│   ├── Symbol selection
│   ├── Buy/Sell buttons
│   ├── Lot size input
│   ├── SL/TP inputs
│   └── Execute button
│
├── AITradingConsole.tsx
│   └── AI assistant integration (placeholder)
│
├── SearchStatusPanel.tsx (conditional)
│   └── Extended search progress
│
├── StrategyOptions.tsx
│   └── AI-generated trade opportunities
│
├── ActivePositions.tsx
│   ├── Open positions list
│   ├── Real-time P&L updates
│   └── Close position buttons
│
├── TradingDashboard.tsx
│   ├── Daily P&L
│   ├── Weekly P&L
│   └── Total balance
│
├── TradingKPIs.tsx
│   └── Performance metrics
│
├── TradeHistory.tsx
│   ├── Closed trades list
│   ├── Profit/loss summary
│   └── Strategy breakdown
│
├── TradingLaws.tsx
│   └── Trading rules display
│
└── TradeConfirmationModal.tsx (conditional)
    ├── Trade details
    ├── Risk calculation
    └── Confirm/Cancel buttons
```

---

## 🛠️ SERVICE LAYER ARCHITECTURE

### Service Singleton Pattern

All services follow the singleton pattern:

```typescript
class ServiceName {
  private static instance: ServiceName;

  private constructor() {
    // Initialization
  }

  public static getInstance(): ServiceName {
    if (!ServiceName.instance) {
      ServiceName.instance = new ServiceName();
    }
    return ServiceName.instance;
  }

  public async method() {
    // Service logic
  }
}

export const serviceName = new ServiceName();
```

### Service Dependencies

```
┌──────────────────────────────────────────────────────────────┐
│                    SERVICE DEPENDENCIES                       │
└──────────────────────────────────────────────────────────────┘

globalPollingCoordinator
├── Depends on: supabase client
├── Calls: get-live-price Netlify function
└── Updates: realtime_prices table

simulatedTradingService
├── Depends on: supabase client
├── Updates: simulated_positions, user_profiles,
│            balance_transactions, trade_history
└── Uses: calculatePnL algorithm

positionMonitorService
├── Depends on: supabase client, simulatedTradingService
├── Reads: simulated_positions, realtime_prices
└── Triggers: auto-close on SL/TP hit

extendedSearchService
├── Depends on: supabase client, multiSymbolScanner
├── Updates: extended_search_sessions
└── Runs: background opportunity scanning

promptValidationService
├── Validates: user input prompts
├── Checks: account balance feasibility
└── Returns: validation results with suggestions

dbHealthMonitor
├── Monitors: database connection health
├── Logs: connection issues and diagnostics
└── Alerts: on sustained failures

multiSymbolScanner
├── Analyzes: user prompts
├── Scans: multiple forex pairs
└── Generates: trade signals with confidence scores
```

---

## 🚀 BUILD & DEPLOYMENT PIPELINE

### Development to Production Flow

```
┌─────────────────────────────────────────────────────────────────┐
│               BUILD & DEPLOYMENT PIPELINE                        │
└─────────────────────────────────────────────────────────────────┘

LOCAL DEVELOPMENT
├── npm run dev
├── Vite dev server (http://localhost:5173)
├── Hot module replacement (HMR)
├── Local .env file for credentials
└── Direct Supabase connection

        │ git push
        ▼

GIT REPOSITORY
├── Source code versioning
├── Branch protection
└── Commit history

        │ webhook trigger
        ▼

NETLIFY BUILD PROCESS
├── 1. Clone repository
├── 2. Set Node version (20)
├── 3. npm install
├── 4. Load environment variables from Netlify
├── 5. npm run build
│      │
│      ├── Vite build process:
│      │   ├── TypeScript compilation
│      │   ├── React JSX transformation
│      │   ├── Tailwind CSS processing
│      │   ├── Code minification (Terser)
│      │   ├── Code splitting (vendor, router, UI chunks)
│      │   └── Asset optimization
│      │
│      └── Output: /dist directory
│
├── 6. Deploy static files to CDN
├── 7. Deploy serverless functions
└── 8. Activate deployment

        │
        ▼

PRODUCTION (LIVE)
├── CDN-served static assets
├── Edge functions on demand
├── Supabase connection (production DB)
└── MetaAPI integration (live data)
```

### Build Configuration (vite.config.ts)

**Key Settings:**
- Target: ES2020
- Minifier: Terser with custom options
- Code Splitting: Vendor, router, UI, Supabase, Socket.io chunks
- Source Maps: Disabled (production)
- Chunk Size Limit: 1000 KB
- Asset Inline Limit: 4096 bytes

### Netlify Function Configuration

**Timeout Settings:**
- refresh-candles: 600s (10 minutes)
- scheduled-refresh: 600s (10 minutes, runs daily 2 AM)
- connection-health: 26s
- All others: Default 10s

---

## 📊 PERFORMANCE OPTIMIZATIONS

### Database Indexes

```sql
-- Realtime prices (frequent lookups)
CREATE INDEX idx_realtime_prices_symbol_created
ON realtime_prices(symbol, created_at DESC);

-- Simulated positions (user queries)
CREATE INDEX idx_simulated_positions_user_status
ON simulated_positions(user_id, status);

-- Trade history (historical queries)
CREATE INDEX idx_trade_history_user_closed
ON trade_history(user_id, closed_at DESC);

-- Balance transactions (audit trail)
CREATE INDEX idx_balance_transactions_user_created
ON balance_transactions(user_id, created_at DESC);
```

### Frontend Optimizations

1. **Code Splitting:** Vendor, router, UI libraries loaded separately
2. **Lazy Loading:** Routes loaded on demand
3. **Memoization:** React components memoized where appropriate
4. **Debouncing:** User input debounced to reduce API calls
5. **Caching:** Price data cached for 30 seconds

### Backend Optimizations

1. **Token Caching:** MetaAPI tokens cached for 1 hour
2. **Price Caching:** Live prices cached in database for 30s
3. **Connection Pooling:** Supabase client reused across requests
4. **Timeout Handling:** Aggressive timeouts to prevent hanging

---

## 🔍 MONITORING & LOGGING

### Function Logging

All Netlify functions log to:
- Netlify function logs (console.log)
- function_logs table (structured logging)

**Log Structure:**
```typescript
{
  function_name: 'get-live-price',
  event_type: 'invocation' | 'success' | 'error',
  status: 'success' | 'error',
  duration_ms: 123,
  error_message: null,
  metadata: { symbol: 'EURUSD', ... },
  created_at: '2025-10-30T12:00:00Z'
}
```

### Health Monitoring

**connection_health_status table:**
- Tracks MetaAPI connection status
- Records response times
- Logs error messages
- Updated by verify-metaapi-connection function

### Client-Side Error Tracking

**ErrorBoundary.tsx:**
- Catches React component errors
- Displays user-friendly error messages
- Logs errors to console

**Global Error Handlers (main.tsx):**
- unhandledrejection: Promise rejections
- error: Global errors
- Filters known non-critical errors (network changes, analytics)

---

**END OF ARCHITECTURE REFERENCE**

*For code examples and implementation details, see CODE_REFERENCE.md*
*For configuration specifics, see CONFIGURATION_MANIFEST.md*
*For recovery procedures, see RECOVERY_GUIDE.md*
