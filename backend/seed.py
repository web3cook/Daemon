"""
seed.py — Pre-fetches daily price history for all supported tokens
from CoinCap v3 and stores it in a local SQLite database.

Run once:   python3 seed.py
Re-run anytime to top-up with the latest data (uses INSERT OR REPLACE).
"""

import os
import requests
import sqlite3
import sys
import time
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
COINCAP_KEY = os.environ.get("COINCAP_KEY")
if not COINCAP_KEY:
    print("Error: COINCAP_KEY not set. Add it to backend/.env")
    sys.exit(1)
DB_PATH = os.path.join(os.path.dirname(__file__), "data", "sip.db")
YEAR_MS = 364 * 86_400_000  # stay under CoinCap's 1-year-per-request cap
DELAY_S = 0.5  # polite pause between requests

# (slug, seed_from) — start date per token based on when data is available
TOKENS = [
    ("bitcoin", "2020-01-01"),
    ("ethereum", "2020-01-01"),
    ("binance-coin", "2020-01-01"),
    ("solana", "2020-01-01"),
    ("hyperliquid", "2024-11-01"),  # HYPE launched Nov 2024
]


# ── Helpers ───────────────────────────────────────────────────────────────────
def to_ms(date_str: str) -> int:
    dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def fetch_chunk(slug: str, start: int, end: int) -> list[dict]:
    url = f"https://rest.coincap.io/v3/assets/{slug}/history?interval=d1&start={start}&end={end}"
    resp = requests.get(url, headers={"Authorization": f"Bearer {COINCAP_KEY}"}, timeout=30)
    resp.raise_for_status()
    return resp.json().get("data", [])


def fetch_all(slug: str, from_ms: int, to_ms: int) -> list[dict]:
    records = []
    cursor = from_ms
    while cursor < to_ms:
        end = min(cursor + YEAR_MS, to_ms)
        start_str = datetime.fromtimestamp(cursor / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        end_str = datetime.fromtimestamp(end / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
        print(f"  {start_str} → {end_str} … ", end="", flush=True)
        chunk = fetch_chunk(slug, cursor, end)
        print(f"{len(chunk)} records")
        records.extend(chunk)
        cursor = end
        if cursor < to_ms:
            time.sleep(DELAY_S)
    return records


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    cur.executescript("""
                      CREATE TABLE IF NOT EXISTS price_records
                      (
                          token
                          TEXT
                          NOT
                          NULL,
                          date
                          TEXT
                          NOT
                          NULL,
                          price_usd
                          REAL
                          NOT
                          NULL,
                          ts
                          INTEGER
                          NOT
                          NULL,
                          PRIMARY
                          KEY
                      (
                          token,
                          date
                      )
                          );
                      CREATE INDEX IF NOT EXISTS idx_token_date ON price_records (token, date);
                      """)
    con.commit()

    to_ms_ = int(datetime.now(tz=timezone.utc).timestamp() * 1000)

    for slug, seed_from in TOKENS:
        print(f"\n[{slug}]")
        try:
            raw = fetch_all(slug, to_ms(seed_from), to_ms_)
            rows = [
                (slug, r["date"][:10], float(r["priceUsd"]), int(r["time"]))
                for r in raw
            ]
            cur.executemany(
                "INSERT OR REPLACE INTO price_records (token, date, price_usd, ts) VALUES (?,?,?,?)",
                rows,
            )
            con.commit()
            print(f"  ✓ {len(rows)} records stored")
        except Exception as e:
            print(f"  ✗ failed: {e}")

    # Summary
    print("\n── Summary ──────────────────────────────────")
    for row in cur.execute(
            "SELECT token, COUNT(*) n, MIN(date) first, MAX(date) last "
            "FROM price_records GROUP BY token ORDER BY token"
    ):
        print(f"  {row[0]:<18} {row[1]} days  ({row[2]} → {row[3]})")

    print(f"\nDatabase: {DB_PATH}")
    con.close()


if __name__ == "__main__":
    main()
