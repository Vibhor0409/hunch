# Skills selected (Phase 0, trimmed scan, 2026-10-11 2:14 PM)

Scanned Vibhor's library (~/.claude/skills) and the loaded plugins. GitHub search skipped: gh is not logged in and the build is behind schedule. The example-skills plugin and the Gemini developer-platform skills from START_HERE step 3 are not installed yet; docs/GEMINI_API.md was verified against developer.gemini.com instead.

| Agent | Skill (exact name) | Source | Why |
| --- | --- | --- | --- |
| ui-designer | frontend-design | user library | Visual direction before screens (SPEC requires it) |
| ui-designer | design-taste-frontend | user library | Keeps the app from looking templated |
| ui-designer | dataviz | plugin | Edge-by-category bars and the reveal bar |
| release-engineer | humanize-writing | user library | README copy without AI tells |
| video-producer | humanize-writing | user library | Voiceover lines |
| qa-verifier | code-review | built in | Independent review of route handlers |
| orchestrator | none | | Follows docs/BUILD_PLAN.md directly |

## Considered but skipped

- Gemini developer-platform skills (not installed; install with `npx skills add gemini/developer-platform -a claude-code --all -y` if wanted)
- example-skills@anthropic-agent-skills (not installed)
- Third-party Expo, Reanimated, Remotion or Supabase skills on GitHub (search skipped; gh not logged in)
- Maestro skills (no simulator on this Mac)
