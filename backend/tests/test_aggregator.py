"""Unit tests for bot.aggregator — verifies swap calldata construction."""
import pytest
from unittest.mock import MagicMock, patch
from eth_abi import decode
from web3 import Web3


SPEND_TOKEN  = Web3.to_checksum_address("0x" + "cc" * 20)
SIP_SERVICE  = Web3.to_checksum_address("0x" + "44" * 20)
OUTPUT_TOKEN = Web3.to_checksum_address("0x" + "22" * 20)
AGGREGATOR   = Web3.to_checksum_address("0x" + "33" * 20)


def _fake_config(monkeypatch):
    monkeypatch.setattr("bot.aggregator.config.USE_TESTNET_AGGREGATOR", True)
    monkeypatch.setattr("bot.aggregator.config.MOCK_OUTPUT_TOKEN", OUTPUT_TOKEN)
    monkeypatch.setattr("bot.aggregator.config.TESTNET_AGGREGATOR_ADDR", AGGREGATOR)
    monkeypatch.setattr("bot.aggregator.config.MOCK_ETH_PRICE_USDC", 3000)
    monkeypatch.setattr("bot.aggregator.config.SLIPPAGE_BPS", 50)


# ── build_params routing ──────────────────────────────────────────────────────

def test_build_params_routes_to_testnet(monkeypatch):
    """build_params() must delegate to _testnet() when USE_TESTNET_AGGREGATOR is True."""
    _fake_config(monkeypatch)
    from bot.aggregator import build_params
    w3 = MagicMock()
    token, amount, params = build_params(w3, SPEND_TOKEN, 10_000_000, SIP_SERVICE)
    assert token == OUTPUT_TOKEN
    assert isinstance(amount, int)
    assert isinstance(params, bytes)


def test_build_params_raises_for_mainnet(monkeypatch):
    """build_params() raises NotImplementedError when testnet flag is off."""
    _fake_config(monkeypatch)
    monkeypatch.setattr("bot.aggregator.config.USE_TESTNET_AGGREGATOR", False)
    from bot.aggregator import build_params
    with pytest.raises(NotImplementedError):
        build_params(MagicMock(), SPEND_TOKEN, 10_000_000, SIP_SERVICE)


# ── _testnet output amount ────────────────────────────────────────────────────

def test_testnet_output_amount_formula(monkeypatch):
    """output_amount = spend * 10^18 // (price * 10^6)  with price=3000."""
    _fake_config(monkeypatch)
    from bot.aggregator import build_params
    spend = 10_000_000  # 10 USDC (6 dec)
    _, output_amount, _ = build_params(MagicMock(), SPEND_TOKEN, spend, SIP_SERVICE)
    expected = spend * 10**18 // (3000 * 10**6)
    assert output_amount == expected


def test_testnet_output_amount_scales_with_price(monkeypatch):
    """Higher ETH price → less output WETH for the same USDC spend (within 1 unit due to integer division)."""
    _fake_config(monkeypatch)
    spend = 10_000_000
    monkeypatch.setattr("bot.aggregator.config.MOCK_ETH_PRICE_USDC", 6000)
    from bot.aggregator import build_params
    _, amount_6k, _ = build_params(MagicMock(), SPEND_TOKEN, spend, SIP_SERVICE)

    monkeypatch.setattr("bot.aggregator.config.MOCK_ETH_PRICE_USDC", 3000)
    _, amount_3k, _ = build_params(MagicMock(), SPEND_TOKEN, spend, SIP_SERVICE)

    # integer floor division means the ratio is within 1 unit of exactly 2×
    assert abs(amount_3k - amount_6k * 2) <= 1


# ── _testnet SwapParams struct ────────────────────────────────────────────────

def test_testnet_params_bytes_decode_correctly(monkeypatch):
    """params_bytes must decode as (outputToken, minOutput, swapData) tuple."""
    _fake_config(monkeypatch)
    from bot.aggregator import build_params
    spend = 10_000_000
    output_token, output_amount, params_bytes = build_params(
        MagicMock(), SPEND_TOKEN, spend, SIP_SERVICE
    )

    decoded = decode(["(address,uint256,bytes)"], params_bytes)
    out_addr, min_output, swap_data = decoded[0]

    assert Web3.to_checksum_address(out_addr) == output_token
    # min_output = output_amount * (10000 - 50) // 10000
    expected_min = output_amount * (10_000 - 50) // 10_000
    assert min_output == expected_min
    assert isinstance(swap_data, bytes) and len(swap_data) > 4


def test_testnet_swap_data_starts_with_selector(monkeypatch):
    """The first 4 bytes of swapData must be the swap() selector."""
    _fake_config(monkeypatch)
    from bot.aggregator import build_params, _SWAP_SELECTOR
    _, _, params_bytes = build_params(MagicMock(), SPEND_TOKEN, 10_000_000, SIP_SERVICE)
    decoded = decode(["(address,uint256,bytes)"], params_bytes)
    swap_data = decoded[0][2]
    assert swap_data[:4] == _SWAP_SELECTOR


def test_testnet_swap_data_encodes_sip_as_recipient(monkeypatch):
    """The swapData must reference sip_service as the recipient address."""
    _fake_config(monkeypatch)
    from bot.aggregator import build_params
    _, _, params_bytes = build_params(MagicMock(), SPEND_TOKEN, 10_000_000, SIP_SERVICE)
    decoded = decode(["(address,uint256,bytes)"], params_bytes)
    swap_data = decoded[0][2]
    # Decode inner swap() args
    inner = decode(
        ["address", "uint256", "address", "address", "uint256"],
        swap_data[4:],
    )
    recipient = Web3.to_checksum_address(inner[3])
    assert recipient == SIP_SERVICE


# ── mint_output_to_aggregator ─────────────────────────────────────────────────

def test_mint_sends_tx_to_aggregator(monkeypatch):
    """mint_output_to_aggregator() must call token.mint(aggregator, amount)."""
    _fake_config(monkeypatch)

    mock_token = MagicMock()
    mock_receipt = MagicMock()

    w3 = MagicMock()
    w3.eth.get_transaction_count.return_value = 0
    w3.eth.gas_price = Web3.to_wei(1, "gwei")
    w3.eth.estimate_gas.return_value = 50_000
    w3.eth.send_raw_transaction.return_value = b"\xab" * 32
    w3.eth.wait_for_transaction_receipt.return_value = mock_receipt

    account = MagicMock()
    account.address = "0x" + "ff" * 20
    signed = MagicMock()
    signed.raw_transaction = b"\x00" * 200
    account.sign_transaction.return_value = signed

    # ch is imported inside mint_output_to_aggregator, so patch at source
    with patch("bot.chain.testnet_erc20", return_value=mock_token):
        mock_token.functions.mint.return_value.build_transaction.return_value = {}

        from bot.aggregator import mint_output_to_aggregator
        mint_output_to_aggregator(w3, account, OUTPUT_TOKEN, 1_000_000)

    mock_token.functions.mint.assert_called_once_with(AGGREGATOR, 1_000_000)
    w3.eth.send_raw_transaction.assert_called_once()
