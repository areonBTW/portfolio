(() => {
  'use strict';

  // Contact link: the only place to change it.
  const TELEGRAM_URL = 'https://t.me/areon_uc';

  // Frame sets produced by ffmpeg (see works/cosmos/README.md).
  const FRAME_COUNT = 283;
  const FRAME_SETS = {
    desktop: 'frames/desktop/',
    mobile: 'frames/mobile/',
  };

  // Plateau frames (0-based, after dedup) for the four screens:
  // spiral, black hole on the left, Earth, Europe at night.
  const STOPS = [9, 112, 228, FRAME_COUNT - 1];

  // Horizontal focus (0..1) per stop, used when the screen is narrower than 16:9
  // so the subject stays in view on phones.
  const FOCUS_X = [0.5, 0.24, 0.5, 0.45];

  // Horizontal camera drift per stop, as a share of the viewport width (wide screens only).
  // Earth sits in the centre of the source, so it is pushed left to free the right side for text.
  const SHIFT_X = [0, 0, -0.22, 0];

  // Same breakpoint as the side-text layout in style.css.
  const WIDE_QUERY = '(min-width: 768px) and (min-aspect-ratio: 5/4)';

  // Scroll budget in arbitrary units: plateaus are fixed, flights scale with frame distance.
  const HERO_HOLD = 0.6;
  const STOP_HOLD = 1.1;
  const FINAL_HOLD = 0.7;
  const UNITS_PER_FRAME = 0.02;

  // Loading: the page opens once the first screen plus a short run-up is in (~1.7 MB on desktop);
  // the rest streams in order while the visitor reads the first screen.
  const GATE_FRAMES = STOPS[0] + 31;
  const LOAD_CONCURRENCY = 10;
  const LOADER_TIMEOUT = 15000;
  const DECODE_AHEAD = 8;

  const SMOOTHING = 0.09; // share of the gap closed per 60 Hz frame
  const MAX_DPR = 1.5; // source is 1280 px wide, a denser canvas buys nothing
  const EDGE_FADE = 0.16;
  const INTRO_MS = 1100;
  const BREATH_PERIOD = 9000;
  const BREATH_SCALE = 0.035;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(pointer: fine)').matches;
  const wideQuery = matchMedia(WIDE_QUERY);

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const root = document.documentElement;
  const main = $('main');
  const stage = $('#stage');
  const viewport = $('.viewport');
  const canvas = $('#scene');
  const ctx = canvas.getContext('2d', { alpha: false });
  const panels = $$('.panel');
  const dots = $$('.rail__dot');
  const railFill = $('#railFill');
  const screenNum = $('#screenNum');
  const loaderFill = $('#loaderFill');
  const loaderPct = $('#loaderPct');
  const bg = getComputedStyle(root).getPropertyValue('--c-bg').trim() || '#000';

  $$('[data-telegram]').forEach((a) => { a.href = TELEGRAM_URL; });

  // Stagger index for the blur reveal.
  panels.forEach((panel) => {
    $$('.line', panel).forEach((el, i) => el.style.setProperty('--i', i));
  });

  /* ---------- Scroll map ---------- */

  // Keypoints [progress, frame, focusX, shiftX]; each stop is a pair of equal frames = a plateau.
  const keys = (() => {
    const pts = [];
    let u = 0;
    const push = (i) => pts.push([u, STOPS[i], FOCUS_X[i], SHIFT_X[i]]);
    push(0);
    u += HERO_HOLD;
    push(0);
    for (let i = 1; i < STOPS.length; i++) {
      u += (STOPS[i] - STOPS[i - 1]) * UNITS_PER_FRAME;
      push(i);
      u += i < STOPS.length - 1 ? STOP_HOLD : FINAL_HOLD;
      push(i);
    }
    return pts.map(([p, ...rest]) => [p / u, ...rest]);
  })();

  // Plateau windows per screen: [start, end] in progress.
  const windows = STOPS.map((_, i) => [keys[2 * i][0], keys[2 * i + 1][0]]);

  const smoothstep = (t) => t * t * (3 - 2 * t);

  function sample(p) {
    for (let i = 1; i < keys.length; i++) {
      const a = keys[i - 1];
      const b = keys[i];
      if (p <= b[0]) {
        const t = b[0] === a[0] ? 1 : (p - a[0]) / (b[0] - a[0]);
        const s = smoothstep(t);
        return {
          frame: a[1] + (b[1] - a[1]) * t,
          focus: a[2] + (b[2] - a[2]) * s,
          shift: a[3] + (b[3] - a[3]) * s,
        };
      }
    }
    const last = keys[keys.length - 1];
    return { frame: last[1], focus: last[2], shift: last[3] };
  }

  // Measured against the sticky viewport, not innerHeight, which jumps with the iOS toolbar.
  const scrollRange = () => Math.max(0, stage.offsetHeight - viewport.offsetHeight);

  function scrollProgress() {
    const range = scrollRange();
    if (range === 0) return 0;
    return Math.min(1, Math.max(0, (scrollY - stage.offsetTop) / range));
  }

  /* ---------- Frames ---------- */

  const frameDir = matchMedia('(max-width: 767px)').matches ? FRAME_SETS.mobile : FRAME_SETS.desktop;
  const frames = new Array(FRAME_COUNT);
  const ready = new Uint8Array(FRAME_COUNT);

  const frameUrl = (i) => frameDir + 'f_' + String(i + 1).padStart(4, '0') + '.webp';

  // Loads frames in order through a small pool; resolves when the gate frames have settled
  // (or on timeout), then keeps streaming the rest.
  function loadFrames(onProgress) {
    let next = 0;
    let gateDone = 0;
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, LOADER_TIMEOUT);
      const pump = () => {
        if (next >= FRAME_COUNT) return;
        const i = next++;
        const img = new Image();
        img.decoding = 'async';
        const settle = (ok) => {
          if (ok) ready[i] = 1;
          if (i < GATE_FRAMES) {
            gateDone++;
            onProgress(gateDone / GATE_FRAMES);
            if (gateDone === GATE_FRAMES) {
              clearTimeout(timer);
              resolve();
            }
          }
          pump();
        };
        img.onload = () => settle(true);
        img.onerror = () => settle(false);
        img.src = frameUrl(i);
        frames[i] = img;
      };
      for (let k = 0; k < LOAD_CONCURRENCY; k++) pump();
    });
  }

  function nearestReady(i) {
    for (let d = 0; d < FRAME_COUNT; d++) {
      if (i - d >= 0 && ready[i - d]) return i - d;
      if (i + d < FRAME_COUNT && ready[i + d]) return i + d;
    }
    return -1;
  }

  // Decode a few frames ahead of the scroll direction so drawImage never decodes synchronously.
  // Only a small window is requested; the browser is free to drop bitmaps far behind.
  let lastPrefetch = -1;
  function prefetch(i) {
    if (i === lastPrefetch) return;
    const dir = i >= lastPrefetch ? 1 : -1;
    lastPrefetch = i;
    for (let k = 1; k <= DECODE_AHEAD; k++) {
      const j = i + k * dir;
      if (j >= 0 && j < FRAME_COUNT && ready[j]) frames[j].decode().catch(() => {});
    }
  }

  /* ---------- Canvas ---------- */

  let cw = 0;
  let ch = 0;
  let drawn = '';

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, MAX_DPR);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (w === cw && h === ch) return;
    cw = canvas.width = w;
    ch = canvas.height = h;
    ctx.imageSmoothingQuality = 'high';
    drawn = '';
  }

  function draw(frame, focus, shift) {
    const i = nearestReady(Math.round(frame));
    if (i < 0) return;
    const fx = Math.round(focus * 1000) / 1000;
    const sx = wideQuery.matches ? Math.round(shift * cw) : 0;
    const key = i + '|' + fx + '|' + sx + '|' + cw + 'x' + ch;
    if (key === drawn) return;
    drawn = key;

    const img = frames[i];
    const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    const x = (cw - w) * fx + sx;
    const y = (ch - h) / 2;
    const edge = x + w;
    const exposed = cw - edge;

    if (exposed > 0) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, cw, ch);
    }
    ctx.drawImage(img, x, y, w, h);

    // Drifted frame: melt the exposed edge into the background. The fade grows with the gap,
    // so the drift starts without a visible jump.
    if (exposed > 0) {
      const fw = Math.min(cw * EDGE_FADE, exposed * 3);
      const fade = ctx.createLinearGradient(edge - fw, 0, edge, 0);
      fade.addColorStop(0, 'transparent');
      fade.addColorStop(1, bg);
      ctx.fillStyle = fade;
      ctx.fillRect(edge - fw, 0, fw + 1, ch);
    }
    prefetch(i);
  }

  /* ---------- UI state ---------- */

  let activePanel = -2;
  let shownScreen = -1;
  let railValue = '';
  let sceneValue = '';

  function panelAt(p) {
    for (let i = 0; i < windows.length; i++) {
      const [a, b] = windows[i];
      if (p >= a - 0.004 && p <= b + 0.004) return i;
    }
    return -1;
  }

  function screenAt(p) {
    let idx = 0;
    for (let i = 0; i < windows.length; i++) {
      if (p >= windows[i][0] - 0.02) idx = i;
    }
    return idx;
  }

  // Inactive panels stay readable for screen readers but leave the tab order.
  function setPanel(i) {
    if (i === activePanel) return;
    activePanel = i;
    panels.forEach((el, k) => {
      const on = k === i;
      el.classList.toggle('is-active', on);
      $$('a, button', el).forEach((c) => {
        if (on) c.removeAttribute('tabindex');
        else c.setAttribute('tabindex', '-1');
      });
    });
  }

  function setScreen(i) {
    if (i === shownScreen) return;
    const first = shownScreen < 0;
    shownScreen = i;
    dots.forEach((d, k) => {
      d.classList.toggle('is-active', k === i);
      if (k === i) d.setAttribute('aria-current', 'step');
      else d.removeAttribute('aria-current');
    });
    const label = String(i + 1).padStart(2, '0');
    if (first) {
      screenNum.textContent = label;
      return;
    }
    screenNum.classList.add('is-swapping');
    setTimeout(() => {
      screenNum.textContent = String(shownScreen + 1).padStart(2, '0');
      screenNum.classList.remove('is-swapping');
    }, 200);
  }

  function setStyle(el, value, cache) {
    if (value !== cache) el.style.transform = value;
    return value;
  }

  /* ---------- Loop ---------- */

  let current = 0;
  let lastNow = 0;
  let introStart = 0;
  let introDone = false;

  function tick(now) {
    const dt = lastNow ? Math.min(now - lastNow, 50) : 16.67;
    lastNow = now;

    // Frame-rate independent easing toward the real scroll position.
    const target = scrollProgress();
    const k = 1 - Math.pow(1 - SMOOTHING, dt / 16.67);
    current += (target - current) * k;
    if (Math.abs(target - current) < 0.0001) current = target;

    const s = sample(current);
    let frame = s.frame;

    // Intro: fly from frame 0 into the first stop once, before any scroll.
    if (!introDone) {
      const t = reducedMotion ? 1 : Math.min(1, Math.max(0, (now - introStart) / INTRO_MS));
      frame = Math.min(frame, STOPS[0] * (1 - Math.pow(1 - t, 3)));
      if (t >= 1) introDone = true;
    }

    // Breathing hero: a slow zoom that fades out as the flight begins.
    if (!reducedMotion) {
      const heroWeight = Math.max(0, 1 - current / windows[0][1]);
      const breath = (1 - Math.cos((now / BREATH_PERIOD) * Math.PI * 2)) / 2;
      const scale = 1 + BREATH_SCALE * breath * heroWeight;
      sceneValue = setStyle(canvas, 'scale(' + scale.toFixed(4) + ')', sceneValue);
    }

    draw(frame, s.focus, s.shift);

    if (introDone) setPanel(panelAt(current));
    setScreen(screenAt(current));
    railValue = setStyle(railFill, 'scaleY(' + current.toFixed(3) + ')', railValue);

    requestAnimationFrame(tick);
  }

  /* ---------- Rail navigation ---------- */

  dots.forEach((dot) => {
    const i = Number(dot.dataset.stop);
    dot.style.top = (windows[i][0] * 100).toFixed(2) + '%';
    dot.addEventListener('click', () => {
      const [a, b] = windows[i];
      const p = i === windows.length - 1 ? 1 : (a + b) / 2;
      scrollTo({ top: stage.offsetTop + p * scrollRange(), behavior: reducedMotion ? 'auto' : 'smooth' });
    });
  });

  /* ---------- Magnetic buttons ---------- */

  if (finePointer && !reducedMotion) {
    const PULL = 0.28;
    const MAX = 10;
    const clamp = (v) => Math.max(-MAX, Math.min(MAX, v));
    $$('.btn').forEach((btn) => {
      let cx = 0;
      let cy = 0;
      // Centre is taken on enter, before the button moves, so the pull does not chase itself.
      btn.addEventListener('pointerenter', () => {
        const r = btn.getBoundingClientRect();
        cx = r.left + r.width / 2;
        cy = r.top + r.height / 2;
        btn.classList.add('is-magnet');
      });
      btn.addEventListener('pointermove', (e) => {
        btn.style.setProperty('--mx', clamp((e.clientX - cx) * PULL) + 'px');
        btn.style.setProperty('--my', clamp((e.clientY - cy) * PULL) + 'px');
      });
      btn.addEventListener('pointerleave', () => {
        btn.classList.remove('is-magnet');
        btn.style.setProperty('--mx', '0px');
        btn.style.setProperty('--my', '0px');
      });
    });
  }

  /* ---------- Boot ---------- */

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  scrollTo(0, 0);

  setPanel(-1);
  resize();
  addEventListener('resize', resize);

  loadFrames((share) => {
    loaderFill.style.transform = 'scaleX(' + share.toFixed(3) + ')';
    loaderPct.textContent = Math.round(share * 100) + '%';
  }).then(() => {
    scrollTo(0, 0);
    root.classList.remove('is-loading');
    main.removeAttribute('aria-busy');
    introStart = performance.now();
    requestAnimationFrame(tick);
  });
})();
