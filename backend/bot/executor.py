import logging
import time
from typing import Any

from web3 import Web3
from web3.exceptions import ContractLogicError

from . import config, db, chain as ch, aggregator as agg

__all__ = ["run"]

log = logging.getLogger("executor")

MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds


def run(sub_id: str, w3: Web3, contract: Any) -> bool:
    """Execute one subscription. Returns True on success."""
    account = ch.get_account(w3)

    try:
        sub = ch.get_subscription(w3, contract, sub_id)
    except Exception as e:
        # broad catch: any RPC/network failure means we cannot proceed
        log.error(f"[{sub_id[:10]}] Failed to read subscription: {e}")
        return False

    now = int(time.time())

    if sub["permitExpiry"] < now:
        log.warning(f"[{sub_id[:10]}] Permit expired — deactivating")
        db.deactivate_subscription(sub_id)
        return False

    erc20_abi = [{"type": "function", "name": "balanceOf",
                  "inputs": [{"name": "", "type": "address"}],
                  "outputs": [{"name": "", "type": "uint256"}],
                  "stateMutability": "view"}]
    token = w3.eth.contract(address=Web3.to_checksum_address(sub["spendToken"]), abi=erc20_abi)
    balance = token.functions.balanceOf(sub["subscriber"]).call()
    if balance < sub["amountPerCycle"]:
        log.warning(f"[{sub_id[:10]}] Subscriber balance {balance} < {sub['amountPerCycle']} — skipping")
        return False

    gwei = ch.gas_price_gwei(w3)
    if gwei > config.MAX_GAS_GWEI:
        log.warning(f"[{sub_id[:10]}] Gas {gwei:.2f} gwei > ceiling {config.MAX_GAS_GWEI} — skipping")
        return False

    try:
        output_token, output_amount, params_bytes = agg.build_params(
            w3,
            spend_token=sub["spendToken"],
            spend_amount=sub["amountPerCycle"],
            sip_service=config.SIP_SERVICE_ADDRESS,
        )
    except Exception as e:
        # broad catch: aggregator errors are heterogeneous (HTTP, ABI, logic)
        log.error(f"[{sub_id[:10]}] Failed to build params: {e}")
        return False

    if config.USE_TESTNET_AGGREGATOR:
        try:
            agg.mint_output_to_aggregator(w3, account, output_token, output_amount)
        except Exception as e:
            # broad catch: mint is a chain tx — any failure is unrecoverable here
            log.error(f"[{sub_id[:10]}] Failed to mint output tokens: {e}")
            return False

    id_bytes = bytes.fromhex(sub_id.removeprefix("0x"))
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            nonce = w3.eth.get_transaction_count(account.address)
            tx = contract.functions.execute(id_bytes, params_bytes).build_transaction({
                "chainId":  config.CHAIN_ID,
                "from":     account.address,
                "nonce":    nonce,
                "gasPrice": int(w3.eth.gas_price * 1.25),
            })
            tx["gas"] = w3.eth.estimate_gas(tx)
            signed  = account.sign_transaction(tx)
            tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=90)

            if receipt["status"] == 1:
                db.update_after_execution(sub_id, last_execution_time=now)
                log.info(
                    f"[{sub_id[:10]}] OK tx={tx_hash.hex()[:12]}… "
                    f"next due in {sub['interval']}s"
                )
                return True
            else:
                log.error(f"[{sub_id[:10]}] Tx reverted: {tx_hash.hex()}")
                return False

        except ContractLogicError as e:
            log.error(f"[{sub_id[:10]}] Contract reverted: {e}")
            return False
        except Exception as e:
            log.warning(f"[{sub_id[:10]}] Attempt {attempt}/{MAX_RETRIES} failed: {e}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)

    log.error(f"[{sub_id[:10]}] All {MAX_RETRIES} attempts failed — skipping")
    return False
