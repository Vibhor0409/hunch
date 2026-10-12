# Hunch product spec

**Pitch:** Call live prediction markets blind, see what the market thinks, and earn a higher limit by beating it.

**Platform:** native iOS app built with Expo, run through Expo Go and published with EAS Update. Design for iPhone first (393 by 852 points); respect safe areas; portrait only; dark mode by default.

**Users:** hackathon attendees on iPhones, and judges watching the video.

## Navigation

- First launch: Join screen (full screen, no tabs).
- Then three bottom tabs: **Deck**, **Leaderboard**, **Me**. The reveal is a bottom sheet over the Deck.

## P0: live for users by 3:00 PM (build in this order)

### F1. Five-second join

- Join screen: the Hunch mark, one line of pitch, one name field (2 to 20 characters: letters, digits, spaces) and a Start button. The footer reads "Built on Gemini Prediction Markets".
- `POST /api/join` returns a player id, saved in AsyncStorage under `hunch.playerId`. Later launches skip Join.
- A taken name shows "That name is taken." Existing players are never overwritten.
- **Accept when:** a phone with Expo Go goes from scanning the QR code to the first card in under 20 seconds.

### F2. Blind deck on live Gemini markets, with lanes

- Lane chips at the top of the Deck: **For you** (default), **Live**, **Tomorrow**, **This week**.
  - Live: the contract expires within 60 minutes from now.
  - Tomorrow: expires within 48 hours and is not Live.
  - This week: expires within 7 days and is neither of the above.
  - Later (added 4:00 PM): expires beyond 7 days, up to a year (elections, seasons, long-dated economics).
  - For you: a mix of lanes and categories; every third card is Live when Live cards exist, and no two adjacent cards share a category when the pool allows.
- A card shows the question (rule in `docs/GEMINI_API.md`, "Card text"), a category chip and time to close ("closes in 4m", "closes Tue 3 PM"). **No price and no percentage.**
- Gestures: pan right = YES, pan left = NO, pan up = skip, with the card rotating as it moves, a YES or NO stamp fading in past the threshold, and a light haptic when the swipe commits (`expo-haptics`). Three buttons under the card do the same.
- A player never sees a contract they already swiped. Skips stay on the device.
- Cards whose instrument does not exist on the Gemini sandbox carry `tradable: false`; swiping them is scored as practice (no order) and the app says so on the reveal. The feed draws from Gemini production's public events across every category (sports, politics, economics, entertainment, crypto, commodities) so the deck is diverse.
- Header: "Paid swipes left today: N of CAP" and the level. At zero, a "Practice" badge and the line "Practice calls still score Edge."
- **Accept when:** `GET /api/feed` returns at least 10 cards from live Gemini data for each lane that has markets, with no prices in the payload and nothing hard-coded.

### F3. Reveal plus a real $1 sandbox order

- A swipe calls `POST /api/swipe`. The server re-reads the price, decides paid or practice from the daily cap, places the order when paid, stores the swipe and returns the reveal.
- The reveal sheet shows: a YES x% / NO y% bar that springs in; "You sided with z% of the market"; "$STAKE returns $R if right" (R = contracts times $1); and a receipt with mode (Paid or Practice), order id, status, contracts and price, tagged "Live order on Gemini sandbox".
- A success haptic on reveal; an unfilled order shows "No fill at this price. Scored as practice." and the swipe is stored as practice.
- **Order rules:** `orderType: "limit"`, `side: "buy"`, `outcome` = the swipe side, `price` = current buy price of that side as a 2-decimal string, `quantity` = stake / price rounded down to 2 decimals, as a string (so a $1 stake at 0.74 buys 1.35 contracts and costs at most $1; whole contracts only if the sandbox rejects fractions, see `docs/GEMINI_API.md`), `timeInForce: "immediate-or-cancel"`, `makerOrCancel: false`.
- **Accept when:** a paid swipe shows a real sandbox order id, and the receipt matches the database row.

### F4. Settlement, Edge points, leaderboard and recent calls

- Settlement is lazy: the app calls `POST /api/settle` on launch, on return to the foreground, and when the Leaderboard or Me tab opens.
- **Edge** for a settled call, where p is the price of the chosen side at swipe time: right = +10 x (1 - p); wrong = -10 x p. Store with 1 decimal.
- Payout for a paid winning call = contracts x $1. Profit = payout - cost.
- Leaderboard tab: a counter strip (players, calls, Gemini orders, all counted from the database) and ranked rows (rank, name, total Edge, settled calls, level). Pull to refresh.
- Me tab (P0 version): "Recent calls", the player's last 10 swipes with question, side, mode, Pending, Won or Lost, payout and Edge. Newly settled rows are highlighted. Pull to refresh.
- **Accept when:** a paid BTC 5-minute swipe settles within 2 minutes of expiry once the app comes to the foreground, and its Edge shows on the Leaderboard and in Recent calls.

## P1: 3:00 to 3:45 PM

### F5. Earned limits (levels)

| Level | Paid swipes per day | Stake per swipe | Unlocks when |
| --- | --- | --- | --- |
| 1 | 10 | $1 | Start |
| 2 | 15 | $2 | At least 10 settled calls and average Edge above 0 |
| 3 | 20 | $3 | At least 25 settled calls and average Edge of 0.5 or more |
| 4 (ceiling) | 25 | $5 | At least 50 settled calls and average Edge of 1.0 or more |

- Settled calls include practice swipes. A player drops one level when total Edge over their last 10 settled calls is negative.
- "Today" means the calendar day in America/Los_Angeles.
- Me tab, above Recent calls: a level bar with current level, progress to the next level (calls and Edge) and the rule "Lose your edge, lose the level."

### F6. Edge by category (Me tab)

- Per category: settled calls, hit rate, average implied probability of the chosen side, total Edge. Horizontal bars sorted by Edge.
- One insight line, using only categories with at least 3 settled calls: "Ahead of the market on {best}. Behind on {worst}."

## P1 (added 3:30 PM): F7. Context on every card

Approved add-on for the Context.dev bonus track. Full spec in `docs/CONTEXT_DEV.md`: a Context button flips the card to a back with two to three lines of live web context and a source link, cached per market and credit-guarded. Blind still means blind: no odds in context text. Backend in Phase 2 (context-integrator), UI in Phase 4 (ui-designer).

## P1 (added 4:20 PM): F8. Play-money wallet and amount per trade

- Every player starts with $1,000 of play money (not real, not redeemable). The Deck header shows the balance.
- Settings (gear on the Me tab or a Settings tab): "Amount per trade" with presets $1, $2, $5, $10, $25 and a custom field (1 to 100), saved on the server (`POST /api/settings`); a "Reset wallet to $1,000" button for demos.
- A paid swipe debits cost = contracts x price (contracts = amount / price, floored to 2 decimals) from the wallet and places the sandbox order when the card is tradable (the receipt still shows the real order id and its status). Paid now means wallet-funded, whether or not the sandbox order filled. A swipe is practice only when the daily cap is reached or the balance is below the amount.
- Settlement credits payout = contracts x $1 on a win. Every movement is a wallet transaction shown on the Wallet screen (`GET /api/wallet`), newest first.
- The level table's stake column becomes the default amount for new players; the player's setting overrides it.

## P1 (added 5:45 PM): F9. Practice or Live session

- A two-way switch, Practice and Live, sits at the top of the Deck and in Settings. The choice is kept on the device (`hunch.sessionMode`, default Live) and sent with every swipe as the optional `mode` field of `POST /api/swipe`.
- Live is the F8 behavior: wallet-funded, with a Gemini sandbox order on tradable markets. Practice forces a practice call: no order, no wallet movement, and the reveal says "Practice session. Scores Edge only." Calls in both sessions score Edge.
- A missing or unknown `mode` means Live, so older app builds are unaffected.

## Out of scope

Web UI of any kind, App Store or TestFlight builds today, push notifications, LLM rewrites, streaks, WebSockets, auth beyond names, real money, redeemable coins (the wallet is play money).

## Brand and visual direction

- Hunch has its own identity: name, a simple original mark used as the app icon and splash, and its own palette. Credit Gemini in text only ("Built on Gemini Prediction Markets" on Join and in Me, "Live order on Gemini sandbox" on receipts). No Gemini logo, wordmark or look-alike styling (see `CLAUDE.md` rule 7).
- Look: precise and trustworthy, like a well-made finance app. Dark base, one bold accent, tabular numerals for every price and percentage, generous spacing, large card type.
- Motion: cards follow the finger; the reveal bar springs; haptics on commit and reveal. The reveal is the hero moment of the video.
- Run the frontend-design skill for direction before building screens.
