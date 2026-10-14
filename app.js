// Data comes through hubdata.js (window.HubData): the fast Supabase database when it's
// set up, otherwise the Sheet's Apps Script. See HANDOFF "v3: fast database".

const TRACKS = ["Morning", "After School", "Night"];
const TRACK_ICONS = {
  "Morning": '<svg viewBox="0 0 24 24"><path d="M12 3v2M5.6 7.6l1.4 1.4M18.4 7.6 17 9M3 15h2M19 15h2M7 15a5 5 0 0 1 10 0M3 19h18"/></svg>',
  "After School": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M5.6 5.6c3.5 3.5 3.5 9.3 0 12.8M18.4 5.6c-3.5 3.5-3.5 9.3 0 12.8"/></svg>',
  "Night": '<svg viewBox="0 0 24 24"><path d="M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z"/></svg>',
};
const CHECK = '<svg class="chk" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const SET_CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const BIG_CHECK = '<svg class="bigchk" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ach = (n) => `${n} achievement${n === 1 ? "" : "s"}`;

// "Pick any" groups: shooting, jump rope and dribbling come first; everything
// else (lifting, agility, explosive, defense...) waits under "More".
const FOCUS = [
  ["Jump Rope", (it) => /jump rope/i.test(it.name)],
  ["Two Ball", (it) => it.category === "Two Ball"],
  ["Dribbling", (it) => it.category === "Dribbling"],
  ["Shooting", (it) => /shoot|tests|film|garage|feel|mindset/i.test(it.category)],
];
const FOCUS_ORDER = ["Shooting", "Jump Rope", "Dribbling", "Two Ball", "More"];
const FOCUS_ORDER_BY_TRACK = { "Morning": ["Dribbling", "Two Ball", "Jump Rope", "Shooting", "More"] };

const S = {
  demo: false,
  players: [],
  locked: null,      // ?p=Titus locks the screen to one player (for friends' links)
  hub: null,
  track: null,
  cat: {},           // selected option category per track
  queue: Promise.resolve(),
  pending: 0,
  lastTap: 0,
  skip: {},         // must-dos skipped in "Up next" this visit
  fbSkipped: {},    // drills whose feedback question was skipped this visit
  fbQueue: null,    // feedback waiting for the BOOM card to close
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());

// ---------- API ----------

// Network-level failures (timeouts, Google's HTML error pages) come back as
// { error: "network" } so callers can retry; real API errors (e.g. "unknown player")
// come back as-is and are not retried.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function apiGet(action, params = {}) {
  try {
    if (action === "getHub") return await HubData.getHub(params.player, params.date);
    if (action === "getPlayers") return await HubData.getPlayers();
    return await HubData.sheetGet(action, params);
  } catch (e) {
    return { error: "network" };
  }
}
// Up to 3 tries for network failures (Apps Script hiccups are common and short).
async function apiGetRetry(action, params = {}) {
  let r;
  for (const wait of [0, 1500, 4000]) {
    if (wait) await sleep(wait);
    r = await apiGet(action, params);
    if (!r || r.error !== "network") return r;
  }
  return r;
}

async function apiPost(body) { return HubData.post(body); }

function send(body) {
  if (S.demo) return;
  S.pending++;
  S.queue = S.queue
    .then(() => apiPost(body))
    .then((r) => {
      if (r && r.error) throw new Error(r.error);
      if (r && r.queued) toast("Saved on this screen. It will sync by itself when the Wi-Fi is back.");
    })
    .catch(() => toast("Couldn't save that. Check the Wi-Fi and tap again."))
    .finally(() => { S.pending--; });
}

// ---------- boot ----------

// ---------- speed: device cache + parallel loads (2026-10-14) ----------
// Every call to the Sheet's Apps Script takes ~2–5 s. So the screen shows the last
// copy saved on this device right away (only if it's from today), fetches fresh data
// in the background, and starts the player list and the kid's plan at the same time.
// A fresh copy never replaces the screen if a tap happened while it was loading.
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const hubKey = (name) => `training.hub.${name}`;
function cachedHub(name) {
  const h = store.get(hubKey(name));
  return h && h.date === today() && h.player && h.player.name === name ? h : null;
}
function saveHub() { if (S.hub && !S.demo) store.set(hubKey(S.hub.player.name), { ...S.hub, _at: Date.now() }); }
const inflight = {};
function fetchHub(name) {
  if (!inflight[name]) {
    inflight[name] = apiGetRetry("getHub", { player: name, date: today() })
      .then((hub) => {
        if (hub && !hub.error) {
          store.set(hubKey(name), { ...hub, _at: Date.now() });
          // Newer backends send the player list too; saving it makes the next cold start skip a wait.
          if (Array.isArray(hub.players) && hub.players.length) store.set("training.players", hub.players);
        }
        return hub;
      })
      .catch(() => ({ error: "offline" }))
      .finally(() => { delete inflight[name]; });
  }
  return inflight[name];
}
// True if `hub` (requested at `startedAt`) can replace what's on screen.
function canApply(name, hub, startedAt) {
  return hub && !hub.error && S.hub && S.hub.player.name === name && !S.pending && S.lastTap < startedAt;
}
function overlayOpen() { return !$("#boom-overlay").hidden || !$("#video-overlay").hidden || !$("#fb-overlay").hidden; }

async function boot() {
  const params = new URLSearchParams(location.search), want = params.get("p");
  let players;
  // ?demo forces preview mode (sample data, nothing saved) for testing without touching the Sheet.
  if (params.has("demo")) players = { error: "demo" };
  else {
    const cachedPlayers = store.get("training.players");
    // Start the kid's plan now, in parallel with the player list.
    let guess = null;
    // With ?p=Name (the kiosk's links), start that kid's plan immediately even with no saved player list.
    try { guess = want ? ((cachedPlayers || []).find((x) => x.name.toLowerCase() === want.toLowerCase())?.name || want.charAt(0).toUpperCase() + want.slice(1).toLowerCase()) : localStorage.getItem("training.player"); } catch (e) {}
    const guessHub = guess && params.get("pick") === null ? fetchHub(guess) : null;
    const fresh = apiGetRetry("getPlayers").then((r) => { if (Array.isArray(r)) store.set("training.players", r); return r; }).catch(() => ({ error: "offline" }));
    if (Array.isArray(cachedPlayers) && cachedPlayers.length) {
      players = cachedPlayers;
      fresh.then((r) => { if (Array.isArray(r)) { S.players = r; if ($("#view-select").classList.contains("active")) renderSelect(); } });
    } else {
      // The kid's plan carries the player list too (newer backend), so use whichever arrives first.
      const never = new Promise(() => {});
      const fromHub = guessHub ? guessHub.then((h) => (h && Array.isArray(h.players) && h.players.length ? h.players : never)) : never;
      players = await Promise.race([fresh, fromHub]);
      // A network hiccup must never drop into preview mode (taps there aren't saved):
      // keep retrying until the real player list loads.
      for (let attempt = 1; players && players.error === "network"; attempt++) {
        showView("view-select");
        $("#select-status").hidden = false;
        $("#select-status").textContent = `Can't reach Google right now. Trying again… (try ${attempt + 1})`;
        await sleep(Math.min(30000, 5000 * attempt));
        players = await apiGetRetry("getPlayers");
        if (Array.isArray(players)) store.set("training.players", players);
      }
    }
  }
  // Preview mode only when asked for (?demo) or when the Sheet's script doesn't have v2 yet.
  if (!Array.isArray(players)) { S.demo = true; players = DEMO.players; $("#demo-banner").hidden = false; }
  S.players = players;

  if (want) {
    const p = players.find((x) => x.name.toLowerCase() === want.toLowerCase());
    if (p) { S.locked = p.name; return openPlayer(p.name); }
  }
  renderSelect();
  let last = null;
  try { last = localStorage.getItem("training.player"); } catch (e) {}
  if (last && players.some((x) => x.name === last) && new URLSearchParams(location.search).get("pick") === null) openPlayer(last);
}

function renderSelect() {
  $("#select-status").hidden = S.players.length > 0;
  $("#select-status").textContent = "No players are turned on yet. Set Active to TRUE in the Players tab.";
  $("#player-grid").innerHTML = S.players.map((p) =>
    `<button class="player-tile t-${esc(p.theme || "nellie")}" data-player="${esc(p.name)}">
       <span class="pn">${esc(p.name)}</span><span class="pw">${p.tracks.map(esc).join(" · ")}</span>
     </button>`).join("");
  document.documentElement.dataset.theme = "";
  showView("view-select");
  // Pre-load each kid's page so tapping a name is instant.
  if (!S.demo) S.players.forEach((p) => { const h = store.get(hubKey(p.name)); if (!h || h.date !== today() || Date.now() - (h._at || 0) > 60000) fetchHub(p.name); });
}

function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === id));
}

async function openPlayer(name) {
  try { localStorage.setItem("training.player", name); } catch (e) {}
  const p = S.players.find((x) => x.name === name);
  document.documentElement.dataset.theme = p?.theme || "";
  $("#hub-name").textContent = `${name}'s Training`;
  $("#hub-date").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  showView("view-hub");
  const pickTrack = () => {
    const want = new URLSearchParams(location.search).get("track");
    const match = (S.hub?.player.tracks || []).find((t) => t.toLowerCase().replace(/\s/g, "") === (want || "").toLowerCase().replace(/[\s-]/g, ""));
    S.track = match || defaultTrack();
  };
  if (S.demo) { await loadHub(name); pickTrack(); render(); return; }
  const token = (S.openToken = (S.openToken || 0) + 1); // a newer openPlayer/goHome cancels this one
  const cached = cachedHub(name);
  if (cached) { S.hub = cached; setLoading(false); pickTrack(); render(); }
  else { S.hub = null; setLoading(true, name, 0); }
  // Keep trying until it loads (never sit on "Loading…" forever).
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    const hub = await fetchHub(name);
    if (token !== S.openToken) return;
    if (hub && !hub.error) {
      if (!S.hub) { S.hub = hub; setLoading(false); pickTrack(); render(); }
      else if (canApply(name, hub, started)) { S.hub = hub; if (!overlayOpen()) render(); }
      return;
    }
    if (hub && hub.error !== "network") { setLoading(true, name, -1, hub.error); return; }
    if (S.hub) return; // showing today's saved copy; the 1-minute refresh keeps trying
    setLoading(true, name, attempt);
    await sleep(Math.min(30000, 5000 * attempt));
    if (token !== S.openToken) return;
  }
}

// Loading screen: hides the empty prize boxes and tabs, and says what's happening.
function setLoading(on, name, attempt, err) {
  $("#view-hub").classList.toggle("loading", on);
  if (!on) return;
  const msg = attempt === -1
    ? `<h2>Couldn't load ${esc(name)}'s list</h2><p class="muted">The plan says: ${esc(err)}. Ask Dad to check the Sheet.</p>`
    : attempt === 0
      ? `<h2>Loading ${esc(name)}'s list…</h2><p class="muted">This takes a few seconds the first time.</p>`
      : `<h2>Still loading ${esc(name)}'s list…</h2><p class="muted">The internet is being slow. Trying again automatically (try ${attempt + 1}).</p>`;
  $("#track-body").innerHTML = `<div class="empty loading-msg"><div class="spinner" aria-hidden="true"></div>${msg}</div>`;
}

async function loadHub(name) {
  if (S.demo) { S.hub = S.hub && S.hub.player.name === name ? S.hub : demoHub(name); return; }
  const hub = await apiGet("getHub", { player: name, date: today() });
  if (hub.error) { toast("Couldn't load the plan."); return; }
  S.hub = hub;
}

function defaultTrack() {
  const t = S.hub?.player.tracks || [];
  if (S.track && t.includes(S.track)) return S.track;
  const h = new Date().getHours();
  const guess = h < 11 ? "Morning" : h < 18 ? "After School" : "Night";
  return t.includes(guess) ? guess : t[0];
}

// ---------- points + state ----------

const key = (track, id, set) => `${track}|${id}|${set}`;
const isDone = (track, id, set) => !!S.hub.done[key(track, id, set)];
const setsDone = (track, it) => { let n = 0; for (let i = 1; i <= it.sets; i++) if (isDone(track, it.id, i)) n++; return n; };
const trackItems = (track) => { const t = S.hub.tracks[track]; return t ? t.must.concat(...t.options.map((g) => g.items)) : []; };
const trackPts = (track) => trackItems(track).reduce((a, it) => a + setsDone(track, it) * it.pts, 0);

function applySet(track, it, set, on) {
  const k = key(track, it.id, set);
  if (!!S.hub.done[k] === on) return 0;
  if (on) S.hub.done[k] = true; else delete S.hub.done[k];
  const d = on ? it.pts : -it.pts;
  const P = S.hub.points;
  P.today += d; P.week += d; P.lifetime += d;
  if (S.hub.prizes.big && S.hub.date >= S.hub.prizes.big.start) P.big += d;
  send({ action: "toggleSet", date: S.hub.date, player: S.hub.player.name, track, activity: it.id, set, done: on, pts: it.pts });
  return d;
}

function afterChange(before) {
  render();
  saveHub();
  const P = S.hub.points, W = S.hub.prizes.weekly, B = S.hub.prizes.big;
  if (B && before.big < B.target && P.big >= B.target) return boom("big");
  if (W && before.week < W.target && P.week >= W.target) return boom("weekly");
}

// ---------- render ----------

function render() {
  if (!S.hub) return;
  renderCalendar();
  renderPrizes();
  renderTabs();
  renderTrack();
}

// Today/tomorrow from Google Calendar — a heads-up only, not part of the tracks.
function renderCalendar() {
  const ev = S.hub.events || [], el = $("#cal-strip");
  el.hidden = !ev.length;
  el.innerHTML = ev.map((e) => `<div class="cal-item ${e.day === "Today" ? "today" : ""}">
      <span class="cal-day">${esc(e.day)}<b>${esc(e.time || "All day")}</b></span>
      <span class="cal-text"><span class="cal-title">${esc(e.title)}</span>${e.location ? `<span class="cal-loc">${esc(e.location)}</span>` : ""}</span>
    </div>`).join("");
}

function renderPrizes() {
  const { points: P, prizes, player } = S.hub;
  const visual = player.visual === "Thermometer" ? "Thermometer" : "Bomb";
  $("#btn-visual").textContent = visual === "Bomb" ? "Switch to thermometer" : "Switch to bomb";
  $("#today-pts").textContent = P.today;
  const W = prizes.weekly || { prize: "Weekly prize", target: 150 };
  const B = prizes.big || { prize: "Big prize", target: 1000 };
  $("#weekly-prize").textContent = W.prize;
  $("#big-prize").textContent = B.prize;
  $("#weekly-visual").innerHTML = visual === "Bomb" ? bombSVG(P.week, W.target) : thermoSVG(P.week, W.target);
  $("#big-visual").innerHTML = visual === "Bomb" ? bombSVG(P.big, B.target) : thermoSVG(P.big, B.target, true);
  const wLeft = Math.max(0, W.target - P.week), bLeft = Math.max(0, B.target - P.big);
  $("#weekly-label").innerHTML = wLeft ? `<span class="num">${wLeft}</span> more ${wLeft === 1 ? "achievement" : "achievements"} to ${visual === "Bomb" ? "BOOM" : "the top"} · <span class="num">${P.week}</span>/${W.target}` : "Weekly prize won! New fuse on Monday.";
  $("#big-label").innerHTML = bLeft ? `<span class="num">${P.big}</span>/${B.target} achievements` : "Big prize won! Show Dad.";
  $(".prize-weekly").classList.toggle("won", !wLeft);
  $(".prize-big").classList.toggle("won", !bLeft);
}

// A long fuse that burns down toward the bomb as points come in.
// Path starts at the bomb's cap and winds left; the lit part shrinks back toward the bomb.
const FUSE_D = "M496 70 C480 22, 430 18, 395 56 S 325 116, 282 72 S 206 20, 166 66 S 96 120, 60 76 S 22 42, 12 60";
function bombSVG(pts, target) {
  const left = Math.max(0, 1 - pts / target);
  if (left === 0) {
    return `<svg viewBox="0 0 600 190" role="img" aria-label="Exploded">
      ${burstPath(300, 95, 92)}
      <text x="300" y="110" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif" font-weight="800" font-size="44" fill="#fff">BOOM!</text></svg>`;
  }
  return `<svg viewBox="0 0 600 190" role="img" aria-label="${Math.round(left * 100)}% of the fuse left">
    <path d="${FUSE_D}" fill="none" stroke="var(--line)" stroke-width="7" stroke-linecap="round" stroke-dasharray="2 12"/>
    <path class="fuse-live" d="${FUSE_D}" fill="none" stroke="var(--fuse)" stroke-width="8" stroke-linecap="round" pathLength="1000" stroke-dasharray="${left * 1000} 1000"/>
    <g class="spark-pos"></g>
    <rect x="484" y="66" width="44" height="22" rx="6" fill="var(--bomb)" transform="rotate(-25 506 77)"/>
    <circle cx="520" cy="128" r="58" fill="var(--bomb)"/>
    <circle cx="500" cy="108" r="12" fill="#fff" opacity=".25"/>
  </svg>`;
}

function placeSparks() {
  document.querySelectorAll(".visual svg").forEach((svg) => {
    const live = svg.querySelector(".fuse-live"), g = svg.querySelector(".spark-pos");
    if (!live || !g) return;
    const full = live.getTotalLength();
    const frac = parseFloat(live.getAttribute("stroke-dasharray")) / 1000;
    const p = live.getPointAtLength(full * frac);
    g.innerHTML = `<g transform="translate(${p.x},${p.y})"><circle class="spark" r="13" fill="#FFB627"/><circle class="spark" r="6" fill="#fff"/></g>`;
  });
}

function burstPath(cx, cy, r) {
  let d = "";
  for (let i = 0; i < 24; i++) {
    const rr = i % 2 ? r * 0.55 : r, a = (Math.PI * 2 * i) / 24;
    d += `${i ? "L" : "M"}${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
  }
  return `<path d="${d}Z" fill="var(--accent)"/><path d="${d}Z" fill="var(--sun)" transform="translate(${cx} ${cy}) scale(.62) translate(${-cx} ${-cy})"/>`;
}

// A thermometer that fills from the bulb toward the top.
function thermoSVG(pts, target, small) {
  const f = Math.min(1, pts / target), h = small ? 120 : 160, cy = h / 2;
  const x0 = 90, x1 = 570, w = (x1 - x0) * f, tube = small ? 30 : 40, bulb = small ? 34 : 46;
  let ticks = "";
  for (let i = 1; i < 10; i++) { const x = x0 + ((x1 - x0) * i) / 10; ticks += `<line x1="${x}" x2="${x}" y1="${cy - tube / 2 - 10}" y2="${cy - tube / 2 - (i % 5 ? 4 : 0)}" stroke="var(--ink-2)" stroke-width="2"/>`; }
  return `<svg viewBox="0 0 600 ${h}" role="img" aria-label="${Math.round(f * 100)}% full">
    <rect x="${x0 - 10}" y="${cy - tube / 2}" width="${x1 - x0 + 20}" height="${tube}" rx="${tube / 2}" fill="var(--paper)" stroke="var(--line)" stroke-width="4"/>
    <rect x="${x0 - 10}" y="${cy - tube / 2 + 6}" width="${Math.max(0, w + 10)}" height="${tube - 12}" rx="${(tube - 12) / 2}" fill="var(--accent)"/>
    <circle cx="${x0 - 22}" cy="${cy}" r="${bulb}" fill="var(--accent)" stroke="var(--line)" stroke-width="4"/>
    ${ticks}
    ${f >= 1 ? `<text x="${x1 - 6}" y="${cy + tube / 2 + 30}" text-anchor="end" font-family="Bricolage Grotesque, sans-serif" font-weight="800" font-size="26" fill="var(--accent)">FULL!</text>` : ""}
  </svg>`;
}

function renderTabs() {
  $("#track-tabs").innerHTML = S.hub.player.tracks.map((t) =>
    `<button class="track-tab" role="tab" data-track="${esc(t)}" aria-selected="${t === S.track}">
       ${TRACK_ICONS[t] || ""}<span class="tn">${esc(t)}</span><span class="tp">${tabStatus(t)}</span>
     </button>`).join("");
}

function renderTrack() {
  const t = S.track, data = S.hub.tracks[t];
  if (!data) { $("#track-body").innerHTML = `<div class="empty">Nothing on this track yet.</div>`; return; }
  let h = upNextHTML(t);
  if (!data.must.length) {
    h += `<div class="upnext alldone"><h2>No must-dos ${t === "After School" ? "after school" : "here"}</h2><p class="cue">Pick anything below. Every set is an achievement.</p></div>`;
  }
  if (data.must.length) {
    h += `<h2 class="sec-title">Must-dos <small>Dad's picks for today</small></h2><div class="acts">${data.must.map((it) => actHTML(t, it)).join("")}</div>`;
  }
  const groups = focusGroups(t);
  if (groups.length) {
    const cats = groups.map((g) => g.category);
    if (!cats.includes(S.cat[t])) S.cat[t] = cats[0];
    const sel = groups.find((g) => g.category === S.cat[t]);
    let list;
    if (sel.category === "More") {
      const sub = {};
      sel.items.forEach((it) => (sub[it.category] = sub[it.category] || []).push(it));
      list = Object.entries(sub).map(([c, items]) => `<h3 class="more-sub">${esc(c)}</h3><div class="acts">${items.map((it) => actHTML(t, it)).join("")}</div>`).join("");
    } else {
      list = `<div class="acts">${sel.items.map((it) => actHTML(t, it)).join("")}</div>`;
    }
    h += `<h2 class="sec-title">Pick any <small>every set is an achievement</small></h2>
      <div class="cat-pills">${groups.map((g) => {
        const n = g.items.reduce((a, it) => a + setsDone(t, it), 0);
        return `<button class="cat-pill" data-cat="${esc(g.category)}" aria-pressed="${g.category === S.cat[t]}">${esc(g.category)}${n ? `<span class="n">${n}</span>` : ""}</button>`;
      }).join("")}</div>${list}`;
  }
  $("#track-body").innerHTML = h || `<div class="empty">Nothing on this track yet.</div>`;
  requestAnimationFrame(placeSparks);
}

function focusGroups(t) {
  const g = {};
  (S.hub.tracks[t]?.options || []).forEach((grp) => grp.items.forEach((it) => {
    const f = (FOCUS.find(([, test]) => test(it)) || ["More"])[0];
    if (!(g[f] = g[f] || []).some((x) => x.id === it.id)) g[f].push(it);
  }));
  return (FOCUS_ORDER_BY_TRACK[t] || FOCUS_ORDER).filter((k) => g[k]?.length).map((k) => ({ category: k, items: g[k] }));
}

function mustCount(t) {
  const must = S.hub.tracks[t]?.must || [];
  return { total: must.reduce((a, it) => a + it.sets, 0), done: must.reduce((a, it) => a + setsDone(t, it), 0) };
}

function tabStatus(t) {
  const { total, done } = mustCount(t);
  if (total && done < total) return `${total - done} to do`;
  const n = trackPts(t);
  return total ? `Done! ${ach(n)}` : ach(n);
}

// The one thing to do right now: the first unfinished must-do set (skipped ones last).
function upNext(t) {
  const must = S.hub.tracks[t]?.must || [];
  const find = (useSkipped) => {
    for (const it of must) {
      if (!useSkipped && S.skip[`${t}|${it.id}`]) continue;
      for (let s = 1; s <= it.sets; s++) if (!isDone(t, it.id, s)) return { it, s };
    }
    return null;
  };
  return find(false) || find(true);
}

function upNextHTML(t) {
  const must = S.hub.tracks[t]?.must || [];
  if (!must.length) return "";
  const { total, done } = mustCount(t), nx = upNext(t);
  if (!nx) {
    return `<section class="upnext alldone"><div class="un-top"><span class="eyebrow">Must-dos</span><span class="un-count">${done}/${total}</span></div>
      <h2>All must-dos done!</h2><p class="cue">Every extra set below is a bonus achievement.</p></section>`;
  }
  const { it, s } = nx, label = it.labels[s - 1] || it.perSet || "";
  const yt = it.video && /youtu/.test(it.video);
  return `<section class="upnext">
    <div class="un-top"><span class="eyebrow">Up next</span><span class="un-count">${done}/${total} must-do sets</span></div>
    <div class="un-bar"><i style="width:${(done / total) * 100}%"></i></div>
    <h2>${esc(it.name)}</h2>
    <div class="un-set">Set ${s} of ${it.sets}${label ? ` · ${esc(label)}` : ""}</div>
    ${it.cue ? `<p class="cue">${esc(it.cue)}</p>` : ""}
    <div class="un-actions">
      <button class="done-big" data-act="next-done" data-id="${esc(it.id)}" data-set="${s}">${BIG_CHECK}Done</button>
      ${yt ? `<button class="video-btn" data-act="video" data-url="${esc(it.video)}">Watch video</button>` : ""}
      ${must.length > 1 ? `<button class="btn-ghost small" data-act="skip" data-id="${esc(it.id)}">Skip for now</button>` : ""}
    </div>
  </section>`;
}

function pop(text) {
  const el = document.createElement("div");
  el.className = "pop"; el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

function actHTML(t, it) {
  const n = setsDone(t, it), full = n === it.sets, f = n / it.sets, c = 2 * Math.PI * 34;
  const res = S.hub.results[`${t}|${it.id}`];
  const sets = Array.from({ length: it.sets }, (_, i) => {
    const s = i + 1, on = isDone(t, it.id, s), label = it.labels[i] || (it.sets > 1 ? `Set ${s}` : "Done") + (it.perSet ? ` · ${it.perSet}` : "");
    return `<button class="set ${on ? "on" : ""}" data-act="set" data-id="${esc(it.id)}" data-set="${s}" aria-pressed="${on}"><span class="bx">${SET_CHECK}</span>${esc(label)}</button>`;
  }).join("");
  const isYT = /youtu/.test(it.video);
  const video = it.video ? (isYT
    ? `<button class="video-btn" data-act="video" data-url="${esc(it.video)}">Watch video</button>`
    : `<a class="video-btn" href="${esc(it.video)}" target="_blank" rel="noopener">Open ↗</a>`) : "";
  const stepper = it.result ? `<div class="stepper" role="group" aria-label="${esc(it.result)}">
      <button data-act="res" data-id="${esc(it.id)}" data-v="-5">−5</button><button data-act="res" data-id="${esc(it.id)}" data-v="-1">−1</button>
      <output>${res ?? "–"}</output><span class="muted">${it.resultOf ? `/ ${it.resultOf} ` : ""}${esc(it.result.toLowerCase())}</span>
      <button data-act="res" data-id="${esc(it.id)}" data-v="1">+1</button><button data-act="res" data-id="${esc(it.id)}" data-v="5">+5</button></div>` : "";
  return `<article class="act ${full ? "full" : n ? "part" : ""}">
    <button class="all-btn" data-act="all" data-id="${esc(it.id)}" aria-label="${full ? "Uncheck all sets" : "Check all sets"}: ${esc(it.name)}">
      ${n && !full ? `<svg class="ring" viewBox="0 0 76 76"><circle cx="38" cy="38" r="34" fill="none" stroke="var(--accent)" stroke-width="5" stroke-dasharray="${c * f} ${c}" stroke-linecap="round"/></svg>` : ""}${CHECK}
    </button>
    <div class="act-body">
      <div class="act-meta"><span>${esc(it.category)}</span>${it.source ? `<span>${esc(it.source)}</span>` : ""}<span class="pts">${ach(it.pts)} per set</span><span>${n}/${it.sets} sets</span></div>
      <h3>${esc(it.name)}</h3>
      ${it.cue ? `<p class="cue">${esc(it.cue)}</p>` : ""}
      ${video ? `<div class="act-tools">${video}</div>` : ""}
      <div class="sets">${sets}</div>
      ${stepper}
    </div>
  </article>`;
}

function findItem(id) { return trackItems(S.track).find((x) => x.id === id); }

// ---------- interactions ----------

document.addEventListener("click", (e) => {
  const tile = e.target.closest(".player-tile");
  if (tile) return openPlayer(tile.dataset.player);
  const tab = e.target.closest(".track-tab");
  if (tab) { S.track = tab.dataset.track; render(); return; }
  const pill = e.target.closest(".cat-pill");
  if (pill) { S.cat[S.track] = pill.dataset.cat; renderTrack(); return; }
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const act = b.dataset.act, it = b.dataset.id ? findItem(b.dataset.id) : null;
  S.lastTap = Date.now();
  const wasFull = it ? setsDone(S.track, it) === it.sets : false;
  if (act === "next-done" && it) {
    const before = { ...S.hub.points }, s = Number(b.dataset.set);
    if (!isDone(S.track, it.id, s)) applySet(S.track, it, s, true);
    pop(`+${ach(it.pts)}`);
    afterChange(before);
  } else if (act === "skip" && it) {
    S.skip[`${S.track}|${it.id}`] = true;
    renderTrack();
  } else if (act === "set" && it) {
    const before = { ...S.hub.points }, s = Number(b.dataset.set);
    applySet(S.track, it, s, !isDone(S.track, it.id, s));
    afterChange(before);
  } else if (act === "all" && it) {
    const before = { ...S.hub.points }, on = setsDone(S.track, it) < it.sets;
    for (let s = 1; s <= it.sets; s++) applySet(S.track, it, s, on);
    afterChange(before);
  } else if (act === "res" && it) {
    const k = `${S.track}|${it.id}`, cur = S.hub.results[k] ?? 0, max = it.resultOf || 999;
    S.hub.results[k] = Math.max(0, Math.min(max, cur + Number(b.dataset.v)));
    renderTrack(); saveHub();
    clearTimeout(S.resT);
    const track = S.track;
    S.resT = setTimeout(() => send({ action: "setResult", date: S.hub.date, player: S.hub.player.name, track, activity: it.id, result: S.hub.results[k] }), 700);
  } else if (act === "video") {
    openVideo(b.dataset.url);
  }
  if (it && ["next-done", "set", "all"].includes(act)) maybeAskFeedback(S.track, it, wasFull);
});

// ---------- first-time drill feedback ----------
const FB_MINUTES = [1, 2, 3, 4, 5, 7, 10, 15, 20, 30];
let fbPick = { minutes: null, difficulty: null, track: null, it: null };

function maybeAskFeedback(track, it, wasFull) {
  if (S.demo && !new URLSearchParams(location.search).has("fbdemo")) return;
  if (wasFull || setsDone(track, it) < it.sets) return;          // only when it just got finished
  if ((S.hub.feedback || {})[it.id] || S.fbSkipped[it.id]) return; // asked already
  if (!$("#boom-overlay").hidden) { S.fbQueue = { track, it }; return; }
  openFeedback(track, it);
}

function openFeedback(track, it) {
  fbPick = { minutes: null, difficulty: null, track, it };
  $("#fb-title").textContent = it.name;
  $("#fb-min").innerHTML = FB_MINUTES.map((m) => `<button class="fb-opt" data-fb="minutes" data-v="${m}">${m === 30 ? "30+" : m}<small>min</small></button>`).join("");
  $("#fb-diff").innerHTML = Array.from({ length: 10 }, (_, i) => `<button class="fb-opt diff" data-fb="difficulty" data-v="${i + 1}">${i + 1}</button>`).join("");
  $("#fb-save").disabled = true;
  $("#fb-overlay").hidden = false;
}

$("#fb-overlay").addEventListener("click", (e) => {
  const o = e.target.closest(".fb-opt");
  if (!o) return;
  fbPick[o.dataset.fb] = Number(o.dataset.v);
  o.parentElement.querySelectorAll(".fb-opt").forEach((x) => x.setAttribute("aria-pressed", String(x === o)));
  $("#fb-save").disabled = !(fbPick.minutes && fbPick.difficulty);
});
$("#fb-save").addEventListener("click", () => {
  const { minutes, difficulty, track, it } = fbPick;
  (S.hub.feedback = S.hub.feedback || {})[it.id] = true;
  saveHub();
  send({ action: "setFeedback", player: S.hub.player.name, activity: it.id, activityName: it.name, track, minutes, difficulty, date: S.hub.date });
  $("#fb-overlay").hidden = true;
  toast("Thanks! That helps Dad set the points.");
});
$("#fb-skip").addEventListener("click", () => {
  S.fbSkipped[fbPick.it.id] = true;
  $("#fb-overlay").hidden = true;
});

// ---------- navigation (Back / Home / Full screen) ----------
if (new URLSearchParams(location.search).has("kiosk")) document.documentElement.classList.add("kiosk");

function closeOverlays() {
  if (!$("#video-overlay").hidden) { $("#video-slot").innerHTML = ""; $("#video-overlay").hidden = true; return true; }
  if (!$("#boom-overlay").hidden) { $("#boom-overlay").hidden = true; return true; }
  if (!$("#fb-overlay").hidden) { $("#fb-overlay").hidden = true; return true; }
  return false;
}
function goHome() {
  closeOverlays();
  S.openToken = (S.openToken || 0) + 1; // stop any in-progress load loop
  if (S.locked) { S.track = defaultTrack(); render(); window.scrollTo(0, 0); return; }
  S.hub = null; renderSelect(); window.scrollTo(0, 0);
}
function goBack() {
  if (closeOverlays()) return;
  if ($("#view-hub").classList.contains("active") && !S.locked) { goHome(); return; }
  if (history.length > 1) history.back(); else goHome();
}
$("#nav-home").addEventListener("click", goHome);
$("#nav-back").addEventListener("click", goBack);

const fsBtn = $("#nav-fs");
if (document.fullscreenEnabled) {
  fsBtn.hidden = false;
  const label = () => { fsBtn.innerHTML = document.fullscreenElement ? "&#x2715; Exit full screen" : "&#x26F6; Full screen"; };
  fsBtn.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => toast("This browser won't go full screen here."));
  });
  document.addEventListener("fullscreenchange", label);
  label();
}
$("#btn-visual").addEventListener("click", () => {
  const v = S.hub.player.visual === "Thermometer" ? "Bomb" : "Thermometer";
  S.hub.player.visual = v;
  const p = S.players.find((x) => x.name === S.hub.player.name); if (p) p.visual = v;
  renderPrizes(); requestAnimationFrame(placeSparks); saveHub();
  send({ action: "setVisual", player: S.hub.player.name, visual: v });
});

// ---------- video ----------

function ytId(url) {
  const m = url.match(/youtu\.be\/([\w-]{6,})/) || url.match(/shorts\/([\w-]{6,})/) || url.match(/[?&]v=([\w-]{6,})/) || url.match(/embed\/([\w-]{6,})/);
  return m ? m[1] : null;
}
function openVideo(url) {
  const id = ytId(url);
  if (!id) { window.open(url, "_blank", "noopener"); return; }
  const t = (url.match(/[?&]t=(\d+)/) || [])[1];
  $("#video-slot").innerHTML = `<iframe src="https://www.youtube.com/embed/${id}?autoplay=1${t ? `&start=${t}` : ""}" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
  $("#video-overlay").hidden = false;
}
$("#video-close").addEventListener("click", () => { $("#video-slot").innerHTML = ""; $("#video-overlay").hidden = true; });

// ---------- BOOM ----------

function boom(which) {
  const pr = S.hub.prizes[which] || {};
  const visual = S.hub.player.visual === "Thermometer" ? "Thermometer" : "Bomb";
  const card = which === "big" ? $(".prize-big") : $(".prize-weekly");
  card.classList.remove("shake"); void card.offsetWidth; card.classList.add("shake");
  const fl = document.createElement("div"); fl.className = "flash"; document.body.appendChild(fl); setTimeout(() => fl.remove(), 700);
  $("#boom-burst").innerHTML = `<svg viewBox="0 0 200 200">${burstPath(100, 100, 95)}</svg>`;
  $("#boom-title").textContent = visual === "Bomb" ? "BOOM!" : "YOU FILLED IT!";
  $("#boom-prize").textContent = `${which === "big" ? "Big prize" : "This week's prize"}: ${pr.prize || "a prize"}`;
  $("#boom-overlay").hidden = false;
  confetti(which === "big" ? 320 : 180);
}
$("#boom-close").addEventListener("click", () => {
  $("#boom-overlay").hidden = true;
  if (S.fbQueue) { const q = S.fbQueue; S.fbQueue = null; openFeedback(q.track, q.it); }
});

function confetti(n) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = $("#confetti"), x = c.getContext("2d");
  c.hidden = false; c.width = innerWidth; c.height = innerHeight;
  const cs = getComputedStyle(document.documentElement);
  const cols = ["--accent", "--accent2", "--sun", "--mint"].map((v) => cs.getPropertyValue(v).trim());
  const P = Array.from({ length: n }, () => ({ x: innerWidth / 2, y: innerHeight * 0.4, vx: (Math.random() - 0.5) * 22, vy: -Math.random() * 18 - 4, r: Math.random() * 7 + 4, c: cols[(Math.random() * 4) | 0], a: Math.random() * 6 }));
  let f = 0;
  (function tick() {
    x.clearRect(0, 0, c.width, c.height);
    P.forEach((p) => { p.vy += 0.45; p.x += p.vx; p.y += p.vy; p.a += 0.2; x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.fillStyle = p.c; x.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); x.restore(); });
    if (++f < 150) requestAnimationFrame(tick); else c.hidden = true;
  })();
}

// ---------- misc ----------

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3200);
}

// Keep the screen fresh: pick up Dad's Sheet edits, and roll over at midnight.
setInterval(async () => {
  if (!S.hub || S.demo || S.pending || Date.now() - S.lastTap < 8000 || document.hidden) return;
  const name = S.hub.player.name, dateBefore = S.hub.date, started = Date.now();
  const hub = await fetchHub(name);
  if (!canApply(name, hub, started)) return; // a tap landed while loading: keep the screen as is
  S.hub = hub;
  if (S.hub.date !== dateBefore) S.track = null;
  S.track = defaultTrack();
  if (overlayOpen()) return;
  render();
}, 60000);
addEventListener("resize", () => requestAnimationFrame(placeSparks));

// Pick up new versions of the site by itself (the kitchen screen never reloads):
// when app.js or hubdata.js changes on the server, reload once the screen has been idle a bit.
let codeTag = null;
async function checkForUpdate() {
  try {
    const tags = await Promise.all(["app.js", "hubdata.js"].map(async (f) => {
      const r = await fetch(`${f}?_t=${Date.now()}`, { method: "HEAD", cache: "no-store" });
      return r.headers.get("etag") || r.headers.get("last-modified");
    }));
    if (tags.some((t) => !t)) return;
    const tag = tags.join(" ");
    if (codeTag === null) { codeTag = tag; return; }
    const idle = Date.now() - S.lastTap > 120000 && !S.pending && $("#video-overlay").hidden && $("#boom-overlay").hidden;
    if (tag !== codeTag && idle) location.reload();
  } catch (e) {}
}
if (location.protocol.startsWith("http")) { checkForUpdate(); setInterval(checkForUpdate, 5 * 60000); }

// ---------- preview data (used only until the v2 Sheet tabs are installed) ----------

const DEMO = {
  players: [
    { name: "Nellie", tracks: TRACKS, visual: "Bomb", theme: "nellie" },
    { name: "Nash", tracks: TRACKS, visual: "Thermometer", theme: "nash" },
  ],
};
function demoHub(name) {
  const p = DEMO.players.find((x) => x.name === name) || DEMO.players[0];
  const I = (id, n, cat, sets, perSet, labels, pts, video, cue, extra = {}) => ({ id, name: n, category: cat, source: extra.source || "", sets, perSet, labels, pts, video, cue, result: extra.result || "", resultOf: extra.of || null });
  return {
    player: { ...p }, date: today(), weekStart: today(),
    tracks: {
      "Morning": { must: [I("G1", "Ball raises (slow, to set point)", "Garage / No Hoop", 2, "5 slow reps", [], 1, "https://youtu.be/0mdidcb1GxU", "Ball starts on your shooting side.", { source: "Dunn (garage version)" }),
                         I("G6", "Finish freeze", "Garage / No Hoop", 1, "3 slow reps", [], 1, "", "Hold a relaxed finish 2 seconds.")], options: [{ category: "Lifting", items: [I("S1", "Push-ups", "Lifting", 3, "10 reps", [], 1, "", "Straight line head to heels.")] }] },
      "After School": { must: [],
                        options: [{ category: "Love Shooting", items: [I("L2", "Isolation drill (one hand)", "Love Shooting", 4, "8 shots", ["Shots 1–8", "9–16", "17–24", "25–32"], 1, "", "Point your index finger at the back of the rim.", { source: "Dave Love" })] },
                                  { category: "Tests", items: [I("L7", "Free-throw test (20)", "Tests", 4, "5 FTs", ["FTs 1–5", "6–10", "11–15", "16–20"], 1, "", "Enter your makes.", { result: "Makes", of: 20 })] },
                                  { category: "Dribbling", items: [I("B1", "Stationary pound dribbles", "Dribbling", 4, "30 sec", ["Right hand", "Left hand", "Right low", "Left low"], 1, "", "Eyes up.")] }] },
      "Night": { must: [I("D1", "Ball Raises", "Dunn Shooting", 5, "10 reps", ["1–10", "11–20", "21–30", "31–40", "41–50"], 1, "https://youtu.be/0mdidcb1GxU", "Ball moves first.", { source: "Mike Dunn · Ground Up" }),
                        I("D2", "1-2-Thru", "Dunn Shooting", 5, "20 reps", ["1–20", "21–40", "41–60", "61–80", "81–100"], 1, "https://youtu.be/0t2i7OYeWKc", "Pass it to the basket.", { source: "Mike Dunn · Ground Up" })],
                 options: [{ category: "Agility & Quickness", items: [I("X32", "Jump Rope - Regular 2 feet", "Agility & Quickness", 2, "reps", [], 1, "https://youtu.be/XsllO1Z7ocQ", "")] },
                           { category: "Dribbling", items: [I("B1", "Stationary pound dribbles", "Dribbling", 4, "30 sec", ["Right hand", "Left hand", "Right low", "Left low"], 1, "", "Eyes up.")] },
                           { category: "Lifting", items: [I("S1", "Push-ups", "Lifting", 3, "10 reps", [], 1, "", "Straight line head to heels.")] }] },
    },
    done: {}, results: {}, history: {}, feedback: {},
    events: [{ day: "Today", time: "7:00 PM", title: "7G1 Practice", location: "MGCG Gym F" }, { day: "Tomorrow", time: "6:30 PM", title: "MBT Training Session", location: "6882 Nottingham Pkwy, Maple Grove, MN" }],
    points: { today: 0, week: 132, big: 410, lifetime: 410, byDay: {} },
    prizes: { weekly: { prize: "Weekly prize — you pick it!", target: 150, start: today() }, big: { prize: "Big prize — you pick it!", target: 1000, start: today() } },
  };
}

boot();
