"""Unit tests for bot.indexer — verifies event→DB mapping and chunking."""
import pytest
from unittest.mock import MagicMock, patch, call


# ── helpers ───────────────────────────────────────────────────────────────────

def _make_event(args: dict, block_number: int = 1) -> dict:
    return {"args": args, "blockNumber": block_number}


def _bytes_id(hex_str: str) -> bytes:
    return bytes.fromhex(hex_str.removeprefix("0x"))


# ── _hex_id ───────────────────────────────────────────────────────────────────

def test_hex_id_bytes_input():
    from bot.indexer import _hex_id
    raw = bytes.fromhex("deadbeef")
    assert _hex_id(raw) == "0xdeadbeef"


def test_hex_id_string_without_prefix():
    from bot.indexer import _hex_id
    assert _hex_id("deadbeef") == "0xdeadbeef"


def test_hex_id_string_with_prefix():
    from bot.indexer import _hex_id
    assert _hex_id("0xdeadbeef") == "0xdeadbeef"


# ── _process_chunk ────────────────────────────────────────────────────────────

class TestProcessChunk:
    def _contract(self):
        contract = MagicMock()
        contract.events.SubscriptionCreated.get_logs.return_value = []
        contract.events.SubscriptionCancelled.get_logs.return_value = []
        contract.events.Executed.get_logs.return_value = []
        return contract

    def test_subscription_created_upserts_to_db(self, tmp_db):
        contract = self._contract()
        raw_id = "deadbeef" + "00" * 28
        contract.events.SubscriptionCreated.get_logs.return_value = [
            _make_event({
                "id": bytes.fromhex(raw_id),
                "subscriber": "0xSub",
                "service": "0xSvc",
                "spendToken": "0xTok",
                "amountPerCycle": 10_000_000,
                "interval": 150,
                "permitExpiry": 9_999_999,
            }, block_number=5)
        ]

        with patch("bot.indexer.db", tmp_db):
            from bot.indexer import _process_chunk
            _process_chunk(MagicMock(), contract, 1, 10)

        row = tmp_db.get_subscription("0x" + raw_id)
        assert row is not None
        assert row["subscriber"] == "0xSub"
        assert row["created_at_block"] == 5

    def test_subscription_cancelled_deactivates(self, tmp_db, monkeypatch):
        raw_id = "cafebabe" + "00" * 28
        sub_id = "0x" + raw_id

        # Pre-insert so deactivate has something to update
        tmp_db.upsert_subscription(
            sub_id=sub_id,
            subscriber="0xS",
            service="0xV",
            spend_token="0xT",
            amount_per_cycle=1,
            interval_seconds=60,
            permit_expiry=9_999_999,
            created_at_block=1,
        )
        contract = self._contract()
        contract.events.SubscriptionCancelled.get_logs.return_value = [
            _make_event({"id": bytes.fromhex(raw_id)})
        ]

        fake_now = 1_700_000_000
        monkeypatch.setattr("bot.db.time.time", lambda: fake_now)

        with patch("bot.indexer.db", tmp_db):
            from bot.indexer import _process_chunk
            _process_chunk(MagicMock(), contract, 1, 10)

        row = tmp_db.get_subscription(sub_id)
        assert row["permit_expiry"] == fake_now

    def test_executed_event_updates_last_execution_time(self, tmp_db):
        raw_id = "facefeed" + "00" * 28
        sub_id = "0x" + raw_id

        tmp_db.upsert_subscription(
            sub_id=sub_id,
            subscriber="0xS",
            service="0xV",
            spend_token="0xT",
            amount_per_cycle=1,
            interval_seconds=60,
            permit_expiry=9_999_999,
            created_at_block=1,
        )
        contract = self._contract()
        contract.events.Executed.get_logs.return_value = [
            _make_event({"id": bytes.fromhex(raw_id), "executedAt": 1_700_000_999})
        ]

        with patch("bot.indexer.db", tmp_db):
            from bot.indexer import _process_chunk
            _process_chunk(MagicMock(), contract, 1, 10)

        row = tmp_db.get_subscription(sub_id)
        assert row["last_execution_time"] == 1_700_000_999


# ── scan ──────────────────────────────────────────────────────────────────────

class TestScan:
    def test_scan_skips_when_from_gt_to(self, tmp_db):
        """scan() with from_block > to_block must not call get_logs at all."""
        contract = MagicMock()
        with patch("bot.indexer.db", tmp_db), patch("bot.indexer._process_chunk") as pc:
            from bot.indexer import scan
            scan(MagicMock(), contract, 100, 50)
        pc.assert_not_called()

    def test_scan_saves_progress_per_chunk(self, tmp_db):
        """scan() persists last_indexed_block after every chunk processed."""
        with patch("bot.indexer.config") as cfg, \
             patch("bot.indexer._process_chunk"), \
             patch("bot.indexer.db", tmp_db):
            cfg.EVENT_CHUNK_SIZE = 10
            from bot.indexer import scan
            scan(MagicMock(), MagicMock(), 1, 25)

        # After scanning 1–25 in chunks of 10 (1-10, 11-20, 21-25),
        # last_indexed_block should be 25.
        assert tmp_db.get_state("last_indexed_block") == "25"

    def test_scan_calls_process_chunk_for_each_chunk(self, tmp_db):
        """scan() calls _process_chunk exactly ceil((to-from+1)/chunk) times."""
        with patch("bot.indexer.config") as cfg, \
             patch("bot.indexer._process_chunk") as pc, \
             patch("bot.indexer.db", tmp_db):
            cfg.EVENT_CHUNK_SIZE = 10
            from bot.indexer import scan
            scan(MagicMock(), MagicMock(), 1, 30)

        assert pc.call_count == 3  # chunks: 1-10, 11-20, 21-30
