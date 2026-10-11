# Demo video spec (1:55 maximum, AI-produced)

No camera. Motion graphics, captions and the end card are rendered by Remotion; voiceover comes from ElevenLabs; app footage is captured from the real Hunch iOS app running against the live API. **Never mock the app UI.**

## Capture routes (the video-producer picks one in Phase 5)

On this Mac (Xcode command line tools only, no simulator, no Maestro) the route is the iPhone route. The simulator route stays here for reference only.

1. **Simulator route** (needs Xcode and Maestro): the published app opens in Expo Go on an iOS Simulator; Maestro flows drive each scene while `xcrun simctl io booted recordVideo` records it. Fully automated and repeatable.
2. **iPhone route** (no Xcode): the human follows a one-line-per-scene shot list and records with iOS Screen Recording (Control Center), then AirDrops the clips into `video/capture/<scene>.mp4`. Screen recordings, not camera footage.

Either way, Remotion places the clips inside an iPhone-shaped frame drawn in code (not Apple's device artwork).

## Folder layout (`video/`, owned by video-producer)

- `video/script.json`: scenes with id, start, end, voiceover, overlay text. Single source for voiceover, captions and timing.
- `video/flows/<scene>.yaml` and `video/capture.sh`: Maestro flows and the recording script (simulator route).
- `video/voiceover.ts`: one ElevenLabs text-to-speech call per scene into `video/audio/<scene>.mp3`.
- `video/remotion/`: 1920 by 1080, 30 fps; kinetic type for hook and end card; phone frame centered for app scenes; captions burned in. Output `video/out/hunch-demo.mp4`.

## Scenes

| Id | Time | Visual (source) | Voiceover |
| --- | --- | --- | --- |
| hook | 0:00 to 0:14 | Kinetic type: "$50 on Argentina" stamped LOST, "$50 on a hat trick" stamped LOST, then "Market: Spain 61%" | "Argentina to win the final. Fifty dollars. Gone in extra time. A hat trick that never came. Fifty more, gone. The market had Spain at sixty-one percent. Your gut never told you that." |
| intro | 0:14 to 0:22 | Phone frame slides in; captured: the Hunch icon opening, then a swipe and its reveal | "Hunch lets you test your gut for a dollar, before you trust it with fifty." |
| blind | 0:22 to 0:47 | Captured: lane chips; three swipes (weather or economics, sports, BTC 5-minute), each reveal | "Every card is a live market from Gemini's prediction API. You call it before you see the odds. Then Hunch shows you what the market thinks, and what a dollar pays if you're right. Pick how long you want to wait: five minutes, tomorrow, or this week." |
| real | 0:47 to 1:07 | Captured: the receipt with the Gemini order id; title card "5 minutes later"; captured: the settled BTC row in Recent calls with payout and Edge | "Each swipe places a real one-dollar order on Gemini's exchange sandbox, signed by our server. Five-minute Bitcoin markets settle before you close the app." |
| limit | 1:07 to 1:32 | Captured: the Me tab with Edge by category and the level bar; caption "Lose your edge, lose the level." | "Copying the crowd scores zero. Being right when the market was wrong scores points, and points are the only way to raise your limit. Everyone starts at a dollar. You earn two, then three, by beating the market, and you drop back the moment you stop." |
| traction | 1:32 to 1:47 | Captured: the Leaderboard tab; overlay of the real counters plus "built today by one person"; 2 seconds of an architecture diagram (iOS app, API, Gemini sandbox, Supabase) | "Since three o'clock, [N] hackers in this room have made [N] calls on their iPhones, and [name] is beating the market by [N] points." |
| end | 1:47 to 1:55 | End card: the Hunch mark, "Call it blind. Earn your limit.", "Built on Gemini Prediction Markets" in text, GitHub URL | "Hunch. Call it blind. Earn your limit." |

## Rules

- Fill every bracket from the live database right before generating the traction voiceover. Write numbers as words in voiceover text.
- If no player has reached Level 2 by capture time, show the bar and rule as they are. Never fake an unlock.
- Facts in the hook: Spain beat Argentina 1-0 in extra time in the July 2026 final; Kalshi traders gave Spain 61% two days before. Do not add other claims.
- Hunch's own brand only: no Gemini logo or wordmark (unless the human has written permission, then only a small "Built on" badge), no real player likenesses, team crests or FIFA marks.
- Check total duration with `npx remotion ffprobe video/out/hunch-demo.mp4` (Remotion 4 bundles ffprobe; no system ffmpeg is installed); it must be under 1:55.
