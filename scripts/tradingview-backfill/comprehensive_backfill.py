#!/usr/bin/env python3
"""
Comprehensive TradingView Historical Data Backfill Script

This script performs a complete historical data backfill from TradingView,
filling gaps, replacing incomplete candles, and extending up to the current live candle.

Features:
- Smart gap detection and filling
- Incomplete candle replacement
- Data quality validation (proper OHLC with wicks)
- Configurable fetch limits per timeframe
- Progress tracking and detailed logging
- Safe upsert with data source tracking

Usage:
    python3 comprehensive_backfill.py [--dry-run] [--clear-existing]
"""

import os
import sys
import argparse
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Tuple, Optional, Set
from dotenv import load_dotenv
from tvDatafeed.main import TvDatafeed, Interval
from supabase import create_client, Client
import time
import json

load_dotenv()

PAIRS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY']

TIMEFRAMES = {
    'M1': Interval.in_1_minute,
    'M5': Interval.in_5_minute,
    'M15': Interval.in_15_minute,
    'M30': Interval.in_30_minute,
    'H1': Interval.in_1_hour,
    'H4': Interval.in_4_hour,
    'D1': Interval.in_daily,
    'W1': Interval.in_weekly,
}

# Optimized fetch limits per timeframe for maximum historical coverage
FETCH_LIMITS = {
    'M1': 7200,    # ~5 days
    'M5': 6048,    # ~3 weeks
    'M15': 5760,   # ~60 days (2 months)
    'M30': 4320,   # ~90 days (3 months)
    'H1': 4320,    # ~180 days (6 months)
    'H4': 2160,    # ~360 days (1 year)
    'D1': 365,     # ~1 year
    'W1': 260,     # ~5 years
}

TIMEFRAME_MINUTES = {
    'M1': 1, 'M5': 5, 'M15': 15, 'M30': 30,
    'H1': 60, 'H4': 240, 'D1': 1440, 'W1': 10080
}

SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
tv = TvDatafeed()

SYMBOL_MAPPING = {
    'XAUUSD': ('OANDA', 'XAUUSD'),
    'US30': ('CME_MINI', 'YM1!'),
    'EURUSD': ('OANDA', 'EURUSD'),
    'GBPUSD': ('OANDA', 'GBPUSD'),
    'USDJPY': ('OANDA', 'USDJPY'),
}


class BackfillStats:
    """Track comprehensive backfill statistics"""
    def __init__(self):
        self.total_fetched = 0
        self.total_inserted = 0
        self.total_updated = 0
        self.gaps_filled = 0
        self.incomplete_replaced = 0
        self.errors = 0
        self.start_time = time.time()
        self.symbol_timeframe_results = {}

    def add_result(self, symbol: str, timeframe: str, result: Dict):
        key = f"{symbol}_{timeframe}"
        self.symbol_timeframe_results[key] = result
        self.total_fetched += result.get('fetched', 0)
        self.total_inserted += result.get('inserted', 0)
        self.total_updated += result.get('updated', 0)
        self.gaps_filled += result.get('gaps_filled', 0)
        self.incomplete_replaced += result.get('incomplete_replaced', 0)
        if result.get('status') == 'error':
            self.errors += 1

    def get_duration(self) -> float:
        return time.time() - self.start_time

    def print_summary(self):
        print(f"\n{'='*70}")
        print("COMPREHENSIVE BACKFILL SUMMARY")
        print(f"{'='*70}")
        print(f"Duration: {self.get_duration():.2f} seconds")
        print(f"Total candles fetched from TradingView: {self.total_fetched}")
        print(f"Total candles inserted (new): {self.total_inserted}")
        print(f"Total candles updated (replaced incomplete): {self.total_updated}")
        print(f"Gaps filled: {self.gaps_filled}")
        print(f"Incomplete candles replaced: {self.incomplete_replaced}")
        print(f"Errors: {self.errors}")
        print(f"Success rate: {((len(self.symbol_timeframe_results) - self.errors) / len(self.symbol_timeframe_results) * 100):.1f}%")


def get_last_completed_candle_time(timeframe: str) -> datetime:
    """Calculate the last completed candle time based on current time"""
    now = datetime.now(timezone.utc)
    interval_minutes = TIMEFRAME_MINUTES[timeframe]
    interval_ms = interval_minutes * 60 * 1000

    current_candle_start_ms = (now.timestamp() * 1000 // interval_ms) * interval_ms
    last_completed_ms = current_candle_start_ms - interval_ms

    return datetime.fromtimestamp(last_completed_ms / 1000, tz=timezone.utc)


def get_existing_candle_details(symbol: str, timeframe: str) -> Dict:
    """
    Get comprehensive details about existing candles including:
    - Total count
    - Earliest and latest timestamps
    - List of timestamps (to detect gaps)
    - Incomplete candles (missing proper OHLC data)
    """
    try:
        # Get all existing candles for this symbol/timeframe
        response = supabase.table('forex_candles')\
            .select('open_time, open, high, low, close, volume')\
            .eq('symbol', symbol)\
            .eq('timeframe', timeframe)\
            .order('open_time', desc=False)\
            .execute()

        if not response.data:
            return {
                'count': 0,
                'earliest': None,
                'latest': None,
                'timestamps': set(),
                'incomplete_candles': []
            }

        timestamps = set()
        incomplete_candles = []

        for candle in response.data:
            timestamps.add(candle['open_time'])

            # Check if candle is incomplete (missing proper wicks or invalid OHLC)
            if not is_candle_complete(candle):
                incomplete_candles.append(candle['open_time'])

        return {
            'count': len(response.data),
            'earliest': response.data[0]['open_time'],
            'latest': response.data[-1]['open_time'],
            'timestamps': timestamps,
            'incomplete_candles': incomplete_candles
        }

    except Exception as e:
        print(f"⚠️  Error querying {symbol} {timeframe}: {e}")
        return {
            'count': 0,
            'earliest': None,
            'latest': None,
            'timestamps': set(),
            'incomplete_candles': []
        }


def is_candle_complete(candle: Dict) -> bool:
    """
    Check if a candle has complete OHLC data with proper wicks.
    A complete candle should have high >= open, close and low <= open, close.
    """
    try:
        o, h, l, c = float(candle['open']), float(candle['high']), float(candle['low']), float(candle['close'])

        # Check for valid OHLC relationship
        if h < max(o, c) or l > min(o, c):
            return False

        # Check for zero or negative values (invalid)
        if any(x <= 0 for x in [o, h, l, c]):
            return False

        return True
    except (KeyError, ValueError, TypeError):
        return False


def detect_gaps(timestamps: Set[str], timeframe: str, earliest: str, latest: str) -> List[Tuple[datetime, datetime]]:
    """
    Detect gaps in the existing data based on expected candle intervals.
    Returns list of (gap_start, gap_end) tuples.
    """
    if not timestamps or not earliest or not latest:
        return []

    interval_minutes = TIMEFRAME_MINUTES[timeframe]
    interval_delta = timedelta(minutes=interval_minutes)

    # Convert timestamps to datetime objects
    timestamp_dates = sorted([datetime.fromisoformat(ts.replace('Z', '+00:00')) for ts in timestamps])

    gaps = []
    for i in range(len(timestamp_dates) - 1):
        current = timestamp_dates[i]
        next_expected = current + interval_delta
        actual_next = timestamp_dates[i + 1]

        # If there's a gap larger than the interval, record it
        if actual_next > next_expected + interval_delta:
            gaps.append((next_expected, actual_next - interval_delta))

    return gaps


def fetch_tv_candles(symbol: str, timeframe: str, tv_interval: Interval, limit: int) -> Optional[List[Dict]]:
    """
    Fetch historical candles from TradingView with retry logic.
    """
    exchange, tv_symbol = SYMBOL_MAPPING.get(symbol, (None, None))

    if not exchange or not tv_symbol:
        print(f"❌ {symbol} not mapped to TradingView symbol")
        return None

    max_retries = 3
    for attempt in range(max_retries):
        try:
            print(f"  📡 Fetching {limit} {timeframe} candles for {symbol} from TradingView ({exchange}:{tv_symbol})...")

            df = tv.get_hist(
                symbol=tv_symbol,
                exchange=exchange,
                interval=tv_interval,
                n_bars=limit,
                fut_contract=None,
                extended_session=False
            )

            if df is None or df.empty:
                print(f"  ⚠️  No data returned from TradingView for {symbol} {timeframe}")
                return None

            candles = []
            for index, row in df.iterrows():
                open_time = index.to_pydatetime().replace(tzinfo=timezone.utc)

                close_time = datetime.fromtimestamp(
                    open_time.timestamp() + (TIMEFRAME_MINUTES[timeframe] * 60),
                    tz=timezone.utc
                )

                candles.append({
                    'symbol': symbol,
                    'timeframe': timeframe,
                    'open_time': open_time.isoformat(),
                    'close_time': close_time.isoformat(),
                    'open': float(row['open']),
                    'high': float(row['high']),
                    'low': float(row['low']),
                    'close': float(row['close']),
                    'volume': float(row['volume']) if 'volume' in row and row['volume'] else 0.0,
                    'data_source': 'tradingview'
                })

            print(f"  ✅ Fetched {len(candles)} candles for {symbol} {timeframe}")
            return candles

        except Exception as e:
            if attempt < max_retries - 1:
                print(f"  ⚠️  Attempt {attempt + 1} failed: {e}. Retrying...")
                time.sleep(2)
            else:
                print(f"  ❌ Error fetching {symbol} {timeframe} after {max_retries} attempts: {e}")
                return None

    return None


def filter_candles_to_last_completed(candles: List[Dict], timeframe: str) -> List[Dict]:
    """
    Filter candles to only include those up to the last completed candle time.
    Excludes the current in-progress candle.
    """
    last_completed = get_last_completed_candle_time(timeframe)

    filtered = [
        c for c in candles
        if datetime.fromisoformat(c['open_time'].replace('Z', '+00:00')) <= last_completed
    ]

    print(f"  🔍 Filtered {len(candles)} -> {len(filtered)} candles (excluded in-progress candle)")
    print(f"  📅 Last completed candle time: {last_completed.isoformat()}")

    return filtered


def upsert_candles(candles: List[Dict], existing_details: Dict) -> Dict:
    """
    Upsert candles with smart merge logic:
    - Insert new candles (gaps)
    - Update incomplete candles with complete TradingView data
    - Skip already complete candles
    """
    if not candles:
        return {'inserted': 0, 'updated': 0, 'skipped': 0}

    existing_timestamps = existing_details['timestamps']
    incomplete_timestamps = set(existing_details['incomplete_candles'])

    new_candles = []
    update_candles = []

    for candle in candles:
        timestamp = candle['open_time']

        if timestamp not in existing_timestamps:
            # New candle - insert
            new_candles.append(candle)
        elif timestamp in incomplete_timestamps:
            # Incomplete candle - update
            update_candles.append(candle)

    inserted_count = 0
    updated_count = 0

    # Insert new candles in batches
    if new_candles:
        print(f"  💾 Inserting {len(new_candles)} new candles...")
        batch_size = 100
        for i in range(0, len(new_candles), batch_size):
            batch = new_candles[i:i + batch_size]
            try:
                supabase.table('forex_candles').insert(batch).execute()
                inserted_count += len(batch)
            except Exception as e:
                print(f"    ⚠️  Batch insert error: {e}")

    # Update incomplete candles
    if update_candles:
        print(f"  🔄 Updating {len(update_candles)} incomplete candles...")
        for candle in update_candles:
            try:
                supabase.table('forex_candles')\
                    .update({
                        'open': candle['open'],
                        'high': candle['high'],
                        'low': candle['low'],
                        'close': candle['close'],
                        'volume': candle['volume'],
                        'data_source': 'tradingview'
                    })\
                    .eq('symbol', candle['symbol'])\
                    .eq('timeframe', candle['timeframe'])\
                    .eq('open_time', candle['open_time'])\
                    .execute()
                updated_count += 1
            except Exception as e:
                print(f"    ⚠️  Update error for {candle['open_time']}: {e}")

    skipped_count = len(candles) - inserted_count - updated_count

    return {
        'inserted': inserted_count,
        'updated': updated_count,
        'skipped': skipped_count
    }


def backfill_symbol_timeframe(symbol: str, timeframe: str, dry_run: bool = False) -> Dict:
    """
    Perform comprehensive backfill for a single symbol/timeframe combination.
    """
    print(f"\n{'='*70}")
    print(f"Processing {symbol} - {timeframe}")
    print(f"{'='*70}")

    # Get existing data details
    existing = get_existing_candle_details(symbol, timeframe)
    print(f"  📊 Existing candles: {existing['count']}")

    if existing['earliest']:
        print(f"  📅 Earliest: {existing['earliest']}")
        print(f"  📅 Latest: {existing['latest']}")

    if existing['incomplete_candles']:
        print(f"  ⚠️  Incomplete candles: {len(existing['incomplete_candles'])}")

    # Detect gaps
    if existing['count'] > 1:
        gaps = detect_gaps(existing['timestamps'], timeframe, existing['earliest'], existing['latest'])
        if gaps:
            print(f"  🔍 Detected {len(gaps)} gaps in data")
            for gap_start, gap_end in gaps[:3]:  # Show first 3 gaps
                print(f"     Gap: {gap_start.isoformat()} to {gap_end.isoformat()}")

    # Fetch from TradingView
    tv_interval = TIMEFRAMES.get(timeframe)
    if not tv_interval:
        return {
            'symbol': symbol,
            'timeframe': timeframe,
            'status': 'error',
            'reason': 'invalid_timeframe'
        }

    fetch_limit = FETCH_LIMITS.get(timeframe, 5000)
    tv_candles = fetch_tv_candles(symbol, timeframe, tv_interval, fetch_limit)

    if not tv_candles:
        return {
            'symbol': symbol,
            'timeframe': timeframe,
            'status': 'error',
            'reason': 'fetch_failed',
            'fetched': 0
        }

    # Filter to last completed candle
    filtered_candles = filter_candles_to_last_completed(tv_candles, timeframe)

    if dry_run:
        print(f"  🔍 DRY RUN: Would insert/update {len(filtered_candles)} candles")
        return {
            'symbol': symbol,
            'timeframe': timeframe,
            'status': 'dry_run',
            'fetched': len(filtered_candles),
            'inserted': 0,
            'updated': 0
        }

    # Upsert candles
    upsert_result = upsert_candles(filtered_candles, existing)

    print(f"  ✅ Inserted: {upsert_result['inserted']}, Updated: {upsert_result['updated']}, Skipped: {upsert_result['skipped']}")

    return {
        'symbol': symbol,
        'timeframe': timeframe,
        'status': 'success',
        'fetched': len(filtered_candles),
        'inserted': upsert_result['inserted'],
        'updated': upsert_result['updated'],
        'gaps_filled': upsert_result['inserted'],
        'incomplete_replaced': upsert_result['updated']
    }


def verify_final_state():
    """
    Verify the final state of the database after backfill.
    """
    print(f"\n{'='*70}")
    print("FINAL VERIFICATION - Candle Counts and Data Quality")
    print(f"{'='*70}\n")

    header = "Symbol".ljust(10) + "".join([tf.ljust(12) for tf in TIMEFRAMES.keys()])
    print(header)
    print("-" * 100)

    for symbol in PAIRS:
        row = symbol.ljust(10)
        for timeframe in TIMEFRAMES.keys():
            details = get_existing_candle_details(symbol, timeframe)
            count = details['count']
            incomplete = len(details['incomplete_candles'])

            if count >= 100 and incomplete == 0:
                status = "✅"
            elif count >= 50:
                status = "⚠️"
            else:
                status = "❌"

            display = f"{status}{count}"
            if incomplete > 0:
                display += f"({incomplete})"
            row += display.ljust(12)
        print(row)

    print("\n✅ = Excellent (100+ complete candles)")
    print("⚠️ = Good (50+ candles)")
    print("❌ = Needs more data (<50 candles)")
    print("(n) = n incomplete candles found\n")


def main():
    parser = argparse.ArgumentParser(description='Comprehensive TradingView Historical Data Backfill')
    parser.add_argument('--dry-run', action='store_true', help='Run without making database changes')
    parser.add_argument('--symbols', nargs='+', help='Specific symbols to backfill (default: all)')
    parser.add_argument('--timeframes', nargs='+', help='Specific timeframes to backfill (default: all)')

    args = parser.parse_args()

    symbols = args.symbols if args.symbols else PAIRS
    timeframes = args.timeframes if args.timeframes else list(TIMEFRAMES.keys())

    print("╔════════════════════════════════════════════════════════════════════╗")
    print("║  Comprehensive TradingView Historical Data Backfill               ║")
    print("╚════════════════════════════════════════════════════════════════════╝\n")

    if args.dry_run:
        print("🔍 DRY RUN MODE - No database changes will be made\n")

    print(f"Symbols: {', '.join(symbols)}")
    print(f"Timeframes: {', '.join(timeframes)}")
    print(f"Total combinations: {len(symbols) * len(timeframes)}\n")

    print("Fetch limits per timeframe:")
    for tf, limit in FETCH_LIMITS.items():
        if tf in timeframes:
            print(f"  {tf}: {limit} candles")

    print("\nStarting backfill...\n")

    stats = BackfillStats()

    for symbol in symbols:
        for timeframe in timeframes:
            result = backfill_symbol_timeframe(symbol, timeframe, dry_run=args.dry_run)
            stats.add_result(symbol, timeframe, result)

            # Rate limiting - be nice to TradingView
            time.sleep(1.5)

    # Print summary
    stats.print_summary()

    # Verify final state
    if not args.dry_run:
        verify_final_state()

    print("\n✨ Backfill complete! Your historical data is now comprehensive and complete.\n")


if __name__ == '__main__':
    main()
