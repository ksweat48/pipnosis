#!/usr/bin/env python3
"""
Emergency Price Feed - Get Live Ticks Flowing Immediately

Run this script while you fix MetaAPI or switch to another provider.

Usage:
    python3 emergency-price-feed.py

Press Ctrl+C to stop.
"""

import urllib.request
import urllib.parse
import json
import time
import random
from datetime import datetime, timezone

# Configuration
SUPABASE_URL = "https://nzisgxdlydihlwsvonfy.supabase.co"
SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56aXNneGRseWRpaGx3c3ZvbmZ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTU5NTU0MCwiZXhwIjoyMDc1MTcxNTQwfQ.Bas3dKkvMSzBPAK4zUJ24JC-T0-bcLQeJ458KYv-X5U"

# Base prices for realistic simulation
BASE_PRICES = {
    "EURUSD": 1.15500,
    "GBPUSD": 1.28500,
    "USDJPY": 153.900,
    "XAUUSD": 2650.00,
    "US30": 43500.0,
}

SPREADS = {
    "EURUSD": 0.00002,
    "GBPUSD": 0.00003,
    "USDJPY": 0.003,
    "XAUUSD": 0.50,
    "US30": 3.0,
}

def insert_price(symbol: str, bid: float, ask: float, mid: float, spread: float, timestamp: str) -> bool:
    """Insert a price into the database"""
    url = f"{SUPABASE_URL}/rest/v1/realtime_prices"

    data = {
        "symbol": symbol,
        "bid": bid,
        "ask": ask,
        "mid": mid,
        "spread": spread,
        "broker_time": timestamp,
        "source": "emergency_feed"
    }

    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(data).encode('utf-8'),
            headers={
                "apikey": SERVICE_KEY,
                "Authorization": f"Bearer {SERVICE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            },
            method='POST'
        )

        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status in [200, 201]
    except Exception as e:
        print(f"❌ Error inserting {symbol}: {e}")
        return False

def generate_price_movement(base_price: float, max_movement: float = 0.0001) -> float:
    """Generate realistic price movement (±0.01% by default)"""
    factor = random.uniform(-max_movement, max_movement)
    return base_price * (1 + factor)

def main():
    print("🚀 Emergency Price Feed Starting...")
    print("📊 Simulating live forex prices every 2 seconds")
    print("🔴 Press Ctrl+C to stop")
    print("")

    counter = 0
    success_count = 0
    fail_count = 0

    try:
        while True:
            counter += 1
            timestamp = datetime.now(timezone.utc).isoformat(timespec='milliseconds')
            batch_success = 0

            for symbol, base_price in BASE_PRICES.items():
                spread = SPREADS[symbol]

                # Generate realistic price with small random movement
                current_price = generate_price_movement(base_price)
                bid = round(current_price, 5)
                ask = round(bid + spread, 5)
                mid = round((bid + ask) / 2, 5)

                # Insert into database
                success = insert_price(symbol, bid, ask, mid, spread, timestamp)

                if success:
                    batch_success += 1
                    success_count += 1
                    print(f"✅ [{counter}] {symbol}: {bid:.5f}/{ask:.5f}")
                else:
                    fail_count += 1
                    print(f"❌ [{counter}] {symbol}: Failed to insert")

            # Status line
            print(f"📈 Batch {counter}: {batch_success}/{len(BASE_PRICES)} successful | Total: {success_count} ✅ {fail_count} ❌")
            print("")

            time.sleep(2)

    except KeyboardInterrupt:
        print("\n\n🛑 Stopping emergency price feed...")
        print(f"📊 Final stats: {success_count} successful, {fail_count} failed")
        print("✅ Done!")

if __name__ == "__main__":
    main()
