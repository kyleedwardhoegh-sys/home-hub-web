// Hoegh Home Hub v2 — Phase 1 (2026-11-25): Combo home screen + family calendar.
// Plan: G:\My Drive\00Home Hub\Hub v2\Implementation Plan (from family ratings).md
// Data: 'events:week' (4 weeks, every family calendar, who-tags, start/length) published by the Sheet's
// Apps Script into Supabase site_data; falls back to 'events:home' (today + tomorrow) until that's deployed.
// Adding an event posts to the Apps Script (hubAddEvent) which writes to the shared Family Google Calendar.
(function () {
  const APPS_SCRIPT = "https://script.google.com/macros/s/AKfycbyyOY00079KTcqhRtuoE_W_OhRTZGlsHgfSTgryrTl3ZzsVFHwiA54bJ55hu7qChYyxGQ/exec";
  const LAT = 45.0725, LON = -93.4557; // Maple Grove
  const PEOPLE = ["Nellie", "Nash", "Kyle", "Logan"];
  const INIT = { Nellie: "Ne", Nash: "Na", Kyle: "Ky", Logan: "Lo" };
  const KIOSK = new URLSearchParams(location.search).has("kiosk");
  if (KIOSK) document.body.classList.add("kiosk");
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- dates ----------
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const parse = (s) => { const p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); };
  const add = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const monday = (s) => add(s, -((parse(s).getDay() + 6) % 7));
  const today = () => ymd(new Date());
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtMin = (m) => { const h = Math.floor(m / 60), mm = m % 60; return `${(h % 12) || 12}${mm ? ":" + String(mm).padStart(2, "0") : ""}${h < 12 ? "a" : "p"}`; };
  const timeToMin = (t) => { const m = /^(\d+):(\d+)\s*([AP]M)$/i.exec(t || ""); return m ? ((+m[1] % 12) + (/p/i.test(m[3]) ? 12 : 0)) * 60 + +m[2] : null; };

  // ---------- state ----------
  const S = { days: {}, start: null, full: false, view: "week", anchor: today(), filter: null, countdowns: [], last: Date.now() };

  function toast(msg, ms = 2200) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), ms); }

  // ---------- data ----------
  async function loadEvents() {
    const wk = await HubData.rows("site_data", "id=eq.events:week&select=data");
    if (wk && wk[0] && wk[0].data && wk[0].data.days) {
      S.days = wk[0].data.days; S.start = wk[0].data.start; S.full = true;
    } else {
      const home = await HubData.rows("site_data", "id=eq.events:home&select=data");
      const days = (home && home[0] && home[0].data && home[0].data.days) || {};
      S.days = {}; S.full = false;
      for (const [d, list] of Object.entries(days)) {
        S.days[d] = list.map((e) => { const m = timeToMin(e.time); return { ...e, allDay: m === null, startMin: m, durMin: m === null ? null : 60 }; });
      }
    }
    Object.assign(S.days, S.pending || {});
    render();
  }
  async function loadCountdowns() {
    const r = await HubData.rows("countdowns", "removed=eq.false&order=day.asc&select=*");
    if (r) { S.countdowns = r; renderWidgets(); }
  }
  const WX = { 0: ["☀️", "Clear"], 1: ["🌤️", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Cloudy"], 45: ["🌫️", "Fog"], 48: ["🌫️", "Fog"],
    51: ["🌦️", "Drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌧️", "Drizzle"], 61: ["🌦️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"],
    66: ["🌧️", "Freezing rain"], 67: ["🌧️", "Freezing rain"], 71: ["🌨️", "Light snow"], 73: ["❄️", "Snow"], 75: ["❄️", "Heavy snow"], 77: ["❄️", "Snow"],
    80: ["🌦️", "Showers"], 81: ["🌧️", "Showers"], 82: ["⛈️", "Heavy showers"], 85: ["🌨️", "Snow showers"], 86: ["❄️", "Snow showers"], 95: ["⛈️", "Storms"], 96: ["⛈️", "Storms"], 99: ["⛈️", "Storms"] };
  async function loadWeather() {
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`);
      const d = await r.json(), w = WX[d.current.weather_code] || ["🌡️", ""];
      $("wx").textContent = `${w[0]} ${Math.round(d.current.temperature_2m)}° · ${Math.round(d.daily.temperature_2m_max[0])}°/${Math.round(d.daily.temperature_2m_min[0])}°`;
    } catch (e) { $("wx").textContent = ""; }
  }

  const evs = (d) => (S.days[d] || []);
  // color: a kid's event shows in the kid's color even when it's on Mom & Dad's calendars too;
  // Kyle + Logan together (shared Family calendar) = family green; otherwise the one person
  const mainWho = (e) => { const w = (e.who || []).filter((x) => PEOPLE.includes(x));
    return w.find((x) => x === "Nellie" || x === "Nash") || (w.includes("Kyle") && w.includes("Logan") ? "Family" : w[0]); };
  const isMine = (e) => !S.filter || (e.who || []).includes(S.filter);
  function evStyle(e) { const w = mainWho(e); return w ? `--bg:var(--${w}-bg);--c:var(--${w})` : "--bg:var(--none-bg);--c:#9a9aa6"; }
  const whoDots = (e) => `<span class="who">${(e.who || []).filter((w) => PEOPLE.includes(w) && !((e.who.includes("Nellie") || e.who.includes("Nash")) && (w === "Kyle" || w === "Logan"))).map((w) => `<i style="--c:var(--${w})">${INIT[w]}</i>`).join("")}</span>`;

  // ---------- widgets, banners, people ----------
  function tick() {
    const d = new Date();
    $("clock").textContent = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M/, "");
    $("date").textContent = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
    $("sleep-clock").textContent = $("clock").textContent;
  }
  function renderWidgets() {
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes(), t = today();
    const upcoming = evs(t).filter((e) => !e.allDay && e.startMin + (e.durMin || 60) > nowMin)
      .concat(evs(add(t, 1)).filter((e) => !e.allDay).map((e) => ({ ...e, tmrw: true }))).slice(0, 3);
    $("upnext").innerHTML = upcoming.length ? upcoming.map((e) => `<div class="ev-mini" style="${evStyle(e)}"><span>${esc(e.title)}</span><time>${e.tmrw ? "tmrw " : ""}${fmtMin(e.startMin)}</time></div>`).join("")
      : `<div class="empty">Nothing else today 🎉</div>`;
    const next = S.countdowns.find((c) => c.day >= t);
    if (next) {
      const n = Math.round((parse(next.day) - parse(t)) / 864e5);
      $("countdown").innerHTML = `<div class="cd-mini"><b>${n}</b><span>${n === 1 ? "day" : "days"}</span></div><div class="cd-what">${esc(next.emoji || "⏳")} ${esc(next.title)}</div>`;
    } else $("countdown").innerHTML = `<div class="empty">Tap ⏳ in the dock to add one</div>`;
  }
  function holidays(y) {
    const nth = (m, dow, n) => { const d = new Date(y, m, 1); d.setDate(1 + ((dow - d.getDay() + 7) % 7) + (n - 1) * 7); return ymd(d); };
    const last = (m, dow) => { const d = new Date(y, m + 1, 0); d.setDate(d.getDate() - ((d.getDay() - dow + 7) % 7)); return ymd(d); };
    const easter = (() => { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return ymd(new Date(y, mo - 1, da)); })();
    return { [`${y}-01-01`]: "🎉 Happy New Year!", [nth(0, 1, 3)]: "✊ Martin Luther King Jr. Day", [`${y}-02-14`]: "💝 Happy Valentine's Day!", [`${y}-02-17`]: "🎂 Happy birthday, Nellie!",
      [easter]: "✝️ Happy Easter! He is risen!", [nth(4, 0, 2)]: "💐 Happy Mother's Day, Logan!", [last(4, 1)]: "🇺🇸 Memorial Day", [nth(5, 0, 3)]: "👔 Happy Father's Day, Kyle!",
      [`${y}-07-04`]: "🎆 Happy 4th of July!", [nth(8, 1, 1)]: "Labor Day", [`${y}-10-01`]: "🎂 Happy birthday, Nash!", [`${y}-10-31`]: "🎃 Happy Halloween!",
      [nth(10, 4, 4)]: "🦃 Happy Thanksgiving!", [`${y}-12-24`]: "🎄 Merry Christmas Eve!", [`${y}-12-25`]: "🎄 Merry Christmas!", [`${y}-12-31`]: "🥳 Happy New Year's Eve!" };
  }
  function renderBanners() {
    const t = today(), out = [], h = holidays(+t.slice(0, 4))[t];
    if (h) out.push(h);
    evs(t).filter((e) => /birthday|bday|b-day/i.test(e.title)).forEach((e) => out.push(`🎂 ${e.title.replace(/\s*-\s*\d{4}$/, "")}`));
    $("banners").innerHTML = out.map((b) => `<div class="banner">${esc(b)}</div>`).join("");
  }
  function renderPeople() {
    const box = $("people"); box.innerHTML = "";
    box.classList.toggle("filtering", !!S.filter);
    for (const p of PEOPLE) {
      const b = document.createElement("button"); b.className = "bubble" + (S.filter === p ? " on" : "");
      // Skylight-style: each kid's chip shows today's chores done ("2/6"), turning green when finished
      const bd = window.HubApps && window.HubApps.badge ? window.HubApps.badge(p) : null;
      const chip = !bd || !bd.total ? "" : bd.trip ? `<b class="chore-badge">✈️ trip</b>` : bd.done === bd.total ? `<b class="chore-badge all">✓ all done</b>` : `<b class="chore-badge">${bd.done}/${bd.total} chores</b>`;
      b.innerHTML = `<i style="--c:var(--${p})">${INIT[p]}</i><em>${p}</em>${chip}`;
      b.addEventListener("click", () => { S.filter = S.filter === p ? null : p; renderPeople(); renderCal(); if (S.filter) toast(`Showing ${p}'s events · tap again for everyone`, 1600); });
      box.appendChild(b);
    }
  }

  // ---------- calendar ----------
  function setTitle(title, sub) { $("cal-title").textContent = title; $("cal-sub").textContent = sub; }
  // Week = Skylight-style: each day is a column of event cards in time order (all-day first), each showing its time.
  // No hour scale (Kyle, 2026-11-25): a proportional grid this short made back-to-back events overlap or drift
  // off their real times. Cards that don't fit become "+N more" (tap = that day).
  function dayCol(d) {
    const t = today(), dt = parse(d), list = evs(d).slice().sort((a, b) => (a.allDay ? -1 : a.startMin) - (b.allDay ? -1 : b.startMin));
    const cards = list.map((e) => `<div class="ev card${isMine(e) ? "" : " faded"}" data-ev="${esc(d)}|${esc(e.title)}|${e.allDay ? "all" : e.startMin}" style="${evStyle(e)}">
        <time>${e.allDay ? "All day" : fmtMin(e.startMin)}</time><span>${esc(e.title)}</span>${whoDots(e)}</div>`).join("");
    return `<div class="col${d === t ? " today" : ""}"><div class="col-head">${DOW[dt.getDay()]} <b>${dt.getDate()}</b>${d === t ? '<i class="dot"></i>' : ""}</div>
      <div class="cards" data-day="${d}">${cards}</div></div>`;
  }
  // after drawing: hide the cards that don't fit and say how many more there are
  function fitCards(root) {
    for (const box of root.querySelectorAll(".cards")) {
      const cards = [...box.querySelectorAll(".card")];
      if (box.scrollHeight <= box.clientHeight + 1) continue;
      const more = document.createElement("div"); more.className = "more-card"; box.appendChild(more);
      let hidden = 0;
      while (cards.length && box.scrollHeight > box.clientHeight + 1) { cards.pop().hidden = true; hidden++; more.textContent = `+${hidden} more`; }
    }
  }  // phones: the week is a simple day-by-day list (the time grid needs the big screen)
  function renderAgenda(s) {
    const days = Array.from({ length: 7 }, (_, k) => add(s, k)), t = today();
    return `<div class="day-list">${days.map((d) => { const dt = parse(d), list = evs(d).filter(isMine);
      return `<h4 class="ag-day${d === t ? " today" : ""}">${dt.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</h4>` +
        (list.length ? list.map((e) => `<div class="row-ev" data-ev="${esc(d)}|${esc(e.title)}|${e.allDay ? "all" : e.startMin}" style="${evStyle(e)}"><time>${e.allDay ? "All day" : fmtMin(e.startMin)}</time><b>${esc(e.title)}</b>${whoDots(e)}</div>`).join("")
          : `<div class="ag-none">Nothing</div>`); }).join("")}</div>`;
  }
  function renderWeek() {
    const s = monday(S.anchor), days = Array.from({ length: 7 }, (_, k) => add(s, k));
    const e = parse(add(s, 6));
    setTitle(s === monday(today()) ? "This week" : s === add(monday(today()), 7) ? "Next week" : s === add(monday(today()), -7) ? "Last week" : "Week of",
      `${MON[parse(s).getMonth()]} ${parse(s).getDate()} – ${MON[e.getMonth()]} ${e.getDate()}` + (S.full ? "" : " · today & tomorrow for now"));
    const nextWk = add(s, 7), peek = Array.from({ length: 7 }, (_, k) => add(nextWk, k)).flatMap((d) => evs(d).map((e) => ({ ...e, d }))).filter(isMine).slice(0, 6);
    const hoursRow = (list, extra) => `<div class="wk-row"><div class="cols">${list.map((d) => dayCol(d)).join("")}${extra || ""}</div></div>`;
    const next = `<div class="next-col"><h4>Next week ›</h4>${peek.map((e) => `<div class="ev chip" style="${evStyle(e)}"><span>${DOW[parse(e.d).getDay()]} ${esc(e.title)}</span></div>`).join("") || '<span style="font-size:13px;color:#9a9aa6">Nothing yet</span>'}</div>`;
    if (innerWidth < 600) return renderAgenda(s);
    return `<div class="wk">${hoursRow(days.slice(0, 4))}${hoursRow(days.slice(4), next)}</div>`;
  }
  function renderDay() {
    const d = S.anchor, dt = parse(d), list = evs(d).filter(isMine);
    setTitle(d === today() ? "Today" : d === add(today(), 1) ? "Tomorrow" : dt.toLocaleDateString([], { weekday: "long" }), `${dt.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}`);
    if (!list.length) return `<div class="day-list"><div class="none">${S.full || d <= add(today(), 1) ? "Nothing on the calendar 🎉" : "Not loaded yet"}</div></div>`;
    return `<div class="day-list">${list.map((e) => `<div class="row-ev" data-ev="${esc(d)}|${esc(e.title)}|${e.allDay ? "all" : e.startMin}" style="${evStyle(e)}">
      <time>${e.allDay ? "All day" : fmtMin(e.startMin)}</time><b>${esc(e.title)}${e.location ? `<small>📍 ${esc(e.location)}</small>` : ""}</b>${whoDots(e)}</div>`).join("")}</div>`;
  }
  function renderMonth() {
    const a = parse(S.anchor), first = ymd(new Date(a.getFullYear(), a.getMonth(), 1)), start = monday(first), t = today();
    setTitle(`${a.toLocaleDateString([], { month: "long" })}`, `${a.getFullYear()}${S.full ? " · next 4 weeks are filled in" : ""}`);
    let html = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="mhead">${d}</div>`).join("");
    for (let k = 0; k < 42; k++) {
      const d = add(start, k), dt = parse(d), list = evs(d).filter(isMine);
      html += `<div class="mday${dt.getMonth() !== a.getMonth() ? " out" : ""}${d === t ? " today" : ""}" data-day="${d}"><b>${dt.getDate()}</b>${list.slice(0, 3).map((e) => `<span class="pill" style="${evStyle(e)}">${esc(e.title)}</span>`).join("")}${list.length > 3 ? `<span class="more">+${list.length - 3} more</span>` : ""}</div>`;
    }
    return `<div class="month">${html}</div>`;
  }
  function renderCal(dir) {
    const body = $("cal-body");
    body.innerHTML = S.view === "week" ? renderWeek() : S.view === "day" ? renderDay() : renderMonth();
    for (const b of document.querySelectorAll("#view-seg button")) b.classList.toggle("on", b.dataset.v === S.view);
    if (S.view === "week") fitCards(body);
    if (dir) { body.style.transition = "none"; body.style.transform = `translateX(${dir * 60}px)`; body.style.opacity = 0; requestAnimationFrame(() => { body.style.transition = ""; body.style.transform = ""; body.style.opacity = 1; }); }
  }
  function render() { renderWidgets(); renderBanners(); renderPeople(); renderCal(); }
  function step(n) {
    if (S.view === "week") S.anchor = add(S.anchor, 7 * n);
    else if (S.view === "day") S.anchor = add(S.anchor, n);
    else { const a = parse(S.anchor); S.anchor = ymd(new Date(a.getFullYear(), a.getMonth() + n, 1)); }
    renderCal(n);
  }
  // the card fit depends on the calendar's height, which changes when the weather/banners load: redo it then
  let lastH = 0;
  new ResizeObserver(() => { const h = $("cal-body").clientHeight; if (h !== lastH) { lastH = h; if (S.view === "week") renderCal(); } }).observe($("cal-body"));
  $("prev").addEventListener("click", () => step(-1));
  $("next").addEventListener("click", () => step(1));
  $("today").addEventListener("click", () => { S.anchor = today(); renderCal(); });
  $("view-seg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.view = b.dataset.v; if (S.view !== "month") S.anchor = S.view === "day" && S.anchor < today() ? today() : S.anchor; renderCal(); });
  // swipe the calendar like paging photos
  let sw = null;
  $("cal-body").addEventListener("pointerdown", (e) => { sw = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  $("cal-body").addEventListener("pointerup", (e) => {
    if (!sw) return; const dx = e.clientX - sw.x, dy = e.clientY - sw.y, v = Math.abs(dx) / Math.max(1, performance.now() - sw.t); sw = null;
    if (Math.abs(dx) > Math.abs(dy) * 1.5 && (Math.abs(dx) > 80 || v > 0.6)) { step(dx < 0 ? 1 : -1); return; }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const ev = e.target.closest("[data-ev]"); if (ev) { showEvent(ev.dataset.ev); return; }
      const md = e.target.closest("[data-day]"); if (md) { S.view = "day"; S.anchor = md.dataset.day; renderCal(); return; }
    }
  });
  function showEvent(key) {
    const [d, title, start] = key.split("|"), e = evs(d).find((x) => x.title === title && (start === "all" ? x.allDay : String(x.startMin) === start));
    if (!e) return;
    const dt = parse(d);
    $("ev-detail").innerHTML = `<div class="detail"><h3>${esc(e.title)}</h3><p>${dt.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} · ${e.allDay ? "All day" : `${fmtMin(e.startMin)} – ${fmtMin(e.startMin + e.durMin)}`}</p>
      ${e.location ? `<p>📍 ${esc(e.location)}</p>` : ""}${(e.who || []).length ? `<p>For ${esc(e.who.join(", "))}</p>` : ""}${e.link ? `<p><a href="${esc(e.link)}" target="${KIOSK ? "_self" : "_blank"}">Open in Google Calendar</a></p>` : ""}</div>`;
    openSheet("sheet-ev");
  }

  // ---------- sheets ----------
  function openSheet(id) { closeSheets(); $(id).hidden = false; }
  function closeSheets() { for (const s of document.querySelectorAll(".sheet")) s.hidden = true; stopMic(); }
  for (const s of document.querySelectorAll(".sheet")) s.addEventListener("click", (e) => { if (e.target === s) closeSheets(); });
  $("ev-close").addEventListener("click", closeSheets);

  // ---------- add an event (voice first) ----------
  const NEW = { who: [], day: today(), start: "", minutes: 60 };
  function chip(label, on, fn, cls = "", style = "") { const b = document.createElement("button"); b.className = `chip-btn ${cls}${on ? " on" : ""}`; b.textContent = label; if (style) b.setAttribute("style", style); b.addEventListener("click", fn); return b; }
  function drawAdd() {
    const who = $("ev-who"); who.innerHTML = "";
    PEOPLE.forEach((p) => who.appendChild(chip(p, NEW.who.includes(p), () => { NEW.who = NEW.who.includes(p) ? NEW.who.filter((x) => x !== p) : [...NEW.who, p]; drawAdd(); }, "person", `--c:var(--${p})`)));
    const day = $("ev-day"); day.innerHTML = "";
    for (let k = 0; k < 21; k++) { const d = add(today(), k), dt = parse(d); day.appendChild(chip(k === 0 ? "Today" : k === 1 ? "Tomorrow" : `${DOW[dt.getDay()]} ${MON[dt.getMonth()]} ${dt.getDate()}`, NEW.day === d, () => { NEW.day = d; drawAdd(); })); }
    const time = $("ev-time"); time.innerHTML = "";
    time.appendChild(chip("All day", !NEW.start, () => { NEW.start = ""; drawAdd(); }));
    for (let m = 6 * 60; m <= 21 * 60 + 30; m += 30) { const v = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; time.appendChild(chip(fmtMin(m).replace("a", " AM").replace("p", " PM"), NEW.start === v, () => { NEW.start = v; drawAdd(); })); }
    const len = $("ev-len"); len.innerHTML = "";
    [[30, "30 min"], [60, "1 hr"], [90, "1½ hr"], [120, "2 hr"], [180, "3 hr"]].forEach(([m, l]) => len.appendChild(chip(l, NEW.minutes === m, () => { NEW.minutes = m; drawAdd(); })));
    $("ev-len").parentElement && ($("ev-len").style.opacity = NEW.start ? 1 : .35);
    requestAnimationFrame(() => { for (const id of ["ev-day", "ev-time"]) { const on = $(id).querySelector(".on"); if (on) on.scrollIntoView({ inline: "center", block: "nearest" }); } });
  }
  function openAdd() { NEW.who = S.filter ? [S.filter] : []; NEW.day = S.view === "day" && S.anchor >= today() ? S.anchor : today(); NEW.start = ""; NEW.minutes = 60; $("ev-title").textContent = ""; drawAdd(); openSheet("sheet-add"); }
  $("add").addEventListener("click", openAdd);
  $("add-cancel").addEventListener("click", closeSheets);
  // understand "Nash practice Tuesday at 6", "dentist tomorrow 8:30 am for Nellie"
  function understand(text) {
    let t = " " + text.toLowerCase() + " ";
    PEOPLE.forEach((p) => { if (t.includes(" " + p.toLowerCase() + " ") || t.includes(" " + p.toLowerCase() + "'s ")) { if (!NEW.who.includes(p)) NEW.who.push(p); } });
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    if (/\btoday\b|\btonight\b/.test(t)) NEW.day = today();
    else if (/\btomorrow\b/.test(t)) NEW.day = add(today(), 1);
    else { const k = days.findIndex((d) => t.includes(d)); if (k >= 0) { const n = ((k - new Date().getDay()) + 7) % 7 || 7; NEW.day = add(today(), /next /.test(t) ? n + 7 : n); } }
    const m = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|o'?clock)?\b/.exec(t.replace(/\b(today|tomorrow|tonight)\b/g, ""));
    if (/\bnoon\b/.test(t)) NEW.start = "12:00";
    else if (m && (m[2] || m[3] || /\bat\s+\d/.test(t)) && +m[1] >= 1 && +m[1] <= 12) {
      let h = +m[1]; const pm = m[3] ? /p/.test(m[3]) : (h >= 1 && h <= 7) || /\bnight|evening|afternoon\b/.test(t);
      if (pm && h < 12) h += 12; if (m[3] && /a/.test(m[3]) && h === 12) h = 0;
      NEW.start = `${h}:${m[2] || "00"}`;
    }
    // what's left is the title
    let title = text.replace(new RegExp(`\\b(for|with)\\s+(${PEOPLE.join("|")})\\b`, "gi"), "").replace(/\b(at|on|for|this|next)?\s*(today|tomorrow|tonight|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, "")
      .replace(/\b(at\s+)?\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?|o'?clock)?\b/gi, "").replace(/\bnoon\b/gi, "").replace(/\s{2,}/g, " ").trim();
    title = title.replace(/^(add|put|schedule)\s+/i, "").replace(/\s+(at|on|for)$/i, "");
    return title ? title[0].toUpperCase() + title.slice(1) : "";
  }
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  if (!Speech) $("mic").hidden = true;
  function stopMic() { if (rec) { try { rec.stop(); } catch (e) {} } }
  $("mic").addEventListener("click", () => {
    if (rec) return stopMic();
    rec = new Speech(); rec.lang = "en-US"; rec.interimResults = true;
    $("mic").classList.add("live"); $("mic-label").textContent = "Listening… tap to stop";
    let finalText = "";
    rec.onresult = (e) => { let interim = ""; for (let k = e.resultIndex; k < e.results.length; k++) { if (e.results[k].isFinal) finalText += e.results[k][0].transcript; else interim += e.results[k][0].transcript; } $("ev-title").textContent = finalText + interim; };
    rec.onerror = (e) => toast(e.error === "not-allowed" ? "Microphone is blocked" : e.error === "no-speech" ? "Didn't hear anything" : "Mic problem: " + e.error);
    rec.onend = () => { rec = null; $("mic").classList.remove("live"); $("mic-label").textContent = "Tap to say it again"; if (finalText) { $("ev-title").textContent = understand(finalText); drawAdd(); } };
    try { rec.start(); } catch (e) { rec = null; }
  });
  $("add-save").addEventListener("click", async () => {
    const title = $("ev-title").textContent.trim();
    if (!title) return toast("Say or type what it is");
    const body = { action: "hubAddEvent", title, date: NEW.day, start: NEW.start, minutes: NEW.minutes, who: NEW.who, by: S.filter || "" };
    $("add-save").disabled = true; $("add-save").textContent = "Adding…";
    let r = null;
    try { r = await (await fetch(APPS_SCRIPT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body) })).json(); } catch (e) {}
    $("add-save").disabled = false; $("add-save").textContent = "Add to calendar";
    if (r && r.ok) {
      const m = NEW.start ? +NEW.start.split(":")[0] * 60 + +NEW.start.split(":")[1] : null;
      const e = { title: r.title || title, allDay: m === null, startMin: m, durMin: m === null ? null : NEW.minutes, who: NEW.who, time: m === null ? "" : fmtMin(m) };
      (S.days[NEW.day] ||= []).push(e); (S.pending ||= {})[NEW.day] = S.days[NEW.day];
      closeSheets(); toast("Added to the family calendar ✓"); render();
      setTimeout(() => { S.pending = null; loadEvents(); }, 15000);
    } else toast(r && r.error === "daily limit" ? "That's a lot of events today. Try again tomorrow." : "Couldn't add it yet. Dad needs to install the calendar update.", 3500);
  });

  // ---------- countdowns ----------
  function drawCountdowns() {
    const t = today(), list = $("count-list");
    list.innerHTML = S.countdowns.filter((c) => c.day >= t).map((c) => { const n = Math.round((parse(c.day) - parse(t)) / 864e5); return `<div class="count-row"><b>${n}</b><span>${esc(c.emoji || "⏳")} ${esc(c.title)}<br><small style="color:var(--dim)">${parse(c.day).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</small></span><button data-rm="${esc(c.id)}">Remove</button></div>`; }).join("") || '<div class="empty">No countdowns yet</div>';
  }
  $("count-list").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-rm]"); if (!b) return;
    const c = S.countdowns.find((x) => x.id === b.dataset.rm); if (!c) return;
    await HubData.save("countdowns", [{ ...c, removed: true }]); S.countdowns = S.countdowns.filter((x) => x !== c); drawCountdowns(); renderWidgets();
  });
  $("cd-save").addEventListener("click", async () => {
    const title = $("cd-title").textContent.trim(), day = $("cd-day").value;
    if (!title || !day) return toast("Type what it is and pick a date");
    const row = { id: `${day}|${title}`.slice(0, 120), title, day, emoji: /christmas/i.test(title) ? "🎄" : /trip|vacation|florida|beach/i.test(title) ? "✈️" : /birthday/i.test(title) ? "🎂" : /tournament|game/i.test(title) ? "🏆" : "⏳", removed: false, added_by: S.filter || null };
    if (!(await HubData.save("countdowns", [row]))) return toast("Didn't save. Try again.");
    S.countdowns.push(row); S.countdowns.sort((a, b) => a.day.localeCompare(b.day)); $("cd-title").textContent = ""; drawCountdowns(); renderWidgets(); toast("Countdown added ⏳");
  });
  $("cd-close").addEventListener("click", closeSheets);

  // ---------- dock ----------
  document.querySelector(".dock").addEventListener("click", (e) => {
    const b = e.target.closest(".app"); if (!b) return;
    if (b.dataset.app === "calendar") { S.view = "week"; S.anchor = today(); S.filter = null; render(); }
    else if (b.dataset.app === "countdowns") { drawCountdowns(); $("cd-day").value = add(today(), 7); openSheet("sheet-count"); }
    else if (window.HubApps && window.HubApps[b.dataset.app]) window.HubApps[b.dataset.app].open();
    else toast(`${b.dataset.what} come${/s$/.test(b.dataset.what) ? "" : "s"} in the next phase`);
  });

  // ---------- iPhone-style gestures: home bar, control center ----------
  const appOpen = () => window.HubApps && Object.values(window.HubApps).some((a) => a && a.isOpen && a.isOpen());
  function closeApps() { if (window.HubApps) Object.values(window.HubApps).forEach((a) => a && a.close && a.close()); }
  function goHome() { closeSheets(); closeApps(); $("cc").hidden = true; S.view = "week"; S.anchor = today(); S.filter = null; render(); }
  let g = null;
  document.addEventListener("pointerdown", (e) => {
    S.last = Date.now();
    if (!$("sleep").hidden) return;
    if (!$("cc").hidden) return;
    if (e.clientX > innerWidth - 150 && e.clientY < 80) g = { t: "cc", y: e.clientY };
    else if (e.target.closest("#homebar")) g = { t: "home", y: e.clientY };
  }, true);
  document.addEventListener("pointerup", (e) => {
    if (!g) return; const dy = e.clientY - g.y, t = g.t; g = null;
    if (t === "cc" && dy > 60) $("cc").hidden = false;
    if (t === "home" && (dy < -30 || Math.abs(dy) < 8)) goHome();
  }, true);
  $("cc").addEventListener("click", (e) => {
    if (e.target === $("cc") || e.target.classList.contains("cc-hint")) { $("cc").hidden = true; return; }
    const b = e.target.closest("[data-cc]"); if (!b) return;
    $("cc").hidden = true;
    if (b.dataset.cc === "home") goHome();
    if (b.dataset.cc === "add") { closeApps(); openAdd(); }
    if (b.dataset.cc === "stars" && window.HubApps && window.HubApps.stars) window.HubApps.stars.open();
    if (b.dataset.cc === "training" && window.HubApps && window.HubApps.training) { closeApps(); window.HubApps.training.open(); }
    if (b.dataset.cc === "reload") location.reload();
    if (b.dataset.cc === "ideas") location.href = KIOSK ? "http://localhost:8790/" : "https://home-hub-web-hoegh-home.vercel.app/hub/";
    if (b.dataset.cc === "chorequiz") location.href = "http://localhost:8790/?deck=chores";   // kitchen PC only (2026-11-26)
    if (b.dataset.cc === "starsquiz") location.href = "http://localhost:8790/?deck=stars";
    if (b.dataset.cc === "checkinquiz") location.href = "http://localhost:8790/?deck=checkin";   // 2026-11-27
    if (b.dataset.cc === "trainingquiz") location.href = "http://localhost:8790/?deck=training";
    if (b.dataset.cc === "kitchenquiz") location.href = "http://localhost:8790/?deck=kitchen";
  });
  let ccy = null;
  $("cc").addEventListener("pointerdown", (e) => { ccy = e.clientY; });
  $("cc").addEventListener("pointerup", (e) => { if (ccy !== null && ccy - e.clientY > 60) $("cc").hidden = true; ccy = null; });
  if (!KIOSK) document.querySelector('[data-cc="ideas"]').hidden = true;
  if (!KIOSK) for (const q of ["chorequiz", "starsquiz", "checkinquiz", "trainingquiz", "kitchenquiz"]) document.querySelector(`[data-cc="${q}"]`).hidden = true;
  // hold to close the kiosk (asks the small helper on the kitchen PC)
  let holdT = null; const ring = document.querySelector("#cc-exit .ring");
  $("cc-exit").addEventListener("pointerdown", () => { const t0 = performance.now(); holdT = setInterval(() => { const p = Math.min(1, (performance.now() - t0) / 2000); ring.style.setProperty("--p", p * 100 + "%");
    if (p >= 1) { clearInterval(holdT); exitKiosk(); } }, 30); });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) $("cc-exit").addEventListener(ev, () => { clearInterval(holdT); ring.style.setProperty("--p", "0%"); });
  function exitKiosk() { toast("Closing…"); fetch("http://localhost:8790/api/exit", { method: "POST" }).catch(() => toast("Couldn't reach the kitchen PC helper")); }
  // Swipe in from the right edge to leave the Home Hub (kitchen kiosk only, 2026-11-27).
  // The tab follows the finger; pull it about a third of the way across and let go. A short brush does nothing.
  // On the desktop, the "swipe back in" strip (hub-v2\swipe-in.pyw) does the reverse.
  if (KIOSK) {
    const strip = document.createElement("div"); strip.className = "exit-edge";
    const tab = document.createElement("div"); tab.className = "exit-tab"; tab.innerHTML = "<b>⏻</b><span>Pull to leave</span>";
    document.body.append(strip, tab);
    const label = tab.querySelector("span"), need = () => Math.min(380, innerWidth * 0.33);
    let id = null, x0 = 0, armed = false;
    strip.addEventListener("pointerdown", (e) => { if (!e.isPrimary || id !== null) return; id = e.pointerId; x0 = e.clientX; try { strip.setPointerCapture(id); } catch (_) {} tab.style.top = Math.max(120, Math.min(innerHeight - 160, e.clientY)) + "px"; tab.classList.add("drag"); });
    strip.addEventListener("pointermove", (e) => { if (e.pointerId !== id) return; const p = Math.max(0, x0 - e.clientX); tab.style.setProperty("--pull", p + "px"); armed = p >= need(); tab.classList.toggle("armed", armed); label.textContent = armed ? "Let go to leave" : "Pull to leave"; });
    const end = (e) => { if (e.pointerId !== id) return; id = null; tab.classList.remove("drag", "armed"); tab.style.setProperty("--pull", "0px"); label.textContent = "Pull to leave"; if (armed && e.type === "pointerup") exitKiosk(); armed = false; };
    strip.addEventListener("pointerup", end); strip.addEventListener("pointercancel", end);
  }

  // ---------- night sleep (kitchen screen only): dark 11 PM – 5 AM, tap to wake for 2 minutes ----------
  let wokeAt = 0;
  function sleepCheck() {
    if (!KIOSK) return;
    const h = new Date().getHours(), night = h >= 23 || h < 5;
    $("sleep").hidden = !(night && Date.now() - wokeAt > 120000 && Date.now() - S.last > 120000);
  }
  $("sleep").addEventListener("click", () => { wokeAt = Date.now(); $("sleep").hidden = true; });

  // ---------- start + refresh ----------
  tick(); setInterval(tick, 5000);
  render();
  loadEvents(); loadCountdowns(); loadWeather();
  setInterval(() => { loadEvents(); loadCountdowns(); }, 5 * 60 * 1000);
  setInterval(loadWeather, 15 * 60 * 1000);
  setInterval(() => {
    sleepCheck(); renderWidgets();
    // kitchen screen: back to this week after 3 minutes untouched; roll over at midnight
    if (KIOSK && Date.now() - S.last > 180000 && (appOpen() || S.view !== "week" || S.anchor !== today() || S.filter || !$("cc").hidden || document.querySelector(".sheet:not([hidden])"))) goHome();
  }, 30000);
  window.hub = { S, understand, NEW, toast, renderPeople };
})();
