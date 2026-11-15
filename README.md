# Hear the storm

NASA Space Apps 2026 "Earth Information Jukebox". The moving NASA IMERG rain and snow map (SVS 4285), turned into
sound for blind and low-vision listeners. A tone follows the cursor (west to east moves it from the left ear to the
right, south to north raises the pitch), storms sound their rain or snowstorm, and picked storms play through the week.

## Run it

Serve the repo root and open the page in Chrome:

```bash
python3 -m http.server 8000
# http://localhost:8000/app/modes/storm-picker/
```

Keys: `?` tutorial, Space play/stop the week, `R` back to the start, `I` how the sound is made, arrows move the
listening point, Enter picks or drops a storm, Escape closes what is open.

## Layout

- `app/modes/storm-picker/`: the page. `soundlab.js` does the sound and the map; `hear.js` is the shell around it
  (intro, tutorial, the I card, controls drawer, timeline, voice).
- `app/modes/storm-picker/audio/`: the recorded narration. After changing a spoken line in `hear.js`, regenerate it
  with `pip install edge-tts && node app/tools/make-voice.mjs`.
- `app/modes/storm-picker/data/storm-watch/`: storm tracks and the 48 half-hourly IMERG snapshots they were made from.
- `data/nasa-svs/4285/4285-imergert-current.mp4`: the NASA SVS 4285 movie the page reads.

# Usage of AI
Claude and Copilot were used in the creation of this project for code generation.
