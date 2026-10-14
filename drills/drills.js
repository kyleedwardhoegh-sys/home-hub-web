// Drill Library (2026-10-14): every drill in the kids' plans with its video, grouped by
// category, so Dad can scan what the kids can pick from and spot drills that need a better
// video. Data: HubData.getPlans() (the fast database, or the Sheet as a fallback).
// Each YouTube link is checked with YouTube's oEmbed (cached 3 days) to show the real
// channel + title and catch videos that were removed or can't be embedded.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TRACKS = ["Morning", "After School", "Night"];
// Shooting first, then handles, then everything else (same priorities as the hub).
const CAT_ORDER = ["Dunn Shooting", "Love Shooting", "Shooting Feel", "Garage / No Hoop", "Tests", "Film & Study",
  "Dribbling", "Two Ball", "Basketball Skills", "Rebounding", "Defense", "Agility & Quickness", "Explosive",
  "Lifting", "Team Training", "Team & Trainer", "Mindset"];
const STATUS_TEXT = { good: "Good video", weak: "Worth a look", none: "Needs a video" };

const F = { status: "all", track: "All", kid: "All", q: "", scope: "plans" };
let DRILLS = [], PLAYERS = [], HAS_LIBRARY = false;

if (new URLSearchParams(location.search).has("kiosk")) document.documentElement.classList.add("kiosk");

// ---------- video helpers ----------
function ytId(url) {
  const m = url.match(/youtu\.be\/([\w-]{6,})/) || url.match(/shorts\/([\w-]{6,})/) || url.match(/[?&]v=([\w-]{6,})/) || url.match(/embed\/([\w-]{6,})/);
  return m ? m[1] : null;
}
const ytStart = (url) => (url.match(/[?&]t=(\d+)/) || [])[1] || "";
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return "another site"; } };

const OE_KEY = "drills.oembed", OE_TTL = 3 * 864e5;
let oeCache = {};
try { oeCache = JSON.parse(localStorage.getItem(OE_KEY)) || {}; } catch (e) {}
const saveOe = () => { try { localStorage.setItem(OE_KEY, JSON.stringify(oeCache)); } catch (e) {} };

async function oembed(id) {
  const hit = oeCache[id];
  if (hit && Date.now() - hit.at < OE_TTL) return hit;
  let r;
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent("https://www.youtube.com/watch?v=" + id)}`);
    if (res.ok) { const j = await res.json(); r = { ok: true, channel: j.author_name, title: j.title }; }
    else if (res.status === 401 || res.status === 403) r = { ok: false, why: "noembed" };
    else if (res.status === 404 || res.status === 400) r = { ok: false, why: "gone" };
    else return null; // YouTube hiccup: don't cache, try next time
  } catch (e) { return null; }
  r.at = Date.now();
  oeCache[id] = r; saveOe();
  return r;
}

// ---------- build the drill list ----------
function collect(data) {
  const by = {};
  const add = (it, use) => {
    const d = by[it.id] || (by[it.id] = { ...it, uses: [] });
    if (use) d.uses.push(use);
  };
  Object.entries(data.plans).forEach(([player, plan]) => {
    if (!plan) return;
    Object.entries(plan.tracks || {}).forEach(([track, t]) => {
      t.must.forEach((it) => add(it, { player, track, type: "must" }));
      t.options.forEach((g) => g.items.forEach((it) => add(it, { player, track, type: "option" })));
    });
  });
  (data.library || []).forEach((it) => {
    if (by[it.id]) { by[it.id].tracks = it.tracks; by[it.id].active = it.active; }
    else add(it, null);
  });
  return Object.values(by).map((d) => {
    const v = d.video || "", id = v ? ytId(v) : null;
    d.yt = id; d.start = id ? ytStart(v) : "";
    d.inPlan = d.uses.length > 0;
    d.lowIntensity = /jr\.? ?nba/i.test(d.source || "");
    return d;
  });
}

function status(d) {
  if (!d.video) return "none";
  if (!d.yt) return "weak"; // link to another site: can't play here
  const oe = oeCache[d.yt];
  if (oe && !oe.ok && oe.why === "gone") return "none";
  if (oe && !oe.ok) return "weak";
  if (d.lowIntensity || (oe && /jr\.? ?nba/i.test(oe.channel || ""))) return "weak";
  return "good";
}
function videoLine(d) {
  const s = status(d), oe = d.yt ? oeCache[d.yt] : null;
  let txt;
  if (!d.video) txt = "<b>No video yet</b>";
  else if (!d.yt) txt = `<b>Link to ${esc(host(d.video))}</b> <span>· can't play here</span>`;
  else if (!oe) txt = `<span>Checking video…</span>`;
  else if (!oe.ok && oe.why === "gone") txt = "<b>Video was removed or made private</b>";
  else if (!oe.ok) txt = "<b>Only plays on YouTube</b> <span>· owner turned off embedding</span>";
  else {
    const jr = /jr\.? ?nba/i.test(oe.channel) || d.lowIntensity;
    txt = `<b>${esc(oe.channel)}</b>${jr ? " <span>· Jr. NBA, lower intensity</span>" : ""}<span> · “${esc(oe.title)}”</span>`;
  }
  return `<div class="vline ${s}"><i class="dot" aria-hidden="true"></i><div>${txt}</div></div>`;
}

function searchLink(d) {
  const who = /dribbl|two ball|handl/i.test(d.category) ? "Billy Clapper " : /dunn/i.test(d.category) ? "Mike Dunn " : /love/i.test(d.category) ? "Dave Love " : "";
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(who + d.name + (who ? "" : " basketball drill"))}`;
}

function usesHtml(d) {
  if (!d.inPlan) return `<span class="use off">Not in any plan${d.active === false ? " · turned off" : ""}</span>`;
  const groups = {};
  d.uses.forEach((u) => { const k = u.type + "|" + u.track; (groups[k] = groups[k] || new Set()).add(u.player); });
  return Object.entries(groups)
    .sort(([a], [b]) => (a.startsWith("must") === b.startsWith("must") ? TRACKS.indexOf(a.split("|")[1]) - TRACKS.indexOf(b.split("|")[1]) : a.startsWith("must") ? -1 : 1))
    .map(([k, who]) => {
      const [type, track] = k.split("|");
      const names = who.size === PLAYERS.length ? "" : ` · ${[...who].join(" & ")}`;
      return `<span class="use ${type}">${type === "must" ? "Must-do" : "Option"} · ${esc(track)}${esc(names)}</span>`;
    }).join("");
}

function card(d) {
  const s = status(d);
  let vid;
  if (d.yt && !(oeCache[d.yt] && oeCache[d.yt].why === "gone")) {
    vid = `<div class="vid" data-yt="${esc(d.yt)}" data-start="${esc(d.start)}">
      <img loading="lazy" src="https://i.ytimg.com/vi/${esc(d.yt)}/mqdefault.jpg" alt="" />
      <button class="play" type="button" aria-label="Play video for ${esc(d.name)}"><span></span></button></div>`;
  } else if (d.video && !d.yt) {
    vid = `<div class="vid out"><div><b>Video on ${esc(host(d.video))}</b><br><a class="find" href="${esc(d.video)}" target="_blank" rel="noopener">Open it</a></div></div>`;
  } else {
    vid = `<div class="vid empty"><div><b>${d.video ? "Video is gone" : "No video yet"}</b><a class="find" href="${esc(searchLink(d))}" target="_blank" rel="noopener">Find one on YouTube</a></div></div>`;
  }
  const meta = [`${d.sets} set${d.sets === 1 ? "" : "s"}${d.perSet ? ` × ${esc(d.perSet)}` : ""}`, `${d.pts} achievement${d.pts === 1 ? "" : "s"} per set`, d.source ? esc(d.source) : ""].filter(Boolean).join(" · ");
  return `<article class="drill s-${s}">
    ${vid}
    <div class="body">
      <h3 class="name">${esc(d.name)}<code>${esc(d.id)}</code></h3>
      <div class="meta">${meta}</div>
      <div class="uses">${usesHtml(d)}</div>
      ${videoLine(d)}
      ${d.cue ? `<p class="cue">${esc(d.cue)}</p>` : ""}
    </div>
  </article>`;
}

// ---------- filters + render ----------
function visible(d) {
  if (F.scope === "plans" && !d.inPlan) return false;
  if (F.track !== "All") {
    if (d.inPlan ? !d.uses.some((u) => u.track === F.track) : !(d.tracks || []).includes(F.track)) return false;
  }
  if (F.kid !== "All" && d.inPlan && !d.uses.some((u) => u.player === F.kid)) return false;
  if (F.status !== "all" && status(d) !== F.status) return false;
  if (F.q) {
    const oe = d.yt ? oeCache[d.yt] : null;
    const hay = [d.name, d.id, d.category, d.source, d.cue, d.perSet, oe && oe.channel, oe && oe.title].join(" ").toLowerCase();
    if (!F.q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}
const catRank = (c) => { const i = CAT_ORDER.indexOf(c); return i === -1 ? 100 : i; };

function render() {
  // stats count everything that passes the non-status filters
  const base = DRILLS.filter((d) => { const s = F.status; F.status = "all"; const ok = visible(d); F.status = s; return ok; });
  const n = { all: base.length, good: 0, weak: 0, none: 0 };
  base.forEach((d) => n[status(d)]++);
  $("#stats").innerHTML = [["all", "Drills", ""], ["good", STATUS_TEXT.good, "good"], ["weak", STATUS_TEXT.weak, "weak"], ["none", STATUS_TEXT.none, "none"]]
    .map(([k, label, cls]) => `<button class="stat ${cls}" type="button" data-status="${k}" aria-pressed="${F.status === k}"><b>${n[k]}</b>${label}</button>`).join("");

  const shown = DRILLS.filter(visible);
  const cats = {};
  shown.forEach((d) => (cats[d.category || "Other"] = cats[d.category || "Other"] || []).push(d));
  const names = Object.keys(cats).sort((a, b) => catRank(a) - catRank(b) || a.localeCompare(b));
  $("#cats").innerHTML = names.map((c) => {
    const gaps = cats[c].some((d) => status(d) === "none");
    return `<button class="cat-chip${gaps ? " has-gaps" : ""}" type="button" data-cat="${esc(c)}">${esc(c)}<i>${cats[c].length}</i></button>`;
  }).join("");
  if (!shown.length) { $("#list").innerHTML = `<div class="lib-empty">No drills match. Try clearing the search or filters.</div>`; return; }
  const sortKey = (d) => (d.uses.some((u) => u.type === "must") ? 0 : d.inPlan ? 1 : 2);
  $("#list").innerHTML = names.map((c, i) => {
    const list = cats[c].sort((a, b) => sortKey(a) - sortKey(b) || a.name.localeCompare(b.name));
    const missing = list.filter((d) => status(d) === "none").length;
    return `<section class="cat" id="cat-${i}" data-cat="${esc(c)}">
      <h2>${esc(c)} <small>${list.length} drill${list.length === 1 ? "" : "s"}${missing ? ` · ${missing} need${missing === 1 ? "s" : ""} a video` : " · all have videos"}</small></h2>
      <div class="grid">${list.map(card).join("")}</div></section>`;
  }).join("");
}

function segs() {
  const seg = (el, key, opts) => {
    $(el).innerHTML = opts.map(([v, label]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${F[key] === v}">${esc(label)}</button>`).join("");
    $(el).onclick = (e) => { const b = e.target.closest("button"); if (!b) return; F[key] = b.dataset.v; segs(); render(); };
  };
  seg("#f-track", "track", [["All", "All tracks"], ...TRACKS.map((t) => [t, t])]);
  if (PLAYERS.length > 1) seg("#f-kid", "kid", [["All", "Both"], ...PLAYERS.map((p) => [p, p])]); else $("#f-kid").hidden = true;
  if (HAS_LIBRARY) {
    if (!$("#f-scope")) { const d = document.createElement("div"); d.className = "seg"; d.id = "f-scope"; $("#f-kid").after(d); }
    seg("#f-scope", "scope", [["plans", "In plans"], ["all", "Whole library"]]);
  }
}

$("#stats").addEventListener("click", (e) => { const b = e.target.closest(".stat"); if (!b) return; F.status = F.status === b.dataset.status ? "all" : b.dataset.status; render(); });
$("#cats").addEventListener("click", (e) => {
  const b = e.target.closest(".cat-chip"); if (!b) return;
  const sec = [...document.querySelectorAll(".cat")].find((s) => s.dataset.cat === b.dataset.cat);
  if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
});
let qT = null;
$("#f-q").addEventListener("input", (e) => { clearTimeout(qT); qT = setTimeout(() => { F.q = e.target.value.trim().toLowerCase(); render(); }, 150); });

// Play inline; only one video at a time.
$("#list").addEventListener("click", (e) => {
  const b = e.target.closest(".play"); if (!b) return;
  stopVideos();
  const v = b.closest(".vid"), start = v.dataset.start;
  v.dataset.playing = "1";
  v.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.dataset.yt)}?autoplay=1&rel=0${start ? `&start=${start}` : ""}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Drill video"></iframe>`;
});
function stopVideos() {
  document.querySelectorAll('.vid[data-playing="1"]').forEach((v) => {
    delete v.dataset.playing;
    v.innerHTML = `<img src="https://i.ytimg.com/vi/${esc(v.dataset.yt)}/mqdefault.jpg" alt="" /><button class="play" type="button" aria-label="Play video"><span></span></button>`;
  });
}

// ---------- nav ----------
$("#nav-back").addEventListener("click", () => { if (history.length > 1) history.back(); else location.href = "../"; });
const fsBtn = $("#nav-fs");
if (document.fullscreenEnabled) {
  fsBtn.hidden = false;
  const label = () => { fsBtn.innerHTML = document.fullscreenElement ? "&#x2715; Exit full screen" : "&#x26F6; Full screen"; };
  fsBtn.addEventListener("click", () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else document.documentElement.requestFullscreen().catch(() => {}); });
  document.addEventListener("fullscreenchange", label);
  label();
}

// ---------- boot ----------
async function boot() {
  let data;
  for (let attempt = 0; attempt < 4; attempt++) {
    data = await HubData.getPlans().catch(() => ({ error: "network" }));
    if (data && !data.error) break;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  if (!data || data.error) { $("#list").innerHTML = `<div class="lib-empty">Couldn't load the drills. Check the Wi-Fi and reload.</div>`; return; }
  PLAYERS = data.players.map((p) => p.name);
  HAS_LIBRARY = !!data.library;
  DRILLS = collect(data);
  segs();
  render();
  // Check every YouTube link (6 at a time), re-rendering as answers come in.
  const ids = [...new Set(DRILLS.filter((d) => d.yt).map((d) => d.yt))].filter((id) => !(oeCache[id] && Date.now() - oeCache[id].at < OE_TTL));
  let pending = false;
  const rerender = () => { if (pending) return; pending = true; setTimeout(() => { pending = false; if (!document.querySelector('.vid[data-playing="1"]')) render(); }, 400); };
  const worker = async () => { while (ids.length) { await oembed(ids.shift()); rerender(); } };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (!document.querySelector('.vid[data-playing="1"]')) render();
}
boot();
