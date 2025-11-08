#!/bin/bash
# TradingView Historical Data Backfill Runner
# This script activates the Python virtual environment and runs the backfill script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
source venv/bin/activate
python3 backfill_historical_candles.py
