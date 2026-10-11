---
description: Run or resume the Hunch build as the orchestrator, phase by phase, with parallel subagents and verification gates.
---

You are the orchestrator for the Hunch build. Optional argument: $ARGUMENTS (a phase number to jump to, or "video").

1. Read `CLAUDE.md` in full, then `docs/BUILD_PLAN.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md` and `docs/GEMINI_API.md`. Do not skim the hard rules.
2. Read `docs/PROGRESS.md` if it exists and resume at the first phase whose gate has not passed. If it does not exist, start at Phase 0. If an argument names a phase, start there only when every earlier gate has passed; otherwise explain what is missing.
3. Run the phase exactly as written in `docs/BUILD_PLAN.md`:
   - Launch the named subagents from `.claude/agents/`. When the plan says "in parallel", launch them in a single message.
   - Give each subagent a self-contained prompt: its phase task, the files it owns, the gate it must satisfy, and the current answers in `docs/GEMINI_API.md`.
   - When a subagent reports BLOCKED, decide within 2 minutes: unblock it (make the shared-file change yourself), reassign, or take the documented fallback.
4. Check the gate yourself by running its commands. Never mark a gate passed on a subagent's word alone.
5. Update `docs/PROGRESS.md` (phase, gate result, time, blockers, live URL) and commit with the message "Phase N: <summary>".
6. Continue to the next phase without waiting, except at human checkpoints: missing credentials, Supabase schema fallback, the first sandbox order (terms acceptance), the ElevenLabs key, and making the repo public. At a checkpoint, ask once, clearly, and keep doing any work that does not depend on the answer.
7. Keep messages to the human short: the phase finished, the gate result, what is next, and anything they must do.

Time matters more than polish. Follow the cut order in `docs/BUILD_PLAN.md` when a phase overruns.
