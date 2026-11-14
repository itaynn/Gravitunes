"""Stream events live to the browser.

1. Terminal A: python3 -m gravitunes_sound serve     (needs: pip install -e "sound-engine/python[live]")
2. Browser: open http://localhost:8000/player.html, connect the Live bridge panel, press Start audio.
3. Terminal B: PYTHONPATH=sound-engine/python python3 sound-engine/examples/live_from_python.py
"""
import sys
import time

from gravitunes_sound import live

try:
    live.connect()  # ws://localhost:8765
except ImportError as e:
    sys.exit("websockets is not installed.\n  %s" % e)
except OSError as e:
    sys.exit("No live bridge at ws://localhost:8765 (%s).\n"
             "Start it in another terminal: python3 -m gravitunes_sound serve\n"
             "then open http://localhost:8000/player.html and connect the Live bridge panel." % e)

try:
    for step in (0, 4, 7, 12):
        live.play(step=step, dur=0.4)
        time.sleep(0.3)
    live.play(id="wind", step=0, voice="pad", amp=0.2)  # holds until stop
    for k in range(1, 9):
        live.set("wind", step=k, ramp=0.2)
        time.sleep(0.25)
    live.stop("wind")
finally:
    live.close()
