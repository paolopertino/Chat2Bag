import pytest

from rosbags.rosbag2 import ReaderError

from src.ingestion.bag_parser import BagParser, BagReadError


class _ExplodingReader:
    """Stand-in for rosbags' Reader whose open (on context entry) fails like a
    truncated MCAP missing its footer."""

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        raise ReaderError("File end magic is invalid.")

    def __exit__(self, *exc):
        return False


def test_extract_frames_translates_unreadable_mcap(tmp_path, monkeypatch):
    bag = tmp_path / "2026-05-19_17-25_normal"
    bag.mkdir()
    monkeypatch.setattr("src.ingestion.bag_parser.Reader", _ExplodingReader)

    parser = BagParser(str(bag))
    with pytest.raises(BagReadError) as excinfo:
        parser.extract_frames()

    message = str(excinfo.value)
    assert "2026-05-19_17-25_normal" in message
    assert "incomplete or corrupt" in message.lower()
    assert "mcap recover" in message.lower()
