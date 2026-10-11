# Shot list: iPhone screen recordings for the demo video

Six clips, all recorded on your iPhone with the built-in Screen Recording, all in portrait. Remotion drops each one into the phone frame at the times below, skipping the first 2 seconds of every clip, so the holds matter.

## Before you record (once)

1. Open Hunch in Expo Go on your phone, joined with your own name, pointed at the production API. Have the Live lane loaded once so the first swipe does not wait on a cold start.
2. Settings > Control Center: make sure Screen Recording is in your controls. Turn on Do Not Disturb. Brightness to full. Close other apps.
3. You need paid swipes left today for the blind and real clips (check the header count). Every paid swipe places a real $1 sandbox order, so keep the count in mind.
4. Record in this order: **blind, intro, real, limit, traction, then settled** at least 6 minutes after the blind clip, so the BTC 5-minute call from the blind clip has settled and shows as Won or Lost in Recent calls.
5. Each clip: start Screen Recording, wait 2 seconds without touching anything, do the taps, then hold the last screen for 2 seconds before stopping. Record a little longer than the target length; the cut takes what it needs.
6. Skip, do not fake: if a screen is not ready (no settled row yet, no leaderboard rows), wait and record later. Never stage data.

## The clips

| Clip | Target length (plus holds) | What to tap, and how long to hold | Save as |
| --- | --- | --- | --- |
| intro | 8 s | Start on the Expo Go projects screen with Hunch listed. Tap Hunch. Let the splash and the Deck load (hold until the first card is readable, about 2 s), then drag the card right for YES and release. Hold on the reveal sheet for 3 s. | video/capture/intro.mp4 |
| blind | 25 s | Start on the Deck. Tap the "This week" chip (lane-week). On the top card tap the Context button, hold 3 s on the card back while the live context shows, tap Back. Swipe that weather or economics card right or left, hold the reveal 3 s, tap Next. Tap "Tomorrow" (lane-tomorrow), swipe a sports card, hold the reveal 3 s, tap Next. Tap "Live" (lane-live), swipe a BTC 5-minute card, hold the reveal 3 s, tap Next. | video/capture/blind.mp4 |
| real | 8 s | Start on the Deck in the Live lane with a paid swipe left. Swipe one card, then tap the receipt row on the reveal sheet (receipt) so the order id, status, contracts and price unfold under "Live order on Gemini sandbox". Hold 4 s with the order id in view. | video/capture/real.mp4 |
| settled | 10 s | Record at least 6 minutes after the blind clip. Start on the Me tab. Pull down to refresh (this settles first). Hold 4 s on the Recent calls row for the BTC 5-minute call showing Won or Lost with its payout and Edge. If no row has settled yet, wait and record this clip last. | video/capture/settled.mp4 |
| limit | 25 s | Start at the top of the Me tab. Hold 4 s on the level bar, the progress text and the line "Lose your edge, lose the level." Scroll slowly down to the Edge by category bars and the insight line, hold 4 s, then scroll back up slowly and hold 3 s. | video/capture/limit.mp4 |
| traction | 13 s | Start on the Leaderboard tab. Pull down to refresh. Hold 4 s on the counter strip (players, calls, Gemini orders), then scroll slowly through the ranked rows and hold 3 s at the end. | video/capture/traction.mp4 |

## After recording

1. AirDrop the six recordings to this Mac (Photos > select > Share > AirDrop). They arrive as .mp4 (or .mov) files in Downloads.
2. Rename each to its clip name above and move it into `/Users/nishkadesai/hunch/video/capture/`. A .mov file can simply be renamed to .mp4; the cut reads either.
3. Tell the orchestrator which clips exist. Any missing clip renders as a dark placeholder with the clip name, which is fine for a timing check but not for the final cut.

If a clip runs long, the first 2 seconds are skipped and the rest is cut to the target length. To use a different stretch of a clip, change `clipIn` (seconds skipped) or `rate` (playback speed) for that clip in `video/script.json`.
