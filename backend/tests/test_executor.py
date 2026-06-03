"""Unit tests for bot.executor.run() — all 7 guard paths + retry logic."""
import pytest
import time
from unittest.mock import MagicMock, patch, call


SUB_ID = "0xdeadbeef" + "00" * 28


def _make_sub(overrides=None):
    """Return a minimal subscription dict as returned by chain.get_subscription()."""
    now = int(time.time())
    base = {
        "subscriber": "0x" + "a" * 40,
        "service": "0x" + "b" * 40,
        "spendToken": "0x" + "c" * 40,
        "amountPerCycle": 10_000_000,
        "interval": 150,
        "lastExecutionTime": now - 200,
        "subscriptionStartTime": now - 500,
        "permitExpiry": now + 1000,
    }
    if overrides:
        base.update(overrides)
    return base


def _w3_with_gas(gwei: float = 1.0):
    from web3 import Web3
    w3 = MagicMock()
    w3.eth.gas_price = int(Web3.to_wei(gwei, "gwei"))
    w3.from_wei = Web3.from_wei
    return w3


# ── guard: chain read failure ─────────────────────────────────────────────────

def test_run_returns_false_when_get_subscription_fails():
    with patch("bot.executor.ch") as mock_ch, \
         patch("bot.executor.db"), \
         patch("bot.executor.agg"), \
         patch("bot.executor.config"):
        mock_ch.get_subscription.side_effect = Exception("RPC down")
        mock_ch.get_account.return_value = MagicMock()
        from bot.executor import run
        assert run(SUB_ID, MagicMock(), MagicMock()) is False


# ── guard: expired permit ─────────────────────────────────────────────────────

def test_run_deactivates_and_returns_false_on_expired_permit(monkeypatch):
    now = int(time.time())
    sub = _make_sub({"permitExpiry": now - 1})

    mock_db = MagicMock()
    with patch("bot.executor.ch") as mock_ch, \
         patch("bot.executor.db", mock_db), \
         patch("bot.executor.agg"), \
         patch("bot.executor.config"):
        mock_ch.get_account.return_value = MagicMock()
        mock_ch.get_subscription.return_value = sub
        monkeypatch.setattr("bot.executor.time.time", lambda: now)

        from bot.executor import run
        result = run(SUB_ID, MagicMock(), MagicMock())

    assert result is False
    mock_db.deactivate_subscription.assert_called_once_with(SUB_ID)


# ── guard: insufficient balance ───────────────────────────────────────────────

def test_run_returns_false_when_balance_below_amount(monkeypatch):
    now = int(time.time())
    sub = _make_sub({"permitExpiry": now + 1000, "amountPerCycle": 10_000_000})

    w3 = MagicMock()
    token_contract = MagicMock()
    token_contract.functions.balanceOf.return_value.call.return_value = 5_000_000
    w3.eth.contract.return_value = token_contract

    with patch("bot.executor.ch") as mock_ch, \
         patch("bot.executor.db"), \
         patch("bot.executor.agg"), \
         patch("bot.executor.config") as cfg:
        mock_ch.get_account.return_value = MagicMock()
        mock_ch.get_subscription.return_value = sub
        mock_ch.gas_price_gwei.return_value = 1.0
        cfg.MAX_GAS_GWEI = 5.0
        monkeypatch.setattr("bot.executor.time.time", lambda: now)

        from bot.executor import run
        result = run(SUB_ID, w3, MagicMock())

    assert result is False


# ── guard: gas ceiling exceeded ───────────────────────────────────────────────

def test_run_returns_false_when_gas_too_high(monkeypatch):
    now = int(time.time())
    sub = _make_sub({"permitExpiry": now + 1000, "amountPerCycle": 10_000_000})

    w3 = MagicMock()
    token_contract = MagicMock()
    token_contract.functions.balanceOf.return_value.call.return_value = 100_000_000
    w3.eth.contract.return_value = token_contract

    with patch("bot.executor.ch") as mock_ch, \
         patch("bot.executor.db"), \
         patch("bot.executor.agg"), \
         patch("bot.executor.config") as cfg:
        mock_ch.get_account.return_value = MagicMock()
        mock_ch.get_subscription.return_value = sub
        mock_ch.gas_price_gwei.return_value = 100.0  # way above ceiling
        cfg.MAX_GAS_GWEI = 5.0
        monkeypatch.setattr("bot.executor.time.time", lambda: now)

        from bot.executor import run
        result = run(SUB_ID, w3, MagicMock())

    assert result is False


# ── guard: build_params failure ───────────────────────────────────────────────

def test_run_returns_false_when_build_params_fails(monkeypatch):
    now = int(time.time())
    sub = _make_sub({"permitExpiry": now + 1000, "amountPerCycle": 10_000_000})

    w3 = MagicMock()
    token_contract = MagicMock()
    token_contract.functions.balanceOf.return_value.call.return_value = 100_000_000
    w3.eth.contract.return_value = token_contract

    with patch("bot.executor.ch") as mock_ch, \
         patch("bot.executor.db"), \
         patch("bot.executor.agg") as mock_agg, \
         patch("bot.executor.config") as cfg:
        mock_ch.get_account.return_value = MagicMock()
        mock_ch.get_subscription.return_value = sub
        mock_ch.gas_price_gwei.return_value = 1.0
        cfg.MAX_GAS_GWEI = 5.0
        cfg.USE_TESTNET_AGGREGATOR = False
        cfg.SIP_SERVICE_ADDRESS = "0x" + "4" * 40
        mock_agg.build_params.side_effect = Exception("no aggregator")
        monkeypatch.setattr("bot.executor.time.time", lambda: now)

        from bot.executor import run
        result = run(SUB_ID, w3, MagicMock())

    assert result is False


# ── guard: mint failure (testnet) ─────────────────────────────────────────────

def test_run_returns_false_when_mint_fails(monkeypatch):
    now = int(time.time())
    sub = _make_sub({"permitExpiry": now + 1000, "amountPerCycle": 10_000_000})

    w3 = MagicMock()
    token_contract = MagicMock()
    token_contract.functions.balanceOf.return_value.call.return_value = 100_000_000
    w3.eth.contract.return_value = token_contract

    with patch("bot.executor.ch") as mock_ch, \
         patch("bot.executor.db"), \
         patch("bot.executor.agg") as mock_agg, \
         patch("bot.executor.config") as cfg:
        mock_ch.get_account.return_value = MagicMock()
        mock_ch.get_subscription.return_value = sub
        mock_ch.gas_price_gwei.return_value = 1.0
        cfg.MAX_GAS_GWEI = 5.0
        cfg.USE_TESTNET_AGGREGATOR = True
        cfg.SIP_SERVICE_ADDRESS = "0x" + "4" * 40
        mock_agg.build_params.return_value = ("0x" + "2" * 40, 1000, b"\x00" * 100)
        mock_agg.mint_output_to_aggregator.side_effect = Exception("mint failed")
        monkeypatch.setattr("bot.executor.time.time", lambda: now)

        from bot.executor import run
        result = run(SUB_ID, w3, MagicMock())

    assert result is False


# ── happy path ────────────────────────────────────────────────────────────────

def test_run_returns_true_on_successful_execution(monkeypatch):
    now = int(time.time())
    sub = _make_sub({"permitExpiry": now + 1000, "amountPerCycle": 10_000_000})

    w3 = MagicMock()
    token_contract = MagicMock()
    token_contract.functions.balanceOf.return_value.call.return_value = 100_000_000
    w3.eth.contract.return_value = token_contract
    w3.eth.gas_price = 1_000_000_000
    w3.eth.get_transaction_count.return_value = 0
    w3.eth.estimate_gas.return_value = 200_000
    tx_hash = b"\xab" * 32
    w3.eth.send_raw_transaction.return_value = tx_hash
    w3.eth.wait_for_transaction_receipt.return_value = {"status": 1}

    account = MagicMock()
    signed = MagicMock()
    signed.raw_transaction = b"\x00" * 200
    account.sign_transaction.return_value = signed

    contract = MagicMock()
    contract.functions.execute.return_value.build_transaction.return_value = {}

    mock_db = MagicMock()

    with patch("bot.executor.ch") as mock_ch, \
         patch("bot.executor.db", mock_db), \
         patch("bot.executor.agg") as mock_agg, \
         patch("bot.executor.config") as cfg:
        mock_ch.get_account.return_value = account
        mock_ch.get_subscription.return_value = sub
        mock_ch.gas_price_gwei.return_value = 1.0
        cfg.MAX_GAS_GWEI = 5.0
        cfg.USE_TESTNET_AGGREGATOR = False
        cfg.SIP_SERVICE_ADDRESS = "0x" + "4" * 40
        cfg.CHAIN_ID = 421614
        mock_agg.build_params.return_value = ("0x" + "2" * 40, 1000, b"\x00" * 100)
        monkeypatch.setattr("bot.executor.time.time", lambda: now)

        from bot.executor import run
        result = run(SUB_ID, w3, contract)

    assert result is True
    mock_db.update_after_execution.assert_called_once()


# ── reverted tx ───────────────────────────────────────────────────────────────

def test_run_returns_false_on_reverted_tx(monkeypatch):
    now = int(time.time())
    sub = _make_sub({"permitExpiry": now + 1000, "amountPerCycle": 10_000_000})

    w3 = MagicMock()
    token_contract = MagicMock()
    token_contract.functions.balanceOf.return_value.call.return_value = 100_000_000
    w3.eth.contract.return_value = token_contract
    w3.eth.gas_price = 1_000_000_000
    w3.eth.get_transaction_count.return_value = 0
    w3.eth.estimate_gas.return_value = 200_000
    w3.eth.send_raw_transaction.return_value = b"\xab" * 32
    w3.eth.wait_for_transaction_receipt.return_value = {"status": 0}  # reverted

    account = MagicMock()
    signed = MagicMock()
    signed.raw_transaction = b"\x00" * 200
    account.sign_transaction.return_value = signed

    contract = MagicMock()
    contract.functions.execute.return_value.build_transaction.return_value = {}

    with patch("bot.executor.ch") as mock_ch, \
         patch("bot.executor.db"), \
         patch("bot.executor.agg") as mock_agg, \
         patch("bot.executor.config") as cfg:
        mock_ch.get_account.return_value = account
        mock_ch.get_subscription.return_value = sub
        mock_ch.gas_price_gwei.return_value = 1.0
        cfg.MAX_GAS_GWEI = 5.0
        cfg.USE_TESTNET_AGGREGATOR = False
        cfg.SIP_SERVICE_ADDRESS = "0x" + "4" * 40
        cfg.CHAIN_ID = 421614
        mock_agg.build_params.return_value = ("0x" + "2" * 40, 1000, b"\x00" * 100)
        monkeypatch.setattr("bot.executor.time.time", lambda: now)

        from bot.executor import run
        result = run(SUB_ID, w3, contract)

    assert result is False


# ── retry: exhausted ─────────────────────────────────────────────────────────

def test_run_retries_on_transient_failure_and_returns_false(monkeypatch):
    """All 3 send attempts raise → run() returns False without sleeping real time."""
    now = int(time.time())
    sub = _make_sub({"permitExpiry": now + 1000, "amountPerCycle": 10_000_000})

    w3 = MagicMock()
    token_contract = MagicMock()
    token_contract.functions.balanceOf.return_value.call.return_value = 100_000_000
    w3.eth.contract.return_value = token_contract
    w3.eth.gas_price = 1_000_000_000
    w3.eth.get_transaction_count.return_value = 0
    w3.eth.estimate_gas.return_value = 200_000
    w3.eth.send_raw_transaction.side_effect = Exception("nonce too low")

    account = MagicMock()
    signed = MagicMock()
    signed.raw_transaction = b"\x00" * 200
    account.sign_transaction.return_value = signed

    contract = MagicMock()
    contract.functions.execute.return_value.build_transaction.return_value = {}

    sleep_calls = []

    with patch("bot.executor.ch") as mock_ch, \
         patch("bot.executor.db"), \
         patch("bot.executor.agg") as mock_agg, \
         patch("bot.executor.config") as cfg, \
         patch("bot.executor.time.sleep", side_effect=lambda s: sleep_calls.append(s)):
        mock_ch.get_account.return_value = account
        mock_ch.get_subscription.return_value = sub
        mock_ch.gas_price_gwei.return_value = 1.0
        cfg.MAX_GAS_GWEI = 5.0
        cfg.USE_TESTNET_AGGREGATOR = False
        cfg.SIP_SERVICE_ADDRESS = "0x" + "4" * 40
        cfg.CHAIN_ID = 421614
        mock_agg.build_params.return_value = ("0x" + "2" * 40, 1000, b"\x00" * 100)
        monkeypatch.setattr("bot.executor.time.time", lambda: now)

        from bot.executor import run
        result = run(SUB_ID, w3, contract)

    assert result is False
    assert w3.eth.send_raw_transaction.call_count == 3
    assert len(sleep_calls) == 2  # sleep between attempt 1-2 and 2-3, not after 3


def test_run_succeeds_on_second_attempt(monkeypatch):
    """First send raises, second succeeds → run() returns True."""
    now = int(time.time())
    sub = _make_sub({"permitExpiry": now + 1000, "amountPerCycle": 10_000_000})

    w3 = MagicMock()
    token_contract = MagicMock()
    token_contract.functions.balanceOf.return_value.call.return_value = 100_000_000
    w3.eth.contract.return_value = token_contract
    w3.eth.gas_price = 1_000_000_000
    w3.eth.get_transaction_count.return_value = 0
    w3.eth.estimate_gas.return_value = 200_000
    tx_hash = b"\xab" * 32
    w3.eth.send_raw_transaction.side_effect = [Exception("timeout"), tx_hash]
    w3.eth.wait_for_transaction_receipt.return_value = {"status": 1}

    account = MagicMock()
    signed = MagicMock()
    signed.raw_transaction = b"\x00" * 200
    account.sign_transaction.return_value = signed

    contract = MagicMock()
    contract.functions.execute.return_value.build_transaction.return_value = {}

    mock_db = MagicMock()

    with patch("bot.executor.ch") as mock_ch, \
         patch("bot.executor.db", mock_db), \
         patch("bot.executor.agg") as mock_agg, \
         patch("bot.executor.config") as cfg, \
         patch("bot.executor.time.sleep"):
        mock_ch.get_account.return_value = account
        mock_ch.get_subscription.return_value = sub
        mock_ch.gas_price_gwei.return_value = 1.0
        cfg.MAX_GAS_GWEI = 5.0
        cfg.USE_TESTNET_AGGREGATOR = False
        cfg.SIP_SERVICE_ADDRESS = "0x" + "4" * 40
        cfg.CHAIN_ID = 421614
        mock_agg.build_params.return_value = ("0x" + "2" * 40, 1000, b"\x00" * 100)
        monkeypatch.setattr("bot.executor.time.time", lambda: now)

        from bot.executor import run
        result = run(SUB_ID, w3, contract)

    assert result is True
    assert w3.eth.send_raw_transaction.call_count == 2
    mock_db.update_after_execution.assert_called_once()
