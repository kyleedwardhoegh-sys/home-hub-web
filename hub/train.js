// Hoegh Home Hub v2, Phase 2b (2026-11-26): Training in the v2 look.
// Same plans and sets as the Training Hub (site_data plan:<Name> + set_log through HubData), so a set
// checked here shows on the old site, the kids' phones and the Stars app (training stars) and vice versa.
// Adds: games & tournaments coming up (from events:week), a 14-day stats chart and a workout timer.
// Opened from the dock's 🏀 Training icon, the Control Center, or /hub/?app=training&kid=Nash.
(function () {
  const KIDS = ["Nellie", "Nash"];
  const TRACKS = ["Morning", "After School", "Night"];
  const TRACK_ICON = { Morning: "☀️", "After School": "🏀", Night: "🌙" };
  const P = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parse = (s) => { const p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); };
  const add = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const today = () => ymd(new Date());
  const toast = (m, ms) => (window.hub && window.hub.toast ? window.hub.toast(m, ms) : null);
  const ytId = (u) => { const m = String(u || "").match(/youtu\.be\/([\w-]{6,})/) || String(u || "").match(/shorts\/([\w-]{6,})/) || String(u || "").match(/[?&]v=([\w-]{6,})/) || String(u || "").match(/embed\/([\w-]{6,})/); return m ? m[1] : null; };
  const GAME = /\b(game|games|tournament|tourney|vs\.?|match|scrimmage|jamboree|playoffs?|championship)\b|@/i;

  const S = { open: false, kid: KIDS.includes(P.get("kid")) ? P.get("kid") : (localStorage.getItem("hub.train.kid") || "Nellie"),
    track: null, hub: {}, loading: {}, more: {}, games: null, view: "today", lastTap: 0 };
  const defaultTrack = () => { const h = new Date().getHours(); return h < 12 ? "Morning" : h < 18 ? "After School" : "Night"; };

  // ---------- data ----------
  async function loadKid(kid) {
    if (!window.HubData || S.loading[kid]) return;
    S.loading[kid] = true;
    const started = Date.now();
    try {
      const h = await HubData.getHub(kid, today());
      // a tap during a slow load wins (same rule as the Training Hub's canApply)
      if (h && !h.error && S.lastTap < started) S.hub[kid] = h;
      else if (h && h.error && !S.hub[kid]) S.hub[kid] = { error: h.error };
    } finally { S.loading[kid] = false; }
    if (S.open) render();
  }
  async function loadGames() {
    if (!window.HubData) return;
    const d = await HubData.rows("site_data", "id=eq.events:week&select=data");
    const days = d && d[0] && d[0].data && d[0].data.days;
    if (!days) { S.games = []; return; }
    const t = today(), out = [];
    for (let i = 0; i < 14; i++) {
      const day = add(t, i);
      (days[day] || []).forEach((e) => { if (GAME.test(e.title || "")) out.push({ ...e, day }); });
    }
    S.games = out;
    if (S.open) render();
  }
  const gamesFor = (kid) => (S.games || []).filter((e) => !e.who || !e.who.length || e.who.includes(kid) || new RegExp(`\\b${kid}\\b`, "i").test(e.title));

  // ---------- sets ----------
  const H = () => S.hub[S.kid];
  const isDone = (track, id, s) => !!(H() && H().done[`${track}|${id}|${s}`]);
  const setsDone = (track, it) => { let n = 0; for (let s = 1; s <= it.sets; s++) if (isDone(track, it.id, s)) n++; return n; };
  const trackOf = (t) => (H() && H().tracks && H().tracks[t]) || null;
  const mustLeft = (t) => { const tr = trackOf(t); return tr ? tr.must.reduce((a, it) => a + it.sets - setsDone(t, it), 0) : 0; };
  function findItem(t, id) { const tr = trackOf(t); if (!tr) return null; return tr.must.concat(...tr.options.map((g) => g.items)).find((x) => String(x.id) === String(id)) || null; }

  function setSet(track, it, s, on) {
    const h = H(), k = `${track}|${it.id}|${s}`;
    if (!!h.done[k] === on) return;
    if (on) h.done[k] = true; else delete h.done[k];
    const d = on ? it.pts : -it.pts, p = h.points;
    p.today += d; p.week += d; p.lifetime += d;
    if (p.byDay) p.byDay[h.date] = (p.byDay[h.date] || 0) + d;
    if (h.prizes && h.prizes.big && h.date >= h.prizes.big.start) p.big += d;
    S.lastTap = Date.now();
    HubData.post({ action: "toggleSet", date: h.date, player: h.player.name, track, activity: it.id, set: s, done: on, pts: it.pts })
      .then((r) => { if (r && r.queued) toast("Saved on this screen. It will upload by itself"); else if (r && r.error) toast("Didn't save. Tap again"); });
  }
  let resT = null;
  function bumpResult(track, it, v) {
    const h = H(), k = `${track}|${it.id}`, max = it.resultOf || 999;
    h.results[k] = Math.max(0, Math.min(max, (h.results[k] ?? 0) + v));
    S.lastTap = Date.now(); render();
    clearTimeout(resT);
    resT = setTimeout(() => HubData.post({ action: "setResult", date: h.date, player: h.player.name, track, activity: it.id, result: h.results[k] }), 700);
  }

  // ---------- views ----------
  function ensureDom() {
    if ($("tx")) return;
    const v = document.createElement("section"); v.id = "tx"; v.hidden = true;
    v.innerHTML = `<div class="kx-wall"></div><div class="kx-in" id="tx-in"></div>`;
    document.body.appendChild(v);
    const sh = document.createElement("section"); sh.className = "sheet"; sh.id = "tx-sheet"; sh.hidden = true;
    sh.innerHTML = `<div class="sheet-card"><div class="grab"></div><div id="tx-sheet-body"></div></div>`;
    sh.addEventListener("click", (e) => { if (e.target === sh) closeSheet(); });
    document.body.appendChild(sh);
    v.addEventListener("click", onClick); sh.addEventListener("click", onClick);
  }
  function sheet(html) { $("tx-sheet-body").innerHTML = html; $("tx-sheet").hidden = false; }
  function closeSheet() { const s = $("tx-sheet"); if (s) { s.hidden = true; const f = s.querySelector("iframe"); if (f) f.remove(); } stopTimer(); }

  function render() {
    if (!$("tx")) return;
    $("tx").className = `kx tx k-${S.kid}`;
    const h = H();
    const head = `<header class="kx-head"><div class="kx-hello"><small>🏀</small><b>${S.kid}'s training</b><span>${new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span></div>
      ${h && h.points ? `<div class="kx-big sm"><div><b>${h.points.today}</b><small>today</small></div><div><b>${h.points.week}</b><small>this week</small></div></div>` : ""}</header>`;
    const kids = `<nav class="kx-tabs two tx-kids">${KIDS.map((k) => `<button class="kx-tab${k === S.kid ? " on" : ""}" data-kid="${k}"><i>${k === "Nellie" ? "Ne" : "Na"}</i>${k}</button>`).join("")}</nav>`;
    let body;
    if (!h || (h.error && !h.tracks)) body = `<div class="tx-wait">${h && h.error ? "Couldn't reach the training plan. Trying again…" : "Loading…"}</div>`;
    else body = gamesStrip() + tracksSeg() + `<div class="kx-scroll tx-list" id="tx-list">${trackBody()}</div>` + tools();
    $("tx-in").innerHTML = head + kids + body;
  }
  function gamesStrip() {
    const g = gamesFor(S.kid).slice(0, 3);
    if (!g.length) return "";
    const when = (e) => { const n = Math.round((parse(e.day) - parse(today())) / 864e5); return (n === 0 ? "Today" : n === 1 ? "Tomorrow" : parse(e.day).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })) + (e.time && !e.allDay ? ` · ${e.time}` : ""); };
    return `<div class="tx-games"><small>🏆 COMING UP</small>${g.map((e) => `<div class="tx-game"><b>${esc(e.title)}</b><span>${esc(when(e))}${e.location ? ` · ${esc(e.location)}` : ""}</span></div>`).join("")}</div>`;
  }
  function tracksSeg() {
    const have = TRACKS.filter((t) => trackOf(t));
    if (!have.includes(S.track)) S.track = have.includes(defaultTrack()) ? defaultTrack() : have[0];
    return `<nav class="tx-tracks">${have.map((t) => { const left = mustLeft(t);
      return `<button class="tx-track${t === S.track ? " on" : ""}" data-track="${esc(t)}"><span>${TRACK_ICON[t] || "🏋️"}</span><b>${esc(t)}</b><em${left ? "" : ' class="ok"'}>${left ? `${left} to do` : "✓"}</em></button>`; }).join("")}</nav>`;
  }
  function card(t, it) {
    const n = setsDone(t, it), full = n === it.sets, vid = ytId(it.video), res = H().results[`${t}|${it.id}`];
    const sets = Array.from({ length: it.sets }, (_, i) => { const s = i + 1, on = isDone(t, it.id, s), lab = (it.labels && it.labels[i]) || (it.sets > 1 ? `Set ${s}` : "Done");
      return `<button class="tx-set${on ? " on" : ""}" data-set="${s}" data-id="${esc(it.id)}"><i>${on ? "✓" : s}</i><span>${esc(lab)}</span></button>`; }).join("");
    return `<article class="tx-card${full ? " full" : ""}">
      <div class="tx-top">${vid ? `<button class="tx-thumb" data-video="${esc(it.video)}" aria-label="Watch ${esc(it.name)}"><img src="https://i.ytimg.com/vi/${esc(vid)}/mqdefault.jpg" alt=""><span>▶</span></button>` : ""}
        <div class="tx-name"><b>${esc(it.name)}</b><small>${it.perSet ? esc(it.perSet) + " · " : ""}${it.pts} per set · ${n}/${it.sets}</small>${it.cue ? `<p>${esc(it.cue)}</p>` : ""}</div></div>
      <div class="tx-sets">${sets}</div>
      ${it.result ? `<div class="tx-res"><span>${esc(it.result)}${it.resultOf ? ` of ${it.resultOf}` : ""}</span><button data-res="-1" data-id="${esc(it.id)}">−</button><output>${res ?? "–"}</output><button data-res="1" data-id="${esc(it.id)}">+</button></div>` : ""}
    </article>`;
  }
  function trackBody() {
    const t = S.track, tr = trackOf(t);
    if (!tr) return `<p class="kx-none">Nothing planned</p>`;
    let html = "";
    if (tr.must.length) html += `<h3>Must-dos</h3><div class="tx-cards">${tr.must.map((it) => card(t, it)).join("")}</div>`;
    const groups = tr.options.filter((g) => g.items.length);
    if (groups.length) {
      // groups with sets done today stay open; the rest wait behind a tap so the list stays short
      html += `<h3>Pick any</h3>` + groups.map((g, i) => { const key = `${t}|${i}`, started = g.items.some((it) => setsDone(t, it) > 0), openG = S.more[key] ?? started;
        const name = g.name || g.category || g.label || (g.items[0] && g.items[0].category) || "More";
        return `<button class="tx-group${openG ? " open" : ""}" data-group="${esc(key)}"><b>${esc(name)}</b><small>${g.items.length} drill${g.items.length > 1 ? "s" : ""}</small><i>${openG ? "▾" : "▸"}</i></button>${openG ? `<div class="tx-cards">${g.items.map((it) => card(t, it)).join("")}</div>` : ""}`; }).join("");
    }
    return html || `<p class="kx-none">Nothing planned</p>`;
  }
  const tools = () => `<div class="tx-tools"><button class="kx-say" data-act="timer"><span>⏱️</span><b>Workout timer</b></button><button class="kx-say" data-act="stats"><span>📈</span><b>My last 2 weeks</b></button></div>`;

  // ---------- stats: points per day, last 14 days (plain SVG bars) ----------
  function statsSheet() {
    const h = H(), by = (h.points && h.points.byDay) || {}, t = today();
    const days = Array.from({ length: 14 }, (_, i) => add(t, i - 13)), vals = days.map((d) => by[d] || 0), max = Math.max(10, ...vals);
    const W = 640, Hh = 260, bw = W / 14;
    const bars = days.map((d, i) => { const v = vals[i], bh = Math.round((v / max) * (Hh - 40));
      return `<rect x="${i * bw + 6}" y="${Hh - 22 - bh}" width="${bw - 12}" height="${Math.max(bh, 2)}" rx="8" class="${d === t ? "now" : ""}"></rect>
        ${v ? `<text x="${i * bw + bw / 2}" y="${Hh - 28 - bh}" class="v">${v}</text>` : ""}<text x="${i * bw + bw / 2}" y="${Hh - 4}" class="d">${"SMTWTFS"[parse(d).getDay()]}</text>`; }).join("");
    const active = vals.filter((v) => v > 0).length, total = vals.reduce((a, b) => a + b, 0);
    let streak = 0; for (let i = 13; i >= 0; i--) { if (vals[i] > 0) streak++; else if (i !== 13) break; }
    const prize = h.prizes && h.prizes.weekly;
    sheet(`<h2>📈 ${S.kid}'s last 2 weeks</h2>
      <div class="kx-stats"><div class="kx-stat"><b>${total}</b><small>points</small></div><div class="kx-stat"><b>${active}/14</b><small>days trained</small></div><div class="kx-stat"><b>🔥 ${streak}</b><small>days in a row</small></div></div>
      <svg class="tx-chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Points per day">${bars}</svg>
      ${prize ? `<p class="kx-fine">This week's prize: <b>${esc(prize.prize)}</b> at ${prize.target} points (${h.points.week} so far).</p>` : ""}
      <div class="sheet-row one"><button class="btn" data-act="close">Close</button></div>`);
  }

  // ---------- workout timer ----------
  const T = { left: 0, len: 0, rounds: 1, round: 0, rest: 0, resting: false, id: null };
  let actx = null;
  function beep(f = 880, ms = 180) { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = f; o.connect(g); g.connect(actx.destination); g.gain.setValueAtTime(.25, actx.currentTime); o.start(); o.stop(actx.currentTime + ms / 1000); } catch (e) {} }
  const PRESETS = [[30, 1, 0, "30 s"], [60, 1, 0, "1 min"], [120, 1, 0, "2 min"], [300, 1, 0, "5 min"], [30, 8, 15, "8 × 30 s (15 s rest)"], [45, 5, 15, "5 × 45 s (15 s rest)"]];
  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  function timerSheet() {
    sheet(`<h2>⏱️ Workout timer</h2><div class="tx-clock${T.resting ? " rest" : ""}" id="tx-clock"><b>${mmss(T.left || 0)}</b><small id="tx-clock-sub">${T.id ? (T.resting ? "Rest" : `Round ${T.round} of ${T.rounds}`) : "Pick one to start"}</small></div>
      <div class="chips tx-presets">${PRESETS.map((p, i) => `<button class="chip-btn" data-preset="${i}">${p[3]}</button>`).join("")}</div>
      <div class="sheet-row"><button class="btn" data-act="close">Close</button><button class="btn go" data-act="${T.id ? "stop" : "again"}">${T.id ? "Stop" : "Start again"}</button></div>`);
  }
  function drawClock() { const c = $("tx-clock"); if (!c) return; c.className = `tx-clock${T.resting ? " rest" : ""}${T.id ? " live" : ""}`; c.querySelector("b").textContent = mmss(T.left); $("tx-clock-sub").textContent = T.id ? (T.resting ? "Rest" : `Round ${T.round} of ${T.rounds}`) : T.round ? "Done! 🎉" : "Pick one to start"; }
  function startTimer(len, rounds, rest) {
    stopTimer(); Object.assign(T, { len, rounds, rest, round: 1, resting: false, left: len }); beep(660);
    T.id = setInterval(() => {
      T.left--;
      if (T.left <= 3 && T.left > 0) beep(520, 90);
      if (T.left <= 0) {
        if (!T.resting && T.round < T.rounds && T.rest) { T.resting = true; T.left = T.rest; beep(990, 300); }
        else if (T.round < T.rounds) { T.round++; T.resting = false; T.left = T.len; beep(660, 300); }
        else { stopTimer(); beep(1046, 600); T.left = 0; drawClock(); timerSheet(); toast("Timer done 🎉"); return; }
      }
      if (window.hub && window.hub.S) window.hub.S.last = Date.now(); // a running timer isn't "idle"
      drawClock();
    }, 1000);
    timerSheet();
  }
  function stopTimer() { if (T.id) { clearInterval(T.id); T.id = null; } }

  // ---------- taps ----------
  function celebrate(el) {
    const r = el.getBoundingClientRect(), f = document.createElement("div");
    f.className = "kx-float"; f.textContent = "✓"; f.style.left = r.left + r.width / 2 + "px"; f.style.top = r.top + "px";
    document.body.appendChild(f); setTimeout(() => f.remove(), 1300);
  }
  function onClick(e) {
    const b = e.target.closest("button"); if (!b) return;
    const d = b.dataset;
    if (d.kid) { S.kid = d.kid; try { localStorage.setItem("hub.train.kid", d.kid); } catch (x) {} if (!S.hub[d.kid] || S.hub[d.kid].date !== today()) loadKid(d.kid); render(); return; }
    if (d.track) { S.track = d.track; render(); const l = $("tx-list"); if (l) l.scrollTop = 0; return; }
    if (d.group) { const k = d.group, tr = trackOf(S.track), g = tr && tr.options.filter((x) => x.items.length)[+k.split("|")[1]]; const started = g && g.items.some((it) => setsDone(S.track, it) > 0);
      S.more[k] = !(S.more[k] ?? started); keepScroll(render); return; }
    if (d.set) { const it = findItem(S.track, d.id); if (!it) return; const s = +d.set, on = !isDone(S.track, it.id, s); setSet(S.track, it, s, on);
      if (on) { celebrate(b); if (setsDone(S.track, it) === it.sets) toast(`${it.name}: all sets done 💪`); } keepScroll(render); return; }
    if (d.res) { const it = findItem(S.track, d.id); if (it) keepScroll(() => bumpResult(S.track, it, +d.res)); return; }
    if (d.video) { const id = ytId(d.video); if (!id) { window.open(d.video, "_blank", "noopener"); return; }
      const t = (d.video.match(/[?&]t=(\d+)/) || [])[1];
      sheet(`<div class="tx-video"><iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1${t ? `&start=${t}` : ""}" allow="autoplay; encrypted-media" allowfullscreen></iframe></div><div class="sheet-row one"><button class="btn" data-act="close">Close video</button></div>`); return; }
    if (d.preset) { const p = PRESETS[+d.preset]; startTimer(p[0], p[1], p[2]); return; }
    switch (d.act) {
      case "close": closeSheet(); break;
      case "timer": timerSheet(); break;
      case "stats": statsSheet(); break;
      case "stop": stopTimer(); T.round = 0; T.left = 0; timerSheet(); break;
      case "again": if (T.len) startTimer(T.len, T.rounds, T.rest); break;
    }
  }
  function keepScroll(fn) { const l = $("tx-list"), y = l ? l.scrollTop : 0; fn(); const n = $("tx-list"); if (n) n.scrollTop = y; }

  // ---------- open / close (dock, Control Center, home bar and the 3-min idle reset) ----------
  function open(kid) {
    ensureDom(); if (KIDS.includes(kid)) S.kid = kid;
    S.open = true; S.track = null; $("tx").hidden = false; render();
    loadKid(S.kid); KIDS.filter((k) => k !== S.kid).forEach(loadKid);
    if (!S.games) loadGames();
  }
  function close() { S.open = false; if ($("tx")) $("tx").hidden = true; closeSheet(); }
  window.HubApps = Object.assign(window.HubApps || {}, { training: { open, close, isOpen: () => S.open } });
  window.hubTrain = { S, open, close, loadKid, gamesFor };

  // keep fresh while open (other screens and phones check sets too); new day resets
  setInterval(() => { if (S.open && Date.now() - S.lastTap > 20000 && $("tx-sheet").hidden) loadKid(S.kid); }, 60000);
  setInterval(loadGames, 15 * 60 * 1000);
  if (P.get("app") === "training") setTimeout(() => open(P.get("kid")), 0);
})();
