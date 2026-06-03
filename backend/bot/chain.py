import json
from pathlib import Path
from typing import Any

from eth_account.signers.local import LocalAccount
from web3 import Web3
from eth_account import Account

from . import config
from .types import ChainSubscription

__all__ = ["connect", "get_account", "get_subscription", "testnet_erc20", "gas_price_gwei"]

_ABI_DIR = Path(__file__).parent / "abi"


def _load_abi(name: str) -> list[Any]:
    with open(_ABI_DIR / f"{name}.json") as f:
        return json.load(f)


def connect() -> tuple[Web3, Any]:
    w3 = Web3(Web3.HTTPProvider(config.RPC_URL))
    if not w3.is_connected():
        raise RuntimeError(f"Cannot connect to RPC: {config.RPC_URL}")

    contract = w3.eth.contract(
        address=Web3.to_checksum_address(config.SUBSCRIPTIONS_ADDRESS),
        abi=_load_abi("Subscriptions"),
    )
    return w3, contract


def get_account(w3: Web3) -> LocalAccount:
    return Account.from_key(config.BOT_PRIVATE_KEY)


def get_subscription(w3: Web3, contract: Any, sub_id: str) -> ChainSubscription:
    id_bytes = bytes.fromhex(sub_id.removeprefix("0x"))
    s = contract.functions.getSubscription(id_bytes).call()
    return ChainSubscription(
        subscriber=s[0],
        service=s[1],
        spendToken=s[2],
        amountPerCycle=s[3],
        interval=s[4],
        lastExecutionTime=s[5],
        subscriptionStartTime=s[6],
        permitExpiry=s[7],
    )


def testnet_erc20(w3: Web3, address: str) -> Any:
    return w3.eth.contract(
        address=Web3.to_checksum_address(address),
        abi=_load_abi("TestERC20"),
    )


def gas_price_gwei(w3: Web3) -> float:
    return float(w3.from_wei(w3.eth.gas_price, "gwei"))
