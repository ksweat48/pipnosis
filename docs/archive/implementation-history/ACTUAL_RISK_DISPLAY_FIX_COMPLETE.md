# Actual Risk Display Fix - Complete

## Problem
The goal session dashboard was showing **"10%"** as "Risk Per Trade" which was misleading - it displayed the **risk mode setting** (max risk allowed per trade) instead of the **actual dollar amount and percentage** being risked on the current trade.

## Example of the Issue
- Account Balance: $10,049.18
- Trade: EURUSD SELL at 1.17187, SL at 1.17345, Lot Size: 0.17
- **Displayed**: "10% Risk Per Trade"
- **Actual Risk**: $26.86 (0.27%)

The display made it look like the trade was risking $1,000 when it was actually only risking $27!

## Solution Implemented

### 1. Added Actual Risk Calculation Function
Created `calculateActualRiskPercentage()` in `GoalSessionDashboard.tsx` that:
- Calculates pip distance from entry to stop loss
- Determines dollar value per pip based on lot size
- Computes total dollar risk across all open trades
- Converts to risk percentage of account balance

### 2. Updated Display Logic
- **When trades are open**: Shows actual risk percentage (e.g., "0.27%")
- **When no trades are open**: Shows risk mode setting as reference (e.g., "10%")
- Changes label from "Risk Per Trade" to "Actual Risk" when trades are open
- Adds tooltip showing dollar amount at risk

### 3. Smart Color Coding
Risk percentage is color-coded based on **actual risk level**:
- **Green**: < 2% (conservative, safe)
- **Yellow**: 2-5% (moderate)
- **Orange**: 5-10% (aggressive)
- **Red**: > 10% (high risk)

## Technical Details

### Formula
```typescript
// For each open trade:
const pipDistance = calculatePipDistance(symbol, entryPrice, stopLoss);
const dollarPerPip = calculateDollarPerPip(symbol, lotSize);
const tradeRisk = pipDistance * dollarPerPip;

// Total risk percentage:
const riskPercentage = (totalDollarRisk / accountBalance) * 100;
```

### File Changes
- **Modified**: `src/components/GoalSessionDashboard.tsx`
  - Added import for `calculatePipDistance` and `calculateDollarPerPip`
  - Added `calculateActualRiskPercentage()` function
  - Updated risk display section (lines 960-999)

### Example Output
**Before**: "10%" (misleading - shows config, not actual risk)

**After** (with open trade):
- Display: "0.27%"
- Label: "Actual Risk"
- Tooltip: "$26.86 at risk"

**After** (no open trades):
- Display: "10%"
- Label: "Risk Per Trade"
- Tooltip: "Max 10% per trade"

## Benefits
1. **Transparency**: Users see exactly how much they're risking in dollars and percentage
2. **Accuracy**: Reflects actual trade parameters, not just configuration
3. **Risk Management**: Helps users understand their true exposure
4. **Multi-Trade Support**: Shows combined risk when multiple trades are open

## Testing
Build completed successfully with no errors.

## Example Calculation
For your current trade:
```
Symbol: EURUSD
Entry: 1.17187
Stop Loss: 1.17345
Lot Size: 0.17 lots

Pip Distance: 15.8 pips
Dollar Per Pip: 0.17 × $10 = $1.70
Dollar Risk: 15.8 × $1.70 = $26.86
Risk %: ($26.86 / $10,049.18) × 100 = 0.267%

Display: "0.27%" (accurate!)
```

## Conclusion
The dashboard now shows the **actual risk per trade** based on lot size, entry, and stop loss - not just the risk mode setting. This provides accurate, real-time risk information for better trading decisions.
