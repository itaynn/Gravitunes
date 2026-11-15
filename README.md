# Gravitunes

New types of data sonification.

Main app is at ./app/modes/storm-picker/index.html.

# 🇮🇱 עברית:
פתרון זה פותח במסגרת NASA Space Apps Tel Aviv 2026. האירוע הובל על ידי המרכז להנדסת חלל (SEC) ו-SpaceTAU באוניברסיטת תל אביב, בשיתוף משימת רקיע וקהילת Space Campus IL.

# 🌍 English:
This solution was developed as part of NASA Space Apps Tel Aviv 2026. The event was led by the Space Engineering Center (SEC) and SpaceTAU at Tel Aviv University, in partnership with the Rakia Mission and Space Campus IL.

# Running and recreating the data
To run the code on your computer, run:
```
python3 -m http.server 8000
```
And then open http://localhost:8000/app/ in your browser.

To regenerate the speech tutorial, run:
```
pip install edge-tts
node app/tools/make-voice.mjs                 # all lines
node app/tools/make-voice.mjs intro           # just one
VOICE=en-US-AndrewNeural node app/tools/make-voice.mjs   # different voice
```

# Usage of AI
Claude and Copilot were used in the creation of this project for code generation.