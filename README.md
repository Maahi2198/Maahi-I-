# Audio-to-Cartoon Video Studio

This repository now hosts a browser-based website that turns uploaded audio into a cartoon-style animated video experience without using Flask.

## What it does

- Upload a primary audio track for narration, speech, rap, or singing.
- Add optional background music with an adjustable mix level.
- Preview a synchronized cartoon stage with animated characters, lip-sync motion, and audio-reactive effects.
- Export the result as a downloadable WebM video using browser-native media APIs.

## Technical approach

The website is intentionally built with common, runtime-safe web platform features instead of a server framework:

- **Jekyll** for static-site delivery in this repo.
- **Canvas 2D** for the animated cartoon stage.
- **Web Audio API** for audio decoding, waveform energy analysis, and mixing.
- **MediaRecorder** for client-side video export.

## Run locally

If your Ruby/Jekyll environment is available, use the existing project scripts:

```bash
./script/setup
./script/server
```

Then open the local Jekyll site in your browser and upload your audio files.
