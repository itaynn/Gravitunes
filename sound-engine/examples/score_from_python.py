"""Build a small data-driven score with gravitunes_sound.Score and save it.

Run from the repo root:
    PYTHONPATH=sound-engine/python python3 sound-engine/examples/score_from_python.py
(or `pip install -e sound-engine/python` first and drop PYTHONPATH).
"""
import math
import os

from gravitunes_sound import Score

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out", "demo.score.json")

s = Score(title="Demo", tuning="12tet", scale="pentatonic-minor", tempo=120, value_range=(0, 100))

# A custom voice: extends a preset, overrides the envelope.
s.voice("soft-bell", extends="bell", attack=0.005, release=1.2)

# Data-driven notes: `value` is mapped through the scale over the range.
readings = [12, 35, 50, 71, 93, 64, 40, 18]
for i, v in enumerate(readings):
    s.note(t=i * 0.5, value=v, voice="soft-bell", amp=0.3 + 0.5 * v / 100, dur=0.5)

# A single note with its own range instead of the score's valueRange.
s.note(t=0, value=3.2, range=(0, 5), voice="pluck", dur=1)

# An evolving sound tracked by id: start, change twice, stop. (Times are beats here.)
s.note(t=0, id="storm-7", step=0, voice="pad", amp=0.2)  # no dur: holds until stop
for k in range(1, 7):
    s.set(t=k * 0.6, id="storm-7", step=2 * k, amp=0.2 + 0.05 * math.sin(k), pan=-1 + k / 3)
s.stop(t=4.5, id="storm-7")

print("valid" if not s.validate() else s.validate())
print("saved", s.save(OUT))
print("To hear it: python3 -m gravitunes_sound serve   (with PYTHONPATH=sound-engine/python),")
print("then open http://localhost:8000/player.html and choose", OUT)
