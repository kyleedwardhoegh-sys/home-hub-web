/* Home Hub gesture kit (2026-11-23). Shared by home-hub-dashboard and HomeHub-Web.
 *
 *   <link rel="stylesheet" href="https://home-hub-web-hoegh-home.vercel.app/kit/touch.css">
 *   <script src="https://home-hub-web-hoegh-home.vercel.app/kit/touch.js"></script>
 *
 * Rules it follows: "Touch & portrait design standard" in G:\My Drive\00Home Hub\CLAUDE.md.
 * One finger first, every gesture has a visible cue, tap still works everywhere,
 * a second finger cancels a swipe (two kids touching at once don't fight),
 * content follows the finger 1:1 and settles with a spring (transform only).
 *
 * API (window.HubTouch):
 *   swipeStack(el, {start, onChange, hintKey})   card carousel with peeking neighbours + dots
 *   swipeRows(list, {right, left, onAction, onUndo, tapToggles})   swipe right = done, left = snooze/remove, 5 s undo
 *   homeHandle({href, onHome})                   bottom-centre handle: swipe up or tap = home
 *   edgeBack({href, onBack})                     swipe in from left edge, or tap the ‹ chip = back
 *   nav(opts)                                    homeHandle + edgeBack together
 *   longPress(el, fn, {ms})                      500 ms hold with a filling ring
 *   pullRefresh(scroller, fn)                    pull down at the top of a list; fn may return a Promise
 *   pinchZoom(el, {levels, start, onLevel})      pinch/spread steps through levels (e.g. day/week/month)
 *   kioskMode()                                  kill browser zoom, overscroll, context menu, image drags
 *   toast(msg, undoFn, ms) · pop(freq) · resetHints() · auto(root) · isKiosk
 * Every gesture also fires a bubbling DOM event: ht:change, ht:action, ht:undo, ht:longpress, ht:zoom, ht:refresh.
 */
(function () {
  'use strict';
  const HT = {};
  const THRESH = 40;     // px before a swipe counts
  const FLICK = 0.45;    // px/ms: a quick flick counts even if it's short
  const SLOP = 8;        // px of wiggle before we decide which way the finger is going
  HT.HOME = 'https://home-hub-dashboard.vercel.app/';

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function emit(el, name, detail) { el.dispatchEvent(new CustomEvent('ht:' + name, { bubbles: true, detail })); }
  function eatNextClick(el) {
    const f = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    el.addEventListener('click', f, true);
    setTimeout(() => el.removeEventListener('click', f, true), 80);
  }

  // Kiosk = opened with ?kiosk=1 (remembered for the tab's life).
  try {
    if (/[?&]kiosk=1\b/.test(location.search)) sessionStorage.setItem('ht-kiosk', '1');
    HT.isKiosk = sessionStorage.getItem('ht-kiosk') === '1';
  } catch (e) { HT.isKiosk = /[?&]kiosk=1\b/.test(location.search); }

  // ---- one-time hints (wall screens look like TVs; show each gesture once) ----
  function hintOnce(key, fn, delay) {
    let seen = false;
    try { seen = localStorage.getItem('ht-hint:' + key) === '1'; } catch (e) {}
    if (seen) return;
    setTimeout(() => { fn(); try { localStorage.setItem('ht-hint:' + key, '1'); } catch (e) {} }, delay || 900);
  }
  HT.resetHints = function () {
    try { Object.keys(localStorage).filter((k) => k.indexOf('ht-hint:') === 0).forEach((k) => localStorage.removeItem(k)); } catch (e) {}
  };

  // ---- one-finger drag along one axis (Pointer Events) ----
  // h: {filter(e), down(e), start(e), move(dx,dy,e), end(dx,dy,vx,vy,e), cancel()}
  function drag(el, axis, h) {
    const active = new Set();
    let id = null, x0 = 0, y0 = 0, dir = null, samples = [];
    function cancel() {
      if (id !== null && dir === axis && h.cancel) h.cancel();
      id = null; dir = null;
    }
    el.addEventListener('pointerdown', (e) => {
      active.add(e.pointerId);
      if (active.size > 1) { cancel(); return; }          // second finger: drop the swipe
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (h.filter && !h.filter(e)) return;
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; dir = null;
      samples = [{ x: x0, y: y0, t: e.timeStamp }];
      if (h.down) h.down(e);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (samples.length > 6) samples.shift();
      if (!dir) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        dir = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (dir !== axis) { id = null; return; }            // wrong way: let the page scroll
        try { el.setPointerCapture(id); } catch (e2) {}
        if (h.start) h.start(e);
      }
      h.move(dx, dy, e);
    });
    function finish(e, cancelled) {
      active.delete(e.pointerId);
      if (e.pointerId !== id) return;
      const wasDragging = dir === axis;
      id = null;
      if (!wasDragging) return;
      dir = null;
      eatNextClick(el);
      if (cancelled) { if (h.cancel) h.cancel(); return; }
      const a = samples[0], b = samples[samples.length - 1], dt = Math.max(1, b.t - a.t);
      h.end(e.clientX - x0, e.clientY - y0, (b.x - a.x) / dt, (b.y - a.y) / dt, e);
    }
    el.addEventListener('pointerup', (e) => finish(e, false));
    el.addEventListener('pointercancel', (e) => finish(e, true));
    el.addEventListener('lostpointercapture', (e) => active.delete(e.pointerId));
  }

  // ---- little "pop" sound for completions ----
  let actx = null;
  HT.muted = false;
  HT.pop = function (freq) {
    if (HT.muted) return;
    freq = freq || 660;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = 'sine';
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * 1.6, t + 0.08);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(actx.destination);
      o.start(t); o.stop(t + 0.2);
    } catch (e) {}
  };

  // ---- toast with Undo ----
  let toastEl = null, toastTimer = null;
  HT.toast = function (msg, undo, ms) {
    ms = ms || 5000;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'ht-toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = '<span class="ht-toast-msg"></span>' +
      (undo ? '<button type="button" class="ht-toast-undo">Undo</button>' : '') + '<i class="ht-toast-bar"></i>';
    toastEl.querySelector('.ht-toast-msg').textContent = msg;
    toastEl.style.setProperty('--ht-toast-ms', ms + 'ms');
    const hide = () => { toastEl.classList.remove('show'); clearTimeout(toastTimer); };
    if (undo) toastEl.querySelector('button').onclick = () => { hide(); undo(); };
    toastEl.classList.remove('show'); void toastEl.offsetWidth; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(hide, ms);
  };

  // ---- swipe stack: next/previous card ----
  HT.swipeStack = function (el, opts) {
    opts = opts || {};
    el.classList.add('ht-stack');
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
    let track = el.querySelector(':scope > .ht-track');
    if (!track) {
      track = document.createElement('div');
      track.className = 'ht-track';
      while (el.firstElementChild) track.appendChild(el.firstElementChild);
      el.appendChild(track);
    }
    const cards = () => Array.from(track.children);
    cards().forEach((c) => c.classList.add('ht-card'));
    const dots = document.createElement('div');
    dots.className = 'ht-dots';
    dots.setAttribute('aria-hidden', 'true');
    el.appendChild(dots);
    let i = clamp(opts.start || 0, 0, Math.max(0, cards().length - 1));

    function offset(k) {
      const c = cards()[0];
      const w = c ? c.offsetWidth : el.clientWidth;
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      return (el.clientWidth - w) / 2 - k * (w + gap);
    }
    function place(animate, extra) {
      track.classList.toggle('ht-anim', !!animate);
      track.style.transform = 'translate3d(' + (offset(i) + (extra || 0)) + 'px,0,0)';
    }
    function mark() {
      cards().forEach((c, k) => {
        c.classList.toggle('is-active', k === i);
        c.setAttribute('aria-hidden', k === i ? 'false' : 'true');
      });
      dots.innerHTML = cards().map((_, k) => '<i' + (k === i ? ' class="on"' : '') + '></i>').join('');
    }
    function go(n) {
      n = clamp(n, 0, cards().length - 1);
      const changed = n !== i;
      i = n; place(true); mark();
      if (changed) {
        emit(el, 'change', { index: i, card: cards()[i] });
        if (opts.onChange) opts.onChange(i, cards()[i]);
      }
    }
    drag(el, 'x', {
      start() { el.classList.add('dragging'); },
      move(dx) {
        const last = cards().length - 1;
        if ((i === 0 && dx > 0) || (i === last && dx < 0)) dx *= 0.35;   // rubber band at the ends
        place(false, dx);
      },
      end(dx, dy, vx) {
        el.classList.remove('dragging');
        let n = i;
        if (dx < -THRESH || (vx < -FLICK && dx < 0)) n = i + 1;
        else if (dx > THRESH || (vx > FLICK && dx > 0)) n = i - 1;
        go(n);
        if (n === i) place(true);
      },
      cancel() { el.classList.remove('dragging'); place(true); }
    });
    // Tapping a peeking neighbour brings it to the middle instead of opening it.
    el.addEventListener('click', (e) => {
      const card = e.target.closest('.ht-card');
      if (!card || card.parentElement !== track || card.classList.contains('is-active')) return;
      e.preventDefault(); e.stopPropagation();
      go(cards().indexOf(card));
    }, true);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') go(i + 1);
      if (e.key === 'ArrowLeft') go(i - 1);
    });
    if (window.ResizeObserver) new ResizeObserver(() => place(false)).observe(el);
    place(false); mark();
    hintOnce(opts.hintKey || 'stack', () => {
      if (cards().length < 2) return;
      place(true, i === cards().length - 1 ? 56 : -56);
      setTimeout(() => place(true), 450);
    });
    return { go, next: () => go(i + 1), prev: () => go(i - 1), get index() { return i; } };
  };

  // ---- swipe rows: right = done, left = snooze/remove, 5 s undo ----
  HT.swipeRows = function (list, opts) {
    opts = opts || {};
    const right = Object.assign({ label: 'Done', icon: '✓', mode: 'done' }, opts.right);
    const left = opts.left === false ? null : Object.assign({ label: 'Snooze', icon: '⏰', mode: 'remove' }, opts.left);
    const tapToggles = opts.tapToggles !== false && right.mode === 'done';
    list.classList.add('ht-rows');

    function setup(row) {
      if (row.__htRow) return;
      row.__htRow = true;
      row.classList.add('ht-row');
      const face = document.createElement('div');
      face.className = 'ht-row-face';
      while (row.firstChild) face.appendChild(row.firstChild);
      const under = document.createElement('div');
      under.className = 'ht-row-under';
      under.setAttribute('aria-hidden', 'true');
      under.innerHTML = '<span class="ht-under-r">' + right.icon + ' ' + right.label + '</span>' +
        (left ? '<span class="ht-under-l">' + left.label + ' ' + left.icon + '</span>' : '');
      row.append(under, face);
      let armed = null;

      function snap() {
        face.classList.add('ht-anim');
        face.style.transform = '';
        armed = null;
        row.classList.remove('armed');
        setTimeout(() => { if (!face.style.transform) row.classList.remove('show-r', 'show-l'); }, 380);
      }
      function report(side, undone) {
        const d = { row, side, done: row.classList.contains('is-done'), undone: !!undone };
        emit(row, undone ? 'undo' : 'action', d);
        if (undone) { if (opts.onUndo) opts.onUndo(row, side, d); } else if (opts.onAction) opts.onAction(row, side, d);
      }
      function act(side) {
        const a = side === 'r' ? right : left;
        if (a.mode === 'done') {
          snap();
          const nowDone = row.classList.toggle('is-done');
          row.classList.remove('bounce'); void row.offsetWidth; row.classList.add('bounce');
          if (nowDone) HT.pop();
          report(side);
          HT.toast(nowDone ? a.label + ' ✓' : 'Not done', () => { row.classList.toggle('is-done'); report(side, true); });
          return;
        }
        // remove / snooze: fly off, collapse, offer undo
        face.classList.add('ht-anim');
        face.style.transform = 'translate3d(' + (side === 'r' ? 110 : -110) + '%,0,0)';
        const h = row.offsetHeight;
        row.style.height = h + 'px';
        setTimeout(() => {
          row.classList.add('ht-collapse');
          void row.offsetWidth;
          row.style.height = '0px'; row.style.marginTop = '0px'; row.style.marginBottom = '0px'; row.style.opacity = '0';
        }, 220);
        const hideT = setTimeout(() => { row.hidden = true; }, 560);
        report(side);
        HT.toast(a.label, () => {
          clearTimeout(hideT);
          row.hidden = false;
          row.classList.remove('ht-collapse', 'show-r', 'show-l');
          row.style.height = row.style.marginTop = row.style.marginBottom = row.style.opacity = '';
          face.classList.remove('ht-anim'); face.style.transform = '';
          report(side, true);
        });
      }
      row.__htAct = act;

      drag(row, 'x', {
        start() { face.classList.remove('ht-anim'); },
        move(dx) {
          if (dx < 0 && !left) dx *= 0.25;
          face.style.transform = 'translate3d(' + dx + 'px,0,0)';
          row.classList.toggle('show-r', dx > 0);
          row.classList.toggle('show-l', dx < 0);
          const need = Math.min(140, Math.max(THRESH, row.clientWidth * 0.25));
          const a = dx > need ? 'r' : (dx < -need && left) ? 'l' : null;
          if (a !== armed) { armed = a; row.classList.toggle('armed', !!a); }
        },
        end(dx, dy, vx) {
          let side = armed;
          if (!side && Math.abs(dx) > THRESH && Math.abs(vx) > FLICK) side = dx > 0 ? 'r' : (left ? 'l' : null);
          if (side) { row.classList.remove('armed'); act(side); } else snap();
        },
        cancel: snap
      });
      if (tapToggles) {
        row.addEventListener('click', (e) => {
          if (e.target.closest('a,button,input,select,textarea,label')) return;
          act('r');
        });
      }
    }
    Array.from(list.querySelectorAll(opts.rowSelector || ':scope > *')).forEach(setup);
    return { add: setup };
  };

  // ---- home handle: swipe up (or tap) ----
  HT.homeHandle = function (opts) {
    opts = opts || {};
    if (document.querySelector('.ht-home')) return;
    const go = opts.onHome || (() => { location.href = opts.href || HT.HOME; });
    const h = document.createElement('button');
    h.type = 'button';
    h.className = 'ht-home';
    h.setAttribute('aria-label', 'Home');
    h.innerHTML = '<span class="ht-home-label">Home</span><span class="ht-home-bar"></span>';
    document.body.appendChild(h);
    const reset = () => { h.classList.remove('dragging', 'armed'); h.style.setProperty('--lift', 0); };
    drag(h, 'y', {
      start() { h.classList.add('dragging'); },
      move(dx, dy) {
        const up = Math.max(0, -dy);
        h.style.setProperty('--lift', Math.min(up, 140));
        h.classList.toggle('armed', up > THRESH * 1.5);
      },
      end(dx, dy, vx, vy) {
        const ok = -dy > THRESH * 1.5 || (vy < -FLICK && -dy > 16);
        reset();
        if (ok) { HT.pop(520); go(); }
      },
      cancel: reset
    });
    h.addEventListener('click', go);
    hintOnce('home', () => { h.classList.add('hint'); setTimeout(() => h.classList.remove('hint'), 3800); }, 1500);
    return h;
  };

  // ---- back: swipe in from the left edge, or tap the ‹ chip ----
  HT.edgeBack = function (opts) {
    opts = opts || {};
    if (document.querySelector('.ht-edge')) return;
    const back = opts.onBack || (() => {
      if (history.length > 1) history.back(); else location.href = opts.href || HT.HOME;
    });
    const strip = document.createElement('div');
    strip.className = 'ht-edge';
    const bubble = document.createElement('div');
    bubble.className = 'ht-edge-bubble';
    bubble.textContent = '‹';
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'ht-back-chip';
    chip.setAttribute('aria-label', 'Back');
    chip.textContent = '‹';
    document.body.append(strip, bubble, chip);
    const reset = () => { bubble.classList.remove('dragging', 'armed'); bubble.style.setProperty('--pull', 0); };
    const edgeSwipe = {
      down(e) { bubble.style.top = e.clientY + 'px'; },
      start() { bubble.classList.add('dragging'); },
      move(dx) {
        const p = clamp(dx, 0, 140);
        bubble.style.setProperty('--pull', p);
        bubble.classList.toggle('armed', p > 60);
      },
      end(dx, dy, vx) {
        const ok = dx > 60 || (vx > FLICK && dx > THRESH);
        reset();
        if (ok) back();
      },
      cancel: reset
    };
    drag(strip, 'x', edgeSwipe);
    drag(chip, 'x', edgeSwipe);          // pulling the chip itself also counts
    chip.addEventListener('click', back);
    hintOnce('back', () => { chip.classList.add('hint'); setTimeout(() => chip.classList.remove('hint'), 2600); }, 2400);
    return chip;
  };

  // ---- Control Center: pull down from the top-right corner (like iPhone/iPad) ----
  HT.HUB = 'https://home-hub-web-hoegh-home.vercel.app';
  HT.defaultControls = function () {
    return [
      { label: 'Home', icon: '⌂', href: HT.HOME, color: '#4a4f73' },
      { label: 'Nellie', icon: '🏀', href: HT.HUB + '/?p=Nellie&kiosk=1', color: '#e2407f' },
      { label: 'Nash', icon: '🏈', href: HT.HUB + '/?p=Nash&kiosk=1', color: '#2f8fdc' },
      { label: 'Calendar', icon: '📅', href: 'https://calendar.google.com/calendar/u/0/r/week', color: '#2fa36b' },
      { label: 'Stopwatch', icon: '⏱️', href: HT.HUB + '/timer/', color: '#6a3fb5' },
      { label: 'Night Shooters', icon: '🌙', href: HT.HUB + '/shooting/', color: '#26337a' },
      { label: 'Drills', icon: '🎬', href: HT.HUB + '/drills/', color: '#c0611f' },
      { label: 'Refresh', icon: '↻', action: () => location.reload(), color: '#4a4f73' },
      { label: 'Exit kiosk', icon: '✕', href: 'homehubadmin://exit', hold: 1200, note: 'hold', color: '#8c2232' }
    ];
  };
  HT.controlCenter = function (opts) {
    opts = opts || {};
    if (document.querySelector('.ht-cc')) return;
    const items = opts.items || HT.defaultControls();
    const grab = document.createElement('div');
    grab.className = 'ht-cc-grab';
    grab.setAttribute('role', 'button');
    grab.setAttribute('aria-label', 'Open control center');
    grab.innerHTML = '<span class="ht-cc-pill"><span class="ht-cc-dots"><i></i><i></i><i></i><i></i></span><span class="ht-cc-chev">⌄</span></span>';
    const cc = document.createElement('div');
    cc.className = 'ht-cc';
    cc.setAttribute('role', 'dialog');
    cc.setAttribute('aria-label', 'Control center');
    cc.innerHTML = '<div class="ht-cc-sheet"><div class="ht-cc-top"><div class="ht-cc-time"></div><div class="ht-cc-date"></div></div>' +
      '<div class="ht-cc-grid"></div><div class="ht-cc-close">Swipe up or tap outside to close</div><span class="ht-cc-bar"></span></div>';
    const grid = cc.querySelector('.ht-cc-grid');
    items.forEach((it) => {
      const t = document.createElement(it.href && !it.hold ? 'a' : 'button');
      t.className = 'ht-cc-tile';
      if (t.tagName === 'A') t.href = it.href; else t.type = 'button';
      t.style.setProperty('--c', it.color || '#4a4f73');
      t.innerHTML = '<span class="ht-cc-icon"></span><span class="ht-cc-label"></span>' + (it.note ? '<small></small>' : '');
      t.querySelector('.ht-cc-icon').textContent = it.icon || '';
      t.querySelector('.ht-cc-label').textContent = it.label;
      if (it.note) t.querySelector('small').textContent = it.note;
      const run = () => { if (it.action) it.action(); else if (it.href) location.href = it.href; };
      if (it.hold) {
        HT.longPress(t, run, { ms: it.hold });
        t.addEventListener('click', () => HT.toast('Press and hold to ' + it.label.toLowerCase()));
      } else if (t.tagName !== 'A') {
        t.addEventListener('click', run);
      }
      grid.appendChild(t);
    });
    document.body.append(cc, grab);

    const H = () => cc.offsetHeight || innerHeight;
    function tick() {
      const d = new Date();
      cc.querySelector('.ht-cc-time').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      cc.querySelector('.ht-cc-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    }
    function follow(y) {
      cc.style.transform = 'translate3d(0,' + y + 'px,0)';
      cc.style.setProperty('--p', clamp(1 + y / H(), 0, 1));
    }
    function show(v) {
      cc.classList.remove('dragging');
      cc.style.transform = ''; cc.style.removeProperty('--p');
      cc.classList.toggle('open', v);
      grab.classList.toggle('hide', v);
      if (v) { tick(); emit(cc, 'control', { open: true }); }
    }
    drag(grab, 'y', {
      start() { tick(); cc.classList.add('dragging'); },
      move(dx, dy) { follow(clamp(dy * 1.3 - H(), -H(), 0)); },
      end(dx, dy, vx, vy) { show(dy * 1.3 > H() * 0.22 || (vy > FLICK && dy > 20)); },
      cancel() { show(false); }
    });
    grab.addEventListener('click', () => show(true));
    drag(cc, 'y', {
      start() { cc.classList.add('dragging'); },
      move(dx, dy) { follow(clamp(dy, -H(), 0)); },
      end(dx, dy, vx, vy) { show(!(-dy > H() * 0.18 || (vy < -FLICK && dy < -20))); },
      cancel() { show(true); }
    });
    cc.addEventListener('click', (e) => { if (!e.target.closest('.ht-cc-tile')) show(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') show(false); });
    hintOnce('cc', () => { grab.classList.add('hint'); setTimeout(() => grab.classList.remove('hint'), 3600); }, 3200);
    return { open: () => show(true), close: () => show(false) };
  };

  HT.nav = function (opts) {
    opts = opts || {};
    HT.homeHandle(opts); HT.edgeBack(opts);
    if (opts.controlCenter !== false) HT.controlCenter(opts.controlCenter || {});
  };

  // ---- long-press with a filling ring ----
  HT.longPress = function (el, fn, opts) {
    opts = opts || {};
    const ms = opts.ms || 500;
    let timer = null, showT = null, ring = null, id = null, x0 = 0, y0 = 0, fired = false;
    el.classList.add('ht-lp');
    function clear(keepRing) {
      clearTimeout(timer); clearTimeout(showT);
      if (ring && !keepRing) ring.remove();
      if (!keepRing) ring = null;
    }
    el.addEventListener('pointerdown', (e) => {
      if (id !== null) { clear(); id = null; return; }       // second finger cancels
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; fired = false;
      ring = document.createElement('div');
      ring.className = 'ht-ring';
      ring.style.left = x0 + 'px'; ring.style.top = y0 + 'px';
      ring.style.setProperty('--ht-lp-ms', (ms - 120) + 'ms');
      ring.innerHTML = '<svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="42"/>' +
        '<circle class="fg" cx="50" cy="50" r="42" pathLength="100"/></svg>';
      document.body.appendChild(ring);
      showT = setTimeout(() => { if (ring) ring.classList.add('go'); }, 120);   // quick taps never see a ring
      timer = setTimeout(() => {
        fired = true;
        const r = ring; clear(true); ring = null;
        if (r) { r.classList.add('done'); setTimeout(() => r.remove(), 300); }
        HT.pop(520);
        emit(el, 'longpress', { x: x0, y: y0 });
        if (fn) fn(el, e);
      }, ms);
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId === id && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) clear();
    });
    const up = (e) => { if (e.pointerId === id) { clear(); id = null; } };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('click', (e) => { if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; } }, true);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  };

  // ---- pull down at the top to refresh ----
  // Uses touch events: a pull at scrollTop 0 has to cancel the browser's own overscroll,
  // which Pointer Events can't do once touch-action allows vertical panning.
  HT.pullRefresh = function (scroller, fn) {
    const isDoc = !scroller || scroller === document || scroller === document.body || scroller === document.documentElement;
    const target = isDoc ? document : scroller;
    const top = () => (isDoc ? (document.scrollingElement || document.documentElement).scrollTop : scroller.scrollTop);
    const ind = document.createElement('div');
    ind.className = 'ht-pull';
    ind.innerHTML = '<span>↻</span>';
    document.body.appendChild(ind);
    let y0 = null, x0 = 0, decided = false, pull = 0, busy = false;
    const set = (p) => { pull = p; ind.style.setProperty('--pull', p); ind.classList.toggle('armed', p >= 64); };
    target.addEventListener('touchstart', (e) => {
      if (busy || e.touches.length > 1 || top() > 0 ||
          (e.target.closest && e.target.closest('.ht-cc-grab,.ht-cc,.ht-home,.ht-edge,.ht-back-chip'))) { y0 = null; return; }
      y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; decided = false;
      if (!isDoc) ind.style.top = Math.max(0, scroller.getBoundingClientRect().top) + 'px';
      ind.classList.remove('settle');
    }, { passive: true });
    target.addEventListener('touchmove', (e) => {
      if (y0 === null) return;
      if (e.touches.length > 1) { y0 = null; ind.classList.add('settle'); set(0); return; }
      const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
      if (!decided) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        decided = true;
        if (Math.abs(dx) > Math.abs(dy) || dy < 0) { y0 = null; return; }
      }
      if (dy <= 0 || top() > 0) { set(0); return; }
      if (e.cancelable) e.preventDefault();
      set(Math.min(110, dy * 0.5));
    }, { passive: false });
    target.addEventListener('touchend', () => {
      if (y0 === null) return;
      y0 = null;
      ind.classList.add('settle');
      if (pull < 64) { set(0); return; }
      busy = true; set(64); ind.classList.add('spin');
      emit(isDoc ? document.body : scroller, 'refresh', {});
      Promise.resolve(fn && fn()).catch(() => {}).then(() => {
        setTimeout(() => { busy = false; ind.classList.remove('spin'); set(0); }, 300);
      });
    });
  };

  // ---- pinch / spread to step zoom levels (day <-> week <-> month) ----
  HT.pinchZoom = function (el, opts) {
    opts = opts || {};
    const levels = opts.levels || ['day', 'week', 'month'];
    let i = clamp(opts.start == null ? 1 : opts.start, 0, levels.length - 1);
    const content = opts.content || el.firstElementChild || el;
    el.classList.add('ht-pinch');
    content.classList.add('ht-pinch-content');
    let d0 = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    function scale(s, animate) {
      content.classList.toggle('ht-anim', !!animate);
      content.style.setProperty('--ht-pinch', s);
    }
    function set(n, by) {
      n = clamp(n, 0, levels.length - 1);
      if (n === i) { scale(1, true); return; }
      i = n;
      el.dataset.level = levels[i];
      scale(1, true);
      emit(el, 'zoom', { level: levels[i], index: i, by: by || 'api' });
      if (opts.onLevel) opts.onLevel(levels[i], i);
    }
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) { d0 = dist(e.touches); if (e.cancelable) e.preventDefault(); }
    }, { passive: false });
    el.addEventListener('touchmove', (e) => {
      if (d0 === null || e.touches.length !== 2) return;
      if (e.cancelable) e.preventDefault();
      const r = dist(e.touches) / d0;
      scale(clamp(r, 0.85, 1.15), false);                     // live feedback while pinching
      if (r > 1.3) { set(i - 1, 'pinch'); d0 = dist(e.touches); }       // spread = zoom in (toward day)
      else if (r < 0.77) { set(i + 1, 'pinch'); d0 = dist(e.touches); } // pinch = zoom out (toward month)
    }, { passive: false });
    el.addEventListener('touchend', (e) => { if (e.touches.length < 2 && d0 !== null) { d0 = null; scale(1, true); } });
    el.addEventListener('wheel', (e) => {                       // Ctrl+wheel / trackpad pinch for desk testing
      if (!e.ctrlKey) return;
      e.preventDefault();
      set(i + (e.deltaY > 0 ? 1 : -1), 'wheel');
    }, { passive: false });
    el.dataset.level = levels[i];
    return { set: (lvl) => set(typeof lvl === 'number' ? lvl : levels.indexOf(lvl), 'api'), get level() { return levels[i]; } };
  };

  // ---- kiosk page lock-down ----
  HT.kioskMode = function () {
    document.documentElement.classList.add('ht-kiosk');
    let m = document.querySelector('meta[name=viewport]');
    if (!m) { m = document.createElement('meta'); m.name = 'viewport'; document.head.appendChild(m); }
    if (!/user-scalable/.test(m.content)) {
      m.content = (m.content ? m.content + ', ' : 'width=device-width, initial-scale=1, ') + 'maximum-scale=1, user-scalable=no';
    }
    document.addEventListener('contextmenu', (e) => e.preventDefault());   // touch long-press menu
    document.addEventListener('dragstart', (e) => e.preventDefault());     // ghost image drags
    document.addEventListener('wheel', (e) => { if (e.ctrlKey && !e.defaultPrevented) e.preventDefault(); }, { passive: false });
    ['gesturestart', 'gesturechange'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault()));
  };

  // ---- data-attribute wiring: data-ht-stack, data-ht-rows, data-ht-longpress ----
  HT.auto = function (root) {
    root = root || document;
    root.querySelectorAll('[data-ht-stack]').forEach((el) => { if (!el.__ht) el.__ht = HT.swipeStack(el); });
    root.querySelectorAll('[data-ht-rows]').forEach((el) => { if (!el.__ht) el.__ht = HT.swipeRows(el); });
    root.querySelectorAll('[data-ht-longpress]').forEach((el) => { if (!el.__ht) { el.__ht = 1; HT.longPress(el); } });
  };

  window.HubTouch = HT;
})();
