# CLAUDE.md — Cathay Pacific Award Flight Helper

## Project Context

- **Type**: Tampermonkey userscript
- **Production**: `cathay-award-helper.js` (no debug log panel)
- **Debug**: `cathay-award-helper-debug.js` (with in-panel debug log)
- **Language**: JavaScript (single-file userscript)
- **Target site**: `cathaypacific.com` (React-based, custom components, cross-subdomain navigation)
- **Key reference**: Read `cathay-website-patterns.md` before modifying any DOM interaction code — it documents every working pattern and the failures that led to them

## Git Workflow

- **Never commit or push without explicit user approval**
- **Always review and update README.md before every commit** if the changes affect features, usage, or file structure
- When asked to commit, follow standard commit message conventions with a clear summary of what changed and why

## Debugging Approach

This project requires iterating with the user since the agent cannot see the live browser. Follow this loop:

1. **Log everything** with `[CX Helper]` prefix — the user filters by this
2. **Try multiple labeled strategies** (A/B/C/D) in the same code so the user can report which worked
3. **Ask for console output AND screenshots** when behavior is unclear
4. **Consolidate** once a strategy is confirmed — keep the winner, remove the rest

Before guessing at DOM selectors or click methods, check `cathay-website-patterns.md` for documented patterns. The site uses custom React components where native HTML elements are often decorative.

## Development Practices

- **Read before editing** — understand the existing code structure before making changes
- **Verify fixes don't break existing functionality** — trace adjacent code paths after changes
- **Sort DOM candidates by size** (smallest first) — containers match the same selectors as their inner interactive elements
- **Test both click strategies** — `forceClick` (PointerEvent sequence) for React Aria elements, native `.click()` for custom dropdowns that close on extra events
- **No over-engineering** — this is a single-file userscript; keep it simple

## Workflow

### Plan Mode
- Enter plan mode for non-trivial tasks (3+ steps or architectural decisions)
- If something goes sideways, stop and re-plan — don't keep pushing

### Verification Before Done
- Never mark a task complete without proving it works
- Run syntax checks on the script after edits
- Ask: "Would this actually work in the browser given what we know about the site's DOM?"

### Autonomous Bug Fixing
- When given a bug report with console logs: diagnose and fix it, don't ask for hand-holding
- Point at the specific log line showing the failure, then resolve it
- If logs are insufficient, add more logging and ask the user to re-test

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Minimal code impact.
- **No Temporary Fixes**: Find root causes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary.
- **Learn from patterns**: The site's DOM quirks are documented — use them.
