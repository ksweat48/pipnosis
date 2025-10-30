# CODE REFERENCE
## Pipnosis AI Trading Platform - Key Implementations

**Last Updated:** October 30, 2025
**System Version:** 1.0.0
**Purpose:** Critical code snippets with file locations for quick reference and recovery

---

## 📋 TABLE OF CONTENTS

1. [Core Algorithms](#core-algorithms)
2. [Service Implementations](#service-implementations)
3. [React Hooks](#react-hooks)
4. [Component Patterns](#component-patterns)
5. [Database Operations](#database-operations)
6. [Netlify Functions](#netlify-functions)
7. [Utility Functions](#utility-functions)
8. [Error Handling](#error-handling)

---

## 🧮 CORE ALGORITHMS

### P&L Calculation Algorithm

**FILE:** `src/services/simulated-trading.ts:223-242`

```typescript
calculatePnL(
  positionType: 'buy' | 'sell',
  entryPrice: number,
  currentPrice: number,
  lotSize: number,
  symbol: string
): number {
  // Standard forex contract size
  const contractSize = 100000;

  // Point size varies by currency pair
  // JPY pairs: 0.01 (2 decimal places)
  // Others: 0.0001 (4 decimal places)
  const pointSize = symbol.includes('JPY') ? 0.01 : 0.0001;

  // Calculate price difference based on position type
  let priceDifference: number;
  if (positionType === 'buy') {
    // For buy positions: profit when price goes up
    priceDifference = currentPrice - entryPrice;
  } else {
    // For sell positions: profit when price goes down
    priceDifference = entryPrice - currentPrice;
  }

  // Convert to P&L in dollars
  // Formula: (price difference / point size) * (lot size * contract size / 10000)
  const pnl = (priceDifference / pointSize) * (lotSize * contractSize / 10000);

  return parseFloat(pnl.toFixed(2));
}
```

**Usage:**
- Called every 5 seconds for open positions
- Used when closing positions
- Critical for balance updates

**Example:**
```typescript
// Buy 0.1 lots of EURUSD at 1.0850, current price 1.0900
const pnl = calculatePnL('buy', 1.0850, 1.0900, 0.1, 'EURUSD');
// Result: +50.00 (50 USD profit)

// Sell 0.1 lots of USDJPY at 150.50, current price 149.50
const pnl = calculatePnL('sell', 150.50, 149.50, 0.1, 'USDJPY');
// Result: +100.00 (100 USD profit)
```

---

### Global Polling Coordinator

**FILE:** `src/services/global-polling-coordinator.ts:24-77`

```typescript
async initialize(): Promise<void> {
  if (this.initialized) {
    console.log('⚠️ Global polling coordinator already initialized');
    return;
  }

  console.log('🚀 Initializing global polling coordinator for all forex pairs...');

  // Verify MetaAPI connection before starting
  console.log('🔍 Verifying MetaAPI connection before starting polling...');
  try {
    const verifyResponse = await fetch('/.netlify/functions/verify-metaapi-connection');
    const verifyData = await verifyResponse.json();

    console.log('📡 MetaAPI Connection Status:', verifyData);

    if (!verifyData.healthy) {
      console.error('❌ MetaAPI connection is not healthy:', verifyData.diagnostics);
      if (verifyData.diagnostics?.issues) {
        verifyData.diagnostics.issues.forEach((issue: string) => {
          console.error(`  - ${issue}`);
        });
      }
      console.warn('⚠️ Proceeding with polling initialization despite connection issues...');
    } else {
      console.log('✅ MetaAPI connection verified successfully');
      console.log(`   Account State: ${verifyData.diagnostics?.account?.state}`);
      console.log(`   Connection Status: ${verifyData.diagnostics?.account?.connectionStatus}`);
    }
  } catch (verifyError) {
    console.error('❌ Failed to verify MetaAPI connection:', verifyError);
    console.warn('⚠️ Proceeding with polling initialization anyway...');
  }

  // Initialize polling status for all forex pairs
  for (const symbol of this.FOREX_PAIRS) {
    this.pollStatus.set(symbol, {
      symbol,
      lastPoll: new Date(),
      lastPrice: null,
      errorCount: 0,
      isPolling: false
    });

    this.startPollingForSymbol(symbol);
  }

  this.initialized = true;
  console.log(`✅ Global polling coordinator initialized for ${this.FOREX_PAIRS.length} pairs`);
}
```

**Key Features:**
- Health check before initialization
- Graceful degradation on MetaAPI issues
- Per-symbol polling status tracking
- Prevents duplicate initialization

---

### Poll Function (Individual Symbol)

**FILE:** `src/services/global-polling-coordinator.ts:85-135`

```typescript
const pollFunction = async () => {
  const status = this.pollStatus.get(symbol);
  if (!status) return;

  // Prevent concurrent polls for same symbol
  if (status.isPolling) {
    return;
  }

  status.isPolling = true;

  try {
    // Fetch live price from Netlify function
    const response = await fetch(`/.netlify/functions/get-live-price?symbol=${symbol}`);
    const data = await response.json();

    if (data.ok && data.bid && data.ask) {
      const bid = parseFloat(data.bid);
      const ask = parseFloat(data.ask);
      const mid = (bid + ask) / 2;
      const spread = ask - bid;

      // Insert into database for caching and chart updates
      const { error: insertError } = await supabase
        .from('realtime_prices')
        .insert({
          symbol: symbol,
          bid: bid,
          ask: ask,
          mid: mid,
          spread: spread,
          broker_time: data.timestamp || new Date().toISOString(),
          source: data.source || 'polling'
        });

      if (insertError) {
        console.error(`❌ Failed to insert price for ${symbol}:`, insertError);
        status.errorCount++;
      } else {
        // Update status on success
        status.lastPrice = { bid, ask };
        status.lastPoll = new Date();
        status.errorCount = 0;
      }
    } else {
      console.warn(`⚠️ Invalid price data for ${symbol}:`, data);
      status.errorCount++;
    }
  } catch (error) {
    console.error(`❌ Failed to poll ${symbol}:`, error);
    status.errorCount++;
  } finally {
    status.isPolling = false;
  }
};

// Execute immediately, then every 5 seconds
pollFunction();
const interval = setInterval(pollFunction, this.POLL_INTERVAL);
this.pollIntervals.set(symbol, interval);
```

**Key Features:**
- Concurrency protection (isPolling flag)
- Error counting for diagnostics
- Database caching for performance
- Immediate first execution

---

## 🔧 SERVICE IMPLEMENTATIONS

### Simulated Trading Service - Execute Trade

**FILE:** `src/services/simulated-trading.ts:34-69`

```typescript
async executeTrade(params: TradeParams, userId: string) {
  try {
    // Insert new position into database
    const { data, error } = await supabase
      .from('simulated_positions')
      .insert({
        user_id: userId,
        symbol: params.symbol,
        position_type: params.action,
        order_type: 'market',
        lot_size: params.lotSize,
        entry_price: params.entry,
        stop_loss: params.stopLoss,
        take_profit: params.takeProfit,
        status: 'open',
        current_price: params.entry,
        current_pnl: 0
      })
      .select()
      .single();

    if (error) throw error;

    return {
      success: true,
      message: `Demo ${params.action.toUpperCase()} trade executed for ${params.symbol}`,
      position: data
    };
  } catch (error) {
    console.error('Trade execution failed:', error);
    return {
      success: false,
      message: 'Failed to execute demo trade',
      error
    };
  }
}
```

**Usage:**
```typescript
const result = await simulatedTradingService.executeTrade({
  symbol: 'EURUSD',
  action: 'buy',
  lotSize: 0.1,
  entry: 1.0850,
  stopLoss: 1.0800,
  takeProfit: 1.0950,
  strategy: strategyOption
}, userId);
```

---

### Simulated Trading Service - Close Position

**FILE:** `src/services/simulated-trading.ts:105-196`

```typescript
async closePosition(
  positionId: string,
  currentPrice: number,
  userId: string
): Promise<{ success: boolean; message: string }> {
  try {
    // 1. Fetch the position
    const { data: position, error: fetchError } = await supabase
      .from('simulated_positions')
      .select('*')
      .eq('id', positionId)
      .eq('user_id', userId)
      .single();

    if (fetchError || !position) {
      return { success: false, message: 'Position not found' };
    }

    // 2. Calculate final P&L
    const pnl = this.calculatePnL(
      position.position_type,
      position.entry_price,
      currentPrice,
      position.lot_size,
      position.symbol
    );

    const closedAt = new Date().toISOString();

    // 3. Update position status to closed
    const { error: updateError } = await supabase
      .from('simulated_positions')
      .update({
        status: 'closed',
        current_price: currentPrice,
        current_pnl: pnl,
        closed_at: closedAt,
        close_reason: 'manual'
      })
      .eq('id', positionId);

    if (updateError) throw updateError;

    // 4. Update user's demo balance
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('demo_balance')
      .eq('id', userId)
      .single();

    const currentBalance = parseFloat(profile?.demo_balance || '10000');
    const newBalance = currentBalance + pnl;

    await supabase
      .from('user_profiles')
      .update({ demo_balance: newBalance })
      .eq('id', userId);

    // 5. Log balance transaction (audit trail)
    await supabase
      .from('balance_transactions')
      .insert({
        user_id: userId,
        transaction_type: 'trade_pnl',
        amount: pnl,
        balance_before: currentBalance,
        balance_after: newBalance,
        position_id: positionId,
        description: `Position closed: ${position.symbol} ${position.position_type} ${position.lot_size} lots`
      });

    // 6. Create permanent trade history record
    await supabase
      .from('trade_history')
      .insert({
        user_id: userId,
        position_id: positionId,
        symbol: position.symbol,
        position_type: position.position_type,
        lot_size: position.lot_size,
        entry_price: position.entry_price,
        exit_price: currentPrice,
        stop_loss: position.stop_loss,
        take_profit: position.take_profit,
        profit_loss: pnl,
        opened_at: position.opened_at,
        closed_at: closedAt,
        close_reason: 'manual',
        strategy_name: null
      });

    return {
      success: true,
      message: `Position closed with P&L: $${pnl.toFixed(2)}`
    };
  } catch (error) {
    console.error('Failed to close position:', error);
    return {
      success: false,
      message: 'Failed to close position'
    };
  }
}
```

**Transaction Safety:**
- All operations in try/catch
- Multiple database updates in sequence
- Complete audit trail
- Balance integrity maintained

---

## 🪝 REACT HOOKS

### useAuth Hook

**FILE:** `src/hooks/useAuth.tsx:1-67`

```typescript
interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // Use async IIFE to avoid deadlock
      (async () => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      })();
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
```

**Key Features:**
- Session persistence
- Auth state synchronization
- Async IIFE in onAuthStateChange (prevents deadlock)
- Context-based state management

**Usage:**
```typescript
const { user, loading, signIn, signOut } = useAuth();

if (loading) return <LoadingSpinner />;
if (!user) return <LoginPage />;

// User is authenticated
```

---

### useUserBalance Hook

**FILE:** `src/hooks/useUserBalance.ts:1-77`

```typescript
export function useUserBalance(userId: string | null) {
  const [balance, setBalance] = useState(10000);
  const [totalPnL, setTotalPnL] = useState(0);
  const [openPositionsCount, setOpenPositionsCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refreshBalance = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('demo_balance')
        .eq('id', userId)
        .maybeSingle();

      if (profile) {
        setBalance(profile.demo_balance || 10000);
      }
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const refreshPositions = useCallback(async () => {
    if (!userId) return;

    try {
      const { data: positions } = await supabase
        .from('simulated_positions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'open');

      if (positions) {
        setOpenPositionsCount(positions.length);

        // Calculate total P&L across all open positions
        const pnl = positions.reduce((sum, pos) => {
          return sum + (pos.current_pnl || 0);
        }, 0);
        setTotalPnL(pnl);
      }
    } catch (error) {
      console.error('Failed to fetch positions:', error);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) {
      // Initial fetch
      refreshBalance();
      refreshPositions();

      // Refresh positions every 5 seconds for live P&L
      const interval = setInterval(() => {
        refreshPositions();
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [userId, refreshBalance, refreshPositions]);

  return {
    balance,
    totalPnL,
    openPositionsCount,
    loading,
    refreshBalance,
    refreshPositions
  };
}
```

**Key Features:**
- Auto-refresh positions every 5 seconds
- Memoized callbacks with useCallback
- Total P&L calculation
- Manual refresh triggers available

**Usage:**
```typescript
const { balance, totalPnL, refreshBalance, refreshPositions } = useUserBalance(user?.id);

// Display balance
<BalanceDisplay balance={balance} totalPnL={totalPnL} />

// Refresh after trade execution
await executeTrade(...);
refreshBalance();
refreshPositions();
```

---

## 🎨 COMPONENT PATTERNS

### Active Positions Component - Real-time Updates

**FILE:** `src/components/ActivePositions.tsx:26-92`

```typescript
export function ActivePositions({ refreshTrigger }: ActivePositionsProps) {
  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [pendingOrders, setPendingOrders] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [closingPosition, setClosingPosition] = useState<string | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, { bid: number; ask: number }>>({});

  // Fetch positions every 3 seconds
  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 3000);
    return () => clearInterval(interval);
  }, [refreshTrigger]);

  // Fetch live prices for all symbols with open positions
  useEffect(() => {
    const symbols = Array.from(new Set([
      ...openPositions.map(p => p.symbol),
      ...pendingOrders.map(p => p.symbol)
    ]));

    if (symbols.length > 0) {
      fetchLivePrices(symbols);
      const priceInterval = setInterval(() => fetchLivePrices(symbols), 2000);
      return () => clearInterval(priceInterval);
    }
  }, [openPositions, pendingOrders]);

  const fetchPositions = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [open, pending] = await Promise.all([
        simulatedTradingService.getOpenPositions(user.id),
        simulatedTradingService.getPendingOrders(user.id)
      ]);

      setOpenPositions(open);
      setPendingOrders(pending);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch positions:', error);
      setLoading(false);
    }
  };

  const fetchLivePrices = async (symbols: string[]) => {
    const prices: Record<string, { bid: number; ask: number }> = {};

    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const response = await fetch(`/.netlify/functions/get-live-price?symbol=${symbol}`);
          const data = await response.json();
          if (data.ok && data.bid && data.ask) {
            prices[symbol] = {
              bid: parseFloat(data.bid),
              ask: parseFloat(data.ask)
            };
          }
        } catch (error) {
          console.error(`Failed to fetch price for ${symbol}:`, error);
        }
      })
    );

    setLivePrices(prices);
  };

  // ... rest of component
}
```

**Key Features:**
- Dual interval system (positions: 3s, prices: 2s)
- Parallel price fetching for multiple symbols
- Automatic cleanup on unmount
- Responsive to external refresh triggers

---

### Trade Confirmation Modal Pattern

**FILE:** `src/components/TradeConfirmationModal.tsx`

```typescript
interface TradeConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  strategy: StrategyOption;
  accountBalance: number;
}

export function TradeConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  strategy,
  accountBalance
}: TradeConfirmationModalProps) {
  if (!isOpen) return null;

  const riskAmount = (parseFloat(strategy.entry) - parseFloat(strategy.stopLoss))
    * strategy.lotSize * 100000;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-xl font-bold text-white mb-4">Confirm Trade</h3>

        <div className="space-y-3 mb-6">
          <div className="flex justify-between">
            <span className="text-white/70">Symbol:</span>
            <span className="text-white font-semibold">{strategy.symbol}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/70">Action:</span>
            <span className={strategy.action === 'buy' ? 'text-emerald-400' : 'text-red-400'}>
              {strategy.action.toUpperCase()}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/70">Lot Size:</span>
            <span className="text-white">{strategy.lotSize}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/70">Entry:</span>
            <span className="text-white">{strategy.entry}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/70">Stop Loss:</span>
            <span className="text-red-400">{strategy.stopLoss}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/70">Take Profit:</span>
            <span className="text-emerald-400">{strategy.takeProfit}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/70">Risk Amount:</span>
            <span className="text-white">${riskAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/70">Account Balance:</span>
            <span className="text-white">${accountBalance.toFixed(2)}</span>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg"
          >
            Confirm Trade
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Usage Pattern:**
```typescript
const [confirmModalOpen, setConfirmModalOpen] = useState(false);
const [selectedStrategy, setSelectedStrategy] = useState<StrategyOption | null>(null);

<TradeConfirmationModal
  isOpen={confirmModalOpen}
  onClose={() => {
    setConfirmModalOpen(false);
    setSelectedStrategy(null);
  }}
  onConfirm={handleConfirmTrade}
  strategy={selectedStrategy}
  accountBalance={accountBalance}
/>
```

---

## 💾 DATABASE OPERATIONS

### Supabase Client Initialization

**FILE:** `src/lib/supabase.ts:1-17`

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});
```

**Key Configuration:**
- Auto token refresh enabled
- Session persistence enabled
- URL-based session detection (for email confirmations)

---

### Common Query Patterns

#### Insert with RETURNING data
```typescript
const { data, error } = await supabase
  .from('simulated_positions')
  .insert({
    user_id: userId,
    symbol: 'EURUSD',
    position_type: 'buy',
    // ...
  })
  .select()
  .single();
```

#### Update with WHERE clause
```typescript
const { error } = await supabase
  .from('simulated_positions')
  .update({
    status: 'closed',
    current_pnl: pnl,
    closed_at: new Date().toISOString()
  })
  .eq('id', positionId)
  .eq('user_id', userId); // Security check
```

#### Query with filters and sorting
```typescript
const { data, error } = await supabase
  .from('trade_history')
  .select('*')
  .eq('user_id', userId)
  .gte('closed_at', thirtyDaysAgo)
  .order('closed_at', { ascending: false })
  .limit(50);
```

#### Single row query (use maybeSingle!)
```typescript
// CORRECT - Returns null if not found
const { data, error } = await supabase
  .from('user_profiles')
  .select('demo_balance')
  .eq('id', userId)
  .maybeSingle();

// INCORRECT - Throws error if not found
const { data, error } = await supabase
  .from('user_profiles')
  .select('demo_balance')
  .eq('id', userId)
  .single(); // ❌ Avoid this!
```

---

## 🔌 NETLIFY FUNCTIONS

### get-live-price Function

**FILE:** `netlify/functions/get-live-price.ts:16-79`

```typescript
async function getMetaApiPrice(symbol: string): Promise<{
  bid: number;
  ask: number;
  timestamp: string;
  source: string;
}> {
  const token = process.env.METAAPI_TOKEN;
  const accountId = process.env.METAAPI_ACCOUNT_ID;
  const region = process.env.METAAPI_REGION || 'new-york';

  if (!token || !accountId) {
    throw new Error('MetaAPI credentials not configured');
  }

  const url = `https://mt-client-api-v1.${region}.agiliumtrade.ai/users/current/accounts/${accountId}/symbols/${symbol}/current-price`;

  console.log(`[get-live-price] Fetching ${symbol} from MetaAPI`);

  // Abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'auth-token': token,
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log(`[get-live-price] Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[get-live-price] MetaAPI error response body:`, errorText);
      throw new Error(`MetaAPI HTTP ${response.status}: ${errorText}`);
    }

    const data: MetaApiPrice = await response.json();
    console.log(`[get-live-price] Price data received:`, data);

    if (!data.bid || !data.ask) {
      throw new Error('Invalid price data from MetaAPI');
    }

    return {
      bid: parseFloat(String(data.bid)),
      ask: parseFloat(String(data.ask)),
      timestamp: data.time || new Date().toISOString(),
      source: 'metaapi-live'
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('MetaAPI request timeout after 8 seconds');
    }
    throw error;
  }
}
```

**Key Features:**
- 8-second timeout with abort controller
- Comprehensive logging
- Error handling with fallback
- Type-safe response parsing

---

### Cache Fallback Pattern

**FILE:** `netlify/functions/get-live-price.ts:81-115`

```typescript
async function getCachedPrice(symbol: string): Promise<{
  bid: number;
  ask: number;
  timestamp: string;
  source: string;
  ageSeconds: number;
} | null> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return null;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Only use cache within 30-second window
  const thirtySecondsAgo = new Date(Date.now() - 30000).toISOString();

  const { data, error } = await supabase
    .from('realtime_prices')
    .select('bid, ask, broker_time, created_at')
    .eq('symbol', symbol.toUpperCase())
    .gte('created_at', thirtySecondsAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const ageSeconds = Math.floor((Date.now() - new Date(data.created_at).getTime()) / 1000);

  return {
    bid: parseFloat(data.bid),
    ask: parseFloat(data.ask),
    timestamp: data.broker_time,
    source: 'supabase-cache',
    ageSeconds
  };
}
```

**Usage in Handler:**
```typescript
try {
  priceData = await getMetaApiPrice(symbol);
  console.log(`[get-live-price] Live price fetched successfully`);
} catch (metaError) {
  console.warn(`[get-live-price] MetaAPI failed, trying cache:`, metaError);

  const cached = await getCachedPrice(symbol);
  if (cached) {
    priceData = cached;
    console.log(`[get-live-price] Using cached price (${cached.ageSeconds}s old)`);
  } else {
    throw new Error('Unable to fetch live price and no cached data available');
  }
}
```

---

## 🛠️ UTILITY FUNCTIONS

### Environment Validator

**FILE:** `src/lib/env-validator.ts:1-20`

```typescript
export function logEnvironmentStatus(): void {
  console.log('🔍 Environment Configuration Status:');
  console.log('-----------------------------------');

  const requiredVars = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
    'VITE_METAAPI_ACCOUNT_ID',
    'VITE_METAAPI_REGION'
  ];

  requiredVars.forEach(varName => {
    const value = import.meta.env[varName];
    const status = value ? '✅' : '❌';
    const displayValue = value ? '(set)' : '(missing)';
    console.log(`${status} ${varName}: ${displayValue}`);
  });

  console.log('-----------------------------------');
}
```

---

### Error Handler

**FILE:** `src/lib/error-handler.ts:1-50`

```typescript
class ErrorHandler {
  isWebContainerError(error: any): boolean {
    return error?.message?.includes('webcontainer') ||
           error?.message?.includes('WebContainer');
  }

  isMetaApiError(error: any): boolean {
    return error?.message?.includes('metaapi') ||
           error?.message?.includes('agiliumtrade');
  }

  handleWebContainerTimeout(error: any): void {
    console.warn('⚠️ WebContainer timeout detected (non-critical):', error.message);
  }

  handleMetaApiError(error: any): void {
    console.warn('⚠️ MetaAPI error (will retry or use cache):', error.message);
  }

  handleNetworkError(error: any): void {
    console.warn('⚠️ Network error detected:', error.message);
  }

  handleResourcePreloadWarning(resource: string): void {
    console.info(`ℹ️ Resource preload hint: ${resource}`);
  }
}

export const errorHandler = new ErrorHandler();
```

**Usage in main.tsx:**
```typescript
window.addEventListener('unhandledrejection', (event) => {
  if (errorHandler.isMetaApiError(event.reason)) {
    event.preventDefault();
    errorHandler.handleMetaApiError(event.reason);
    return;
  }
  // ... other handlers
});
```

---

## 🚨 ERROR HANDLING

### Component Error Boundary

**FILE:** `src/components/ErrorBoundary.tsx:1-40`

```typescript
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('React Error Boundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex items-center justify-center p-4">
          <div className="glass-card p-8 max-w-md text-center">
            <h1 className="text-2xl font-bold text-red-400 mb-4">
              Something went wrong
            </h1>
            <p className="text-white/70 mb-6">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
```

---

### Database Error Boundary

**FILE:** `src/components/DatabaseErrorBoundary.tsx:1-30`

```typescript
export function DatabaseErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex items-center justify-center p-4">
          <div className="glass-card p-8 max-w-md text-center">
            <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-white mb-4">
              Database Connection Error
            </h1>
            <p className="text-white/70 mb-6">
              Unable to connect to the database. Please check your configuration.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg"
            >
              Retry Connection
            </button>
          </div>
        </div>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
```

---

## 📝 QUICK REFERENCE SNIPPETS

### Start Global Polling (App.tsx)
```typescript
setTimeout(async () => {
  console.log('🚀 Initializing global polling coordinator for all forex pairs...');
  try {
    await globalPollingCoordinator.initialize();
    console.log('✅ Global polling coordinator initialized successfully');
    globalPollingCoordinator.startStatusLogging(60000);
  } catch (error) {
    console.error('❌ Failed to initialize global polling coordinator:', error);
  }
}, 6000);
```

### Fetch Latest Price from Database
```typescript
const { data } = await supabase
  .from('realtime_prices')
  .select('bid, ask, created_at')
  .eq('symbol', 'EURUSD')
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();
```

### Create User Profile on Signup
```typescript
await supabase
  .from('user_profiles')
  .insert({
    id: user.id,
    email: user.email,
    demo_balance: 10000.00,
    risk_profile: 'auto',
    is_admin: false
  });
```

### Calculate Position Risk
```typescript
const contractSize = 100000;
const pointSize = symbol.includes('JPY') ? 0.01 : 0.0001;
const riskInPoints = Math.abs(entryPrice - stopLoss) / pointSize;
const riskInDollars = (riskInPoints * lotSize * contractSize) / 10000;
```

---

**END OF CODE REFERENCE**

*For architecture and data flow, see ARCHITECTURE_REFERENCE.md*
*For configuration details, see CONFIGURATION_MANIFEST.md*
*For recovery procedures, see RECOVERY_GUIDE.md*
