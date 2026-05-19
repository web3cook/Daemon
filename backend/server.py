"""
server.py — Price History API for the SIP frontend.

Start:  python3 server.py   (requires seed.py to have run first)

Endpoints:
  GET /api/prices/<token>?from=YYYY-MM-DD&to=YYYY-MM-DD
  GET /api/tokens
"""

import os
import re
import sqlite3
import sys
from datetime import date, timedelta
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

PORT = 3001
DB_PATH = os.path.join(os.path.dirname(__file__), "data", "sip.db")

# ── DB check ──────────────────────────────────────────────────────────────────
if not os.path.exists(DB_PATH):
    print(f"Database not found at {DB_PATH}")
    print("Run 'python3 seed.py' first.")
    sys.exit(1)


def get_db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# ── App ───────────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per hour", "30 per minute"],
    storage_uri="memory://",
)


@app.errorhandler(429)
def rate_limit_exceeded(e):
    return jsonify(error="Rate limit exceeded. Please slow down.", retry_after=str(e.description)), 429


@app.get("/api/prices/<token>")
@limiter.limit("20 per minute")
def prices(token: str):
    from_ = request.args.get("from")
    to = request.args.get("to")

    if not from_ or not to:
        return jsonify(error='Query params "from" and "to" are required (YYYY-MM-DD).'), 400
    if not DATE_RE.match(from_) or not DATE_RE.match(to):
        return jsonify(error="Dates must be in YYYY-MM-DD format."), 400
    if from_ > to:
        return jsonify(error='"from" must be before "to".'), 400

    con = get_db()
    rows = con.execute(
        "SELECT date, price_usd FROM price_records "
        "WHERE token = ? AND date >= ? AND date <= ? ORDER BY date ASC",
        (token, from_, to),
    ).fetchall()
    con.close()

    if not rows:
        return jsonify(
            error=f'No data for "{token}" between {from_} and {to}. '
                  f'Try running seed.py again.'
        ), 404

    return jsonify(
        token=token,
        from_=from_,
        to=to,
        count=len(rows),
        data=[{"date": r["date"], "priceUsd": str(r["price_usd"])} for r in rows],
    )


@app.get("/api/tokens")
@limiter.limit("60 per minute")
def tokens():
    con = get_db()
    rows = con.execute(
        "SELECT DISTINCT token FROM price_records ORDER BY token"
    ).fetchall()
    con.close()
    return jsonify(tokens=[r["token"] for r in rows])


@app.get("/api/best-period/<token>")
@limiter.limit("20 per minute")
def best_period(token: str):
    """
    For each of [2, 3, 4, 5] years, simulate weekly $100 DCA and return
    the number of years that produces the highest P&L%.
    """
    today = date.today()
    con = get_db()
    best_yrs = None
    best_pnl = None

    for years in [2, 3, 4, 5]:
        from_date = (today - timedelta(days=years * 365)).isoformat()
        to_date = today.isoformat()

        rows = con.execute(
            "SELECT date, price_usd FROM price_records "
            "WHERE token=? AND date>=? AND date<=? ORDER BY date ASC",
            (token, from_date, to_date),
        ).fetchall()

        if len(rows) < 30:
            continue  # not enough data for this period

        price_map = {r["date"]: r["price_usd"] for r in rows}

        # Simulate weekly $100 DCA
        total_invested = 0.0
        total_tokens = 0.0
        cursor = date.fromisoformat(from_date)
        end_dt = date.fromisoformat(to_date)

        while cursor <= end_dt:
            ds = cursor.isoformat()
            price = price_map.get(ds)
            # Search ±3 days if exact date missing
            if price is None:
                for delta in range(1, 4):
                    p = price_map.get((cursor + timedelta(days=delta)).isoformat()) or \
                        price_map.get((cursor - timedelta(days=delta)).isoformat())
                    if p:
                        price = p
                        break
            if price:
                total_tokens += 100.0 / price
                total_invested += 100.0
            cursor += timedelta(days=7)

        if total_invested == 0:
            continue

        latest_price = rows[-1]["price_usd"]
        pnl_pct = (total_tokens * latest_price - total_invested) / total_invested * 100

        if best_pnl is None or pnl_pct > best_pnl:
            best_pnl = pnl_pct
            best_yrs = years

    con.close()

    if best_yrs is None:
        best_yrs = 2  # fallback — not enough data for any period

    return jsonify(best_years=best_yrs, best_pnl_pct=round(best_pnl or 0, 1))


if __name__ == "__main__":
    print(f"SIP price API → http://localhost:{PORT}")
    app.run(host='0.0.0.0', port=PORT, debug=False)
