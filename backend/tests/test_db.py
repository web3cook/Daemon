"""Unit tests for bot.db — all DB interactions use a fresh SQLite per test."""
import time
import pytest


# ── init ──────────────────────────────────────────────────────────────────────

def test_init_creates_tables(tmp_db):
    """init() must create the subscriptions and bot_state tables."""
    import sqlite3
    import bot.db as db
    con = sqlite3.connect(db.DB_PATH)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    con.close()
    assert "subscriptions" in tables
    assert "bot_state" in tables


def test_init_is_idempotent(tmp_db):
    """Calling init() twice must not raise."""
    import bot.db as db
    db.init()  # second call


# ── upsert_subscription ────────────────────────────────────────────────────────

def test_upsert_inserts_new_subscription(tmp_db):
    """upsert_subscription() stores a new record."""
    db = tmp_db
    db.upsert_subscription(
        sub_id="0xabc",
        subscriber="0xSub",
        service="0xSvc",
        spend_token="0xTok",
        amount_per_cycle=10_000_000,
        interval_seconds=150,
        permit_expiry=9_999_999,
        created_at_block=1,
    )
    row = db.get_subscription("0xabc")
    assert row is not None
    assert row["subscriber"] == "0xSub"
    assert row["amount_per_cycle"] == "10000000"
    assert row["interval_seconds"] == 150


def test_upsert_ignores_duplicate(tmp_db):
    """Second upsert with same id must be a no-op (ON CONFLICT DO NOTHING)."""
    db = tmp_db
    kwargs = dict(
        sub_id="0xabc",
        subscriber="0xOriginal",
        service="0xSvc",
        spend_token="0xTok",
        amount_per_cycle=1,
        interval_seconds=60,
        permit_expiry=9_999_999,
        created_at_block=1,
    )
    db.upsert_subscription(**kwargs)
    db.upsert_subscription(**{**kwargs, "subscriber": "0xChanged"})
    row = db.get_subscription("0xabc")
    assert row["subscriber"] == "0xOriginal"


def test_upsert_sets_start_time_approx_now(tmp_db, monkeypatch):
    """upsert sets last_execution_time and subscription_start_time to ~now."""
    db = tmp_db
    fake_now = 1_700_000_000
    monkeypatch.setattr("bot.db.time.time", lambda: fake_now)
    db.upsert_subscription(
        sub_id="0xts",
        subscriber="0xS",
        service="0xV",
        spend_token="0xT",
        amount_per_cycle=1,
        interval_seconds=60,
        permit_expiry=9_999_999,
        created_at_block=1,
    )
    row = db.get_subscription("0xts")
    assert row["last_execution_time"] == fake_now
    assert row["subscription_start_time"] == fake_now


# ── deactivate_subscription ───────────────────────────────────────────────────

def test_deactivate_sets_permit_expiry_to_now(tmp_db, monkeypatch):
    """deactivate_subscription() sets permit_expiry = now."""
    db = tmp_db
    db.upsert_subscription(
        sub_id="0xdead",
        subscriber="0xS",
        service="0xV",
        spend_token="0xT",
        amount_per_cycle=1,
        interval_seconds=60,
        permit_expiry=9_999_999,
        created_at_block=1,
    )
    fake_now = 1_700_000_100
    monkeypatch.setattr("bot.db.time.time", lambda: fake_now)
    db.deactivate_subscription("0xdead")
    row = db.get_subscription("0xdead")
    assert row["permit_expiry"] == fake_now


# ── update_after_execution ────────────────────────────────────────────────────

def test_update_after_execution_sets_last_execution_time(tmp_db):
    """update_after_execution() advances last_execution_time."""
    db = tmp_db
    db.upsert_subscription(
        sub_id="0xexec",
        subscriber="0xS",
        service="0xV",
        spend_token="0xT",
        amount_per_cycle=1,
        interval_seconds=60,
        permit_expiry=9_999_999,
        created_at_block=1,
    )
    db.update_after_execution("0xexec", last_execution_time=1_700_000_200)
    row = db.get_subscription("0xexec")
    assert row["last_execution_time"] == 1_700_000_200


# ── get_subscription ──────────────────────────────────────────────────────────

def test_get_subscription_returns_none_for_unknown(tmp_db):
    db = tmp_db
    assert db.get_subscription("0xnotexist") is None


# ── get_due_subscriptions ─────────────────────────────────────────────────────

def test_get_due_returns_past_due_active(tmp_db, monkeypatch):
    """A subscription whose last_execution + interval <= now and permit_expiry > now is returned."""
    db = tmp_db
    fake_now = 1_000_000
    monkeypatch.setattr("bot.db.time.time", lambda: fake_now)

    db.upsert_subscription(
        sub_id="0xdue",
        subscriber="0xS",
        service="0xV",
        spend_token="0xT",
        amount_per_cycle=1,
        interval_seconds=100,
        permit_expiry=fake_now + 500,   # still active
        created_at_block=1,
    )
    # Force last_execution_time to 200 seconds ago (well past interval=100)
    import sqlite3
    con = sqlite3.connect(db.DB_PATH)
    con.execute("UPDATE subscriptions SET last_execution_time=? WHERE id='0xdue'", (fake_now - 200,))
    con.commit()
    con.close()

    due = db.get_due_subscriptions()
    assert any(r["id"] == "0xdue" for r in due)


def test_get_due_excludes_expired_permit(tmp_db, monkeypatch):
    """Expired permit → not returned."""
    db = tmp_db
    fake_now = 1_000_000
    monkeypatch.setattr("bot.db.time.time", lambda: fake_now)

    db.upsert_subscription(
        sub_id="0xexp",
        subscriber="0xS",
        service="0xV",
        spend_token="0xT",
        amount_per_cycle=1,
        interval_seconds=100,
        permit_expiry=fake_now - 1,   # already expired
        created_at_block=1,
    )
    due = db.get_due_subscriptions()
    assert not any(r["id"] == "0xexp" for r in due)


def test_get_due_excludes_not_yet_due(tmp_db, monkeypatch):
    """Subscription executed too recently → not returned."""
    db = tmp_db
    fake_now = 1_000_000
    monkeypatch.setattr("bot.db.time.time", lambda: fake_now)

    db.upsert_subscription(
        sub_id="0xnotdue",
        subscriber="0xS",
        service="0xV",
        spend_token="0xT",
        amount_per_cycle=1,
        interval_seconds=300,
        permit_expiry=fake_now + 9999,
        created_at_block=1,
    )
    # last_execution_time = fake_now (just set by upsert) → not due for 300s
    due = db.get_due_subscriptions()
    assert not any(r["id"] == "0xnotdue" for r in due)


# ── get_state / set_state ─────────────────────────────────────────────────────

def test_set_and_get_state(tmp_db):
    db = tmp_db
    db.set_state("last_indexed_block", "12345")
    assert db.get_state("last_indexed_block") == "12345"


def test_set_state_overwrites(tmp_db):
    db = tmp_db
    db.set_state("k", "v1")
    db.set_state("k", "v2")
    assert db.get_state("k") == "v2"


def test_get_state_returns_none_for_missing(tmp_db):
    db = tmp_db
    assert db.get_state("nonexistent_key") is None
