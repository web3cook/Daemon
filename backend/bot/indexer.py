import logging
from typing import Any

from web3 import Web3

from . import config, db

__all__ = ["scan"]

log = logging.getLogger("indexer")


def scan(w3: Web3, contract: Any, from_block: int, to_block: int) -> None:
    if from_block > to_block:
        return

    chunk  = config.EVENT_CHUNK_SIZE
    start  = from_block
    total  = to_block - from_block + 1
    logged = False

    while start <= to_block:
        end = min(start + chunk - 1, to_block)

        if not logged or (start - from_block) % 50_000 == 0:
            pct = (start - from_block) * 100 // total if total else 100
            log.info(f"Scanning {start}–{to_block} ({pct}% done)")
            logged = True

        _process_chunk(w3, contract, start, end)
        db.set_state("last_indexed_block", str(end))
        start = end + 1


def _process_chunk(w3: Web3, contract: Any, from_block: int, to_block: int) -> None:
    for evt in contract.events.SubscriptionCreated.get_logs(
        from_block=from_block, to_block=to_block
    ):
        a      = evt["args"]
        sub_id = _hex_id(a["id"])
        db.upsert_subscription(
            sub_id=sub_id,
            subscriber=a["subscriber"],
            service=a["service"],
            spend_token=a["spendToken"],
            amount_per_cycle=a["amountPerCycle"],
            interval_seconds=a["interval"],
            permit_expiry=a["permitExpiry"],
            created_at_block=evt["blockNumber"],
        )
        log.info(f"[NEW] {sub_id[:10]}… subscriber={a['subscriber'][:8]}…")

    for evt in contract.events.SubscriptionCancelled.get_logs(
        from_block=from_block, to_block=to_block
    ):
        sub_id = _hex_id(evt["args"]["id"])
        db.deactivate_subscription(sub_id)
        log.info(f"[CANCEL] {sub_id[:10]}…")

    for evt in contract.events.Executed.get_logs(
        from_block=from_block, to_block=to_block
    ):
        a      = evt["args"]
        sub_id = _hex_id(a["id"])
        db.update_after_execution(sub_id, last_execution_time=a["executedAt"])
        log.info(f"[EXEC] {sub_id[:10]}… executedAt={a['executedAt']}")


def _hex_id(raw: bytes | str) -> str:
    h = raw.hex() if isinstance(raw, (bytes, bytearray)) else raw
    return h if h.startswith("0x") else "0x" + h
