// Training Hub data layer (2026-10-14). Shared by the Training Hub (app.js) and the
// kitchen dashboard (home-hub-dashboard loads this file from the Training Hub's URL).
//
// Fast path: the Supabase database. The Google Sheet stays the place Dad edits drills,
// plans and prizes; its Apps Script publishes a computer-friendly copy of the plan into
// Supabase within about a minute of an edit, and copies check-offs back into the Sheet's
// "Set Log" tab every 5 minutes. One call (~0.2 s) returns everything a kid's screen needs.
//
// Slow path (automatic): if Supabase isn't set up yet, the plan hasn't been published, or
// it can't be reached, everything goes to the Sheet's Apps Script exactly like before.
// Check-offs that can't be saved right away wait in this device's outbox and retry.
(function () {
  const APPS_SCRIPT = "https://script.google.com/macros/s/AKfycbyyOY00079KTcqhRtuoE_W_OhRTZGlsHgfSTgryrTl3ZzsVFHwiA54bJ55hu7qChYyxGQ/exec";
  // Public "publishable" key: safe to ship. The database only lets it read the plan and
  // add or change check-offs, ratings and bomb/thermometer, never delete (supabase/setup.sql).
  const SB_URL = "https://xfnxjkstiwnrshprnzsz.supabase.co";
  const SB_KEY = "sb_publishable_cFFIRMpngL0aFzQ7SHe2eg_lpK7k9Jg";
  const SB_ON = !!(SB_URL && SB_KEY);

  const LIVE_KEY = "training.dbLive", OUT_KEY = "training.outbox";
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // fetch with a timeout; null on network failure
  async function timed(url, opts, ms) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, { cache: "no-store", ...opts, signal: ctl.signal });
      return { ok: r.ok, status: r.status, text: await r.text() };
    } catch (e) { return null; } finally { clearTimeout(t); }
  }
  const parse = (r) => { if (!r || !r.ok) return { error: "network" }; try { return r.text ? JSON.parse(r.text) : {}; } catch (e) { return { error: "network" }; } };

  // ---------- Apps Script (the Sheet) ----------
  async function sheetGet(action, params) {
    const url = new URL(APPS_SCRIPT);
    url.searchParams.set("action", action);
    Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
    url.searchParams.set("_t", Date.now());
    return parse(await timed(url.toString(), {}, 25000));
  }
  async function sheetPost(body) {
    // text/plain keeps this a CORS "simple request" (HANDOFF gotcha #2).
    return parse(await timed(APPS_SCRIPT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) }, 25000));
  }

  // ---------- Supabase ----------
  function sbHeaders(extra) {
    const h = { apikey: SB_KEY, "Content-Type": "application/json", ...extra };
    if (/^eyJ/.test(SB_KEY)) h.Authorization = "Bearer " + SB_KEY; // older-style keys also want this
    return h;
  }
  const sbLive = () => SB_ON && ls.get(LIVE_KEY) === true;

  // ---------- dates (same rules as the Apps Script) ----------
  const addDays = (ymd, n) => { const p = ymd.split("-"); const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const weekStart = (ymd) => { const p = ymd.split("-"); const dow = (new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay() + 6) % 7; return addDays(ymd, -dow); };

  // ---------- outbox: saves wait here until the database has them ----------
  let outbox = ls.get(OUT_KEY) || []; // [{table, row, body}] one entry per row id, latest wins
  const saveOutbox = () => ls.set(OUT_KEY, outbox);
  const rowId = (e) => e.table + "|" + (e.row.id || e.row.player);
  function queue(entry) {
    outbox = outbox.filter((e) => rowId(e) !== rowId(entry));
    outbox.push(entry);
    saveOutbox();
  }
  const ptsCache = {}; // activity id -> points per set, from the last plan loaded
  function toRow(b) {
    if (b.action === "toggleSet") {
      const pts = Number(b.pts) || ptsCache[b.activity] || 1;
      return { table: "set_log", row: { id: [b.date, b.player, b.track, b.activity, b.set].join("|"), day: b.date, player: b.player, track: b.track, activity: String(b.activity), set_no: Number(b.set), points: pts, result: null, done: b.done === true } };
    }
    if (b.action === "setResult") {
      const v = b.result === null || b.result === "" || b.result === undefined ? null : Number(b.result);
      return { table: "set_log", row: { id: [b.date, b.player, b.track, b.activity, 0].join("|"), day: b.date, player: b.player, track: b.track, activity: String(b.activity), set_no: 0, points: 0, result: v, done: v !== null } };
    }
    if (b.action === "setFeedback") {
      return { table: "feedback", row: { id: b.player + "|" + b.activity, player: b.player, activity: String(b.activity), activity_name: b.activityName || null, track: b.track || null, minutes: Number(b.minutes), difficulty: Math.round(Number(b.difficulty)), day: b.date || null } };
    }
    if (b.action === "setVisual") return { table: "player_settings", row: { player: b.player, visual: b.visual } };
    return null;
  }
  let flushing = null;
  function flush() {
    if (!flushing) flushing = (async () => {
      while (outbox.length) {
        const batch = outbox.slice(), byTable = {};
        batch.forEach((e) => (byTable[e.table] = byTable[e.table] || []).push(e));
        for (const table of Object.keys(byTable)) {
          const entries = byTable[table];
          const r = await timed(`${SB_URL}/rest/v1/${table}`, { method: "POST", headers: sbHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify(entries.map((e) => e.row)) }, 12000);
          if (!r || !r.ok) return false;
          // Drop what was sent, unless it changed again while sending.
          outbox = outbox.filter((e) => !entries.includes(e));
          saveOutbox();
        }
      }
      return true;
    })().finally(() => { flushing = null; });
    return flushing;
  }
  if (SB_ON) setInterval(() => { if (outbox.length) flush(); }, 20000);

  // Save one change. Resolves { ok: true } when saved, { ok: true, queued: true } when it
  // is waiting in this device's outbox (it will save by itself), or { error } on a real failure.
  async function post(body) {
    if (!sbLive()) return sheetPost(body);
    const entry = toRow(body);
    if (!entry) return sheetPost(body);
    entry.body = body;
    queue(entry);
    for (const wait of [0, 1500]) {
      if (wait) await sleep(wait);
      if (await flush()) return { ok: true };
    }
    // Database unreachable: try the Sheet instead (it forwards to the database too).
    const r = await sheetPost(body);
    if (r && r.ok) { outbox = outbox.filter((e) => e !== entry); saveOutbox(); return { ok: true }; }
    return { ok: true, queued: true };
  }

  // ---------- reading one kid's day ----------
  function assemble(d, player, date) {
    const plan = d.plan, ws = weekStart(date), we = addDays(ws, 6);
    const prizeFor = (type) => {
      const rows = (plan.prizes || []).filter((r) => r.type === type && (r.player === player || r.player === "All") && r.start <= date)
        .sort((a, b) => (a.start !== b.start ? (a.start < b.start ? 1 : -1) : a.player === player ? -1 : 1));
      const r = rows[0];
      return r ? { prize: r.prize, target: r.target, start: r.start } : null;
    };
    const weekly = prizeFor("Weekly"), big = prizeFor("Big");
    const done = {}, results = {}, history = {}, feedback = {}, byDay = {};
    (d.done || []).forEach((k) => { done[k] = true; });
    Object.entries(d.byDay || {}).forEach(([k, v]) => { byDay[k] = Number(v) || 0; });
    (d.results || []).forEach((r) => {
      (history[r.activity] = history[r.activity] || []).push({ date: r.day, value: Number(r.value) });
      if (r.day === date) results[r.track + "|" + r.activity] = Number(r.value);
    });
    (d.feedback || []).forEach((a) => { feedback[a] = true; });
    let visual = d.visual || plan.player.visual;
    // Changes still waiting in this device's outbox count already.
    outbox.forEach((e) => {
      const r = e.row;
      if (r.player !== player) return;
      if (e.table === "player_settings") visual = r.visual;
      else if (e.table === "feedback") feedback[r.activity] = true;
      else if (r.set_no === 0) {
        if (r.day === date) { if (r.result === null) delete results[r.track + "|" + r.activity]; else results[r.track + "|" + r.activity] = r.result; }
      } else {
        const k = r.track + "|" + r.activity + "|" + r.set_no;
        const was = r.day === date ? !!done[k] : null;
        if (was === null) return; // only today's taps are known well enough to overlay
        if (r.done && !was) { done[k] = true; byDay[r.day] = (byDay[r.day] || 0) + r.points; }
        if (!r.done && was) { delete done[k]; byDay[r.day] = (byDay[r.day] || 0) - r.points; }
      }
    });
    const pts = { today: 0, week: 0, big: 0, lifetime: 0, byDay };
    Object.keys(byDay).forEach((day) => {
      const v = byDay[day];
      pts.lifetime += v;
      if (day === date) pts.today += v;
      if (day >= ws && day <= we) pts.week += v;
      if (big && day >= big.start) pts.big += v;
    });
    // Calendar to-dos (e.g. MBT) go on top of their track's must-dos; same rule as v2ApplyTodos.
    const tracks = JSON.parse(JSON.stringify(plan.tracks || {}));
    ((d.events && d.events.todos && d.events.todos[date]) || []).forEach((td) => {
      const t = tracks[td.track];
      if (!t) return;
      t.options.forEach((g) => { g.items = g.items.filter((x) => x.id !== td.item.id); });
      t.options = t.options.filter((g) => g.items.length);
      if (!t.must.some((x) => x.id === td.item.id)) t.must.unshift(td.item);
    });
    Object.values(tracks).forEach((t) => t.must.concat(...t.options.map((g) => g.items)).forEach((it) => { ptsCache[it.id] = it.pts; }));
    const ev = d.events && d.events.days ? d.events.days[date] : null;
    return {
      player: { ...plan.player, visual }, date, weekStart: ws, tracks, done, results, history,
      points: pts, prizes: { weekly, big }, events: ev || [], feedback, players: d.players || [], source: "db",
    };
  }

  async function dbHub(player, date) {
    const r = await timed(`${SB_URL}/rest/v1/rpc/hub`, { method: "POST", headers: sbHeaders(), body: JSON.stringify({ p_player: player, p_day: date }) }, 10000);
    const d = parse(r);
    if (d.error) return d;
    // "not in plan": e.g. a player turned off in the Sheet (the Sheet path answers "unknown player").
    if (!d.plan || (Array.isArray(d.players) && !d.players.some((p) => p.name === player))) return { error: d.players ? "not in plan" : "unpublished" };
    return assemble(d, player, date);
  }

  async function getHub(player, date) {
    if (SB_ON) {
      for (const wait of [0, 1500]) {
        if (wait) await sleep(wait);
        const h = await dbHub(player, date);
        if (!h.error) { ls.set(LIVE_KEY, true); if (outbox.length) flush(); return h; }
        if (h.error !== "network") { if (h.error === "unpublished" && !outbox.length) ls.set(LIVE_KEY, false); break; }
      }
    }
    return sheetGet("getHub", { player, date });
  }

  async function getPlayers() {
    if (SB_ON) {
      const d = parse(await timed(`${SB_URL}/rest/v1/site_data?id=eq.players&select=data`, { headers: sbHeaders() }, 10000));
      if (Array.isArray(d) && d[0] && Array.isArray(d[0].data) && d[0].data.length) return d[0].data;
    }
    return sheetGet("getPlayers");
  }

  // Everything the /drills/ page needs: players, each player's plan, and the whole library
  // (the library doc only exists once the Sheet script publishes it).
  async function getPlans() {
    if (SB_ON) {
      const d = parse(await timed(`${SB_URL}/rest/v1/site_data?or=(id.like.plan:*,id.eq.library,id.eq.players)&select=id,data`, { headers: sbHeaders() }, 12000));
      if (Array.isArray(d) && d.some((x) => x.id === "players")) {
        const out = { players: [], plans: {}, library: null, source: "db" };
        d.forEach((x) => {
          if (x.id === "players") out.players = x.data;
          else if (x.id === "library") out.library = x.data;
          else out.plans[x.id.slice(5)] = x.data;
        });
        out.players.forEach((p) => { if (!out.plans[p.name]) out.plans[p.name] = null; });
        return out;
      }
    }
    const players = await sheetGet("getPlayers");
    if (!Array.isArray(players)) return { error: players.error || "network" };
    const out = { players, plans: {}, library: null, source: "sheet" };
    const date = new Date(), pad = (n) => String(n).padStart(2, "0");
    const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    await Promise.all(players.map(async (p) => {
      const h = await sheetGet("getHub", { player: p.name, date: ymd });
      out.plans[p.name] = h && !h.error ? { player: h.player, tracks: h.tracks } : null;
    }));
    return out;
  }

  // Today's events from every family calendar (Kyle's, Logan's, family, Crossbar, both teams).
  // The Sheet script publishes these per player every 5 minutes; this merges them. Returns
  // null if they're missing or stale (no entry for `date`), so callers can fall back.
  async function getEvents(date) {
    if (!SB_ON) return null;
    const d = parse(await timed(`${SB_URL}/rest/v1/site_data?id=like.events:*&select=id,data`, { headers: sbHeaders() }, 10000));
    if (!Array.isArray(d)) return null;
    const docs = d.filter((x) => x.data && x.data.days && Array.isArray(x.data.days[date]));
    if (!docs.length) return null;
    // 'events:home' has every calendar with who each event is for ({who: ["Kyle", ...]}).
    const home = docs.find((x) => x.id === "events:home");
    if (home) return home.data.days[date].slice();
    const seen = new Set(), out = [];
    docs.forEach((doc) => doc.data.days[date].forEach((e) => {
      if (e.day !== "Today") return;
      const k = `${e.title}|${e.time}`;
      if (seen.has(k)) return;
      seen.add(k); out.push(e);
    }));
    const mins = (t) => { const m = /^(\d+):(\d+)\s*([AP]M)$/i.exec(t || ""); return m ? ((+m[1] % 12) + (/p/i.test(m[3]) ? 12 : 0)) * 60 + +m[2] : -1; };
    return out.sort((a, b) => mins(a.time) - mins(b.time));
  }

  window.HubData = { getHub, getPlayers, getPlans, getEvents, post, sheetGet, pending: () => outbox.length, usingDb: sbLive, _assemble: assemble };
})();
