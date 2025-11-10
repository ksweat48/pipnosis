#!/bin/bash
#
# DEFINITIVE BACKFILL SCRIPT
# This is the ONLY method that works for historical data backfill
#
# Usage:
#   ./BACKFILL.sh                          # Backfill all symbols
#   ./BACKFILL.sh US30                     # Backfill US30 only
#   ./BACKFILL.sh EURUSD GBPUSD           # Backfill multiple symbols
#   ./BACKFILL.sh --dry-run               # Test run without inserting data
#

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}╔════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  DEFINITIVE HISTORICAL DATA BACKFILL                              ║${NC}"
echo -e "${GREEN}║  TradingView tvDatafeed Method (Python)                           ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Error: python3 is not installed${NC}"
    echo "Please install Python 3.7+ and try again"
    exit 1
fi

echo -e "${GREEN}✅ Python 3 found:${NC} $(python3 --version)"

# Check if pip is available
if ! python3 -m pip --version &> /dev/null; then
    echo -e "${YELLOW}⚠️  pip not found. Attempting to install dependencies may fail.${NC}"
    echo ""
    echo "To fix this:"
    echo "  Ubuntu/Debian: sudo apt install python3-pip"
    echo "  macOS: brew install python3"
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo -e "${GREEN}✅ pip found:${NC} $(python3 -m pip --version | cut -d' ' -f2)"
fi

# Navigate to backfill directory
cd "$(dirname "$0")/scripts/tradingview-backfill"

# Check if requirements.txt exists
if [ ! -f "requirements.txt" ]; then
    echo -e "${RED}❌ Error: requirements.txt not found${NC}"
    echo "Make sure you're running this from the project root"
    exit 1
fi

# Check if comprehensive_backfill.py exists
if [ ! -f "comprehensive_backfill.py" ]; then
    echo -e "${RED}❌ Error: comprehensive_backfill.py not found${NC}"
    echo "Make sure the script exists in scripts/tradingview-backfill/"
    exit 1
fi

# Install dependencies
echo ""
echo -e "${YELLOW}📦 Installing Python dependencies...${NC}"
if python3 -m pip install -r requirements.txt --quiet; then
    echo -e "${GREEN}✅ Dependencies installed successfully${NC}"
else
    echo -e "${RED}❌ Failed to install dependencies${NC}"
    echo ""
    echo "If you see 'externally-managed-environment' error, try:"
    echo "  python3 -m venv venv"
    echo "  source venv/bin/activate"
    echo "  pip install -r requirements.txt"
    exit 1
fi

# Check .env file
if [ ! -f "../../.env" ]; then
    echo -e "${RED}❌ Error: .env file not found in project root${NC}"
    echo "Please create a .env file with SUPABASE credentials"
    exit 1
fi

# Verify Supabase credentials
if ! grep -q "VITE_SUPABASE_URL" ../../.env; then
    echo -e "${RED}❌ Error: VITE_SUPABASE_URL not found in .env${NC}"
    exit 1
fi

if ! grep -q "SUPABASE_SERVICE_ROLE_KEY" ../../.env; then
    echo -e "${RED}❌ Error: SUPABASE_SERVICE_ROLE_KEY not found in .env${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Environment variables verified${NC}"

# Run backfill
echo ""
echo -e "${GREEN}🚀 Starting backfill...${NC}"
echo ""

if [ $# -eq 0 ]; then
    # No arguments - backfill all symbols
    echo "Backfilling all symbols: XAUUSD, US30, EURUSD, GBPUSD, USDJPY"
    python3 comprehensive_backfill.py
elif [ "$1" == "--dry-run" ]; then
    # Dry run
    echo "Dry run mode - no data will be inserted"
    python3 comprehensive_backfill.py --dry-run
else
    # Specific symbols
    echo "Backfilling symbols: $@"
    python3 comprehensive_backfill.py --symbols "$@"
fi

BACKFILL_EXIT_CODE=$?

if [ $BACKFILL_EXIT_CODE -eq 0 ]; then
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  ✅ BACKFILL COMPLETED SUCCESSFULLY                                ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Refresh your browser to see updated charts"
    echo "  2. Check charts on D1, W1 timeframes to verify historical data"
    echo "  3. Run AI training or backtesting with full historical data"
    echo ""
else
    echo ""
    echo -e "${RED}╔════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ❌ BACKFILL FAILED                                                ║${NC}"
    echo -e "${RED}╚════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Check the error messages above"
    echo "  2. Read DEFINITIVE_BACKFILL_GUIDE.md for solutions"
    echo "  3. Verify your .env file has correct Supabase credentials"
    echo "  4. Ensure you have internet connection"
    echo ""
    exit $BACKFILL_EXIT_CODE
fi
