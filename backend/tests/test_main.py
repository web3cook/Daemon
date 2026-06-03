"""Unit tests for bot.main — catch-up and incremental indexing logic."""
import pytest
from unittest.mock import MagicMock, patch, call


# ── _catch_up ─────────────────────────────────────────────────────────────────

def test_catch_up_uses_deploy_block_when_no_state(tmp_db):
    """_catch_up() starts from DEPLOY_BLOCK when last_indexed_block is absent."""
    w3 = MagicMock()
    w3.eth.block_number = 1000

    with patch("bot.main.db", tmp_db), \
         patch("bot.main.config") as cfg, \
         patch("bot.main.indexer") as mock_idx:
        cfg.DEPLOY_BLOCK = 500
        from bot.main import _catch_up
        tip = _catch_up(w3, MagicMock())

    mock_idx.scan.assert_called_once()
    args = mock_idx.scan.call_args[0]
    assert args[2] == 500   # from_block == DEPLOY_BLOCK
    assert args[3] == 1000  # to_block == tip
    assert tip == 1000


def test_catch_up_resumes_from_last_indexed_block(tmp_db):
    """_catch_up() resumes from last_indexed_block + 1 when state exists."""
    tmp_db.set_state("last_indexed_block", "750")
    w3 = MagicMock()
    w3.eth.block_number = 1000

    with patch("bot.main.db", tmp_db), \
         patch("bot.main.config") as cfg, \
         patch("bot.main.indexer") as mock_idx:
        cfg.DEPLOY_BLOCK = 500
        from bot.main import _catch_up
        _catch_up(w3, MagicMock())

    args = mock_idx.scan.call_args[0]
    assert args[2] == 751   # last + 1


def test_catch_up_skips_scan_when_already_at_tip(tmp_db):
    """_catch_up() skips scan and writes tip when already caught up."""
    tmp_db.set_state("last_indexed_block", "1000")
    w3 = MagicMock()
    w3.eth.block_number = 1000

    with patch("bot.main.db", tmp_db), \
         patch("bot.main.config") as cfg, \
         patch("bot.main.indexer") as mock_idx:
        cfg.DEPLOY_BLOCK = 500
        from bot.main import _catch_up
        _catch_up(w3, MagicMock())

    mock_idx.scan.assert_not_called()
    assert tmp_db.get_state("last_indexed_block") == "1000"


def test_catch_up_returns_tip(tmp_db):
    """_catch_up() always returns the current block number."""
    w3 = MagicMock()
    w3.eth.block_number = 9999

    with patch("bot.main.db", tmp_db), \
         patch("bot.main.config") as cfg, \
         patch("bot.main.indexer"):
        cfg.DEPLOY_BLOCK = 0
        from bot.main import _catch_up
        result = _catch_up(w3, MagicMock())

    assert result == 9999


# ── _index_new ────────────────────────────────────────────────────────────────

def test_index_new_scans_delta_since_last_poll(tmp_db):
    """_index_new() scans from last+1 to current tip and saves new tip."""
    tmp_db.set_state("last_indexed_block", "800")
    w3 = MagicMock()
    w3.eth.block_number = 850

    with patch("bot.main.db", tmp_db), \
         patch("bot.main.indexer") as mock_idx:
        from bot.main import _index_new
        tip = _index_new(w3, MagicMock())

    args = mock_idx.scan.call_args[0]
    assert args[2] == 801
    assert args[3] == 850
    assert tmp_db.get_state("last_indexed_block") == "850"
    assert tip == 850


def test_index_new_skips_scan_when_tip_not_advanced(tmp_db):
    """_index_new() skips scan if block number hasn't moved."""
    tmp_db.set_state("last_indexed_block", "850")
    w3 = MagicMock()
    w3.eth.block_number = 850

    with patch("bot.main.db", tmp_db), \
         patch("bot.main.indexer") as mock_idx:
        from bot.main import _index_new
        _index_new(w3, MagicMock())

    mock_idx.scan.assert_not_called()


def test_index_new_returns_tip(tmp_db):
    """_index_new() returns the current block number."""
    tmp_db.set_state("last_indexed_block", "0")
    w3 = MagicMock()
    w3.eth.block_number = 42

    with patch("bot.main.db", tmp_db), \
         patch("bot.main.indexer"):
        from bot.main import _index_new
        result = _index_new(w3, MagicMock())

    assert result == 42
