import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

from .types import Subscription

__all__ = [
    "init",
    "upsert_subscription",
    "deactivate_subscription",
    "update_after_execution",
    "get_subscription",
    "get_due_subscriptions",
    "get_state",
    "set_state",
]

DB_PATH = Path(__file__).parent.parent / "data" / "bot.db"


@contextmanager
def _db() -> Generator[sqlite3.Connection, None, None]:
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def init() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _db() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS subscriptions (
                id                      TEXT PRIMARY KEY,
                subscriber              TEXT NOT NULL,
                service                 TEXT NOT NULL,
                spend_token             TEXT NOT NULL,
                amount_per_cycle        TEXT NOT NULL,
                interval_seconds        INTEGER NOT NULL,
                last_execution_time     INTEGER NOT NULL,
                subscription_start_time INTEGER NOT NULL,
                permit_expiry           INTEGER NOT NULL,
                created_at_block        INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS bot_state (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)


def upsert_subscription(
    sub_id: str,
    subscriber: str,
    service: str,
    spend_token: str,
    amount_per_cycle: int,
    interval_seconds: int,
    permit_expiry: int,
    created_at_block: int,
) -> None:
    now = int(time.time())
    with _db() as con:
        con.execute("""
            INSERT INTO subscriptions
                (id, subscriber, service, spend_token, amount_per_cycle,
                 interval_seconds, last_execution_time, subscription_start_time,
                 permit_expiry, created_at_block)
            VALUES (?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO NOTHING
        """, (
            sub_id, subscriber, service, spend_token, str(amount_per_cycle),
            interval_seconds, now, now,
            permit_expiry, created_at_block,
        ))


def deactivate_subscription(sub_id: str) -> None:
    """Cancel sets permitExpiry = now on-chain; mirror that locally."""
    now = int(time.time())
    with _db() as con:
        con.execute("UPDATE subscriptions SET permit_expiry=? WHERE id=?", (now, sub_id))


def update_after_execution(sub_id: str, last_execution_time: int) -> None:
    with _db() as con:
        con.execute(
            "UPDATE subscriptions SET last_execution_time=? WHERE id=?",
            (last_execution_time, sub_id),
        )


def get_subscription(sub_id: str) -> Subscription | None:
    with _db() as con:
        row = con.execute("SELECT * FROM subscriptions WHERE id=?", (sub_id,)).fetchone()
    return dict(row) if row else None


def get_due_subscriptions() -> list[Subscription]:
    now = int(time.time())
    with _db() as con:
        rows = con.execute("""
            SELECT * FROM subscriptions
            WHERE permit_expiry > ?
              AND last_execution_time + interval_seconds <= ?
        """, (now, now)).fetchall()
    return [dict(r) for r in rows]


def get_state(key: str) -> str | None:
    with _db() as con:
        row = con.execute("SELECT value FROM bot_state WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


def set_state(key: str, value: str) -> None:
    with _db() as con:
        con.execute(
            "INSERT OR REPLACE INTO bot_state (key, value) VALUES (?,?)",
            (key, str(value)),
        )
