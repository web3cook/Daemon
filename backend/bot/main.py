"""
SIP Execution Bot

Startup:  python3 -m bot.main   (from backend/)
"""

import logging
import sys
import time
from typing import Any

from web3 import Web3

from . import config, db, indexer, executor
from . import chain as ch

__all__: list[str] = []

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("bot")


def _catch_up(w3: Web3, contract: Any) -> int:
    last = db.get_state("last_indexed_block")
    from_block = int(last) + 1 if last else config.DEPLOY_BLOCK
    tip = w3.eth.block_number
    if from_block <= tip:
        log.info(f"Catching up: blocks {from_block}–{tip}")
        indexer.scan(w3, contract, from_block, tip)
    else:
        db.set_state("last_indexed_block", str(tip))
    return tip


def _index_new(w3: Web3, contract: Any) -> int:
    last = int(db.get_state("last_indexed_block") or 0)
    tip  = w3.eth.block_number
    if tip > last:
        indexer.scan(w3, contract, last + 1, tip)
        db.set_state("last_indexed_block", str(tip))
    return tip


def main() -> None:
    log.info("SIP bot starting…")
    db.init()

    w3, contract = ch.connect()
    acct = ch.get_account(w3)
    log.info(f"Bot address : {acct.address}")
    log.info(f"Chain ID    : {config.CHAIN_ID}")
    log.info(f"Gas ceiling : {config.MAX_GAS_GWEI} gwei")
    log.info(f"Poll every  : {config.POLL_INTERVAL_SECS}s")
    log.info(f"Testnet mode: {config.USE_TESTNET_AGGREGATOR}")

    _catch_up(w3, contract)

    log.info("Bot ready — entering main loop")

    while True:
        try:
            _index_new(w3, contract)

            due = db.get_due_subscriptions()
            if due:
                log.info(f"{len(due)} subscription(s) due for execution")
            else:
                log.debug("No subscriptions due")

            for sub in due:
                executor.run(sub["id"], w3, contract)

        except KeyboardInterrupt:
            log.info("Shutting down")
            sys.exit(0)
        except Exception as e:
            log.error(f"Loop error: {e}", exc_info=True)

        time.sleep(config.POLL_INTERVAL_SECS)


if __name__ == "__main__":
    main()
