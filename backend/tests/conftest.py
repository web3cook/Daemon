"""
Shared fixtures and env setup for all bot tests.
Must be imported before any bot module to satisfy config._require().
"""
import os
import sys
import pytest

# Inject required env vars before any bot module is imported
os.environ.setdefault("BOT_PRIVATE_KEY", "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
os.environ.setdefault("RPC_URL", "http://localhost:8545")
os.environ.setdefault("SUBSCRIPTIONS_ADDRESS", "0x" + "1" * 40)
os.environ.setdefault("USE_TESTNET_AGGREGATOR", "true")
os.environ.setdefault("MOCK_OUTPUT_TOKEN", "0x" + "2" * 40)
os.environ.setdefault("TESTNET_AGGREGATOR_ADDR", "0x" + "3" * 40)
os.environ.setdefault("SIP_SERVICE_ADDRESS", "0x" + "4" * 40)
os.environ.setdefault("MOCK_ETH_PRICE_USDC", "3000")
os.environ.setdefault("SLIPPAGE_BPS", "50")
os.environ.setdefault("CHAIN_ID", "421614")
os.environ.setdefault("DEPLOY_BLOCK", "100")
os.environ.setdefault("MAX_GAS_GWEI", "5")


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    """Redirect DB_PATH to a fresh temp file for each test."""
    db_file = tmp_path / "bot.db"
    monkeypatch.setattr("bot.db.DB_PATH", db_file)
    import bot.db as db_mod
    db_mod.init()
    return db_mod


@pytest.fixture
def sample_sub():
    """A minimal subscription dict mirroring db.get_subscription() output."""
    now = 1_000_000
    return {
        "id": "0xdeadbeef" + "00" * 28,
        "subscriber": "0x" + "a" * 40,
        "service": "0x" + "b" * 40,
        "spend_token": "0x" + "c" * 40,
        "amount_per_cycle": "10000000",
        "interval_seconds": 150,
        "last_execution_time": now - 200,
        "subscription_start_time": now - 500,
        "permit_expiry": now + 1000,
        "created_at_block": 273_000_000,
    }
