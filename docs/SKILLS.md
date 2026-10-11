# Skill discovery (Phase 0, skill-scout, 8 minutes)

Goal: give each agent the two to four skills that will actually change its output. Speed matters more than completeness.

## Sources, in this order

1. **Vibhor's own library** (names and descriptions only, never full bodies):

```bash
grep -H "^description:" ~/.claude/skills/*/SKILL.md .claude/skills/*/SKILL.md 2>/dev/null | head -200
ls ~/.claude/commands .claude/commands 2>/dev/null
grep -H "^description:" ~/.claude/agents/*.md 2>/dev/null | head -80
claude plugin list
```

If a hackathon kit `INDEX.md` exists under `~/.claude`, use it as a fast map, but trust the directories when they disagree. If the `skill-router` skill is present, follow its selection rules.

2. **Plugin marketplaces** already approved by the human:
   - `anthropic-agent-skills` (from `anthropics/skills`): plugin `example-skills`. Expected useful skills: frontend design, web and app testing.
   - Gemini skills installed with `npx skills add gemini/developer-platform -a claude-code --all -y`.
   - Run `claude plugin marketplace list` to see any other registered marketplace, including the official one, and list plugins relevant to Expo, React Native, iOS, Next.js, Supabase, Vercel or video.

3. **GitHub** (search only; install nothing without the human's approval; skip this whole step if `gh auth status` fails, and never block on it):

```bash
gh search repos "claude code skill expo react native" --sort stars --limit 10
gh search repos "claude skill reanimated gesture" --sort stars --limit 10
gh search repos "claude skill maestro mobile testing" --sort stars --limit 10
gh search repos "claude skill remotion" --sort stars --limit 10
gh search repos "SKILL.md supabase" --sort stars --limit 10
```

For any third-party candidate, record repo, stars, last update and what it would add. Present the shortlist to the human in one message; install only what they approve. Never block the build waiting for an answer.

## What to look for, per agent

| Agent | Skills that would help |
| --- | --- |
| ui-designer | frontend-design (visual direction), Expo or React Native patterns, Reanimated and gesture patterns, iOS design guidelines, dataviz (category bars) |
| api-builder | API design, Next.js route handler patterns, error handling |
| gemini-integrator | Gemini developer-platform skills |
| data-architect | Supabase or Postgres patterns |
| game-engine | test-driven development |
| qa-verifier | mobile app testing (Maestro), API testing, verification or code review |
| release-engineer | EAS Update or Expo deployment, Vercel deploy, README writing, humanizer (README copy) |
| video-producer | Remotion, motion graphics, humanizer (voiceover lines) |
| orchestrator | planning, context management, skill-router |

## Output

1. `docs/SKILLS_SELECTED.md`: a table of agent, skill name (exact, as listed by Claude Code), source, why. Plus a "Considered but skipped" list.
2. For each agent file in `.claude/agents/`, add or update a `skills:` frontmatter line listing only skills confirmed to exist on this machine, for example `skills: frontend-design`. If a name is uncertain, leave it out and mention it in the agent body instead.
