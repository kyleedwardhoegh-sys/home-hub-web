// Hoegh Home Hub v2 — Phase 2 (2026-11-25): the kids' engine.
// Stars for chores, training and homework; reward shop (kids wish, parents price + hand out);
// streaks (every chore done that day) with trip mode (chores pause, streak is safe);
// picture-tile chore chart with confetti; screen time as a reward; say "I'm done with dishes".
// Plan: G:\My Drive\00Home Hub\Hub v2\Implementation Plan (from family ratings).md (Phase 2, steps 4-5).
// Data: Supabase tables `stars` (ledger) + `kid_setup` (chores, rewards, trips) from supabase/kids.sql.
// Every change goes through a device outbox, so taps are never lost if the database is
// unreachable or the tables don't exist yet; they upload by themselves later.
(function () {
  const KIDS = ["Nellie", "Nash"];
  const P = new URLSearchParams(location.search);
  const KIOSK = P.has("kiosk");
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parse = (s) => { const p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); };
  const add = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const today = () => ymd(new Date());
  const monday = (s) => add(s, -((parse(s).getDay() + 6) % 7));
  const toast = (m, ms) => (window.hub && window.hub.toast ? window.hub.toast(m, ms) : null);

  // Starter setup (Kyle/Logan change it on the Mom & Dad tab; the kids add their own wishes).
  const SCHOOL_NIGHTS = [0, 1, 2, 3, 4];
  const DEFAULTS = [
    ["chore:bed", "chore", "Both", "Make your bed", "🛏️", 1, { when: "morning" }, 1],
    ["chore:dishes", "chore", "Both", "Dishes to the dishwasher", "🍽️", 1, { when: "evening" }, 2],
    ["chore:room", "chore", "Both", "Tidy your room", "🧹", 2, { when: "afternoon" }, 3],
    ["chore:laundry", "chore", "Both", "Put laundry away", "👕", 2, { when: "afternoon" }, 4],
    ["chore:backpack", "chore", "Both", "Backpack ready", "🎒", 1, { days: SCHOOL_NIGHTS, when: "evening" }, 5],
    ["chore:homework", "chore", "Both", "Homework done", "📚", 2, { days: SCHOOL_NIGHTS, when: "afternoon" }, 6],
    // Kyle's first pass (2026-11-27): shower separate from teeth; devices = phone, iPad and Chromebook; read 20 min
    ["chore:read", "chore", "Both", "Read 20 minutes", "📖", 2, { when: "afternoon" }, 7],
    ["chore:shower", "chore", "Both", "Shower", "🚿", 1, { when: "evening" }, 8],
    ["chore:teeth", "chore", "Both", "Brush teeth", "🦷", 1, { when: "evening" }, 9],
    ["chore:charger", "chore", "Both", "Phone, iPad & Chromebook on the kitchen charger", "🔌", 1, { when: "evening" }, 10],
    // Kyle 2026-11-27: cash 10 stars = $1 (always an option); prizes 10 stars = $2 worth (a better deal than cash); screen time 10 stars an hour; sleepover 200, once per 2 months.
    // Rated 1-4 and dropped: stay up late, pick dinner, front seat.
    ["reward:screen30", "reward", "Both", "30 min screen time", "📱", 5, { minutes: 30 }, 1],
    ["reward:screen60", "reward", "Both", "1 hour screen time", "🎮", 10, { minutes: 60 }, 2],
    ["reward:cash1", "reward", "Both", "$1 cash", "💵", 10, null, 3],
    ["reward:skip", "reward", "Both", "Skip-a-chore pass", "🎟️", 15, null, 4],
    ["reward:cash5", "reward", "Both", "$5 cash", "💵", 50, null, 5],
    ["reward:icecream", "reward", "Both", "Ice cream trip", "🍦", 25, null, 6],
    ["reward:starbucks", "reward", "Both", "Starbucks trip", "☕", 30, null, 7],
    ["reward:cash10", "reward", "Both", "$10 cash", "💵", 100, null, 8],
    ["reward:sleepover", "reward", "Both", "Friend over or sleepover", "🏠", 200, { capDays: 60 }, 9],
  ].map(([id, kind, kid, title, emoji, stars, data, sort]) => ({ id, kind, kid, title, emoji, stars, data, removed: false, sort }));
  const WHEN = [["morning", "☀️ Morning"], ["afternoon", "🎒 After school"], ["evening", "🌙 Evening"]];
  const DEFAULT_WHEN = Object.fromEntries(DEFAULTS.filter((r) => r.data && r.data.when).map((r) => [r.id, r.data.when]));
  const whenOf = (c) => (c.data && c.data.when) || DEFAULT_WHEN[c.id] || "afternoon";
  const ALLDONE_BONUS = 2;          // extra stars when every chore that day is done
  const TRAIN_PTS_PER_STAR = 5;     // Training Hub achievement points per star
  const TRAIN_MAX = 6;              // most training stars in one day
  const PRICES = [5, 10, 15, 25, 50, 60, 100, 150, 200, 300];
  const CHORE_STARS = [1, 2, 3, 5, 10, 20, 30];   // Kyle 2026-11-27: wide range, up to ~30 for huge jobs
  const BONUS = [-1, 1, 3, 5, 10, 20, 30];
  const EMOJIS = ["🛏️", "🍽️", "🧹", "👕", "🎒", "📚", "🗑️", "🐶", "🧺", "🚿", "🦷", "🥗", "🧽", "🪴", "🚗", "🎹", "📖", "🏀", "🏐", "🏈", "⚾", "🎣", "💖", "⭐"];

  // ---------- store: server rows + this device's outbox ----------
  const COLS = { stars: ["id", "kid", "day", "kind", "item", "title", "stars", "status", "note"], kid_setup: ["id", "kind", "kid", "title", "emoji", "stars", "data", "removed", "sort"] };
  const norm = (table, r) => Object.fromEntries(COLS[table].map((k) => [k, r[k] === undefined ? (k === "removed" ? false : k === "sort" ? 0 : k === "status" ? "ok" : k === "stars" && table === "stars" ? 0 : null) : r[k]]));
  const OUT = "hub.kids.outbox";
  let outbox = (() => { try { return JSON.parse(localStorage.getItem(OUT)) || []; } catch (e) { return []; } })();
  const saveOut = () => { try { localStorage.setItem(OUT, JSON.stringify(outbox)); } catch (e) {} };
  const S = { kid: KIDS.includes(P.get("kid")) ? P.get("kid") : (localStorage.getItem("hub.kids.kid") || "Nellie"), parents: false,
    server: { stars: [], kid_setup: [] }, totals: null, db: null, loaded: false, open: false, train: {} };

  function list(table) {
    const m = new Map(S.server[table].map((r) => [r.id, r]));
    outbox.filter((e) => e.t === table).forEach((e) => m.set(e.r.id, e.r));
    return [...m.values()];
  }
  function put(table, row) {
    row = norm(table, row);
    outbox = outbox.filter((e) => !(e.t === table && e.r.id === row.id));
    outbox.push({ t: table, r: row }); saveOut();
    flush();
    return row;
  }
  let flushing = false;
  async function flush() {
    if (flushing || !outbox.length || !window.HubData) return;
    flushing = true;
    try {
      let rounds = 0;
      while (outbox.length && rounds++ < 10) { const before = outbox.length;
      for (const table of Object.keys(COLS)) {
        const sent = outbox.filter((e) => e.t === table);
        if (!sent.length) continue;
        if (!(await HubData.save(table, sent.map((e) => e.r)))) break;
        S.db = true;
        sent.forEach((e) => {
          const i = S.server[table].findIndex((r) => r.id === e.r.id), old = i >= 0 ? S.server[table][i] : null;
          if (table === "stars" && S.totals) { const t = (S.totals[e.r.kid] ||= { kid: e.r.kid, balance: 0, earned: 0 }); t.balance += eff(e.r) - (old ? eff(old) : 0); }
          if (i >= 0) S.server[table][i] = e.r; else S.server[table].push(e.r);
        });
        outbox = outbox.filter((e) => !sent.includes(e)); saveOut();
      }
      if (outbox.length >= before) break; } // no progress (offline): the 20 s timer tries again
    } finally { flushing = false; }
  }
  setInterval(flush, 20000);

  async function load() {
    if (!window.HubData) return;
    const since = add(today(), -70);
    const [setup, log, totals] = await Promise.all([
      HubData.rows("kid_setup", "select=*"),
      HubData.rows("stars", `day=gte.${since}&select=*&order=day.asc&limit=5000`),
      HubData.rows("star_totals", "select=*"),
    ]);
    S.db = !!(setup && log);
    if (setup) S.server.kid_setup = setup;
    if (log) S.server.stars = log;
    S.totals = totals ? Object.fromEntries(totals.map((t) => [t.kid, t])) : null;
    if (setup && !setup.some((r) => r.id === "meta:seeded")) {
      const have = new Set(setup.map((r) => r.id).concat(outbox.map((e) => e.r.id)));
      DEFAULTS.filter((r) => !have.has(r.id)).forEach((r) => put("kid_setup", r));
      put("kid_setup", { id: "meta:seeded", kind: "meta", kid: "Both", title: "Starters added", emoji: null, stars: null, data: { on: today() }, removed: false, sort: 0 });
    }
    S.loaded = true;
    await loadTraining();
    flush();
    refresh();
  }

  // ---------- rules ----------
  const eff = (r) => (["ok", "owed", "given"].includes(r.status) ? Number(r.stars) || 0 : 0);
  // until the table has rows (or exists), the starters sit underneath this device's changes
  const setup = () => {
    const srv = S.server.kid_setup, m = new Map((srv.some((r) => r.id === "meta:seeded") ? srv : DEFAULTS.concat(srv)).map((r) => [r.id, r]));
    outbox.filter((e) => e.t === "kid_setup").forEach((e) => m.set(e.r.id, e.r));
    return [...m.values()];
  };
  const forKid = (r, kid) => !r.removed && (r.kid === "Both" || r.kid === kid);
  const chores = (kid, day) => setup().filter((r) => r.kind === "chore" && forKid(r, kid) && (!r.data || !r.data.days || r.data.days.includes(parse(day).getDay()))).sort((a, b) => a.sort - b.sort);
  const rewards = (kid) => setup().filter((r) => r.kind === "reward" && forKid(r, kid)).sort((a, b) => (a.stars ?? 1e9) - (b.stars ?? 1e9) || a.sort - b.sort);
  const trips = () => setup().filter((r) => r.kind === "trip" && !r.removed);
  const onTrip = (day) => trips().some((t) => t.data && t.data.from <= day && (!t.data.to || day <= t.data.to));
  const tripNow = () => trips().find((t) => t.data && !t.data.to);
  const log = () => list("stars");
  const row = (id) => log().find((r) => r.id === id);
  const choreId = (day, kid, c) => `${day}|${kid}|chore|${c.id}`;
  const isDone = (day, kid, c) => { const r = row(choreId(day, kid, c)); return !!(r && r.status === "ok"); };
  function balance(kid) {
    const mine = log().filter((r) => r.kid === kid);
    if (!S.totals) return mine.reduce((s, r) => s + eff(r), 0);
    // server total + whatever this device hasn't uploaded yet
    let b = (S.totals[kid] && S.totals[kid].balance) || 0;
    outbox.filter((e) => e.t === "stars" && e.r.kid === kid).forEach((e) => { const srv = S.server.stars.find((r) => r.id === e.r.id); b += eff(e.r) - (srv ? eff(srv) : 0); });
    return b;
  }
  const todayStars = (kid) => log().filter((r) => r.kid === kid && r.day === today() && r.stars > 0).reduce((s, r) => s + eff(r), 0);
  function streak(kid) {
    let n = 0, d = today();
    const complete = (day) => { const r = row(`${day}|${kid}|alldone`); return !!(r && r.status === "ok"); };
    if (complete(d)) n++;
    for (let k = 1; k < 70; k++) {
      d = add(today(), -k);
      if (onTrip(d) || !chores(kid, d).length) continue; // trips and empty days don't break it
      if (complete(d)) n++; else break;
    }
    return n;
  }
  const owedMinutes = (kid) => log().filter((r) => r.kid === kid && r.kind === "spend" && r.status === "owed").reduce((s, r) => { const rw = setup().find((x) => x.id === r.item); return s + ((rw && rw.data && rw.data.minutes) || 0); }, 0);

  // ---------- check-in wheel, scratch-off, 2× boosts, levels (Kyle's first pass, 2026-11-27) ----------
  // Morning: tap "Check in" → recap (week stars, streaks, today, coming up) → spin. The wheel makes 2 of today's
  // open chores 2× (or a rare slice). After school: one scratch-off that doubles a chore worth more than 1 star.
  // Rows live in the same `stars` ledger: checkin / scratch rows (0 stars, the prize in `note`) and one `boost` row
  // per doubled chore that gets checked off (the extra stars; undone if the chore is unchecked).
  const FORCE = P.get("checkin") === "any";   // testing: windows always open
  const mins = (d) => d.getHours() * 60 + d.getMinutes();
  const schoolDay = (d) => d.getDay() >= 1 && d.getDay() <= 5;
  const morningOpen = () => { const d = new Date(); return FORCE || mins(d) < (schoolDay(d) ? 8 * 60 + 30 : 10 * 60); };
  const afterOpen = () => { const d = new Date(); return FORCE || (schoolDay(d) && mins(d) >= 14 * 60 + 45 && mins(d) < 19 * 60); };
  const note = (r) => { try { return r && r.note ? JSON.parse(r.note) : {}; } catch (e) { return {}; } };
  const checkinRow = (kid, day = today()) => { const r = row(`${day}|${kid}|checkin`); return r && r.status === "ok" ? r : null; };
  const scratchRow = (kid, day = today()) => { const r = row(`${day}|${kid}|scratch`); return r && r.status === "ok" ? r : null; };
  function boosted(kid, day = today()) {
    const s = new Set(), ci = note(checkinRow(kid, day)), sc = note(scratchRow(kid, day));
    if (ci.all) chores(kid, day).forEach((c) => s.add(c.id));
    (ci.items || []).forEach((id) => s.add(id));
    if (sc.item) s.add(sc.item);
    return s;
  }
  function checkinStreak(kid) {
    let n = checkinRow(kid) ? 1 : 0;
    for (let k = 1; k < 70; k++) { const d = add(today(), -k); if (onTrip(d)) continue; if (checkinRow(kid, d)) n++; else break; }
    return n;
  }
  const LEVELS = [[0, "🥉", "Bronze"], [100, "🥈", "Silver"], [300, "🥇", "Gold"], [700, "💎", "Diamond"]];
  function level(kid) {
    const earned = S.totals && S.totals[kid] ? S.totals[kid].earned || 0 : log().filter((r) => r.kid === kid && r.stars > 0).reduce((s, r) => s + eff(r), 0);
    let i = 0; while (i + 1 < LEVELS.length && earned >= LEVELS[i + 1][0]) i++;
    const next = LEVELS[i + 1];
    return { icon: LEVELS[i][1], name: LEVELS[i][2], toNext: next ? next[0] - earned : 0, next: next ? next[2] : null };
  }
  const weekStars = (kid) => log().filter((r) => r.kid === kid && r.day >= monday(today()) && r.stars > 0).reduce((s, r) => s + eff(r), 0);
  // wheel slices: [id, label, odds %, color]. Odds are printed under the wheel so it feels fair.
  const SLICES = [["two", "2× two chores", 75, "#2f8fdc"], ["mystery", "Mystery box", 10, "#bf5af2"], ["pick", "Pick your own 2×", 10, "#34c759"], ["golden", "GOLDEN: all 2×", 5, "#ffd60a"]];
  function spinOutcome(kid) {
    const open = chores(kid, today()).filter((c) => !isDone(today(), kid, c));
    let x = Math.random() * 100, slice = SLICES[0];
    for (const s of SLICES) { if (x < s[2]) { slice = s; break; } x -= s[2]; }
    if (!open.length && slice[0] !== "mystery") slice = SLICES[1];   // nothing left to double: give the mystery box
    const out = { slice: slice[0] };
    if (slice[0] === "two") out.items = open.slice().sort(() => Math.random() - 0.5).slice(0, 2).map((c) => c.id);
    if (slice[0] === "golden") out.all = true;
    if (slice[0] === "mystery") out.stars = 3 + Math.floor(Math.random() * 6);   // 3-8
    return out;
  }
  function scratchPrize(kid) {
    const open = chores(kid, today()).filter((c) => !isDone(today(), kid, c) && c.stars > 1);   // Kyle: only chores worth > 1 star
    if (!open.length || Math.random() < 0.15) return { stars: 2 + Math.floor(Math.random() * 3) };   // instant 2-4
    return { item: open[Math.floor(Math.random() * open.length)].id };
  }
  function payBoost(kid, c, on) {
    const id = `${today()}|${kid}|boost|${c.id}`, cur = row(id);
    if (on) put("stars", { id, kid, day: today(), kind: "boost", item: c.id, title: `2× ${c.title}`, stars: c.stars, status: "ok" });
    else if (cur && cur.status === "ok") put("stars", { ...cur, status: "undone" });
  }
  function capInfo(rw, kid) {
    const cap = rw.data && rw.data.capDays; if (!cap) return null;
    const last = log().filter((r) => r.kid === kid && r.kind === "spend" && r.item === rw.id && r.status !== "cancelled").sort((a, b) => (a.day < b.day ? 1 : -1))[0];
    if (!last) return null;
    const next = add(last.day, cap);
    return next > today() ? next : null;
  }

  // Training Hub sets → stars (one row per kid per day, recomputed from the Training Hub's set_log)
  async function loadTraining() {
    const t = today();
    const sets = await HubData.rows("set_log", `day=eq.${t}&done=eq.true&set_no=gt.0&select=player,points`);
    if (!sets) return;
    for (const kid of KIDS) {
      const pts = sets.filter((s) => s.player === kid).reduce((s, x) => s + (Number(x.points) || 0), 0);
      const n = Math.min(TRAIN_MAX, Math.floor(pts / TRAIN_PTS_PER_STAR));
      S.train[kid] = { pts, n };
      const id = `${t}|${kid}|training`, cur = row(id);
      if ((cur ? cur.stars : 0) !== n && (n > 0 || cur)) put("stars", { id, kid, day: t, kind: "training", item: "training", title: "Training", stars: n, status: "ok" });
    }
  }

  // ---------- actions ----------
  function toggleChore(c, kid = S.kid, from) {
    const t = today(), id = choreId(t, kid, c); S.kid = kid; // confetti in that kid's colors
    if (onTrip(t)) return toast("✈️ Trip mode: chores are paused");
    if (isDone(t, kid, c)) {
      put("stars", { id, kid, day: t, kind: "chore", item: c.id, title: c.title, stars: c.stars, status: "undone" });
      payBoost(kid, c, false);
      const ad = row(`${t}|${kid}|alldone`); if (ad && ad.status === "ok") put("stars", { ...ad, status: "undone" });
      toast(`Unchecked ${c.title}`); refresh(); return;
    }
    put("stars", { id, kid, day: t, kind: "chore", item: c.id, title: c.title, stars: c.stars, status: "ok" });
    const dbl = boosted(kid).has(c.id), got = dbl ? c.stars * 2 : c.stars;
    if (dbl) payBoost(kid, c, true);
    const all = chores(kid, t).every((x) => isDone(t, kid, x));
    if (all) {
      put("stars", { id: `${t}|${kid}|alldone`, kid, day: t, kind: "alldone", item: "alldone", title: "Every chore done", stars: ALLDONE_BONUS, status: "ok" });
      celebrate(from, `+${got + ALLDONE_BONUS}⭐`, true);
      toast(`🎉 All done, ${kid}! +${ALLDONE_BONUS} bonus · 🔥 ${streak(kid)} day streak`, 3500);
    } else celebrate(from, dbl ? `2× +${got}⭐` : `+${got}⭐`, dbl);
    refresh();
  }
  function buy(rw, kid = S.kid) {
    put("stars", { id: `spend|${kid}|${Date.now()}`, kid, day: today(), kind: "spend", item: rw.id, title: rw.title, stars: -rw.stars, status: "owed" });
    celebrate(null, `${rw.emoji || "🎁"}`, true);
    toast(`${rw.emoji || "🎁"} ${rw.title}! Mom or Dad will hand it out`, 3500);
    closeSheet(); refresh();
  }
  function wish(title, kid = S.kid) {
    title = title.trim(); if (!title) return;
    put("kid_setup", { id: `reward:${kid}:${Date.now()}`, kind: "reward", kid, title: title[0].toUpperCase() + title.slice(1), emoji: guessEmoji(title), stars: null, data: { by: kid }, removed: false, sort: 99 });
    toast("🌠 Wish sent! Mom or Dad will set the price", 3000); refresh();
  }
  function guessEmoji(t) {
    const m = [[/screen|ipad|phone|tv|show/i, "📱"], [/game|xbox|switch|fortnite|roblox/i, "🎮"], [/ice cream|dessert|candy|treat/i, "🍦"], [/skin|lotion|serum|makeup|lip/i, "🧴"], [/squish/i, "🧸"],
      [/shoe|nike|jordan/i, "👟"], [/fish|lure|rod|bait/i, "🎣"], [/ball|basketball/i, "🏀"], [/volleyball/i, "🏐"], [/football/i, "🏈"], [/starbucks|coffee|drink/i, "🥤"], [/movie/i, "🍿"],
      [/money|\$|cash|dollar/i, "💵"], [/friend|sleepover/i, "🏠"], [/book/i, "📖"], [/pizza|dinner|restaurant/i, "🍕"]];
    const hit = m.find(([re]) => re.test(t)); return hit ? hit[1] : "🎁";
  }

  // ---------- celebrate: confetti + floating stars + a little ding ----------
  let actx = null;
  function ding(big) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const notes = big ? [784, 988, 1175, 1568] : [880, 1320];
      notes.forEach((f, k) => { const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + k * 0.09;
        o.type = "triangle"; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
        o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + 0.4); });
    } catch (e) {}
  }
  function celebrate(el, text, big) {
    ding(big);
    const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2 - 40, top: innerHeight / 2 - 40, width: 80, height: 80 };
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const f = document.createElement("div"); f.className = "kx-float"; f.textContent = text; f.style.left = cx + "px"; f.style.top = cy + "px"; document.body.appendChild(f);
    setTimeout(() => f.remove(), 1400);
    const colors = S.kid === "Nash" ? ["#2f8fdc", "#7fd1ff", "#ffd60a", "#ffffff", "#34c759"] : ["#e64f8f", "#ff9ccc", "#ffd60a", "#ffffff", "#bf5af2"];
    const n = big ? 90 : 26;
    for (let k = 0; k < n; k++) {
      const c = document.createElement("i"); c.className = "kx-conf";
      const a = Math.random() * Math.PI * 2, d = (big ? 260 : 130) * (0.4 + Math.random());
      c.style.cssText = `left:${big ? innerWidth / 2 : cx}px;top:${big ? innerHeight * 0.45 : cy}px;background:${colors[k % colors.length]};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 60}px;--r:${Math.random() * 720 - 360}deg;animation-delay:${Math.random() * 0.08}s`;
      document.body.appendChild(c); setTimeout(() => c.remove(), 1500);
    }
  }

  // ---------- "I'm done with the dishes" ----------
  const STOP = new Set(["the", "a", "an", "my", "your", "to", "with", "and", "i", "im", "i'm", "am", "done", "finished", "did", "all", "put", "away", "get", "got", "ready", "of", "is", "it"]);
  const SYN = { dishes: ["dish", "dishes", "plate", "plates", "dishwasher", "dish washer"], bed: ["bed"], room: ["room", "tidy", "cleaned", "clean"], laundry: ["laundry", "clothes"],
    backpack: ["backpack", "back pack", "bag"], homework: ["homework", "home work", "math", "reading", "worksheet"], trash: ["trash", "garbage", "recycling"], dog: ["dog", "feed"] };
  function matchChore(text, kid) {
    const t = " " + text.toLowerCase().replace(/[^a-z' ]/g, " ") + " ";
    let best = null, score = 0;
    for (const c of chores(kid, today())) {
      const words = c.title.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
      let s = words.filter((w) => t.includes(" " + w.slice(0, Math.max(4, w.length - 2)))).length;
      for (const syns of Object.values(SYN)) if (syns.some((w) => c.title.toLowerCase().includes(w)) && syns.some((w) => t.includes(" " + w))) s += 2;
      if (s > score) { score = s; best = c; }
    }
    return best;
  }
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  function listen(onText, btn) {
    if (!Speech) return toast("Voice isn't available on this device");
    if (rec) { try { rec.stop(); } catch (e) {} return; }
    rec = new Speech(); rec.lang = "en-US"; rec.interimResults = true;
    btn && btn.classList.add("live");
    let fin = "";
    rec.onresult = (e) => { let inter = ""; for (let k = e.resultIndex; k < e.results.length; k++) { if (e.results[k].isFinal) fin += e.results[k][0].transcript; else inter += e.results[k][0].transcript; } if (btn) btn.querySelector("b").textContent = `“${fin + inter}”`; };
    rec.onerror = (e) => toast(e.error === "not-allowed" ? "Microphone is blocked" : e.error === "no-speech" ? "Didn't hear anything" : "Mic problem: " + e.error);
    rec.onend = () => { rec = null; btn && btn.classList.remove("live"); if (fin) onText(fin); else refresh(); };
    try { rec.start(); } catch (e) { rec = null; }
  }
  // "Nash is done with the dishes": a name picks the kid; with no name, it's whoever still has that chore open
  function heardDone(text) {
    const lower = text.toLowerCase(), t = today();
    const named = KIDS.find((k) => lower.includes(k.toLowerCase()));
    const found = (named ? [named] : KIDS).map((k) => ({ k, c: matchChore(text, k) })).filter((x) => x.c);
    if (!found.length) { toast(`Heard “${text}”. Tap the chore you finished`, 3500); refresh(); return; }
    const open = found.filter((x) => !isDone(t, x.k, x.c));
    if (!open.length) { toast(`${found[0].c.emoji || "✅"} ${found[0].c.title} is already checked ✓`); refresh(); return; }
    if (!named && open.length > 1) { toast(`Who finished ${open[0].c.title.toLowerCase()}? Say your name, like “Nash is done with…”`, 4000); refresh(); return; }
    toggleChore(open[0].c, open[0].k, document.querySelector(`[data-chore="${open[0].c.id}"][data-k="${open[0].k}"]`));
  }
  // ---------- views ----------
  function ensureDom() {
    if ($("kx")) return;
    const v = document.createElement("section"); v.id = "kx"; v.className = "kx"; v.hidden = true;
    v.innerHTML = `<div class="kx-wall"></div><div class="kx-in" id="kx-in"></div>`;
    document.body.appendChild(v);
    const sh = document.createElement("section"); sh.className = "sheet"; sh.id = "kx-sheet"; sh.hidden = true;
    sh.innerHTML = `<div class="sheet-card"><div class="grab"></div><div id="kx-sheet-body"></div></div>`;
    sh.addEventListener("click", (e) => { if (e.target === sh) closeSheet(); });
    document.body.appendChild(sh);
    v.addEventListener("click", onClick); sh.addEventListener("click", onClick);
  }
  function setKid(k) { S.kid = k; S.parents = false; try { localStorage.setItem("hub.kids.kid", k); } catch (e) {} }
  function refresh() { if (S.open) render(); if (window.hub && window.hub.renderPeople) window.hub.renderPeople(); }
  function sheet(html) { $("kx-sheet-body").innerHTML = html; $("kx-sheet").hidden = false; }
  function closeSheet() { if ($("kx-sheet")) $("kx-sheet").hidden = true; }

  function tabs() {
    return `<nav class="kx-tabs two"><button class="kx-tab${!S.parents ? " on" : ""}" data-act="board"><i>✅</i>Chores</button>
      <button class="kx-tab k-parents${S.parents ? " on" : ""}" data-act="parents"><i>👪</i>Mom & Dad${pendingCount() ? `<em class="kx-red">${pendingCount()}</em>` : ""}</button></nav>`;
  }
  function render() {
    const v = $("kx"); v.className = `kx ${S.parents ? "k-parents" : "k-board"}`;
    $("kx-in").innerHTML = S.parents ? renderParents() : renderBoard();
  }
  // Skylight-style chore chart: a column per kid (their color on top), Morning / After school / Evening sections,
  // a check circle per chore. Both kids can check off at the same time; nobody switches screens.
  function renderBoard() {
    const t = today(), trip = onTrip(t);
    return `<header class="kx-head"><div class="kx-hello"><small>✅ ⭐</small><b>Chores</b><span>${trip ? "✈️ Trip mode: chores paused, streaks are safe" : new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</span></div></header>
      ${tabs()}
      <div class="kx-board${trip ? " paused" : ""}">${KIDS.map(kidCol).join("")}</div>
      ${Speech ? `<div class="kx-bar one"><button class="kx-say" data-act="say"><span>🎤</span><b>Say “Nash is done with the dishes”</b></button></div>` : ""}`;
  }
  function kidCol(k) {
    const t = today(), trip = onTrip(t), list = chores(k, t), done = list.filter((c) => isDone(t, k, c)).length, tr = S.train[k] || { pts: 0, n: 0 }, mins = owedMinutes(k);
    const dbl = boosted(k, t), lv = level(k), ci = checkinRow(k), sc = scratchRow(k);
    const rowHtml = (c) => { const on = isDone(t, k, c), x2 = dbl.has(c.id);
      return `<button class="kx-row${on ? " done" : ""}${x2 ? " x2" : ""}" data-chore="${esc(c.id)}" data-k="${k}"><span>${esc(c.emoji || "✅")}</span><b>${esc(c.title)}<small>${x2 ? `<em class="kx-2x">2×</em> +${c.stars * 2} ⭐` : `+${c.stars} ⭐`}</small></b><i class="kx-check">${on ? "✓" : ""}</i></button>`; };
    const ciBtn = trip ? "" : !ci && morningOpen() ? `<button class="kx-ci" data-ci="${k}"><span>☀️</span>Check in &amp; spin</button>`
      : !sc && afterOpen() ? `<button class="kx-ci sc" data-sc="${k}"><span>🎟️</span>After-school scratch-off</button>` : "";
    const secs = WHEN.map(([w, label]) => { const cs = list.filter((c) => whenOf(c) === w); return cs.length ? `<h4>${label}</h4>${cs.map(rowHtml).join("")}` : ""; }).join("");
    return `<section class="kx-col k-${k}">
      <header class="kx-colhead"><i>${k === "Nellie" ? "Ne" : "Na"}</i><div><b>${k}</b><small>⭐ ${balance(k)} · 🔥 ${streak(k)}${ci ? ` · ☀️ ${checkinStreak(k)}` : ""}</small></div>
        <em class="kx-count${list.length && done === list.length ? " all" : ""}">${list.length && done === list.length ? "✓ All done" : `${done}/${list.length}`}</em></header>
      <div class="kx-level"><span>${lv.icon} ${lv.name}</span>${lv.next ? `<small>${lv.toNext} ⭐ to ${lv.next}</small>` : `<small>Top level!</small>`}</div>
      ${ciBtn}
      <div class="kx-list">${secs || `<p class="kx-none">No chores today 🎉</p>`}
        <h4>🏋️ Training</h4><button class="kx-row train" data-act="training" data-k="${k}"><span>🏀</span><b>Training Hub<small>${tr.pts ? `${tr.pts} pts today → +${tr.n} ⭐` : `+1 ⭐ per ${TRAIN_PTS_PER_STAR} pts`}</small></b><i class="kx-go">›</i></button></div>
      <button class="kx-colshop" data-shop="${k}"><span>🎁</span>${k}'s shop${mins ? `<em>📱 ${mins} min</em>` : ""}</button>
    </section>`;
  }  const pendingRows = () => log().filter((r) => r.kind === "spend" && r.status === "owed");
  const wishes = () => setup().filter((r) => r.kind === "reward" && !r.removed && (r.stars === null || r.stars === undefined));
  const pendingCount = () => pendingRows().length + wishes().length;

  function renderShop() {
    const k = S.kid, b = balance(k), rs = rewards(k);
    return `<h2>🎁 ${k}'s reward shop <small class="kx-have">⭐ ${b}</small></h2>
      <div class="kx-shop-list">${rs.map((r) => {
        if (r.stars === null || r.stars === undefined) return `<div class="kx-rw wish"><span>${esc(r.emoji || "🎁")}</span><b>${esc(r.title)}<small>🌠 waiting for Mom or Dad to set the price</small></b></div>`;
        const capped = capInfo(r, k), can = b >= r.stars && !capped;
        const why = capped ? `Next one after ${parse(capped).toLocaleDateString([], { month: "short", day: "numeric" })}` : can ? "Tap to get it" : `${r.stars - b} more ⭐ to go`;
        return `<button class="kx-rw${can ? "" : " cant"}" data-buy="${esc(r.id)}"><span>${esc(r.emoji || "🎁")}</span><b>${esc(r.title)}<small>${why}</small></b><em>⭐ ${r.stars}</em></button>`;
      }).join("")}</div>
      <div class="label">Wish for something</div>
      ${Speech ? `<button class="mic" data-act="wish-say"><span class="micdot">🎤</span><b>Tap and say what you want</b></button>` : ""}
      <div class="typed" id="kx-wish" contenteditable="true" spellcheck="false" data-ph="A squishy, new lure, Starbucks…"></div>
      <div class="sheet-row"><button class="btn" data-act="close">Close</button><button class="btn go" data-act="wish">Send my wish</button></div>`;
  }
  // ---------- morning check-in: recap + wheel ----------
  function drawCheckin(k) {
    const t = today(), list = chores(k, t), open = list.filter((c) => !isDone(t, k, c)), lv = level(k);
    const wheel = (() => { let a = 0; return SLICES.map(([, , pct, col]) => { const s = `${col} ${a}% ${a + pct}%`; a += pct; return s; }).join(","); })();
    sheet(`<div class="kx-checkin k-${k}">
      <h2>${new Date().getHours() < 12 ? "Morning" : "Hi"}, ${k}! ☀️</h2>
      <div class="kx-recap">
        <div><b>⭐ ${weekStars(k)}</b><small>this week</small></div>
        <div><b>🔥 ${streak(k)}</b><small>all-done streak</small></div>
        <div><b>☀️ ${checkinStreak(k) + 1}</b><small>check-in streak</small></div>
        <div><b>${lv.icon}</b><small>${lv.name}${lv.next ? ` · ${lv.toNext} to go` : ""}</small></div>
      </div>
      <div class="kx-today"><b>Today:</b> ${open.length ? `${open.length} chore${open.length > 1 ? "s" : ""} to do (${WHEN.map(([w, l]) => { const n = open.filter((c) => whenOf(c) === w).length; return n ? `${n} ${l.replace(/^\S+\s/, "").toLowerCase()}` : ""; }).filter(Boolean).join(", ")})` : "all chores done 🎉"}</div>
      <div class="kx-coming" id="kx-coming"></div>
      <div class="kx-wheelbox"><div class="kx-pointer">▼</div><div class="kx-wheel" id="kx-wheel" style="background:conic-gradient(${wheel})"></div></div>
      <p class="kx-odds">${SLICES.map(([, l, p, c]) => `<span><i style="background:${c}"></i>${l} ${p}%</span>`).join("")}</p>
      <div id="kx-spinres"></div>
      <div class="sheet-row"><button class="btn" data-act="close">Later</button><button class="btn go" data-act="spin" data-k="${k}">Spin! 🎡</button></div>
    </div>`);
    // coming up: the next 3 days of family-calendar events for this kid (if the calendar feed is published)
    if (window.HubData && HubData.getEvents) Promise.all([1, 2, 3].map((n) => HubData.getEvents(add(t, n)).then((ev) => [add(t, n), ev]).catch(() => [add(t, n), null]))).then((days) => {
      const lines = days.map(([d, ev]) => { const mine = (ev || []).filter((e) => !e.who || !e.who.length || e.who.includes(k)).slice(0, 2);
        return mine.length ? `<li><b>${parse(d).toLocaleDateString([], { weekday: "short" })}</b> ${mine.map((e) => esc(e.title) + (e.time ? ` <small>${esc(e.time)}</small>` : "")).join(" · ")}</li>` : ""; }).join("");
      const box = $("kx-coming"); if (box && lines) box.innerHTML = `<b>Coming up</b><ul>${lines}</ul>`;
    });
  }
  function spin(k) {
    if (checkinRow(k)) return;
    const out = spinOutcome(k), t = today();
    put("stars", { id: `${t}|${k}|checkin`, kid: k, day: t, kind: "checkin", item: out.slice, title: "Morning check-in", stars: 0, status: "ok", note: JSON.stringify(out) });
    if (out.stars) put("stars", { id: `${t}|${k}|mystery`, kid: k, day: t, kind: "bonus", item: "mystery", title: "Mystery box", stars: out.stars, status: "ok" });
    // land the pointer (top) in the middle of the winning slice
    let a = 0; const [, , pct] = SLICES.find((s) => s[0] === out.slice); for (const s of SLICES) { if (s[0] === out.slice) break; a += s[2]; }
    const mid = (a + pct / 2) * 3.6, w = $("kx-wheel");
    if (w) { w.style.transition = "transform 3.4s cubic-bezier(.15,.8,.2,1)"; w.style.transform = `rotate(${5 * 360 + (360 - mid)}deg)`; }
    const btn = document.querySelector('[data-act="spin"]'); if (btn) btn.disabled = true;
    setTimeout(() => {
      const name = (id) => { const c = chores(k, t).find((x) => x.id === id); return c ? `${c.emoji || ""} ${esc(c.title)}` : id; };
      let html = "";
      if (out.slice === "two") html = `<h3>2× today:</h3><p>${out.items.map(name).join("<br>")}</p>`;
      if (out.slice === "golden") html = `<h3>🌟 GOLDEN! Every chore is 2× today!</h3>`;
      if (out.slice === "mystery") html = `<h3>🎁 Mystery box: +${out.stars} ⭐</h3>`;
      if (out.slice === "pick") html = `<h3>You pick! Which chore is 2×?</h3><div class="chips">${chores(k, t).filter((c) => !isDone(t, k, c)).map((c) => `<button class="chip-btn" data-pick="${esc(c.id)}">${esc(c.emoji || "")} ${esc(c.title)}</button>`).join("")}</div>`;
      const res = $("kx-spinres"); if (res) res.innerHTML = html;
      if (btn) { btn.textContent = "Let's go!"; btn.dataset.act = "close"; btn.disabled = false; }
      celebrate(null, out.slice === "golden" ? "🌟" : out.slice === "mystery" ? `+${out.stars}⭐` : "2×", out.slice !== "two");
      refresh();
    }, 3500);
  }
  function pickOwn(id) {
    const r = checkinRow(S.kid); if (!r) return;
    const n = note(r); if (n.slice !== "pick" || (n.items && n.items.length)) return;
    put("stars", { ...r, note: JSON.stringify({ ...n, items: [id] }) });
    const c = chores(S.kid, today()).find((x) => x.id === id);
    toast(`2× on ${c ? c.title : "that chore"} ✓`); closeSheet(); refresh();
  }

  // ---------- after-school scratch-off ----------
  function drawScratch(k) {
    const t = today(); let r = scratchRow(k);
    if (!r) r = put("stars", { id: `${t}|${k}|scratch`, kid: k, day: t, kind: "scratch", item: "scratch", title: "After-school scratch-off", stars: 0, status: "ok", note: JSON.stringify(scratchPrize(k)) });
    const n = note(r), c = n.item ? chores(k, t).find((x) => x.id === n.item) : null;
    const prize = c ? `<b>2×</b><span>${esc(c.emoji || "")} ${esc(c.title)}</span><small>worth +${c.stars * 2} ⭐ if you do it before dinner</small>` : `<b>+${n.stars || 2} ⭐</b><span>Instant win!</span>`;
    sheet(`<div class="kx-scratch k-${k}"><h2>🎟️ After-school scratch-off</h2><p class="kx-fine">Scratch it with your finger</p>
      <div class="kx-card"><div class="kx-prize">${prize}</div><canvas id="kx-canvas"></canvas></div>
      <div class="sheet-row"><button class="btn go" data-act="close">Done</button></div></div>`);
    if (n.stars && !row(`${t}|${k}|instant`)) put("stars", { id: `${t}|${k}|instant`, kid: k, day: t, kind: "bonus", item: "scratch", title: "Scratch-off win", stars: n.stars, status: "ok" });
    const cv = $("kx-canvas"), box = cv.parentElement, dpr = devicePixelRatio || 1;
    cv.width = box.clientWidth * dpr; cv.height = box.clientHeight * dpr;
    const g = cv.getContext("2d"); g.scale(dpr, dpr);
    const grad = g.createLinearGradient(0, 0, box.clientWidth, box.clientHeight); grad.addColorStop(0, "#c9ccd6"); grad.addColorStop(0.5, "#f2f3f7"); grad.addColorStop(1, "#a9adba");
    g.fillStyle = grad; g.fillRect(0, 0, box.clientWidth, box.clientHeight);
    g.fillStyle = "#6b6f80"; g.font = "700 26px system-ui"; g.textAlign = "center"; g.fillText("SCRATCH HERE ✨", box.clientWidth / 2, box.clientHeight / 2 + 9);
    g.globalCompositeOperation = "destination-out";
    let down = false, moves = 0, done = false;
    const scratchAt = (e) => { const b = cv.getBoundingClientRect(); g.beginPath(); g.arc(e.clientX - b.left, e.clientY - b.top, 28, 0, Math.PI * 2); g.fill();
      if (++moves % 12 === 0 && !done) { const px = g.getImageData(0, 0, cv.width, cv.height).data; let clear = 0; for (let i = 3; i < px.length; i += 64) if (px[i] === 0) clear++;
        if (clear / (px.length / 64) > 0.45) { done = true; cv.style.transition = "opacity .5s"; cv.style.opacity = 0; celebrate(box, c ? "2×" : `+${n.stars}⭐`, true); refresh(); } } };
    cv.addEventListener("pointerdown", (e) => { down = true; cv.setPointerCapture(e.pointerId); scratchAt(e); });
    cv.addEventListener("pointermove", (e) => { if (down) scratchAt(e); });
    cv.addEventListener("pointerup", () => { down = false; });
  }

  function confirmBuy(r) {
    sheet(`<div class="kx-confirm"><span>${esc(r.emoji || "🎁")}</span><h2>${esc(r.title)}?</h2><p>That spends <b>⭐ ${r.stars}</b> of your ${balance(S.kid)}.</p>
      <div class="sheet-row"><button class="btn" data-act="shop">Not yet</button><button class="btn go" data-yes="${esc(r.id)}">Yes, get it!</button></div></div>`);
  }

  function renderParents() {
    const owed = pendingRows(), ws = wishes(), trip = tripNow();
    const rw = (r) => setup().find((x) => x.id === r.item);
    const kidsRows = (kind) => setup().filter((r) => r.kind === kind && !r.removed && r.stars !== null && r.stars !== undefined).sort((a, b) => a.kid.localeCompare(b.kid) || a.sort - b.sort || (a.stars - b.stars));
    return `<header class="kx-head"><div class="kx-hello"><small>👪</small><b>Mom & Dad</b><span>${S.db === false ? "⚠️ Saving on this screen only until the stars setup is run" : "Approve, hand out, and set up chores"}</span></div>
        <div class="kx-big sm">${KIDS.map((k) => `<div><b>⭐ ${balance(k)}</b><small>${k} · 🔥${streak(k)}</small></div>`).join("")}</div></header>
      ${tabs()}
      <div class="kx-scroll kx-par">
        <h3>To hand out ${owed.length ? `<em class="kx-red">${owed.length}</em>` : ""}</h3>
        ${owed.length ? owed.map((r) => `<div class="kx-prow"><span>${esc((rw(r) || {}).emoji || "🎁")}</span><b>${esc(r.kid)}: ${esc(r.title)}<small>${parse(r.day).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ⭐ ${-r.stars}</small></b>
          <button class="kx-pbtn go" data-given="${esc(r.id)}">Given ✓</button><button class="kx-pbtn" data-refund="${esc(r.id)}">Refund</button></div>`).join("") : `<p class="kx-none">Nothing owed 👍</p>`}
        <h3>Wishes to price ${ws.length ? `<em class="kx-red">${ws.length}</em>` : ""}</h3>
        ${ws.length ? ws.map((r) => `<div class="kx-prow col"><div class="kx-prow-top"><span>${esc(r.emoji || "🎁")}</span><b>${esc(r.kid)} wants: ${esc(r.title)}</b><button class="kx-pbtn" data-nowish="${esc(r.id)}">No</button></div>
          <div class="chips">${PRICES.map((p) => `<button class="chip-btn" data-price="${esc(r.id)}" data-p="${p}">⭐ ${p}</button>`).join("")}</div></div>`).join("") : `<p class="kx-none">No wishes waiting</p>`}
        <h3>Trip mode</h3>
        <button class="kx-trip${trip ? " on" : ""}" data-act="trip"><span>✈️</span><b>${trip ? `On since ${parse(trip.data.from).toLocaleDateString([], { month: "short", day: "numeric" })}<small>Chores paused, streaks safe. Tap when you're home.</small>` : "We're on a trip<small>Pauses chores for both kids and keeps their streaks</small>"}</b><i class="kx-switch"></i></button>
        <h3>Bonus stars</h3>
        ${KIDS.map((k) => `<div class="kx-prow"><i class="kx-dot k-${k}"></i><b>${k}<small>for something great (or −1 to fix a mistake)</small></b>${BONUS.map((n) => `<button class="kx-pbtn${n > 0 ? " go" : ""}" data-bonus="${k}" data-n="${n}">${n > 0 ? "+" : "−"}${Math.abs(n)}</button>`).join("")}</div>`).join("")}
        <h3>Chores</h3>
        ${kidsRows("chore").map((r) => `<div class="kx-prow"><span>${esc(r.emoji || "✅")}</span><b>${esc(r.title)}<small>${r.kid === "Both" ? "Both kids" : esc(r.kid)} · ⭐ ${r.stars}${r.data && r.data.days ? " · school nights" : " · every day"} · ${(WHEN.find(([w]) => w === whenOf(r)) || ["", ""])[1].replace(/^\S+\s/, "")}</small></b><button class="kx-pbtn" data-rm="${esc(r.id)}">Remove</button></div>`).join("")}
        <button class="kx-addrow" data-act="add-chore">＋ Add a chore</button>
        <h3>Rewards</h3>
        ${kidsRows("reward").map((r) => `<div class="kx-prow"><span>${esc(r.emoji || "🎁")}</span><b>${esc(r.title)}<small>${r.kid === "Both" ? "Both kids" : esc(r.kid)} · ⭐ ${r.stars}</small></b><button class="kx-pbtn" data-rm="${esc(r.id)}">Remove</button></div>`).join("")}
        <button class="kx-addrow" data-act="add-reward">＋ Add a reward</button>
        <p class="kx-fine">Cash: 10 ⭐ = $1. Prizes: 10 ⭐ = $2 worth (saving for a prize beats cash). Morning check-in wheel: 2× two chores 75%, mystery box (+3–8) 10%, pick your own 2× 10%, golden (all 2×) 5%. After-school scratch-off doubles one chore worth more than 1 ⭐ (or +2–4 instantly). Levels: Silver at 100 ⭐ earned, Gold 300, Diamond 700.</p>
        <p class="kx-fine">Stars: chores as listed, +${ALLDONE_BONUS} when every chore is done, +1 per ${TRAIN_PTS_PER_STAR} Training Hub points (max ${TRAIN_MAX}/day). Streak = days with every chore done; trip days and days with no chores don't break it.</p>
      </div>`;
  }
  const NEWITEM = { kind: "chore", kid: "Both", emoji: "🧹", stars: 1, school: false, when: "afternoon" };
  function drawAddItem() {
    const n = NEWITEM, isChore = n.kind === "chore";
    sheet(`<h2>${isChore ? "New chore" : "New reward"}</h2>
      ${Speech ? `<button class="mic" data-act="item-say"><span class="micdot">🎤</span><b>Tap and say it</b></button>` : ""}
      <div class="typed" id="kx-item" contenteditable="true" spellcheck="false" data-ph="${isChore ? "Feed the dog, empty the dishwasher…" : "Movie night, new squishy…"}">${esc(n.title || "")}</div>
      <div class="label">For</div><div class="chips">${["Both", ...KIDS].map((k) => `<button class="chip-btn${n.kid === k ? " on" : ""}" data-nk="${k}">${k === "Both" ? "Both kids" : k}</button>`).join("")}</div>
      <div class="label">Stars</div><div class="chips">${(isChore ? CHORE_STARS : PRICES).map((p) => `<button class="chip-btn${n.stars === p ? " on" : ""}" data-ns="${p}">⭐ ${p}</button>`).join("")}</div>
      ${isChore ? `<div class="label">Part of the day</div><div class="chips">${WHEN.map(([w, l]) => `<button class="chip-btn${n.when === w ? " on" : ""}" data-nw="${w}">${l}</button>`).join("")}</div>` : ""}
      ${isChore ? `<div class="label">Which days</div><div class="chips"><button class="chip-btn${!n.school ? " on" : ""}" data-nd="0">Every day</button><button class="chip-btn${n.school ? " on" : ""}" data-nd="1">School nights (Sun–Thu)</button></div>` : ""}
      <div class="label">Picture</div><div class="chips kx-emojis">${EMOJIS.map((e) => `<button class="chip-btn${n.emoji === e ? " on" : ""}" data-ne="${e}">${e}</button>`).join("")}</div>
      <div class="sheet-row"><button class="btn" data-act="parents-close">Cancel</button><button class="btn go" data-act="save-item">Add it</button></div>`);
  }

  // ---------- taps ----------
  function onClick(e) {
    const b = e.target.closest("button"); if (!b) return;
    const d = b.dataset;
    if (d.kid) { setKid(d.kid); render(); return; }
    if (d.chore) { const k = d.k || S.kid, c = chores(k, today()).find((x) => x.id === d.chore); if (c) toggleChore(c, k, b); return; }
    if (d.shop) { S.kid = d.shop; sheet(renderShop()); return; }
    if (d.buy) { const r = rewards(S.kid).find((x) => x.id === d.buy); if (r && !capInfo(r, S.kid)) confirmBuy(r); return; }
    if (d.yes) { const r = rewards(S.kid).find((x) => x.id === d.yes); if (r && balance(S.kid) >= r.stars && !capInfo(r, S.kid)) buy(r); return; }
    if (d.ci) { S.kid = d.ci; drawCheckin(d.ci); return; }
    if (d.sc) { S.kid = d.sc; drawScratch(d.sc); return; }
    if (d.pick) { pickOwn(d.pick); return; }
    if (d.given || d.refund) { const r = log().find((x) => x.id === (d.given || d.refund)); if (r) { put("stars", { ...r, status: d.given ? "given" : "cancelled" }); toast(d.given ? `Handed out ✓` : `Refunded ⭐ ${-r.stars} to ${r.kid}`); refresh(); } return; }
    if (d.price) { const r = setup().find((x) => x.id === d.price); if (r) { put("kid_setup", { ...r, stars: +d.p }); toast(`${r.title}: ⭐ ${d.p} ✓`); refresh(); } return; }
    if (d.nowish || d.rm) { const r = setup().find((x) => x.id === (d.nowish || d.rm)); if (r) { put("kid_setup", { ...r, removed: true }); toast(`Removed ${r.title}`); refresh(); } return; }
    if (d.bonus) { const n = +d.n; put("stars", { id: `bonus|${d.bonus}|${Date.now()}`, kid: d.bonus, day: today(), kind: "bonus", item: "bonus", title: n > 0 ? "Bonus from Mom & Dad" : "Fix", stars: n, status: "ok" }); if (n > 0) celebrate(b, `+${n}⭐`); toast(`${d.bonus}: ${n > 0 ? "+" : "−"}${Math.abs(n)} ⭐`); refresh(); return; }
    if (d.nk) { NEWITEM.kid = d.nk; NEWITEM.title = $("kx-item").textContent; drawAddItem(); return; }
    if (d.ns) { NEWITEM.stars = +d.ns; NEWITEM.title = $("kx-item").textContent; drawAddItem(); return; }
    if (d.nd) { NEWITEM.school = d.nd === "1"; NEWITEM.title = $("kx-item").textContent; drawAddItem(); return; }
    if (d.nw) { NEWITEM.when = d.nw; NEWITEM.title = $("kx-item").textContent; drawAddItem(); return; }
    if (d.ne) { NEWITEM.emoji = d.ne; NEWITEM.title = $("kx-item").textContent; drawAddItem(); return; }
    switch (d.act) {
      case "parents": S.parents = true; render(); break;
      case "board": S.parents = false; render(); break;
      case "shop": sheet(renderShop()); break;
      case "close": case "parents-close": closeSheet(); break;
      case "say": listen(heardDone, b); break;
      case "spin": spin(d.k || S.kid); break;
      case "training": if (window.HubApps && window.HubApps.training) { close(); window.HubApps.training.open(d.k || S.kid); } else location.href = `../?open=${d.k || S.kid}`; break;
      case "wish": wish($("kx-wish").textContent); closeSheet(); break;
      case "wish-say": listen((t) => { $("kx-wish").textContent = t.replace(/^(i want|i wish for|i'd like|can i (get|have))\s+/i, ""); }, b); break;
      case "item-say": listen((t) => { $("kx-item").textContent = t; }, b); break;
      case "add-chore": Object.assign(NEWITEM, { kind: "chore", kid: "Both", emoji: "🧹", stars: 1, school: false, when: "afternoon", title: "" }); drawAddItem(); break;
      case "add-reward": Object.assign(NEWITEM, { kind: "reward", kid: "Both", emoji: "🎁", stars: 10, school: false, title: "" }); drawAddItem(); break;
      case "save-item": {
        const title = $("kx-item").textContent.trim(); if (!title) return toast("Say or type what it is");
        const n = NEWITEM; put("kid_setup", { id: `${n.kind}:${Date.now()}`, kind: n.kind, kid: n.kid, title: title[0].toUpperCase() + title.slice(1), emoji: n.emoji, stars: n.stars, data: n.kind === "chore" ? (n.school ? { days: SCHOOL_NIGHTS, when: n.when } : { when: n.when }) : null, removed: false, sort: 50 });
        closeSheet(); toast(`Added ${title} ✓`); refresh(); break;
      }
      case "trip": {
        const t = tripNow();
        if (t) put("kid_setup", { ...t, data: { ...t.data, to: add(today(), -1) < t.data.from ? t.data.from : add(today(), -1) } });
        else put("kid_setup", { id: `trip:${today()}`, kind: "trip", kid: "Both", title: "Trip", emoji: "✈️", stars: null, data: { from: today(), to: null }, removed: false, sort: 0 });
        toast(t ? "Welcome home! Chores are back on 🏠" : "✈️ Have a great trip! Chores paused, streaks safe", 3000); refresh(); break;
      }
    }
  }

  // ---------- open / close (the hub's dock, home bar and idle reset call these) ----------
  function open(kid) {
    ensureDom(); if (KIDS.includes(kid)) setKid(kid);
    S.open = true; $("kx").hidden = false; render();
    if (!S.loaded) load(); else { loadTraining().then(refresh); }
  }
  function close() { S.open = false; if ($("kx")) $("kx").hidden = true; closeSheet(); if (rec) { try { rec.stop(); } catch (e) {} } }
  window.HubApps = Object.assign(window.HubApps || {}, {
    stars: { open, close, isOpen: () => S.open },
    // home-screen person chips: chores done today (Skylight-style "2/6") + stars
    badge: (p) => { if (!KIDS.includes(p) || !S.loaded) return null; const l = chores(p, today()); return { done: l.filter((c) => isDone(today(), p, c)).length, total: l.length, stars: balance(p), trip: onTrip(today()) }; },
  });
  window.hubKids = { S, list, balance, streak, chores, matchChore, heard: heardDone, put, load, outbox: () => outbox };

  load(); setInterval(() => { if (!S.open || Date.now() - ((window.hub && window.hub.S.last) || 0) > 60000) load(); }, 5 * 60 * 1000);
  if (P.get("app") === "stars") setTimeout(() => open(P.get("kid")), 0);
  // a new day: re-render so yesterday's ticks clear
  let day = today(); setInterval(() => { if (today() !== day) { day = today(); refresh(); } }, 60000);
})();
