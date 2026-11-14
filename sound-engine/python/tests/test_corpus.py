"""Shared validation corpus: tests/js/corpus.test.js runs the same file through the JS validator."""
import json
import os
import unittest

from gravitunes_sound import validate

CORPUS = os.path.join(os.path.dirname(__file__), "..", "..", "tests", "fixtures", "validation-corpus.json")


class Corpus(unittest.TestCase):
    def test_same_verdicts_as_js(self):
        with open(CORPUS, encoding="utf-8") as f:
            cases = json.load(f)["cases"]
        self.assertGreater(len(cases), 20)
        for c in cases:
            with self.subTest(c["name"]):
                errs = validate(c["score"])
                self.assertEqual(not errs, c["valid"], "%s: %s" % (c["name"], errs))


if __name__ == "__main__":
    unittest.main()
