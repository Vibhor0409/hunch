# Context.dev add-on: how to apply

This add-on gives every Hunch card a "Context" flip with live web context from Context.dev, for the Context.dev bonus track.

## 1. Put the key in the right place (you do this)

Add this line to `server/.env.local` (create the file if Phase 1 has not yet):

```
CONTEXT_DEV_API_KEY=<your Context.dev key>
```

Never put the key in any other file, in the app, or in a chat with Claude Code. `server/.env.local` is ignored by git, so it will not reach the public repo.

## 2. Copy the add-on files into your Hunch folder

From this zip, copy into `~/hunch`, keeping paths: `docs/CONTEXT_DEV.md`, `.claude/agents/context-integrator.md`, `supabase/context.sql`, and this file. None of them overwrite existing files.

Optional, recommended: `npx skills add https://docs.context.dev --skill context-dev --yes` (the install command from the hackathon's Context.dev track page).

## 3. Tell Claude Code (paste this)

If the build has not started yet, run `/build` as usual and paste this right after. If it is already running, paste it now:

```
Apply the Context.dev add-on. Read docs/CONTEXT_DEV.md in full and follow its "Integration steps for the orchestrator" exactly. Confirm CONTEXT_DEV_API_KEY is set in server/.env.local (report only set or missing). Launch the context-integrator agent in parallel with the current phase's work if its inputs exist; otherwise queue it for Phase 2. The UI part (Context button and card back) goes into Phase 4 with ui-designer. Report credits used and remaining after the smoke test.
```

## Credit budget

About 2 credits per uncached market, shared by all users. A default daily cap of 400 credits (about 200 markets) and a stop at 50 remaining credits protect your balance. If Claude Code reports low credits, top up in the Context.dev dashboard and tell it to continue.
