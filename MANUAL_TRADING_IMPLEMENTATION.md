# Manual Simulated Trading Implementation

## Overview
Complete manual paper trading system implemented for Pipnosis AI Trading platform. All trades are simulated in the database with no actual MetaAPI order execution.

## Implementation Date
October 29, 2025

## Features Implemented

### 1. Database Schema
- **simulated_positions table**: Stores all trading positions (market and limit orders)
  - Supports buy/sell positions
  - Tracks entry price, stop loss, take profit
  - Monitors current price and P&L in real-time
  - Status tracking: pending, open, closed

- **balance_transactions table**: Complete transaction history
  - Tracks all balance changes (deposits, P&L, margin)
  - Links transactions to positions
  - Maintains audit trail

- **demo_balance column**: Added to user_profiles
  - Default starting balance: $10,000
  - Separate from account_balance for future real trading

- **Row Level Security**: Full RLS policies implemented
  - Users can only access their own positions
  - Admins can view all positions
  - Secure by design

### 2. Manual Trade Panel Component
**Location**: `src/components/ManualTradePanel.tsx`

**Features**:
- Live price display (bid/ask/spread) with real-time updates
- Order type selection (Market vs Limit orders)
- Lot size presets (0.01, 0.1, 1.0) with custom input
- Stop loss and take profit in pips
- Risk calculator showing:
  - Potential loss amount
  - Potential gain amount
  - Risk-reward ratio
- Separate Buy and Sell buttons with color coding
- Input validation and error handling
- Current balance display
- Collapsible panel design

### 3. Active Positions Display
**Location**: `src/components/ActivePositions.tsx`

**Features**:
- Real-time display of open positions
- Shows current P&L with color coding
- Entry price, current price, SL, TP levels
- One-click position closing
- Separate pending orders section
- Distance to fill for limit orders
- Cancel pending orders functionality
- Auto-refresh every 3 seconds
- Mobile responsive layout

### 4. Enhanced Trading Service
**Location**: `src/services/simulated-trading.ts`

**Capabilities**:
- Market order execution (immediate)
- Limit order creation (pending)
- Position closing with P&L calculation
- Pending order cancellation
- Real-time P&L calculation
- Balance updates on trade close
- Transaction logging

### 5. Position Monitor Service
**Location**: `src/services/position-monitor.ts`

**Automated Features**:
- Monitors open positions every 2 seconds
- Updates current price and P&L
- Auto-closes positions at stop loss
- Auto-closes positions at take profit
- Auto-fills pending limit orders when price reached
- Background service (starts on app load)

### 6. Balance Display Component
**Location**: `src/components/BalanceDisplay.tsx`

**Shows in Header**:
- Current demo balance
- Free margin available
- Used margin (from open positions)
- Unrealized P&L
- Margin level percentage with color coding:
  - Green: 200%+
  - Yellow: 100-200%
  - Red: Below 100%

## User Flow

### Opening a Market Order
1. Select symbol from dropdown
2. View live bid/ask prices
3. Choose "Market Order"
4. Set lot size (default 0.01)
5. Set stop loss in pips
6. Set take profit in pips
7. Review risk calculation
8. Click BUY or SELL button
9. Position opens immediately at current price
10. Margin deducted from demo balance

### Opening a Limit Order
1. Select symbol from dropdown
2. View live bid/ask prices
3. Choose "Limit Order"
4. Enter desired limit price
5. Set lot size
6. Set stop loss and take profit
7. Click BUY or SELL button
8. Order saved as "pending"
9. Auto-fills when market reaches limit price

### Closing a Position
1. View position in Active Positions panel
2. See current P&L in real-time
3. Click red X button to close
4. Confirm closure
5. P&L added/subtracted from balance
6. Margin released back to available balance

### Automatic Stop Loss/Take Profit
- Position monitor checks prices every 2 seconds
- When SL hit: position auto-closes, loss applied
- When TP hit: position auto-closes, profit applied
- Balance updated automatically
- Transaction logged for audit

## Integration Points

### App.tsx Updates
- Imported ManualTradePanel component
- Integrated position monitor service
- Added position refresh triggers
- Connected to existing notification system

### Header.tsx Updates
- Added BalanceDisplay component
- Shows real-time account metrics
- Responsive design (hides labels on mobile)

## Technical Details

### P&L Calculation Formula
```typescript
Contract Size: 100,000 (standard forex lot)
Point Size: 0.0001 (or 0.01 for JPY pairs)

For BUY positions:
P&L = (Current Price - Entry Price) / Point Size * (Lot Size * Contract Size / 10000)

For SELL positions:
P&L = (Entry Price - Current Price) / Point Size * (Lot Size * Contract Size / 10000)
```

### Margin Calculation
```
Margin Required = Lot Size * 1000
Example: 0.1 lots = $100 margin
```

### Risk Validation
- Maximum risk per trade: 5% of balance
- Minimum lot size: 0.01
- Maximum lot size: 10.0
- Stop loss required (cannot be 0)
- Take profit required (cannot be 0)

## Data Safety

### All Operations Are Database-Only
- No real orders sent to MetaAPI
- All trades stored in Supabase
- No actual money at risk
- Perfect for testing strategies

### Transaction Logging
Every balance change is logged:
- Trade P&L (profit or loss)
- Margin reserve (when position opens)
- Margin release (when position closes)
- Includes before/after balance
- Links to position ID

## Testing Checklist

- [x] Database schema created with RLS
- [x] demo_balance column added
- [x] Manual trade panel renders correctly
- [x] Live prices update in real-time
- [x] Market orders execute immediately
- [x] Limit orders save as pending
- [x] Active positions display correctly
- [x] Position closing works with P&L
- [x] Stop loss auto-closes positions
- [x] Take profit auto-closes positions
- [x] Limit orders auto-fill at target price
- [x] Balance updates on trade close
- [x] Balance display shows in header
- [x] Transaction history logs correctly
- [x] Production build succeeds

## Next Steps (Optional Future Enhancements)

1. **Trade History Page**
   - View closed positions
   - Filter by date range
   - Export to CSV
   - Performance charts

2. **Advanced Order Types**
   - Trailing stop loss
   - Break-even automation
   - Partial closes
   - OCO (One Cancels Other)

3. **Risk Management Tools**
   - Maximum daily loss limit
   - Maximum open positions limit
   - Position size calculator
   - Risk per trade percentage selector

4. **Analytics Dashboard**
   - Win rate statistics
   - Profit factor
   - Average win/loss
   - Trading hours heatmap

5. **Real MetaAPI Integration**
   - Add toggle for "live mode"
   - Confirmation dialogs for real trades
   - Separate real account balance tracking
   - Trade execution via MetaAPI REST API

## Files Modified/Created

### Created Files
- `src/components/ManualTradePanel.tsx`
- `src/components/BalanceDisplay.tsx`
- `src/services/position-monitor.ts`
- `supabase/migrations/20251029_create_simulated_positions_table.sql`

### Modified Files
- `src/components/ActivePositions.tsx` (complete rewrite)
- `src/services/simulated-trading.ts` (enhanced with new methods)
- `src/components/Header.tsx` (added balance display)
- `src/App.tsx` (integrated new components)

## Database Tables

### simulated_positions
```sql
- id (uuid)
- user_id (uuid, FK to user_profiles)
- symbol (text)
- position_type (buy/sell)
- order_type (market/limit)
- lot_size (numeric)
- entry_price (numeric)
- limit_price (numeric)
- stop_loss (numeric)
- take_profit (numeric)
- status (pending/open/closed)
- current_price (numeric)
- current_pnl (numeric)
- opened_at (timestamptz)
- closed_at (timestamptz)
- close_reason (manual/stop_loss/take_profit)
```

### balance_transactions
```sql
- id (uuid)
- user_id (uuid, FK to user_profiles)
- transaction_type (text)
- amount (numeric)
- balance_before (numeric)
- balance_after (numeric)
- position_id (uuid, FK to simulated_positions)
- description (text)
- created_at (timestamptz)
```

## Success Criteria - ALL MET

✅ Database schema created and secured
✅ Manual trade entry UI implemented
✅ Market and limit orders functional
✅ Real-time position monitoring working
✅ Automatic stop loss execution
✅ Automatic take profit execution
✅ Balance management implemented
✅ Transaction logging complete
✅ Production build succeeds
✅ All components integrated

## Ready for Production

The manual simulated trading system is now fully functional and ready for use. Users can:
- Place market and limit orders
- Monitor positions in real-time
- See automatic SL/TP execution
- Track their demo balance
- Review all transactions
- Practice trading risk-free

No additional setup required - the system will work immediately upon deployment.
