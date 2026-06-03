import os
import sys
from dotenv import load_dotenv

load_dotenv()

__all__ = [
    "RPC_URL", "BOT_PRIVATE_KEY", "SUBSCRIPTIONS_ADDRESS", "CHAIN_ID",
    "DEPLOY_BLOCK", "MAX_GAS_GWEI", "POLL_INTERVAL_SECS", "EVENT_CHUNK_SIZE",
    "SLIPPAGE_BPS", "USE_TESTNET_AGGREGATOR", "MOCK_OUTPUT_TOKEN",
    "TESTNET_AGGREGATOR_ADDR", "SIP_SERVICE_ADDRESS", "MOCK_ETH_PRICE_USDC",
]

def _require(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        print(f"Error: {key} is not set. Check backend/.env")
        sys.exit(1)
    return val

RPC_URL                  = _require("RPC_URL")
BOT_PRIVATE_KEY          = _require("BOT_PRIVATE_KEY")
SUBSCRIPTIONS_ADDRESS    = _require("SUBSCRIPTIONS_ADDRESS")
CHAIN_ID                 = int(os.environ.get("CHAIN_ID", "421614"))
DEPLOY_BLOCK             = int(os.environ.get("DEPLOY_BLOCK", "0"))
MAX_GAS_GWEI             = float(os.environ.get("MAX_GAS_GWEI", "5"))
POLL_INTERVAL_SECS       = int(os.environ.get("POLL_INTERVAL_SECS", "30"))
EVENT_CHUNK_SIZE         = int(os.environ.get("EVENT_CHUNK_SIZE", "1000"))
SLIPPAGE_BPS             = int(os.environ.get("SLIPPAGE_BPS", "50"))   # 0.5%
USE_TESTNET_AGGREGATOR   = os.environ.get("USE_TESTNET_AGGREGATOR", "true").lower() == "true"

# Testnet-only
MOCK_OUTPUT_TOKEN        = os.environ.get("MOCK_OUTPUT_TOKEN", "")   # e.g. mWETH address
TESTNET_AGGREGATOR_ADDR  = os.environ.get("TESTNET_AGGREGATOR_ADDR", "")
SIP_SERVICE_ADDRESS      = os.environ.get("SIP_SERVICE_ADDRESS", "")
MOCK_ETH_PRICE_USDC      = int(os.environ.get("MOCK_ETH_PRICE_USDC", "3000"))
