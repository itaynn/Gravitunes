import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.join(HERE, "..", "gravitunes_sound", "data", "score.schema.json")
SRC = os.path.join(HERE, "..", "..", "schema", "score.schema.json")


class SchemaSync(unittest.TestCase):
    def test_bundled_schema_matches_source(self):
        with open(PKG, "rb") as a, open(SRC, "rb") as b:
            self.assertEqual(
                a.read(), b.read(),
                "python/gravitunes_sound/data/score.schema.json differs from schema/score.schema.json. "
                "Re-copy: cp sound-engine/schema/score.schema.json sound-engine/python/gravitunes_sound/data/score.schema.json")


if __name__ == "__main__":
    unittest.main()
