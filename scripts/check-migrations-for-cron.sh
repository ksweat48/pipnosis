#!/bin/bash
#
# Migration Validation Script - Block Supabase Cron Jobs
#
# This script checks migration files for forbidden cron-related code.
# Run this before applying migrations or as a pre-commit hook.
#
# Usage:
#   ./scripts/check-migrations-for-cron.sh
#   ./scripts/check-migrations-for-cron.sh path/to/migration.sql
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

MIGRATIONS_DIR="supabase/migrations"
ERRORS_FOUND=0

echo ""
echo "========================================"
echo "🔍 Checking for forbidden cron jobs..."
echo "========================================"
echo ""

# If a specific file is provided, check only that file
if [ $# -eq 1 ]; then
  MIGRATIONS_DIR="$1"
  echo "Checking single file: $1"
  echo ""
fi

# Check for cron.schedule
echo "Checking for cron.schedule()..."
if grep -rn "cron\.schedule" "$MIGRATIONS_DIR" 2>/dev/null; then
  echo ""
  echo -e "${RED}❌ ERROR: Migration contains cron.schedule()${NC}"
  echo ""
  echo "Supabase cron jobs are PERMANENTLY BANNED."
  echo "See: docs/ARCHITECTURE_DECISION.md"
  echo ""
  echo "Use Netlify scheduled functions instead:"
  echo "  1. Create function in netlify/functions/"
  echo "  2. Add schedule to netlify.toml"
  echo "  3. Deploy to Netlify"
  echo ""
  ERRORS_FOUND=1
fi

# Check for pg_cron references
echo "Checking for pg_cron..."
if grep -rn "pg_cron" "$MIGRATIONS_DIR" 2>/dev/null; then
  echo ""
  echo -e "${RED}❌ ERROR: Migration references pg_cron${NC}"
  echo ""
  echo "Supabase cron extension is PERMANENTLY DISABLED."
  echo "See: docs/ARCHITECTURE_DECISION.md"
  echo ""
  ERRORS_FOUND=1
fi

# Check for cron.unschedule (sometimes added when trying to fix issues)
echo "Checking for cron.unschedule()..."
if grep -rn "cron\.unschedule" "$MIGRATIONS_DIR" 2>/dev/null; then
  echo ""
  echo -e "${YELLOW}⚠️  WARNING: Migration contains cron.unschedule()${NC}"
  echo ""
  echo "This is only acceptable in cleanup migrations."
  echo "Make sure you're not trying to re-enable cron jobs."
  echo ""
  # Don't fail on unschedule - it's needed for cleanup
fi

# Check for forbidden function names
echo "Checking for cron-only function names..."
FORBIDDEN_FUNCTIONS=(
  "invoke_continuous_price_poller"
  "finalize_completed_candles"
  "invoke_auto_backtest_executor"
  "auto_backtest_runner_cycle"
  "generate_auto_backtest_job"
  "execute_pending_backtest_jobs"
  "process_lightweight_jobs"
  "cleanup_completed_jobs"
  "job_scheduler_cycle"
)

for func in "${FORBIDDEN_FUNCTIONS[@]}"; do
  if grep -rn "CREATE.*FUNCTION.*$func" "$MIGRATIONS_DIR" 2>/dev/null; then
    echo ""
    echo -e "${RED}❌ ERROR: Migration creates forbidden function: $func${NC}"
    echo ""
    echo "This function was part of the old cron system."
    echo "It has been permanently removed."
    echo ""
    ERRORS_FOUND=1
  fi
done

# Check for candle_state table (used only by cron)
echo "Checking for candle_state table..."
if grep -rn "CREATE TABLE.*candle_state" "$MIGRATIONS_DIR" 2>/dev/null; then
  echo ""
  echo -e "${RED}❌ ERROR: Migration creates candle_state table${NC}"
  echo ""
  echo "The candle_state table was used by finalize_completed_candles() cron job."
  echo "It has been permanently removed."
  echo "Candles are now inserted directly to forex_candles by Netlify aggregator."
  echo ""
  ERRORS_FOUND=1
fi

echo ""
echo "========================================"
if [ $ERRORS_FOUND -eq 0 ]; then
  echo -e "${GREEN}✅ No forbidden cron code found${NC}"
  echo "========================================"
  echo ""
  exit 0
else
  echo -e "${RED}❌ VALIDATION FAILED${NC}"
  echo "========================================"
  echo ""
  echo "DO NOT apply these migrations!"
  echo "Remove all cron-related code."
  echo ""
  echo "Resources:"
  echo "  - docs/ARCHITECTURE_DECISION.md"
  echo "  - docs/CRITICAL_SYSTEMS.md"
  echo "  - netlify.toml (see approved scheduled functions)"
  echo ""
  exit 1
fi
