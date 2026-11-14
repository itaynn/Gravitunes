"""Regenerates storms.score.json: a made-up storm data set (id, wind speed, rain) as sound.

    PYTHONPATH=sound-engine/python python3 sound-engine/examples/make_storms_score.py
"""
import os

from gravitunes_sound import Score

HERE = os.path.dirname(os.path.abspath(__file__))

# (name, start second, wind m/s, rain mm/h, lifetime seconds)
STORMS = [("alma", 0.0, 12, 5, 6), ("beto", 1.5, 38, 40, 7), ("cora", 3.0, 22, 15, 5),
          ("dane", 5.0, 45, 60, 6), ("elsa", 7.0, 18, 8, 5), ("finn", 8.5, 30, 25, 6)]

s = Score(title="Storms", tuning="12tet", scale="pentatonic-major", value_range=(0, 50))
s.voice("rain", harmonics=[1, 0.5, 0.25], attack=0.02, release=0.4)
s.voice("wind", extends="pad", attack=0.5, release=1.5)
for name, t0, wind, rain, life in STORMS:
    sid = "storm-" + name
    s.note(t=t0, id=sid, value=wind, voice="wind", amp=0.2 + wind / 150)  # evolving, held
    for k in range(1, 5):
        s.set(t=t0 + k * life / 5, id=sid, value=wind * (1 + 0.15 * (-1) ** k), amp=0.2 + wind / 150)
    s.stop(t=t0 + life, id=sid)
    for k in range(int(rain / 8) + 1):  # more rain = more drops
        s.note(t=t0 + 0.2 + k * 0.35, value=rain / 60 * 50 + k, voice="rain", amp=0.4, dur=0.3, pan=(-1) ** k * 0.5)
print("saved", s.save(os.path.join(HERE, "storms.score.json")))
