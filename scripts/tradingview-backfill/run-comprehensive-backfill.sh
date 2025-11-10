#!/bin/bash

# Comprehensive TradingView Historical Data Backfill Runner
# This script guides you through the backfill process with safety checks

set -e

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║  Comprehensive TradingView Historical Data Backfill               ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""

# Change to script directory
cd "$(dirname "$0")"

# Check Python version
echo "🔍 Checking Python version..."
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.8 or higher."
    exit 1
fi

PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
echo "✅ Python version: $PYTHON_VERSION"
echo ""

# Check if dependencies are installed
echo "🔍 Checking Python dependencies..."
if ! python3 -c "import tvDatafeed" 2>/dev/null; then
    echo "⚠️  Dependencies not installed. Installing now..."
    pip3 install -r requirements.txt
    echo ""
fi

# Check environment variables
echo "🔍 Checking environment variables..."
cd ../..
if [ ! -f .env ]; then
    echo "❌ .env file not found in project root"
    exit 1
fi

source .env

if [ -z "$VITE_SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo "❌ Missing required environment variables:"
    echo "   VITE_SUPABASE_URL"
    echo "   SUPABASE_SERVICE_ROLE_KEY"
    exit 1
fi

echo "✅ Environment variables configured"
echo ""

# Return to script directory
cd scripts/tradingview-backfill

# Show current data state
echo "🔍 Checking current data state..."
echo ""
cd ../..
node scripts/verify-candles.js 2>&1 | head -20
cd scripts/tradingview-backfill
echo ""

# Ask user what they want to do
echo "═════════════════════════════════════════════════════════════════════"
echo "What would you like to do?"
echo "═════════════════════════════════════════════════════════════════════"
echo ""
echo "1. Dry Run (recommended first - shows what would happen, no changes)"
echo "2. Test Single Symbol (EURUSD M15 only)"
echo "3. Full Backfill (all symbols and timeframes)"
echo "4. Custom (choose specific symbols/timeframes)"
echo "5. Exit"
echo ""
read -p "Enter your choice (1-5): " choice

case $choice in
    1)
        echo ""
        echo "🔍 Running dry run..."
        echo ""
        python3 comprehensive_backfill.py --dry-run
        ;;
    2)
        echo ""
        echo "🧪 Running test backfill for EURUSD M15..."
        echo ""
        read -p "Press Enter to continue or Ctrl+C to cancel..."
        python3 comprehensive_backfill.py --symbols EURUSD --timeframes M15
        echo ""
        echo "✅ Test complete! Check the results above."
        echo ""
        read -p "Proceed with full backfill? (y/n): " proceed
        if [ "$proceed" == "y" ] || [ "$proceed" == "Y" ]; then
            echo ""
            echo "🚀 Running full backfill..."
            echo ""
            python3 comprehensive_backfill.py
        fi
        ;;
    3)
        echo ""
        echo "⚠️  WARNING: This will backfill all 40 symbol/timeframe combinations."
        echo "   Estimated time: 60-90 minutes"
        echo "   Total candles: ~180,000+"
        echo ""
        read -p "Are you sure you want to proceed? (yes/no): " confirm
        if [ "$confirm" == "yes" ]; then
            echo ""
            echo "🚀 Running full backfill..."
            echo ""
            python3 comprehensive_backfill.py 2>&1 | tee backfill-$(date +%Y%m%d-%H%M%S).log
            echo ""
            echo "✅ Backfill complete!"
            echo ""
            echo "🔍 Final verification:"
            cd ../..
            node scripts/verify-candles.js
        else
            echo "Cancelled."
        fi
        ;;
    4)
        echo ""
        echo "Available symbols: XAUUSD US30 EURUSD GBPUSD USDJPY"
        read -p "Enter symbols (space-separated): " symbols
        echo ""
        echo "Available timeframes: M1 M5 M15 M30 H1 H4 D1 W1"
        read -p "Enter timeframes (space-separated): " timeframes
        echo ""
        echo "Running custom backfill for:"
        echo "  Symbols: $symbols"
        echo "  Timeframes: $timeframes"
        echo ""
        read -p "Press Enter to continue or Ctrl+C to cancel..."
        python3 comprehensive_backfill.py --symbols $symbols --timeframes $timeframes
        ;;
    5)
        echo "Exiting."
        exit 0
        ;;
    *)
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac

echo ""
echo "═════════════════════════════════════════════════════════════════════"
echo "Done! Check the output above for results."
echo "═════════════════════════════════════════════════════════════════════"
echo ""
