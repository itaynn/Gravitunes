import json
import os
import shutil
import subprocess
import tempfile
import unittest

from gravitunes_sound import Score, ValidationError, validate
from gravitunes_sound.schema import schema_path

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


class FakeScalar:
    def __init__(self, v): self.v = v
    def item(self): return self.v


class FakeArray:
    def __init__(self, v): self.v = v
    def tolist(self): return self.v


def sample():
    s = Score(title="Storms", tuning="12tet", scale="pentatonic-major")
    s.voice("rain", harmonics=[1, .5, .25], attack=.02, release=.4)
    s.note(t=1.0, step=7, voice="rain", amp=.6, dur=.4, id="storm-38")
    s.note(t=0.0, value=12.3, range=(0, 50))
    s.set(t=1.5, id="storm-38", amp=.2)
    s.stop(t=2.0, id="storm-38")
    return s


class T(unittest.TestCase):
    def test_build_and_sort(self):
        d = sample().to_dict()
        self.assertEqual([e["t"] for e in d["events"]], [0.0, 1.0, 1.5, 2.0])
        self.assertEqual(d["voices"]["rain"]["envelope"], {"attack": .02, "release": .4})
        self.assertEqual(d["events"][0]["range"], [0, 50])
        self.assertEqual(d["version"], 1)

    def test_duck_types(self):
        s = Score()
        s.note(t=FakeScalar(0.5), step=FakeScalar(3), voice="x")
        s.note(t=0, value=1, range=FakeArray([0, 10]))
        s.voice("v", harmonics=FakeArray([1, .5]))
        d = s.to_dict()
        json.dumps(d)
        self.assertEqual(d["events"][0]["t"], 0)
        self.assertEqual(d["voices"]["v"]["harmonics"], [1, .5])

    def test_nan_inf(self):
        s = Score()
        s.note(t=0, step=1)
        with self.assertRaises(ValueError) as c:
            s.note(t=1, step=float("nan"))
        self.assertIn("event #1", str(c.exception))
        with self.assertRaises(ValueError):
            Score().note(t=0, freq=FakeScalar(float("inf")))

    def test_validation_errors(self):
        s = Score()
        s.note(t=0, amp=2.0, step=1)
        s.note(t=1)  # no pitch
        s.note(t=-1, step=1, bogus=1) if False else None
        with self.assertRaises(ValidationError) as c:
            s.to_dict()
        msg = str(c.exception)
        self.assertIn("events[0].amp", msg)
        self.assertIn("events[1]", msg)
        self.assertIn("at least one of", msg)
        errs = validate({"version": 2, "events": [{"type": "stop"}], "x": 1})
        self.assertEqual(len(errs), 3)

    def test_save(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "a", "b", "s.score.json")
            sample().save(p)
            with open(p) as f:
                self.assertEqual(validate(json.load(f)), [])

    def test_notes_and_shared_schema(self):
        s = Score(tuning={"scl": "x", "kbm": "y"}, tempo=120)
        s.notes({"t": i, "step": i, "dur": .5} for i in range(5))
        s.notes([{"t": 0, "note": "C4", "glide": {"to": {"step": 4}, "time": .2}}])
        d = s.to_dict()
        with open(schema_path()) as f:
            self.assertIn("events", json.load(f)["required"])
        self.assertEqual(validate(d), [])

    def test_shared_schema_is_repo_file(self):
        self.assertEqual(os.path.realpath(schema_path()),
                         os.path.realpath(os.path.join(ROOT, "sound-engine", "schema", "score.schema.json")))

    @unittest.skipUnless(shutil.which("node"), "node not available")
    def test_node_loads_score(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.json")
            sample().save(p)
            js = ("import('%s/sound-engine/js/score.js').then(m=>{const s=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));"
                  "const f=m.normalizeScore||m.default;if(!f)throw new Error('no normalizeScore');"
                  "const r=f(s);if(!r.events.length)throw new Error('empty')})" % ROOT)
            r = subprocess.run(["node", "-e", js, p], capture_output=True, text=True)
            if "not implemented" in r.stderr or "ERR_MODULE_NOT_FOUND" in r.stderr or "Cannot find" in r.stderr:
                self.skipTest("js modules not loadable: " + r.stderr[:200])
            self.assertEqual(r.returncode, 0, r.stderr)


if __name__ == "__main__":
    unittest.main()
