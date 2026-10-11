# Hunch build kit: start here

Hunch is an iOS app. People play it today through Expo Go (free on the App Store) by scanning a QR code. No App Store review is needed.

You do steps 1 to 4 (about 12 minutes). Claude Code does the rest.
Target: four features live for real users by 3:00 PM PT, submission by 5:00 PM PT.

## 1. Accounts and credentials (you, not Claude Code)

Claude Code must not create accounts or handle passwords. Collect these yourself.

| What | Where | Goes into |
| --- | --- | --- |
| Gemini sandbox API key and secret, with trading permission | https://exchange.sandbox.gemini.com (free demo account, $100k test USD), then API settings | `server/.env.local`: `GEMINI_API_KEY`, `GEMINI_API_SECRET` |
| Supabase project URL and service role key | https://supabase.com/dashboard, New project, then Project Settings, API | `server/.env.local`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Expo account (free) | https://expo.dev/signup, then run `npx eas-cli login` | none |
| Vercel login (hosts the API) | run `npx vercel login` | none |
| GitHub CLI | `brew install gh` (started for you during the review), then `gh auth login` | none |
| Expo Go on your iPhone | App Store, search "Expo Go" | none |
| ElevenLabs API key (needed only at 3:45 PM) | hackathon Discord, #coupon-codes, then elevenlabs.io API keys | `video/.env`: `ELEVENLABS_API_KEY` |

This Mac has the Xcode command line tools only (no iOS Simulator) and no Maestro. Do not install Xcode today; it takes too long. The demo video uses your iPhone's built-in screen recording (the iPhone route in `docs/VIDEO.md`).

## 2. Set up the folder

The kit was moved to `~/hunch` and committed to git during the review on Oct 11. Node v25 is installed, which satisfies the Gemini SDK's 22.4 minimum.

```bash
cd ~/hunch
git status    # should be clean
node -v       # must be 22.4 or newer (Gemini SDK)
```

Always start `claude` from inside `~/hunch`. The kit's `CLAUDE.md`, `.claude/agents/`, `.claude/commands/` and `.mcp.json` load only from the project folder; from any other folder, `/build` and `/status` do not exist.

Create `server/.env.local` from `.env.example` once Phase 1 has created the `server/` folder (Claude Code will remind you), or create the folder now and add it yourself.

## 3. Install skills and plugins (2 minutes)

```bash
claude plugin marketplace add anthropics/skills
claude plugin install example-skills@anthropic-agent-skills
npx skills add gemini/developer-platform -a claude-code --all -y
```

`.mcp.json` registers two MCP servers: Context7 (current docs for Expo, React Native, Next.js and the rest; stops API guessing) and Supabase. Approve both when Claude Code asks. Supabase asks you to sign in once in your browser.

## 4. Start the build

```bash
cd ~/hunch && claude
```

Press Shift+Tab until the mode shows auto-accept edits, then type:

```
/build
```

- `/status` prints progress at any time.
- `/build` again resumes from `docs/PROGRESS.md` after any interruption.

## 5. Your jobs during the build

- **When asked:** paste `supabase/schema.sql` into the Supabase SQL editor if the MCP route fails, and confirm the first sandbox order.
- **Around 3:00 PM:** show the Expo Go QR code (Claude Code generates it) on your laptop at your table, and post it in the hackathon Discord with "Install Expo Go, then scan".
- **From 3:00 PM:** keep swiping the Live lane on your own phone so your account builds settled history for the video.
- **Before 3:45 PM:** ask the Gemini team at their table whether you may show their logo in a small "Built on" badge. Until they say yes in writing, Hunch credits Gemini in text only.
- **At 3:45 PM:** add `ELEVENLABS_API_KEY` to `video/.env`, then type `/build` to start the video phase.
- **By 4:50 PM:** upload `video/out/hunch-demo.mp4` to YouTube and submit at www.hackathoncompany.com/platform (the form takes about 15 minutes).
