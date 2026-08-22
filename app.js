const API_BASE = "https://script.google.com/macros/s/AKfycbyyOY00079KTcqhRtuoE_W_OhRTZGlsHgfSTgryrTl3ZzsVFHwiA54bJ55hu7qChYyxGQ/exec";

const state = {
  kid: null,
  assignments: [],
};

// ---------- API ----------

async function apiGet(action, params = {}) {
  const url = new URL(API_BASE);
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  // Cache-bust: Apps Script's redirect hop can otherwise get reused by the
  // browser for an identical URL, serving a stale snapshot after a write.
  url.searchParams.set("_t", Date.now());
  const res = await fetch(url.toString(), { cache: "no-store" });
  return res.json();
}

// Apps Script doPost doesn't handle CORS preflight, so this POST must stay
// a "simple request" — text/plain avoids the preflight the JSON content
// type would trigger. The script JSON.parses the body regardless.
async function apiMarkComplete(date, kid, exercise, resultValue) {
  const res = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: "markComplete", date, kid, exercise, resultValue }),
  });
  return res.json();
}

// ---------- YouTube helpers ----------

function extractYouTubeId(url) {
  if (!url) return null;
  const patterns = [
    /youtu\.be\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/,
    /[?&]v=([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

function thumbUrl(youtubeLink) {
  const id = extractYouTubeId(youtubeLink);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : "";
}

function embedUrl(youtubeLink) {
  const id = extractYouTubeId(youtubeLink);
  return id ? `https://www.youtube.com/embed/${id}?autoplay=1` : "";
}

// ---------- View switching ----------

function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  // Hiding a view via CSS doesn't stop an expanded card's YouTube iframe
  // from playing - only removing it from the DOM does. Without this, audio
  // keeps going in the background after navigating away (e.g. tapping back
  // to kid-select mid-video).
  document.querySelectorAll(".workout-card.expanded").forEach((c) => {
    c.classList.remove("expanded");
    c.querySelector(".video-slot").innerHTML = "";
  });
}

// ---------- Kid select ----------

document.querySelectorAll(".kid-tile").forEach((tile) => {
  tile.addEventListener("click", () => openKid(tile.dataset.kid));
});

async function openKid(kid) {
  state.kid = kid;
  document.getElementById("today-kid-name").textContent = `${kid}'s Workouts`;
  showView("view-today");
  await loadToday();
}

document.getElementById("btn-back-to-select").addEventListener("click", () => {
  state.kid = null;
  showView("view-select");
});

// ---------- Today's workout ----------

async function loadToday() {
  const listEl = document.getElementById("today-list");
  const emptyEl = document.getElementById("today-empty");
  listEl.innerHTML = "";

  const all = await apiGet("getAssignments");
  state.assignments = all.filter((a) => a.kid === state.kid);

  if (state.assignments.length === 0) {
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  state.assignments.forEach((a, idx) => {
    listEl.appendChild(renderCard(a, idx));
  });
}

function renderCard(a, idx) {
  const card = document.createElement("div");
  card.className = "workout-card" + (a.done ? " done" : "");
  card.dataset.idx = idx;

  const thumb = thumbUrl(a.youtubeLink);

  card.innerHTML = `
    <div class="card-main">
      <div class="card-thumb" style="background-image:url('${thumb}')"></div>
      <div class="card-body">
        <span class="card-category">${a.category || ""}</span>
        <p class="card-title">${a.exercise}</p>
        <p class="card-meta">${a.sets} sets &times; ${a.reps} reps${a.done ? " — done" + (a.resultValue ? `: ${a.resultValue}` : "") : ""}</p>
      </div>
      <button class="card-complete-btn ${a.done ? "done" : ""}" aria-label="Mark complete">
        <span class="complete-circle">✓</span>
      </button>
    </div>
    <div class="card-video">
      <button class="video-close-btn" aria-label="Close video">✕</button>
      <div class="video-slot"></div>
    </div>
    <button class="card-progress-link">View progress →</button>
  `;

  card.querySelector(".card-main").addEventListener("click", (e) => {
    if (e.target.closest(".card-complete-btn")) return;
    toggleExpand(card, a);
  });

  card.querySelector(".video-close-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleExpand(card, a);
  });

  card.querySelector(".card-complete-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    if (a.done) return;
    handleCompleteTap(a);
  });

  card.querySelector(".card-progress-link").addEventListener("click", (e) => {
    e.stopPropagation();
    openProgress(a);
  });

  return card;
}

function toggleExpand(card, a) {
  const wasExpanded = card.classList.contains("expanded");
  document.querySelectorAll(".workout-card.expanded").forEach((c) => {
    c.classList.remove("expanded");
    c.querySelector(".video-slot").innerHTML = "";
  });
  if (!wasExpanded) {
    card.classList.add("expanded");
    const url = embedUrl(a.youtubeLink);
    if (url) {
      card.querySelector(".video-slot").innerHTML =
        `<iframe src="${url}" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
    }
  }
}

function handleCompleteTap(a) {
  if (a.resultType && a.resultType !== "None") {
    openResultOverlay(a);
  } else {
    completeExercise(a, null);
  }
}

async function completeExercise(a, resultValue) {
  await apiMarkComplete(a.date, a.kid, a.exercise, resultValue);
  a.done = true;
  a.resultValue = resultValue;
  celebrate();
  await loadToday();
}

// ---------- Result entry overlay ----------

let pendingResultExercise = null;

function openResultOverlay(a) {
  pendingResultExercise = a;
  document.getElementById("result-overlay-title").textContent = `${a.exercise}`;
  document.getElementById("result-overlay-unit").textContent = `Enter ${a.resultType.toLowerCase()}`;
  document.getElementById("result-input").value = "";
  document.getElementById("result-overlay").hidden = false;
}

document.querySelectorAll(".numpad-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById("result-input");
    const key = btn.dataset.key;
    if (key === "back") {
      input.value = input.value.slice(0, -1);
    } else if (key === "." && input.value.includes(".")) {
      // only one decimal point allowed
    } else {
      input.value += key;
    }
  });
});

document.getElementById("result-cancel").addEventListener("click", () => {
  document.getElementById("result-overlay").hidden = true;
  pendingResultExercise = null;
});

document.getElementById("result-confirm").addEventListener("click", async () => {
  const val = document.getElementById("result-input").value.trim();
  document.getElementById("result-overlay").hidden = true;
  if (pendingResultExercise) {
    await completeExercise(pendingResultExercise, val || null);
    pendingResultExercise = null;
  }
});

// ---------- Celebration ----------

function celebrate() {
  const el = document.getElementById("celebration");
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 700);
}

// ---------- Progress ----------

document.getElementById("btn-back-to-today").addEventListener("click", () => {
  showView("view-today");
});

async function openProgress(a) {
  document.getElementById("progress-exercise-name").textContent = a.exercise;
  showView("view-progress");
  const contentEl = document.getElementById("progress-content");
  contentEl.innerHTML = "<p class='chart-empty'>Loading…</p>";

  const points = await apiGet("getProgress", { kid: a.kid, exercise: a.exercise });

  if (a.resultType === "None" || points.every((p) => p.value === "" || p.value == null)) {
    contentEl.innerHTML = `
      <div class="chart-wrap">
        <p class="chart-latest">Completed ${points.length} time${points.length === 1 ? "" : "s"} so far. Keep it up!</p>
      </div>`;
    return;
  }

  contentEl.innerHTML = `<div class="chart-wrap">${renderLineChart(points)}</div>
    <p class="chart-latest">${points.length} logged result${points.length === 1 ? "" : "s"}</p>`;
}

function renderLineChart(points) {
  const values = points.map((p) => parseFloat(p.value)).filter((v) => !isNaN(v));
  if (values.length === 0) return `<p class="chart-empty">No numeric results logged yet.</p>`;

  const w = 640, h = 300, pad = 36;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;

  const coords = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y];
  });

  const pathD = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const dots = coords.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="#0f9b8e" />`).join("");

  return `
    <svg class="progress-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="#e2e2e6" stroke-width="2" />
      <path d="${pathD}" fill="none" stroke="#0f9b8e" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" />
      ${dots}
    </svg>`;
}

// ---- Touch-only kiosk exit: hold the bottom-right corner for 3s ----
// Same mechanism as home-hub-dashboard (see that repo's HANDOFF.md for the
// full setup/registration details) - lets Kyle exit the kiosk from inside
// this app too, not just from the dashboard's home screen. Deliberately
// unmarked so it isn't something Nash or Nellie stumble into.
const EXIT_HOLD_MS = 3000;
const EXIT_ZONE_SIZE = 80; // px, bottom-right square
const exitHoldIndicator = document.getElementById("exit-hold-indicator");
let exitHoldTimer = null;

function inExitZone(x, y) {
  return x > window.innerWidth - EXIT_ZONE_SIZE && y > window.innerHeight - EXIT_ZONE_SIZE;
}

function startExitHold(e) {
  if (!inExitZone(e.clientX, e.clientY)) return;
  exitHoldIndicator.classList.add("active");
  exitHoldTimer = setTimeout(() => {
    window.location.href = "homehubadmin://exit";
  }, EXIT_HOLD_MS);
}

function cancelExitHold() {
  clearTimeout(exitHoldTimer);
  exitHoldTimer = null;
  exitHoldIndicator.classList.remove("active");
}

document.addEventListener("pointerdown", startExitHold);
document.addEventListener("pointerup", cancelExitHold);
document.addEventListener("pointercancel", cancelExitHold);
document.addEventListener("pointermove", (e) => {
  if (exitHoldTimer && !inExitZone(e.clientX, e.clientY)) cancelExitHold();
});
