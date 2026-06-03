import unittest

from src.retriever.global_search import GlobalSearcher


class TemporalDedupTests(unittest.TestCase):
    def _make_searcher(self, window_ns: int) -> GlobalSearcher:
        searcher = GlobalSearcher.__new__(GlobalSearcher)
        searcher.temporal_dedup_window_ns = window_ns
        return searcher

    def test_suppresses_lower_scoring_adjacent_frames_same_sequence(self):
        searcher = self._make_searcher(window_ns=3_000_000_000)
        ranked = [
            {"bag_path": "/bag/a", "topic": "/cam", "timestamp_ns": 10_000_000_000, "similarity_score": 0.95},
            {"bag_path": "/bag/a", "topic": "/cam", "timestamp_ns": 11_000_000_000, "similarity_score": 0.90},
            {"bag_path": "/bag/a", "topic": "/cam", "timestamp_ns": 20_000_000_000, "similarity_score": 0.85},
        ]

        deduped = searcher._apply_temporal_dedup(ranked)

        self.assertEqual(len(deduped), 2)
        self.assertEqual(deduped[0]["timestamp_ns"], 10_000_000_000)
        self.assertEqual(deduped[1]["timestamp_ns"], 20_000_000_000)

    def test_does_not_suppress_different_topics(self):
        searcher = self._make_searcher(window_ns=3_000_000_000)
        ranked = [
            {"bag_path": "/bag/a", "topic": "/cam/front", "timestamp_ns": 10_000_000_000, "similarity_score": 0.95},
            {"bag_path": "/bag/a", "topic": "/cam/rear", "timestamp_ns": 11_000_000_000, "similarity_score": 0.90},
        ]

        deduped = searcher._apply_temporal_dedup(ranked)

        self.assertEqual(len(deduped), 2)

    def test_dedup_disabled_when_window_is_zero(self):
        searcher = self._make_searcher(window_ns=0)
        ranked = [
            {"bag_path": "/bag/a", "topic": "/cam", "timestamp_ns": 10_000_000_000, "similarity_score": 0.95},
            {"bag_path": "/bag/a", "topic": "/cam", "timestamp_ns": 11_000_000_000, "similarity_score": 0.90},
        ]

        deduped = searcher._apply_temporal_dedup(ranked)

        self.assertEqual(len(deduped), 2)


if __name__ == "__main__":
    unittest.main()
