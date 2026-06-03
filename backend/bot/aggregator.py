from eth_abi import encode
from eth_account.signers.local import LocalAccount
from web3 import Web3

from . import chain as ch
from . import config

__all__ = ["build_params", "mint_output_to_aggregator"]

_SWAP_SELECTOR = Web3.keccak(
    text="swap(address,uint256,address,address,uint256)"
)[:4]


def build_params(
    w3: Web3,
    spend_token: str,
    spend_amount: int,
    sip_service: str,
) -> tuple[str, int, bytes]:
    """Returns (output_token, output_amount, encoded_SwapParams_bytes)."""
    if config.USE_TESTNET_AGGREGATOR:
        return _testnet(w3, spend_token, spend_amount, sip_service)
    raise NotImplementedError("Mainnet 1inch aggregator not yet implemented")


def _testnet(
    w3: Web3,
    spend_token: str,
    spend_amount: int,
    sip_service: str,
) -> tuple[str, int, bytes]:
    output_token = Web3.to_checksum_address(config.MOCK_OUTPUT_TOKEN)
    sip = Web3.to_checksum_address(sip_service)

    output_amount = spend_amount * 10**18 // (config.MOCK_ETH_PRICE_USDC * 10**6)

    swap_args = encode(
        ["address", "uint256", "address", "address", "uint256"],
        [
            Web3.to_checksum_address(spend_token),
            spend_amount,
            output_token,
            sip,
            output_amount,
        ],
    )
    swap_data = _SWAP_SELECTOR + swap_args

    min_output = output_amount * (10_000 - config.SLIPPAGE_BPS) // 10_000
    params_bytes = encode(
        ["(address,uint256,bytes)"],
        [(output_token, min_output, swap_data)],
    )

    return output_token, output_amount, params_bytes


def mint_output_to_aggregator(
    w3: Web3,
    account: LocalAccount,
    output_token: str,
    amount: int,
) -> None:
    """Pre-funds the TestAggregator so it can pay out during the swap."""
    token = ch.testnet_erc20(w3, output_token)
    aggregator_addr = Web3.to_checksum_address(config.TESTNET_AGGREGATOR_ADDR)

    nonce = w3.eth.get_transaction_count(account.address)
    tx = token.functions.mint(aggregator_addr, amount).build_transaction({
        "chainId": config.CHAIN_ID,
        "from":    account.address,
        "nonce":   nonce,
        "gasPrice": int(w3.eth.gas_price * 1.25),
    })
    tx["gas"] = w3.eth.estimate_gas(tx)
    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
