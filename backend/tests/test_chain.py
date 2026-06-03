"""Unit tests for bot.chain — connection, account loading, subscription parsing."""
import pytest
from unittest.mock import MagicMock, patch, mock_open
import json


MOCK_ABI = [
    {"type": "function", "name": "getSubscription",
     "inputs": [{"name": "id", "type": "bytes32"}],
     "outputs": [{"name": "", "type": "address"}],
     "stateMutability": "view"}
]


# ── connect ───────────────────────────────────────────────────────────────────

def test_connect_returns_w3_and_contract(monkeypatch):
    """connect() must return a connected Web3 instance and a contract."""
    mock_w3 = MagicMock()
    mock_w3.is_connected.return_value = True
    mock_contract = MagicMock()
    mock_w3.eth.contract.return_value = mock_contract

    with patch("bot.chain.Web3") as mock_web3_cls, \
         patch("bot.chain._load_abi", return_value=MOCK_ABI), \
         patch("bot.chain.config") as cfg:
        cfg.RPC_URL = "http://localhost:8545"
        cfg.SUBSCRIPTIONS_ADDRESS = "0x" + "1" * 40
        mock_web3_cls.return_value = mock_w3
        mock_web3_cls.HTTPProvider = MagicMock()
        mock_web3_cls.to_checksum_address.return_value = "0x" + "1" * 40

        from bot.chain import connect
        w3, contract = connect()

    assert w3 is mock_w3
    assert contract is mock_contract


def test_connect_raises_when_not_connected(monkeypatch):
    """connect() must raise RuntimeError when w3.is_connected() is False."""
    mock_w3 = MagicMock()
    mock_w3.is_connected.return_value = False

    with patch("bot.chain.Web3") as mock_web3_cls, \
         patch("bot.chain._load_abi", return_value=MOCK_ABI), \
         patch("bot.chain.config") as cfg:
        cfg.RPC_URL = "http://dead:9999"
        cfg.SUBSCRIPTIONS_ADDRESS = "0x" + "1" * 40
        mock_web3_cls.return_value = mock_w3
        mock_web3_cls.HTTPProvider = MagicMock()

        from bot.chain import connect
        with pytest.raises(RuntimeError, match="Cannot connect"):
            connect()


# ── get_account ───────────────────────────────────────────────────────────────

def test_get_account_uses_config_key(monkeypatch):
    """get_account() returns an Account derived from BOT_PRIVATE_KEY."""
    fake_key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    with patch("bot.chain.config") as cfg:
        cfg.BOT_PRIVATE_KEY = fake_key
        from bot.chain import get_account
        account = get_account(MagicMock())
    # The account address should be derived from the well-known Foundry key
    assert account.address == "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"


# ── get_subscription ──────────────────────────────────────────────────────────

def test_get_subscription_maps_tuple_to_dict():
    """get_subscription() converts the on-chain 8-tuple to a named dict."""
    sub_id = "0xdeadbeef" + "00" * 28
    raw_tuple = (
        "0xSub",         # subscriber
        "0xSvc",         # service
        "0xTok",         # spendToken
        10_000_000,      # amountPerCycle
        150,             # interval
        1_700_000_000,   # lastExecutionTime
        1_699_999_000,   # subscriptionStartTime
        1_700_100_000,   # permitExpiry
    )
    contract = MagicMock()
    contract.functions.getSubscription.return_value.call.return_value = raw_tuple

    from bot.chain import get_subscription
    result = get_subscription(MagicMock(), contract, sub_id)

    assert result["subscriber"] == "0xSub"
    assert result["amountPerCycle"] == 10_000_000
    assert result["interval"] == 150
    assert result["permitExpiry"] == 1_700_100_000


def test_get_subscription_strips_0x_from_id():
    """get_subscription() accepts IDs both with and without 0x prefix."""
    contract = MagicMock()
    contract.functions.getSubscription.return_value.call.return_value = (
        "0x" + "a" * 40, "0x" + "b" * 40, "0x" + "c" * 40,
        1, 60, 1000, 900, 9999
    )
    from bot.chain import get_subscription
    result = get_subscription(MagicMock(), contract, "deadbeef" + "00" * 28)
    assert result["subscriber"] == "0x" + "a" * 40


# ── gas_price_gwei ────────────────────────────────────────────────────────────

def test_gas_price_gwei_converts_wei_to_gwei():
    """gas_price_gwei() returns the base fee in gwei as a float."""
    from web3 import Web3
    w3 = MagicMock()
    w3.eth.gas_price = int(Web3.to_wei(2.5, "gwei"))
    w3.from_wei = Web3.from_wei

    from bot.chain import gas_price_gwei
    result = gas_price_gwei(w3)
    assert abs(float(result) - 2.5) < 0.01
