#!/usr/bin/env python3
"""
Targeted TradingView Backfill for Nov 7, 2024 Corrupted Candles

One-time script to replace corrupted candles from Nov 7 00:00 to 14:10 UTC
with proper OHLC data including wicks from TradingView.

Usage:
    python3 targeted_backfill_nov7.py [--dry-run]

Requirements:
    - Install dependencies: pip install -r requirements.txt
    - Ensure .env file is configured with Supabase credentials
"""

import os
import sys
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Tuple, Optional
from dotenv import load_dotenv
from tvDatafeed.main import TvDatafeed, Interval
from supabase import create_client, Client
import time

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

TIMEFRAME_MINUTES = {
    'M1': 1, 'M5': 5, 'M15': 15, 'M30': 30,
    'H1': 60, 'H4': 240, 'D1': 1440, 'W1': 10080
}

START_TIME = datetime(2024, 11, 7, 0, 0, 0, tzinfo=timezone.utc)
END_TIME = datetime(2024, 11, 7, 14, 10, 0, tzinfo=timezone.utc)

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

DRY_RUN = '--dry-run' in sys.argv


def get_candles_in_range(symbol: str, timeframe: str) -> List[Dict]:
    """
    Query existing candles in the corrupted time range.
    Returns list of candles.
    """
    try:
        response = supabase.table('forex_candles')\
            .select('open_time, open, high, low, close, volume')\
            .eq('symbol', symbol)\
            .eq('timeframe', timeframe)\
            .gte('open_time', START_TIME.isoformat())\
            .lt('open_time', END_TIME.isoformat())\
            .order('open_time')\
            .execute()

        return response.data if response.data else []
    except Exception as e:
        print(f"⚠️  Error querying {symbol} {timeframe}: {e}")
        return []


def calculate_candles_needed(timeframe: str) -> int:
    """
    Calculate how many candles are in the corrupted time range.
    """
    duration_minutes = (END_TIME - START_TIME).total_seconds() / 60
    tf_minutes = TIMEFRAME_MINUTES[timeframe]

    candles_needed = int(duration_minutes / tf_minutes) + 5

    return candles_needed


def fetch_tv_candles_for_range(symbol: str, timeframe: str, tv_interval: Interval) -> Optional[List[Dict]]:
    """
    Fetch historical candles from TradingView for the specific date range.
    Returns list of candle dictionaries filtered to the corrupted window.
    """
    exchange, tv_symbol = SYMBOL_MAPPING.get(symbol, (None, None))

    if not exchange or not tv_symbol:
        print(f"❌ {symbol} not mapped to TradingView symbol")
        return None

    try:
        candles_needed = calculate_candles_needed(timeframe)

        fetch_start = START_TIME - timedelta(days=7)

        print(f"  📡 Fetching {timeframe} candles for {symbol} from TradingView ({exchange}:{tv_symbol})...")
        print(f"     Target range: {START_TIME.isoformat()} to {END_TIME.isoformat()}")

        df = tv.get_hist(
            symbol=tv_symbol,
            exchange=exchange,
            interval=tv_interval,
            n_bars=candles_needed * 2,
            fut_contract=None,
            extended_session=False
        )

        if df is None or df.empty:
            print(f"  ⚠️  No data returned from TradingView for {symbol} {timeframe}")
            return None

        candles = []
        for index, row in df.iterrows():
            open_time = index.to_pydatetime().replace(tzinfo=timezone.utc)

            if open_time < START_TIME or open_time >= END_TIME:
                continue

            tf_minutes = TIMEFRAME_MINUTES[timeframe]
            close_time = datetime.fromtimestamp(
                open_time.timestamp() + (tf_minutes * 60),
                tz=timezone.utc
            )

            candle = {
                'symbol': symbol,
                'timeframe': timeframe,
                'open_time': open_time.isoformat(),
                'close_time': close_time.isoformat(),
                'open': float(row['open']),
                'high': float(row['high']),
                'low': float(row['low']),
                'close': float(row['close']),
                'volume': float(row['volume']) if 'volume' in row and row['volume'] else 0.0,
            }

            if candle['high'] > max(candle['open'], candle['close']) or \
               candle['low'] < min(candle['open'], candle['close']):
                candles.append(candle)
            else:
                print(f"  ⚠️  Skipping candle at {open_time} - no wicks detected")

        print(f"  ✅ Fetched {len(candles)} candles in target range for {symbol} {timeframe}")
        return candles

    except Exception as e:
        print(f"  ❌ Error fetching {symbol} {timeframe}: {e}")
        return None


def upsert_candles_batch(candles: List[Dict], dry_run: bool = False) -> Tuple[int, int]:
    """
    Upsert candles into database, replacing corrupted ones.
    Returns (successful_upserts, failed_upserts).
    """
    if not candles:
        return 0, 0

    if dry_run:
        print(f"    [DRY RUN] Would upsert {len(candles)} candles")
        return len(candles), 0

    success_count = 0
    error_count = 0

    batch_size = 50
    for i in range(0, len(candles), batch_size):
        batch = candles[i:i + batch_size]

        try:
            response = supabase.table('forex_candles').upsert(
                batch,
                on_conflict='symbol,timeframe,open_time',
                ignore_duplicates=False
            ).execute()

            success_count += len(batch)

        except Exception as e:
            print(f"    ⚠️  Batch upsert error: {e}")
            error_count += len(batch)

    return success_count, error_count


def analyze_candle_quality(candles: List[Dict]) -> Dict:
    """
    Analyze candle data to check for wicks and quality.
    """
    if not candles:
        return {'total': 0, 'with_wicks': 0, 'without_wicks': 0}

    with_wicks = 0
    without_wicks = 0

    for candle in candles:
        body_high = max(candle['open'], candle['close'])
        body_low = min(candle['open'], candle['close'])

        has_upper_wick = candle['high'] > body_high
        has_lower_wick = candle['low'] < body_low

        if has_upper_wick or has_lower_wick:
            with_wicks += 1
        else:
            without_wicks += 1

    return {
        'total': len(candles),
        'with_wicks': with_wicks,
        'without_wicks': without_wicks,
        'percentage_with_wicks': (with_wicks / len(candles) * 100) if len(candles) > 0 else 0
    }


def backfill_symbol_timeframe(symbol: str, timeframe: str, dry_run: bool = False) -> Dict:
    """
    Backfill corrupted candles for a specific symbol and timeframe.
    Returns summary dictionary.
    """
    print(f"\n{'='*70}")
    print(f"Processing {symbol} - {timeframe}")
    print(f"{'='*70}")

    existing_candles = get_candles_in_range(symbol, timeframe)

    print(f"  📊 Existing candles in range: {len(existing_candles)}")

    if existing_candles:
        quality = analyze_candle_quality(existing_candles)
        print(f"  📈 Current data quality:")
        print(f"     - With wicks: {quality['with_wicks']} ({quality['percentage_with_wicks']:.1f}%)")
        print(f"     - Without wicks: {quality['without_wicks']}")

    tv_interval = TIMEFRAMES.get(timeframe)
    if not tv_interval:
        return {
            'symbol': symbol,
            'timeframe': timeframe,
            'status': 'error',
            'reason': 'invalid_timeframe',
            'replaced': 0,
            'errors': 1
        }

    tv_candles = fetch_tv_candles_for_range(symbol, timeframe, tv_interval)

    if not tv_candles:
        return {
            'symbol': symbol,
            'timeframe': timeframe,
            'status': 'error',
            'reason': 'fetch_failed',
            'replaced': 0,
            'errors': 1
        }

    new_quality = analyze_candle_quality(tv_candles)
    print(f"  📈 New data quality:")
    print(f"     - With wicks: {new_quality['with_wicks']} ({new_quality['percentage_with_wicks']:.1f}%)")
    print(f"     - Without wicks: {new_quality['without_wicks']}")

    if dry_run:
        print(f"  🔍 [DRY RUN] Would replace {len(existing_candles)} candles with {len(tv_candles)} new candles")
    else:
        print(f"  💾 Replacing {len(existing_candles)} candles with {len(tv_candles)} new candles...")

    success, errors = upsert_candles_batch(tv_candles, dry_run=dry_run)

    status_emoji = "✅" if not dry_run else "🔍"
    action = "Dry run complete" if dry_run else "Replaced"
    print(f"  {status_emoji} {action}: {success}, Errors: {errors}")

    return {
        'symbol': symbol,
        'timeframe': timeframe,
        'status': 'complete' if not dry_run else 'dry_run',
        'reason': 'success',
        'existing_count': len(existing_candles),
        'new_count': len(tv_candles),
        'replaced': success,
        'errors': errors,
        'quality_before': quality if existing_candles else None,
        'quality_after': new_quality
    }


def verify_final_quality():
    """
    Query database and verify candle quality in the target range.
    """
    print(f"\n{'='*70}")
    print("FINAL VERIFICATION - Candle Quality in Target Range")
    print(f"Target: {START_TIME.date()} 00:00 to 14:10 UTC")
    print(f"{'='*70}\n")

    header = "Symbol".ljust(10) + "".join([f"{tf}".ljust(12) for tf in TIMEFRAMES.keys()])
    print(header)
    print("-" * 100)

    for symbol in PAIRS:
        row = symbol.ljust(10)
        for timeframe in TIMEFRAMES.keys():
            candles = get_candles_in_range(symbol, timeframe)
            quality = analyze_candle_quality(candles)

            count = quality['total']
            wicks_pct = quality['percentage_with_wicks']

            status = "✅" if wicks_pct >= 90 else "⚠️" if wicks_pct >= 50 else "❌"
            row += f"{status}{count}({wicks_pct:.0f}%)".ljust(12)
        print(row)

    print("\n✅ = Excellent (90%+ have wicks)")
    print("⚠️ = Moderate (50-89% have wicks)")
    print("❌ = Poor (<50% have wicks)\n")


def main():
    print("╔═══════════════════════════════════════════════════════════════════╗")
    print("║  Targeted Backfill: Nov 7, 2024 Corrupted Candles (00:00-14:10) ║")
    print("╚═══════════════════════════════════════════════════════════════════╝\n")

    print(f"Target Time Range:")
    print(f"  Start: {START_TIME.isoformat()}")
    print(f"  End:   {END_TIME.isoformat()}")
    print(f"  Duration: {(END_TIME - START_TIME).total_seconds() / 3600:.2f} hours\n")

    print(f"Symbols: {', '.join(PAIRS)}")
    print(f"Timeframes: {', '.join(TIMEFRAMES.keys())}")
    print(f"Total combinations: {len(PAIRS) * len(TIMEFRAMES)}\n")

    if DRY_RUN:
        print("🔍 DRY RUN MODE - No data will be modified\n")
    else:
        print("⚠️  LIVE MODE - This will replace corrupted candles in the database\n")
        input("Press Enter to start backfill...")

    results = []
    total_replaced = 0
    total_errors = 0

    start_time = time.time()

    for symbol in PAIRS:
        for timeframe in TIMEFRAMES.keys():
            result = backfill_symbol_timeframe(symbol, timeframe, dry_run=DRY_RUN)
            results.append(result)
            total_replaced += result['replaced']
            total_errors += result['errors']

            time.sleep(1)

    duration = time.time() - start_time

    print(f"\n{'='*70}")
    if DRY_RUN:
        print("DRY RUN COMPLETE")
    else:
        print("BACKFILL COMPLETE")
    print(f"{'='*70}")
    print(f"Duration: {duration:.2f} seconds")
    print(f"Total combinations processed: {len(results)}")
    print(f"Total candles replaced: {total_replaced}")
    print(f"Total errors: {total_errors}")

    completed = sum(1 for r in results if r['status'] in ['complete', 'dry_run'])
    errored = sum(1 for r in results if r['status'] == 'error')

    print(f"\nStatus breakdown:")
    print(f"  ✅ Completed: {completed}")
    print(f"  ❌ Errors: {errored}")

    if not DRY_RUN:
        verify_final_quality()

        print("\n📊 Next Steps:")
        print("  1. Refresh your browser at pipnosis.com/trade")
        print("  2. Select any symbol/timeframe")
        print("  3. Navigate to Nov 7, 2024 on the chart")
        print("  4. Candles should now display proper wicks!")
        print("\n✨ Targeted backfill complete!\n")
    else:
        print("\n🔍 Dry run complete! Run without --dry-run to apply changes.\n")


if __name__ == '__main__':
    main()
