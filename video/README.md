# Hunch demo video

Remotion cut of the real app, with an ElevenLabs voiceover. Everything here is driven by `script.json` (scenes, seconds, voiceover lines, captions, overlays). Nothing in this folder touches the app or the server.

Run every command from this folder (`cd /Users/nishkadesai/hunch/video`), or use `npm --prefix /Users/nishkadesai/hunch/video run <script>`.

## Files

- `script.json`: the single source for timing, voiceover and captions. Scenes are contiguous and the last `end` (115 s) sets the composition length.
- `SHOTLIST.md`: what the human records on the iPhone, one clip per app scene, saved as `capture/<clip>.mp4`.
- `voiceover.ts`: ElevenLabs text to speech, one call per scene, into `audio/<scene>.mp3`. Also writes `audio/counters.json` for the traction overlay.
- `remotion/`: the `HunchDemo` composition, 1920 by 1080 at 30 fps.
- `public/`: symlinks only (`capture`, `audio`) so Remotion's `staticFile()` reaches the folders above.
- `capture/`, `audio/`, `out/`: working files, ignored by git.

## 1. Clips

Follow `SHOTLIST.md`. Clips land in `capture/intro.mp4`, `blind.mp4`, `real.mp4`, `settled.mp4`, `limit.mp4`, `traction.mp4`. A missing clip renders as a dark placeholder with its name so the timeline still plays.

## 2. Voiceover

```bash
cp .env.example .env            # then fill ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID
npm run voiceover -- --dry-run  # prints every line, calls nothing
npm run voiceover -- --api https://<production-api>   # fills the traction line from GET /api/leaderboard, generates all seven mp3s
```

Options: `--counters file.json` instead of `--api` (accepts `{players, calls, leader, leaderEdge}` or a saved `/api/leaderboard` response), `--only <scene>` to redo one scene, `--model eleven_v4` for the newer model (default `eleven_multilingual_v2`). Numbers are spoken as words. The script refuses to voice the traction line when the leader's Edge is not positive, and exits with code 2 when a scene was skipped for missing counters.

Each line prints its estimated length against its scene window. If one runs long, shorten the line or move that scene's `end` (and the next scene's `start`) in `script.json`.

## 3. Preview and render

```bash
npm run studio          # Remotion Studio, scrub the timeline
npm run render -- --props '{"github":"https://github.com/<owner>/hunch"}'
npx remotion ffprobe out/hunch-demo.mp4     # duration must be under 1:55 (Remotion bundles ffprobe; no system ffmpeg here)
```

`npm run render` writes `out/hunch-demo.mp4` with h264. The `github` prop fills the URL on the end card (empty by default; the Studio shows a reminder, the render shows nothing). Pass `"counters": {...}` in `--props` to override `audio/counters.json`.

Check: `npm run typecheck` and `npx remotion compositions` (lists `HunchDemo`, 3450 frames at 30 fps).

Lines like `[http://localhost:3000/public/capture/intro.mp4] Failed to load resource: 404` during `compositions`, `still` or `render` are the composition probing for clips and audio that do not exist yet. They stop once the files are in place. The first Remotion command downloads a headless browser (about 170 MB) once.

## Rules kept here

No mocked UI: the phone frame only shows the real clips. No invented numbers: counters come from the live leaderboard, placeholders never reach a render. Hunch's own palette (`remotion/theme.ts` mirrors `mobile/lib/theme.ts`), Gemini credited in plain text only.
