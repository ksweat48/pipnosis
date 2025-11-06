#!/usr/bin/env python3
"""
TradingView Historical Data Backfill Script

One-time script to populate forex_candles table with 200 historical candles
from TradingView for all Pipnosis trading pairs and timeframes.

Usage:
    python3 backfill_historical_candles.py

Requirements:
    - Install dependencies: pip install -r requirements.txt
    - Ensure .env file is configured with Supabase credentials
"""

import os
import sys
from datetime import datetime, timezone
from typing import List, Dict, Tuple, Optional
from dotenv import load_dotenv
from tvdatafeed import TvDatafeed, Interval
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

CANDLES_TO_FETCH = 200

SUPABASE_URL = os.getenv('VITE_SUPABASE_URL')
SUPABASE_KEY = os.getenv('VITE_SUPABASE_ANON_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Error: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env")
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


def get_existing_candle_info(symbol: str, timeframe: str) -> Tuple[int, Optional[str]]:
    """
    Query existing candles for a symbol/timeframe combination.
    Returns (count, earliest_timestamp).
    """
    try:
        response = supabase.table('forex_candles').select('open_time').eq('symbol', symbol).eq('timeframe', timeframe).order('open_time', desc=False).limit(1).execute()

        count_response = supabase.table('forex_candles').select('id', count='exact').eq('symbol', symbol).eq('timeframe', timeframe).execute()

        count = count_response.count if count_response.count else 0
        earliest = response.data[0]['open_time'] if response.data else None

        return count, earliest
    except Exception as e:
        print(f"⚠️  Error querying {symbol} {timeframe}: {e}")
        return 0, None


def fetch_tv_candles(symbol: str, timeframe: str, tv_interval: Interval, limit: int = 200) -> Optional[List[Dict]]:
    """
    Fetch historical candles from TradingView.
    Returns list of candle dictionaries.
    """
    exchange, tv_symbol = SYMBOL_MAPPING.get(symbol, (None, None))

    if not exchange or not tv_symbol:
        print(f"❌ {symbol} not mapped to TradingView symbol")
        return None

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

            timeframe_minutes = {
                'M1': 1, 'M5': 5, 'M15': 15, 'M30': 30,
                'H1': 60, 'H4': 240, 'D1': 1440, 'W1': 10080
            }.get(timeframe, 15)

            close_time = datetime.fromtimestamp(
                open_time.timestamp() + (timeframe_minutes * 60),
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
            })

        print(f"  ✅ Fetched {len(candles)} candles for {symbol} {timeframe}")
        return candles

    except Exception as e:
        print(f"  ❌ Error fetching {symbol} {timeframe}: {e}")
        return None


def filter_candles_before_timestamp(candles: List[Dict], before_timestamp: str) -> List[Dict]:
    """
    Filter candles to only include those with open_time before the given timestamp.
    """
    before_dt = datetime.fromisoformat(before_timestamp.replace('Z', '+00:00'))

    filtered = [
        c for c in candles
        if datetime.fromisoformat(c['open_time'].replace('Z', '+00:00')) < before_dt
    ]

    return filtered


def insert_candles_batch(candles: List[Dict]) -> Tuple[int, int]:
    """
    Insert candles into database in batches.
    Returns (successful_inserts, failed_inserts).
    """
    if not candles:
        return 0, 0

    success_count = 0
    error_count = 0

    batch_size = 50
    for i in range(0, len(candles), batch_size):
        batch = candles[i:i + batch_size]

        try:
            response = supabase.table('forex_candles').upsert(
                batch,
                on_conflict='symbol,timeframe,open_time',
                ignore_duplicates=True
            ).execute()

            success_count += len(batch)

        except Exception as e:
            print(f"    ⚠️  Batch insert error: {e}")
            error_count += len(batch)

    return success_count, error_count


def backfill_symbol_timeframe(symbol: str, timeframe: str) -> Dict:
    """
    Backfill historical data for a specific symbol and timeframe.
    Returns summary dictionary.
    """
    print(f"\n{'='*60}")
    print(f"Processing {symbol} - {timeframe}")
    print(f"{'='*60}")

    existing_count, earliest_timestamp = get_existing_candle_info(symbol, timeframe)

    print(f"  📊 Existing candles: {existing_count}")
    if earliest_timestamp:
        print(f"  📅 Earliest existing: {earliest_timestamp}")

    if existing_count >= CANDLES_TO_FETCH:
        print(f"  ✓ Already has {existing_count} candles (target: {CANDLES_TO_FETCH}), skipping.")
        return {
            'symbol': symbol,
            'timeframe': timeframe,
            'status': 'skipped',
            'reason': f'already_has_{existing_count}_candles',
            'inserted': 0,
            'errors': 0
        }

    tv_interval = TIMEFRAMES.get(timeframe)
    if not tv_interval:
        return {
            'symbol': symbol,
            'timeframe': timeframe,
            'status': 'error',
            'reason': 'invalid_timeframe',
            'inserted': 0,
            'errors': 1
        }

    candles_to_fetch = CANDLES_TO_FETCH - existing_count + 50

    tv_candles = fetch_tv_candles(symbol, timeframe, tv_interval, limit=candles_to_fetch)

    if not tv_candles:
        return {
            'symbol': symbol,
            'timeframe': timeframe,
            'status': 'error',
            'reason': 'fetch_failed',
            'inserted': 0,
            'errors': 1
        }

    if earliest_timestamp:
        print(f"  🔍 Filtering candles before {earliest_timestamp}...")
        candles_to_insert = filter_candles_before_timestamp(tv_candles, earliest_timestamp)
        print(f"  📦 {len(candles_to_insert)} candles to insert (filtered from {len(tv_candles)})")
    else:
        candles_to_insert = tv_candles
        print(f"  📦 {len(candles_to_insert)} candles to insert (no existing data)")

    if not candles_to_insert:
        print(f"  ✓ No new candles to insert")
        return {
            'symbol': symbol,
            'timeframe': timeframe,
            'status': 'complete',
            'reason': 'no_new_candles',
            'inserted': 0,
            'errors': 0
        }

    print(f"  💾 Inserting {len(candles_to_insert)} candles into database...")
    success, errors = insert_candles_batch(candles_to_insert)

    print(f"  ✅ Inserted: {success}, Errors: {errors}")

    return {
        'symbol': symbol,
        'timeframe': timeframe,
        'status': 'complete',
        'reason': 'success',
        'inserted': success,
        'errors': errors
    }


def verify_final_counts():
    """
    Query database and display final candle counts for all symbols/timeframes.
    """
    print(f"\n{'='*60}")
    print("FINAL VERIFICATION - Candle Counts by Symbol/Timeframe")
    print(f"{'='*60}\n")

    header = "Symbol".ljust(10) + "".join([tf.ljust(8) for tf in TIMEFRAMES.keys()])
    print(header)
    print("-" * 70)

    for symbol in PAIRS:
        row = symbol.ljust(10)
        for timeframe in TIMEFRAMES.keys():
            count, _ = get_existing_candle_info(symbol, timeframe)
            status = "✅" if count >= 150 else "⚠️" if count >= 100 else "❌"
            row += f"{status}{count}".ljust(8)
        print(row)

    print("\n✅ = Good (150+ candles)")
    print("⚠️ = Moderate (100-149 candles)")
    print("❌ = Low (<100 candles)\n")


def main():
    print("╔═══════════════════════════════════════════════════════════╗")
    print("║  TradingView Historical Data Backfill for Pipnosis       ║")
    print("╚═══════════════════════════════════════════════════════════╝\n")

    print(f"Symbols: {', '.join(PAIRS)}")
    print(f"Timeframes: {', '.join(TIMEFRAMES.keys())}")
    print(f"Target: {CANDLES_TO_FETCH} candles per combination")
    print(f"Total combinations: {len(PAIRS) * len(TIMEFRAMES)}\n")

    input("Press Enter to start backfill...")

    results = []
    total_inserted = 0
    total_errors = 0

    start_time = time.time()

    for symbol in PAIRS:
        for timeframe in TIMEFRAMES.keys():
            result = backfill_symbol_timeframe(symbol, timeframe)
            results.append(result)
            total_inserted += result['inserted']
            total_errors += result['errors']

            time.sleep(1)

    duration = time.time() - start_time

    print(f"\n{'='*60}")
    print("BACKFILL COMPLETE")
    print(f"{'='*60}")
    print(f"Duration: {duration:.2f} seconds")
    print(f"Total combinations processed: {len(results)}")
    print(f"Total candles inserted: {total_inserted}")
    print(f"Total errors: {total_errors}")

    skipped = sum(1 for r in results if r['status'] == 'skipped')
    completed = sum(1 for r in results if r['status'] == 'complete')
    errored = sum(1 for r in results if r['status'] == 'error')

    print(f"\nStatus breakdown:")
    print(f"  ✅ Completed: {completed}")
    print(f"  ⏭️  Skipped: {skipped}")
    print(f"  ❌ Errors: {errored}")

    verify_final_counts()

    print("\n📊 Next Steps:")
    print("  1. Refresh your browser at pipnosis.com/trade")
    print("  2. Select any symbol/timeframe")
    print("  3. You should now see historical candles on the chart!")
    print("\n✨ Backfill complete! Your charts now have rich historical context.\n")


if __name__ == '__main__':
    main()
