# HomeHub-Web — Nash & Nellie Workout Tracker

This repo already has a thorough handoff doc — don't duplicate it here, just
pull it in automatically so every Claude Code session in this repo has it
without you pasting anything.

@HANDOFF.md

## Notes for Claude Code sessions here

- Family/household context (who Nash/Nellie/Logan are, training philosophy,
  the kitchen touchscreen) lives in the user-level `~/.claude/CLAUDE.md` —
  don't duplicate it, it's already loaded automatically.
- This repo is the **reference implementation** of the "admin enters
  structured data in a Sheet, kids use a touch-friendly static web app"
  pattern (see Part 1 of HANDOFF.md above). `football-practice-planner` and
  `maple-grove-crimson` are siblings under `C:\Users\Owner\source\repos\`
  that reuse pieces of this pattern — if you're asked to change something
  here that would also apply there, flag it rather than silently doing both.
- Keep HANDOFF.md itself up to date as this project evolves — it's both the
  human-facing handoff doc and (via the import above) Claude Code's context
  for this repo, so it's worth keeping current rather than letting it drift.

## Where things live (workflow, set up 2026-08-22)

Kyle prefers a Drive-based, GUI file browser for anything non-code, and the
terminal/VS Code only for actual app work. Four places, four jobs — don't
blur them:

- **Code, this repo's CLAUDE.md, git history** → here, on this PC, under
  `C:\Users\Owner\source\repos\HomeHub-Web`. This is the only place the app
  itself actually changes. Nothing here is mirrored to Drive automatically.
- **Live app data** (Exercise Library + Daily Assignments) → the
  "Nellie Nash Workout Tracker" Google Sheet, inside the "Nellie/Nash
  Training" Drive folder. Kyle edits this directly; it stays where it is,
  not moved into the Claude-specific Drive folder below.
- **Input files for this project** (new exercise ideas, videos, photos,
  notes Kyle wants considered) → Google Drive, in
  "Claude Tools & Instructions/Kids Workout Hub". If Kyle mentions a file
  and you don't have it, that folder is the first place to think to look
  (via whatever Drive access is available in that session) or ask him to
  paste/attach it.
- **Instructional/reference docs** (the dev workflow guide, a reference
  copy of this very file) → Drive, "Claude Tools & Instructions/Instructions
  & Guides". Those are static reference copies for Kyle to read — this
  file, the one actually loaded into your context right now, is the live
  one. If this file changes, the Drive copy does not update itself.
