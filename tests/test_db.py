import tempfile
import unittest
from pathlib import Path

from backend.graffiti_server import db


USER_ID = "11111111-1111-4111-8111-111111111111"


class DbTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "graffiti.sqlite3"
        db.init_db(self.path)

    def tearDown(self):
        self.tmp.cleanup()

    def test_create_and_list_traces_oldest_first(self):
        second = db.create_trace(
            geohash="wsqqqpt",
            text="newer",
            anonymous_user_id=USER_ID,
            path=self.path,
            created_at="2026-01-02T00:00:00Z",
        )
        first = db.create_trace(
            geohash="wsqqqpt",
            text="older",
            anonymous_user_id=USER_ID,
            path=self.path,
            created_at="2020-01-01T00:00:00Z",
        )

        traces = db.list_traces("wsqqqpt", USER_ID, self.path)

        self.assertEqual([trace["id"] for trace in traces], [first["id"], second["id"]])
        self.assertEqual([trace["text"] for trace in traces], ["older", "newer"])

    def test_wall_summary_counts_cell_only(self):
        db.create_trace(geohash="wsqqqpt", text="here", anonymous_user_id=USER_ID, path=self.path)
        db.create_trace(geohash="wsqqqps", text="there", anonymous_user_id=USER_ID, path=self.path)

        summary = db.wall_summary("wsqqqpt", self.path)

        self.assertEqual(summary["trace_count"], 1)
        self.assertEqual(summary["geohash"], "wsqqqpt")

    def test_rejects_long_trace(self):
        with self.assertRaises(ValueError):
            db.create_trace(
                geohash="wsqqqpt",
                text="x" * 141,
                anonymous_user_id=USER_ID,
                path=self.path,
            )

    def test_echo_is_idempotent(self):
        trace = db.create_trace(geohash="wsqqqpt", text="echo", anonymous_user_id=USER_ID, path=self.path)

        first = db.set_echo(trace["id"], USER_ID, True, self.path)
        second = db.set_echo(trace["id"], USER_ID, True, self.path)
        cleared = db.set_echo(trace["id"], USER_ID, False, self.path)

        self.assertEqual(first["echo_count"], 1)
        self.assertEqual(second["echo_count"], 1)
        self.assertEqual(cleared["echo_count"], 0)

    def test_memories_include_mine_and_world(self):
        folded = db.create_memory(
            body="Keep folded",
            latitude=25.0,
            longitude=121.0,
            geohash="wsqqqm1",
            visibility="folded",
            anonymous_user_id=USER_ID,
            path=self.path,
        )
        free = db.create_memory(
            body="Set free",
            latitude=25.0,
            longitude=121.0,
            geohash="wsqqqm1",
            visibility="free",
            anonymous_user_id="22222222-2222-4222-8222-222222222222",
            path=self.path,
        )

        memories = db.list_memories(USER_ID, self.path)

        self.assertEqual({memory["id"] for memory in memories}, {folded["id"], free["id"]})

    def test_memories_do_not_include_other_folded_planes(self):
        db.create_memory(
            body="Someone else folded this",
            latitude=25.0,
            longitude=121.0,
            geohash="wsqqqm1",
            visibility="folded",
            anonymous_user_id="22222222-2222-4222-8222-222222222222",
            path=self.path,
        )

        memories = db.list_memories(USER_ID, self.path)

        self.assertEqual(memories, [])


if __name__ == "__main__":
    unittest.main()
