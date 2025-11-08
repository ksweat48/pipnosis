#!/bin/bash
# TradingView Historical Data Backfill Runner
# This script activates the Python virtual environment and runs the backfill script

cd /tmp/cc-agent/58035261/project/scripts/tradingview-backfill
source venv/bin/activate
python3 backfill_historical_candles.py
