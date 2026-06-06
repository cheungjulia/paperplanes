import unittest

from backend.graffiti_server.cells import encode_geohash, normalize_geohash


class CellsTest(unittest.TestCase):
    def test_encode_geohash_is_stable(self):
        self.assertEqual(encode_geohash(25.0330, 121.5654, 7), "wsqqqm1")

    def test_normalize_geohash_rejects_invalid_chars(self):
        with self.assertRaises(ValueError):
            normalize_geohash("abc.io")

    def test_normalize_geohash_lowercases(self):
        self.assertEqual(normalize_geohash("WSQQQPT"), "wsqqqpt")


if __name__ == "__main__":
    unittest.main()
