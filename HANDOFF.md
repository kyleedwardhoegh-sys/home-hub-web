# Home Hub — Workout Tracker: Handoff & Template Doc

Paste this whole file into a new Claude Code conversation to resume work on this project, or to bootstrap a new project (e.g. a football practice planner) using the same pattern. It's split into a **reusable template** section (architecture + hard-won gotchas, generic to any similar project) and a **this-project-specifics** section (family/app details unique to the workout tracker).

---

## Part 1: The Reusable Pattern

**When this pattern fits:** an "admin" (parent, coach, teacher) enters structured plans/assignments into a spreadsheet, and "users" (kids, players, students) interact with a simple, touch-friendly web app to view their stuff and mark things done — with no login friction for the users.

**Architecture:**
1. **Google Sheet** — source of truth. The admin edits it directly; it's the only "database."
2. **Google Apps Script**, deployed as a public web app (Deploy → Web app, "Who has access: Anyone") — a free, serverless JSON API in front of the sheet. `doGet` reads, `doPost` writes. No login needed for end users because the web app itself runs under the sheet owner's permissions.
3. **Static HTML/CSS/JS frontend** — no framework, no build step, no npm dependencies. Talks to the Apps Script URL directly via `fetch()`. Deliberately dependency-free so it's trivial to iterate on and trivial to host anywhere.
4. **GitHub Pages** — free hosting for the static frontend, reachable from any device/network (not just the home WiFi), auto-deploys on `git push`.
5. **Local PowerShell static server** (`serve.ps1`, using `System.Net.HttpListener`) — for testing on the dev machine before pushing, used because this Windows machine has neither Python nor Node installed.

**Why this pattern over "just build an app with a real backend":** zero hosting cost, zero server to maintain, the admin already knows how to use a spreadsheet, and a static frontend can be hosted anywhere (GitHub Pages, Netlify, etc.) or run locally in kiosk mode with zero changes.

### Gotchas learned the hard way (apply these from day one next time)

1. **Apps Script Web App responses are always a redirect.** Both `doGet` and `doPost` requests to the `/exec` URL return a `302` to a one-time `script.googleusercontent.com/.../echo?...` URL that carries the actual body. Browsers' `fetch()` follow this transparently — no special handling needed in app code. But `curl -L` on a **POST** breaks (curl re-issues the redirect as a bodyless GET, which 411s) — the original write already succeeded server-side before the redirect though, so this is only a testing artifact. To test POSTs with curl, don't use `-L`; read the `Location` header and `curl` it separately if you need the response body.
2. **POST body must be `Content-Type: text/plain`, not `application/json`.** Apps Script's `doPost` doesn't handle CORS preflight, so a `application/json` fetch (which triggers a preflight) fails cross-origin. `text/plain` keeps it a CORS "simple request." The script should still do `JSON.parse(e.postData.contents)` regardless of the declared type — this works fine.
3. **Redeploy by editing the existing deployment**, not creating a new one: Deploy → Manage deployments → pencil icon → Version: "New version" → Deploy. This keeps the `/exec` URL stable so the frontend never needs to change. Creating a fresh deployment mints a new URL.
4. **CSS `[hidden]` trap:** the `hidden` HTML attribute sets `display:none` via the browser's default stylesheet, but *any* author CSS rule that sets `display` on that same element (e.g. `.overlay { display:flex }`) silently overrides it — author styles always beat user-agent styles, regardless of selector specificity. Fix once, globally: `[hidden] { display: none !important; }`. (This caused a real bug here: a result-entry popup rendered permanently open and blocked all taps.)
5. **fetch() caching:** GET requests to a fixed URL can get cached by the browser even when you expect fresh data after a write. Defensively add a cache-busting query param (`_t=Date.now()`) and `{ cache: "no-store" }` on any GET that needs to reflect a just-made change.
6. **"Assign the same thing to multiple people" → expand server-side, not client-side.** When a single sheet row needs to apply to more than one user (e.g. a shared workout for both kids), have the Apps Script expand it into one virtual record per person when serving `GET`, rather than encoding multi-person state in one row. Keeps the frontend, and each person's completion state, blissfully independent.
7. **Put "is this done" state on the same row you're already reading, not a separate cross-referenced log/history tab.** A cross-tab join on date/kid/exercise is exactly the kind of thing that silently breaks (timezone normalization, matching edge cases). Keep an append-only log *only* for genuine history (e.g. progress-over-time charts) — never as the live source of truth for "current status." Real bug here: completion status briefly worked, then appeared to revert — root-caused to fragile cross-tab matching, fixed by moving "done" onto per-person columns on the assignment row itself, which is also directly user-editable (a checkbox in the sheet) as a bonus.
8. **Dev machine has no Python or Node.** Use a small PowerShell script with `System.Net.HttpListener` for local static serving (see `serve.ps1` in this repo — copy it verbatim for a new project). Use the GitHub CLI (`gh`) for repo creation/auth/Pages setup: `winget install --id GitHub.cli`, then it's at `C:\Program Files\GitHub CLI\gh.exe` (not on PATH in already-open shells — use the full path or `export PATH="/c/Program Files/GitHub CLI:$PATH"` in Bash).
9. **`gh auth login --web` needs a real human.** Run it in the background, read its output for the one-time code + URL, relay both to the user in chat, and it completes on its own once they authorize in a browser — don't try to script around that step.
10. **Creating a public repo / pushing code gets blocked by Claude Code's auto-mode classifier by default** (it's a "visible to others" action) — expect to explicitly confirm repo visibility (public/private) with the user before it'll proceed.
11. **Git identity isn't preset on a fresh machine** — `git config user.email` / `user.name` need to be set (scoped to the repo, not `--global`, unless told otherwise) before the first commit.
12. **CRLF warnings on `git add` are harmless** on Windows (`core.autocrlf` doing its job) — don't chase them.

### Recommended file layout for a new project using this pattern

```
project-root/
  index.html          — single page, JS-driven view switching, no router
  styles.css           — mobile-first, big touch targets (~88px min), CSS vars for theme colors
  app.js                — API_BASE constant, apiGet/apiPost wrappers, view logic
  manifest.json         — PWA manifest so it can be "Added to Home Screen" on phones
  icon.svg              — simple inline SVG icon, referenced by manifest
  serve.ps1             — local static server (copy verbatim)
  apps-script/
    backend.gs           — the Apps Script source, kept in git as the reference copy
                            (the *live* copy lives in the Sheet's Extensions → Apps Script editor —
                            these can drift; always paste the git version in fresh before editing)
  HANDOFF.md            — this document, kept up to date as the project evolves
```

---

## Part 2: This Project's Specifics (Nash & Nellie Workout Hub)

**What it is:** a touchscreen (43" Elo, wall-mounted, portrait or landscape) + phone/iPad web app where Kyle's kids Nash and Nellie see their daily assigned workouts (with embedded YouTube demo videos), mark them complete, log measurable results (weight/distance/time), and see progress charts over time. First module of a larger planned "family home hub."

**Family context** (for tone/design decisions, not app logic): Kyle (civil engineer), wife Logan (4th grade teacher), daughter Nellie (b. 2014-02-17, basketball/volleyball), son Nash (b. 2015-10-01, basketball/football/baseball). Maple Grove, MN.

**Live URLs:**
- Public app: https://kyleedwardhoegh-sys.github.io/home-hub-web/
- Source repo: https://github.com/kyleedwardhoegh-sys/home-hub-web (public, auto-deploys to Pages on push to `main`)
- Google Sheet: https://docs.google.com/spreadsheets/d/1MNiMRR4itYS7FSJxK9lhtrreH29eDBCM-cPJMWmSyMk/edit
- Apps Script web app (API): `https://script.google.com/macros/s/AKfycbyyOY00079KTcqhRtuoE_W_OhRTZGlsHgfSTgryrTl3ZzsVFHwiA54bJ55hu7qChYyxGQ/exec`
- Local clone: `C:\Users\Owner\source\repos\HomeHub-Web`

**Sheet structure (3 tabs):**
1. **Exercise Library** — Exercise Name, YouTube Link, Category (Strength/Explosiveness/Quickness/Sports-Specific/Foundational), Result Type (None/Weight/Distance/Time).
2. **Daily Assignments** — Date, Kid (Nash/Nellie/**Both**), Exercise Name (dropdown from Library), Sets, Reps, **Nash Done**, **Nash Result**, **Nellie Done**, **Nellie Result**. The last 4 columns are the live, per-kid, manually-editable completion status — added after the original 5-column version to fix a completion-tracking bug (see gotcha #7 above) and to let Kyle override status by hand.
3. **Completion Log** — Date, Kid, Exercise Name, Done, Result Value, Completed At. Append-only history, feeds the per-exercise progress charts only. Not the source of truth for "is this done right now" (that's Daily Assignments now).

**API contract** (`apps-script/workout_hub_backend.gs`):
- `GET ?action=getAssignments&date=YYYY-MM-DD` (date optional, defaults today) → today's assignments, "Both" rows expanded per-kid, `done`/`resultValue` read live from the Daily Assignments row.
- `GET ?action=getLibrary` → full exercise library.
- `GET ?action=getProgress&kid=X&exercise=Y` → time-series from Completion Log for charting.
- `POST {action:"markComplete", date, kid, exercise, resultValue}` → sets the Daily Assignments row's per-kid Done/Result columns AND appends/updates Completion Log.

**Frontend features built so far:**
- Kid-select screen → today's workout cards (thumbnail, tap-to-expand inline YouTube embed, sets×reps).
- Explicit empty-circle "mark complete" tap target per card (was a real bug: originally rendered with no icon at all when incomplete, effectively invisible).
- On-screen number pad (not the OS keyboard) for logging Weight/Distance/Time results, since this is a wall-kiosk with no physical keyboard.
- Completion celebration animation (checkmark pop).
- Per-exercise progress view: hand-rolled SVG line chart for numeric result types, a completion-count message for checkbox-only (`resultType: None`) exercises.
- Add-to-Home-Screen support (manifest.json) for phone/iPad use outside the house.

**Abandoned side-branch:** `C:\Users\Owner\source\repos\HomeHubSolution\HomeHubApp` — an earlier (2026-01-19) native WinUI 3 (C#/XAML) attempt at a home hub with placeholder tiles. Explicitly abandoned in favor of the web-app approach on 2026-08-08. Leave it alone; don't resurrect it.

**Not yet built (known next steps for this project specifically):**
- Kiosk-mode launcher (Chrome/Edge `--kiosk` pointed at the served app, ideally auto-starting on boot).
- The vertical/horizontal Windows display-rotation switching helper Kyle originally asked about.
- Any other planned hub modules (calendar was floated as the next "win" after this one, since Google Calendar is the family's existing scheduling tool).

---

## Part 3: Using This as a Template for the Football Practice Planner

Likely mapping (confirm specifics with Kyle when that project starts, don't assume):
- **Admin** = Kyle (coach) plans practices/drills in a Google Sheet (e.g. a Practice Plan Library tab + a Daily/Weekly Schedule tab, mirroring Exercise Library + Daily Assignments here).
- **Users** = players (or parents) view the day's practice plan, drill videos, maybe check in/mark attendance — mirrors the kid-select → today's-cards → mark-complete flow here.
- Reuse verbatim: `serve.ps1`, the manifest.json/PWA pattern, the CSS `[hidden]` fix, the cache-busting `apiGet` wrapper, the git/GitHub Pages deploy workflow, the "Both"-style server-side expansion idea if a drill applies to a whole position group rather than one player.
- Don't assume: the exact sheet columns, category lists, or result-type concept — those are workout-specific and should be redesigned around what a practice plan actually needs (periods/time blocks, drill duration, equipment, position groups, etc.) rather than copy-pasted.
- Start a fresh repo/sheet/Apps Script project rather than extending this one — separate concerns, separate deployments, even though the code will look structurally similar at first.
